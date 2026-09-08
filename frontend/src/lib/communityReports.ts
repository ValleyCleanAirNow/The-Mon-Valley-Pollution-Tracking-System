import type { Aggregate, Tally } from '../types/report';

/** One bubble per municipality: reports in the window, merged top lists. */
export interface CommunityBubble {
  municipality: string;
  report_count: number;
  odor_present_count: number;
  top_symptoms: Tally[];
  top_odors: Tally[];
  latest_hour: Date | null;
}

function merge(lists: Tally[][]): Tally[] {
  const m = new Map<string, number>();
  for (const l of lists) for (const t of l) m.set(t.value, (m.get(t.value) ?? 0) + t.count);
  return Array.from(m.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 3);
}

/** Group hourly aggregates (already suppressed below 3 per hour) by municipality. */
export function bubblesFromAggregates(aggregates: Aggregate[]): CommunityBubble[] {
  const by = new Map<string, Aggregate[]>();
  for (const a of aggregates) by.set(a.municipality, [...(by.get(a.municipality) ?? []), a]);
  return Array.from(by.entries()).map(([municipality, list]) => ({
    municipality,
    report_count: list.reduce((n, a) => n + a.report_count, 0),
    odor_present_count: list.reduce((n, a) => n + a.odor_present_count, 0),
    top_symptoms: merge(list.map((a) => a.top_symptoms)),
    top_odors: merge(list.map((a) => a.top_odors)),
    latest_hour: list.reduce<Date | null>((d, a) => (a.hour_start && (!d || a.hour_start > d) ? a.hour_start : d), null),
  }));
}

/** Marker radius in pixels: 12 for 3 reports, growing gently. */
export function bubbleRadius(count: number): number {
  return Math.min(40, 8 + 4 * Math.sqrt(count));
}
