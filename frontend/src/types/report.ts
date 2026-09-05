/**
 * Community report (Odor, Symptoms, Actions, suspected Cause).
 * Mirrors functions/src/reports/schema.ts and the validation in firestore.rules.
 * Contains no name, email, or phone. `uid` is the Firebase Anonymous Auth id.
 */

export interface Option {
  value: string;
  label: string;
}

export const ODOR_TYPES: Option[] = [
  { value: 'rotten_eggs_sulfur', label: 'Rotten eggs / sulfur' },
  { value: 'tar_asphalt', label: 'Tar / asphalt' },
  { value: 'burning_smoke', label: 'Burning / smoke' },
  { value: 'chemical_solvent', label: 'Chemical / solvent' },
  { value: 'metallic', label: 'Metallic' },
  { value: 'sweet', label: 'Sweet' },
  { value: 'other', label: 'Other' },
];

export const SYMPTOMS: Option[] = [
  { value: 'coughing', label: 'Coughing' },
  { value: 'wheezing', label: 'Wheezing' },
  { value: 'shortness_of_breath', label: 'Shortness of breath' },
  { value: 'chest_tightness', label: 'Chest tightness' },
  { value: 'throat_irritation', label: 'Throat irritation' },
  { value: 'eye_irritation', label: 'Eye irritation' },
  { value: 'headache', label: 'Headache' },
  { value: 'nausea', label: 'Nausea' },
  { value: 'dizziness', label: 'Dizziness' },
  { value: 'fatigue', label: 'Fatigue' },
  { value: 'none', label: 'No symptoms' },
  { value: 'other', label: 'Other' },
];

export const ACTIONS: Option[] = [
  { value: 'closed_windows', label: 'Closed windows' },
  { value: 'stayed_inside', label: 'Stayed inside' },
  { value: 'used_inhaler_or_medication', label: 'Used inhaler or medication' },
  { value: 'ran_air_purifier', label: 'Ran air purifier' },
  { value: 'left_area', label: 'Left the area' },
  { value: 'called_achd', label: 'Called ACHD' },
  { value: 'none', label: 'Nothing' },
  { value: 'other', label: 'Other' },
];

export const CAUSES: Option[] = [
  { value: 'clairton_coke_works', label: 'Clairton Coke Works' },
  { value: 'edgar_thomson_works', label: 'Edgar Thomson Works' },
  { value: 'irvin_works', label: 'Irvin Works' },
  { value: 'traffic', label: 'Traffic' },
  { value: 'other_industry', label: 'Other industry' },
  { value: 'dont_know', label: "Don't know" },
  { value: 'other', label: 'Other' },
];

export const REPORT_SCHEMA_VERSION = 2;

export interface ReportInput {
  odor: { present: boolean; types: string[]; intensity: number | null };
  symptoms: { list: string[]; severity: number | null };
  actions: string[];
  cause: string;
  occurred_at: Date;
  municipality: string;
  location: { lat: number; lng: number } | null;
  note: string | null;
}

export interface Report extends ReportInput {
  id: string;
  uid: string;
  schema_version: number;
  hour_bucket: string;
  created_at: Date | null;
}

export interface Tally {
  value: string;
  count: number;
}

/** Document in the public `aggregates` collection. */
export interface Aggregate {
  id: string;
  municipality: string;
  hour_bucket: string;
  hour_start: Date | null;
  report_count: number;
  odor_present_count: number;
  top_symptoms: Tally[];
  top_odors: Tally[];
  top_actions: Tally[];
  top_causes: Tally[];
  mean_symptom_severity: number | null;
  mean_odor_intensity: number | null;
}

export function labelFor(options: Option[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** UTC hour bucket, "YYYY-MM-DDTHH". Must match functions/src/reports/schema.ts. */
export function hourBucketFor(date: Date): string {
  return date.toISOString().slice(0, 13);
}

/** Round a coordinate to 3 decimals (about 100 m). Never store more precision. */
export function roundCoord(v: number): number {
  return Math.round(v * 1000) / 1000;
}
