import type { ModelKey } from './models';

/** An hourly series on the bundle's time grid; null where there is no data. */
export type Series = (number | null)[];

/**
 * Everything the dashboard draws, in metric units (°C, km/h, mm, cm of snow, m).
 * Hourly series share one grid that starts at local midnight today.
 */
export interface Bundle {
  version: 1;
  generatedAt: number;
  location: {
    lat: number;
    lon: number;
    /** Elevation of the forecast point, m. */
    elevation: number;
    timezone: string;
    tzAbbr: string;
    utcOffset: number;
  };
  grid: { start: number; step: number; length: number };
  current: {
    time: number;
    temp: number | null;
    feels: number | null;
    code: number | null;
    wind: number | null;
    windDir: number | null;
    gust: number | null;
    isDay: boolean;
  };
  hourly: {
    temp: Series;
    feels: Series;
    pop: Series;
    precip: Series;
    rain: Series;
    /** Snowfall, cm. */
    snow: Series;
    code: Series;
    wind: Series;
    windDir: Series;
    gust: Series;
    cloud: Series;
    rh: Series;
    isDay: Series;
    /** 0 none, 1 low, 2 some, 3 high. */
    lightning: Series;
    snowLevel: Series;
  };
  daily: {
    time: number[];
    tmax: Series;
    tmin: Series;
    code: Series;
    popMax: Series;
    precip: Series;
    sunrise: number[];
    sunset: number[];
  };
  /** The heavy line and top table row. Open-Meteo best match by default, or the median of the latest runs. */
  blend: RunSeries;
  blendMode: BlendMode;
  runs: Run[];
  /** Models with data at this location, in display order. */
  models: ModelKey[];
  warnings: string[];
}

export type BlendMode = 'best_match' | 'median';

export interface RunSeries {
  temp: Series;
  precip: Series;
  /** Snowfall, cm. */
  snow: Series;
  wind: Series;
  gust: Series;
  cloud: Series;
  snowLevel: Series;
}

export interface Run extends RunSeries {
  model: ModelKey;
  /** Model initialisation time, unix seconds (UTC). */
  init: number;
  /** 0 for the latest run, 1 and 2 for the previous ones. */
  age: number;
}
