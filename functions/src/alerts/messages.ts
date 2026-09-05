/**
 * Plain-language alert copy. Every email and SMS carries an unsubscribe line.
 */
import { AqiCategory } from "../lib/aqi";

export const SENDER_NAME = "Valley Clean Air Now";

const ACTION_LINE: Record<AqiCategory, string> = {
  "Good": "Enjoy the outdoors.",
  "Moderate": "Unusually sensitive people may want to limit long outdoor exertion.",
  "Unhealthy for Sensitive Groups": "If you have asthma or COPD, consider staying indoors and running an air purifier.",
  "Unhealthy": "Everyone should limit time outdoors. Keep windows closed and run an air purifier if you have one.",
  "Very Unhealthy": "Avoid outdoor activity. Stay indoors with windows closed and run an air purifier if you have one.",
  "Hazardous": "Stay indoors, keep windows closed, and seek medical care if you have trouble breathing.",
};

export interface MessageCopy {
  subject: string;
  /** Core text without channel-specific footer. */
  body: string;
  /** Short title for push notifications. */
  title: string;
}

function pm25Phrase(pm25: number | null): string {
  return pm25 == null ? "" : ` (PM2.5 about ${Math.round(pm25)})`;
}

export function composeAlert(municipality: string, level: AqiCategory, pm25: number | null): MessageCopy {
  return {
    title: `Air quality alert: ${municipality}`,
    subject: `Air quality in ${municipality} is ${level}`,
    body: `Air quality in ${municipality} is ${level} right now${pm25Phrase(pm25)}. ${ACTION_LINE[level]} From ${SENDER_NAME}.`,
  };
}

export function composeImproving(municipality: string, level: AqiCategory, pm25: number | null): MessageCopy {
  return {
    title: `Air quality improving: ${municipality}`,
    subject: `Air quality in ${municipality} is improving`,
    body: `Air quality in ${municipality} has improved to ${level}${pm25Phrase(pm25)}. It is now below your alert level. From ${SENDER_NAME}.`,
  };
}

export function emailText(copy: MessageCopy, appUrl: string): string {
  return `${copy.body}\n\nTo stop these alerts, open ${appUrl}, go to Alerts, and turn them off.`;
}

export function smsText(copy: MessageCopy): string {
  return `${copy.body} Reply STOP to unsubscribe.`;
}
