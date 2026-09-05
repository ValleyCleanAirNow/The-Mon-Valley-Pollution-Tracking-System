import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard from './Dashboard';

jest.mock('../firebase', () => ({ db: {}, auth: {} }));

describe('Dashboard', () => {
  it('renders the headline and legend without sensor data', () => {
    render(<Dashboard />);
    expect(screen.getByText('Community Health Dashboard')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByLabelText('AQI legend')).toBeInTheDocument();
  });
});
