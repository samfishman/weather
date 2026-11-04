import { describe, expect, it } from 'vitest';
import { snowLevel, wetBulb } from '../src/shared/snowlevel';
import { compass, lightningCategory, periodBounds, periodOf, precipType, sumRange } from '../src/shared/derive';
import { moonIllumination, moonPhaseName, moonTimes } from '../src/shared/moon';
import { bestMatchUrl, levelsFor, singleRunUrl } from '../src/shared/openmeteo';
import { codeForFraction, columnMax, hourSnow, kucheraRatio, snowFraction } from '../src/shared/snow';

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
  it('estimates from the surface alone when a run has no upper-air data', () => {
    // Saturated 3.5 °C at 1300 m: 3 °C above the threshold at 6 °C/km is 500 m higher.
    expect(snowLevel({ elevation: 1300, t2m: 3.5, rh2m: 100, psfc: 870, levels: [] })).toBeCloseTo(1800, -1);
    // Below the threshold at the surface: the level is under the point.
    expect(snowLevel({ elevation: 1300, t2m: -1, rh2m: 100, psfc: 870, levels: [] })).toBeLessThan(1300);
  });
});

describe('derive', () => {
  it('classifies precip type', () => {
    expect(precipType(5, 0)).toBe('rain');
    expect(precipType(1, 1)).toBe('snow');
    expect(precipType(2, 1)).toBe('mix');
  });
  it('maps hours to 6am/6pm periods, including a 25-hour DST day', () => {
    const periods = periodBounds([0, 25, 49]);
    expect(periods.slice(0, 3)).toEqual([[6, 18], [18, 31], [31, 43]]);
    expect(periodOf(periods, 5)).toBe(-1);
    expect(periodOf(periods, 6)).toBe(0);
    expect(periodOf(periods, 30)).toBe(1);
    expect(periodOf(periods, 31)).toBe(2);
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
  it('sends the forecast elevation to Open-Meteo only when one is chosen', () => {
    expect(bestMatchUrl({ lat: 37.75, lon: -119.59, elevation: 1218.4 }, [])).toContain('elevation=1218');
    expect(bestMatchUrl({ lat: 37.75, lon: -119.59 }, [])).not.toContain('elevation=');
    expect(singleRunUrl({ lat: 37.75, lon: -119.59, elevation: 2600 }, ['gfs_seamless'], 1793016000, [])).toContain('elevation=2600');
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

describe('snow', () => {
  it('splits rain and snow around the snow level', () => {
    expect(snowFraction(2000, 1500)).toBe(1);
    expect(snowFraction(1000, 1500)).toBe(0);
    expect(snowFraction(1500, 1500)).toBe(0.5);
    expect(snowFraction(1500, null)).toBe(0);
    // Cold to sea level: the level is clamped at 0, and it's all snow even right at the coast.
    expect(snowFraction(10, 0)).toBe(1);
  });
  it('follows the Kuchera ratio', () => {
    expect(kucheraRatio(-1.99)).toBeCloseTo(12, 1);
    expect(kucheraRatio(-12)).toBeCloseTo(22, 0);
    expect(kucheraRatio(0)).toBeCloseTo(8, 0);
    // Limits: warm air can't go below 3:1, very cold air can't exceed 30:1.
    expect(kucheraRatio(10)).toBe(3);
    expect(kucheraRatio(-40)).toBe(30);
  });
  it('turns liquid into depth at this elevation', () => {
    const cold = hourSnow(10, 3000, 1500, -12);
    expect(cold.liquid).toBe(10);
    expect(cold.depth).toBeCloseTo(22, 0); // 10 mm at 22:1 is 22 cm.
    expect(hourSnow(10, 1000, 1500, 3).depth).toBe(0); // Below the snow level it's rain.
    expect(hourSnow(10, 3000, 1500, null).depth).toBe(10); // No column data: 10:1.
    expect(hourSnow(null, 3000, 1500, -5).depth).toBe(0);
  });
  it('uses only the column above the ground for the warmest temperature', () => {
    const level = (p: number, t: number, z: number) => ({ p, t, rh: 90, z });
    const profile = { elevation: 2500, t2m: -6, rh2m: 90, psfc: 750, levels: [level(850, 12, 1500), level(700, -4, 3000), level(600, -12, 4200)] };
    expect(columnMax(profile)).toBe(-4);
  });
  it('makes weather codes agree with the precip type', () => {
    expect(codeForFraction(61, 1)).toBe(71);
    expect(codeForFraction(65, 1)).toBe(75);
    expect(codeForFraction(73, 0)).toBe(63);
    expect(codeForFraction(3, 1)).toBe(3);
    expect(codeForFraction(95, 1)).toBe(95);
    expect(codeForFraction(null, 1)).toBeNull();
  });
});
