import React, { useEffect, useMemo, useState } from 'react';
import { collection, getCountFromServer } from 'firebase/firestore';
import { db } from '../firebase';
import { useSensors } from '../hooks/useSensors';
import { AqiLegend } from './AqiLegend';
import { CATEGORY_ADVICE, colorFor, pm25ToAqi, textColorFor } from '../lib/aqi';
import './Dashboard.css';

/**
 * Community Health Dashboard.
 *
 * Reads only from Firestore. The headline numbers are the mean corrected
 * PM2.5 across sensors the poller did not exclude (confidence >= 70, outdoor,
 * seen within 2 hours), and the AQI derived from that mean.
 */

function formatTime(d: Date | null): string {
  if (!d) return 'unknown';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const Dashboard: React.FC = () => {
  const { sensors, loading, error, lastUpdated } = useSensors();
  const [reportCount, setReportCount] = useState<number | null>(null);

  // Symptom report count. Read access is restricted, so failure is expected
  // for anonymous visitors until the reports work item lands; show n/a.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!db || typeof (db as { type?: unknown }).type !== 'string') return;
        const snap = await getCountFromServer(collection(db, 'symptomReports'));
        if (!cancelled) setReportCount(snap.data().count);
      } catch {
        if (!cancelled) setReportCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    const included = sensors.filter((s) => !s.excluded && s.pm25_corrected != null);
    if (included.length === 0) return { mean: null, aqi: null, category: null, included: 0 };
    const mean = included.reduce((sum, s) => sum + (s.pm25_corrected as number), 0) / included.length;
    const r = pm25ToAqi(mean);
    return { mean, aqi: r?.aqi ?? null, category: r?.category ?? null, included: included.length };
  }, [sensors]);

  const headlineColor = colorFor(summary.category);
  const headlineText = textColorFor(summary.category);

  return (
    <div className="dashboard">
      <h2>Community Health Dashboard</h2>
      <p className="dashboard__meta">
        Mon Valley average from {summary.included} of {sensors.length} PurpleAir sensors · Last updated{' '}
        <b>{formatTime(lastUpdated)}</b>
        {loading && ' · loading…'}
      </p>
      {error && <div className="dashboard__error" role="alert">Could not load sensor data: {error}</div>}

      <section
        className="dashboard__headline"
        style={{ background: headlineColor, color: headlineText }}
        aria-label="Current Mon Valley air quality"
      >
        <div className="dashboard__headline-label">Mon Valley air quality right now</div>
        <div className="dashboard__headline-value">
          {summary.aqi != null ? `AQI ${summary.aqi}` : 'No data'}
        </div>
        <div className="dashboard__headline-category">{summary.category ?? 'Waiting for sensor data'}</div>
        <div className="dashboard__headline-advice">
          {summary.category ? CATEGORY_ADVICE[summary.category] : 'Sensor readings update every 10 minutes.'}
        </div>
      </section>

      <div className="dashboard__cards">
        <div className="card">
          <div className="card__label">Corrected PM2.5</div>
          <div className="card__value">{summary.mean != null ? summary.mean.toFixed(1) : 'n/a'}</div>
          <div className="card__unit">µg/m³, EPA-corrected mean</div>
        </div>
        <div className="card">
          <div className="card__label">Sensors reporting</div>
          <div className="card__value">{summary.included}</div>
          <div className="card__unit">of {sensors.length} in the Mon Valley box</div>
        </div>
        <div className="card">
          <div className="card__label">Symptom reports</div>
          <div className="card__value">{reportCount ?? 'n/a'}</div>
          <div className="card__unit">community reports filed</div>
        </div>
      </div>

      <section className="dashboard__panel">
        <h4>How to read this</h4>
        <AqiLegend />
        <p>
          Values come from low-cost PurpleAir sensors, corrected with the EPA (Barkjohn 2021) equation so they line up
          with regulatory monitors. Indoor sensors, sensors with confidence under 70%, and sensors silent for over two
          hours are shown on the map but left out of the average. AQI uses the EPA breakpoints revised in 2024.
        </p>
      </section>
    </div>
  );
};

export default Dashboard;
