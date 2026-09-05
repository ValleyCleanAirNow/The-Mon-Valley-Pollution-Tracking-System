/**
 * Runs right after each successful polling cycle: the poller writes
 * meta/purpleair_poll last, and this trigger picks it up. Kept separate from
 * pollPurpleAir so the poller deploys without any provider secrets.
 */
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { defineBoolean, defineSecret, defineString } from "firebase-functions/params";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { COLLECTIONS as SENSOR_COLLECTIONS, POLL_STATUS_DOC } from "../purpleair/config";
import { Providers } from "./deliver";
import { evaluateAlerts } from "./evaluate";

export const sendgridKey = defineSecret("SENDGRID_API_KEY");
export const twilioSid = defineSecret("TWILIO_ACCOUNT_SID");
export const twilioToken = defineSecret("TWILIO_AUTH_TOKEN");
export const twilioFrom = defineSecret("TWILIO_FROM_NUMBER");

/** Non-secret configuration. Set in functions/.env or per-project .env.<id>. */
export const alertFromEmail = defineString("ALERT_FROM_EMAIL", { default: "alerts@valleycleanair.com" });
export const appUrl = defineString("APP_URL", { default: "https://mv-pollution-tracking-system.web.app" });
/** SMS costs money per message. Off unless explicitly enabled. */
export const smsAlertsEnabled = defineBoolean("SMS_ALERTS_ENABLED", { default: false });
/** Log sends without contacting any provider. Used by the emulator smoke test. */
export const alertDryRun = defineBoolean("ALERT_DRY_RUN", { default: false });

export function providersFromParams(): Providers {
  return {
    sendgridKey: sendgridKey.value(),
    fromEmail: alertFromEmail.value(),
    twilioSid: twilioSid.value(),
    twilioToken: twilioToken.value(),
    twilioFrom: twilioFrom.value(),
    smsEnabled: smsAlertsEnabled.value(),
    appUrl: appUrl.value(),
    dryRun: alertDryRun.value(),
  };
}

export const onPollComplete = onDocumentWritten(
  {
    document: `${SENSOR_COLLECTIONS.meta}/${POLL_STATUS_DOC}`,
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 300,
    secrets: [sendgridKey, twilioSid, twilioToken, twilioFrom],
  },
  async (event) => {
    const after = event.data?.after.exists ? event.data.after.data() : undefined;
    if (!after || after.ok !== true) {
      logger.info("Poll status written without success; skipping alert evaluation");
      return;
    }
    const at = after.last_run_at && typeof after.last_run_at.toDate === "function" ? after.last_run_at.toDate() : new Date();
    try {
      const summary = await evaluateAlerts(admin.firestore(), providersFromParams(), at);
      logger.info("Alert evaluation complete", {
        statuses: summary.statuses,
        subscriptions: summary.subscriptions,
        sends: summary.sends,
        failures: summary.failures,
        acted: summary.decisions.filter((d) => d.action !== "none").length,
      });
    } catch (err) {
      logger.error("Alert evaluation failed", { error: err instanceof Error ? err.message : String(err) });
    }
  },
);
