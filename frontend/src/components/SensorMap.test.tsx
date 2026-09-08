import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import SensorMap from './SensorMap';
import type { Sensor } from '../types/sensor';

// react-leaflet is ESM-only and needs a real DOM for Leaflet. Stub it.
jest.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({ children, interactive }: { children?: React.ReactNode; interactive?: boolean }) =>
    interactive === false ? <div data-testid="ring" /> : <div data-testid="marker">{children}</div>,
  Marker: ({ children }: { children: React.ReactNode }) => <div data-testid="facility">{children}</div>,
  Polygon: () => <div data-testid="zone" />,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../firebase', () => ({ db: {}, auth: {} }));

const base: Omit<Sensor, 'id' | 'name' | 'pm25_corrected' | 'aqi' | 'aqi_category' | 'excluded' | 'exclude_reason'> = {
  source: 'purpleair',
  source_id: '1',
  lat: 40.3,
  lng: -79.9,
  location_type: 0,
  pollutant: 'pm25',
  units: 'ug/m3',
  raw: { pm25_cf_1: 50, humidity: 40, confidence: 100 },
  last_seen_at: new Date('2026-09-05T12:00:00Z'),
  updated_at: new Date('2026-09-05T12:00:00Z'),
};

const mockSensors: Sensor[] = [
  { ...base, id: '1', name: 'Clairton Center', pm25_corrected: 28.5, aqi: 87, aqi_category: 'Moderate', excluded: false, exclude_reason: null },
  { ...base, id: '2', name: 'Indoor Unit', pm25_corrected: 5.0, aqi: 28, aqi_category: 'Good', excluded: true, exclude_reason: 'indoor' },
];

describe('SensorMap', () => {
  it('renders heading, legend and last-updated stamp from provided sensors', () => {
    render(<SensorMap sensors={mockSensors} onSensorSelect={jest.fn()} />);
    expect(screen.getByText('Sensor Map')).toBeInTheDocument();
    expect(screen.getByLabelText('Map legend')).toBeInTheDocument();
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
    expect(screen.getByText('1 of 2 sensors used in averages')).toBeInTheDocument();
  });

  it('renders one marker per sensor with corrected and raw values', () => {
    render(<SensorMap sensors={mockSensors} onSensorSelect={jest.fn()} />);
    expect(screen.getAllByTestId('marker')).toHaveLength(2);
    expect(screen.getAllByText(/Corrected PM2.5/)).toHaveLength(2);
    expect(screen.getAllByText(/Raw PM2.5/)).toHaveLength(2);
    expect(screen.getByText('AQI 87 · Moderate')).toBeInTheDocument();
    expect(screen.getByText(/indoor sensor/)).toBeInTheDocument();
  });

  it('lists sensors for screen readers', () => {
    render(<SensorMap sensors={mockSensors} />);
    expect(screen.getByText('Sensor list (2)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clairton Center' })).toBeInTheDocument();
  });
});

describe('SensorMap facilities', () => {
  const facilityData = {
    facilities: [
      { id: 'PA-CLAIRTON-001', facilityId: 'PA-CLAIRTON-001', name: 'U.S. Steel Clairton Coke Works', operator: 'U.S. Steel', location: { lat: 40.2925, lng: -79.8814 }, permitId: 'TV-04-00001', permitType: 'Title V Operating Permit' },
    ],
    statuses: {
      'PA-CLAIRTON-001': {
        facility_id: 'PA-CLAIRTON-001', name: 'U.S. Steel Clairton Coke Works', location: { lat: 40.2925, lng: -79.8814 }, radius_km: 3,
        pm25_corrected: 41, aqi: 115, aqi_category: 'Unhealthy for Sensitive Groups' as const, sensor_count: 2,
        wind: { from_deg: 270, speed_kmh: 20, observed_at: null, station: 'KAGC' }, zone_shape: 'sector' as const, zone_length_km: 4, zone_bearing_deg: 90,
        zone_polygon: [{ lat: 40.29, lng: -79.88 }, { lat: 40.31, lng: -79.84 }, { lat: 40.28, lng: -79.84 }, { lat: 40.29, lng: -79.88 }], computed_at: null,
        risk_level: 'high' as const, risk_score: 45.2, risk_inputs: { pm_cal: 41, w_tox: 1.3, w_wind: 0.7, odor_score: 2, w_odor: 4, v_user: 1 }, smell_reports_in_zone: 1,
      },
    },
  };
  const smellData = [
    { id: 's1', smell_value: 4, lat: 40.30, lng: -79.88, observed_at: new Date(), description: 'rotten eggs' },
    { id: 's2', smell_value: 2, lat: 40.31, lng: -79.87, observed_at: new Date(), description: null },
  ];
  const distributionData = [{ id: 'd1', name: 'Clairton Library', lat: 40.29, lng: -79.88, what: 'HEPA purifiers', address: '616 Miller Ave' }];

  it('draws facilities as hexagon risk zones, smell reports, distribution sites, and a sectioned legend', () => {
    render(<SensorMap sensors={mockSensors} facilityData={facilityData} smellData={smellData} distributionData={distributionData} />);
    expect(screen.getAllByTestId('facility').length).toBe(2); // factory + heart markers share the Marker mock
    expect(screen.getAllByTestId('zone').length).toBeGreaterThan(3); // hex cells
    expect(screen.getAllByText(/Risk High/).length).toBeGreaterThan(0);
    expect(screen.getByText(/toxicity 1.3 × wind 0.7/)).toBeInTheDocument();
    expect(screen.getByText('Smell report: 4 of 5')).toBeInTheDocument();
    expect(screen.getByText('Clairton Library')).toBeInTheDocument();
    expect(screen.getByText('PurpleAir Sensors')).toBeInTheDocument();
    expect(screen.getByText('Smell PGH Reports')).toBeInTheDocument();
    expect(screen.getByText('Risk Zones')).toBeInTheDocument();
    expect(screen.getByText('Title V Facilities')).toBeInTheDocument();
    expect(screen.getByText('VCAN Distribution')).toBeInTheDocument();
    expect(screen.getByText('Good (0-9)')).toBeInTheDocument();
    expect(screen.getByText(/Facilities right now/)).toBeInTheDocument();
  });
  it('hides layers when toggled off', async () => {
    render(<SensorMap sensors={mockSensors} facilityData={facilityData} smellData={smellData} distributionData={distributionData} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Facilities and risk zones'));
    expect(screen.queryByTestId('zone')).not.toBeInTheDocument();
    expect(screen.queryByText('Risk Zones')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/Smell PGH reports/));
    expect(screen.queryByText('Smell report: 4 of 5')).not.toBeInTheDocument();
  });
});
