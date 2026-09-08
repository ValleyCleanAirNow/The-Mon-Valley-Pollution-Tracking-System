import React from 'react';
import { AQI_CATEGORIES, AQI_COLORS, NO_DATA_COLOR } from '../lib/aqi';
import './SensorMap.css';

/** Colour key for AQI categories, shared by the map and the dashboard. */
export const AqiLegend: React.FC<{ showFacilities?: boolean }> = ({ showFacilities = false }) => (
  <ul className="aqi-legend" aria-label="AQI legend">
    {AQI_CATEGORIES.map((c) => (
      <li key={c}>
        <span className="aqi-legend__swatch" style={{ background: AQI_COLORS[c] }} aria-hidden="true" />
        {c}
      </li>
    ))}
    <li>
      <span className="aqi-legend__swatch" style={{ background: NO_DATA_COLOR }} aria-hidden="true" />
      Excluded or no data
    </li>
    {showFacilities && (
      <>
        <li>
          <span className="aqi-legend__facility" aria-hidden="true">🏭</span>
          Title V facility
        </li>
        <li>
          <span className="aqi-legend__zone" aria-hidden="true" />
          Risk zone: downwind of a plant, coloured by nearby sensors
        </li>
      </>
    )}
  </ul>
);

export default AqiLegend;
