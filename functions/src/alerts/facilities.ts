/**
 * Facility risk zones.
 *
 * For each Title V facility in `titleVFacilities`, after every poll:
 *  - average the corrected PM2.5 of non-excluded sensors within `radius_km`
 *    of the facility and derive the AQI category;
 *  - read the latest wind observation from the National Weather Service
 *    (free, no key) at the configured station;
 *  - build a "risk zone": the sector downwind of the facility, sized by wind
 *    speed, or a plain circle when the wind is calm or unknown.
 *
 * The zone is a plain-language "where the plant's air is most likely going
 * right now", not a dispersion model. Its colour is the measured category of
 * the sensors around the facility, so it never claims more than the sensors
 * show. Persisted to facility_status/{facilityId}; public read.
 */
import * as admin from "firebase-admin";
import axios, { AxiosInstance } from "axios";
import * as logger from "firebase-functions/logger";
import { AqiCategory, pm25ToAqi } from "../lib/aqi";
import { COLLECTIONS as SENSOR_COLLECTIONS } from "../purpleair/config";
import { CONFIG_COLLECTION, LatLng } from "./config";
import { haversineKm, pointInPolygon } from "./geo";
import type { SmellReport } from "./smellpgh";
import { computeRisk, RiskLevel, RiskInputs, toxicityWeight, windWeight } from "../lib/risk";
import type { SensorForStatus } from "./status";

export const FACILITIES_COLLECTION = "titleVFacilities";
export const FACILITY_STATUS_COLLECTION = "facility_status";
export const FACILITIES_CONFIG_DOC = "facilities";

export interface FacilityConfig {
  /** Sensors within this distance of the facility feed its status. */
  radius_km: number;
  /** NWS station id for wind. KAGC is Allegheny County Airport, West Mifflin. */
  wind_station: string;
  /** Half of the plume sector's angular width, degrees. */
  plume_half_angle_deg: number;
  /** Plume length at calm and at strong wind, km. */
  plume_min_km: number;
  plume_max_km: number;
  /** Wind below this is treated as calm: a circle instead of a sector. */
  calm_below_kmh: number;
}

export const DEFAULT_FACILITY_CONFIG: FacilityConfig = {
  radius_km: 3,
  wind_station: "KAGC",
  plume_half_angle_deg: 30,
  plume_min_km: 2,
  plume_max_km: 6,
  calm_below_kmh: 5,
};

export interface WindObservation {
  /** Direction the wind blows FROM, degrees true. */
  from_deg: number | null;
  speed_kmh: number | null;
  observed_at: Date | null;
  station: string;
}

export interface FacilityDoc {
  facilityId: string;
  name: string;
  operator?: string;
  location: LatLng & { city?: string };
  permittedPollutants?: Array<{ pollutant?: string }>;
  /** Optional manual override of W_tox (1.0 to 1.5). */
  toxicity_weight?: number | null;
}

/** Odor reports rated 3+ inside the zone within this window feed Odor_score. */
export const SMELL_WINDOW_HOURS = 3;
export const SMELL_ESCALATION_MIN = 3;
export const SMELL_ESCALATION_HOURS = SMELL_WINDOW_HOURS;

export interface FacilityStatusDoc {
  facility_id: string;
  name: string;
  location: LatLng;
  radius_km: number;
  pm25_corrected: number | null;
  aqi: number | null;
  aqi_category: AqiCategory | null;
  sensor_count: number;
  sensor_ids: string[];
  wind: WindObservation | null;
  /** "sector" when wind-shaped, "circle" when calm or unknown. */
  zone_shape: "sector" | "circle";
  zone_length_km: number;
  /** Direction the zone points TOWARD (downwind), degrees, null for circle. */
  zone_bearing_deg: number | null;
  /** Closed polygon, first point repeated last. */
  zone_polygon: LatLng[];
  /** VCAN Weighted Risk Index with V_user = 1. */
  risk_level: RiskLevel | null;
  risk_score: number | null;
  risk_inputs: RiskInputs;
  /** Odor reports inside the zone in the last SMELL_WINDOW_HOURS (any rating). */
  smell_reports_in_zone: number;
  computed_at: Date;
}

