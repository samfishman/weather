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
  /** Where the main forecast comes from: NBM through `nbmUntil` (grid hour), then Open-Meteo best match. */
  primary: { source: 'nbm' | 'best_match'; nbmUntil: number | null };
  /** The heavy line and top table row: the main forecast, or the median of the latest runs. */
  blend: RunSeries;
  blendMode: BlendMode;
  runs: Run[];
  /** Models with data at this location, in display order. */
  models: ModelKey[];
  warnings: string[];
}

/** auto: NBM where it covers the point, else best match. best_match: never NBM. median: median of the latest runs. */
export type BlendMode = 'auto' | 'best_match' | 'median';

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
