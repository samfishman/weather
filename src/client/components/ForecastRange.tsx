import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Bundle } from '../../shared/types';
import { MODEL_BY_KEY, type ModelKey } from '../../shared/models';
import { periodOf, type Period } from '../../shared/derive';
import { Icon } from '../icons';
import { fmtDate, fmtDayShort, fmtHourShort, fmtRun, heightUnit, toHeight, toWind, windUnit, type Units } from '../format';
import { RANGE_METRICS, bundlePeriods, dayStarts, periodType, rangeLines, type Line, type RangeMetric } from '../metrics';

export type ModelChoice = ModelKey | 'all';

export const DAY_OPTIONS = [1, 3, 5, 10, 15];

interface Props {
  bundle: Bundle;
  units: Units;
  model: ModelChoice;
  onModel: (m: ModelChoice) => void;
  days: number;
  onDays: (d: number) => void;
  metric: RangeMetric;
  onMetric: (m: RangeMetric) => void;
  marker: number;
  onMarker: (hour: number) => void;
}

const UPPER_H = 250;
const AXIS_H = 22;
const LOWER_H = 96;
const PAD_L = 50;
const PAD_R = 14;
const PAD_T = 10;

interface Hover {
  hour: number;
  lineId: string | null;
  x: number;
  y: number;
}