/** Destination point from start along a bearing (degrees) for distance km. */
export function destination(start: LatLng, bearingDeg: number, distanceKm: number): LatLng {
  const R = 6371.0088;
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (start.lat * Math.PI) / 180;
  const lng1 = (start.lng * Math.PI) / 180;
  const d = distanceKm / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: round6((lat2 * 180) / Math.PI), lng: round6((lng2 * 180) / Math.PI) };
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Plume length grows linearly with wind speed between the configured bounds. */
export function plumeLengthKm(speedKmh: number | null, cfg: FacilityConfig): number {
  if (speedKmh == null || !Number.isFinite(speedKmh)) return cfg.plume_min_km;
  const t = Math.max(0, Math.min(1, (speedKmh - cfg.calm_below_kmh) / (30 - cfg.calm_below_kmh)));
  return Math.round((cfg.plume_min_km + t * (cfg.plume_max_km - cfg.plume_min_km)) * 10) / 10;
}

/** Circle polygon (closed) of the given radius. */
export function circlePolygon(center: LatLng, radiusKm: number, points = 24): LatLng[] {
  const ring: LatLng[] = [];
  for (let i = 0; i < points; i++) ring.push(destination(center, (360 * i) / points, radiusKm));
  ring.push(ring[0]);
  return ring;
}

/** Downwind sector polygon (closed): apex at the facility, arc at lengthKm. */
export function sectorPolygon(center: LatLng, bearingDeg: number, halfAngleDeg: number, lengthKm: number, arcPoints = 12): LatLng[] {
  const ring: LatLng[] = [{ lat: center.lat, lng: center.lng }];
  for (let i = 0; i <= arcPoints; i++) {
    const b = bearingDeg - halfAngleDeg + (2 * halfAngleDeg * i) / arcPoints;
    ring.push(destination(center, (b + 360) % 360, lengthKm));
  }
  ring.push(ring[0]);
  return ring;
}

/** Pure: status and zone for one facility. */
export function computeFacilityStatus(
  facility: FacilityDoc,
  sensors: SensorForStatus[],
  wind: WindObservation | null,
  cfg: FacilityConfig,
  now: Date,
  smellReports: SmellReport[] = [],
): FacilityStatusDoc {
  const loc = { lat: facility.location.lat, lng: facility.location.lng };
  const nearby = sensors.filter(
    (s) => !s.excluded && s.pm25_corrected != null && haversineKm(loc.lat, loc.lng, s.lat, s.lng) <= cfg.radius_km,
  );
  const mean = nearby.length === 0 ? null : Math.round((nearby.reduce((a, s) => a + (s.pm25_corrected as number), 0) / nearby.length) * 10) / 10;
  const aqi = mean == null ? null : pm25ToAqi(mean);

  const windy = wind != null && wind.from_deg != null && wind.speed_kmh != null && wind.speed_kmh >= cfg.calm_below_kmh;
  const length = windy ? plumeLengthKm(wind.speed_kmh, cfg) : cfg.plume_min_km;
  const bearing = windy ? ((wind as WindObservation).from_deg as number + 180) % 360 : null;
  const polygon = windy ? sectorPolygon(loc, bearing as number, cfg.plume_half_angle_deg, length) : circlePolygon(loc, length);

  const cutoff = now.getTime() - SMELL_WINDOW_HOURS * 3600 * 1000;
  const inZone = smellReports.filter((r) => r.observed_at.getTime() >= cutoff && pointInPolygon({ lat: r.lat, lng: r.lng }, polygon));
  const odorScore = inZone.length === 0 ? 0 : Math.round((inZone.reduce((a, r) => a + r.smell_value, 0) / inZone.length) * 10) / 10;
  const risk = computeRisk({
    pm_cal: mean,
    w_tox: toxicityWeight(facility.permittedPollutants, facility.toxicity_weight),
    w_wind: windWeight(wind?.speed_kmh ?? null),
    odor_score: odorScore,
    v_user: 1,
  });

  return {
    facility_id: facility.facilityId,
    name: facility.name,
    location: loc,
    radius_km: cfg.radius_km,
    pm25_corrected: mean,
    aqi: aqi?.aqi ?? null,
    aqi_category: aqi?.category ?? null,
    sensor_count: nearby.length,
    sensor_ids: nearby.map((s) => s.id).sort(),
    wind,
    zone_shape: windy ? "sector" : "circle",
    zone_length_km: length,
    zone_bearing_deg: bearing,
    zone_polygon: polygon,
    risk_level: risk.level,
    risk_score: risk.score,
    risk_inputs: { pm_cal: risk.pm_cal, w_tox: risk.w_tox, w_wind: risk.w_wind, odor_score: risk.odor_score, w_odor: risk.w_odor, v_user: risk.v_user },
    smell_reports_in_zone: inZone.length,
    computed_at: now,
  };
}

