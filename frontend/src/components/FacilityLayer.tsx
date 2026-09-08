import React from 'react';
import { CircleMarker, Marker, Polygon, Popup } from 'react-leaflet';
import L from 'leaflet';
import { colorFor, NO_DATA_COLOR, textColorFor } from '../lib/aqi';
import { describeZone, type Facility, type FacilityStatus } from '../types/facility';

const factoryIcon = L.divIcon({
  className: 'facility-icon',
  html: '<span aria-hidden="true">🏭</span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -14],
});

export const FacilityPopup: React.FC<{ facility: Facility; status?: FacilityStatus }> = ({ facility, status }) => {
  const color = colorFor(status?.aqi_category ?? null);
  return (
    <div className="sensor-popup facility-popup">
      <strong>{facility.name}</strong>
      {facility.operator && <div className="facility-popup__muted">{facility.operator}</div>}
      {status ? (
        <>
          <span className="sensor-popup__badge" style={{ background: color, color: textColorFor(status.aqi_category) }}>
            {status.aqi_category ? `Nearby air: ${status.aqi_category}` : 'No nearby sensor data'}
            {status.pm25_corrected != null && ` · PM2.5 ${status.pm25_corrected.toFixed(0)}`}
          </span>
          <div>{describeZone(status)}</div>
          <div className="facility-popup__muted">
            {status.sensor_count} sensor{status.sensor_count === 1 ? '' : 's'} within {status.radius_km} km
          </div>
        </>
      ) : (
        <span className="sensor-popup__badge" style={{ background: NO_DATA_COLOR, color: '#fff' }}>Status not computed yet</span>
      )}
      {facility.permitId && (
        <div className="facility-popup__muted">
          {facility.permitType ?? 'Permit'} {facility.permitId}
          {facility.expirationDate && ` · expires ${facility.expirationDate}`}
        </div>
      )}
      {facility.permittedPollutants && facility.permittedPollutants.length > 0 && (
        <div className="facility-popup__muted">
          Permitted: {facility.permittedPollutants.map((p) => `${p.pollutant}${p.limit != null ? ` ${p.limit} ${p.unit ?? ''}`.trimEnd() : ''}`).join(', ')}
        </div>
      )}
      {facility.violations && facility.violations.length > 0 && (
        <div className="facility-popup__violation">
          Latest violation {facility.violations[facility.violations.length - 1].date}: {facility.violations[facility.violations.length - 1].description}
        </div>
      )}
    </div>
  );
};

/**
 * Facility markers and their risk zones. The zone polygon comes from the
 * server; the colour is the measured AQI category of sensors near the plant.
 */
const FacilityLayer: React.FC<{ facilities: Facility[]; statuses: Record<string, FacilityStatus> }> = ({ facilities, statuses }) => (
  <>
    {facilities.map((f) => {
      const s = statuses[f.facilityId] ?? statuses[f.id];
      const color = colorFor(s?.aqi_category ?? null);
      return (
        <React.Fragment key={f.id}>
          {s && s.zone_polygon.length >= 4 && (
            <Polygon
              positions={s.zone_polygon.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.18, dashArray: s.zone_shape === 'circle' ? '6 6' : undefined }}
              interactive={false}
            />
          )}
          {s && (
            <CircleMarker center={[f.location.lat, f.location.lng]} radius={s.radius_km * 4} pathOptions={{ color: '#555', weight: 1, dashArray: '2 4', fill: false }} interactive={false} />
          )}
          <Marker position={[f.location.lat, f.location.lng]} icon={factoryIcon} zIndexOffset={1000}>
            <Popup>
              <FacilityPopup facility={f} status={s} />
            </Popup>
          </Marker>
        </React.Fragment>
      );
    })}
  </>
);

export default FacilityLayer;
