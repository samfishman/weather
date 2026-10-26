// Unit conversion and time formatting. The bundle is metric; the page shows imperial by default.

export type Units = 'imperial' | 'metric';

export const toTemp = (c: number, u: Units) => (u === 'imperial' ? (c * 9) / 5 + 32 : c);
export const toWind = (kmh: number, u: Units) => (u === 'imperial' ? kmh / 1.609344 : kmh);
export const toPrecip = (mm: number, u: Units) => (u === 'imperial' ? mm / 25.4 : mm);
export const toSnow = (cm: number, u: Units) => (u === 'imperial' ? cm / 2.54 : cm);
export const toHeight = (m: number, u: Units) => (u === 'imperial' ? m * 3.28084 : m);

export const tempUnit = (u: Units) => (u === 'imperial' ? '°F' : '°C');
export const windUnit = (u: Units) => (u === 'imperial' ? 'mph' : 'km/h');
export const precipUnit = (u: Units) => (u === 'imperial' ? '"' : ' mm');
export const snowUnit = (u: Units) => (u === 'imperial' ? '"' : ' cm');
export const heightUnit = (u: Units) => (u === 'imperial' ? 'ft' : 'm');

export function fmtTemp(c: number | null | undefined, u: Units): string {
  return c == null ? '–' : String(Math.round(toTemp(c, u)));
}

export function fmtWind(kmh: number | null | undefined, u: Units): string {
  return kmh == null ? '–' : String(Math.round(toWind(kmh, u)));
}

/** Liquid precip with the unit: 0.13" or 3.3 mm. */
export function fmtPrecip(mm: number | null | undefined, u: Units): string {
  if (mm == null) return '–';
  const v = toPrecip(mm, u);
  return u === 'imperial' ? `${v.toFixed(2)}"` : `${v.toFixed(1)} mm`;
}

/** Short precip number for table cells, no unit. */
export function fmtPrecipCell(mm: number, u: Units): string {
  const v = toPrecip(mm, u);
  return u === 'imperial' ? v.toFixed(2) : v.toFixed(1);
}

export function fmtSnow(cm: number | null | undefined, u: Units): string {
  if (cm == null) return '–';
  const v = toSnow(cm, u);
  return u === 'imperial' ? `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)}"` : `${v.toFixed(1).replace(/\.0$/, '')} cm`;
}

/** Heights rounded to 100 ft or 50 m, with separators: 7,500 ft. */
export function fmtHeight(m: number | null | undefined, u: Units, withUnit = true): string {
  if (m == null) return '–';
  const v = toHeight(m, u);
  const step = u === 'imperial' ? 100 : 50;
  const s = (Math.round(v / step) * step).toLocaleString('en-US');
  return withUnit ? `${s} ${heightUnit(u)}` : s;
}

export function fmtElevation(m: number, u: Units): string {
  return `${Math.round(toHeight(m, u)).toLocaleString('en-US')} ${heightUnit(u)}`;
}

// ---- Time, always in the location's time zone ----

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
    cache.set(key, f);
  }
  return f;
}

function parts(unix: number, tz: string, opts: Intl.DateTimeFormatOptions) {
  return Object.fromEntries(dtf(tz, opts).formatToParts(unix * 1000).map((p) => [p.type, p.value]));
}

/** 7:29am */
export function fmtClock(unix: number, tz: string): string {
  const p = parts(unix, tz, { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${p.hour}:${p.minute}${p.dayPeriod.toLowerCase()}`;
}

/** 3p, 12a */
export function fmtHourShort(unix: number, tz: string): string {
  const p = parts(unix, tz, { hour: 'numeric', hour12: true });
  return `${p.hour}${p.dayPeriod.toLowerCase()[0]}`;
}

/** Mon 26 */
export function fmtDayShort(unix: number, tz: string): string {
  const p = parts(unix, tz, { weekday: 'short', day: 'numeric' });
  return `${p.weekday} ${p.day}`;
}

/** M 26 */
export function fmtDayTiny(unix: number, tz: string): string {
  const p = parts(unix, tz, { weekday: 'narrow', day: 'numeric' });
  return `${p.weekday} ${p.day}`;
}

/** Tue Nov 03 */
export function fmtDate(unix: number, tz: string): string {
  const p = parts(unix, tz, { weekday: 'short', month: 'short', day: '2-digit' });
  return `${p.weekday} ${p.month} ${p.day}`;
}

/** Mon Oct 26 3:25pm PDT */
export function fmtStamp(unix: number, tz: string): string {
  const p = parts(unix, tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
  return `${p.weekday} ${p.month} ${p.day} ${p.hour}:${p.minute}${p.dayPeriod.toLowerCase()} ${p.timeZoneName}`;
}

/** Run label: 12Z 10/26 */
export function fmtRun(init: number): string {
  const d = new Date(init * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}Z ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function fmtAgo(unix: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
