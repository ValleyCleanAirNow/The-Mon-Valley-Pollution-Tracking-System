/**
 * Alerting configuration.
 *
 * Municipality centroids live in Firestore at config/municipalities so VCAN
 * can adjust them without a deploy. DEFAULT_CENTROIDS seeds that document
 * the first time the alert engine runs and finds it missing. Coordinates are
 * approximate borough centres (decimal degrees) and should be reviewed by
 * someone who knows the valley; see OPERATIONS.md.
 */
import { Municipality } from "../lib/municipalities";

export interface LatLng {
  lat: number;
  lng: number;
}

export const CONFIG_COLLECTION = "config";
export const MUNICIPALITIES_CONFIG_DOC = "municipalities";

export const DEFAULT_RADIUS_KM = 2;

export const DEFAULT_CENTROIDS: Record<Municipality, LatLng> = {
  "Clairton": { lat: 40.2923, lng: -79.8817 },
  "Glassport": { lat: 40.3248, lng: -79.8920 },
  "Liberty": { lat: 40.3237, lng: -79.8590 },
  "Lincoln": { lat: 40.3003, lng: -79.8553 },
  "Port Vue": { lat: 40.3362, lng: -79.8687 },
  "McKeesport": { lat: 40.3479, lng: -79.8642 },
  "Elizabeth Township": { lat: 40.2700, lng: -79.8100 },
  "Elizabeth Borough": { lat: 40.2695, lng: -79.8887 },
  "Jefferson Hills": { lat: 40.2912, lng: -79.9320 },
  "West Mifflin": { lat: 40.3634, lng: -79.8664 },
  "Dravosburg": { lat: 40.3506, lng: -79.8862 },
  "Duquesne": { lat: 40.3815, lng: -79.8598 },
  "Braddock": { lat: 40.4034, lng: -79.8684 },
  "North Braddock": { lat: 40.3990, lng: -79.8412 },
  "Rankin": { lat: 40.4126, lng: -79.8795 },
  "East Pittsburgh": { lat: 40.3957, lng: -79.8384 },
};

export interface MunicipalityConfig {
  centroids: Record<string, LatLng>;
  radius_km: number;
}

/** Collections used by the alert engine. */
export const COLLECTIONS = {
  status: "municipality_status",
  subscriptions: "alert_subscriptions",
  state: "alert_state",
  log: "alert_log",
} as const;

/** Polls of history kept on each municipality_status document (1 hour). */
export const STATUS_HISTORY_LENGTH = 6;

/** Two consecutive polls (20 minutes) must agree before a message is sent. */
export const CONSECUTIVE_POLLS_REQUIRED = 2;

/** Minimum gap before the same level is re-sent to the same subscriber. */
export const RESEND_AFTER_MS = 3 * 60 * 60 * 1000;

export const LOCAL_TIME_ZONE = "America/New_York";
