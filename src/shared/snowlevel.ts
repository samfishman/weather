// Snow level: the height where the wet-bulb temperature falls to +0.5 °C.
//
// This is the NWS Western Region standard (Van Cleave et al., NWS Technical Attachment 19-01),
// also used by the National Blend of Models. Wet-bulb temperature accounts for evaporative
// cooling as precipitation falls into drier air, so the gap between snow level and freezing
// level changes with humidity instead of being a fixed offset.
//
// Kept self-contained so the method can be swapped or tuned without touching the pipeline.

export interface ProfileLevel {
  /** Pressure, hPa. */
  p: number;
  /** Air temperature, °C. */
  t: number | null;
  /** Relative humidity, %. */
  rh: number | null;
  /** Geopotential height above sea level, m. */
  z: number | null;
}

export interface Profile {
  /** Elevation of the surface point, m. */
  elevation: number;
  /** 2 m temperature (°C), 2 m relative humidity (%), surface pressure (hPa). */
  t2m: number | null;
  rh2m: number | null;
  psfc: number | null;
  levels: ProfileLevel[];
  /** Precipitation in this hour, mm (only used by the optional heavy-precip adjustment). */
  precip?: number | null;
}

export interface SnowLevelOptions {
  /** Wet-bulb temperature that marks the snow level, °C. NWS uses 0.5. */
  thresholdC: number;
  /** Lapse rate used to extrapolate below the surface when the whole column is colder than the threshold, °C per m. */
  belowGroundLapse: number;
  /**
   * Optional: lower the snow level in heavy precipitation (melting cooling). Forecasters often do this;
   * models capture part of it already. Metres of lowering at `heavyPrecipMm` per hour or more, scaled linearly from 1 mm/h.
   */
  heavyPrecipLowering: number;
  heavyPrecipMm: number;
  /** Optional fixed lowering, m, e.g. ~170 m for windward slopes (Minder & Kingsmill 2013). */
  terrainLowering: number;
}

export const DEFAULT_SNOW_LEVEL_OPTIONS: SnowLevelOptions = {
  thresholdC: 0.5,
  belowGroundLapse: 0.006,
  heavyPrecipLowering: 0,
  heavyPrecipMm: 4,
  terrainLowering: 0,
};

/** Saturation vapour pressure over water, hPa (Bolton 1980). */
function satVapor(tC: number): number {
  return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
}

/**
 * Wet-bulb temperature (°C) from air temperature (°C), relative humidity (%) and pressure (hPa),
 * solved from the psychrometric equation by bisection. There is no closed form.
 */
export function wetBulb(tC: number, rh: number, pHpa: number): number {
  const e = (Math.max(rh, 1) / 100) * satVapor(tC);
  let lo = -80;
  let hi = tC;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const f = satVapor(mid) - 0.00066 * (1 + 0.00115 * mid) * pHpa * (tC - mid) - e;
    if (f > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Highest height where `values` cross `threshold` going down from the top of the profile,
 * interpolated linearly in height. Points must be sorted by ascending height.
 * Returns null when every point is warmer than the threshold, and -Infinity when every point
 * is colder (the crossing is below the lowest point).
 */
function crossingHeight(points: { z: number; v: number }[], threshold: number): number | null {
  for (let i = points.length - 1; i > 0; i--) {
    const upper = points[i];
    const lower = points[i - 1];
    if (upper.v < threshold && lower.v >= threshold) {
      return lower.z + ((lower.v - threshold) * (upper.z - lower.z)) / (lower.v - upper.v);
    }
  }
  if (points.length && points[0].v < threshold) return -Infinity;
  return null;
}

/** Snow level in metres above sea level, or null when it can't be computed. Never below 0. */
export function snowLevel(profile: Profile, options: SnowLevelOptions = DEFAULT_SNOW_LEVEL_OPTIONS): number | null {
  const points: { z: number; v: number }[] = [];
  if (profile.t2m != null && profile.rh2m != null && profile.psfc != null) {
    points.push({ z: profile.elevation, v: wetBulb(profile.t2m, profile.rh2m, profile.psfc) });
  }
  // Pressure levels above the surface, ascending in height. Levels at or below ground are extrapolated by the model; skip them.
  const above = profile.levels
    .filter((l) => l.t != null && l.rh != null && l.z != null && l.z > profile.elevation + 20)
    .sort((a, b) => a.z! - b.z!);
  for (const l of above) points.push({ z: l.z!, v: wetBulb(l.t!, l.rh!, l.p) });
  if (points.length < 2) return null;

  let level = crossingHeight(points, options.thresholdC);
  if (level == null) return null;
  if (level === -Infinity) {
    // The whole column is below the threshold: the snow level is under the surface point.
    level = points[0].z - (options.thresholdC - points[0].v) / options.belowGroundLapse;
  }

  if (options.heavyPrecipLowering > 0 && profile.precip != null && profile.precip > 1) {
    const f = Math.min(1, (profile.precip - 1) / (options.heavyPrecipMm - 1));
    level -= f * options.heavyPrecipLowering;
  }
  level -= options.terrainLowering;
  return Math.max(0, Math.round(level));
}
