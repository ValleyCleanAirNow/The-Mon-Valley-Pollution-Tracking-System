import React from 'react';
import { AQI_CATEGORIES, AQI_COLORS, NO_DATA_COLOR, PM25_BREAKPOINTS_2024 } from '../lib/aqi';
import { RISK_LEVEL_STYLE, SMELL_BUCKETS } from '../lib/mapLayers';
import './SensorMap.css';

export interface LegendSections {
  smell?: boolean;
  zones?: boolean;
  facilities?: boolean;
  distribution?: boolean;
}

const Swatch: React.FC<{ color: string; shape?: 'dot' | 'hex' }> = ({ color, shape = 'dot' }) => (
  <span className={shape === 'hex' ? 'legend-hex' : 'aqi-legend__swatch'} style={{ background: color }} aria-hidden="true" />
);

/** Sectioned map legend. Sections appear only when their layer is shown. */
const MapLegend: React.FC<{ sections?: LegendSections }> = ({ sections = {} }) => (
  <div className="map-legend" aria-label="Map legend">
    <details open>
      <summary>Map legend</summary>

      <section>
        <h4>PurpleAir Sensors</h4>
        <ul className="aqi-legend">
          {AQI_CATEGORIES.map((c) => {
            const bp = PM25_BREAKPOINTS_2024.find((b) => b.category === c)!;
            const range = c === 'Hazardous' ? `${bp.cLo}+` : `${bp.cLo}-${bp.cHi}`;
            return (
              <li key={c}><Swatch color={AQI_COLORS[c]} />{c} ({range})</li>
            );
          })}
          <li><Swatch color={NO_DATA_COLOR} />Excluded or no data</li>
        </ul>
        <p className="legend-note">Community-operated sensors providing hourly PM2.5 readings, EPA-corrected, in µg/m³ (EPA 2024 ranges).</p>
      </section>

      {sections.smell && (
        <section>
          <h4>Smell PGH Reports</h4>
          <ul className="aqi-legend">
            {SMELL_BUCKETS.map((b) => (
              <li key={b.label}><Swatch color={b.color} />{b.label}</li>
            ))}
          </ul>
          <p className="legend-note">Crowdsourced odor reports from CMU CREATE Lab's Smell PGH platform, last 24 hours.</p>
        </section>
      )}

      {sections.zones && (
        <section>
          <h4>Risk Zones</h4>
          <ul className="aqi-legend">
            {(['low', 'elevated', 'high', 'severe', 'toxic'] as const).map((l) => (
              <li key={l}><Swatch color={RISK_LEVEL_STYLE[l].color} shape="hex" />{RISK_LEVEL_STYLE[l].label}</li>
            ))}
          </ul>
          <p className="legend-note">Dynamic hexagon zones downwind of each plant from the VCAN Weighted Risk Index: sensor readings, facility toxicity, wind, and odor reports. Low shows as a green outline.</p>
        </section>
      )}

      {sections.facilities && (
        <section>
          <h4>Title V Facilities</h4>
          <ul className="aqi-legend">
            <li><span className="aqi-legend__facility" aria-hidden="true">🏭</span>Industrial facilities with major air pollution permits</li>
          </ul>
          <p className="legend-note">Regulated under Clean Air Act Title V permits.</p>
        </section>
      )}

      {sections.distribution && (
        <section>
          <h4>VCAN Distribution</h4>
          <ul className="aqi-legend">
            <li><span className="aqi-legend__facility" aria-hidden="true">❤️</span>Air filter and purifier distribution locations</li>
          </ul>
          <p className="legend-note">Locations where Valley Clean Air Now has distributed air quality equipment.</p>
        </section>
      )}
    </details>
  </div>
);

export default MapLegend;
