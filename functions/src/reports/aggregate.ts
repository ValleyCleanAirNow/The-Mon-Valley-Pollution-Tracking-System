/**
 * Hourly per-municipality aggregates of community reports.
 *
 * The public map and dashboard read only `aggregates`, never `reports`.
 * Buckets with fewer than MIN_REPORTS_PER_BUCKET reports are not published
 * at all (the aggregate document is deleted), so a single household cannot
 * be inferred from a lonely data point.
 */
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { hourBucketStart, ReportDoc } from "./schema";

export const MIN_REPORTS_PER_BUCKET = 3;
export const TOP_N = 5;

export const REPORTS_COLLECTION = "reports";
export const AGGREGATES_COLLECTION = "aggregates";

export interface Tally {
  value: string;
  count: number;
}

export interface AggregateDoc {
  municipality: string;
  hour_bucket: string;
  hour_start: Date;
  report_count: number;
  odor_present_count: number;
  top_symptoms: Tally[];
  top_odors: Tally[];
  top_actions: Tally[];
  top_causes: Tally[];
  mean_symptom_severity: number | null;
  mean_odor_intensity: number | null;
  updated_at: Date;
}

export function aggregateId(municipality: string, hourBucket: string): string {
  return `${municipality}_${hourBucket}`;
}

function tally(values: string[]): Tally[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, TOP_N);
}

function mean(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

/**
 * Pure summary of one bucket's reports. Returns null when the bucket must be
 * suppressed. Exported for unit tests.
 */
export function summarizeBucket(
  municipality: string,
  hourBucket: string,
  reports: Array<Pick<ReportDoc, "odor" | "symptoms" | "actions" | "cause">>,
  now: Date,
): AggregateDoc | null {
  if (reports.length < MIN_REPORTS_PER_BUCKET) return null;
  const symptomValues = reports.flatMap((r) => (r.symptoms?.list ?? []).filter((s) => s !== "none"));
  const odorValues = reports.flatMap((r) => (r.odor?.present ? r.odor.types ?? [] : []));
  return {
    municipality,
    hour_bucket: hourBucket,
    hour_start: hourBucketStart(hourBucket),
    report_count: reports.length,
    odor_present_count: reports.filter((r) => r.odor?.present).length,
    top_symptoms: tally(symptomValues),
    top_odors: tally(odorValues),
    top_actions: tally(reports.flatMap((r) => (r.actions ?? []).filter((a) => a !== "none"))),
    top_causes: tally(reports.map((r) => r.cause).filter((c): c is string => typeof c === "string")),
    mean_symptom_severity: mean(reports.map((r) => r.symptoms?.severity)),
    mean_odor_intensity: mean(reports.filter((r) => r.odor?.present).map((r) => r.odor?.intensity)),
    updated_at: now,
  };
}

/** Recompute and persist one bucket from the `reports` collection. */
export async function recomputeBucket(
  db: admin.firestore.Firestore,
  municipality: string,
  hourBucket: string,
  now: Date = new Date(),
): Promise<"written" | "suppressed"> {
  const snap = await db
    .collection(REPORTS_COLLECTION)
    .where("municipality", "==", municipality)
    .where("hour_bucket", "==", hourBucket)
    .get();
  const reports = snap.docs.map((d) => d.data() as ReportDoc);
  const ref = db.collection(AGGREGATES_COLLECTION).doc(aggregateId(municipality, hourBucket));
  const summary = summarizeBucket(municipality, hourBucket, reports, now);
  if (!summary) {
    await ref.delete();
    return "suppressed";
  }
  await ref.set(summary);
  return "written";
}

interface BucketKey {
  municipality: string;
  hourBucket: string;
}

function keyOf(data: Partial<ReportDoc> | undefined): BucketKey | null {
  if (!data || typeof data.municipality !== "string" || typeof data.hour_bucket !== "string") return null;
  return { municipality: data.municipality, hourBucket: data.hour_bucket };
}

/** Buckets touched by a report write: the old and new key when they differ. */
export function affectedBuckets(before: Partial<ReportDoc> | undefined, after: Partial<ReportDoc> | undefined): BucketKey[] {
  const keys = [keyOf(before), keyOf(after)].filter((k): k is BucketKey => k !== null);
  const seen = new Set<string>();
  return keys.filter((k) => {
    const id = aggregateId(k.municipality, k.hourBucket);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Firestore trigger: on any create, update or delete of a report, recompute
 * the affected hourly bucket(s). Errors are logged; Firestore retries the
 * event if retry is enabled on deploy, otherwise the next write self-heals.
 */
export const aggregateReports = onDocumentWritten(
  { document: `${REPORTS_COLLECTION}/{reportId}`, region: "us-central1", memory: "256MiB" },
  async (event) => {
    const before = event.data?.before.exists ? (event.data.before.data() as Partial<ReportDoc>) : undefined;
    const after = event.data?.after.exists ? (event.data.after.data() as Partial<ReportDoc>) : undefined;
    const buckets = affectedBuckets(before, after);
    const db = admin.firestore();
    for (const b of buckets) {
      try {
        const outcome = await recomputeBucket(db, b.municipality, b.hourBucket);
        logger.info("Aggregate recomputed", { ...b, outcome });
      } catch (err) {
        logger.error("Aggregate recompute failed", { ...b, error: err instanceof Error ? err.message : String(err) });
      }
    }
  },
);
