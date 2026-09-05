/**
 * Mon Valley municipalities. Keep in sync with functions/src/lib/municipalities.ts
 * and the isMunicipality() list in firestore.rules.
 */
export const MUNICIPALITIES = [
  'Clairton',
  'Glassport',
  'Liberty',
  'Lincoln',
  'Port Vue',
  'McKeesport',
  'Elizabeth Township',
  'Elizabeth Borough',
  'Jefferson Hills',
  'West Mifflin',
  'Dravosburg',
  'Duquesne',
  'Braddock',
  'North Braddock',
  'Rankin',
  'East Pittsburgh',
] as const;

export type Municipality = (typeof MUNICIPALITIES)[number];
