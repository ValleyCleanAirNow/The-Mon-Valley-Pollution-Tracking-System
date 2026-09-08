import { bubbleRadius, bubblesFromAggregates } from './communityReports';

describe('community report bubbles', () => {
  it('sums hours per municipality and merges top lists', () => {
    const base = { id: '', odor_present_count: 1, top_actions: [], top_causes: [], mean_symptom_severity: null, mean_odor_intensity: null };
    const b = bubblesFromAggregates([
      { ...base, municipality: 'Clairton', hour_bucket: 'a', hour_start: new Date('2026-09-08T10:00:00Z'), report_count: 3, top_symptoms: [{ value: 'headache', count: 2 }], top_odors: [{ value: 'rotten_eggs_sulfur', count: 3 }] },
      { ...base, municipality: 'Clairton', hour_bucket: 'b', hour_start: new Date('2026-09-08T11:00:00Z'), report_count: 4, top_symptoms: [{ value: 'headache', count: 3 }, { value: 'coughing', count: 1 }], top_odors: [] },
      { ...base, municipality: 'Glassport', hour_bucket: 'a', hour_start: null, report_count: 3, top_symptoms: [], top_odors: [] },
    ]);
    const c = b.find((x) => x.municipality === 'Clairton')!;
    expect(c.report_count).toBe(7);
    expect(c.top_symptoms[0]).toEqual({ value: 'headache', count: 5 });
    expect(c.latest_hour?.toISOString()).toBe('2026-09-08T11:00:00.000Z');
    expect(b).toHaveLength(2);
    expect(bubbleRadius(3)).toBeCloseTo(14.9, 1);
    expect(bubbleRadius(1000)).toBe(40);
  });
});
