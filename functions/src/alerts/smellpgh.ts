/**
 * Smell PGH (CMU CREATE Lab) crowdsourced odor reports.
 * API: https://github.com/CMU-CREATE-Lab/smell-pittsburgh-rails/wiki/Smell-PGH-API
 * Public, no key. Synced hourly with the poll into `smell_reports`, kept 7
 * days by TTL. Coordinates are rounded to 3 decimals; only the odor rating,
 * time and the public smell description are stored.
 */
import * as admin from "firebase-admin";
import axios, { AxiosInstance } from "axios";
import * as logger from "firebase-functions/logger";
import { BOUNDING_BOX } from "../purpleair/config";

export const SMELL_COLLECTION = "smell_reports";
export const SMELL_API_URL = "https://api.smellpittsburgh.org/api/v2/smell_reports";
export const SMELL_LOOKBACK_HOURS = 24;
export const SMELL_RETENTION_DAYS = 7;

export interface SmellReport {
  id: string;
  /** 1 (just fine) to 5 (about as bad as it gets). */
  smell_value: number;
  lat: number;
  lng: number;
  observed_at: Date;
  description: string | null;
  zipcode: string | null;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Map one API row; null when it lacks a rating or coordinates. */
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function mapSmellRow(row: Record<string, unknown>): SmellReport | null {
  const lat = num(row.latitude);
  const lng = num(row.longitude);
  const value = num(row.smell_value);
  const at = num(row.observed_at);
  if (lat == null || lng == null || value == null || at == null) return null;
  const desc = typeof row.smell_description === "string" ? row.smell_description.trim().slice(0, 200) : "";
  return {
    id: `${at}-${round3(lat)}-${round3(lng)}`.replace(/[^0-9A-Za-z_.-]/g, "_"),
    smell_value: Math.max(1, Math.min(5, Math.round(value))),
    lat: round3(lat),
    lng: round3(lng),
    observed_at: new Date(at * 1000),
    description: desc || null,
    zipcode: typeof row.zipcode === "string" ? row.zipcode : null,
  };
}

export async function fetchSmellReports(
  sinceMs: number,
  untilMs: number,
  http: AxiosInstance = axios.create({ timeout: 15000 }),
  bbox: typeof BOUNDING_BOX = BOUNDING_BOX,
): Promise<SmellReport[]> {
  const res = await http.get(SMELL_API_URL, {
    params: {
      smell_value: "1,2,3,4,5",
      start_time: Math.floor(sinceMs / 1000),
      end_time: Math.floor(untilMs / 1000),
      region_ids: "1",
      latlng_bbox: `${bbox.nwlat},${bbox.nwlng},${bbox.selat},${bbox.selng}`,
    },
    headers: { Accept: "application/json" },
  });
  const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
  return rows.map(mapSmellRow).filter((r): r is SmellReport => r !== null);
}

/** Fetch the last 24 hours and upsert. Returns what was fetched; [] on failure. */
export async function syncSmellReports(db: admin.firestore.Firestore, now: Date, http?: AxiosInstance): Promise<SmellReport[]> {
  try {
    const since = now.getTime() - SMELL_LOOKBACK_HOURS * 3600 * 1000;
    const reports = await fetchSmellReports(since, now.getTime(), http);
    for (let i = 0; i < reports.length; i += 400) {
      const batch = db.batch();
      for (const r of reports.slice(i, i + 400)) {
        batch.set(db.collection(SMELL_COLLECTION).doc(r.id), {
          source: "smellpgh",
          smell_value: r.smell_value,
          lat: r.lat,
          lng: r.lng,
          observed_at: r.observed_at,
          description: r.description,
          zipcode: r.zipcode,
          synced_at: now,
          expires_at: new Date(r.observed_at.getTime() + SMELL_RETENTION_DAYS * 86400 * 1000),
        });
      }
      await batch.commit();
    }
    logger.info("Smell PGH sync complete", { fetched: reports.length });
    return reports;
  } catch (err) {
    logger.warn("Smell PGH sync failed; continuing without odor reports", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
