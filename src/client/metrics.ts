// Turns bundle series into what Forecast Range and Precipitation by Model draw, in display units.

import { MODEL_BY_KEY, type ModelKey } from '../shared/models';
import { periodBounds, precipType, sumRange, type Period, type PrecipType } from '../shared/derive';
import type { Bundle, Run, RunSeries, Series } from '../shared/types';
import { fmtRun, toHeight, toPrecip, toTemp, toWind, type Units } from './format';

export type RangeMetric = 'temp' | 'totalPrecip' | 'precip12' | 'wind' | 'gust' | 'cloud' | 'snowLevel';

export const RANGE_METRICS: { key: RangeMetric; label: string; readout: string }[] = [
  { key: 'temp', label: 'Temperature', readout: 'Temperature' },
  { key: 'totalPrecip', label: 'Total Precip', readout: 'Total Precip' },
  { key: 'precip12', label: 'Precip (12 hr)', readout: 'Precip (12 hr)' },
  { key: 'wind', label: 'Wind Speed', readout: 'Wind Speed' },
  { key: 'gust', label: 'Wind Gust', readout: 'Wind Gust' },
  { key: 'cloud', label: 'Cloud Cover', readout: 'Cloud Cover' },
  { key: 'snowLevel', label: 'Snow Level', readout: 'Snow Level' },
];

export interface Line {
  id: string;
  label: string;
  model: ModelKey | 'blend';
  age: number;
  /** For line metrics: one value per grid hour. For precip12: one value per period, index = period. */
  values: Series;
}

export function runLabel(run: Run): string {
  return `${MODEL_BY_KEY[run.model].short} ${fmtRun(run.init)}`;
}

export function nowIndex(b: Bundle): number {
  return Math.max(0, Math.min(b.grid.length - 1, Math.floor((Date.now() / 1000 - b.grid.start) / b.grid.step)));
}

function convert(metric: RangeMetric, v: number, u: Units): number {
  switch (metric) {
    case 'temp': return toTemp(v, u);
    case 'totalPrecip':
    case 'precip12': return toPrecip(v, u);
    case 'wind':
    case 'gust': return toWind(v, u);
    case 'snowLevel': return toHeight(v, u);
    default: return v;
  }
}

function field(metric: RangeMetric): keyof RunSeries {
  switch (metric) {
    case 'temp': return 'temp';
    case 'totalPrecip':
    case 'precip12': return 'precip';
    case 'wind': return 'wind';
    case 'gust': return 'gust';
    case 'cloud': return 'cloud';
    case 'snowLevel': return 'snowLevel';
  }
}

/** Grid index of each local midnight in the bundle. */
export function dayStarts(b: Bundle): number[] {
  return b.daily.time.map((t) => Math.round((t - b.grid.start) / b.grid.step));
}

export function bundlePeriods(b: Bundle): Period[] {
  return periodBounds(dayStarts(b)).filter(([, end]) => end <= b.grid.length);
}

/** Hour range [start, end) of local day `d`. */
export function dayRange(b: Bundle, d: number): Period {
  const starts = dayStarts(b);
  return [starts[d], starts[d + 1] ?? starts[d] + 24];
}

export function metricValues(s: RunSeries, metric: RangeMetric, now: number, u: Units, periods: Period[]): Series {
  const raw = s[field(metric)];
  if (metric === 'precip12') {
    return periods.map((p) => {
      const v = sumRange(raw, p);
      return v == null ? null : convert(metric, v, u);
    });
  }
  if (metric === 'totalPrecip') {
    // Accumulated from the current hour; stops at the end of the run.
    let acc = 0;
    return raw.map((v, i) => {
      if (i < now) return null;
      if (v == null) return null;
      acc += v;
      return convert(metric, acc, u);
    });
  }
  return raw.map((v) => (v == null ? null : convert(metric, v, u)));
}

export function rangeLines(b: Bundle, metric: RangeMetric, u: Units, periods: Period[]): { blend: Line; runs: Line[] } {
  const now = nowIndex(b);
  return {
    blend: { id: 'blend', label: 'Blend', model: 'blend', age: 0, values: metricValues(b.blend, metric, now, u, periods) },
    runs: b.runs.map((r) => ({
      id: `${r.model}-${r.init}`,
      label: runLabel(r),
      model: r.model,
      age: r.age,
      values: metricValues(r, metric, now, u, periods),
    })),
  };
}

/** Rain, mix or snow for a 12-hour period of a run. */
export function periodType(s: RunSeries, period: Period): PrecipType | null {
  const p = sumRange(s.precip, period);
  const sn = sumRange(s.snow, period);
  if (p == null || sn == null || p <= 0) return null;
  return precipType(p, sn);
}

/** First and last grid hours with data in a run. */
export function runSpan(values: Series): [number, number] {
  let first = -1;
  let last = -1;
  values.forEach((v, i) => {
    if (v == null) return;
    if (first < 0) first = i;
    last = i;
  });
  return [first, last];
}
