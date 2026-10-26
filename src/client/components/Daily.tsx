import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Bundle } from '../../shared/types';
import { compass, precipType } from '../../shared/derive';
import { moonIllumination, moonPhaseName, moonTimes } from '../../shared/moon';
import { Icon, WeatherIcon, precipChanceColor } from '../icons';
import {
  fmtClock,
  fmtDayShort,
  fmtHourShort,
  fmtPrecip,
  fmtSnow,
  fmtTemp,
  tempUnit,
  toTemp,
  toWind,
  windUnit,
  type Units,
} from '../format';
import { dayRange, nowIndex } from '../metrics';

export type HourlyTab = 'temp' | 'feels' | 'pop' | 'wind' | 'cloud' | 'rh' | 'lightning';

const TABS: { key: HourlyTab; label: (u: Units) => string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { key: 'temp', label: (u) => `Temp ${tempUnit(u)}`, icon: 'thermo' },
  { key: 'feels', label: (u) => `Feels Like ${tempUnit(u)}`, icon: 'thermo' },
  { key: 'pop', label: () => 'Precip %', icon: 'drops' },
  { key: 'wind', label: (u) => `Wind ${windUnit(u)}`, icon: 'wind' },
  { key: 'cloud', label: () => 'Cloud %', icon: 'cloud' },
  { key: 'rh', label: () => 'Humidity %', icon: 'humidity' },
  { key: 'lightning', label: () => 'Lightning', icon: 'bolt' },
];

interface Props {
  bundle: Bundle;
  units: Units;
  day: number;
  onDay: (d: number) => void;
  tab: HourlyTab;
  onTab: (t: HourlyTab) => void;
}

