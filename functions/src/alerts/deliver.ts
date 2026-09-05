/**
 * Delivery adapters: Firebase Cloud Messaging, SendGrid email, Twilio SMS.
 * All provider credentials come from Secret Manager. Each adapter returns a
 * result that is written to alert_log; nothing here throws.
 */
import * as admin from "firebase-admin";
import axios, { AxiosInstance } from "axios";
import { MessageCopy, emailText, smsText } from "./messages";

export type Channel = "push" | "email" | "sms";

export interface DeliveryResult {
  channel: Channel;
  status: "sent" | "failed" | "skipped";
  provider_message_id: string | null;
  recipient_count: number;
  error: string | null;
  /** FCM tokens the provider reported as dead; caller should prune them. */
  invalid_tokens?: string[];
}

export interface Providers {
  sendgridKey: string;
  fromEmail: string;
  twilioSid: string;
  twilioToken: string;
  twilioFrom: string;
  smsEnabled: boolean;
  appUrl: string;
  /** When true, nothing is sent; results are logged as sent with id "dry-run". */
  dryRun: boolean;
  http?: AxiosInstance;
  messaging?: Pick<admin.messaging.Messaging, "sendEachForMulticast">;
}

function errMessage(err: unknown): string {
  const e = err as { response?: { status?: number; data?: unknown }; message?: string };
  if (e.response?.status) return `HTTP ${e.response.status}: ${JSON.stringify(e.response.data).slice(0, 200)}`;
  return e.message ?? String(err);
}

export async function sendPush(tokens: string[], copy: MessageCopy, data: Record<string, string>, p: Providers): Promise<DeliveryResult> {
  const base: DeliveryResult = { channel: "push", status: "skipped", provider_message_id: null, recipient_count: tokens.length, error: null };
  if (tokens.length === 0) return { ...base, error: "no_tokens" };
  if (p.dryRun) return { ...base, status: "sent", provider_message_id: "dry-run" };
  try {
    const messaging = p.messaging ?? admin.messaging();
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: copy.title, body: copy.body },
      data,
      webpush: { fcmOptions: { link: p.appUrl } },
    });
    const invalid: string[] = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code ?? "";
      if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) invalid.push(tokens[i]);
    });
    const firstId = res.responses.find((r) => r.success)?.messageId ?? null;
    return {
      ...base,
      status: res.successCount > 0 ? "sent" : "failed",
      provider_message_id: firstId,
      error: res.failureCount > 0 ? `${res.failureCount} of ${tokens.length} failed` : null,
      invalid_tokens: invalid,
    };
  } catch (err) {
    return { ...base, status: "failed", error: errMessage(err) };
  }
}

export async function sendEmail(to: string, copy: MessageCopy, p: Providers): Promise<DeliveryResult> {
  const base: DeliveryResult = { channel: "email", status: "skipped", provider_message_id: null, recipient_count: 1, error: null };
  if (!to) return { ...base, error: "no_email" };
  if (p.dryRun) return { ...base, status: "sent", provider_message_id: "dry-run" };
  if (!p.sendgridKey) return { ...base, status: "failed", error: "SENDGRID_API_KEY not configured" };
  try {
    const http = p.http ?? axios.create({ timeout: 15000 });
    const res = await http.post(
      "https://api.sendgrid.com/v3/mail/send",
      {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: p.fromEmail, name: "Valley Clean Air Now" },
        subject: copy.subject,
        content: [{ type: "text/plain", value: emailText(copy, p.appUrl) }],
      },
      { headers: { "Authorization": `Bearer ${p.sendgridKey}`, "Content-Type": "application/json" } },
    );
    const id = (res.headers?.["x-message-id"] as string | undefined) ?? null;
    return { ...base, status: "sent", provider_message_id: id };
  } catch (err) {
    return { ...base, status: "failed", error: errMessage(err) };
  }
}

export async function sendSms(to: string, copy: MessageCopy, p: Providers): Promise<DeliveryResult> {
  const base: DeliveryResult = { channel: "sms", status: "skipped", provider_message_id: null, recipient_count: 1, error: null };
  if (!p.smsEnabled) return { ...base, error: "sms_disabled" };
  if (!to) return { ...base, error: "no_phone" };
  if (p.dryRun) return { ...base, status: "sent", provider_message_id: "dry-run" };
  if (!p.twilioSid || !p.twilioToken || !p.twilioFrom) return { ...base, status: "failed", error: "Twilio secrets not configured" };
  try {
    const http = p.http ?? axios.create({ timeout: 15000 });
    const form = new URLSearchParams({ To: to, From: p.twilioFrom, Body: smsText(copy) });
    const res = await http.post(`https://api.twilio.com/2010-04-01/Accounts/${p.twilioSid}/Messages.json`, form.toString(), {
      auth: { username: p.twilioSid, password: p.twilioToken },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return { ...base, status: "sent", provider_message_id: res.data?.sid ?? null };
  } catch (err) {
    return { ...base, status: "failed", error: errMessage(err) };
  }
}
