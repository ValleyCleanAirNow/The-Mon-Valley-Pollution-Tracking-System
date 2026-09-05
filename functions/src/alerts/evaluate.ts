/**
 * Orchestration: after each successful poll, refresh municipality_status,
 * then for every subscription decide and deliver, logging each send.
 */
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { AqiCategory } from "../lib/aqi";
import { COLLECTIONS } from "./config";
import { AlertState, Decision, QuietHours, ThresholdLevel, decide, nextState } from "./decide";
import { Channel, DeliveryResult, Providers, sendEmail, sendPush, sendSms } from "./deliver";
import { composeAlert, composeImproving } from "./messages";
import { MunicipalityStatusDoc, StatusHistoryEntry, updateMunicipalityStatuses } from "./status";

export interface SubscriptionDoc {
  municipalities: string[];
  threshold: ThresholdLevel;
  channels: Channel[];
  contact: { email?: string | null; phone?: string | null; fcm_tokens?: string[] };
  quiet_hours?: QuietHours | null;
}

export interface EvaluationSummary {
  statuses: number;
  subscriptions: number;
  decisions: Array<{ uid: string; municipality: string; action: Decision["action"]; reason?: string }>;
  sends: number;
  failures: number;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (v && typeof (v as { toDate?: unknown }).toDate === "function") return (v as { toDate: () => Date }).toDate();
  return null;
}

function stateId(uid: string, municipality: string): string {
  return `${uid}_${municipality}`;
}

async function loadState(db: admin.firestore.Firestore, uid: string, municipality: string): Promise<AlertState | null> {
  const snap = await db.collection(COLLECTIONS.state).doc(stateId(uid, municipality)).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  return { active: Boolean(d.active), last_level: (d.last_level as AqiCategory) ?? null, last_sent_at: toDate(d.last_sent_at) };
}

async function deliverAll(
  uid: string,
  sub: SubscriptionDoc,
  municipality: string,
  decision: Extract<Decision, { action: "alert" | "improving" }>,
  providers: Providers,
): Promise<DeliveryResult[]> {
  const copy = decision.action === "alert" ?
    composeAlert(municipality, decision.level, decision.pm25) :
    composeImproving(municipality, decision.level, decision.pm25);
  const data = { municipality, level: decision.level, kind: decision.action, uid };
  const results: DeliveryResult[] = [];
  for (const channel of sub.channels ?? []) {
    if (channel === "push") results.push(await sendPush(sub.contact?.fcm_tokens ?? [], copy, data, providers));
    else if (channel === "email") results.push(await sendEmail(sub.contact?.email ?? "", copy, providers));
    else if (channel === "sms") results.push(await sendSms(sub.contact?.phone ?? "", copy, providers));
  }
  return results;
}

/**
 * Run one evaluation cycle. `now` is the poll time. Never throws; provider
 * failures are logged to alert_log with status "failed".
 */
export async function evaluateAlerts(
  db: admin.firestore.Firestore,
  providers: Providers,
  now: Date = new Date(),
  precomputed?: MunicipalityStatusDoc[],
): Promise<EvaluationSummary> {
  const summary: EvaluationSummary = { statuses: 0, subscriptions: 0, decisions: [], sends: 0, failures: 0 };
  const statuses = precomputed ?? (await updateMunicipalityStatuses(db, now));
  summary.statuses = statuses.length;
  const byMunicipality = new Map(statuses.map((s) => [s.municipality, s]));

  const subs = await db.collection(COLLECTIONS.subscriptions).get();
  summary.subscriptions = subs.size;

  for (const subDoc of subs.docs) {
    const uid = subDoc.id;
    const sub = subDoc.data() as SubscriptionDoc;
    if (!sub.threshold || !Array.isArray(sub.municipalities)) continue;
    for (const municipality of sub.municipalities) {
      const status = byMunicipality.get(municipality);
      if (!status) continue;
      const history: StatusHistoryEntry[] = status.history;
      const state = await loadState(db, uid, municipality);
      const decision = decide({ threshold: sub.threshold, history, state, now, quietHours: sub.quiet_hours ?? null });
      summary.decisions.push({ uid, municipality, action: decision.action, ...(decision.action === "none" ? { reason: decision.reason } : {}) });
      if (decision.action === "none") continue;

      const results = await deliverAll(uid, sub, municipality, decision, providers);
      const anySent = results.some((r) => r.status === "sent");
      const batch = db.batch();
      for (const r of results) {
        if (r.status === "skipped") continue;
        if (r.status === "sent") summary.sends++;
        else summary.failures++;
        batch.set(db.collection(COLLECTIONS.log).doc(), {
          uid,
          channel: r.channel,
          kind: decision.action,
          level: decision.level,
          municipality,
          pm25_corrected: decision.pm25,
          timestamp: now,
          status: r.status,
          provider_message_id: r.provider_message_id,
          recipient_count: r.recipient_count,
          error: r.error,
        });
      }
      const invalid = results.flatMap((r) => r.invalid_tokens ?? []);
      if (invalid.length > 0) {
        batch.update(subDoc.ref, { "contact.fcm_tokens": admin.firestore.FieldValue.arrayRemove(...invalid) });
      }
      // Only advance state when at least one channel actually went out, so a
      // provider outage does not silently swallow the alert.
      if (anySent) {
        const ns = nextState(decision, state, now);
        if (ns) batch.set(db.collection(COLLECTIONS.state).doc(stateId(uid, municipality)), { ...ns, updated_at: now });
      }
      await batch.commit();
      logger.info("Alert decision", { uid, municipality, action: decision.action, level: decision.level, sent: anySent });
    }
  }
  return summary;
}
