import type { Bundle } from '../../shared/types';
import { Icon } from '../icons';
import { fmtAgo, fmtElevation, type Units } from '../format';
import type { BundleSource } from '../data';

export function MoreInfo({ bundle, units, source }: { bundle: Bundle; units: Units; source: BundleSource }) {
  const { lat, lon, elevation } = bundle.location;
  return (
    <section class="section">
      <h2>More Information</h2>
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
          <li><b>Right Now</b>, the daily strip and the hourly tabs come from the main forecast: in the US, NOAA's National Blend of Models (NBM), which corrects ~30 models against observations, for its ~11 days; elsewhere and after that, Open-Meteo's best match. Both are adjusted to the forecast point's elevation. They are model estimates, not station readings.</li>
          <li><b>Forecast Range</b> draws every model run as a thin line and the blend as a thick one. Tight lines mean the models agree; a wide spread means low confidence. Pick a model to highlight its latest run (thick orange) and the two runs before it (thin orange).</li>
          <li><b>Precipitation by Model</b> lists liquid precipitation per 12-hour period for each run. Color shows rain (green), mix (purple), snow (blue) or heavy snow (orange). Storm Totals adds up consecutive wet periods.</li>
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
