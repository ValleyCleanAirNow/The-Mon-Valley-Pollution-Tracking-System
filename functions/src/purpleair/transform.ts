/**
 * Turn a raw PurpleAir row into the generic sensor documents stored in
 * Firestore. The schema is intentionally source-agnostic (`source`,
 * `pollutant`, `units`) so AirNow, Smell PGH, drone and canister data can
 * share the `sensors` collection in later stages.
 */
import { AqiCategory, pm25ToAqi } from "../lib/aqi";
import { CORRECTION_MODEL, correctPm25 } from "../lib/correction";
import { EXCLUSION, READING_RETENTION_DAYS } from "./config";
import type { PurpleAirRow } from "./client";

export type ExcludeReason = "low_confidence" | "indoor" | "stale" | "missing_data";

export interface RawPm25Fields {
  pm25_cf_1: number | null;
  pm25_atm: number | null;
  pm25_10minute: number | null;
  pm25_60minute: number | null;
  pm25_24hour: number | null;
  humidity: number | null;
  temperature: number | null;
  confidence: number | null;
  /** Unix seconds reported by PurpleAir. */
  last_seen: number | null;
}

/** Latest-snapshot document at sensors/{sensorIndex}. */
export interface SensorDoc {
  source: "purpleair";
  source_id: string;
  name: string;
  lat: number;
  lng: number;
  /** 0 outdoor, 1 indoor (PurpleAir convention). */
  location_type: number | null;
  pollutant: "pm25";
  units: "ug/m3";
  raw: RawPm25Fields;
  pm25_corrected: number | null;
  correction_model: string;
  aqi: number | null;
  aqi_category: AqiCategory | null;
  excluded: boolean;
  exclude_reason: string | null;
  /** Unix ms of the sensor's own last_seen, for convenience. */
  last_seen_at: Date | null;
  /** Server time of the poll that produced this snapshot. */
  updated_at: Date;
}

/** History document at sensors/{sensorIndex}/readings/{timestamp}. */
export interface ReadingDoc {
  source: "purpleair";
  pollutant: "pm25";
  units: "ug/m3";
  pm25_cf_1: number | null;
  pm25_atm: number | null;
  humidity: number | null;
  temperature: number | null;
  confidence: number | null;
  pm25_corrected: number | null;
  correction_model: string;
  aqi: number | null;
  aqi_category: AqiCategory | null;
  excluded: boolean;
  exclude_reason: string | null;
  observed_at: Date | null;
  polled_at: Date;
  /** Firestore TTL field. Set the policy on `readings` collection group. */
  expires_at: Date;
}

export interface TransformResult {
  sensorIndex: string;
  sensor: SensorDoc;
  reading: ReadingDoc;
}

function num(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function exclusionReasons(raw: RawPm25Fields, locationType: number | null, nowMs: number): ExcludeReason[] {
  const reasons: ExcludeReason[] = [];
  if (raw.confidence == null || raw.confidence < EXCLUSION.minConfidence) reasons.push("low_confidence");
  if (locationType === EXCLUSION.indoorLocationType) reasons.push("indoor");
  if (raw.last_seen == null || nowMs - raw.last_seen * 1000 > EXCLUSION.maxAgeSeconds * 1000) reasons.push("stale");
  if (raw.pm25_cf_1 == null || raw.humidity == null) reasons.push("missing_data");
  return reasons;
}

/**
 * Transform one API row. Returns null when the row lacks the essentials
 * (sensor_index, coordinates), which would make it unusable on a map.
 */
export function transformRow(row: PurpleAirRow, polledAt: Date): TransformResult | null {
  const sensorIndexRaw = row["sensor_index"];
  const lat = num(row["latitude"]);
  const lng = num(row["longitude"]);
  if (sensorIndexRaw == null || lat == null || lng == null) return null;
  const sensorIndex = String(sensorIndexRaw);

  const raw: RawPm25Fields = {
    pm25_cf_1: num(row["pm2.5_cf_1"]),
    pm25_atm: num(row["pm2.5_atm"]),
    pm25_10minute: num(row["pm2.5_10minute"]),
    pm25_60minute: num(row["pm2.5_60minute"]),
    pm25_24hour: num(row["pm2.5_24hour"]),
    humidity: num(row["humidity"]),
    temperature: num(row["temperature"]),
    confidence: num(row["confidence"]),
    last_seen: num(row["last_seen"]),
  };
  const locationType = num(row["location_type"]);

  const corrected = correctPm25(raw.pm25_cf_1, raw.humidity);
  const roundedCorrected = corrected == null ? null : Math.round(corrected * 10) / 10;
  const aqiResult = roundedCorrected == null ? null : pm25ToAqi(roundedCorrected);

  const reasons = exclusionReasons(raw, locationType, polledAt.getTime());
  const excluded = reasons.length > 0;
  const excludeReason = excluded ? reasons.join(",") : null;

  const lastSeenAt = raw.last_seen == null ? null : new Date(raw.last_seen * 1000);
  const expiresAt = new Date(polledAt.getTime() + READING_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const sensor: SensorDoc = {
    source: "purpleair",
    source_id: sensorIndex,
    name: typeof row["name"] === "string" && row["name"] ? row["name"] : `PurpleAir ${sensorIndex}`,
    lat,
    lng,
    location_type: locationType,
    pollutant: "pm25",
    units: "ug/m3",
    raw,
    pm25_corrected: roundedCorrected,
    correction_model: CORRECTION_MODEL,
    aqi: aqiResult?.aqi ?? null,
    aqi_category: aqiResult?.category ?? null,
    excluded,
    exclude_reason: excludeReason,
    last_seen_at: lastSeenAt,
    updated_at: polledAt,
  };

  const reading: ReadingDoc = {
    source: "purpleair",
    pollutant: "pm25",
    units: "ug/m3",
    pm25_cf_1: raw.pm25_cf_1,
    pm25_atm: raw.pm25_atm,
    humidity: raw.humidity,
    temperature: raw.temperature,
    confidence: raw.confidence,
    pm25_corrected: roundedCorrected,
    correction_model: CORRECTION_MODEL,
    aqi: aqiResult?.aqi ?? null,
    aqi_category: aqiResult?.category ?? null,
    excluded,
    exclude_reason: excludeReason,
    observed_at: lastSeenAt,
    polled_at: polledAt,
    expires_at: expiresAt,
  };

  return { sensorIndex, sensor, reading };
}

/** Reading document id: ISO-8601 of the poll time, sortable lexically. */
export function readingDocId(polledAt: Date): string {
  return polledAt.toISOString();
}
