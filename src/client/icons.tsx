// Weather icons (inline SVG, stroke = currentColor) and WMO weather code descriptions.

import type { JSX } from 'preact';

export function codeText(code: number | null, isDay = true): string {
  switch (code) {
    case 0: return isDay ? 'Sunny' : 'Clear';
    case 1: return isDay ? 'Mostly sunny' : 'Mostly clear';
    case 2: return 'Partly cloudy';
    case 3: return 'Cloudy';
    case 45: return 'Fog';
    case 48: return 'Freezing fog';
    case 51: case 53: case 55: return 'Drizzle';
    case 56: case 57: return 'Freezing drizzle';
    case 61: return 'Light rain';
    case 63: return 'Rain';
    case 65: return 'Heavy rain';
    case 66: case 67: return 'Freezing rain';
    case 71: return 'Light snow';
    case 73: return 'Snow';
    case 75: return 'Heavy snow';
    case 77: return 'Snow grains';
    case 80: return 'Rain showers';
    case 81: case 82: return 'Heavy showers';
    case 85: case 86: return 'Snow showers';
    case 95: return 'Thunderstorms';
    case 96: case 99: return 'Thunderstorms with hail';
    default: return '–';
  }
}

type Kind = 'sun' | 'moon' | 'partly' | 'partlyNight' | 'cloud' | 'fog' | 'rain' | 'snow' | 'mix' | 'thunder';

export function iconKind(code: number | null, isDay = true): Kind {
  if (code == null) return 'cloud';
  if (code <= 1) return isDay ? 'sun' : 'moon';
  if (code === 2) return isDay ? 'partly' : 'partlyNight';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'mix';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'rain';
}

const sw = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;

const cloudPath = 'M7 18h10a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 6.6 11.1 3.5 3.5 0 0 0 7 18z';

function Sun({ cx = 12, cy = 12, r = 4 }: { cx?: number; cy?: number; r?: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return <line key={i} x1={cx + Math.cos(a) * (r + 2.5)} y1={cy + Math.sin(a) * (r + 2.5)} x2={cx + Math.cos(a) * (r + 4.5)} y2={cy + Math.sin(a) * (r + 4.5)} />;
  });
  return (
    <g {...sw}>
      <circle cx={cx} cy={cy} r={r} />
      {rays}
    </g>
  );
}

function Drops({ color }: { color?: string }) {
  return (
    <g fill={color ?? 'currentColor'} stroke="none">
      <path d="M9 9.5c1.6 2.2 2.4 3.6 2.4 4.6a2.4 2.4 0 0 1-4.8 0c0-1 .8-2.4 2.4-4.6z" />
      <path d="M15.5 12c1.6 2.2 2.4 3.6 2.4 4.6a2.4 2.4 0 0 1-4.8 0c0-1 .8-2.4 2.4-4.6z" />
    </g>
  );
}

function Flake({ x = 12, y = 12, s = 5, color }: { x?: number; y?: number; s?: number; color?: string }) {
  return (
    <g {...sw} stroke={color ?? 'currentColor'}>
      {[0, 60, 120].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return <line key={deg} x1={x - Math.cos(a) * s} y1={y - Math.sin(a) * s} x2={x + Math.cos(a) * s} y2={y + Math.sin(a) * s} />;
      })}
    </g>
  );
}

