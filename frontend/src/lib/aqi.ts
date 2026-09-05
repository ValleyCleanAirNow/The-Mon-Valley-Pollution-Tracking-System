/**
 * Client-side AQI helpers. Mirrors functions/src/lib/aqi.ts; keep the two in
 * sync if EPA revises the breakpoints again. The server is the source of truth
 * for stored `aqi` and `aqi_category`; the client only re-derives the index
 * for averages it computes itself (for example the dashboard headline).
 */

export type AqiCategory =
  | 'Good'
  | 'Moderate'
  | 'Unhealthy for Sensitive Groups'
  | 'Unhealthy'
  | 'Very Unhealthy'
  | 'Hazardous';

interface Breakpoint {
  category: AqiCategory;
  cLo: number;
  cHi: number;
  iLo: number;
  iHi: number;
}

/** EPA 2024 revised PM2.5 breakpoints (ug/m3). */
export const PM25_BREAKPOINTS_2024: readonly Breakpoint[] = [
  { category: 'Good', cLo: 0.0, cHi: 9.0, iLo: 0, iHi: 50 },
  { category: 'Moderate', cLo: 9.1, cHi: 35.4, iLo: 51, iHi: 100 },
  { category: 'Unhealthy for Sensitive Groups', cLo: 35.5, cHi: 55.4, iLo: 101, iHi: 150 },
  { category: 'Unhealthy', cLo: 55.5, cHi: 125.4, iLo: 151, iHi: 200 },
  { category: 'Very Unhealthy', cLo: 125.5, cHi: 225.4, iLo: 201, iHi: 300 },
  { category: 'Hazardous', cLo: 225.5, cHi: 325.4, iLo: 301, iHi: 500 },
];

export const AQI_CATEGORIES: readonly AqiCategory[] = PM25_BREAKPOINTS_2024.map((b) => b.category);

/** Standard EPA AQI colors. */
export const AQI_COLORS: Record<AqiCategory, string> = {
  'Good': '#00e400',
  'Moderate': '#ffff00',
  'Unhealthy for Sensitive Groups': '#ff7e00',
  'Unhealthy': '#ff0000',
  'Very Unhealthy': '#8f3f97',
  'Hazardous': '#7e0023',
};

/** Colour for sensors with no usable reading or that are excluded. */
export const NO_DATA_COLOR = '#9e9e9e';

/** Text colour that stays legible on each AQI swatch. */
export function textColorFor(category: AqiCategory | null): string {
  if (category === 'Good' || category === 'Moderate') return '#1a1a1a';
  return '#ffffff';
}

export function colorFor(category: AqiCategory | null | undefined): string {
  return category ? AQI_COLORS[category] : NO_DATA_COLOR;
}

/** Truncate to one decimal, matching EPA guidance. */
function truncateToTenth(v: number): number {
  return Math.floor(v * 10 + 1e-9) / 10;
}

export function pm25ToAqi(concentration: number): { aqi: number; category: AqiCategory } | null {
  if (!Number.isFinite(concentration) || concentration < 0) return null;
  const c = truncateToTenth(concentration);
  for (const bp of PM25_BREAKPOINTS_2024) {
    if (c >= bp.cLo && c <= bp.cHi) {
      const aqi = Math.round(((bp.iHi - bp.iLo) / (bp.cHi - bp.cLo)) * (c - bp.cLo) + bp.iLo);
      return { aqi, category: bp.category };
    }
  }
  if (c > 325.4) return { aqi: 500, category: 'Hazardous' };
  return null;
}

/** One-line, plain-language guidance per category. */
export const CATEGORY_ADVICE: Record<AqiCategory, string> = {
  'Good': 'Air quality is good. Enjoy outdoor activities.',
  'Moderate': 'Air quality is acceptable. Unusually sensitive people should consider limiting long outdoor exertion.',
  'Unhealthy for Sensitive Groups': 'If you have asthma, COPD, or heart disease, or are a child or older adult, reduce time outdoors and consider running an air purifier.',
  'Unhealthy': 'Everyone should limit outdoor exertion. Sensitive groups should stay indoors with windows closed.',
  'Very Unhealthy': 'Health alert. Avoid outdoor activity. Keep windows closed and run an air purifier if you have one.',
  'Hazardous': 'Emergency conditions. Stay indoors, keep windows closed, and seek medical care if you have trouble breathing.',
};
