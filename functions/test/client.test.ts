import { AxiosInstance } from 'axios';

jest.mock('firebase-functions/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
import { backoffDelayMs, fetchSensors, PurpleAirRateLimitError } from '../src/purpleair/client';

function httpError(status: number, headers: Record<string, string> = {}) {
  return { isAxiosError: true, response: { status, headers }, message: `HTTP ${status}` };
}

describe('backoffDelayMs', () => {
  it('doubles from 2s and caps at 30s', () => {
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(2)).toBe(4000);
    expect(backoffDelayMs(3)).toBe(8000);
    expect(backoffDelayMs(10)).toBe(30000);
  });
  it('honours Retry-After seconds', () => {
    expect(backoffDelayMs(1, '5')).toBe(5000);
    expect(backoffDelayMs(1, '999')).toBe(30000);
  });
});

describe('fetchSensors', () => {
  const sleep = jest.fn(async () => undefined);
  beforeEach(() => sleep.mockClear());

  it('sends the API key header and the bounding box', async () => {
    const get = jest.fn().mockResolvedValue({ data: { fields: [], data: [], data_time_stamp: 1 } });
    const http = { get } as unknown as AxiosInstance;
    await fetchSensors('secret', { http, sleep });
    const [url, cfg] = get.mock.calls[0];
    expect(url).toBe('https://api.purpleair.com/v1/sensors');
    expect(cfg.headers['X-API-Key']).toBe('secret');
    expect(cfg.params).toMatchObject({ nwlat: 40.425, nwlng: -79.95, selat: 40.255, selng: -79.79 });
    expect(cfg.params.fields).toContain('pm2.5_cf_1');
    expect(cfg.params.fields).toContain('humidity');
  });

  it('retries on 429 then succeeds', async () => {
    const get = jest
      .fn()
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(429, { 'retry-after': '1' }))
      .mockResolvedValue({ data: { fields: [], data: [] } });
    const http = { get } as unknown as AxiosInstance;
    await fetchSensors('k', { http, sleep });
    expect(get).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
    expect(sleep).toHaveBeenNthCalledWith(2, 1000);
  });

  it('gives up after max attempts on persistent 429', async () => {
    const get = jest.fn().mockRejectedValue(httpError(429));
    const http = { get } as unknown as AxiosInstance;
    await expect(fetchSensors('k', { http, sleep })).rejects.toBeInstanceOf(PurpleAirRateLimitError);
    expect(get).toHaveBeenCalledTimes(4);
  });

  it('does not retry other errors', async () => {
    const get = jest.fn().mockRejectedValue(httpError(403));
    const http = { get } as unknown as AxiosInstance;
    await expect(fetchSensors('k', { http, sleep })).rejects.toMatchObject({ response: { status: 403 } });
    expect(get).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
