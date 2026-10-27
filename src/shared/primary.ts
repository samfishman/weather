// The main forecast (Now, the 15-day strip, hourly tabs and the blend line): NOAA's National Blend of
// Models where it covers the point, Open-Meteo's best match elsewhere and after NBM's ~11-day range.
//
// NBM blends ~30 models and corrects them against observations. Over one week of late-October day-1
// forecasts at 15 US airports it beat best match on temperature (mean error 1.43 °C vs 1.96 °C, better
// at 12 of 15 stations), so it is preferred wherever it exists.

import type { OpenMeteoHourly } from './openmeteo';

/** Hours over which NBM fades into best match at the end of its range, so lines don't jump. */
export const CROSSFADE_HOURS = 12;

const NUMERIC = [
  'temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation', 'rain', 'showers',
  'snowfall', 'wind_speed_10m', 'wind_gusts_10m', 'cloud_cover', 'relative_humidity_2m', 'cape',
];
const CATEGORICAL = ['weather_code', 'wind_direction_10m', 'is_day'];

export interface Merged {
  hourly: OpenMeteoHourly;
  /** NBM's weight (0 to 1) at each grid hour. */
  weights: number[];
  /** Last grid hour with NBM data, or null when NBM doesn't cover the point. */
  nbmUntil: number | null;
}

/** Weight of NBM at each grid hour: 1 where it has data, fading to 0 over its last CROSSFADE_HOURS hours. */
export function nbmWeights(times: number[], nbm: OpenMeteoHourly | null): { weights: number[]; byIndex: (number | null)[]; last: number | null } {
  const byIndex: (number | null)[] = new Array(times.length).fill(null);
  if (!nbm) return { weights: new Array(times.length).fill(0), byIndex, last: null };
  const pos = new Map(nbm.time.map((t, j) => [t, j]));
  let last: number | null = null;
  times.forEach((t, i) => {
    const j = pos.get(t);
    if (j != null && nbm.temperature_2m?.[j] != null) {
      byIndex[i] = j;
      last = i;
    }
  });
  const weights = times.map((_, i) => {
    if (byIndex[i] == null || last == null) return 0;
    return Math.max(0, Math.min(1, (last - i) / CROSSFADE_HOURS));
  });
  return { weights, byIndex, last };
}

/** Best match with NBM blended in hour by hour. Keys NBM lacks (pressure levels) stay best match. */
export function mergeHourly(best: OpenMeteoHourly, nbm: OpenMeteoHourly | null): Merged {
  const { weights, byIndex, last } = nbmWeights(best.time, nbm);
  if (!nbm || last == null) return { hourly: best, weights, nbmUntil: null };
  const out: OpenMeteoHourly = { ...best };
  for (const key of [...NUMERIC, ...CATEGORICAL]) {
    const b = best[key];
    const n = nbm[key];
    if (!b || !n) continue;
    const categorical = CATEGORICAL.includes(key);
    out[key] = b.map((bv, i) => {
      const j = byIndex[i];
      const nv = j == null ? null : n[j];
      const w = weights[i];
      if (nv == null || w === 0) return bv;
      if (bv == null) return nv;
      if (categorical) return w >= 0.5 ? nv : bv;
      return w * nv + (1 - w) * bv;
    });
  }
  return { hourly: out, weights, nbmUntil: last };
}

/** Blend two series with the NBM weights (used for snow level, where NBM supplies its own). */
export function blendSeries(bestSeries: (number | null)[], nbmSeries: (number | null)[], m: Pick<Merged, 'weights'>): (number | null)[] {
  return bestSeries.map((bv, i) => {
    const nv = nbmSeries[i];
    const w = m.weights[i];
    if (nv == null || w === 0) return bv;
    if (bv == null) return nv;
    return w * nv + (1 - w) * bv;
  });
}
