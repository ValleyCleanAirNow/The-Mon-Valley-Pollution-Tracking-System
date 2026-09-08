/**
 * VCAN Weighted Risk Index.
 *
 *   Risk = [(PM_cal × W_tox × W_wind) + (Odor_score × W_odor)] × V_user
 *
 *   PM_cal      Barkjohn-corrected PM2.5 (ug/m3), the mean of nearby sensors
 *   W_tox       toxicity weight of the nearby industrial source, from its
 *               permitted pollutants (Title V / EPA TRI); 1.0 when none nearby
 *   W_wind      dispersion factor: stagnant air raises risk, wind lowers it
 *   Odor_score  mean Smell PGH rating (1..5) of recent reports nearby, 0 if none
 *   W_odor      how many PM-equivalent units one odor point is worth
 *   V_user      personal vulnerability, 1.0 for the public map
 *
 * The result is in PM2.5-equivalent units, so with all weights at 1 it equals
 * the corrected PM2.5 and the level thresholds line up with the EPA 2024 AQI
 * categories. Weights are deliberately simple and tunable; see RISK_WEIGHTS.
 * Mirrored in frontend/src/lib/risk.ts.
 */

export type RiskLevel = "low" | "elevated" | "high" | "severe" | "toxic";
export const RISK_LEVELS: readonly RiskLevel[] = ["low", "elevated", "high", "severe", "toxic"];

export const RISK_WEIGHTS = {
  /** Wind: W_wind = clamp(windIntercept - windSlope * speed_kmh, windMin, windMax). */
  windIntercept: 1.3,
  windSlope: 0.03,
  windMin: 0.7,
  windMax: 1.3,
  /** PM-equivalent units per odor point. Mean odor 3 adds 12. */
  odorWeight: 4,
  /** Toxicity: 1 + toxPerPollutant per permitted non-PM pollutant, capped. */
  toxBase: 1.0,
  toxPerPollutant: 0.1,
  toxMax: 1.5,
  /** Distance over which a facility's toxicity weight fades to 1.0, km. */
  toxFadeKm: 5,
  /** Personal vulnerability increments. */
  vAsthma: 0.4,
  vCopd: 0.4,
  vHeart: 0.3,
  vAgeSensitive: 0.2,
  vPreviousExposure: 0.2,
  vMax: 2.0,
} as const;

/** Level thresholds in PM2.5-equivalent units (EPA 2024 category edges). */
export const RISK_THRESHOLDS: Array<{ level: RiskLevel; min: number }> = [
  { level: "toxic", min: 125.5 },
  { level: "severe", min: 55.5 },
  { level: "high", min: 35.5 },
  { level: "elevated", min: 9.1 },
  { level: "low", min: 0 },
];

export function windWeight(speedKmh: number | null | undefined): number {
  if (speedKmh == null || !Number.isFinite(speedKmh)) return 1.0;
  const w = RISK_WEIGHTS.windIntercept - RISK_WEIGHTS.windSlope * speedKmh;
  return Math.round(Math.max(RISK_WEIGHTS.windMin, Math.min(RISK_WEIGHTS.windMax, w)) * 100) / 100;
}

/** Toxicity weight from a facility's permitted pollutants (PM2.5/PM10 excluded). */
export function toxicityWeight(permittedPollutants: Array<{ pollutant?: string }> | undefined, override?: number | null): number {
  if (typeof override === "number" && override >= 1) return Math.min(RISK_WEIGHTS.toxMax, override);
  const n = (permittedPollutants ?? []).filter((p) => p.pollutant && !/^PM/i.test(p.pollutant)).length;
  return Math.round(Math.min(RISK_WEIGHTS.toxMax, RISK_WEIGHTS.toxBase + RISK_WEIGHTS.toxPerPollutant * n) * 100) / 100;
}

/** Fade a facility's toxicity weight toward 1.0 with distance. */
export function toxicityAtDistance(wTox: number, distanceKm: number): number {
  const t = Math.max(0, 1 - distanceKm / RISK_WEIGHTS.toxFadeKm);
  return Math.round((1 + (wTox - 1) * t) * 100) / 100;
}

export interface Vulnerability {
  asthma?: boolean;
  copd?: boolean;
  heartDisease?: boolean;
  /** Under 12 or 65 and over. */
  ageSensitive?: boolean;
  previousHighExposure?: boolean;
}

export function vulnerabilityFactor(v: Vulnerability | null | undefined): number {
  if (!v) return 1.0;
  const w = RISK_WEIGHTS;
  const sum = 1 + (v.asthma ? w.vAsthma : 0) + (v.copd ? w.vCopd : 0) + (v.heartDisease ? w.vHeart : 0) + (v.ageSensitive ? w.vAgeSensitive : 0) + (v.previousHighExposure ? w.vPreviousExposure : 0);
  return Math.round(Math.min(w.vMax, sum) * 100) / 100;
}

export interface RiskInputs {
  pm_cal: number | null;
  w_tox: number;
  w_wind: number;
  odor_score: number;
  w_odor: number;
  v_user: number;
}

export interface RiskResult extends RiskInputs {
  score: number | null;
  level: RiskLevel | null;
}

export function riskLevelFor(score: number | null): RiskLevel | null {
  if (score == null || !Number.isFinite(score)) return null;
  for (const t of RISK_THRESHOLDS) if (score >= t.min) return t.level;
  return "low";
}

export function computeRisk(inputs: Omit<RiskInputs, "w_odor"> & { w_odor?: number }): RiskResult {
  const w_odor = inputs.w_odor ?? RISK_WEIGHTS.odorWeight;
  if (inputs.pm_cal == null || !Number.isFinite(inputs.pm_cal)) {
    return { ...inputs, w_odor, score: null, level: null };
  }
  const raw = (inputs.pm_cal * inputs.w_tox * inputs.w_wind + inputs.odor_score * w_odor) * inputs.v_user;
  const score = Math.round(raw * 10) / 10;
  return { ...inputs, w_odor, score, level: riskLevelFor(score) };
}

/** Plain-language action line per level, from VCAN's protocol. */
export const RISK_ACTION: Record<RiskLevel, string> = {
  low: "Safe for all.",
  elevated: "Safe for the general public. Sensitive people should prepare.",
  high: "Sensitive individuals should shelter in place.",
  severe: "All users should shelter in place.",
  toxic: "Immediate alert: likely industrial upset event. Stay indoors and report what you notice.",
};