export function Daily({ bundle, units, day, onDay, tab, onTab }: Props) {
  const tz = bundle.location.timezone;
  const strip = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);
  const days = bundle.daily.time.slice(0, 15);

  const updateArrows = () => {
    const el = strip.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };
  useEffect(updateArrows, [bundle]);
  useEffect(() => {
    // Keep the selected day in view.
    const el = strip.current?.children[day] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [day]);

  const scroll = (dir: number) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.8 });

  return (
    <section class="section">
      <div class="section-head">
        <h2>Daily Forecast</h2>
        <span class="muted small">Data from Open-Meteo</span>
      </div>
      <div class="card daily">
        <div class="strip-wrap">
          <div class="strip" ref={strip} onScroll={updateArrows}>
            {days.map((t, i) => (
              <button class={`day${i === day ? ' selected' : ''}`} key={t} onClick={() => onDay(i)} aria-pressed={i === day}>
                <div class="dname">{fmtDayShort(t, tz)}</div>
                <div class="hi">{fmtTemp(bundle.daily.tmax[i], units)}{tempUnit(units)}</div>
                <div class="lo">{fmtTemp(bundle.daily.tmin[i], units)}{tempUnit(units)}</div>
                <div class="dicon">
                  <WeatherIcon code={bundle.daily.code[i]} precipColor={precipChanceColor(bundle.daily.popMax[i])} size={28} />
                </div>
              </button>
            ))}
          </div>
          {canLeft && (
            <button class="scrollbtn left" onClick={() => scroll(-1)} aria-label="Earlier days">
              <Icon name="chevronLeft" size={18} />
            </button>
          )}
          {canRight && (
            <button class="scrollbtn right" onClick={() => scroll(1)} aria-label="Later days">
              <Icon name="chevronRight" size={18} />
            </button>
          )}
        </div>
        <div class="tabs" role="tablist">
          {TABS.map((t) => (
            <button class={`tab${t.key === tab ? ' active' : ''}`} key={t.key} role="tab" aria-selected={t.key === tab} onClick={() => onTab(t.key)}>
              <Icon name={t.icon} size={15} />
              {t.label(units)}
            </button>
          ))}
        </div>
        <HourlyChart bundle={bundle} units={units} day={day} tab={tab} />
        <SunMoon bundle={bundle} day={day} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

const CHART_H = 190;
const LABEL_TOP = 46;

function HourlyChart({ bundle, units, day, tab }: { bundle: Bundle; units: Units; day: number; tab: HourlyTab }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(620, el.clientWidth - 32)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tz = bundle.location.timezone;
  const h = bundle.hourly;
  const [start, end] = dayRange(bundle, day);
  const hours = Array.from({ length: end - start }, (_, k) => start + k);
  const now = nowIndex(bundle);
  const slot = width / hours.length;
  const barW = Math.min(24, slot * 0.72);
  const plotTop = tab === 'wind' ? LABEL_TOP + 8 : 22;
  const plotBottom = CHART_H - 4;
  const plotH = plotBottom - plotTop;

  // Values and colors per hour for the active tab.
  type Bar = { i: number; v: number; stack?: number; label: string[]; color: string };
  const bars: Bar[] = hours.map((i) => {
    switch (tab) {
      case 'temp':
      case 'feels': {
        const c = (tab === 'temp' ? h.temp : h.feels)[i];
        const v = c == null ? NaN : toTemp(c, units);
        return { i, v, label: [Number.isNaN(v) ? '' : String(Math.round(v))], color: 'var(--accent)' };
      }
      case 'pop': {
        const v = h.pop[i] ?? NaN;
        const type = precipType(h.precip[i] ?? 0, h.snow[i] ?? 0);
        const color = v > 0 ? `var(--${type})` : 'var(--lightning-none)';
        return { i, v, label: [Number.isNaN(v) ? '' : String(Math.round(v))], color };
      }
      case 'wind': {
        const w = h.wind[i] == null ? NaN : toWind(h.wind[i]!, units);
        const g = h.gust[i] == null ? NaN : toWind(h.gust[i]!, units);
        return { i, v: w, stack: Math.max(g, w), label: [compass(h.windDir[i]), String(Math.round(w)), `G${Math.round(g)}`], color: 'var(--sustained)' };
      }
      case 'cloud':
        return { i, v: h.cloud[i] ?? NaN, label: [String(h.cloud[i] ?? '')], color: 'var(--accent)' };
      case 'rh':
        return { i, v: h.rh[i] ?? NaN, label: [String(h.rh[i] ?? '')], color: 'var(--accent)' };
      case 'lightning': {
        const cat = h.lightning[i] ?? 0;
        const color = ['var(--lightning-none)', 'var(--lightning-low)', 'var(--lightning-some)', 'var(--lightning-high)'][cat];
        return { i, v: cat, label: [], color };
      }
    }
  });

  // Y scale. Temperatures float (no zero baseline needed for reading the day's shape); the rest start at 0.
  const vals = bars.flatMap((b) => [b.v, b.stack ?? NaN]).filter((v) => !Number.isNaN(v));
  let lo = 0;
  let hi = 100;
  if (tab === 'temp' || tab === 'feels') {
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    lo = Math.floor(mn - Math.max(6, (mx - mn) * 0.8));
    hi = Math.ceil(mx + 1);
  } else if (tab === 'wind') {
    hi = Math.max(units === 'imperial' ? 15 : 25, ...vals) * 1.05;
  } else if (tab === 'lightning') {
    hi = 1;
  }
  const y = (v: number) => plotBottom - ((v - lo) / (hi - lo || 1)) * plotH;
  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => plotBottom - f * plotH);

  const rect = (x: number, top: number, bottom: number, color: string, hollow: boolean, key: string, roundTop = true) => {
    const hgt = Math.max(0, bottom - top);
    const r = roundTop ? Math.min(4, hgt, barW / 2) : 0;
    const d = `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${bottom} Z`;
    return hollow ? (
      <path key={key} d={d} fill="none" stroke={color} stroke-width={1.5} />
    ) : (
      <path key={key} d={d} fill={color} />
    );
  };

  const isPast = (i: number) => i < now;
  const labelEvery = slot < 22 ? 2 : 1;

  // Day totals for the Precip tab, split by type.
  let rainMm = 0;
  let mixMm = 0;
  let snowCm = 0;
  if (tab === 'pop') {
    for (const i of hours) {
      const p = h.precip[i] ?? 0;
      const s = h.snow[i] ?? 0;
      if (p <= 0 && s <= 0) continue;
      const type = precipType(p, s);
      if (type === 'rain') rainMm += p;
      else if (type === 'mix') mixMm += p;
      else snowCm += s;
    }
  }

  return (
    <>
      <div class="hourly" ref={box}>
        <svg width={width} height={CHART_H + 22} role="img" aria-label="Hourly forecast chart">
          {gridLines.map((gy) => (
            <line key={gy} x1={0} x2={width} y1={gy} y2={gy} stroke="var(--grid)" stroke-width={1} />
          ))}
          {bars.map((b, k) => {
            const x = k * slot + (slot - barW) / 2;
            const cx = x + barW / 2;
            const hollow = isPast(b.i);
            if (tab === 'lightning') {
              return rect(x, plotBottom - 6, plotBottom, b.color, false, `b${k}`);
            }
            if (Number.isNaN(b.v)) return null;
            const top = tab === 'pop' && b.v <= 0 ? plotBottom - 3 : y(b.v);
            const els = [];
            if (b.stack != null && b.stack > b.v) {
              // Gust excess sits on top of the sustained bar, separated by a 2px gap.
              els.push(rect(x, y(b.stack), y(b.v) - 2, 'var(--gusts)', hollow, `g${k}`));
              els.push(rect(x, top, plotBottom, b.color, hollow, `s${k}`, false));
            } else {
              els.push(rect(x, top, plotBottom, b.color, hollow, `s${k}`));
            }
            const labelY = (b.stack != null ? y(b.stack) : top) - 6;
            if (k % labelEvery === 0) {
              b.label.forEach((line, li) => {
                els.push(
                  <text key={`t${k}-${li}`} x={cx} y={labelY - (b.label.length - 1 - li) * 12} text-anchor="middle" font-size={tab === 'wind' ? 10 : 11} fill="var(--text-2)">
                    {line}
                  </text>,
                );
              });
            }
            return els;
          })}
          <line x1={0} x2={width} y1={plotBottom} y2={plotBottom} stroke="var(--border)" stroke-width={1} />
          {hours.map((i, k) =>
            k % 3 === 0 ? (
              <text key={`x${i}`} x={k * slot + slot / 2} y={CHART_H + 14} text-anchor="middle" font-size={11} fill="var(--text-3)">
                {fmtHourShort(bundle.grid.start + i * bundle.grid.step, tz)}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      {tab === 'pop' ? (
        <div class="chips">
          <div class="chip"><div class="k" style={{ background: 'var(--rain)' }}>Rain</div><div class="v">{fmtPrecip(rainMm, units)}</div></div>
          <div class="chip"><div class="k" style={{ background: 'var(--mix)', color: '#fff' }}>Snow/Rain</div><div class="v">{fmtPrecip(mixMm, units)}</div></div>
          <div class="chip"><div class="k" style={{ background: 'var(--snow)', color: '#fff' }}>Snow</div><div class="v">{fmtSnow(snowCm, units)}</div></div>
        </div>
      ) : tab === 'wind' ? (
        <div class="legend">
          <div class="windkey">
            <span><b>N</b> - Direction</span>
            <span><b>3</b> - Sustained speed {windUnit(units)}</span>
            <span><b>G10</b> - Gusts {windUnit(units)}</span>
          </div>
          <span class="key"><span class="swatch" style={{ background: 'var(--sustained)' }} />Sustained</span>
          <span class="key"><span class="swatch" style={{ background: 'var(--gusts)' }} />Gusts</span>
        </div>
      ) : tab === 'lightning' ? (
        <div class="legend">
          {['None', 'Low chance', 'Some chance', 'High chance'].map((l, i) => (
            <span class="key" key={l}>
              <span class="swatch round" style={{ background: ['var(--lightning-none)', 'var(--lightning-low)', 'var(--lightning-some)', 'var(--lightning-high)'][i] }} />
              {l}
            </span>
          ))}
        </div>
      ) : (
        <div class="legend">
          <span class="key">
            <span class="swatch round" style={{ background: 'var(--accent)' }} />
            {{ temp: 'Temperature', feels: 'Feels like', cloud: 'Cloud cover %', rh: 'Humidity %' }[tab as 'temp']}
          </span>
          {day === 0 && <span class="muted">Outlined bars are past hours</span>}
        </div>
      )}
    </>
  );
}

function SunMoon({ bundle, day }: { bundle: Bundle; day: number }) {
  const tz = bundle.location.timezone;
  const d = bundle.daily;
  const dayStart = d.time[day] * 1000;
  const { rise, set } = moonTimes(dayStart, bundle.location.lat, bundle.location.lon);
  const { fraction, phase } = moonIllumination(dayStart + 12 * 3_600_000);
  return (
    <div class="sunmoon">
      <div>
        <Icon name="sunrise" size={30} />
        <span>
          <div class="lbl">Sunrise</div>
          <div class="val">{d.sunrise[day] ? fmtClock(d.sunrise[day], tz) : '–'}</div>
        </span>
        <span>
          <div class="lbl">Sunset</div>
          <div class="val">{d.sunset[day] ? fmtClock(d.sunset[day], tz) : '–'}</div>
        </span>
      </div>
      <div>
        <MoonGlyph phase={phase} />
        <span>
          <div class="lbl">Moonrise</div>
          <div class="val">{rise ? fmtClock(rise / 1000, tz) : '–'}</div>
        </span>
        <span>
          <div class="lbl">Moonset</div>
          <div class="val">{set ? fmtClock(set / 1000, tz) : '–'}</div>
        </span>
        <span>
          <div class="lbl">{moonPhaseName(phase)}</div>
          <div class="val">{Math.round(fraction * 100)}% illumination</div>
        </span>
      </div>
    </div>
  );
}

/** Moon disc lit according to the phase (0 new, 0.5 full). */
function MoonGlyph({ phase }: { phase: number }) {
  const r = 11;
  const waxing = phase < 0.5;
  // Terminator ellipse: x radius goes r -> 0 -> r as the lit fraction goes 0 -> 0.5 -> 1.
  const k = Math.cos(phase * 2 * Math.PI);
  const rx = Math.abs(k) * r;
  const litRight = waxing;
  const sweepOuter = litRight ? 1 : 0;
  const sweepInner = (k > 0) === litRight ? 0 : 1;
  const d = `M15 ${15 - r} A${r} ${r} 0 0 ${sweepOuter} 15 ${15 + r} A${rx} ${r} 0 0 ${sweepInner} 15 ${15 - r} Z`;
  return (
    <svg width={30} height={30} viewBox="0 0 30 30" aria-hidden="true">
      <circle cx={15} cy={15} r={r} fill="#3a3d42" stroke="var(--text-3)" stroke-width={1} />
      <path d={d} fill="#f2e6b0" />
    </svg>
  );
}
