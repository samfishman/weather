// URL builders for the Open-Meteo APIs the pipeline uses. All are free, keyless and allow CORS.

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const SINGLE_RUNS = 'https://single-runs-api.open-meteo.com/v1/forecast';
const ENSEMBLE = 'https://ensemble-api.open-meteo.com/v1/ensemble';

export const FORECAST_DAYS = 16;

/** Pressure levels used for the snow level profile, with standard-atmosphere heights (m) to skip levels under the terrain. */
const PRESSURE_LEVELS: [number, number][] = [
  [1000, 110], [950, 540], [925, 760], [900, 990], [850, 1460], [800, 1950],
  [750, 2470], [700, 3010], [650, 3590], [600, 4210], [550, 4870], [500, 5570],
];

/** Pressure levels worth requesting at this elevation: everything that can sit above the ground. */
export function levelsFor(elevation: number | null): number[] {
  const floor = elevation == null ? -Infinity : elevation - 300;
  return PRESSURE_LEVELS.filter(([, z]) => z >= floor).map(([p]) => p);
}

export function levelVars(levels: number[]): string[] {
  return levels.flatMap((p) => [`temperature_${p}hPa`, `relative_humidity_${p}hPa`, `geopotential_height_${p}hPa`]);
}

/** A forecast point. With `elevation` (m), Open-Meteo downscales every model to that height; without it, it uses the 90 m terrain under the point. */
export interface Point {
  lat: number;
  lon: number;
  elevation?: number | null;
}

function pointParams(p: Point): Record<string, number> {
  const out: Record<string, number> = { latitude: p.lat, longitude: p.lon };
  if (p.elevation != null) out.elevation = Math.round(p.elevation);
  return out;
}

function url(base: string, params: Record<string, string | number>): string {
  const q = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%2C/g, ',')}`)
    .join('&');
  return `${base}?${q}`;
}

const CURRENT_VARS = [
  'temperature_2m', 'apparent_temperature', 'weather_code', 'wind_speed_10m',
  'wind_direction_10m', 'wind_gusts_10m', 'is_day',
];

const BEST_MATCH_HOURLY = [
  'temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation', 'rain',
  'showers', 'snowfall', 'weather_code', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
  'cloud_cover', 'relative_humidity_2m', 'cape', 'is_day', 'surface_pressure',
];

// Other daily values are computed from the hourly data (see dailyFromHourly).
const DAILY_VARS = ['sunrise', 'sunset'];

/** Hourly variables fetched for every model run. */
export const RUN_HOURLY = [
  'temperature_2m', 'relative_humidity_2m', 'surface_pressure', 'precipitation', 'snowfall',
  'wind_speed_10m', 'wind_gusts_10m', 'cloud_cover',
];

/** The main forecast: Open-Meteo's best match (the local best model at each lead time). */
export function bestMatchUrl(p: Point, levels: number[]): string {
  return url(FORECAST, {
    ...pointParams(p),
    current: CURRENT_VARS.join(','),
    hourly: [...BEST_MATCH_HOURLY, ...levelVars(levels)].join(','),
    daily: DAILY_VARS.join(','),
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: FORECAST_DAYS,
  });
}

/** NBM for the main forecast (same grid as best match). Open-Meteo returns HTTP 400 outside its domain. */
export function nbmUrl(p: Point): string {
  return url(FORECAST, {
    ...pointParams(p),
    current: CURRENT_VARS.join(','),
    hourly: [...BEST_MATCH_HOURLY.filter((v) => v !== 'surface_pressure'), 'snowfall_height'].join(','),
    models: 'ncep_nbm_conus',
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: FORECAST_DAYS,
  });
}

/** One past or current run of several models, all initialised at `run` (unix seconds). */
export function singleRunUrl(p: Point, models: string[], run: number, levels: number[], extraVars: string[] = []): string {
  return url(SINGLE_RUNS, {
    ...pointParams(p),
    hourly: [...RUN_HOURLY, ...extraVars, ...levelVars(levels)].join(','),
    models: models.join(','),
    run: new Date(run * 1000).toISOString().slice(0, 16),
    timeformat: 'unixtime',
    forecast_days: FORECAST_DAYS,
  });
}

export const ENSEMBLE_HOURLY = ['temperature_2m', 'precipitation', 'snowfall', 'wind_speed_10m', 'wind_gusts_10m', 'cloud_cover'];

export function ensembleUrl(p: Point, models: string[]): string {
  return url(ENSEMBLE, {
    ...pointParams(p),
    hourly: ENSEMBLE_HOURLY.join(','),
    models: models.join(','),
    timeformat: 'unixtime',
    forecast_days: FORECAST_DAYS,
  });
}

export function elevationUrl(lat: number, lon: number): string {
  return url('https://api.open-meteo.com/v1/elevation', { latitude: lat, longitude: lon });
}

export function metaUrl(dataset: string): string {
  return `https://api.open-meteo.com/data/${dataset}/static/meta.json`;
}

export interface OpenMeteoHourly {
  time: number[];
  [key: string]: (number | null)[];
}
