import { describe, expect, it } from 'vitest';
import { UpstreamError, isTransient, limitConcurrency } from '../src/shared/bundle';

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
