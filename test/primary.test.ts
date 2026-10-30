import { describe, expect, it } from 'vitest';
import { CROSSFADE_HOURS, mergeHourly } from '../src/shared/primary';

const hours = (n: number) => Array.from({ length: n }, (_, i) => 1_000_000 + i * 3600);

describe('mergeHourly', () => {
  it('uses best match when NBM is missing', () => {
    const best = { time: hours(4), temperature_2m: [1, 2, 3, 4] };
    const m = mergeHourly(best, null);
    expect(m.hourly.temperature_2m).toEqual([1, 2, 3, 4]);
    expect(m.nbmUntil).toBeNull();
  });

  it('prefers NBM, then fades into best match over the last hours of its range', () => {
    const n = 40;
    const time = hours(n);
    const best = { time, temperature_2m: time.map(() => 0), weather_code: time.map(() => 3) };
    // NBM covers the first 30 hours.
    const nbm = { time: time.slice(0, 30), temperature_2m: time.slice(0, 30).map(() => 10), weather_code: time.slice(0, 30).map(() => 61) };
    const m = mergeHourly(best, nbm);
    const t = m.hourly.temperature_2m as number[];
    expect(m.nbmUntil).toBe(29);
    expect(t[0]).toBe(10);
    expect(t[29 - CROSSFADE_HOURS]).toBe(10);
    expect(t[29 - CROSSFADE_HOURS / 2]).toBeCloseTo(5);
    expect(t[29]).toBe(0);
    expect(t[35]).toBe(0);
    // Categorical values switch at the midpoint instead of averaging.
    expect(m.hourly.weather_code[0]).toBe(61);
    expect(m.hourly.weather_code[35]).toBe(3);
  });

  it('keeps best-match-only keys such as pressure levels', () => {
    const time = hours(3);
    const best = { time, temperature_2m: [0, 0, 0], temperature_700hPa: [-5, -5, -5] };
    const nbm = { time, temperature_2m: [9, 9, 9] };
    expect(mergeHourly(best, nbm).hourly.temperature_700hPa).toEqual([-5, -5, -5]);
  });
});
