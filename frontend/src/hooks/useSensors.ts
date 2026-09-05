import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { Sensor } from '../types/sensor';

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v === 'object' && v !== null && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  return null;
}

export interface SensorsState {
  sensors: Sensor[];
  loading: boolean;
  error: string | null;
  /** Most recent updated_at across all sensors, i.e. the last successful poll. */
  lastUpdated: Date | null;
}

/**
 * Live view of the `sensors` collection. Subscribes with onSnapshot so the
 * map and dashboard refresh on their own after each 10 minute poll.
 * Pass `initial` to bypass Firestore (used by tests and storybook-style demos).
 */
export function useSensors(initial?: Sensor[]): SensorsState {
  const [sensors, setSensors] = useState<Sensor[]>(initial ?? []);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return undefined;
    if (!db || typeof (db as { type?: unknown }).type !== 'string') {
      // Firebase not initialised (tests). Leave empty rather than crash.
      setLoading(false);
      return undefined;
    }
    const unsubscribe = onSnapshot(
      collection(db, 'sensors'),
      (snap) => {
        const next: Sensor[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            source: (data.source as string) ?? 'unknown',
            source_id: (data.source_id as string) ?? d.id,
            name: (data.name as string) ?? `Sensor ${d.id}`,
            lat: data.lat as number,
            lng: data.lng as number,
            location_type: (data.location_type as number | null) ?? null,
            pollutant: (data.pollutant as string) ?? 'pm25',
            units: (data.units as string) ?? 'ug/m3',
            raw: (data.raw as Sensor['raw']) ?? {},
            pm25_corrected: (data.pm25_corrected as number | null) ?? null,
            correction_model: data.correction_model as string | undefined,
            aqi: (data.aqi as number | null) ?? null,
            aqi_category: (data.aqi_category as Sensor['aqi_category']) ?? null,
            excluded: Boolean(data.excluded),
            exclude_reason: (data.exclude_reason as string | null) ?? null,
            last_seen_at: toDate(data.last_seen_at),
            updated_at: toDate(data.updated_at),
          };
        });
        setSensors(next.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)));
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [initial]);

  const lastUpdated = useMemo(() => {
    let latest: Date | null = null;
    for (const s of sensors) {
      if (s.updated_at && (!latest || s.updated_at > latest)) latest = s.updated_at;
    }
    return latest;
  }, [sensors]);

  return { sensors, loading, error, lastUpdated };
}
