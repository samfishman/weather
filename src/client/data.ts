// Loads the bundle from the Worker, or builds it in the browser if the Worker can't reach Open-Meteo.

import { buildBundle, fetchJsonVia, type FetchJson } from '../shared/bundle';
import type { BlendMode, Bundle } from '../shared/types';

export type BundleSource = 'worker' | 'browser';

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

export async function loadBundle(
  lat: number,
  lon: number,
  elevation: number | null,
  blendMode: BlendMode,
): Promise<{ bundle: Bundle; source: BundleSource }> {
  const q = new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) });
  if (elevation != null) q.set('elev', String(Math.round(elevation)));
  if (blendMode !== 'auto') q.set('blend', blendMode);
  try {
    const res = await fetch(`/api/forecast?${q}`);
    if (res.ok) return { bundle: await res.json(), source: 'worker' };
  } catch {
    // Fall through to the browser pipeline.
  }
  const bundle = await buildBundle(lat, lon, { fetchJson: browserFetch, blendMode, elevation });
  return { bundle, source: 'browser' };
}
