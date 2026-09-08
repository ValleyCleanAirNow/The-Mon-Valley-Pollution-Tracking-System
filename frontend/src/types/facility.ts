import type { AqiCategory } from '../lib/aqi';

/** Document in `titleVFacilities` (public read). */
export interface Facility {
  id: string;
  facilityId: string;
  name: string;
  operator?: string;
  location: { lat: number; lng: number; address?: string; city?: string; state?: string; zip?: string };
  permitId?: string;
  permitType?: string;
  issuedDate?: string;
  expirationDate?: string;
  processes?: string[];
  permittedPollutants?: Array<{ pollutant: string; limit?: number; unit?: string; averagingPeriod?: string }>;
  emissionsData?: Array<{ year: number; pollutant: string; quantity: number; unit: string; source?: string }>;
  violations?: Array<{ date: string; description: string; status?: string }>;
  regulatoryAgency?: string;
  lastInspection?: string;
}

export type { RiskLevel } from '../lib/risk';
import type { RiskLevel } from '../lib/risk';
import type { RiskInputs } from '../lib/risk';

/** Document in `facility_status/{facilityId}`, computed hourly by onPollComplete. */
export interface FacilityStatus {
  risk_level: RiskLevel | null;
  risk_score: number | null;
  risk_inputs: RiskInputs | null;
  smell_reports_in_zone: number;
  toxicity_weight?: number;
  facility_id: string;
  name: string;
  location: { lat: number; lng: number };
  radius_km: number;
  pm25_corrected: number | null;
  aqi: number | null;
  aqi_category: AqiCategory | null;
  sensor_count: number;
  wind: { from_deg: number | null; speed_kmh: number | null; observed_at: Date | null; station: string } | null;
  zone_shape: 'sector' | 'circle';
  zone_length_km: number;
  zone_bearing_deg: number | null;
  zone_polygon: Array<{ lat: number; lng: number }>;
  computed_at: Date | null;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compassLabel(deg: number | null): string {
  if (deg == null || !Number.isFinite(deg)) return '';
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

const LEVEL_LABEL: Record<RiskLevel, string> = { low: 'Low', elevated: 'Elevated', high: 'High', severe: 'Severe', toxic: 'Toxic' };

/** Plain-language description of a zone for popups and screen readers. */
export function describeZone(s: FacilityStatus): string {
  const cat = s.aqi_category ?? 'no sensor data';
  const level = s.risk_level ? `Risk ${LEVEL_LABEL[s.risk_level]}${s.risk_score != null ? ` (index ${s.risk_score})` : ''}` : 'Risk not computed';
  const smell = s.smell_reports_in_zone > 0 ? ` ${s.smell_reports_in_zone} odor report${s.smell_reports_in_zone === 1 ? '' : 's'} in the zone in the last 3 hours.` : '';
  if (s.zone_shape === 'sector' && s.wind) {
    return `${level}. Wind from the ${compassLabel(s.wind.from_deg)} at ${Math.round(s.wind.speed_kmh ?? 0)} km/h; the zone extends about ${s.zone_length_km} km toward the ${compassLabel(s.zone_bearing_deg)}. Air within ${s.radius_km} km of the plant: ${cat}.${smell}`;
  }
  return `${level}. Wind calm or unknown; the zone is a ${s.zone_length_km} km circle around the plant. Air within ${s.radius_km} km of the plant: ${cat}.${smell}`;
}
