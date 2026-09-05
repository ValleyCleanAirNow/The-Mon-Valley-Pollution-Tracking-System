import { runPoll, pruneUnpolledSensors } from '../src/purpleair/poll';
import * as client from '../src/purpleair/client';

jest.mock('firebase-functions/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

/** Minimal in-memory stand-in for the Firestore surface the poller uses. */
function fakeDb() {
  const writes: Array<{ path: string; data: any }> = [];
  const stale: Array<{ path: string; updated_at: Date }> = [];
  const deletes: string[] = [];
  const doc = (path: string): any => ({
    path,
    collection: (name: string) => col(`${path}/${name}`),
    set: async (data: any) => {
      writes.push({ path, data });
    },
  });
  const col = (path: string): any => ({
    doc: (id: string) => doc(`${path}/${id}`),
    where: (_field: string, _op: string, cutoff: Date) => ({
      get: async () => {
        const docs = stale.filter((d) => d.updated_at < cutoff).map((d) => ({ ref: { path: d.path } }));
        return { empty: docs.length === 0, docs };
      },
    }),
  });
  const db: any = {
    collection: (name: string) => col(name),
    batch: () => {
      const ops: Array<{ path: string; data: any }> = [];
      return {
        set: (ref: any, data: any) => ops.push({ path: ref.path, data }),
        delete: (ref: any) => deletes.push(ref.path),
        commit: async () => {
          writes.push(...ops);
        },
      };
    },
  };
  return { db, writes, stale, deletes };
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

  it('prunes sensors not refreshed for more than a day and reports the count', async () => {
    jest.spyOn(client, 'fetchSensors').mockResolvedValue({
      api_version: 'x', time_stamp: nowSec, data_time_stamp: nowSec,
      fields: ['sensor_index', 'name', 'latitude', 'longitude', 'location_type', 'last_seen', 'confidence', 'humidity', 'temperature', 'pm2.5_cf_1', 'pm2.5_atm', 'pm2.5_10minute', 'pm2.5_60minute', 'pm2.5_24hour'],
      data: [[1, 'A', 40.3, -79.9, 0, nowSec - 60, 100, 40, 70, 50, 40, 48, 45, 30]],
    });
    const { db, writes, stale, deletes } = fakeDb();
    stale.push({ path: 'sensors/old', updated_at: new Date(NOW.getTime() - 25 * 3600 * 1000) });
    stale.push({ path: 'sensors/recent', updated_at: new Date(NOW.getTime() - 2 * 3600 * 1000) });
    const summary = await runPoll(db, 'key', NOW);
    expect(summary.ok).toBe(true);
    expect(summary.pruned).toBe(1);
    expect(deletes).toEqual(['sensors/old']);
    expect(writes.find((w) => w.path === 'meta/purpleair_poll')!.data.pruned).toBe(1);
  });

  it('pruneUnpolledSensors returns 0 when nothing is stale', async () => {
    const { db } = fakeDb();
    await expect(pruneUnpolledSensors(db, NOW)).resolves.toBe(0);
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
