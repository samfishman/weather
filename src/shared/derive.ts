// Small derived quantities shared by the pipeline and the charts.

import type { Series } from './types';

export type PrecipType = 'rain' | 'mix' | 'snow';

/** Liquid equivalent of snowfall: Open-Meteo uses 7 cm of snow per 10 mm of water. */
export function snowWater(snowCm: number): number {
  return (snowCm * 10) / 7;
}

/** Rain, mix or snow from total liquid precip (mm) and snowfall (cm). */
export function precipType(precipMm: number, snowCm: number): PrecipType {
  if (precipMm <= 0) return snowCm > 0 ? 'snow' : 'rain';
  const frac = Math.min(1, snowWater(snowCm) / precipMm);
  if (frac >= 0.8) return 'snow';
  if (frac <= 0.2) return 'rain';
  return 'mix';
}

/**
 * Lightning chance for one hour: 0 none, 1 low, 2 some, 3 high.
 * Open-Meteo's lightning potential only covers Central Europe, so this combines thunderstorm
 * weather codes (95, 96, 99), CAPE (J/kg) and precip probability (%).
 */
export function lightningCategory(code: number | null, cape: number | null, pop: number | null): number {
  const p = pop ?? 0;
  const c = cape ?? 0;
  if (code != null && code >= 95) return p >= 40 ? 3 : 2;
  if (c >= 1500 && p >= 30) return 2;
  if (c >= 500 && p >= 20) return 1;
  return 0;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function round(v: number | null | undefined, digits = 1): number | null {
  if (v == null || Number.isNaN(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function roundSeries(s: Series, digits = 1): Series {
  return s.map((v) => round(v, digits));
}

// Day and night periods run 5am to 5pm and 5pm to 5am local, as on OpenSnow.
export const PERIOD_START_HOUR = 5;

/** A 12-hour period as grid hour indices [start, end). Even periods are days, odd are nights. */
export type Period = [number, number];

/**
 * Periods from the grid indices of each local midnight. Using real midnights keeps 5am and 5pm
 * right across daylight-saving changes (23- and 25-hour days).
 */
export function periodBounds(dayStarts: number[]): Period[] {
  const out: Period[] = [];
  dayStarts.forEach((d, k) => {
    const next = dayStarts[k + 1] ?? d + 24;
    out.push([d + PERIOD_START_HOUR, d + PERIOD_START_HOUR + 12], [d + PERIOD_START_HOUR + 12, next + PERIOD_START_HOUR]);
  });
  return out;
}

/** Index of the period containing an hour, or -1 before the first one. */
export function periodOf(periods: Period[], hour: number): number {
  return periods.findIndex(([a, b]) => hour >= a && hour < b);
}

/** Sum of a series over [a, b), or null when any hour is missing. */
export function sumRange(s: Series, [a, b]: Period): number | null {
  let sum = 0;
  for (let i = a; i < b; i++) {
    const v = s[i];
    if (v == null) return null;
    sum += v;
  }
  return sum;
}

export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compass(deg: number | null): string {
  if (deg == null) return '';
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