export function WeatherIcon({ code, isDay = true, size = 24, precipColor, class: cls }: { code: number | null; isDay?: boolean; size?: number; precipColor?: string; class?: string }) {
  const kind = iconKind(code, isDay);
  let body: JSX.Element;
  switch (kind) {
    case 'sun':
      body = <Sun />;
      break;
    case 'moon':
      body = <path {...sw} d="M16.5 15.5A6.5 6.5 0 0 1 9 6a6.5 6.5 0 1 0 7.5 9.5z" />;
      break;
    case 'partly':
      body = (
        <>
          <Sun cx={9} cy={9} r={3} />
          <path {...sw} d={cloudPath} transform="translate(2 1)" fill="var(--surface)" />
        </>
      );
      break;
    case 'partlyNight':
      body = (
        <>
          <path {...sw} d="M12 9.5A4.5 4.5 0 0 1 6.5 4a4.5 4.5 0 1 0 5.5 5.5z" />
          <path {...sw} d={cloudPath} transform="translate(2 1)" fill="var(--surface)" />
        </>
      );
      break;
    case 'cloud':
      body = <path {...sw} d={cloudPath} transform="translate(0 -1)" />;
      break;
    case 'fog':
      body = (
        <g {...sw}>
          <path d={cloudPath} transform="translate(0 -4) scale(1 .85)" />
          <line x1="5" y1="17" x2="19" y2="17" />
          <line x1="7" y1="20" x2="17" y2="20" />
        </g>
      );
      break;
    case 'rain':
      body = <Drops color={precipColor} />;
      break;
    case 'snow':
      body = <Flake color={precipColor} s={6.5} />;
      break;
    case 'mix':
      body = (
        <>
          <g fill={precipColor ?? 'currentColor'}>
            <path d="M8 9c1.5 2 2.2 3.3 2.2 4.2a2.2 2.2 0 0 1-4.4 0c0-.9.7-2.2 2.2-4.2z" />
          </g>
          <Flake x={15.5} y={14} s={4.2} color={precipColor} />
        </>
      );
      break;
    case 'thunder':
      body = (
        <>
          <path {...sw} d={cloudPath} transform="translate(0 -4)" />
          <path d="M12.5 13l-3 4.5h2.6l-1.3 4 4-5.3h-2.7l1.4-3.2z" fill={precipColor ?? 'currentColor'} />
        </>
      );
      break;
  }
  return (
    <svg class={cls} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {body}
    </svg>
  );
}

/** Drop color for a day's peak precip chance, as on OpenSnow: yellow, then orange, then red. */
export function precipChanceColor(pop: number | null): string | undefined {
  if (pop == null || pop < 20) return undefined;
  if (pop >= 70) return 'var(--pop-high)';
  if (pop >= 50) return 'var(--pop-mid)';
  return 'var(--pop-low)';
}

export function Icon({ name, size = 16 }: { name: 'pin' | 'map' | 'star' | 'starFilled' | 'search' | 'locate' | 'wind' | 'info' | 'chevronLeft' | 'chevronRight' | 'chevronDown' | 'thermo' | 'drops' | 'cloud' | 'humidity' | 'bolt' | 'sunrise' | 'moonPhase' | 'clock'; size?: number }) {
  const paths: Record<string, JSX.Element> = {
    pin: <path {...sw} d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />,
    map: <path {...sw} d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />,
    star: <path {...sw} d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />,
    starFilled: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="var(--star)" stroke="var(--star)" stroke-width="1.6" stroke-linejoin="round" />,
    search: <g {...sw}><circle cx="11" cy="11" r="6.5" /><line x1="16" y1="16" x2="20.5" y2="20.5" /></g>,
    locate: <g {...sw}><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></g>,
    wind: <path {...sw} d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5M3 12h16a2.5 2.5 0 1 1-2.5 2.5M3 16h9" />,
    info: <g {...sw}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.2" /></g>,
    chevronLeft: <path {...sw} d="M14.5 6l-6 6 6 6" />,
    chevronRight: <path {...sw} d="M9.5 6l6 6-6 6" />,
    chevronDown: <path {...sw} d="M6 9.5l6 6 6-6" />,
    thermo: <path {...sw} d="M10 14.5V5a2 2 0 0 1 4 0v9.5a3.5 3.5 0 1 1-4 0z" />,
    drops: <Drops />,
    cloud: <path {...sw} d={cloudPath} transform="translate(0 -1)" />,
    humidity: <path {...sw} d="M12 3.5c3.5 4.6 5.5 7.8 5.5 10.2a5.5 5.5 0 0 1-11 0c0-2.4 2-5.6 5.5-10.2z" />,
    bolt: <path {...sw} d="M13 3L6 13.5h5.5L10 21l8-11.5h-5.5z" />,
    sunrise: <Sun />,
    moonPhase: <path {...sw} d="M16.5 15.5A6.5 6.5 0 0 1 9 6a6.5 6.5 0 1 0 7.5 9.5z" />,
    clock: <g {...sw}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></g>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" class="ico">
      {paths[name]}
    </svg>
  );
}
