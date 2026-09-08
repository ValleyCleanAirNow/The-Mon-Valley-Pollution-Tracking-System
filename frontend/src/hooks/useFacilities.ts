import { useEffect, useState } from 'react';
import { collection, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { Facility, FacilityStatus } from '../types/facility';

function isReal(): boolean {
  return !!db && typeof (db as { type?: unknown }).type === 'string';
}

function toDate(v: unknown): Date | null {
  return v instanceof Timestamp ? v.toDate() : v instanceof Date ? v : null;
}

/** Title V facilities plus their hourly status and risk zone, joined by facility id. */
export function useFacilities(initial?: { facilities: Facility[]; statuses: Record<string, FacilityStatus> }): {
  facilities: Facility[];
  statuses: Record<string, FacilityStatus>;
  error: string | null;
} {
  const [facilities, setFacilities] = useState<Facility[]>(initial?.facilities ?? []);
  const [statuses, setStatuses] = useState<Record<string, FacilityStatus>>(initial?.statuses ?? {});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial || !isReal()) return undefined;
    const unsubA = onSnapshot(
      collection(db, 'titleVFacilities'),
      (snap) => {
        setFacilities(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Facility, 'id'>) }))
            .filter((f) => f.location && Number.isFinite(f.location.lat) && Number.isFinite(f.location.lng)),
        );
        setError(null);
      },
      (err) => setError(err.message),
    );
    const unsubB = onSnapshot(
      collection(db, 'facility_status'),
      (snap) => {
        const next: Record<string, FacilityStatus> = {};
        snap.forEach((d) => {
          const data = d.data();
          next[d.id] = {
            facility_id: data.facility_id ?? d.id,
            name: data.name ?? d.id,
            location: data.location,
            radius_km: data.radius_km ?? 3,
            pm25_corrected: data.pm25_corrected ?? null,
            aqi: data.aqi ?? null,
            aqi_category: data.aqi_category ?? null,
            sensor_count: data.sensor_count ?? 0,
            wind: data.wind ? { ...data.wind, observed_at: toDate(data.wind.observed_at) } : null,
            zone_shape: data.zone_shape ?? 'circle',
            zone_length_km: data.zone_length_km ?? 2,
            zone_bearing_deg: data.zone_bearing_deg ?? null,
            zone_polygon: Array.isArray(data.zone_polygon) ? data.zone_polygon : [],
            risk_level: data.risk_level ?? null,
            risk_score: data.risk_score ?? null,
            risk_inputs: data.risk_inputs ?? null,
            smell_reports_in_zone: data.smell_reports_in_zone ?? 0,
            computed_at: toDate(data.computed_at),
          };
        });
        setStatuses(next);
      },
      (err) => setError(err.message),
    );
    return () => {
      unsubA();
      unsubB();
    };
  }, [initial]);

  return { facilities, statuses, error };
}
