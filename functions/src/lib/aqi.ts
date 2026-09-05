/**
 * US EPA Air Quality Index (AQI) for PM2.5.
 *
 * Breakpoints are the revised values published by EPA in February 2024
 * (final rule reconsidering the PM NAAQS, 89 FR 16202). The "Good" range
 * was tightened from 0-12.0 to 0-9.0 ug/m3 and every band above it shifted.
 *
 * Concentrations are truncated to one decimal place before lookup, per the
 * EPA Technical Assistance Document for reporting the daily AQI.
 */

export type AqiCategory =
  | "Good"
  | "Moderate"
  | "Unhealthy for Sensitive Groups"
  | "Unhealthy"
  | "Very Unhealthy"
  | "Hazardous";

export interface AqiBreakpoint {
  category: AqiCategory;
  /** Inclusive lower concentration bound, ug/m3. */
  cLo: number;
  /** Inclusive upper concentration bound, ug/m3. */
  cHi: number;
  /** AQI value at cLo. */
  iLo: number;
  /** AQI value at cHi. */
  iHi: number;
}

/** 2024 revised PM2.5 breakpoints. Order matters: lowest band first. */
export const PM25_BREAKPOINTS_2024: readonly AqiBreakpoint[] = [
  { category: "Good", cLo: 0.0, cHi: 9.0, iLo: 0, iHi: 50 },
  { category: "Moderate", cLo: 9.1, cHi: 35.4, iLo: 51, iHi: 100 },
  { category: "Unhealthy for Sensitive Groups", cLo: 35.5, cHi: 55.4, iLo: 101, iHi: 150 },
  { category: "Unhealthy", cLo: 55.5, cHi: 125.4, iLo: 151, iHi: 200 },
  { category: "Very Unhealthy", cLo: 125.5, cHi: 225.4, iLo: 201, iHi: 300 },
  // EPA caps the reported index at 500. Anything above 325.4 is reported
  // as 500 and still categorized Hazardous.
  { category: "Hazardous", cLo: 225.5, cHi: 325.4, iLo: 301, iHi: 500 },
];

/** Standard EPA category colors, used by the map legend and markers. */
export const AQI_COLORS: Record<AqiCategory, string> = {
  "Good": "#00e400",
  "Moderate": "#ffff00",
  "Unhealthy for Sensitive Groups": "#ff7e00",
  "Unhealthy": "#ff0000",
  "Very Unhealthy": "#8f3f97",
  "Hazardous": "#7e0023",
};

export interface AqiResult {
  aqi: number;
  category: AqiCategory;
}

/** Truncate (not round) to one decimal place, matching EPA guidance. */
export function truncateToTenth(value: number): number {
  return Math.floor(value * 10 + 1e-9) / 10;
}

/**
 * Compute the PM2.5 AQI for a concentration in ug/m3.
 * Returns null for non-finite or negative input.
 */
export function pm25ToAqi(concentration: number): AqiResult | null {
  if (!Number.isFinite(concentration) || concentration < 0) return null;
  const c = truncateToTenth(concentration);

  for (const bp of PM25_BREAKPOINTS_2024) {
    if (c >= bp.cLo && c <= bp.cHi) {
      const aqi = Math.round(((bp.iHi - bp.iLo) / (bp.cHi - bp.cLo)) * (c - bp.cLo) + bp.iLo);
      return { aqi, category: bp.category };
    }
    // Values that fall in the gap between bands because of the 0.1 step
    // (for example 9.05 truncates to 9.0, but 9.08 could not) are handled
    // by truncation above, so no gap logic is needed here.
  }

  // Above the top of the table: report 500, Hazardous.
  const top = PM25_BREAKPOINTS_2024[PM25_BREAKPOINTS_2024.length - 1];
  if (c > top.cHi) return { aqi: 500, category: "Hazardous" };
  return null;
}

/** Category ordering helper used by alerting thresholds in later work. */
export const AQI_CATEGORY_ORDER: readonly AqiCategory[] = PM25_BREAKPOINTS_2024.map((b) => b.category);

export function categoryRank(category: AqiCategory): number {
  return AQI_CATEGORY_ORDER.indexOf(category);
}
