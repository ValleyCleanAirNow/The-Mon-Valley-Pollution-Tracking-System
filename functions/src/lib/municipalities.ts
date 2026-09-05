/**
 * Mon Valley municipalities served by VCAN. The canonical list also lives in
 * firestore.rules (for write validation) and frontend/src/lib/municipalities.ts.
 * Keep all three in sync when adding a municipality; see OPERATIONS.md.
 */
export const MUNICIPALITIES = [
  "Clairton",
  "Glassport",
  "Liberty",
  "Lincoln",
  "Port Vue",
  "McKeesport",
  "Elizabeth Township",
  "Elizabeth Borough",
  "Jefferson Hills",
  "West Mifflin",
  "Dravosburg",
  "Duquesne",
  "Braddock",
  "North Braddock",
  "Rankin",
  "East Pittsburgh",
] as const;

export type Municipality = (typeof MUNICIPALITIES)[number];

export function isMunicipality(value: unknown): value is Municipality {
  return typeof value === "string" && (MUNICIPALITIES as readonly string[]).includes(value);
}
