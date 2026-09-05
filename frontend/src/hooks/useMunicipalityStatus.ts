import { useEffect, useState } from 'react';
import { collection, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { MunicipalityStatus } from '../types/alerts';

/** Live per-municipality air quality, computed server-side after each poll. */
export function useMunicipalityStatus(): { statuses: Record<string, MunicipalityStatus>; error: string | null } {
  const [statuses, setStatuses] = useState<Record<string, MunicipalityStatus>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db || typeof (db as { type?: unknown }).type !== 'string') return undefined;
    return onSnapshot(
      collection(db, 'municipality_status'),
      (snap) => {
        const next: Record<string, MunicipalityStatus> = {};
        snap.forEach((d) => {
          const data = d.data();
          next[d.id] = {
            municipality: data.municipality ?? d.id,
            pm25_corrected: data.pm25_corrected ?? null,
            aqi: data.aqi ?? null,
            aqi_category: data.aqi_category ?? null,
            sensor_count: data.sensor_count ?? 0,
            computed_at: data.computed_at instanceof Timestamp ? data.computed_at.toDate() : null,
          };
        });
        setStatuses(next);
        setError(null);
      },
      (err) => setError(err.message),
    );
  }, []);

  return { statuses, error };
}
