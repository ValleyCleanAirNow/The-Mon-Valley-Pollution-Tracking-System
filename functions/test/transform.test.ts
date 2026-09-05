import { transformRow, exclusionReasons, readingDocId } from '../src/purpleair/transform';
import { rowsToObjects } from '../src/purpleair/client';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const nowSec = Math.floor(NOW.getTime() / 1000);

function row(overrides: Record<string, string | number | null> = {}) {
  return {
    "sensor_index": 12345,
    "name": 'Clairton Test',
    "latitude": 40.29,
    "longitude": -79.88,
    "location_type": 0,
    "last_seen": nowSec - 300,
    "confidence": 100,
    "humidity": 40,
    "temperature": 75,
    'pm2.5_cf_1': 50,
    'pm2.5_atm': 40,
    'pm2.5_10minute': 48,
    'pm2.5_60minute': 45,
    'pm2.5_24hour': 30,
    ...overrides,
  };
}

describe('transformRow', () => {
  it('produces corrected value, AQI and category for a healthy outdoor sensor', () => {
    const t = transformRow(row(), NOW)!;
    expect(t.sensorIndex).toBe('12345');
    expect(t.sensor.pm25_corrected).toBe(28.5);
    expect(t.sensor.aqi).toBe(87);
    expect(t.sensor.aqi_category).toBe('Moderate');
    expect(t.sensor.excluded).toBe(false);
    expect(t.sensor.exclude_reason).toBeNull();
    expect(t.sensor.source).toBe('purpleair');
    expect(t.sensor.pollutant).toBe('pm25');
    expect(t.sensor.units).toBe('ug/m3');
    expect(t.sensor.raw.pm25_cf_1).toBe(50);
    expect(t.sensor.updated_at).toEqual(NOW);
  });

  it('keeps raw fields on the reading and sets a 30 day expiry', () => {
    const t = transformRow(row(), NOW)!;
    expect(t.reading.pm25_cf_1).toBe(50);
    expect(t.reading.polled_at).toEqual(NOW);
    const days = (t.reading.expires_at.getTime() - NOW.getTime()) / 86400000;
    expect(days).toBe(30);
    expect(readingDocId(NOW)).toBe('2026-09-05T12:00:00.000Z');
  });

  it('flags low confidence', () => {
    const t = transformRow(row({ confidence: 69 }), NOW)!;
    expect(t.sensor.excluded).toBe(true);
    expect(t.sensor.exclude_reason).toBe('low_confidence');
  });

  it('flags indoor sensors', () => {
    const t = transformRow(row({ location_type: 1 }), NOW)!;
    expect(t.sensor.exclude_reason).toBe('indoor');
  });

  it('flags sensors not seen for more than two hours', () => {
    const t = transformRow(row({ last_seen: nowSec - 2 * 3600 - 1 }), NOW)!;
    expect(t.sensor.exclude_reason).toBe('stale');
    const fresh = transformRow(row({ last_seen: nowSec - 2 * 3600 + 60 }), NOW)!;
    expect(fresh.sensor.excluded).toBe(false);
  });

  it('flags missing humidity and stores null corrected value instead of zero', () => {
    const t = transformRow(row({ humidity: null }), NOW)!;
    expect(t.sensor.pm25_corrected).toBeNull();
    expect(t.sensor.aqi).toBeNull();
    expect(t.sensor.exclude_reason).toBe('missing_data');
  });

  it('joins multiple reasons', () => {
    const reasons = exclusionReasons(
      { pm25_cf_1: 1, pm25_atm: 1, pm25_10minute: 1, pm25_60minute: 1, pm25_24hour: 1, humidity: 1, temperature: 1, confidence: 10, last_seen: 0 },
      1,
      NOW.getTime(),
    );
    expect(reasons).toEqual(['low_confidence', 'indoor', 'stale']);
  });

  it('drops rows without coordinates or index', () => {
    expect(transformRow(row({ latitude: null }), NOW)).toBeNull();
    expect(transformRow(row({ sensor_index: null }), NOW)).toBeNull();
  });

  it('never stores a field name containing a dot', () => {
    const t = transformRow(row(), NOW)!;
    const keys = [...Object.keys(t.sensor), ...Object.keys(t.sensor.raw), ...Object.keys(t.reading)];
    expect(keys.some((k) => k.includes('.'))).toBe(false);
  });
});

describe('rowsToObjects', () => {
  it('zips fields with rows', () => {
    const out = rowsToObjects({ fields: ['sensor_index', 'name'], data: [[1, 'a'], [2, null]] });
    expect(out).toEqual([{ sensor_index: 1, name: 'a' }, { sensor_index: 2, name: null }]);
  });
});
