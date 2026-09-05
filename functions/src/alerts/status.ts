/**
 * Per-municipality air quality status: mean corrected PM2.5 of non-excluded
 * sensors within radius_km of the municipality centroid, plus a short
 * history of past polls used for the two-consecutive-polls rule.
 */
import * as admin from "firebase-admin";
import { AqiCategory, pm25ToAqi } from "../lib/aqi";
import { COLLECTIONS as SENSOR_COLLECTIONS } from "../purpleair/config";
import {
  COLLECTIONS,
  CONFIG_COLLECTION,
  DEFAULT_CENTROIDS,
  DEFAULT_RADIUS_KM,
  LatLng,
  MUNICIPALITIES_CONFIG_DOC,
  MunicipalityConfig,
  STATUS_HISTORY_LENGTH,
} from "./config";
import { haversineKm } from "./geo";

export interface SensorForStatus {
  id: string;
  lat: number;
  lng: number;
  pm25_corrected: number | null;
  excluded: boolean;
}

export interface StatusHistoryEntry {
  at: Date;
  pm25_corrected: number | null;
  aqi_category: AqiCategory | null;
}

export interface MunicipalityStatusDoc {
  municipality: string;
  centroid: LatLng;
  radius_km: number;
  pm25_corrected: number | null;
  aqi: number | null;
  aqi_category: AqiCategory | null;
  sensor_count: number;
  sensor_ids: string[];
  computed_at: Date;
  /** Oldest first, newest last. */
  history: StatusHistoryEntry[];
}

/** Pure: compute one municipality's status from the sensor list. */
export function computeStatus(
  municipality: string,
  centroid: LatLng,
  radiusKm: number,
  sensors: SensorForStatus[],
  now: Date,
  previousHistory: StatusHistoryEntry[] = [],
): MunicipalityStatusDoc {
  const nearby = sensors.filter(
    (s) =>
      !s.excluded &&
      s.pm25_corrected != null &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng) &&
      haversineKm(centroid.lat, centroid.lng, s.lat, s.lng) <= radiusKm,
  );
  const mean =
    nearby.length === 0 ? null : Math.round((nearby.reduce((a, s) => a + (s.pm25_corrected as number), 0) / nearby.length) * 10) / 10;
  const aqi = mean == null ? null : pm25ToAqi(mean);
  const entry: StatusHistoryEntry = { at: now, pm25_corrected: mean, aqi_category: aqi?.category ?? null };
  const history = [...previousHistory, entry].slice(-STATUS_HISTORY_LENGTH);
  return {
    municipality,
    centroid,
    radius_km: radiusKm,
    pm25_corrected: mean,
    aqi: aqi?.aqi ?? null,
    aqi_category: aqi?.category ?? null,
    sensor_count: nearby.length,
    sensor_ids: nearby.map((s) => s.id).sort(),
    computed_at: now,
    history,
  };
}

/** Load config/municipalities, seeding it with defaults if absent. */
export async function loadMunicipalityConfig(db: admin.firestore.Firestore): Promise<MunicipalityConfig> {
  const ref = db.collection(CONFIG_COLLECTION).doc(MUNICIPALITIES_CONFIG_DOC);
  const snap = await ref.get();
  if (!snap.exists) {
    const seed: MunicipalityConfig = { centroids: DEFAULT_CENTROIDS, radius_km: DEFAULT_RADIUS_KM };
    await ref.set({ ...seed, seeded_at: new Date(), note: "Edit centroids and radius_km here; no deploy needed." });
    return seed;
  }
  const data = snap.data() as Partial<MunicipalityConfig>;
  return {
    centroids: data.centroids && Object.keys(data.centroids).length > 0 ? data.centroids : DEFAULT_CENTROIDS,
    radius_km: typeof data.radius_km === "number" && data.radius_km > 0 ? data.radius_km : DEFAULT_RADIUS_KM,
  };
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (v && typeof (v as { toDate?: unknown }).toDate === "function") return (v as { toDate: () => Date }).toDate();
  return new Date(0);
}

/** Recompute and persist every municipality's status. Returns the new docs. */
export async function updateMunicipalityStatuses(
  db: admin.firestore.Firestore,
  now: Date = new Date(),
): Promise<MunicipalityStatusDoc[]> {
  const config = await loadMunicipalityConfig(db);
  const sensorSnap = await db.collection(SENSOR_COLLECTIONS.sensors).get();
  const sensors: SensorForStatus[] = sensorSnap.docs.map((d) => {
    const data = d.data();
    return { id: d.id, lat: data.lat, lng: data.lng, pm25_corrected: data.pm25_corrected ?? null, excluded: Boolean(data.excluded) };
  });

  const statusCol = db.collection(COLLECTIONS.status);
  const existing = await statusCol.get();
  const previous = new Map<string, StatusHistoryEntry[]>();
  for (const d of existing.docs) {
    const hist = (d.data().history ?? []) as Array<{ at: unknown; pm25_corrected: number | null; aqi_category: AqiCategory | null }>;
    previous.set(
      d.id,
      hist.map((h) => ({ at: toDate(h.at), pm25_corrected: h.pm25_corrected ?? null, aqi_category: h.aqi_category ?? null })),
    );
  }

  const results: MunicipalityStatusDoc[] = [];
  const batch = db.batch();
  for (const [municipality, centroid] of Object.entries(config.centroids)) {
    const doc = computeStatus(municipality, centroid, config.radius_km, sensors, now, previous.get(municipality) ?? []);
    batch.set(statusCol.doc(municipality), doc);
    results.push(doc);
  }
  await batch.commit();
  return results;
}
