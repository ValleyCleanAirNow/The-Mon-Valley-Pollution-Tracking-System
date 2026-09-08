import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import MyRisk from './MyRisk';

jest.mock('../firebase', () => ({ db: { type: 'firestore' }, auth: {} }));
jest.mock('../hooks/useMunicipalityStatus', () => ({
  useMunicipalityStatus: () => ({
    statuses: { Clairton: { municipality: 'Clairton', pm25_corrected: 20, aqi: 68, aqi_category: 'Moderate', sensor_count: 2, computed_at: null, centroid: { lat: 40.2923, lng: -79.8817 } } },
    error: null,
  }),
}));
jest.mock('../hooks/useFacilities', () => ({
  useFacilities: () => ({
    facilities: [{ id: 'PA-CLAIRTON-001', facilityId: 'PA-CLAIRTON-001', name: 'Clairton Coke Works', location: { lat: 40.2925, lng: -79.8814 } }],
    statuses: { 'PA-CLAIRTON-001': { risk_inputs: { pm_cal: 20, w_tox: 1.3, w_wind: 1, odor_score: 0, w_odor: 4, v_user: 1 }, wind: { speed_kmh: 10, from_deg: 270, observed_at: null, station: 'KAGC' } } },
    error: null,
  }),
}));
jest.mock('../hooks/useMapLayers', () => ({ useSmellReports: () => [], useDistributions: () => [] }));

describe('MyRisk', () => {
  beforeEach(() => window.localStorage.clear());

  it('computes a personal index from municipality, facility toxicity, wind and health factors', async () => {
    const user = userEvent.setup();
    render(<MyRisk />);
    await user.selectOptions(screen.getByLabelText('Municipality'), 'Clairton');
    // (20 * 1.3 * 1.0 + 0) * 1 = 26 -> Elevated
    expect(screen.getByText('Elevated')).toBeInTheDocument();
    expect(screen.getByText(/Index 26 =/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Asthma' }));
    await user.click(screen.getByRole('button', { name: 'COPD or other lung disease' }));
    // 26 * 1.8 = 46.8 -> High
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText(/Sensitive individuals should shelter in place/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('mvpts.myRisk')!).v.asthma).toBe(true);
  });
});
