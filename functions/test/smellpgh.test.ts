import { AxiosInstance } from 'axios';
import { fetchSmellReports, mapSmellRow, syncSmellReports } from '../src/alerts/smellpgh';
import { pointInPolygon } from '../src/alerts/geo';
import { computeFacilityStatus, DEFAULT_FACILITY_CONFIG } from '../src/alerts/facilities';

jest.mock('firebase-functions/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const NOW = new Date('2026-09-08T15:00:00.000Z');

describe('Smell PGH mapping and fetch', () => {
  it('maps a row, rounds coordinates, clamps rating, trims description', () => {
    const r = mapSmellRow({ latitude: '40.29251234', longitude: '-79.881499', smell_value: 4, observed_at: 1788000000, smell_description: '  sulfur, rotten eggs  ', zipcode: '15025', feelings_symptoms: 'headache' })!;
    expect(r).toMatchObject({ smell_value: 4, lat: 40.293, lng: -79.881, description: 'sulfur, rotten eggs', zipcode: '15025' });
    expect(r.observed_at.getTime()).toBe(1788000000 * 1000);
    expect(JSON.stringify(r)).not.toMatch(/headache/);
    expect(mapSmellRow({ latitude: null, longitude: null, smell_value: 3, observed_at: 1 })).toBeNull();
    expect(mapSmellRow({ latitude: 40, longitude: -79, smell_value: 9, observed_at: 1 })!.smell_value).toBe(5);
  });

  it('queries the API with the Mon Valley bounding box and Allegheny region', async () => {
    const get = jest.fn().mockResolvedValue({ data: [{ latitude: 40.3, longitude: -79.88, smell_value: 3, observed_at: 1788000000 }] });
    const out = await fetchSmellReports(NOW.getTime() - 3600000, NOW.getTime(), { get } as unknown as AxiosInstance);
    expect(out).toHaveLength(1);
    const [url, cfg] = get.mock.calls[0];
    expect(url).toBe('https://api.smellpittsburgh.org/api/v2/smell_reports');
    expect(cfg.params.region_ids).toBe('1');
    expect(cfg.params.latlng_bbox).toBe('40.425,-79.95,40.255,-79.79');
    expect(cfg.params.smell_value).toBe('1,2,3,4,5');
  });

  it('sync writes docs with a 7 day expiry and survives API failure', async () => {
    const writes: Array<{ path: string; data: any }> = [];
    const db: any = {
      collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
      batch: () => {
 const ops: any[] = []; return { set: (ref: any, data: any) => ops.push({ path: ref.path, data }), commit: async () => {
 writes.push(...ops);
} };
},
    };
    const get = jest.fn().mockResolvedValue({ data: [{ latitude: 40.3, longitude: -79.88, smell_value: 3, observed_at: Math.floor(NOW.getTime() / 1000) - 600 }] });
    const reports = await syncSmellReports(db, NOW, { get } as unknown as AxiosInstance);
    expect(reports).toHaveLength(1);
    expect(writes[0].path).toMatch(/^smell_reports\//);
    expect((writes[0].data.expires_at.getTime() - writes[0].data.observed_at.getTime()) / 86400000).toBe(7);
    const bad = jest.fn().mockRejectedValue(new Error('down'));
    expect(await syncSmellReports(db, NOW, { get: bad } as unknown as AxiosInstance)).toEqual([]);
  });
});

describe('risk levels', () => {
  it('point in polygon works on a square', () => {
    const sq = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }, { lat: 0, lng: 0 }];
    expect(pointInPolygon({ lat: 0.5, lng: 0.5 }, sq)).toBe(true);
    expect(pointInPolygon({ lat: 1.5, lng: 0.5 }, sq)).toBe(false);
  });

  it('applies the weighted risk index to a zone: toxicity, stagnant wind, and odor raise the level', () => {
    const facility = { facilityId: 'F', name: 'F', location: { lat: 40.2925, lng: -79.8814 }, permittedPollutants: [{ pollutant: 'PM2.5' }, { pollutant: 'SO2' }, { pollutant: 'NOx' }, { pollutant: 'VOCs' }] };
    const sensors = [{ id: 'a', lat: 40.30, lng: -79.88, pm25_corrected: 20, excluded: false }];
    const inside = (mins: number, value = 4) => ({ id: 'x', smell_value: value, lat: 40.2925, lng: -79.8814, observed_at: new Date(NOW.getTime() - mins * 60000), description: null, zipcode: null });
    // Calm, no odor: 20 * 1.3 * 1.3 = 33.8 -> elevated
    const calm = computeFacilityStatus(facility, sensors, null, DEFAULT_FACILITY_CONFIG, NOW, []);
    expect(calm.risk_inputs).toMatchObject({ pm_cal: 20, w_tox: 1.3, w_wind: 1, odor_score: 0, v_user: 1 });
    expect(calm.risk_score).toBe(26);
    expect(calm.risk_level).toBe('elevated');
    // Three odor reports averaging 4 add 16: 26 + 16 = 42 -> high
    const smelly = computeFacilityStatus(facility, sensors, null, DEFAULT_FACILITY_CONFIG, NOW, [inside(10), inside(20), inside(30)]);
    expect(smelly.smell_reports_in_zone).toBe(3);
    expect(smelly.risk_inputs.odor_score).toBe(4);
    expect(smelly.risk_score).toBe(42);
    expect(smelly.risk_level).toBe('high');
    // Old reports do not count; far reports do not count
    expect(computeFacilityStatus(facility, sensors, null, DEFAULT_FACILITY_CONFIG, NOW, [inside(300)]).smell_reports_in_zone).toBe(0);
    const far = { ...inside(10), lat: 40.4, lng: -79.7 };
    expect(computeFacilityStatus(facility, sensors, null, DEFAULT_FACILITY_CONFIG, NOW, [far]).smell_reports_in_zone).toBe(0);
    // Stagnant wind (2 km/h -> circle zone) uses W_wind 1.24
    const stagnant = computeFacilityStatus(facility, sensors, { from_deg: 90, speed_kmh: 2, observed_at: NOW, station: 'KAGC' }, DEFAULT_FACILITY_CONFIG, NOW, []);
    expect(stagnant.risk_inputs.w_wind).toBe(1.24);
    expect(stagnant.risk_score).toBe(32.2);
  });
});
