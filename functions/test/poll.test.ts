import { runPoll } from '../src/purpleair/poll';
import * as client from '../src/purpleair/client';

jest.mock('firebase-functions/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

/** Minimal in-memory stand-in for the Firestore surface the poller uses. */
function fakeDb() {
  const writes: Array<{ path: string; data: any }> = [];
  const doc = (path: string): any => ({
    path,
    collection: (name: string) => col(`${path}/${name}`),
    set: async (data: any) => {
 writes.push({ path, data });
},
  });
  const col = (path: string): any => ({ doc: (id: string) => doc(`${path}/${id}`) });
  const db: any = {
    collection: (name: string) => col(name),
    batch: () => {
      const ops: Array<{ path: string; data: any }> = [];
      return {
        set: (ref: any, data: any) => ops.push({ path: ref.path, data }),
        commit: async () => {
 writes.push(...ops);
},
      };
    },
  };
  return { db, writes };
}

const NOW = new Date('2026-09-05T12:00:00.000Z');
const nowSec = Math.floor(NOW.getTime() / 1000);

describe('runPoll', () => {
  afterEach(() => jest.restoreAllMocks());

  it('writes a sensor doc, a reading, and a status doc', async () => {
    jest.spyOn(client, 'fetchSensors').mockResolvedValue({
      api_version: 'x', time_stamp: nowSec, data_time_stamp: nowSec,
      fields: ['sensor_index', 'name', 'latitude', 'longitude', 'location_type', 'last_seen', 'confidence', 'humidity', 'temperature', 'pm2.5_cf_1', 'pm2.5_atm', 'pm2.5_10minute', 'pm2.5_60minute', 'pm2.5_24hour'],
      data: [
        [1, 'A', 40.3, -79.9, 0, nowSec - 60, 100, 40, 70, 50, 40, 48, 45, 30],
        [2, 'B', 40.3, -79.9, 1, nowSec - 60, 100, 40, 70, 50, 40, 48, 45, 30],
        [3, null, null, null, 0, nowSec, 100, 40, 70, 1, 1, 1, 1, 1],
      ],
    });
    const { db, writes } = fakeDb();
    const summary = await runPoll(db, 'key', NOW);
    expect(summary.ok).toBe(true);
    expect(summary.fetched).toBe(3);
    expect(summary.written).toBe(2);
    expect(summary.included).toBe(1);
    expect(summary.excluded).toBe(1);
    expect(summary.skipped_rows).toBe(1);
    const paths = writes.map((w) => w.path);
    expect(paths).toContain('sensors/1');
    expect(paths).toContain('sensors/1/readings/2026-09-05T12:00:00.000Z');
    expect(paths).toContain('sensors/2');
    expect(paths).toContain('meta/purpleair_poll');
    const status = writes.find((w) => w.path === 'meta/purpleair_poll')!.data;
    expect(status.last_success_at).toEqual(NOW);
  });

  it('logs and records the error without throwing when the API fails', async () => {
    jest.spyOn(client, 'fetchSensors').mockRejectedValue(new Error('boom'));
    const { db, writes } = fakeDb();
    const summary = await runPoll(db, 'key', NOW);
    expect(summary.ok).toBe(false);
    expect(summary.error).toBe('boom');
    expect(writes.map((w) => w.path)).toEqual(['meta/purpleair_poll']);
    expect(writes[0].data.last_error).toBe('boom');
  });

  it('fails cleanly when the secret is empty', async () => {
    const { db } = fakeDb();
    const summary = await runPoll(db, '', NOW);
    expect(summary.ok).toBe(false);
    expect(summary.error).toMatch(/PURPLEAIR_API_KEY/);
  });
});