export function ModelSelect({ bundle, value, onChange }: { bundle: Bundle; value: ModelChoice; onChange: (m: ModelChoice) => void }) {
  return (
    <label class="select">
      <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as ModelChoice)} aria-label="Model">
        <option value="all">🌎 All Models (last 3 runs)</option>
        {bundle.models.map((k) => (
          <option value={k} key={k}>
            {{ eu: '🇪🇺', us: '🇺🇸', de: '🇩🇪', ca: '🇨🇦' }[MODEL_BY_KEY[k].flag]} {MODEL_BY_KEY[k].label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={15} />
    </label>
  );
}

export function DaysSelect({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <label class="select">
      <select value={value} onChange={(e) => onChange(Number((e.target as HTMLSelectElement).value))} aria-label="Days">
        {DAY_OPTIONS.map((d) => (
          <option value={d} key={d}>
            {d} Day{d > 1 ? 's' : ''}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={15} />
    </label>
  );
}

function niceStep(range: number, target = 5): number {
  const raw = range / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function formatValue(metric: RangeMetric, v: number | null, units: Units): string {
  if (v == null || Number.isNaN(v)) return '–';
  switch (metric) {
    case 'temp': return `${Math.round(v)}°`;
    case 'totalPrecip':
    case 'precip12': return units === 'imperial' ? `${v.toFixed(2)}"` : `${v.toFixed(1)} mm`;
    case 'wind':
    case 'gust': return `${Math.round(v)} ${windUnit(units)}`;
    case 'cloud': return `${Math.round(v)}%`;
    case 'snowLevel': {
      const step = units === 'imperial' ? 100 : 50;
      return `${(Math.round(v / step) * step).toLocaleString('en-US')} ${heightUnit(units)}`;
    }
  }
}

export function ForecastRange({ bundle, units, model, onModel, days, onDays, metric, onMetric, marker, onMarker }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(900);
  const [hover, setHover] = useState<Hover | null>(null);
  const tz = bundle.location.timezone;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 16));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const periods = useMemo(() => bundlePeriods(bundle), [bundle]);
  const lines = useMemo(() => rangeLines(bundle, metric, units, periods), [bundle, metric, units, periods]);
  const starts = useMemo(() => dayStarts(bundle), [bundle]);
  const xEnd = Math.min(bundle.grid.length, starts[days] ?? days * 24);
  const isPeriodic = metric === 'precip12';
  const arrowRow = metric === 'wind' || metric === 'gust' ? 16 : 0;
  const height = PAD_T + arrowRow + UPPER_H + AXIS_H + LOWER_H + 8;
  const plotW = Math.max(100, width - PAD_L - PAD_R);
  const x = (hour: number) => PAD_L + (hour / xEnd) * plotW;
  const hourAtX = (px: number) => Math.max(0, Math.min(xEnd - 1, Math.round(((px - PAD_L) / plotW) * xEnd)));
  const upperTop = PAD_T + arrowRow;
  const upperBottom = upperTop + UPPER_H;
  const lowerTop = upperBottom + AXIS_H;
  const lowerBottom = lowerTop + LOWER_H;

  /** Points of a line as [hour, value] within the visible range. */
  const pointsOf = (l: Line): [number, number][] => {
    const pts: [number, number][] = [];
    if (isPeriodic) {
      periods.forEach(([a, b], p) => {
        const v = l.values[p];
        if (v != null && b <= xEnd) pts.push([(a + b) / 2, v]);
      });
    } else {
      for (let i = 0; i < xEnd; i++) {
        const v = l.values[i];
        if (v != null) pts.push([i, v]);
      }
    }
    return pts;
  };

  // Y domain.
  const yDomain = useMemo(() => {
    const all = [lines.blend, ...lines.runs].flatMap((l) => pointsOf(l).map(([, v]) => v));
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (!all.length) {
      lo = 0;
      hi = 1;
    }
    switch (metric) {
      case 'temp':
        lo -= 2;
        hi += 2;
        break;
      case 'cloud':
        lo = 0;
        hi = 100;
        break;
      case 'wind':
      case 'gust':
        lo = 0;
        hi = Math.max(hi * 1.05, toWind(70, units));
        break;
      case 'snowLevel':
        lo = 0;
        hi = Math.max(hi, toHeight(bundle.location.elevation, units)) * 1.08;
        break;
      default:
        lo = 0;
        hi = Math.max(hi * 1.1, units === 'imperial' ? 0.5 : 10);
    }
    const step = niceStep(hi - lo);
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
  }, [lines, metric, units, xEnd]);

  const y = (v: number) => upperBottom - ((v - yDomain.lo) / (yDomain.hi - yDomain.lo)) * UPPER_H;
  const selectedRuns = (l: Line) => model !== 'all' && l.model === model;
  const activeHour = hover?.hour ?? Math.min(marker, xEnd - 1);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    cv.style.height = `${height}px`;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const css = getComputedStyle(cv);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const font = (size: number, weight = 400) => `${weight} ${size}px ${getComputedStyle(document.body).fontFamily}`;

    // ---- Upper panel backgrounds ----
    if (metric === 'wind' || metric === 'gust') {
      const mph = (m: number) => toWind(m * 1.609344, units);
      const bands: [number, number, string, string][] = [
        [0, mph(10), v('--band-light'), 'Light'],
        [mph(10), mph(20), v('--band-moderate'), 'Moderate'],
        [mph(20), mph(35), v('--band-strong'), 'Strong'],
        [mph(35), yDomain.hi, v('--band-very'), 'Very Strong'],
      ];
      ctx.font = font(11, 600);
      for (const [a, b, color, label] of bands) {
        const top = y(Math.min(b, yDomain.hi));
        const bottom = y(a);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = color;
        ctx.fillRect(PAD_L, top, plotW, bottom - top);
        ctx.globalAlpha = 1;
        ctx.fillStyle = v('--text-2');
        if (bottom - top > 14) ctx.fillText(label, PAD_L + 6, top + 13);
      }
    }
    if (metric === 'snowLevel') {
      ctx.fillStyle = v('--snow-zone');
      ctx.globalAlpha = 0.6;
      ctx.fillRect(PAD_L, upperTop, plotW, UPPER_H);
      const pts = pointsOf(lines.blend);
      if (pts.length) {
        ctx.fillStyle = v('--rain-zone');
        ctx.beginPath();
        ctx.moveTo(x(pts[0][0]), upperBottom);
        for (const [hr, val] of pts) ctx.lineTo(x(hr), y(val));
        ctx.lineTo(x(pts[pts.length - 1][0]), upperBottom);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.font = font(11, 600);
      ctx.fillStyle = v('--text-2');
      ctx.fillText('Snow', PAD_L + 6, upperTop + 14);
      ctx.fillText('Rain', PAD_L + 6, upperBottom - 18);
    }

    // ---- Grid ----
    ctx.strokeStyle = v('--grid');
    ctx.lineWidth = 1;
    ctx.font = font(11);
    ctx.fillStyle = v('--text-3');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let t = yDomain.lo; t <= yDomain.hi + 1e-9; t += yDomain.step) {
      const gy = Math.round(y(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD_L, gy);
      ctx.lineTo(PAD_L + plotW, gy);
      ctx.stroke();
      let label = '';
      if (metric === 'temp') label = `${Math.round(t)}°`;
      else if (metric === 'cloud') label = `${Math.round(t)}%`;
      else if (metric === 'snowLevel') label = `${Math.round(t).toLocaleString('en-US')}`;
      else if (metric === 'wind' || metric === 'gust') label = `${Math.round(t)}`;
      else label = units === 'imperial' ? `${t.toFixed(t < 1 && yDomain.step < 0.5 ? 2 : 1)}"` : `${Math.round(t)}`;
      ctx.fillText(label, PAD_L - 6, gy);
    }
    ctx.textBaseline = 'alphabetic';
    // Midnight lines and day labels.
    const dayLabelEvery = plotW / days < 46 ? 2 : 1;
    ctx.textAlign = 'center';
    starts.forEach((s, d) => {
      if (s > xEnd) return;
      const gx = Math.round(x(s)) + 0.5;
      ctx.strokeStyle = v('--grid');
      for (const [top, bottom] of [[upperTop, upperBottom], [lowerTop, lowerBottom]]) {
        ctx.beginPath();
        ctx.moveTo(gx, top);
        ctx.lineTo(gx, bottom);
        ctx.stroke();
      }
      if (d < days && d % dayLabelEvery === 0) {
        ctx.fillStyle = v('--text-3');
        const t = bundle.grid.start + s * bundle.grid.step;
        const label = days === 1 ? fmtDate(t, tz) : fmtDayShort(t, tz);
        ctx.fillText(label, x(days <= 2 ? s + 1.5 : s) + (days <= 2 ? 10 : 0), upperBottom + 15);
      }
    });
    if (days <= 3) {
      // Hour ticks on short ranges.
      ctx.fillStyle = v('--text-3');
      ctx.font = font(10);
      for (let i = 6; i < xEnd; i += 6) {
        if (starts.includes(i)) continue;
        ctx.fillText(fmtHourShort(bundle.grid.start + i * bundle.grid.step, tz), x(i), upperBottom + 15);
      }
    }

    // ---- Lines ----
    const drawLine = (l: Line, color: string, lw: number, alpha = 1) => {
      const pts = pointsOf(l);
      if (!pts.length) return;
      ctx.globalAlpha = alpha;
      if (isPeriodic) {
        ctx.fillStyle = color;
        for (const [hr, val] of pts) {
          ctx.beginPath();
          ctx.arc(x(hr), y(val), Math.max(2.5, lw + 1.5), 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        pts.forEach(([hr, val], k) => {
          const px = x(hr);
          const py = y(val);
          if (k === 0 || hr - pts[k - 1][0] > (isPeriodic ? 12 : 1)) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    const runColor = v('--run-line');
    for (const l of lines.runs) if (!selectedRuns(l) && l.id !== hover?.lineId) drawLine(l, runColor, 1, 0.45);
    for (const l of lines.runs) if (selectedRuns(l) && l.id !== hover?.lineId) drawLine(l, v('--selected-line'), l.age === 0 ? 2.5 : 1.25);
    // Blend: thick line with a surface-colored edge so it reads over the others.
    if (isPeriodic) {
      for (const [hr, val] of pointsOf(lines.blend)) {
        ctx.fillStyle = v('--surface');
        ctx.beginPath();
        ctx.arc(x(hr), y(val), 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = v('--blend-line');
        ctx.beginPath();
        ctx.arc(x(hr), y(val), 6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      drawLine(lines.blend, v('--surface'), 6);
      drawLine(lines.blend, v('--blend-line'), 3);
    }
    const hovered = [...lines.runs, lines.blend].find((l) => l.id === hover?.lineId);
    if (hovered && hovered.id !== 'blend') drawLine(hovered, v('--text'), 2.25);

    // Forecast point elevation on the snow level chart.
    if (metric === 'snowLevel') {
      const py = Math.round(y(toHeight(bundle.location.elevation, units))) + 0.5;
      ctx.strokeStyle = v('--text');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD_L, py);
      ctx.lineTo(PAD_L + plotW, py);
      ctx.stroke();
      ctx.font = font(10.5, 700);
      const tw = ctx.measureText('Point').width + 8;
      ctx.fillStyle = v('--text');
      ctx.fillRect(PAD_L - tw - 2, py - 8, tw, 16);
      ctx.fillStyle = v('--surface');
      ctx.textAlign = 'center';
      ctx.fillText('Point', PAD_L - 2 - tw / 2, py + 4);
    }

    // Wind direction arrows along the top (direction the wind blows toward).
    if (arrowRow) {
      const every = days <= 3 ? 3 : days <= 5 ? 6 : 12;
      ctx.strokeStyle = v('--text-2');
      ctx.lineWidth = 1.25;
      for (let i = 0; i < xEnd; i += every) {
        const dir = bundle.hourly.windDir[i];
        if (dir == null) continue;
        const a = ((dir + 180) * Math.PI) / 180;
        const cx = x(i);
        const cy = PAD_T + 7;
        const dx = Math.sin(a) * 6;
        const dy = -Math.cos(a) * 6;
        ctx.beginPath();
        ctx.moveTo(cx - dx, cy - dy);
        ctx.lineTo(cx + dx, cy + dy);
        ctx.moveTo(cx + dx, cy + dy);
        ctx.lineTo(cx + dx - Math.sin(a - 0.5) * 4, cy + dy + Math.cos(a - 0.5) * 4);
        ctx.moveTo(cx + dx, cy + dy);
        ctx.lineTo(cx + dx - Math.sin(a + 0.5) * 4, cy + dy + Math.cos(a + 0.5) * 4);
        ctx.stroke();
      }
    }

    // ---- Lower panel: cloud cover area and precip chance per 12 hours ----
    const ly = (pct: number) => lowerBottom - (pct / 100) * LOWER_H;
    ctx.strokeStyle = v('--grid');
    ctx.lineWidth = 1;
    ctx.font = font(10);
    ctx.fillStyle = v('--text-3');
    ctx.textAlign = 'right';
    for (const pct of [0, 25, 50, 75, 100]) {
      const gy = Math.round(ly(pct)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD_L, gy);
      ctx.lineTo(PAD_L + plotW, gy);
      ctx.stroke();
      ctx.fillText(`${pct}%`, PAD_L - 6, gy + 3);
    }
    const cloud = bundle.blend.cloud;
    ctx.beginPath();
    ctx.moveTo(x(0), lowerBottom);
    for (let i = 0; i < xEnd; i++) if (cloud[i] != null) ctx.lineTo(x(i), ly(cloud[i]!));
    ctx.lineTo(x(xEnd - 1), lowerBottom);
    ctx.closePath();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = v('--cloud');
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = v('--cloud');
    ctx.stroke();
    ctx.globalAlpha = 1;
    const barW = Math.min(18, (plotW / xEnd) * 12 * 0.5);
    periods.forEach((p: Period) => {
      if (p[1] > xEnd) return;
      const pops = bundle.hourly.pop.slice(p[0], p[1]).filter((n): n is number => n != null);
      const pop = pops.length ? Math.max(...pops) : 0;
      if (pop <= 0) return;
      const type = periodType(bundle.blend, p) ?? 'rain';
      ctx.fillStyle = v(`--${type}`);
      const cx = x((p[0] + p[1]) / 2);
      const top = ly(pop);
      const r = Math.min(4, (lowerBottom - top) / 2);
      ctx.beginPath();
      ctx.moveTo(cx - barW / 2, lowerBottom);
      ctx.lineTo(cx - barW / 2, top + r);
      ctx.quadraticCurveTo(cx - barW / 2, top, cx - barW / 2 + r, top);
      ctx.lineTo(cx + barW / 2 - r, top);
      ctx.quadraticCurveTo(cx + barW / 2, top, cx + barW / 2, top + r);
      ctx.lineTo(cx + barW / 2, lowerBottom);
      ctx.fill();
    });

    // ---- Marker ----
    const mh = isPeriodic ? (() => {
      const p = periods[Math.max(0, periodOf(periods, activeHour))];
      return p ? (p[0] + p[1]) / 2 : activeHour;
    })() : activeHour;
    const mx = Math.round(x(mh)) + 0.5;
    ctx.strokeStyle = v('--text');
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const [top, bottom] of [[upperTop, upperBottom], [lowerTop, lowerBottom]]) {
      ctx.beginPath();
      ctx.moveTo(mx, top);
      ctx.lineTo(mx, bottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }, [width, height, lines, yDomain, model, hover, marker, days, metric, units, bundle, xEnd]);

  const onMove = (e: PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < PAD_L || px > PAD_L + plotW) return setHover(null);
    const hour = hourAtX(px);
    let lineId: string | null = null;
    if (py >= upperTop && py <= upperBottom) {
      let best = 10;
      const idx = isPeriodic ? periodOf(periods, hour) : hour;
      for (const l of [lines.blend, ...lines.runs]) {
        const val = idx >= 0 ? l.values[idx] : null;
        if (val == null) continue;
        const d = Math.abs(y(val) - py);
        if (d < best) {
          best = d;
          lineId = l.id;
        }
      }
    }
    setHover({ hour, lineId, x: px, y: py });
  };

  // ---- Readout ----
  const idx = isPeriodic ? periodOf(periods, activeHour) : activeHour;
  const valueAt = (l: Line) => (idx >= 0 ? l.values[idx] : null);
  const runValues = lines.runs.map(valueAt).filter((n): n is number => n != null);
  const blendValue = valueAt(lines.blend);
  const period = periods[periodOf(periods, activeHour)];
  const tAt = bundle.grid.start + activeHour * bundle.grid.step;
  const periodName = period ? (periods.indexOf(period) % 2 === 0 ? 'Day' : 'Night') : '';
  const meta = RANGE_METRICS.find((m) => m.key === metric)!;
  const label = (suffix: string) => (metric === 'temp' ? `${suffix} Temperature` : metric === 'snowLevel' ? `${suffix} Snow Level` : `${suffix} ${meta.readout}`);
  const latestSelected = model !== 'all' ? lines.runs.find((l) => l.model === model && l.age === 0) : undefined;
  const selectedRun = model !== 'all' ? bundle.runs.find((r) => r.model === model && r.age === 0) : undefined;
  const selVal = latestSelected ? valueAt(latestSelected) : null;
  const diff = selVal != null && blendValue != null && blendValue !== 0 ? ((selVal - blendValue) / Math.abs(blendValue)) * 100 : null;
  const hoveredLine = hover?.lineId ? [lines.blend, ...lines.runs].find((l) => l.id === hover.lineId) : undefined;

  return (
    <section class="section">
      <h2>Forecast Range</h2>
      <div class="card">
        <div class="controls">
          <ModelSelect bundle={bundle} value={model} onChange={onModel} />
          <DaysSelect value={days} onChange={onDays} />
          <span class="vsep" />
          {RANGE_METRICS.map((m) => (
            <button class={`pill${m.key === metric ? ' active' : ''}`} key={m.key} onClick={() => onMetric(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        <div class="chart-wrap" ref={wrap}>
          <canvas
            ref={canvas}
            style={{ width: `${width}px` }}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onClick={() => hover && onMarker(hover.hour)}
            aria-label={`${meta.label} from every model run`}
            role="img"
          />
          {hoveredLine && hover && (
            <div class="tooltip" style={{ left: `${Math.min(hover.x + 22, width - 160)}px`, top: `${Math.max(0, hover.y - 52)}px` }}>
              <div class="tl">{hoveredLine.id === 'blend' ? blendName(bundle) : hoveredLine.label}</div>
              <div class="tv">{formatValue(metric, valueAt(hoveredLine), units)}</div>
            </div>
          )}
        </div>
        <div class="legend">
          <span class="key"><span class="swatch" style={{ background: 'var(--cloud)', opacity: 0.6 }} />Cloud Cover</span>
          <span class="key"><span class="swatch" style={{ background: 'var(--snow)' }} />Snow</span>
          <span class="key"><span class="swatch" style={{ background: 'var(--mix)' }} />Mix</span>
          <span class="key"><span class="swatch" style={{ background: 'var(--rain)' }} />Rain</span>
          <span class="key"><span class="keyline" style={{ background: 'var(--blend-line)' }} />{blendName(bundle)}</span>
          <span class="key"><span class="keyline" style={{ background: 'var(--run-line)', opacity: 0.6, height: '2px' }} />Model runs</span>
          {model !== 'all' && <span class="key"><span class="keyline" style={{ background: 'var(--selected-line)' }} />{MODEL_BY_KEY[model].short}</span>}
        </div>
        <div class="readout">
          <h3>
            {meta.readout}
            <span>
              {fmtDate(tAt, tz)}
              {metric === 'totalPrecip' || metric === 'precip12' ? '' : ` ${fmtHourShort(tAt, tz)}m`}
              {periodName ? ` - ${periodName}` : ''}
            </span>
          </h3>
          {model === 'all' ? (
            <div class="cards">
              <div class="rcard"><span class="keyline" style={{ background: 'var(--blend-line)' }} />{blendName(bundle)}<span class="v">{formatValue(metric, blendValue, units)}</span></div>
              <div class="rcard"><span class="keyline" style={{ background: 'var(--run-line)' }} />{label('Max')}<span class="v">{formatValue(metric, runValues.length ? Math.max(...runValues) : null, units)}</span></div>
              <div class="rcard"><span class="keyline" style={{ background: 'var(--run-line)', opacity: 0.6 }} />{label('Min')}<span class="v">{formatValue(metric, runValues.length ? Math.min(...runValues) : null, units)}</span></div>
            </div>
          ) : (
            <div class="cards two">
              <div class="rcard"><span class="keyline" style={{ background: 'var(--blend-line)' }} />{blendName(bundle)}<span class="v">{formatValue(metric, blendValue, units)}</span></div>
              <div class="rcard">
                <span class="keyline" style={{ background: 'var(--selected-line)' }} />
                {MODEL_BY_KEY[model].short}
                <span class="v">
                  {diff != null && Number.isFinite(diff) && <span class="diff">{diff > 0 ? '+' : ''}{diff.toFixed(1)}%</span>}
                  {formatValue(metric, selVal, units)}
                </span>
              </div>
            </div>
          )}
          <p class="note">
            {model === 'all' || !selectedRun
              ? blendNote(bundle)
              : `The ${fmtRun(selectedRun.init)} run of ${MODEL_BY_KEY[model].label}${MODEL_BY_KEY[model].kind === 'ensemble' ? ' (mean of all members)' : ''}. ${MODEL_BY_KEY[model].kind === 'ensemble' ? '' : 'Thinner lines show the two runs before it.'}`}
            {metric === 'snowLevel' ? ' Snow level is where the wet-bulb temperature falls to 0.5°C (the NWS method).' : ''}
            {' '}Hover a line to name it; click to move the marker.
          </p>
        </div>
      </div>
    </section>
  );
}

export function blendName(b: Bundle): string {
  return b.blendMode === 'median' ? 'Model median' : 'Blend';
}

function blendNote(b: Bundle): string {
  return b.blendMode === 'median'
    ? 'The model median is the middle value of the latest run of every model at each hour.'
    : "The blend is Open-Meteo's best match: the best-suited local model at each lead time, adjusted to this elevation.";
}