/** Latest NWS observation for a station. Null on any failure. */
export async function fetchWind(station: string, http: AxiosInstance = axios.create({ timeout: 10000 })): Promise<WindObservation | null> {
  try {
    const res = await http.get(`https://api.weather.gov/stations/${encodeURIComponent(station)}/observations/latest`, {
      headers: { "User-Agent": "(valleycleanair.com, info@valleycleanair.com)", "Accept": "application/geo+json" },
    });
    const p = res.data?.properties ?? {};
    const dir = p.windDirection?.value;
    const spd = p.windSpeed?.value; // NWS reports km/h
    return {
      from_deg: typeof dir === "number" ? dir : null,
      speed_kmh: typeof spd === "number" ? Math.round(spd * 10) / 10 : null,
      observed_at: p.timestamp ? new Date(p.timestamp) : null,
      station,
    };
  } catch (err) {
    logger.warn("Wind observation unavailable", { station, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function loadFacilityConfig(db: admin.firestore.Firestore): Promise<FacilityConfig> {
  const ref = db.collection(CONFIG_COLLECTION).doc(FACILITIES_CONFIG_DOC);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ ...DEFAULT_FACILITY_CONFIG, seeded_at: new Date(), note: "Edit radius_km, wind_station and plume settings here; no deploy needed." });
    return DEFAULT_FACILITY_CONFIG;
  }
  const d = snap.data() ?? {};
  const num = (k: keyof FacilityConfig) => (typeof d[k] === "number" && d[k] > 0 ? (d[k] as number) : (DEFAULT_FACILITY_CONFIG[k] as number));
  return {
    radius_km: num("radius_km"),
    wind_station: typeof d.wind_station === "string" && d.wind_station ? d.wind_station : DEFAULT_FACILITY_CONFIG.wind_station,
    plume_half_angle_deg: num("plume_half_angle_deg"),
    plume_min_km: num("plume_min_km"),
    plume_max_km: num("plume_max_km"),
    calm_below_kmh: num("calm_below_kmh"),
  };
}

/** Recompute and persist every facility's status. */
export async function updateFacilityStatuses(
  db: admin.firestore.Firestore,
  now: Date = new Date(),
  deps: { http?: AxiosInstance; sensors?: SensorForStatus[]; smellReports?: SmellReport[] } = {},
): Promise<FacilityStatusDoc[]> {
  const cfg = await loadFacilityConfig(db);
  const facSnap = await db.collection(FACILITIES_COLLECTION).get();
  const facilities = facSnap.docs
    .map((d) => d.data() as Partial<FacilityDoc>)
    .filter((f): f is FacilityDoc => !!f && typeof f.facilityId === "string" && !!f.location && typeof f.location.lat === "number" && typeof f.location.lng === "number");
  if (facilities.length === 0) return [];

  let sensors = deps.sensors;
  if (!sensors) {
    const snap = await db.collection(SENSOR_COLLECTIONS.sensors).get();
    sensors = snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, lat: data.lat, lng: data.lng, pm25_corrected: data.pm25_corrected ?? null, excluded: Boolean(data.excluded) };
    });
  }
  const wind = await fetchWind(cfg.wind_station, deps.http);

  const batch = db.batch();
  const out: FacilityStatusDoc[] = [];
  for (const f of facilities) {
    const doc = computeFacilityStatus(
      { facilityId: f.facilityId, name: f.name ?? f.facilityId, operator: f.operator, location: f.location, permittedPollutants: f.permittedPollutants, toxicity_weight: f.toxicity_weight },
      sensors, wind, cfg, now, deps.smellReports ?? [],
    );
    batch.set(db.collection(FACILITY_STATUS_COLLECTION).doc(f.facilityId), doc);
    out.push(doc);
  }
  await batch.commit();
  return out;
}
