import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SensorMap from './SensorMap';
import type { Sensor } from '../types/sensor';

// react-leaflet is ESM-only and needs a real DOM for Leaflet. Stub it.
jest.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({ children }: { children: React.ReactNode }) => <div data-testid="marker">{children}</div>,
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
    expect(screen.getByLabelText('AQI legend')).toBeInTheDocument();
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
