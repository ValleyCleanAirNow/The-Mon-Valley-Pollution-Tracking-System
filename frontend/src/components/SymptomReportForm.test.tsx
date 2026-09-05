import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import SymptomReportForm from './SymptomReportForm';

const mockAddDoc = jest.fn();
jest.mock('firebase/firestore', () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: jest.fn(() => 'reports-ref'),
  serverTimestamp: () => 'SERVER_TIME',
  Timestamp: { fromDate: (d: Date) => ({ toDate: () => d }) },
  onSnapshot: jest.fn(() => () => {}),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
}));
jest.mock('../firebase', () => ({ db: { type: 'firestore' }, auth: {} }));
jest.mock('../hooks/useAnonymousAuth', () => ({
  useAnonymousAuth: () => ({ uid: 'device-123', loading: false, error: null }),
}));
jest.mock('../hooks/useMyReports', () => ({ useMyReports: () => ({ reports: [], error: null }) }));

describe('SymptomReportForm (OSAC)', () => {
  beforeEach(() => mockAddDoc.mockReset());

  it('shows the four OSAC sections and no identity fields', () => {
    render(<SymptomReportForm />);
    expect(screen.getByText('Odor')).toBeInTheDocument();
    expect(screen.getByText('Symptoms')).toBeInTheDocument();
    expect(screen.getByText('What did you do?')).toBeInTheDocument();
    expect(screen.getByText('What do you think caused it?')).toBeInTheDocument();
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/phone/i)).not.toBeInTheDocument();
  });

  it('blocks submission until required answers are given', async () => {
    const user = userEvent.setup();
    render(<SymptomReportForm />);
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/odor/i);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it('submits a report with uid, hour bucket, and no precise address', async () => {
    mockAddDoc.mockResolvedValue({ id: 'r1' });
    const onSuccess = jest.fn();
    const user = userEvent.setup();
    render(<SymptomReportForm onSuccess={onSuccess} />);

    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Rotten eggs / sulfur' }));
    await user.click(screen.getByRole('radiogroup', { name: 'Odor intensity' }).children[3]);
    await user.click(screen.getByRole('button', { name: 'Headache' }));
    await user.click(screen.getByRole('radiogroup', { name: 'Symptom severity' }).children[1]);
    await user.click(screen.getByRole('button', { name: 'Closed windows' }));
    await user.click(screen.getByRole('radio', { name: 'Clairton Coke Works' }));
    await user.selectOptions(screen.getByLabelText('Municipality'), 'Clairton');
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(mockAddDoc).toHaveBeenCalledTimes(1));
    const [, doc] = mockAddDoc.mock.calls[0];
    expect(doc.uid).toBe('device-123');
    expect(doc.schema_version).toBe(2);
    expect(doc.odor).toEqual({ present: true, types: ['rotten_eggs_sulfur'], intensity: 4 });
    expect(doc.symptoms).toEqual({ list: ['headache'], severity: 2 });
    expect(doc.actions).toEqual(['closed_windows']);
    expect(doc.cause).toBe('clairton_coke_works');
    expect(doc.municipality).toBe('Clairton');
    expect(doc.location).toBeNull();
    expect(doc.hour_bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(doc.created_at).toBe('SERVER_TIME');
    expect(Object.keys(doc).sort()).toEqual(
      ['actions', 'cause', 'created_at', 'hour_bucket', 'location', 'municipality', 'note', 'occurred_at', 'odor', 'schema_version', 'symptoms', 'uid'],
    );
    expect(onSuccess).toHaveBeenCalledWith('r1');
    expect(await screen.findByText(/Your report was filed/)).toBeInTheDocument();
  });

  it('makes "No symptoms" exclusive', async () => {
    const user = userEvent.setup();
    render(<SymptomReportForm />);
    await user.click(screen.getByRole('button', { name: 'Headache' }));
    await user.click(screen.getByRole('button', { name: 'No symptoms' }));
    expect(screen.getByRole('button', { name: 'Headache' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'No symptoms' })).toHaveAttribute('aria-pressed', 'true');
  });
});
