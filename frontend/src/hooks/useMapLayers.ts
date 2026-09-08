import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { DistributionSite, SmellReport } from '../types/layers';

function isReal(): boolean {
  return !!db && typeof (db as { type?: unknown }).type === 'string';
}

/** Smell PGH reports from the last 24 hours, newest first. */
export function useSmellReports(initial?: SmellReport[]): SmellReport[] {
  const [reports, setReports] = useState<SmellReport[]>(initial ?? []);
  useEffect(() => {
    if (initial || !isReal()) return undefined;
    const since = Timestamp.fromMillis(Date.now() - 24 * 3600 * 1000);
    const q = query(collection(db, 'smell_reports'), where('observed_at', '>=', since), orderBy('observed_at', 'desc'));
    return onSnapshot(q, (snap) => {
      setReports(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            smell_value: x.smell_value ?? 1,
            lat: x.lat,
            lng: x.lng,
            observed_at: x.observed_at instanceof Timestamp ? x.observed_at.toDate() : null,
            description: x.description ?? null,
          };
        }),
      );
    }, () => setReports([]));
  }, [initial]);
  return reports;
}

/** VCAN distribution sites. */
export function useDistributions(initial?: DistributionSite[]): DistributionSite[] {
  const [sites, setSites] = useState<DistributionSite[]>(initial ?? []);
  useEffect(() => {
    if (initial || !isReal()) return undefined;
    return onSnapshot(collection(db, 'vcan_distributions'), (snap) => {
      setSites(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<DistributionSite, 'id'>) }))
          .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)),
      );
    }, () => setSites([]));
  }, [initial]);
  return sites;
}
