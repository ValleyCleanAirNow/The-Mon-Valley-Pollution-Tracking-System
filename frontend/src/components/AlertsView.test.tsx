import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AlertsView, { normalizePhone } from './AlertsView';

const mockSetDoc = jest.fn();
jest.mock('firebase/firestore', () => ({
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  deleteDoc: jest.fn(),
  doc: (_db: unknown, col: string, id: string) => `${col}/${id}`,
  serverTimestamp: () => 'SERVER_TIME',
  Timestamp: { fromDate: (d: Date) => ({ toDate: () => d }) },
  onSnapshot: jest.fn(() => () => {}),
  collection: jest.fn(),
}));
jest.mock('firebase/messaging', () => ({ getMessaging: jest.fn(), getToken: jest.fn(), isSupported: async () => false }));
jest.mock('../firebase', () => ({ app: {}, db: { type: 'firestore' }, auth: {} }));
jest.mock('../hooks/useAnonymousAuth', () => ({ useAnonymousAuth: () => ({ uid: 'device-1', loading: false, error: null }) }));
jest.mock('../hooks/useAlertSubscription', () => ({ useAlertSubscription: () => ({ subscription: null, loaded: true, error: null }) }));
jest.mock('../hooks/useMunicipalityStatus', () => ({
  useMunicipalityStatus: () => ({
    statuses: { Clairton: { municipality: 'Clairton', pm25_corrected: 41.2, aqi: 115, aqi_category: 'Unhealthy for Sensitive Groups', sensor_count: 2, computed_at: null } },
    error: null,
  }),
}));

describe('normalizePhone', () => {
  it('turns casual US numbers into E.164', () => {
    expect(normalizePhone('412 555 0100')).toBe('+14125550100');
    expect(normalizePhone('(412) 555-0100')).toBe('+14125550100');
    expect(normalizePhone('1 412 555 0100')).toBe('+14125550100');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });
});

describe('AlertsView', () => {
  beforeEach(() => mockSetDoc.mockReset());

  it('requires a municipality and a channel', async () => {
    const user = userEvent.setup();
    render(<AlertsView />);
    await user.click(screen.getByRole('button', { name: 'Turn on alerts' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/municipality/i);
    await user.click(screen.getByRole('button', { name: 'Clairton' }));
    await user.click(screen.getByRole('button', { name: 'Turn on alerts' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/how you want to be alerted/i);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('shows current status for chosen municipalities and saves an email subscription', async () => {
    mockSetDoc.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AlertsView />);
    await user.click(screen.getByRole('button', { name: 'Clairton' }));
    expect(screen.getByLabelText('Current air quality')).toHaveTextContent(/Unhealthy for Sensitive Groups · PM2.5 41/);
    await user.click(screen.getByRole('radio', { name: /Unhealthy or worse/ }));
    await user.click(screen.getByRole('button', { name: 'Email' }));
    await user.type(screen.getByLabelText('Email address'), 'resident@example.org');
    await user.click(screen.getByRole('button', { name: 'Do not message me overnight' }));
    await user.click(screen.getByRole('button', { name: 'Turn on alerts' }));
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));
    const [ref, data] = mockSetDoc.mock.calls[0];
    expect(ref).toBe('alert_subscriptions/device-1');
    expect(data).toMatchObject({
      municipalities: ['Clairton'],
      threshold: 'unhealthy',
      channels: ['email'],
      contact: { email: 'resident@example.org' },
      quiet_hours: { start: '22:00', end: '07:00' },
      created_at: 'SERVER_TIME',
      updated_at: 'SERVER_TIME',
    });
    expect(Object.keys(data.contact)).toEqual(['email']);
    expect(await screen.findByRole('status')).toHaveTextContent(/Alerts saved/);
  });

  it('hides SMS unless the feature flag is on', () => {
    render(<AlertsView />);
    expect(screen.queryByRole('button', { name: 'Text message' })).not.toBeInTheDocument();
  });
});
