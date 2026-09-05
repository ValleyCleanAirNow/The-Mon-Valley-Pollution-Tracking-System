/**
 * EPA correction for PurpleAir PM2.5.
 *
 * Base equation: Barkjohn, Gantt & Clements (2021), "Development and
 * application of a United States-wide correction for PM2.5 data collected
 * with the PurpleAir sensor", Atmos. Meas. Tech. 14, 4617-4637.
 *
 *     PM2.5 = 0.524 * PA_cf1 - 0.0862 * RH + 5.75
 *
 * where PA_cf1 is the sensor's "CF=1" PM2.5 channel (ug/m3) and RH is the
 * sensor's relative humidity (%). Negative results are floored at 0.
 *
 * EXTENSION HOOK: EPA later published a piecewise extension of this equation
 * for very high concentrations seen during wildfire smoke (roughly above
 * 343 ug/m3 raw), documented in the 2022 update to the AirNow Fire and Smoke
 * Map methodology. It blends the base slope of 0.524 toward 0.786 between
 * PA_cf1 of 30 and 50, and switches to a quadratic form above about 210.
 * That extension is NOT implemented yet. To add it, implement
 * `correctPm25Extended` below and switch `CORRECTION_MODEL`. Nothing else in
 * the pipeline needs to change; the stored `correction_model` field on each
 * reading records which equation produced the value.
 */

export type CorrectionModel = "barkjohn_2021" | "epa_2022_extended";

/** Which equation the poller currently applies. */
export const CORRECTION_MODEL: CorrectionModel = "barkjohn_2021";

export const BARKJOHN_2021 = {
  slope: 0.524,
  humidityCoefficient: 0.0862,
  intercept: 5.75,
} as const;

/**
 * Base Barkjohn 2021 correction. Returns null when either input is missing
 * or not finite, so callers can flag the reading rather than store a bogus 0.
 */
export function correctPm25Barkjohn(pm25Cf1: number | null | undefined, humidity: number | null | undefined): number | null {
  if (pm25Cf1 == null || humidity == null) return null;
  if (!Number.isFinite(pm25Cf1) || !Number.isFinite(humidity)) return null;
  const { slope, humidityCoefficient, intercept } = BARKJOHN_2021;
  const corrected = slope * pm25Cf1 - humidityCoefficient * humidity + intercept;
  return Math.max(0, corrected);
}

/**
 * Placeholder for the EPA 2022 piecewise extension. Intentionally falls back
 * to the base equation so behaviour is unchanged until it is implemented.
 * TODO(stage-2): implement piecewise blend per EPA Fire and Smoke Map notes.
 */
export function correctPm25Extended(pm25Cf1: number | null | undefined, humidity: number | null | undefined): number | null {
  return correctPm25Barkjohn(pm25Cf1, humidity);
}

/** Dispatch on the configured model. */
export function correctPm25(pm25Cf1: number | null | undefined, humidity: number | null | undefined): number | null {
  switch (CORRECTION_MODEL as CorrectionModel) {
    case "epa_2022_extended":
      return correctPm25Extended(pm25Cf1, humidity);
    case "barkjohn_2021":
    default:
      return correctPm25Barkjohn(pm25Cf1, humidity);
  }
}
