// Cloudflare Worker: serves the dashboard (static assets) and /api/forecast, which builds the data bundle
// from Open-Meteo and caches it. Responses from the Single Runs API never change for a given run, so they
// are cached for a day; the bundle itself is cached for 15 minutes per ~1 km grid cell.

import { UpstreamError, buildBundle, fetchJsonVia, type FetchJson } from '../shared/bundle';
import type { BlendMode } from '../shared/types';

interface Env {
  ASSETS: Fetcher;
  CACHE?: KVNamespace;
}

const BUNDLE_TTL = 15 * 60;
const RUN_TTL = 24 * 60 * 60;
const META_TTL = 5 * 60;

// Per-isolate memory cache in front of KV.
const memory = new Map<string, { expires: number; value: unknown }>();

function memGet<T>(key: string): T | undefined {
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  memory.delete(key);
  return undefined;
}

function memSet(key: string, value: unknown, ttl: number) {
  if (memory.size > 200) memory.clear();
  memory.set(key, { expires: Date.now() + ttl * 1000, value });
}

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** FetchJson with caching for responses that are safe to reuse. */
function cachedFetchJson(env: Env, ctx: ExecutionContext): FetchJson {
  const base = fetchJsonVia(fetch);
  return async (url) => {
    const isRun = url.startsWith('https://single-runs-api.');
    const isMeta = url.includes('/static/meta.json');
    if (!isRun && !isMeta) return base(url);
    const ttl = isRun ? RUN_TTL : META_TTL;
    const key = `u:${await sha(url)}`;
    const mem = memGet(key);
    if (mem !== undefined) return mem;
    if (isRun && env.CACHE) {
      const kv = await env.CACHE.get(key, 'json');
      if (kv) {
        memSet(key, kv, ttl);
        return kv;
      }
    }
    const value = await base(url);
    memSet(key, value, ttl);
    if (isRun && env.CACHE) ctx.waitUntil(env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl }));
    return value;
  };
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

async function handleForecast(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: 'lat and lon are required' }, 400);
  }
  const b = params.get('blend');
  const blendMode: BlendMode = b === 'median' || b === 'best_match' ? b : 'auto';
  const elevParam = params.get('elev');
  const elevation = elevParam != null && Number.isFinite(Number(elevParam)) ? Number(elevParam) : null;
  // Round to ~1 km so nearby requests share a cache entry.
  const rlat = Math.round(lat * 100) / 100;
  const rlon = Math.round(lon * 100) / 100;
  const key = `b:v2:${rlat},${rlon}:${blendMode}`;

  const cacheHeaders = { 'cache-control': `public, max-age=${BUNDLE_TTL}` };
  const mem = memGet<string>(key);
  if (mem) return new Response(mem, { headers: { 'content-type': 'application/json; charset=utf-8', 'x-cache': 'memory', ...cacheHeaders } });
  if (env.CACHE) {
    const kv = await env.CACHE.get(key);
    if (kv) {
      memSet(key, kv, BUNDLE_TTL);
      return new Response(kv, { headers: { 'content-type': 'application/json; charset=utf-8', 'x-cache': 'kv', ...cacheHeaders } });
    }
  }

  try {
    const bundle = await buildBundle(rlat, rlon, { fetchJson: cachedFetchJson(env, ctx), blendMode, elevation });
    const body = JSON.stringify(bundle);
    memSet(key, body, BUNDLE_TTL);
    if (env.CACHE) ctx.waitUntil(env.CACHE.put(key, body, { expirationTtl: BUNDLE_TTL }));
    return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'x-cache': 'miss', ...cacheHeaders } });
  } catch (e) {
    // 429 from Open-Meteo means this Worker's shared IP is rate limited; the browser falls back to calling Open-Meteo itself.
    const status = e instanceof UpstreamError ? e.status : 0;
    return json({ error: e instanceof Error ? e.message : String(e), upstreamStatus: status }, status === 429 ? 503 : 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/forecast') return handleForecast(request, env, ctx);
    if (pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
