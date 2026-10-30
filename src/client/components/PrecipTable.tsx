import { useMemo } from 'preact/hooks';
import type { Bundle, RunSeries } from '../../shared/types';
import { MODEL_BY_KEY } from '../../shared/models';
import { sumRange, type Period, type PrecipType } from '../../shared/derive';
import { fmtDayTiny, fmtPrecipCell, type Units } from '../format';
import { bundlePeriods, periodType, runLabel, runSpan } from '../metrics';
import { DaysSelect, ModelSelect, blendName, type ModelChoice } from './ForecastRange';

interface Props {
  bundle: Bundle;
  units: Units;
  model: ModelChoice;
  onModel: (m: ModelChoice) => void;
  days: number;
  onDays: (d: number) => void;
  storm: boolean;
  onStorm: (s: boolean) => void;
}

/** `mm` is what the cell shows (the storm total when Storm Totals is on); `periodMm` sets its shade. */
type Cell = { kind: 'value'; mm: number; periodMm: number; type: PrecipType; first: boolean } | { kind: 'empty' } | { kind: 'na' } | { kind: 'hatch' };

// Amount thresholds (inches of liquid per 12 hours) for the four shades of each ramp.
const STEPS_IN = [0.01, 0.1, 0.25, 0.5];

/** 1 (light) to 4 (heavy) for a 12-hour amount; exposed as data-step so themes can style cells. */
function shadeStep(periodMm: number): number {
  return Math.max(1, STEPS_IN.filter((s) => periodMm / 25.4 >= s).length);
}

function shade(type: PrecipType, periodMm: number): string {
  const inches = periodMm / 25.4;
  const step = shadeStep(periodMm);
  // Heavy snow gets its own orange ramp ("more snow"), as on OpenSnow.
  const base = type === 'snow' && inches >= 0.5 ? 'var(--heavy-snow)' : `var(--${type})`;
  const alpha = [0, 28, 45, 65, 88][Math.max(1, step)];
  return `color-mix(in srgb, ${base} ${alpha}%, transparent)`;
}

function rowCells(s: RunSeries, periods: Period[], storm: boolean): Cell[] {
  const [first, last] = runSpan(s.temp);
  let acc = 0;
  let naShown = false;
  return periods.map((p) => {
    if (first < 0 || p[1] - 1 > last) {
      if (first >= 0 && p[0] <= last + 1 && !naShown) {
        naShown = true;
        return { kind: 'na' };
      }
      if (naShown || first >= 0) return { kind: 'hatch' };
      return { kind: 'empty' };
    }
    const mm = sumRange(s.precip, p);
    if (mm == null || p[0] < first) return { kind: 'empty' };
    if (mm < 0.25) {
      acc = 0;
      return { kind: 'empty' };
    }
    const startOfStorm = acc === 0;
    acc += mm;
    return { kind: 'value', mm: storm ? acc : mm, periodMm: mm, type: periodType(s, p) ?? 'rain', first: storm && startOfStorm };
  });
}

export function PrecipTable({ bundle, units, model, onModel, days, onDays, storm, onStorm }: Props) {
  const tz = bundle.location.timezone;
  const periods = useMemo(() => bundlePeriods(bundle).slice(0, days * 2), [bundle, days]);
  const rows = useMemo(
    () => [
      { id: 'blend', label: `★ ${blendName(bundle)}`, model: 'blend' as const, groupStart: false, cells: rowCells(bundle.blend, periods, storm) },
      ...bundle.runs.map((r, i) => ({
        id: `${r.model}-${r.init}`,
        label: runLabel(r) + (MODEL_BY_KEY[r.model].kind === 'ensemble' ? ' (mean)' : ''),
        model: r.model,
        groupStart: i === 0 || bundle.runs[i - 1].model !== r.model,
        cells: rowCells(r, periods, storm),
      })),
    ],
    [bundle, periods, storm],
  );

  const cellText = (c: Cell) => (c.kind === 'value' ? fmtPrecipCell(c.mm, units) : c.kind === 'na' ? 'N/A' : '');

  return (
    <section class="section">
      <h2>Precip by Model Run</h2>
      <div class="card">
        <div class="controls">
          <ModelSelect bundle={bundle} value={model} onChange={onModel} />
          <DaysSelect value={days} onChange={onDays} />
          <span class="vsep" />
          <span class="pill active">Precip (12 hr)</span>
          <label class="switch">
            Storm Totals
            <input type="checkbox" checked={storm} onChange={(e) => onStorm((e.target as HTMLInputElement).checked)} />
          </label>
        </div>
        <div class="table-scroll">
          <table class="ptable">
            <thead>
              <tr>
                <th class="name">Model</th>
                {periods.map((p, k) =>
                  k % 2 === 0 ? (
                    <th colSpan={2} key={k}>
                      {fmtDayTiny(bundle.grid.start + p[0] * bundle.grid.step, tz)}
                    </th>
                  ) : null,
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} class={[r.model === 'blend' ? 'blend' : '', r.model === model ? 'sel' : '', r.groupStart ? 'group-start' : ''].join(' ')}>
                  <td class="name">{r.label}</td>
                  {r.cells.map((c, k) => {
                    return (
                      <td
                        key={k}
                        class={`cell ${c.kind === 'na' ? 'na' : ''} ${c.kind === 'hatch' ? 'hatch' : ''} ${c.kind === 'value' && c.first ? 'first' : ''}`}
                        style={c.kind === 'value' ? { background: shade(c.type, c.periodMm) } : undefined}
                        data-type={c.kind === 'value' ? c.type : undefined}
                        data-step={c.kind === 'value' ? shadeStep(c.periodMm) : undefined}
                        title={c.kind === 'value' ? `${r.label}: ${fmtPrecipCell(c.mm, units)}${units === 'imperial' ? '"' : ' mm'} ${c.type}` : undefined}
                      >
                        {cellText(c)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="ramps">
          <div class="ramp" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--rain) 28%, transparent), var(--rain))' }}>RAIN</div>
          <div class="ramp" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--mix) 28%, transparent), var(--mix))' }}>MIX</div>
          <div class="ramp" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--snow) 28%, transparent), var(--snow))' }}>SNOW</div>
          <div class="ramp" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--heavy-snow) 45%, transparent), var(--heavy-snow))' }}>HEAVY SNOW</div>
        </div>
        <p class="note center" style={{ margin: '6px auto 14px' }}>
          Liquid precipitation per 12 hours ({units === 'imperial' ? 'inches' : 'mm'}), 5am to 5pm and 5pm to 5am local.
          {storm ? ' Storm totals add up each run of wet periods.' : ''} N/A marks where a run ends.
        </p>
      </div>
    </section>
  );
}
