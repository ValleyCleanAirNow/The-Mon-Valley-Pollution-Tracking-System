import type { AqiCategory } from '../lib/aqi';

/**
 * Shape of a document in the Firestore `sensors` collection, as written by
 * the pollPurpleAir Cloud Function. Timestamps arrive as Firestore Timestamp
 * objects and are converted to Date by useSensors.
 */
export interface SensorRaw {
  pm25_cf_1: number | null;
  pm25_atm: number | null;
  pm25_10minute: number | null;
  pm25_60minute: number | null;
  pm25_24hour: number | null;
  humidity: number | null;
  temperature: number | null;
  confidence: number | null;
  last_seen: number | null;
}

export interface Sensor {
  /** Firestore document id, the PurpleAir sensor_index. */
  id: string;
  source: string;
  source_id: string;
  name: string;
  lat: number;
  lng: number;
  location_type: number | null;
  pollutant: string;
  units: string;
  raw: Partial<SensorRaw>;
  pm25_corrected: number | null;
  correction_model?: string;
  aqi: number | null;
  aqi_category: AqiCategory | null;
  excluded: boolean;
  exclude_reason: string | null;
  last_seen_at: Date | null;
  updated_at: Date | null;
}
