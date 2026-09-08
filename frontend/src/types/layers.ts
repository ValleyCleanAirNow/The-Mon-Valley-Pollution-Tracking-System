/** Smell PGH odor report, from `smell_reports` (public). */
export interface SmellReport {
  id: string;
  smell_value: number;
  lat: number;
  lng: number;
  observed_at: Date | null;
  description: string | null;
}

/** VCAN air filter / purifier distribution site, from `vcan_distributions` (public). */
export interface DistributionSite {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  municipality?: string;
  what?: string;
  date?: string;
  notes?: string;
}
