// Moon position, illumination and rise/set times, ported from SunCalc (Vladimir Agafonkin, BSD-2-Clause),
// based on formulas from https://aa.quae.nl/en/reken/hemelpositie.html.

const { PI, sin, cos, tan, asin, atan2, acos } = Math;
const rad = PI / 180;
const dayMs = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397; // obliquity of the Earth

const toDays = (ms: number) => ms / dayMs - 0.5 + J1970 - J2000;
const rightAscension = (l: number, b: number) => atan2(sin(l) * cos(e) - tan(b) * sin(e), cos(l));
const declination = (l: number, b: number) => asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
const altitude = (H: number, phi: number, dec: number) => asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
const siderealTime = (d: number, lw: number) => rad * (280.16 + 360.9856235 * d) - lw;

function astroRefraction(h: number) {
  if (h < 0) h = 0;
  return 0.0002967 / tan(h + 0.00312536 / (h + 0.08901179));
}

function sunCoords(d: number) {
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M));
  const L = M + C + rad * 102.9372 + PI;
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

function moonCoords(d: number) {
  const L = rad * (218.316 + 13.176396 * d);
  const M = rad * (134.963 + 13.064993 * d);
  const F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * sin(M);
  const b = rad * 5.128 * sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * cos(M) };
}

function moonAltitude(ms: number, lat: number, lon: number): number {
  const d = toDays(ms);
  const c = moonCoords(d);
  const H = siderealTime(d, rad * -lon) - c.ra;
  const h = altitude(H, rad * lat, c.dec);
  return h + astroRefraction(h);
}

/** Illuminated fraction (0 to 1) and phase (0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter). */
export function moonIllumination(ms: number): { fraction: number; phase: number } {
  const d = toDays(ms);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sdist = 149598000;
  const phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
  const inc = atan2(sdist * sin(phi), m.dist - sdist * cos(phi));
  const angle = atan2(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));
  return { fraction: (1 + cos(inc)) / 2, phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / PI };
}

/** Moonrise and moonset (ms) in the 24 hours after `dayStartMs` (local midnight), if they happen. */
export function moonTimes(dayStartMs: number, lat: number, lon: number): { rise?: number; set?: number } {
  const hc = 0.133 * rad;
  const at = (hours: number) => moonAltitude(dayStartMs + hours * 3_600_000, lat, lon) - hc;
  let h0 = at(0);
  let rise: number | undefined;
  let set: number | undefined;
  for (let i = 1; i <= 24; i += 2) {
    const h1 = at(i);
    const h2 = at(i + 1);
    const a = (h0 + h2) / 2 - h1;
    const b = (h2 - h0) / 2;
    const xe = -b / (2 * a);
    const ye = (a * xe + b) * xe + h1;
    const disc = b * b - 4 * a * h1;
    let roots = 0;
    let x1 = 0;
    let x2 = 0;
    if (disc >= 0) {
      const dx = Math.sqrt(disc) / (Math.abs(a) * 2);
      x1 = xe - dx;
      x2 = xe + dx;
      if (Math.abs(x1) <= 1) roots++;
      if (Math.abs(x2) <= 1) roots++;
      if (x1 < -1) x1 = x2;
    }
    if (roots === 1) {
      if (h0 < 0) rise = i + x1;
      else set = i + x1;
    } else if (roots === 2) {
      rise = i + (ye < 0 ? x2 : x1);
      set = i + (ye < 0 ? x1 : x2);
    }
    if (rise != null && set != null) break;
    h0 = h2;
  }
  return {
    rise: rise != null ? dayStartMs + rise * 3_600_000 : undefined,
    set: set != null ? dayStartMs + set * 3_600_000 : undefined,
  };
}

export function moonPhaseName(phase: number): string {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.0339 || p > 0.9661) return 'New Moon';
  if (p < 0.2161) return 'Waxing Crescent';
  if (p < 0.2839) return 'First Quarter';
  if (p < 0.4661) return 'Waxing Gibbous';
  if (p < 0.5339) return 'Full Moon';
  if (p < 0.7161) return 'Waning Gibbous';
  if (p < 0.7839) return 'Last Quarter';
  return 'Waning Crescent';
}
