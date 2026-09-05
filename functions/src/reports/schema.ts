/**
 * Shape of a community report (Odor, Symptoms, Actions, suspected Cause).
 * Mirrors frontend/src/types/report.ts. Reports contain no name, email or
 * phone. `uid` is the Firebase Anonymous Auth id of the reporting device.
 */

export const ODOR_TYPES = [
  "rotten_eggs_sulfur",
  "tar_asphalt",
  "burning_smoke",
  "chemical_solvent",
  "metallic",
  "sweet",
  "other",
] as const;

export const SYMPTOMS = [
  "coughing",
  "wheezing",
  "shortness_of_breath",
  "chest_tightness",
  "throat_irritation",
  "eye_irritation",
  "headache",
  "nausea",
  "dizziness",
  "fatigue",
  "none",
  "other",
] as const;

export const ACTIONS = [
  "closed_windows",
  "stayed_inside",
  "used_inhaler_or_medication",
  "ran_air_purifier",
  "left_area",
  "called_achd",
  "none",
  "other",
] as const;

export const CAUSES = [
  "clairton_coke_works",
  "edgar_thomson_works",
  "irvin_works",
  "traffic",
  "other_industry",
  "dont_know",
  "other",
] as const;

export const REPORT_SCHEMA_VERSION = 2;

export interface ReportDoc {
  uid: string;
  schema_version: number;
  odor: {
    present: boolean;
    types: string[];
    intensity: number | null;
  };
  symptoms: {
    list: string[];
    severity: number | null;
  };
  actions: string[];
  cause: string;
  /** When the reporter says it happened. */
  occurred_at: Date;
  /** UTC hour of occurred_at, e.g. "2026-09-05T14". Aggregation key. */
  hour_bucket: string;
  municipality: string;
  /** Device location rounded to 3 decimals (about 100 m), or null. */
  location: { lat: number; lng: number } | null;
  note: string | null;
  created_at: Date;
}

/** UTC hour bucket for a date: "YYYY-MM-DDTHH". */
export function hourBucketFor(date: Date): string {
  return date.toISOString().slice(0, 13);
}

/** Start of the hour a bucket string denotes. */
export function hourBucketStart(bucket: string): Date {
  return new Date(`${bucket}:00:00.000Z`);
}
