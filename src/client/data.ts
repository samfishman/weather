// Loads the bundle from the Worker, or builds it in the browser if the Worker can't reach Open-Meteo.

import { buildBundle, fetchJsonVia, isTransient, type FetchJson } from '../shared/bundle';
import type { BlendMode, Bundle } from '../shared/types';

export type BundleSource = 'worker' | 'browser';
export interface Loaded {
  bundle: Bundle;
  source: BundleSource;
}

/** Wait before asking again for runs that failed. Those that worked are cached by then, so the second try is cheaper. */
const RUNS_RETRY_MS = 20_000;

// Single-run responses never change, so the browser keeps them for the session.
const runCache = new Map<string, unknown>();
const base = fetchJsonVia(fetch);
const browserFetch: FetchJson = async (url) => {
  if (!url.startsWith('https://single-runs-api.')) return base(url);
  if (runCache.has(url)) return runCache.get(url);
  const value: any = await base(url);
  // Only keep runs that came back complete; a run still being published can be partly empty.
  const temps = Object.keys(value?.hourly ?? {}).filter((k) => k.startsWith('temperature_2m'));
  if (temps.length && temps.every((k) => value.hourly[k].some((v: number | null) => v != null))) runCache.set(url, value);
  return value;
};

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Loads the forecast in steps, calling `onData` after each: the main forecast first, then the model runs,
 * which can take 30 seconds or more, then one more try if some of those runs failed.
 */
export async function loadBundle(
  lat: number,
  lon: number,
  elevation: number | null,
  blendMode: BlendMode,
  signal: AbortSignal,
  onData: (loaded: Loaded) => void,
): Promise<void> {
  const load = async (mainOnly: boolean): Promise<Loaded> => {
    const q = new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) });
    if (elevation != null) q.set('elev', String(Math.round(elevation)));
    if (blendMode !== 'auto') q.set('blend', blendMode);
    if (mainOnly) q.set('part', 'main');
    try {
      const res = await fetch(`/api/forecast?${q}`, { signal });
      if (res.ok) return { bundle: await res.json(), source: 'worker' };
    } catch {
      // Fall through to the browser pipeline.
    }
    signal.throwIfAborted();
    // The Worker couldn't build it (Open-Meteo busy for its shared IP): build it here, with one more try after a pause.
    const build = () => buildBundle(lat, lon, { fetchJson: browserFetch, blendMode, elevation, mainOnly });
    try {
      return { bundle: await build(), source: 'browser' };
    } catch (e) {
      if (!isTransient(e)) throw e;
      await pause(2500);
      signal.throwIfAborted();
      return { bundle: await build(), source: 'browser' };
    }
  };

  const main = await load(true);
  onData(main);
  if (main.bundle.runsStatus !== 'pending') return;
  const full = await load(false);
  onData(full);
  if (full.bundle.runsStatus !== 'partial') return;
  await pause(RUNS_RETRY_MS);
  signal.throwIfAborted();
  await load(false).then(onData, () => {});
}
