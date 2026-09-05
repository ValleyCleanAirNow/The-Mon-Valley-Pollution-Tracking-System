import React, { useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './SensorMap.css';
import { useSensors } from '../hooks/useSensors';
import { colorFor, NO_DATA_COLOR, textColorFor } from '../lib/aqi';
import { AqiLegend } from './AqiLegend';
import type { Sensor } from '../types/sensor';

export type { Sensor } from '../types/sensor';

interface SensorMapProps {
  /** Optional preloaded sensors. When provided, Firestore is not queried. */
  sensors?: Sensor[];
  onSensorSelect?: (sensor: Sensor) => void;
}

/** Roughly Glassport, so the whole Mon Valley fits at zoom 11. */
const MAP_CENTER: [number, number] = [40.33, -79.9];
const MAP_ZOOM = 11;

/** How old the newest poll may be before we warn the user. */
const STALE_AFTER_MS = 30 * 60 * 1000;

const EXCLUDE_LABELS: Record<string, string> = {
  low_confidence: 'sensor confidence below 70%',
  indoor: 'indoor sensor',
  stale: 'no data for over 2 hours',
  missing_data: 'missing PM2.5 or humidity',
};

function describeExclusion(reason: string | null): string {
  if (!reason) return '';
  return reason
    .split(',')
    .map((r) => EXCLUDE_LABELS[r] ?? r)
    .join('; ');
}

function formatTime(d: Date | null): string {
  if (!d) return 'unknown';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmt(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(digits);
}

const SensorPopup: React.FC<{ sensor: Sensor }> = ({ sensor }) => {
  const color = colorFor(sensor.excluded ? null : sensor.aqi_category);
  return (
    <div className="sensor-popup">
      <strong>{sensor.name}</strong>
      {sensor.aqi != null && sensor.aqi_category ? (
        <span className="sensor-popup__badge" style={{ background: color, color: textColorFor(sensor.aqi_category) }}>
          AQI {sensor.aqi} · {sensor.aqi_category}
        </span>
      ) : (
        <span className="sensor-popup__badge" style={{ background: NO_DATA_COLOR, color: '#fff' }}>No AQI</span>
      )}
      <div>Corrected PM2.5: <b>{fmt(sensor.pm25_corrected)}</b> µg/m³</div>
      <div>Raw PM2.5 (CF=1): {fmt(sensor.raw?.pm25_cf_1)} µg/m³</div>
      <div>Humidity: {fmt(sensor.raw?.humidity, 0)}% · Confidence: {fmt(sensor.raw?.confidence, 0)}%</div>
      <div>Last seen: {formatTime(sensor.last_seen_at)}</div>
      {sensor.excluded && (
        <div className="sensor-popup__excluded">
          Not used in public averages: {describeExclusion(sensor.exclude_reason)}.
        </div>
      )}
      <div style={{ color: '#777', fontSize: '0.75rem', marginTop: 4 }}>
        Source: PurpleAir · EPA correction applied
      </div>
    </div>
  );
};

const SensorMap: React.FC<SensorMapProps> = ({ sensors: propSensors, onSensorSelect }) => {
  const { sensors, loading, error, lastUpdated } = useSensors(propSensors);
  const [selected, setSelected] = useState<Sensor | null>(null);

  const isStale = useMemo(() => {
    if (!lastUpdated) return false;
    return Date.now() - lastUpdated.getTime() > STALE_AFTER_MS;
  }, [lastUpdated]);

  const included = sensors.filter((s) => !s.excluded).length;

  const handleSelect = (sensor: Sensor) => {
    setSelected(sensor);
    onSensorSelect?.(sensor);
  };

  return (
    <div className="sensor-map">
      <h2>Sensor Map</h2>
      <div className="sensor-map__status" aria-live="polite">
        <span>
          Last updated: <b>{formatTime(lastUpdated)}</b>
        </span>
        {isStale && <span className="stale">Data may be stale</span>}
        <span>
          {included} of {sensors.length} sensors used in averages
        </span>
        {loading && <span>Loading sensors…</span>}
      </div>
      {error && <div className="sensor-map__error" role="alert">Could not load sensors: {error}</div>}

      <AqiLegend />

      <MapContainer center={MAP_CENTER} zoom={MAP_ZOOM} className="sensor-map__map" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {sensors.map((sensor) => {
          const color = colorFor(sensor.excluded ? null : sensor.aqi_category);
          return (
            <CircleMarker
              key={sensor.id}
              center={[sensor.lat, sensor.lng]}
              radius={sensor.excluded ? 7 : 10}
              pathOptions={{
                color: '#222',
                weight: 1,
                fillColor: color,
                fillOpacity: sensor.excluded ? 0.45 : 0.9,
                dashArray: sensor.excluded ? '3 3' : undefined,
              }}
              eventHandlers={{ click: () => handleSelect(sensor) }}
            >
              <Popup>
                <SensorPopup sensor={sensor} />
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <details className="sensor-map__list">
        <summary>Sensor list ({sensors.length})</summary>
        <ul>
          {sensors
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => (
              <li key={s.id}>
                <span
                  className="aqi-legend__swatch"
                  style={{ background: colorFor(s.excluded ? null : s.aqi_category) }}
                  aria-hidden="true"
                />
                <button type="button" onClick={() => handleSelect(s)}>{s.name}</button>
                <span style={{ marginLeft: 'auto' }}>
                  {s.excluded ? 'excluded' : `${fmt(s.pm25_corrected)} µg/m³`}
                </span>
              </li>
            ))}
        </ul>
      </details>

      {selected && (
        <div className="sensor-details" aria-live="polite" style={{ marginTop: 12 }}>
          <SensorPopup sensor={selected} />
        </div>
      )}
    </div>
  );
};

export default SensorMap;
