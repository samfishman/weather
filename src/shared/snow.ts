// Snowfall at the forecast elevation: liquid precip × the share falling as snow × a snow-to-liquid ratio.
// This is the usual western US recipe (QPF, snow level, snow ratio; NWS TA 19-01). It replaces Open-Meteo's
// `snowfall`, which caps at 7:1 for the global models and, for NBM, ignores the requested elevation.

import type { Profile } from './snowlevel';

/** Rain and snow mix within a few hundred feet of the snow level (the NWS definition), m either side. */
const MIX_HALF_WIDTH = 100;

/** Share of precipitation falling as snow at `elevation` (m), given the snow level (m). No snow level means a warm column. */
export function snowFraction(elevation: number, level: number | null): number {
  if (level == null) return 0;
  if (level <= 0) return 1; // Cold all the way down: levels are clamped at sea level.
  return Math.max(0, Math.min(1, (elevation - level + MIX_HALF_WIDTH) / (2 * MIX_HALF_WIDTH)));
}

/**
 * Kuchera snow-to-liquid ratio from the warmest temperature (°C) in the column up to 500 hPa.
 * Widely used and a clear step up from a fixed 10:1, though it's a rough fit (Pivotal Weather, NOAA VLab).
 */
export function kucheraRatio(tMaxC: number): number {
  const k = tMaxC + 273.15;
  const slr = k > 271.16 ? 12 + 2 * (271.16 - k) : 12 + (271.16 - k);
  return Math.max(3, Math.min(30, slr));
}

/** Warmest temperature (°C) from the surface to the top of a profile, ignoring levels below ground. */
export function columnMax(p: Profile): number | null {
  const temps = p.levels.filter((l) => l.t != null && l.z != null && l.z > p.elevation + 20).map((l) => l.t!);
  if (p.t2m != null) temps.push(p.t2m);
  return temps.length ? Math.max(...temps) : null;
}

export interface HourSnow {
  /** Liquid precip falling as snow, mm. */
  liquid: number;
  /** Snow depth, cm. */
  depth: number;
  /** Share of precip falling as snow, 0 to 1. */
  fraction: number;
}

/** Snow for one hour. Without a column temperature it assumes 10:1. */
export function hourSnow(precipMm: number | null, elevation: number, level: number | null, tMaxC: number | null): HourSnow {
  const fraction = snowFraction(elevation, level);
  const liquid = (precipMm ?? 0) * fraction;
  const ratio = tMaxC == null ? 10 : kucheraRatio(tMaxC);
  return { liquid, depth: (liquid * ratio) / 10, fraction };
}

// WMO codes for the same intensity as rain and as snow.
const RAIN_TO_SNOW: Record<number, number> = { 51: 71, 53: 71, 55: 73, 61: 71, 63: 73, 65: 75, 80: 85, 81: 85, 82: 86 };
const SNOW_TO_RAIN: Record<number, number> = { 71: 61, 73: 63, 75: 65, 77: 61, 85: 80, 86: 82 };

/** Makes a weather code agree with the rain or snow at this elevation (model codes follow the model's own terrain). */
export function codeForFraction(code: number | null, fraction: number): number | null {
  if (code == null) return code;
  if (fraction >= 0.5) return RAIN_TO_SNOW[code] ?? code;
  return SNOW_TO_RAIN[code] ?? code;
}
