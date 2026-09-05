import type { AqiCategory } from '../lib/aqi';

export type ThresholdLevel = 'usg' | 'unhealthy';
export type Channel = 'push' | 'email' | 'sms';

export interface QuietHours {
  start: string;
  end: string;
}

/** Document at alert_subscriptions/{uid}. Mirrors firestore.rules isValidSubscription. */
export interface AlertSubscription {
  municipalities: string[];
  threshold: ThresholdLevel;
  channels: Channel[];
  contact: { email?: string | null; phone?: string | null; fcm_tokens?: string[] };
  quiet_hours: QuietHours | null;
  created_at: Date | null;
  updated_at: Date | null;
}

/** Document at municipality_status/{municipality}. Public. */
export interface MunicipalityStatus {
  municipality: string;
  pm25_corrected: number | null;
  aqi: number | null;
  aqi_category: AqiCategory | null;
  sensor_count: number;
  computed_at: Date | null;
}

export const THRESHOLD_OPTIONS: Array<{ value: ThresholdLevel; label: string; help: string }> = [
  {
    value: 'usg',
    label: 'Unhealthy for Sensitive Groups or worse',
    help: 'Orange and above. Best if you or someone at home has asthma, COPD, or heart disease, or is a child or older adult.',
  },
  {
    value: 'unhealthy',
    label: 'Unhealthy or worse',
    help: 'Red and above. Fewer alerts; only when everyone should limit time outdoors.',
  },
];
