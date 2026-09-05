import React, { useMemo } from 'react';
import { useSensors } from '../hooks/useSensors';
import { useAggregates } from '../hooks/useAggregates';
import { labelFor, SYMPTOMS, ODOR_TYPES } from '../types/report';
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
  // Public hourly aggregates for the last 7 days. Buckets with fewer than
  // three reports are never published, so this is safe to show to anyone.
  const since = useMemo(() => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), []);
  const { aggregates } = useAggregates(since);

  const community = useMemo(() => {
    const reportCount = aggregates.reduce((n, a) => n + a.report_count, 0);
    const municipalities = new Set(aggregates.map((a) => a.municipality));
    const tallies = new Map<string, number>();
    const odors = new Map<string, number>();
    for (const a of aggregates) {
      for (const t of a.top_symptoms) tallies.set(t.value, (tallies.get(t.value) ?? 0) + t.count);
      for (const t of a.top_odors) odors.set(t.value, (odors.get(t.value) ?? 0) + t.count);
    }
    const top = (m: Map<string, number>) => Array.from(m.entries()).sort((x, y) => y[1] - x[1]).slice(0, 3);
    return { reportCount, municipalityCount: municipalities.size, topSymptoms: top(tallies), topOdors: top(odors) };
  }, [aggregates]);

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
          <div className="card__label">Community reports, 7 days</div>
          <div className="card__value">{community.reportCount}</div>
          <div className="card__unit">
            {community.municipalityCount > 0
              ? `across ${community.municipalityCount} municipalit${community.municipalityCount === 1 ? 'y' : 'ies'}`
              : 'shown once 3+ people report in the same hour'}
          </div>
        </div>
      </div>

      {(community.topSymptoms.length > 0 || community.topOdors.length > 0) && (
        <section className="dashboard__panel" style={{ marginBottom: 20 }} aria-label="What neighbours are reporting">
          <h4>What neighbours are reporting this week</h4>
          {community.topSymptoms.length > 0 && (
            <p>
              Most common symptoms:{' '}
              {community.topSymptoms.map(([v, n]) => `${labelFor(SYMPTOMS, v)} (${n})`).join(', ')}
            </p>
          )}
          {community.topOdors.length > 0 && (
            <p>
              Most common odors:{' '}
              {community.topOdors.map(([v, n]) => `${labelFor(ODOR_TYPES, v)} (${n})`).join(', ')}
            </p>
          )}
        </section>
      )}

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
