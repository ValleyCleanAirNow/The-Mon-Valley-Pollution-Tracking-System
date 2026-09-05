/**
 * Pure decision logic for one subscriber and one municipality.
 *
 * - Alert when the category has been at or above the subscriber's threshold
 *   on the last two consecutive polls (two hours at the hourly poll cadence).
 * - "Improving" when it has been below the threshold on the last two polls
 *   and an alert is currently active for this subscriber.
 * - Do not re-send the same (or lower) level within RESEND_AFTER_MS unless
 *   the level rises.
 * - Nothing is sent during the subscriber's quiet hours; the condition is
 *   re-evaluated on the next poll, so an ongoing episode is announced once
 *   quiet hours end.
 */
import { AqiCategory, categoryRank } from "../lib/aqi";
import { CONSECUTIVE_POLLS_REQUIRED, LOCAL_TIME_ZONE, RESEND_AFTER_MS } from "./config";
import type { StatusHistoryEntry } from "./status";

export type ThresholdLevel = "usg" | "unhealthy";

export const THRESHOLD_CATEGORY: Record<ThresholdLevel, AqiCategory> = {
  usg: "Unhealthy for Sensitive Groups",
  unhealthy: "Unhealthy",
};

export interface QuietHours {
  /** "HH:mm" local time, inclusive start. */
  start: string;
  /** "HH:mm" local time, exclusive end. May be earlier than start (wraps midnight). */
  end: string;
}

export interface AlertState {
  active: boolean;
  last_level: AqiCategory | null;
  last_sent_at: Date | null;
}

export type Decision =
  | { action: "alert"; level: AqiCategory; pm25: number | null }
  | { action: "improving"; level: AqiCategory; pm25: number | null }
  | { action: "none"; reason: string };

/** Local "HH:mm" for a date in the configured time zone. */
export function localHHmm(date: Date, timeZone: string = LOCAL_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

export function isInQuietHours(now: Date, quiet: QuietHours | null | undefined, timeZone: string = LOCAL_TIME_ZONE): boolean {
  if (!quiet || !quiet.start || !quiet.end || quiet.start === quiet.end) return false;
  const hhmm = localHHmm(now, timeZone);
  if (quiet.start < quiet.end) return hhmm >= quiet.start && hhmm < quiet.end;
  // Wraps midnight, e.g. 22:00 to 07:00.
  return hhmm >= quiet.start || hhmm < quiet.end;
}

export function decide(params: {
  threshold: ThresholdLevel;
  history: StatusHistoryEntry[];
  state: AlertState | null;
  now: Date;
  quietHours?: QuietHours | null;
}): Decision {
  const { threshold, history, state, now, quietHours } = params;
  if (history.length < CONSECUTIVE_POLLS_REQUIRED) return { action: "none", reason: "insufficient_history" };
  const recent = history.slice(-CONSECUTIVE_POLLS_REQUIRED);
  if (recent.some((h) => h.aqi_category == null)) return { action: "none", reason: "no_data" };

  const thresholdRank = categoryRank(THRESHOLD_CATEGORY[threshold]);
  const ranks = recent.map((h) => categoryRank(h.aqi_category as AqiCategory));
  const latest = recent[recent.length - 1];
  const level = latest.aqi_category as AqiCategory;

  const reached = ranks.every((r) => r >= thresholdRank);
  const clear = ranks.every((r) => r < thresholdRank);

  if (reached) {
    if (state?.active && state.last_level) {
      const lastRank = categoryRank(state.last_level);
      const rose = categoryRank(level) > lastRank;
      const sinceLast = state.last_sent_at ? now.getTime() - state.last_sent_at.getTime() : Infinity;
      if (!rose && sinceLast < RESEND_AFTER_MS) return { action: "none", reason: "recently_sent" };
    }
    if (isInQuietHours(now, quietHours)) return { action: "none", reason: "quiet_hours" };
    return { action: "alert", level, pm25: latest.pm25_corrected };
  }

  if (clear && state?.active) {
    if (isInQuietHours(now, quietHours)) return { action: "none", reason: "quiet_hours" };
    return { action: "improving", level, pm25: latest.pm25_corrected };
  }

  return { action: "none", reason: reached ? "unreachable" : "below_threshold_or_unstable" };
}

/** State to persist after acting on a decision. */
export function nextState(decision: Decision, prior: AlertState | null, now: Date): AlertState | null {
  if (decision.action === "alert") return { active: true, last_level: decision.level, last_sent_at: now };
  if (decision.action === "improving") return { active: false, last_level: null, last_sent_at: now };
  return prior;
}
