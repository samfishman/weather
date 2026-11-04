import { describe, expect, it } from 'vitest';
import { UpstreamError, buildBundle, isTransient, limitConcurrency } from '../src/shared/bundle';

describe('limitConcurrency', () => {
  it('never runs more than the limit at once and runs everything', async () => {
    let active = 0;
    let peak = 0;
    const slow = async (url: string) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return url;
    };
    const limited = limitConcurrency(slow, 4);
    const out = await Promise.all(Array.from({ length: 20 }, (_, i) => limited(String(i))));
    expect(peak).toBe(4);
    expect(out).toHaveLength(20);
  });

  it('frees the slot when a request fails', async () => {
    const limited = limitConcurrency(async (url) => {
      if (url === 'bad') throw new Error('boom');
      return url;
    }, 1);
    await expect(limited('bad')).rejects.toThrow('boom');
    await expect(limited('good')).resolves.toBe('good');
  });
});

describe('isTransient', () => {
  it('retries concurrency rejections, server errors and network errors only', () => {
    expect(isTransient(new UpstreamError(429, 'Too many concurrent requests'))).toBe(true);
    expect(isTransient(new UpstreamError(429, 'Minutely API request limit exceeded'))).toBe(false);
    expect(isTransient(new UpstreamError(400, 'The requested model run is not available'))).toBe(false);
    expect(isTransient(new UpstreamError(502, 'Bad gateway'))).toBe(true);
    expect(isTransient(new TypeError('Failed to fetch'))).toBe(true);
  });
});

describe('buildBundle without the model runs', () => {
  const start = 1_800_000_000;
  const hours = Array.from({ length: 24 * 16 }, (_, i) => i);
  const series = (v: number) => hours.map(() => v);
  const best = {
    timezone: 'UTC',
    timezone_abbreviation: 'UTC',
    utc_offset_seconds: 0,
    latitude: 40,
    longitude: -111,
    elevation: 2000,
    current: { time: start, temperature_2m: 1, apparent_temperature: 1, weather_code: 0, wind_speed_10m: 1, wind_direction_10m: 1, wind_gusts_10m: 1, is_day: 1 },
    hourly: {
      time: hours.map((i) => start + i * 3600),
      temperature_2m: series(1),
      apparent_temperature: series(1),
      precipitation_probability: series(0),
      precipitation: series(0),
      weather_code: series(0),
      wind_speed_10m: series(1),
      wind_direction_10m: series(1),
      wind_gusts_10m: series(1),
      cloud_cover: series(0),
      relative_humidity_2m: series(50),
      is_day: series(1),
      surface_pressure: series(800),
    },
    daily: { sunrise: [], sunset: [] },
  };
  const isRun = (url: string) => url.startsWith('https://single-runs-api.');
  const answer = (url: string) => {
    if (url.includes('/static/meta.json')) return { last_run_initialisation_time: start - 21600, update_interval_seconds: 21600 };
    if (url.includes('ensemble')) return { hourly: { time: best.hourly.time } };
    return best;
  };

  it('never touches the Single Runs API in main-only mode', async () => {
    const urls: string[] = [];
    const bundle = await buildBundle(40, -111, {
      elevation: 2000,
      mainOnly: true,
      fetchJson: async (url) => {
        urls.push(url);
        return answer(url);
      },
    });
    expect(urls.filter(isRun)).toEqual([]);
    expect(bundle.runsStatus).toBe('pending');
    expect(bundle.runs).toEqual([]);
    expect(bundle.blend.temp).toEqual(bundle.hourly.temp);
  });

  it('returns the main forecast when the runs are rejected', async () => {
    const bundle = await buildBundle(40, -111, {
      elevation: 2000,
      fetchJson: async (url) => {
        if (isRun(url)) throw new UpstreamError(429, 'Minutely API request limit exceeded');
        return answer(url);
      },
    });
    expect(bundle.runsStatus).toBe('partial');
    expect(bundle.hourly.temp[0]).toBe(1);
    expect(bundle.warnings.join(' ')).toContain('limit exceeded');
  });

  it('still fails when the main forecast does', async () => {
    await expect(
      buildBundle(40, -111, {
        elevation: 2000,
        fetchJson: async (url) => {
          if (url.includes('/forecast') && !isRun(url)) throw new UpstreamError(429, 'Minutely API request limit exceeded');
          return answer(url);
        },
      }),
    ).rejects.toThrow('limit exceeded');
  });
});
