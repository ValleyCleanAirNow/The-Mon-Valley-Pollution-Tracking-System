import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Report } from '../types/report';

function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  return null;
}

/** Live list of the current device's own reports, newest first. */
export function useMyReports(uid: string | null, max = 50): { reports: Report[]; error: string | null } {
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid || !db || typeof (db as { type?: unknown }).type !== 'string') {
      setReports([]);
      return undefined;
    }
    const q = query(collection(db, 'reports'), where('uid', '==', uid), orderBy('created_at', 'desc'), limit(max));
    return onSnapshot(
      q,
      (snap) => {
        setReports(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              uid: data.uid,
              schema_version: data.schema_version,
              odor: data.odor,
              symptoms: data.symptoms,
              actions: data.actions ?? [],
              cause: data.cause,
              occurred_at: toDate(data.occurred_at) ?? new Date(0),
              hour_bucket: data.hour_bucket,
              municipality: data.municipality,
              location: data.location ?? null,
              note: data.note ?? null,
              created_at: toDate(data.created_at),
            } as Report;
          }),
        );
        setError(null);
      },
      (err) => setError(err.message),
    );
  }, [uid, max]);

  return { reports, error };
}
