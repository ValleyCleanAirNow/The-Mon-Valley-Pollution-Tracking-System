import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Aggregate } from '../types/report';

/** Public hourly aggregates since `since`. Small buckets never exist here. */
export function useAggregates(since: Date): { aggregates: Aggregate[]; error: string | null } {
  const [aggregates, setAggregates] = useState<Aggregate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sinceMs = since.getTime();

  useEffect(() => {
    if (!db || typeof (db as { type?: unknown }).type !== 'string') return undefined;
    const q = query(
      collection(db, 'aggregates'),
      where('hour_start', '>=', Timestamp.fromMillis(sinceMs)),
      orderBy('hour_start', 'desc'),
    );
    return onSnapshot(
      q,
      (snap) => {
        setAggregates(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              municipality: data.municipality,
              hour_bucket: data.hour_bucket,
              hour_start: data.hour_start instanceof Timestamp ? data.hour_start.toDate() : null,
              report_count: data.report_count ?? 0,
              odor_present_count: data.odor_present_count ?? 0,
              top_symptoms: data.top_symptoms ?? [],
              top_odors: data.top_odors ?? [],
              top_actions: data.top_actions ?? [],
              top_causes: data.top_causes ?? [],
              mean_symptom_severity: data.mean_symptom_severity ?? null,
              mean_odor_intensity: data.mean_odor_intensity ?? null,
            };
          }),
        );
        setError(null);
      },
      (err) => setError(err.message),
    );
  }, [sinceMs]);

  return { aggregates, error };
}
