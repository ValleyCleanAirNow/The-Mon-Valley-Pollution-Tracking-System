import React, { useMemo } from 'react';
import { CircleMarker, Marker, Polygon, Popup } from 'react-leaflet';
import L from 'leaflet';
import { colorFor, textColorFor } from '../lib/aqi';
import { hexCellsInPolygon } from '../lib/hexgrid';
import { HEX_RADIUS_KM, RISK_LEVEL_STYLE, smellColor } from '../lib/mapLayers';
import { describeZone, type Facility, type FacilityStatus } from '../types/facility';
import type { DistributionSite, SmellReport } from '../types/layers';

const factoryIcon = L.divIcon({ className: 'facility-icon', html: '<span aria-hidden="true">🏭</span>', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
const heartIcon = L.divIcon({ className: 'facility-icon', html: '<span aria-hidden="true">❤️</span>', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });

function fmtTime(d: Date | null): string {
  return d ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}

export const FacilityPopup: React.FC<{ facility: Facility; status?: FacilityStatus }> = ({ facility, status }) => (
  <div className="sensor-popup facility-popup">
    <strong>{facility.name}</strong>
    {facility.operator && <div className="facility-popup__muted">{facility.operator}</div>}
    {status ? (
      <>
        {status.risk_level && (
          <span className="sensor-popup__badge" style={{ background: RISK_LEVEL_STYLE[status.risk_level].color, color: RISK_LEVEL_STYLE[status.risk_level].text }}>
            Risk {RISK_LEVEL_STYLE[status.risk_level].label}{status.risk_score != null && ` · index ${status.risk_score}`}
          </span>
        )}
        {status.aqi_category && (
          <span className="sensor-popup__badge" style={{ background: colorFor(status.aqi_category), color: textColorFor(status.aqi_category), marginLeft: 6 }}>
            Nearby air: {status.aqi_category}{status.pm25_corrected != null && ` · PM2.5 ${status.pm25_corrected.toFixed(0)}`}
          </span>
        )}
        <div>{describeZone(status)}</div>
        {status.risk_inputs && status.risk_inputs.pm_cal != null && (
          <div className="facility-popup__muted">
            Index = (PM {status.risk_inputs.pm_cal} × toxicity {status.risk_inputs.w_tox} × wind {status.risk_inputs.w_wind}) + (odor {status.risk_inputs.odor_score} × {status.risk_inputs.w_odor})
          </div>
        )}
        <div className="facility-popup__muted">{status.sensor_count} sensor{status.sensor_count === 1 ? '' : 's'} within {status.radius_km} km</div>
      </>
    ) : (
      <div className="facility-popup__muted">Status not computed yet.</div>
    )}
    {facility.permitId && (
      <div className="facility-popup__muted">{facility.permitType ?? 'Permit'} {facility.permitId}{facility.expirationDate && ` · expires ${facility.expirationDate}`}</div>
    )}
    {facility.permittedPollutants && facility.permittedPollutants.length > 0 && (
      <div className="facility-popup__muted">Permitted: {facility.permittedPollutants.map((p) => `${p.pollutant}${p.limit != null ? ` ${p.limit} ${p.unit ?? ''}`.trimEnd() : ''}`).join(', ')}</div>
    )}
    {facility.violations && facility.violations.length > 0 && (
      <div className="facility-popup__violation">Latest violation {facility.violations[facility.violations.length - 1].date}: {facility.violations[facility.violations.length - 1].description}</div>
    )}
  </div>
);

/** Facility markers plus hexagon risk zones. */
export const FacilityLayer: React.FC<{ facilities: Facility[]; statuses: Record<string, FacilityStatus> }> = ({ facilities, statuses }) => {
  const cells = useMemo(() => {
    const out: Record<string, Array<Array<[number, number]>>> = {};
    for (const f of facilities) {
      const s = statuses[f.facilityId] ?? statuses[f.id];
      if (!s || s.zone_polygon.length < 4) continue;
      out[f.id] = hexCellsInPolygon(s.zone_polygon, HEX_RADIUS_KM).map((cell) => cell.map((p) => [p.lat, p.lng] as [number, number]));
    }
    return out;
  }, [facilities, statuses]);

  return (
    <>
      {facilities.map((f) => {
        const s = statuses[f.facilityId] ?? statuses[f.id];
        const level = s?.risk_level ?? 'low';
        const color = RISK_LEVEL_STYLE[level].color;
        return (
          <React.Fragment key={f.id}>
            {s && s.zone_polygon.length >= 4 && level === 'low' && (
              <Polygon positions={s.zone_polygon.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color, weight: 1.5, dashArray: '4 4', fill: false }} interactive={false} />
            )}
            {s && level !== 'low' && (cells[f.id] ?? []).map((cell, i) => (
              <Polygon key={i} positions={cell} pathOptions={{ color, weight: 1, fillColor: color, fillOpacity: 0.35 }} interactive={false} />
            ))}
            {s && <CircleMarker center={[f.location.lat, f.location.lng]} radius={s.radius_km * 4} pathOptions={{ color: '#555', weight: 1, dashArray: '2 4', fill: false }} interactive={false} />}
            <Marker position={[f.location.lat, f.location.lng]} icon={factoryIcon} zIndexOffset={1000}>
              <Popup><FacilityPopup facility={f} status={s} /></Popup>
            </Marker>
          </React.Fragment>
        );
      })}
    </>
  );
};

export const SmellLayer: React.FC<{ reports: SmellReport[] }> = ({ reports }) => (
  <>
    {reports.map((r) => (
      <CircleMarker key={r.id} center={[r.lat, r.lng]} radius={6} pathOptions={{ color: '#4e342e', weight: 1, fillColor: smellColor(r.smell_value), fillOpacity: 0.85 }}>
        <Popup>
          <div className="sensor-popup">
            <strong>Smell report: {r.smell_value} of 5</strong>
            {r.description && <div>{r.description}</div>}
            <div className="facility-popup__muted">{fmtTime(r.observed_at)} · Smell PGH</div>
          </div>
        </Popup>
      </CircleMarker>
    ))}
  </>
);

export const DistributionLayer: React.FC<{ sites: DistributionSite[] }> = ({ sites }) => (
  <>
    {sites.map((s) => (
      <Marker key={s.id} position={[s.lat, s.lng]} icon={heartIcon} zIndexOffset={900}>
        <Popup>
          <div className="sensor-popup">
            <strong>{s.name}</strong>
            {s.what && <div>{s.what}</div>}
            {s.address && <div className="facility-popup__muted">{s.address}</div>}
            {s.date && <div className="facility-popup__muted">{s.date}</div>}
            {s.notes && <div className="facility-popup__muted">{s.notes}</div>}
            <div className="facility-popup__muted">Valley Clean Air Now distribution</div>
          </div>
        </Popup>
      </Marker>
    ))}
  </>
);
