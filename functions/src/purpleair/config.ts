/**
 * PurpleAir polling configuration for the Mon Valley.
 *
 * To widen or move the coverage area, change BOUNDING_BOX here and redeploy
 * functions. Coordinates are decimal degrees; nw is the north-west corner and
 * se the south-east corner, matching PurpleAir's query parameters.
 */

export const PURPLEAIR_SENSORS_URL = "https://api.purpleair.com/v1/sensors";

/**
 * Focused on the three Mon Valley Works mills (Clairton Coke Works, Irvin
 * Works, Edgar Thomson) while still containing every municipality centroid
 * in config/municipalities. Sized in Sept 2026 to about 55 sensors, of which
 * about 40 pass the exclusion rules. Widening it toward Pittsburgh roughly
 * triples API point usage.
 */
export const BOUNDING_BOX = {
  nwlat: 40.425,
  nwlng: -79.95,
  selat: 40.255,
  selng: -79.795,
} as const;

/**
 * Sensor documents not refreshed for this long are deleted. A sensor stops
 * being refreshed when it leaves the bounding box or is removed from
 * PurpleAir; sensors that are merely offline keep being returned by the API
 * and are flagged `stale` instead.
 */
export const PRUNE_UNPOLLED_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Fields requested from PurpleAir. `sensor_index` is always returned first
 * by the API whether or not it is requested. Keep this list tight: every
 * field costs API points per sensor per request.
 */
export const REQUESTED_FIELDS = [
  "name",
  "latitude",
  "longitude",
  "location_type",
  "last_seen",
  "confidence",
  "humidity",
  "temperature",
  "pm2.5_cf_1",
  "pm2.5_atm",
  "pm2.5_10minute",
  "pm2.5_60minute",
  "pm2.5_24hour",
] as const;

export type RequestedField = (typeof REQUESTED_FIELDS)[number];

/** How often pollPurpleAir runs. Keep in sync with `schedule` in poll.ts. */
export const POLL_INTERVAL_MINUTES = 60;

/** Exclusion thresholds for public averages. Sensors are stored regardless. */
export const EXCLUSION = {
  minConfidence: 70,
  /** PurpleAir location_type: 0 = outside, 1 = inside. */
  indoorLocationType: 1,
  /** A sensor silent for longer than this is flagged `stale`. */
  maxAgeSeconds: 2 * 60 * 60,
} as const;

/** Reading history retention. Enforced by a Firestore TTL policy on `expires_at`. */
export const READING_RETENTION_DAYS = 30;

/** Retry policy for HTTP 429 responses. */
export const BACKOFF = {
  maxAttempts: 4,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
} as const;

/** Firestore collection names shared with the client and rules. */
export const COLLECTIONS = {
  sensors: "sensors",
  readings: "readings",
  meta: "meta",
} as const;

export const POLL_STATUS_DOC = "purpleair_poll";
