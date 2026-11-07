// Builds the dashboard's data bundle from Open-Meteo. Runs in the Worker and, as a fallback, in the browser.

import { MODELS, MODEL_BY_KEY, RUNS_PER_MODEL, inDomain, type ModelDef, type ModelKey } from './models';
import {
  ENSEMBLE_HOURLY,
  bestMatchUrl,
  ensembleUrl,
  levelsFor,
  elevationUrl,
  metaUrl,
  nbmUrl,
  singleRunUrl,
  type OpenMeteoHourly,
  type Point,
} from './openmeteo';
import { snowLevel, type ProfileLevel } from './snowlevel';
import { lightningCategory, median, round, roundSeries, snowWater } from './derive';
import { codeForFraction, columnMax, hourSnow } from './snow';
import { blendSeries, mergeHourly } from './primary';
import type { BlendMode, Bundle, Run, RunSeries, Series } from './types';

export type FetchJson = (url: string) => Promise<any>;

export class UpstreamError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** A FetchJson over `fetch` that turns HTTP errors (and Open-Meteo's `{error: true}` bodies) into UpstreamError. */
export function fetchJsonVia(fetchImpl: typeof fetch): FetchJson {
  return async (url) => {
    const res = await fetchImpl(url);
    const body: any = await res.json().catch(() => null);
    if (!res.ok || body?.error) throw new UpstreamError(res.status, body?.reason ?? `HTTP ${res.status}`);
    return body;
  };
}

export interface BuildOptions {
  fetchJson: FetchJson;
  blendMode?: BlendMode;
  /** Elevation hint (m) used to pick which pressure levels to request. */
  elevation?: number | null;
  /** Build only the main forecast. The Single Runs API can take 30 seconds or more, so the page doesn't wait on it. */
  mainOnly?: boolean;
}

interface Meta {
  last_run_initialisation_time?: number;
  update_interval_seconds?: number;
}

const HOUR = 3600;

/** Most Open-Meteo requests in flight at once. It rejects bursts with "Too many concurrent requests". */
export const MAX_CONCURRENT = 4;

export async function buildBundle(lat: number, lon: number, opts: BuildOptions): Promise<Bundle> {
  // Every request goes through one queue and retries transient rejections.
  const fetchJson = limitConcurrency(withRetry(opts.fetchJson), MAX_CONCURRENT);
  const mainOnly = opts.mainOnly ?? false;
  const warnings: string[] = [];
  let runsMissing = false;
  const elevationHint =
    opts.elevation ?? (await fetchJson(elevationUrl(lat, lon)).then((r) => r.elevation?.[0] ?? null, () => null));
  const levels = levelsFor(elevationHint);
  // A requested elevation is forecast exactly; otherwise Open-Meteo uses the terrain under the point.
  const pt = { lat, lon, elevation: opts.elevation ?? null };

  // Queued in priority order: the main forecast first, then NBM, ensembles and run times.
  // The main forecast is required; its error propagates.
  const bestPromise = fetchJson(bestMatchUrl(pt, levels));
  const blendMode = opts.blendMode ?? 'auto';
  const useNbm = blendMode !== 'best_match' && inDomain(MODEL_BY_KEY.nbm, lat, lon);
  const nbmPromise = useNbm ? fetchJson(nbmUrl(pt)).catch(() => null) : Promise.resolve(null);
  const ensembleModels = MODELS.filter((m) => m.kind === 'ensemble');
  const ensemblePromise = mainOnly
    ? Promise.resolve(null)
    : fetchJson(ensembleUrl(pt, ensembleModels.map((m) => m.api))).catch((e) => {
        warnings.push(`Ensembles unavailable: ${e.message ?? e}`);
        runsMissing = true;
        return null;
      });
  // Run times; a missing one drops that model.
  const metaPromise = mainOnly ? Promise.resolve([]) : Promise.all(MODELS.map((m) => fetchJson(metaUrl(m.meta)).catch((): Meta | null => null)));
  const best = await bestPromise;
  const metas = await metaPromise;
  const nbm = await nbmPromise;

  const tz: string = best.timezone;
  const utcOffset: number = best.utc_offset_seconds;
  const elevation: number = best.elevation;
  const start: number = best.hourly.time[0];
  const length: number = best.hourly.time.length;
  const now = Math.floor(Date.now() / 1000);

  // ---- Main forecast: NBM blended into best match (hourly tabs, 15-day strip, Now) ----
  const merged = mergeHourly(best.hourly, nbm?.hourly ?? null);
  const bh = merged.hourly;
  const precip = bh.precipitation;
  const levelSeries = blendSeries(
    bh.time.map((_, i) => snowLevel(profileAt(bh, i, elevation, levels, null))),
    alignTo(bh.time, nbm?.hourly, 'snowfall_height'),
    merged,
  ).map((v) => (v == null ? null : Math.round(v)));
  // Rain and snow at this elevation (see snow.ts), and weather codes that agree with them.
  const snowHours = bh.time.map((_, i) => hourSnow(precip[i], elevation, levelSeries[i], columnMax(profileAt(bh, i, elevation, levels, null))));
  const codes = bh.weather_code.map((c, i) => codeForFraction(c, snowHours[i].fraction));
  const hourly: Bundle['hourly'] = {
    temp: roundSeries(bh.temperature_2m),
    feels: roundSeries(bh.apparent_temperature),
    pop: bh.precipitation_probability,
    precip: roundSeries(precip, 2),
    rain: roundSeries(precip.map((p, i) => (p == null ? null : p - snowHours[i].liquid)), 2),
    snow: roundSeries(snowHours.map((s) => s.depth), 2),
    snowLiquid: roundSeries(snowHours.map((s) => s.liquid), 2),
    code: codes,
    wind: roundSeries(bh.wind_speed_10m),
    windDir: bh.wind_direction_10m,
    gust: roundSeries(bh.wind_gusts_10m),
    cloud: bh.cloud_cover,
    rh: bh.relative_humidity_2m,
    isDay: bh.is_day,
    lightning: bh.time.map((_, i) => lightningCategory(bh.weather_code[i], bh.cape?.[i] ?? null, bh.precipitation_probability[i])),
    snowLevel: levelSeries,
  };

  const daily = dailyFromHourly({ ...bh, weather_code: codes }, best.daily, tz);

  const c = nbm?.current?.temperature_2m != null ? nbm.current : best.current;
  const current: Bundle['current'] = {
    time: c.time,
    temp: round(c.temperature_2m),
    feels: round(c.apparent_temperature),
    code: codeForFraction(c.weather_code, snowHours[Math.round((c.time - start) / HOUR)]?.fraction ?? 0),
    wind: round(c.wind_speed_10m),
    windDir: c.wind_direction_10m,
    gust: round(c.wind_gusts_10m),
    isDay: c.is_day === 1,
  };

  // ---- Model runs: the last few runs of each deterministic model, from the Single Runs API ----
  const wanted = new Map<number, ModelDef[]>();
  const runInits = new Map<ModelKey, number[]>();
  MODELS.forEach((m, i) => {
    if (mainOnly || m.kind !== 'deterministic' || !inDomain(m, lat, lon)) return;
    const meta = metas[i];
    if (!meta?.last_run_initialisation_time) {
      warnings.push(`No run times for ${m.short}`);
      runsMissing = true;
      return;
    }
    const stepS = m.stepHours * HOUR;
    // Hourly models (HRRR, NBM) are shown on the synoptic hours, like OpenSnow does.
    const latest = Math.floor(meta.last_run_initialisation_time / stepS) * stepS;
    const inits = Array.from({ length: RUNS_PER_MODEL }, (_, k) => latest - k * stepS);
    runInits.set(m.key, inits);
    for (const init of inits) {
      if (!wanted.has(init)) wanted.set(init, []);
      wanted.get(init)!.push(m);
    }
  });

  const runs: Run[] = [];
  // Open-Meteo rejects too many heavy requests at once, so fetch three run times at a time.
  await mapLimit([...wanted.entries()], 3, async ([init, models]) => {
    // A run that can't be fetched costs only that run; the main forecast is already in hand.
    const results = await fetchRunGroup(fetchJson, pt, init, models, levels).catch((e): [ModelDef, OpenMeteoHourly][] => {
      warnings.push(`Runs from ${new Date(init * 1000).toISOString()} unavailable: ${e.message ?? e}`);
      runsMissing = true;
      return [];
    });
    for (const [model, h] of results) {
      const age = runInits.get(model.key)!.indexOf(init);
      runs.push(runFromHourly(model, init, age, h, models.length > 1 ? model.api : null, start, length, elevation, levels));
    }
  });

  // ---- Ensembles: mean of all members, latest run only ----
  const ens = await ensemblePromise;
  if (ens) {
    ensembleModels.forEach((m) => {
      const run = ensembleRun(m, ens.hourly, start, length);
      if (!run) return;
      let init = metas[MODELS.indexOf(m)]?.last_run_initialisation_time;
      if (!init) {
        // Without metadata, assume the run from 6-12 hours ago (ensembles are available ~6 h after init).
        init = Math.floor((now - 6 * HOUR) / (6 * HOUR)) * 6 * HOUR;
        warnings.push(`Run time for ${m.short} estimated`);
      }
      runs.push({ ...run, init, age: 0 });
    });
  }

  // Drop runs with no data here (regional models outside their domain).
  const withData = runs.filter((r) => r.temp.some((v) => v != null));
  const models = MODELS.map((m) => m.key).filter((k) => withData.some((r) => r.model === k));
  withData.sort((a, b) => MODELS.findIndex((m) => m.key === a.model) - MODELS.findIndex((m) => m.key === b.model) || a.age - b.age);

  const blend: RunSeries =
    blendMode === 'median' && !mainOnly
      ? medianBlend(withData.filter((r) => r.age === 0), length)
      : {
          temp: hourly.temp,
          precip: hourly.precip,
          snow: hourly.snow,
          snowLiquid: hourly.snowLiquid,
          wind: hourly.wind,
          gust: hourly.gust,
          cloud: hourly.cloud,
          snowLevel: hourly.snowLevel,
        };

  return {
    version: 1,
    generatedAt: now,
    location: { lat: best.latitude, lon: best.longitude, elevation, timezone: tz, tzAbbr: best.timezone_abbreviation, utcOffset },
    grid: { start, step: HOUR, length },
    current,
    hourly,
    daily,
    primary: { source: merged.nbmUntil != null ? 'nbm' : 'best_match', nbmUntil: merged.nbmUntil },
    blend,
    blendMode,
    runs: withData,
    models,
    runsStatus: mainOnly ? 'pending' : runsMissing ? 'partial' : 'complete',
    warnings,
  };
}

/**
 * Daily values from the hourly data, bucketed by real local days. Open-Meteo buckets its daily values
 * with today's UTC offset for the whole forecast, so after a daylight-saving change its days start at
 * 11pm or 1am. Hourly timestamps are true instants, so re-bucketing them fixes that.
 */
function dailyFromHourly(h: OpenMeteoHourly, d: Record<string, (number | null)[]>, tz: string): Bundle['daily'] {
  const hourOf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' });
  const starts: number[] = [];
  h.time.forEach((t, i) => {
    if (i === 0 || Number(hourOf.format(t * 1000)) === 0) starts.push(i);
  });
  const out: Bundle['daily'] = { time: [], tmax: [], tmin: [], code: [], popMax: [], precip: [], sunrise: [], sunset: [] };
  const instants = (xs: (number | null)[] | undefined) => (xs ?? []).filter((x): x is number => x != null);
  const rises = instants(d.sunrise);
  const sets = instants(d.sunset);
  starts.forEach((a, k) => {
    const b = starts[k + 1] ?? h.time.length;
    if (b - a < 20) return; // a partial last day
    const nums = (xs: (number | null)[]) => xs.slice(a, b).filter((x): x is number => x != null);
    const temps = nums(h.temperature_2m);
    const codes = nums(h.weather_code);
    const pops = nums(h.precipitation_probability);
    const t0 = h.time[a];
    const t1 = h.time[b - 1] + 3600;
    out.time.push(t0);
    out.tmax.push(temps.length ? round(Math.max(...temps)) : null);
    out.tmin.push(temps.length ? round(Math.min(...temps)) : null);
    // Icon: the most severe weather of the day (WMO codes rise with severity) when precip is likely,
    // otherwise the most common sky between 8am and 5pm.
    const popMax = pops.length ? Math.max(...pops) : null;
    const daytime = h.weather_code.slice(a + 8, a + 17).filter((c): c is number => c != null && c < 51);
    out.code.push(!codes.length ? null : (popMax ?? 0) >= 30 || !daytime.length ? Math.max(...codes) : mode(daytime));
    out.popMax.push(popMax);
    out.precip.push(round(nums(h.precipitation).reduce((x, y) => x + y, 0), 2));
    out.sunrise.push(rises.find((r) => r >= t0 && r < t1) ?? 0);
    out.sunset.push(sets.find((r) => r >= t0 && r < t1) ?? 0);
  });
  return out;
}

function mode(xs: number[]): number {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((p, q) => q[1] - p[1] || q[0] - p[0])[0][0];
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const worker = async () => {
    while (queue.length) await fn(queue.shift()!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True for failures worth retrying: "Too many concurrent requests" (a 429 that clears in a moment), 5xx and network errors. Rate limits (other 429s) and 400s are not. */
export function isTransient(e: unknown): boolean {
  if (!(e instanceof UpstreamError)) return true;
  if (e.status === 429) return /concurrent/i.test(e.message);
  return e.status >= 500 || e.status === 0;
}

function withRetry(fetchJson: FetchJson, attempts = 4): FetchJson {
  return async (url) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fetchJson(url);
      } catch (e) {
        if (attempt >= attempts || !isTransient(e)) throw e;
        await sleep(500 * attempt + Math.random() * 400);
      }
    }
  };
}

/** Wraps a FetchJson so at most `limit` requests run at once; the rest wait in order. */
export function limitConcurrency(fetchJson: FetchJson, limit: number): FetchJson {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (url) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fetchJson(url);
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/** Fetch one run time for several models; if the combined request fails, retry each model alone. */
async function fetchRunGroup(
  fetchJson: FetchJson,
  pt: Point,
  init: number,
  models: ModelDef[],
  levels: number[],
): Promise<[ModelDef, OpenMeteoHourly][]> {
  const extra = (ms: ModelDef[]) => (ms.some((m) => m.nativeSnowLevel) ? ['snowfall_height'] : []);
  try {
    const res = await fetchJson(singleRunUrl(pt, models.map((m) => m.api), init, levels, extra(models)));
    return models.map((m) => [m, res.hourly]);
  } catch (e) {
    // Only a 400 ("run not available" for one of the models) is worth retrying model by model.
    if (!(e instanceof UpstreamError) || e.status !== 400) throw e;
    if (models.length === 1) return [];
    const each = await Promise.all(
      models.map((m) =>
        fetchJson(singleRunUrl(pt, [m.api], init, levels, extra([m]))).then(
          (res) => [[m, res.hourly] as [ModelDef, OpenMeteoHourly]],
          (err) => {
            if (err instanceof UpstreamError && err.status === 400) return [];
            throw err;
          },
        ),
      ),
    );
    return each.flat();
  }
}

/** A variable from another hourly response, aligned to `times` by timestamp. */
function alignTo(times: number[], h: OpenMeteoHourly | undefined, name: string): (number | null)[] {
  if (!h?.[name]) return times.map(() => null);
  const pos = new Map(h.time.map((t, j) => [t, j]));
  return times.map((t) => {
    const j = pos.get(t);
    return j == null ? null : (h[name][j] ?? null);
  });
}

function pick(h: OpenMeteoHourly, name: string, api: string | null): (number | null)[] | undefined {
  return api ? h[`${name}_${api}`] : h[name];
}

function profileAt(h: OpenMeteoHourly, i: number, elevation: number, levels: number[], api: string | null) {
  const get = (name: string) => pick(h, name, api)?.[i] ?? null;
  const lv: ProfileLevel[] = levels.map((p) => ({
    p,
    t: get(`temperature_${p}hPa`),
    rh: get(`relative_humidity_${p}hPa`),
    z: get(`geopotential_height_${p}hPa`),
  }));
  return { elevation, t2m: get('temperature_2m'), rh2m: get('relative_humidity_2m'), psfc: get('surface_pressure'), levels: lv };
}

/** Put a model run's hourly data onto the bundle grid and compute its snow level. */
function runFromHourly(
  model: ModelDef,
  init: number,
  age: number,
  h: OpenMeteoHourly,
  api: string | null,
  start: number,
  length: number,
  elevation: number,
  levels: number[],
): Run {
  const out = emptyRun(length);
  const series = (name: string) => pick(h, name, api);
  const temp = series('temperature_2m');
  const native = model.nativeSnowLevel ? series('snowfall_height') : undefined;
  h.time.forEach((t, j) => {
    // Rounding keeps half-hour time zones aligned to the nearest grid hour.
    const i = Math.round((t - start) / HOUR);
    if (i < 0 || i >= length || temp?.[j] == null) return;
    out.temp[i] = round(temp[j]);
    const p = series('precipitation')?.[j] ?? null;
    const profile = profileAt(h, j, elevation, levels, api);
    const level = native ? (native[j] ?? null) : snowLevel(profile);
    const s = hourSnow(p, elevation, level, columnMax(profile));
    out.precip[i] = round(p, 2);
    out.snow[i] = p == null ? null : round(s.depth, 2);
    out.snowLiquid[i] = p == null ? null : round(s.liquid, 2);
    out.wind[i] = round(series('wind_speed_10m')?.[j]);
    out.gust[i] = round(series('wind_gusts_10m')?.[j]);
    out.cloud[i] = series('cloud_cover')?.[j] ?? null;
    out.snowLevel[i] = level;
  });
  return { model: model.key, init, age, ...out };
}

function emptyRun(length: number): RunSeries {
  const s = (): Series => new Array(length).fill(null);
  return { temp: s(), precip: s(), snow: s(), snowLiquid: s(), wind: s(), gust: s(), cloud: s(), snowLevel: s() };
}

/** Mean of the control and all members of one ensemble model. */
function ensembleRun(model: ModelDef, h: OpenMeteoHourly, start: number, length: number): (RunSeries & { model: ModelKey }) | null {
  const out = emptyRun(length);
  const fieldFor: Record<string, keyof RunSeries> = {
    temperature_2m: 'temp',
    precipitation: 'precip',
    snowfall: 'snow',
    wind_speed_10m: 'wind',
    wind_gusts_10m: 'gust',
    cloud_cover: 'cloud',
  };
  let found = false;
  for (const v of ENSEMBLE_HOURLY) {
    const re = new RegExp(`^${v}(?:_member\\d+)?_(${model.api}.*)$`);
    const members = Object.keys(h)
      .filter((k) => re.test(k))
      .map((k) => h[k]);
    if (!members.length) continue;
    found = true;
    h.time.forEach((t, j) => {
      const i = Math.round((t - start) / HOUR);
      if (i < 0 || i >= length) return;
      const vals = members.map((m) => m[j]).filter((x): x is number => x != null);
      out[fieldFor[v]][i] = vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : null;
    });
  }
  // Ensemble members have no pressure levels here, so these keep Open-Meteo's snowfall (7 cm per 10 mm).
  out.snowLiquid = out.snow.map((sn, i) => (sn == null ? null : round(Math.min(out.precip[i] ?? 0, snowWater(sn)), 2)));
  return found ? { model: model.key, ...out } : null;
}

function medianBlend(latest: Run[], length: number): RunSeries {
  const out = emptyRun(length);
  for (const key of Object.keys(out) as (keyof RunSeries)[]) {
    for (let i = 0; i < length; i++) {
      const vals = latest.map((r) => r[key][i]).filter((x): x is number => x != null);
      out[key][i] = round(median(vals), key === 'precip' || key === 'snow' || key === 'snowLiquid' ? 2 : 1);
    }
  }
  return out;
}
