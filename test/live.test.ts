// Live check against Open-Meteo. Run with: LIVE=1 npx vitest run test/live.test.ts
import { describe, expect, it } from 'vitest';
import { buildBundle, fetchJsonVia } from '../src/shared/bundle';

const live = process.env.LIVE ? describe : describe.skip;

live('buildBundle (live)', () => {
  it('builds a bundle for Vail', async () => {
    const t0 = Date.now();
    const calls: string[] = [];
    const b = await buildBundle(39.64, -106.37, {
      fetchJson: (u) => {
        calls.push(u);
        return fetchJsonVia(fetch)(u);
      },
    });
    const json = JSON.stringify(b);
    console.log('ms', Date.now() - t0, 'calls', calls.length, 'bytes', json.length);
    console.log('models', b.models.join(','), 'runs', b.runs.map((r) => `${r.model}@${new Date(r.init * 1000).toISOString().slice(5, 13)}#${r.age}`).join(' '));
    console.log('warnings', b.warnings);
    console.log('elev', b.location.elevation, 'tz', b.location.timezone, 'snowLevel[0..48:6]', b.hourly.snowLevel.filter((_, i) => i % 6 === 0).slice(0, 8));
    for (const r of b.runs.filter((r) => r.age === 0)) {
      const n = r.temp.filter((v) => v != null).length;
      const sl = r.snowLevel.filter((v) => v != null).length;
      console.log(r.model.padEnd(7), 'hours', n, 'snowLevel hours', sl, 'sample', r.snowLevel.slice(30, 31));
    }
    expect(b.runs.length).toBeGreaterThan(10);
  }, 120_000);
});
