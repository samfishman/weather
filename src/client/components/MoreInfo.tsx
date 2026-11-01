import type { Bundle } from '../../shared/types';
import { Icon } from '../icons';
import { fmtAgo, fmtElevation, type Units } from '../format';
import type { BundleSource } from '../data';

export function MoreInfo({ bundle, units, source }: { bundle: Bundle; units: Units; source: BundleSource }) {
  const { lat, lon, elevation } = bundle.location;
  return (
    <section class="section">
      <h2>About This Forecast</h2>
      <div class="card">
        <div class="info-grid">
          <div class="info-item">
            <Icon name="pin" size={22} />
            <span>
              Forecast Point
              <br />
              <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=12/${lat}/${lon}`} target="_blank" rel="noreferrer">
                {fmtElevation(elevation, units)} • {lat.toFixed(2)}, {lon.toFixed(2)}
              </a>
            </span>
          </div>
          <div class="info-item">
            <Icon name="clock" size={22} />
            <span>
              Updated <b>{fmtAgo(bundle.generatedAt)}</b> from
              <br />
              {bundle.runs.length} model runs via Open-Meteo{source === 'browser' ? ' (fetched by this browser)' : ''}
            </span>
          </div>
          <div class="info-item">
            <Icon name="info" size={22} />
            <a href="#how-to-read">How to read this data</a>
          </div>
        </div>
      </div>
      <details class="card explainer" id="how-to-read">
        <summary>How to read this data</summary>
        <ul>
          <li><b>Now</b>, the 15-day strip and the hourly tabs come from the main forecast: in the US, NOAA's National Blend of Models (NBM), which corrects ~30 models against observations, for its ~11 days; elsewhere and after that, Open-Meteo's best match. Both are adjusted to the forecast point's elevation. They are model estimates, not station readings.</li>
          <li><b>Model Spread</b> draws every model run as a thin line and the blend as a thick one. Tight lines mean the models agree; a wide spread means low confidence. Pick a model to highlight its latest run (thick cyan) and the two runs before it (thin cyan).</li>
          <li><b>Precip by Model Run</b> lists liquid precipitation per 12-hour period for each run. Color shows rain (teal), mix (amber), snow (blue) or heavy snow (violet). Storm Totals adds up consecutive wet periods.</li>
          <li><b>Forecast elevation</b> is shown at the top. Every model is adjusted to it, so temperature, snow level and precipitation type depend on it: about 3.5°F colder per 1,000 ft. It is the place's listed elevation for searched places and the terrain under the pin otherwise. In steep terrain, check it and change it if the pin sits on a slope or a wall. Pick points on the map to see the terrain elevation under the cursor.</li>
          <li><b>Snow level</b> is the elevation where the wet-bulb temperature falls to 0.5°C, the method the National Weather Service uses. It is often 500 to 1,500 ft below the freezing level, more in dry air. NBM supplies its own snow level.</li>
          <li><b>Lightning</b> chance combines thunderstorm forecasts, instability (CAPE) and precipitation chance.</li>
          <li>Ensembles (EPS, AIGEFS) show the mean of all members for their latest run.</li>
        </ul>
      </details>
      <p class="footer">
        Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> (CC BY 4.0) from ECMWF, NOAA, DWD and
        ECCC models. Place search by Open-Meteo; your location's name by BigDataCloud.
      </p>
    </section>
  );
}
