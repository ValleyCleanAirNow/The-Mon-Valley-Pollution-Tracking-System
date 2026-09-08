import { AxiosInstance } from 'axios';
import {
  circlePolygon, computeFacilityStatus, DEFAULT_FACILITY_CONFIG, destination, fetchWind, plumeLengthKm, sectorPolygon, updateFacilityStatuses,
} from '../src/alerts/facilities';
import { haversineKm } from '../src/alerts/geo';

jest.mock('firebase-functions/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const NOW = new Date('2026-09-08T14:00:00.000Z');
const CLAIRTON = { facilityId: 'PA-CLAIRTON-001', name: 'U.S. Steel Clairton Coke Works', location: { lat: 40.2925, lng: -79.8814 } };
const cfg = DEFAULT_FACILITY_CONFIG;

describe('geometry', () => {
  it('destination moves the right distance and bearing', () => {
    const p = destination(CLAIRTON.location, 0, 2);
    expect(haversineKm(CLAIRTON.location.lat, CLAIRTON.location.lng, p.lat, p.lng)).toBeCloseTo(2, 2);
    expect(p.lat).toBeGreaterThan(CLAIRTON.location.lat);
    const e = destination(CLAIRTON.location, 90, 2);
    expect(e.lng).toBeGreaterThan(CLAIRTON.location.lng);
  });
  it('circle and sector polygons are closed and sized', () => {
    const c = circlePolygon(CLAIRTON.location, 2);
    expect(c[0]).toEqual(c[c.length - 1]);
    expect(c).toHaveLength(25);
    const s = sectorPolygon(CLAIRTON.location, 90, 30, 4);
    expect(s[0]).toEqual({ lat: 40.2925, lng: -79.8814 });
    expect(s[s.length - 1]).toEqual(s[0]);
    const tip = s[7]; // middle of the arc
    expect(haversineKm(CLAIRTON.location.lat, CLAIRTON.location.lng, tip.lat, tip.lng)).toBeCloseTo(4, 1);
    expect(tip.lng).toBeGreaterThan(CLAIRTON.location.lng); // points east
  });
  it('plume length scales with wind speed within bounds', () => {
    expect(plumeLengthKm(null, cfg)).toBe(2);
    expect(plumeLengthKm(0, cfg)).toBe(2);
    expect(plumeLengthKm(17.5, cfg)).toBe(4);
    expect(plumeLengthKm(60, cfg)).toBe(6);
  });
});

describe('computeFacilityStatus', () => {
  const sensors = [
    { id: 'near1', lat: 40.30, lng: -79.88, pm25_corrected: 40, excluded: false },
    { id: 'near2', lat: 40.31, lng: -79.87, pm25_corrected: 60, excluded: false },
    { id: 'excl', lat: 40.30, lng: -79.88, pm25_corrected: 500, excluded: true },
    { id: 'far', lat: 40.40, lng: -79.86, pm25_corrected: 5, excluded: false },
  ];
  it('averages nearby sensors and shapes a downwind sector', () => {
    const wind = { from_deg: 270, speed_kmh: 20, observed_at: NOW, station: 'KAGC' };
    const s = computeFacilityStatus(CLAIRTON, sensors, wind, cfg, NOW);
    expect(s.sensor_ids).toEqual(['near1', 'near2']);
    expect(s.pm25_corrected).toBe(50);
    expect(s.aqi_category).toBe('Unhealthy for Sensitive Groups');
    expect(s.zone_shape).toBe('sector');
    expect(s.zone_bearing_deg).toBe(90); // wind from the west blows east
    expect(s.zone_length_km).toBeGreaterThan(2);
    expect(s.zone_polygon[0]).toEqual(s.zone_polygon[s.zone_polygon.length - 1]);
  });
  it('falls back to a circle when calm or wind unknown', () => {
    expect(computeFacilityStatus(CLAIRTON, sensors, null, cfg, NOW).zone_shape).toBe('circle');
    const calm = computeFacilityStatus(CLAIRTON, sensors, { from_deg: 10, speed_kmh: 2, observed_at: NOW, station: 'KAGC' }, cfg, NOW);
    expect(calm.zone_shape).toBe('circle');
    expect(calm.zone_bearing_deg).toBeNull();
    expect(calm.zone_length_km).toBe(2);
  });
  it('reports no data when nothing is nearby', () => {
    const s = computeFacilityStatus({ ...CLAIRTON, location: { lat: 40.0, lng: -80.5 } }, sensors, null, cfg, NOW);
    expect(s.sensor_count).toBe(0);
    expect(s.aqi_category).toBeNull();
  });
});

describe('fetchWind', () => {
  it('parses an NWS observation', async () => {
    const get = jest.fn().mockResolvedValue({ data: { properties: { timestamp: '2026-09-08T13:53:00+00:00', windDirection: { value: 250 }, windSpeed: { value: 14.76 } } } });
    const w = await fetchWind('KAGC', { get } as unknown as AxiosInstance);
    expect(w).toEqual({ from_deg: 250, speed_kmh: 14.8, observed_at: new Date('2026-09-08T13:53:00Z'), station: 'KAGC' });
    expect(get.mock.calls[0][0]).toBe('https://api.weather.gov/stations/KAGC/observations/latest');
    expect(get.mock.calls[0][1].headers['User-Agent']).toMatch(/valleycleanair/);
  });
  it('returns null values for missing fields and null on error', async () => {
    const get = jest.fn().mockResolvedValue({ data: { properties: { timestamp: null, windDirection: { value: null }, windSpeed: { value: null } } } });
    expect(await fetchWind('KAGC', { get } as unknown as AxiosInstance)).toEqual({ from_deg: null, speed_kmh: null, observed_at: null, station: 'KAGC' });
    const bad = jest.fn().mockRejectedValue(new Error('timeout'));
    expect(await fetchWind('KAGC', { get: bad } as unknown as AxiosInstance)).toBeNull();
  });
});

describe('updateFacilityStatuses', () => {
  it('seeds config, computes every facility, and writes facility_status', async () => {
    const writes: Array<{ path: string; data: any }> = [];
    const facilities = [CLAIRTON, { facilityId: 'PA-BRADDOCK-001', name: 'Edgar Thomson', location: { lat: 40.4006, lng: -79.8639 } }];
    const db: any = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          path: `${name}/${id}`,
          get: async () => ({ exists: false }),
          set: async (data: any) => {
 writes.push({ path: `${name}/${id}`, data });
},
        }),
        get: async () => ({ docs: name === 'titleVFacilities' ? facilities.map((f) => ({ data: () => f })) : [] }),
      }),
      batch: () => {
        const ops: any[] = [];
        return { set: (ref: any, data: any) => ops.push({ path: ref.path, data }), commit: async () => {
 writes.push(...ops);
} };
      },
    };
    const http = { get: jest.fn().mockRejectedValue(new Error('offline')) } as unknown as AxiosInstance;
    const out = await updateFacilityStatuses(db, NOW, { http, sensors: [{ id: 'a', lat: 40.30, lng: -79.88, pm25_corrected: 12, excluded: false }] });
    expect(out).toHaveLength(2);
    expect(writes.map((w) => w.path)).toEqual(expect.arrayContaining(['config/facilities', 'facility_status/PA-CLAIRTON-001', 'facility_status/PA-BRADDOCK-001']));
    const clairton = writes.find((w) => w.path === 'facility_status/PA-CLAIRTON-001')!.data;
    expect(clairton.aqi_category).toBe('Moderate');
    expect(clairton.zone_shape).toBe('circle');
    expect(clairton.wind).toBeNull();
  });
});
