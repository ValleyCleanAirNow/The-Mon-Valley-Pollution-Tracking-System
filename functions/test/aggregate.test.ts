import { summarizeBucket, affectedBuckets, aggregateId, recomputeBucket, MIN_REPORTS_PER_BUCKET } from '../src/reports/aggregate';
import { hourBucketFor, hourBucketStart } from '../src/reports/schema';

jest.mock('firebase-functions/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const NOW = new Date('2026-09-05T14:23:00.000Z');

function report(over: Partial<{ odor: any; symptoms: any; actions: string[]; cause: string }> = {}) {
  return {
    odor: { present: true, types: ['rotten_eggs_sulfur'], intensity: 3 },
    symptoms: { list: ['headache', 'coughing'], severity: 2 },
    actions: ['closed_windows'],
    cause: 'clairton_coke_works',
    ...over,
  };
}

describe('hour buckets', () => {
  it('uses the UTC hour', () => {
    expect(hourBucketFor(NOW)).toBe('2026-09-05T14');
    expect(hourBucketStart('2026-09-05T14').toISOString()).toBe('2026-09-05T14:00:00.000Z');
    expect(aggregateId('Clairton', '2026-09-05T14')).toBe('Clairton_2026-09-05T14');
  });
});

describe('summarizeBucket', () => {
  it('suppresses buckets with fewer than the minimum reports', () => {
    expect(MIN_REPORTS_PER_BUCKET).toBe(3);
    expect(summarizeBucket('Clairton', '2026-09-05T14', [report(), report()], NOW)).toBeNull();
  });

  it('counts reports and ranks symptoms and odors', () => {
    const out = summarizeBucket(
      'Clairton',
      '2026-09-05T14',
      [
        report(),
        report({ symptoms: { list: ['headache'], severity: 4 } }),
        report({ odor: { present: false, types: [], intensity: null }, symptoms: { list: ['none'], severity: null } }),
      ],
      NOW,
    )!;
    expect(out.report_count).toBe(3);
    expect(out.odor_present_count).toBe(2);
    expect(out.top_symptoms[0]).toEqual({ value: 'headache', count: 2 });
    expect(out.top_symptoms.map((t) => t.value)).not.toContain('none');
    expect(out.top_odors).toEqual([{ value: 'rotten_eggs_sulfur', count: 2 }]);
    expect(out.top_causes[0]).toEqual({ value: 'clairton_coke_works', count: 3 });
    expect(out.mean_symptom_severity).toBe(3);
    expect(out.mean_odor_intensity).toBe(3);
    expect(out.hour_start.toISOString()).toBe('2026-09-05T14:00:00.000Z');
  });

  it('never includes uid or free text', () => {
    const out = summarizeBucket('Clairton', '2026-09-05T14', [report(), report(), report()], NOW)!;
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/uid|note|location/);
  });
});

describe('affectedBuckets', () => {
  it('returns one bucket for a create', () => {
    expect(affectedBuckets(undefined, { municipality: 'Clairton', hour_bucket: 'a' })).toEqual([
      { municipality: 'Clairton', hourBucket: 'a' },
    ]);
  });
  it('returns both buckets when a report moves', () => {
    expect(
      affectedBuckets({ municipality: 'Clairton', hour_bucket: 'a' }, { municipality: 'Glassport', hour_bucket: 'a' }),
    ).toHaveLength(2);
  });
  it('dedupes an in-place edit', () => {
    expect(affectedBuckets({ municipality: 'Clairton', hour_bucket: 'a' }, { municipality: 'Clairton', hour_bucket: 'a' })).toHaveLength(1);
  });
});

describe('recomputeBucket', () => {
  function fakeDb(docs: any[]) {
    const ops: string[] = [];
    const query: any = {
      where: () => query,
      get: async () => ({ docs: docs.map((d) => ({ data: () => d })) }),
    };
    const db: any = {
      collection: (name: string) =>
        name === 'reports' ?
          query :
          { doc: (id: string) => ({ set: async () => {
 ops.push(`set ${id}`);
}, delete: async () => {
 ops.push(`delete ${id}`);
} }) },
    };
    return { db, ops };
  }

  it('deletes the aggregate when under the threshold', async () => {
    const { db, ops } = fakeDb([report()]);
    await expect(recomputeBucket(db, 'Clairton', '2026-09-05T14', NOW)).resolves.toBe('suppressed');
    expect(ops).toEqual(['delete Clairton_2026-09-05T14']);
  });

  it('writes the aggregate when at or over the threshold', async () => {
    const { db, ops } = fakeDb([report(), report(), report()]);
    await expect(recomputeBucket(db, 'Clairton', '2026-09-05T14', NOW)).resolves.toBe('written');
    expect(ops).toEqual(['set Clairton_2026-09-05T14']);
  });
});
