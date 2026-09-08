/** Shared colours and labels for the non-sensor map layers. Mirrors the legend. */
import type { RiskLevel } from '../types/facility';

export const RISK_LEVEL_STYLE: Record<RiskLevel, { label: string; color: string; text: string }> = {
  low: { label: 'Low', color: '#43a047', text: '#fff' },
  elevated: { label: 'Elevated', color: '#ffc107', text: '#1a1a1a' },
  high: { label: 'High', color: '#ff7e00', text: '#1a1a1a' },
  severe: { label: 'Severe', color: '#d32f2f', text: '#fff' },
  toxic: { label: 'Toxic', color: '#6a1b9a', text: '#fff' },
};

export const SMELL_BUCKETS: Array<{ label: string; min: number; max: number; color: string }> = [
  { label: 'Low (1-2)', min: 1, max: 2, color: '#c5e1a5' },
  { label: 'Moderate (2-3)', min: 2, max: 3, color: '#ffe082' },
  { label: 'High (3-4)', min: 3, max: 4, color: '#ff8a65' },
  { label: 'Very High (4-5)', min: 4, max: 5, color: '#b71c1c' },
];

export function smellColor(value: number): string {
  if (value >= 4) return SMELL_BUCKETS[3].color;
  if (value >= 3) return SMELL_BUCKETS[2].color;
  if (value >= 2) return SMELL_BUCKETS[1].color;
  return SMELL_BUCKETS[0].color;
}

/** Hexagon circumradius for risk zones, km. */
export const HEX_RADIUS_KM = 0.25;
