import React, { useEffect, useMemo, useState } from 'react';
import './SymptomReportForm.css';
import './AlertsView.css';
import { useMunicipalityStatus } from '../hooks/useMunicipalityStatus';
import { useFacilities } from '../hooks/useFacilities';
import { useSmellReports } from '../hooks/useMapLayers';
import { MUNICIPALITIES } from '../lib/municipalities';
import { RISK_LEVEL_STYLE } from '../lib/mapLayers';
import { computeRisk, RISK_ACTION, toxicityAtDistance, vulnerabilityFactor, windWeight, type Vulnerability } from '../lib/risk';

const STORAGE_KEY = 'mvpts.myRisk';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

interface Saved {
  municipality: string;
  v: Vulnerability;
}

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { municipality: '', v: {} };
}

/**
 * Personal exposure risk. Health factors stay in this browser's storage and
 * are never sent anywhere; the index is computed on the device from public
 * municipality, facility, wind and odor data.
 */
const MyRisk: React.FC = () => {
  const { statuses } = useMunicipalityStatus();
  const { facilities, statuses: facilityStatuses } = useFacilities();
  const smell = useSmellReports();
  const [saved, setSaved] = useState<Saved>(load);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
  }, [saved]);

  const toggle = (k: keyof Vulnerability) => setSaved((s) => ({ ...s, v: { ...s.v, [k]: !s.v[k] } }));

  const result = useMemo(() => {
    const m = statuses[saved.municipality];
    if (!m) return null;
    const centroid = (m as { centroid?: { lat: number; lng: number } }).centroid;
    // Nearest facility's toxicity weight, faded with distance.
    let wTox = 1, nearest: { name: string; km: number } | null = null, wind: number | null = null;
    for (const f of facilities) {
      const fs = facilityStatuses[f.facilityId] ?? facilityStatuses[f.id];
      if (!centroid) break;
      const km = haversineKm(centroid.lat, centroid.lng, f.location.lat, f.location.lng);
      const base = fs?.risk_inputs?.w_tox ?? 1;
      const w = toxicityAtDistance(base, km);
      if (w > wTox || nearest === null) { wTox = Math.max(wTox, w); if (!nearest || km < nearest.km) nearest = { name: f.name, km: Math.round(km * 10) / 10 }; }
      if (wind == null && fs?.wind?.speed_kmh != null) wind = fs.wind.speed_kmh;
    }
    const cutoff = Date.now() - 3 * 3600 * 1000;
    const nearby = centroid ? smell.filter((r) => r.observed_at && r.observed_at.getTime() >= cutoff && haversineKm(centroid.lat, centroid.lng, r.lat, r.lng) <= 3) : [];
    const odor = nearby.length ? Math.round((nearby.reduce((a, r) => a + r.smell_value, 0) / nearby.length) * 10) / 10 : 0;
    const risk = computeRisk({ pm_cal: m.pm25_corrected, w_tox: wTox, w_wind: windWeight(wind), odor_score: odor, v_user: vulnerabilityFactor(saved.v) });
    return { risk, nearest, wind, odorCount: nearby.length, category: m.aqi_category };
  }, [statuses, facilities, facilityStatuses, smell, saved]);

  const style = result?.risk.level ? RISK_LEVEL_STYLE[result.risk.level] : null;

  return (
    <div className="report-form" aria-label="My exposure risk">
      <h2>My exposure risk</h2>
      <p className="report-form__intro">
        A personal reading from the VCAN Weighted Risk Index. Your answers stay on this device and are never sent to us.
      </p>

      <fieldset>
        <legend>Where are you?</legend>
        <select aria-label="Municipality" value={saved.municipality} onChange={(e) => setSaved((s) => ({ ...s, municipality: e.target.value }))}>
          <option value="">Choose a municipality…</option>
          {MUNICIPALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </fieldset>

      <fieldset>
        <legend>About you (optional)</legend>
        <p className="hint">Tick anything that applies. Each raises your personal vulnerability factor.</p>
        <div className="chips" role="group" aria-label="Health factors">
          {([
            ['asthma', 'Asthma'], ['copd', 'COPD or other lung disease'], ['heartDisease', 'Heart disease'],
            ['ageSensitive', 'Under 12 or 65 and over'], ['previousHighExposure', 'Recent high exposure'],
          ] as Array<[keyof Vulnerability, string]>).map(([k, label]) => (
            <button key={k} type="button" className="chip" aria-pressed={!!saved.v[k]} onClick={() => toggle(k)}>{label}</button>
          ))}
        </div>
      </fieldset>

      {result && style && result.risk.level && (
        <section className="dashboard__headline" style={{ background: style.color, color: style.text, borderRadius: 16, padding: 20, marginBottom: 16 }} aria-live="polite">
          <div style={{ fontSize: '0.95rem', opacity: 0.9 }}>Your risk in {saved.municipality} right now</div>
          <div style={{ fontSize: '2.4rem', fontWeight: 800 }}>{style.label}</div>
          <div>{RISK_ACTION[result.risk.level]}</div>
          <div style={{ fontSize: '0.85rem', marginTop: 8, opacity: 0.9 }}>
            Index {result.risk.score} = (PM {result.risk.pm_cal} × toxicity {result.risk.w_tox} × wind {result.risk.w_wind}) + (odor {result.risk.odor_score} × {result.risk.w_odor}), × your factor {result.risk.v_user}
          </div>
        </section>
      )}
      {result && !result.risk.level && saved.municipality && (
        <div className="report-form__error" role="status">No sensor data near {saved.municipality} right now, so no reading can be given.</div>
      )}
      {result && (
        <p className="hint">
          {result.nearest ? `Nearest plant: ${result.nearest.name}, ${result.nearest.km} km away. ` : ''}
          {result.wind != null ? `Wind ${Math.round(result.wind)} km/h. ` : 'Wind unknown. '}
          {result.odorCount > 0 ? `${result.odorCount} odor report${result.odorCount === 1 ? '' : 's'} nearby in the last 3 hours.` : 'No odor reports nearby in the last 3 hours.'}
        </p>
      )}

      <details className="sensor-map__list">
        <summary>How exposure risk is calculated</summary>
        <div className="hint" style={{ marginTop: 8 }}>
          <p><b>Weighted Risk Algorithm.</b> The VCAN Weighted Risk Index goes beyond standard AQI to account for multiple factors:</p>
          <p><code>Risk = [(PM_cal × W_tox × W_wind) + (Odor_score × W_odor)] × V_user</code></p>
          <ul>
            <li><b>PM_cal</b>: Barkjohn-corrected PM2.5 (accounts for humidity)</li>
            <li><b>W_tox</b>: toxicity weight based on nearby industrial facilities (permitted pollutants, EPA TRI)</li>
            <li><b>W_wind</b>: dispersion factor (stagnant air = higher risk)</li>
            <li><b>Odor_score</b>: recent Smell PGH reports nearby, and <b>W_odor</b> their weight</li>
            <li><b>V_user</b>: personal vulnerability (health factors)</li>
          </ul>
          <p><b>Risk levels.</b> Toxic (purple): immediate alert, likely industrial upset event. Severe (red): all users should shelter in place. High (orange): sensitive individuals shelter in place. Elevated (yellow): safe for the general public, sensitive users prepare. Low (green): safe for all.</p>
          <p>With every weight at 1 the index equals the corrected PM2.5, so the level edges match the EPA 2024 AQI categories.</p>
        </div>
      </details>
    </div>
  );
};

export default MyRisk;
