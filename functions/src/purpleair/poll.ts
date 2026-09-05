/**
 * Scheduled PurpleAir poller.
 *
 * Every hour: fetch sensors in the Mon Valley bounding box, apply the
 * EPA correction and AQI, flag sensors to exclude from public averages, and
 * write the latest snapshot plus a history reading to Firestore.
 *
 * Failure policy: 429 is retried with exponential backoff inside the client.
 * Any other failure is logged, recorded on meta/purpleair_poll, and the run
 * ends normally so the schedule never enters a crash loop.
 */
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { fetchSensors, rowsToObjects } from "./client";
import { COLLECTIONS, POLL_STATUS_DOC, PRUNE_UNPOLLED_AFTER_MS } from "./config";
import { readingDocId, transformRow, TransformResult } from "./transform";

export const purpleAirKey = defineSecret("PURPLEAIR_API_KEY");

/** Firestore batches hold at most 500 writes. Each sensor costs 2. */
const SENSORS_PER_BATCH = 200;

export interface PollSummary {
  polled_at: Date;
  fetched: number;
  written: number;
  included: number;
  excluded: number;
  skipped_rows: number;
  pruned: number;
  data_time_stamp: number | null;
  ok: boolean;
  error: string | null;
}

/**
 * Write transformed sensors in chunked batches. Exported for tests and for
 * reuse by any future backfill script.
 */
export async function writeSensors(db: admin.firestore.Firestore, results: TransformResult[], polledAt: Date): Promise<number> {
  let written = 0;
  const readingId = readingDocId(polledAt);
  for (let i = 0; i < results.length; i += SENSORS_PER_BATCH) {
    const chunk = results.slice(i, i + SENSORS_PER_BATCH);
    const batch = db.batch();
    for (const { sensorIndex, sensor, reading } of chunk) {
      const sensorRef = db.collection(COLLECTIONS.sensors).doc(sensorIndex);
      batch.set(sensorRef, sensor, { merge: false });
      batch.set(sensorRef.collection(COLLECTIONS.readings).doc(readingId), reading);
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

/**
 * Delete sensor documents that have not been refreshed within
 * PRUNE_UNPOLLED_AFTER_MS. Their `readings` subcollection expires on its own
 * through the TTL policy. Returns the number of documents removed.
 */
export async function pruneUnpolledSensors(db: admin.firestore.Firestore, now: Date, maxAgeMs: number = PRUNE_UNPOLLED_AFTER_MS): Promise<number> {
  const cutoff = new Date(now.getTime() - maxAgeMs);
  const snap = await db.collection(COLLECTIONS.sensors).where("updated_at", "<", cutoff).get();
  if (snap.empty) return 0;
  let removed = 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref);
    await batch.commit();
    removed += Math.min(400, snap.docs.length - i);
  }
  return removed;
}

/** One complete poll cycle. Never throws. */
export async function runPoll(db: admin.firestore.Firestore, apiKey: string, now: Date = new Date()): Promise<PollSummary> {
  const summary: PollSummary = {
    polled_at: now,
    fetched: 0,
    written: 0,
    included: 0,
    excluded: 0,
    skipped_rows: 0,
    pruned: 0,
    data_time_stamp: null,
    ok: false,
    error: null,
  };

  try {
    if (!apiKey) throw new Error("PURPLEAIR_API_KEY secret is empty");
    const resp = await fetchSensors(apiKey);
    summary.data_time_stamp = resp.data_time_stamp ?? null;
    const rows = rowsToObjects(resp);
    summary.fetched = rows.length;

    const results: TransformResult[] = [];
    for (const row of rows) {
      const t = transformRow(row, now);
      if (!t) {
        summary.skipped_rows++;
        continue;
      }
      results.push(t);
      if (t.sensor.excluded) summary.excluded++;
      else summary.included++;
    }

    summary.written = await writeSensors(db, results, now);
    summary.ok = true;
    try {
      summary.pruned = await pruneUnpolledSensors(db, now);
      if (summary.pruned > 0) logger.info("Pruned sensors no longer returned by PurpleAir", { pruned: summary.pruned });
    } catch (err) {
      logger.warn("Sensor prune failed; will retry next cycle", { error: err instanceof Error ? err.message : String(err) });
    }
    logger.info("PurpleAir poll complete", { ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    summary.error = message;
    logger.error("PurpleAir poll failed, skipping this cycle", { error: message });
  }

  try {
    await db.collection(COLLECTIONS.meta).doc(POLL_STATUS_DOC).set(
      {
        last_run_at: now,
        ok: summary.ok,
        last_success_at: summary.ok ? now : admin.firestore.FieldValue.delete(),
        ...(summary.ok ? {} : { last_error: summary.error, last_error_at: now }),
        fetched: summary.fetched,
        included: summary.included,
        excluded: summary.excluded,
        pruned: summary.pruned,
        data_time_stamp: summary.data_time_stamp,
      },
      { merge: true },
    );
  } catch (err) {
    logger.error("Failed to write poll status", { error: err instanceof Error ? err.message : String(err) });
  }

  return summary;
}

export const pollPurpleAir = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "America/New_York",
    region: "us-central1",
    secrets: [purpleAirKey],
    timeoutSeconds: 120,
    memory: "256MiB",
    retryCount: 0,
  },
  async () => {
    await runPoll(admin.firestore(), purpleAirKey.value());
  },
);
