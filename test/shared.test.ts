import { describe, expect, it } from 'vitest';
import { snowLevel, wetBulb } from '../src/shared/snowlevel';
import { compass, lightningCategory, periodBounds, periodOf, precipType, sumRange } from '../src/shared/derive';
import { moonIllumination, moonPhaseName, moonTimes } from '../src/shared/moon';
import { levelsFor } from '../src/shared/openmeteo';

describe('wetBulb', () => {
  it('matches psychrometric tables', () => {
    // 20 °C, 50% RH at sea level is about 13.7 °C wet-bulb.
    expect(wetBulb(20, 50, 1013.25)).toBeCloseTo(13.7, 0);
    // Saturated air: wet-bulb equals air temperature.
    expect(wetBulb(5, 100, 900)).toBeCloseTo(5, 1);
    // Dry air at altitude cools a lot.
    expect(wetBulb(5, 30, 750)).toBeLessThan(-1);
  });
});

describe('snowLevel', () => {
  const level = (p: number, t: number, rh: number, z: number) => ({ p, t, rh, z });
  it('interpolates the wet-bulb 0.5 °C height in a saturated column', () => {
    // Saturated, so wet-bulb = temperature: +2.5 °C at 1000 m to -2.5 °C at 2000 m crosses 0.5 °C at 1400 m.
    const sl = snowLevel({ elevation: 1000, t2m: 2.5, rh2m: 100, psfc: 900, levels: [level(800, -2.5, 100, 2000), level(700, -8, 100, 3000)] });
    expect(sl).toBeGreaterThan(1350);
    expect(sl).toBeLessThan(1450);
  });
  it('drops below the freezing level in dry air', () => {
    const profile = { elevation: 500, t2m: 8, rh2m: 40, psfc: 955, levels: [level(850, 3, 40, 1500), level(700, -4, 40, 3000)] };
    const sl = snowLevel(profile)!;
    // Freezing level is about 2100 m here; dry air puts the snow level well below it.
    expect(sl).toBeLessThan(1700);
  });
  it('extrapolates below the surface when the whole column is cold', () => {
    const sl = snowLevel({ elevation: 2500, t2m: -6, rh2m: 90, psfc: 750, levels: [level(700, -9, 90, 3000), level(600, -16, 90, 4200)] })!;
    expect(sl).toBeLessThan(2500);
    expect(sl).toBeGreaterThanOrEqual(0);
  });
  it('skips levels below ground and returns null without data', () => {
    expect(snowLevel({ elevation: 2500, t2m: null, rh2m: null, psfc: null, levels: [level(850, 10, 50, 1500)] })).toBeNull();
  });
});

describe('derive', () => {
  it('classifies precip type', () => {
    expect(precipType(5, 0)).toBe('rain');
    expect(precipType(1, 0.7)).toBe('snow');
    expect(precipType(2, 0.7)).toBe('mix');
  });
  it('maps hours to 5am/5pm periods, including a 25-hour DST day', () => {
    const periods = periodBounds([0, 25, 49]);
    expect(periods.slice(0, 3)).toEqual([[5, 17], [17, 30], [30, 42]]);
    expect(periodOf(periods, 4)).toBe(-1);
    expect(periodOf(periods, 5)).toBe(0);
    expect(periodOf(periods, 29)).toBe(1);
    expect(periodOf(periods, 30)).toBe(2);
    const s = Array.from({ length: 48 }, () => 1);
    expect(sumRange(s, periods[0])).toBe(12);
    expect(sumRange(s, periods[3])).toBeNull();
  });
  it('rates lightning', () => {
    expect(lightningCategory(95, 0, 60)).toBe(3);
    expect(lightningCategory(3, 2000, 40)).toBe(2);
    expect(lightningCategory(3, 600, 25)).toBe(1);
    expect(lightningCategory(0, 0, 0)).toBe(0);
  });
  it('names compass points', () => {
    expect(compass(275)).toBe('W');
    expect(compass(250)).toBe('WSW');
    expect(compass(359)).toBe('N');
  });
  it('requests only levels above the terrain', () => {
    expect(levelsFor(2500)).toEqual([750, 700, 650, 600, 550, 500]);
    expect(levelsFor(0)[0]).toBe(1000);
  });
});

describe('moon', () => {
  // OpenSnow showed a full moon (99%) for San Francisco on Mon Oct 26 2026: moonrise 6:19pm, moonset 8:09am PDT.
  const sfMidnight = Date.UTC(2026, 9, 26, 7); // 00:00 PDT
  it('finds the full moon', () => {
    const { fraction, phase } = moonIllumination(sfMidnight + 12 * 3_600_000);
    expect(fraction).toBeGreaterThan(0.97);
    expect(moonPhaseName(phase)).toBe('Full Moon');
  });
  it('computes rise and set close to OpenSnow', () => {
    const { rise, set } = moonTimes(sfMidnight, 37.79, -122.4);
    const pdt = (ms: number) => (ms - sfMidnight) / 3_600_000;
    expect(pdt(rise!)).toBeCloseTo(18 + 19 / 60, 0);
    expect(pdt(set!)).toBeCloseTo(8 + 9 / 60, 0);
  });
});
