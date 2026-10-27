import { useRef } from 'preact/hooks';
import type { Bundle } from '../../shared/types';
import { compass } from '../../shared/derive';
import { Icon, WeatherIcon, codeText } from '../icons';
import { fmtStamp, fmtTemp, fmtWind, tempUnit, windUnit, type Units } from '../format';

export function RightNow({ bundle, units }: { bundle: Bundle; units: Units }) {
  const c = bundle.current;
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <section class="section">
      <h2>Now</h2>
      <div class="card">
        <div class="now-grid">
          <div class="now-cell">
            <div class="now-main">
              <WeatherIcon code={c.code} isDay={c.isDay} size={26} />
              <span class="big">{fmtTemp(c.temp, units)}</span>
              <span class="unit">{tempUnit(units)}</span>
            </div>
            <div class="now-sub">
              {codeText(c.code, c.isDay)}, feels like <b>{fmtTemp(c.feels, units)}{tempUnit(units)}</b>
            </div>
          </div>
          <div class="now-cell">
            <div class="now-main">
              <Icon name="wind" size={26} />
              <span class="big">{fmtWind(c.wind, units)}</span>
              <span class="unit">{windUnit(units)}</span>
            </div>
            <div class="now-sub">
              {compass(c.windDir)} gusts to <span class="gust">{fmtWind(c.gust, units)}</span> {windUnit(units)}
            </div>
          </div>
        </div>
        <div class="now-foot">
          {fmtStamp(c.time, bundle.location.timezone)}
          <button class="linkbtn" aria-label="About these conditions" onClick={() => dialog.current?.showModal()}>
            <Icon name="info" size={14} />
          </button>
        </div>
      </div>
      <dialog class="modal" ref={dialog} onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
        <h3>Estimated conditions</h3>
        <p>
          These are model estimates for this exact point and elevation from the latest forecast, not a weather station
          reading. They can differ from what a nearby station reports.
        </p>
        <form method="dialog" style={{ marginTop: '14px', textAlign: 'right' }}>
          <button class="pill">Close</button>
        </form>
      </dialog>
    </section>
  );
}
