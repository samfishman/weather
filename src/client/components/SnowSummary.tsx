import type { Bundle, Series } from '../../shared/types';
import { MODEL_BY_KEY } from '../../shared/models';
import { fmtDayTiny, fmtElevation, fmtHeight, fmtPrecip, toSnow, type Units } from '../format';
import { bundlePeriods, dayStarts, nowIndex } from '../metrics';

function sum(s: Series, a: number, b: number): number {
  let total = 0;
  for (let i = a; i < b; i++) total += s[i] ?? 0;
  return total;
}

/** Whole numbers from 3" up, one decimal below; centimeters likewise from 10 cm. */
function amount(cm: number, u: Units): string {
  const v = toSnow(cm, u);
  const big = u === 'imperial' ? v >= 3 : v >= 10;
  return big ? String(Math.round(v)) : v < 0.05 ? '0' : v.toFixed(1).replace(/\.0$/, '');
}

const unit = (u: Units) => (u === 'imperial' ? '"' : ' cm');

interface Window {
  label: string;
  a: number;
  b: number;
}

export function SnowSummary({ bundle, units }: { bundle: Bundle; units: Units }) {
  const tz = bundle.location.timezone;
  const now = nowIndex(bundle);
  const starts = dayStarts(bundle);
  const periods = bundlePeriods(bundle);
  const blend = bundle.blend;

  // A day's snow is the previous night plus that day (6pm to 6pm), so it's what you'd ski that day. Only future hours count.
  const days = bundle.daily.time.slice(0, 15).map((time, d) => {
    const end = periods[2 * d]?.[1] ?? starts[d] + 18;
    const begin = Math.min(end, Math.max(now, d === 0 ? 0 : (periods[2 * d - 1]?.[0] ?? starts[d] - 6)));
    const depth = sum(blend.snow, begin, end);
    const liquid = sum(blend.snowLiquid, begin, end);
    return { time, begin, end, depth, liquid };
  });
  const endOf = (d: number) => days[Math.min(d, days.length - 1)]?.end ?? now;

  const windows: Window[] = [
    { label: 'Next 24 hours', a: now, b: now + 24 },
    { label: 'Next 1–5 days', a: now, b: endOf(4) },
    { label: 'Next 6–10 days', a: endOf(4), b: endOf(9) },
    { label: 'Next 11–15 days', a: endOf(9), b: endOf(14) },
  ];

  // The latest run of each model that covers the whole window. Ensembles carry no snow-level profile, so they sit this out.
  const latest = bundle.runs.filter((r) => r.age === 0 && MODEL_BY_KEY[r.model].kind === 'deterministic');
  const range = (w: Window) => {
    const totals = latest.filter((r) => r.snow[w.b - 1] != null).map((r) => sum(r.snow, w.a, w.b));
    return totals.length >= 2 ? { min: Math.min(...totals), max: Math.max(...totals), n: totals.length } : null;
  };

  const peak = Math.max(...days.map((d) => d.depth), 0);
  const scale = Math.max(peak, 7.62); // Scale tops out at 3" or more, so light snow looks light.
  const anySnow = windows.some((w) => sum(blend.snow, w.a, w.b) >= 0.25);

  // Lowest snow level while it's actually precipitating, over the next 10 days.
  let lowest: { level: number; hour: number } | null = null;
  for (let i = now; i < endOf(9); i++) {
    const level = blend.snowLevel[i];
    if (level != null && (blend.precip[i] ?? 0) >= 0.25 && (!lowest || level < lowest.level)) lowest = { level, hour: i };
  }

  const totalDepth = sum(blend.snow, now, endOf(14));
  const totalLiquid = sum(blend.snowLiquid, now, endOf(14));
  const ratio = totalLiquid >= 0.25 ? Math.round((totalDepth * 10) / totalLiquid) : null;

  return (
    <section class="section snowsum">
      <div class="section-head">
        <h2>Snow Summary</h2>
        <span class="muted small">At {fmtElevation(bundle.location.elevation, units)}</span>
      </div>
      <div class="card">
        {anySnow ? (
          <>
            <div class="sn-windows">
              {windows.map((w, i) => {
                const r = range(w);
                const total = sum(blend.snow, w.a, w.b);
                return (
                  <div class={`sn-window${i === 0 ? ' first' : ''}`} key={w.label}>
                    <div class="sn-label">{w.label}</div>
                    <div class="sn-big">
                      {amount(total, units)}
                      <span class="sn-unit">{unit(units)}</span>
                    </div>
                    <div class="sn-range" title={r ? `Latest run of ${r.n} models` : undefined}>
                      {r ? `Models ${amount(r.min, units)}–${amount(r.max, units)}${unit(units)}` : bundle.runsStatus === 'pending' ? 'Models loading…' : 'Too few models'}
                    </div>
                  </div>
                );
              })}
            </div>
            <div class="sn-days" role="img" aria-label="Snow by day for the next 15 days">
              {days.map((d, i) => {
                // Judged on the number shown, so a bar labeled 6" is always a powder day.
                const powder = Math.round(toSnow(d.depth, units)) >= (units === 'imperial' ? 6 : 15);
                return (
                  <div class={`sn-day${powder ? ' powder' : ''}`} key={d.time} title={`${amount(d.depth, units)}${unit(units)} snow, ${fmtPrecip(d.liquid, units)} liquid`}>
                    <div class="sn-plot">
                      {d.depth >= 0.05 && <span class="sn-val">{amount(d.depth, units)}</span>}
                      <span class={`sn-bar${d.depth >= 0.05 ? '' : ' none'}`} style={{ height: `${Math.round((d.depth / scale) * 80)}%` }} />
                    </div>
                    <span class="sn-name">
                      {i === 0 ? (
                        'Now'
                      ) : (
                        <>
                          {fmtDayTiny(d.time, tz).split(' ')[0]}
                          <br />
                          {fmtDayTiny(d.time, tz).split(' ')[1]}
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div class="sn-none">No snow in the 15-day forecast at this elevation.</div>
        )}
        <div class="sn-foot">
          {lowest && (
            <span>
              Lowest snow level {fmtHeight(lowest.level, units)} ({fmtDayTiny(bundle.grid.start + lowest.hour * bundle.grid.step, tz)})
            </span>
          )}
          {ratio != null && <span>Average snow ratio {ratio}:1</span>}
          {anySnow && (
            <span class="sn-key">
              <i />
              {units === 'imperial' ? '6"+' : '15 cm+'} powder day
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
