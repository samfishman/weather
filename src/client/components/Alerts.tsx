import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../icons';
import { fmtStamp } from '../format';

// Active National Weather Service alerts for the forecast point. Fetched live from the browser rather than
// stored in the forecast bundle, which can be minutes or hours old.

interface NwsAlert {
  id: string;
  event: string;
  severity: string;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  areaDesc: string | null;
  senderName: string | null;
  onset: string | null;
  effective: string | null;
  ends: string | null;
  expires: string | null;
}

type State =
  | { status: 'loading' }
  | { status: 'outside' }
  | { status: 'failed' }
  | { status: 'ok'; alerts: NwsAlert[] };

const REFRESH_MS = 5 * 60_000;
const ORDER = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

async function fetchAlerts(lat: number, lon: number, signal: AbortSignal): Promise<State> {
  const res = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, {
    headers: { accept: 'application/geo+json' },
    signal,
  });
  // The NWS answers 400 for points outside its area, so there's nothing to check there.
  if (res.status === 400 || res.status === 404) return { status: 'outside' };
  if (!res.ok) return { status: 'failed' };
  const body: any = await res.json();
  const alerts: NwsAlert[] = (body.features ?? []).map((f: any) => ({ ...f.properties, id: f.properties.id ?? f.id }));
  alerts.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  return { status: 'ok', alerts };
}

const toUnix = (iso: string | null) => (iso ? Date.parse(iso) / 1000 : null);

function when(a: NwsAlert, tz: string): string {
  const start = toUnix(a.onset ?? a.effective);
  const end = toUnix(a.ends ?? a.expires);
  const nowS = Date.now() / 1000;
  const parts: string[] = [];
  if (start && start > nowS) parts.push(`From ${fmtStamp(start, tz)}`);
  if (end) parts.push(`${a.ends ? 'Until' : 'Expires'} ${fmtStamp(end, tz)}`);
  return parts.join(' · ');
}

export function Alerts({ lat, lon, tz }: { lat: number; lon: number; tz: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [open, setOpen] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      fetchAlerts(lat, lon, ctrl.signal)
        .then(setState)
        .catch((e) => {
          if (!ctrl.signal.aborted) setState({ status: 'failed' });
          return e;
        });
    setState({ status: 'loading' });
    setOpen(null);
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(t);
      ctrl.abort();
    };
  }, [lat, lon, attempt]);

  if (state.status === 'loading' || state.status === 'outside') return null;
  if (state.status === 'failed') {
    return (
      <div class="alerts-none">
        Couldn't check NWS alerts.{' '}
        <button class="linkbtn alert-retry" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  }
  if (!state.alerts.length) return <div class="alerts-none">No active NWS alerts here.</div>;

  return (
    <section class="alerts" aria-label="Weather alerts">
      {state.alerts.map((a) => {
        const isOpen = open === a.id;
        return (
          <div class={`alert sev-${a.severity.toLowerCase()}`} key={a.id}>
            <button class="alert-head" onClick={() => setOpen(isOpen ? null : a.id)} aria-expanded={isOpen}>
              <Icon name="warning" size={18} />
              <span class="alert-title">
                <span class="alert-event">{a.event}</span>
                <span class="alert-when">{when(a, tz)}</span>
              </span>
              <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={16} />
            </button>
            {isOpen && (
              <div class="alert-body">
                {a.headline && <p class="alert-headline">{a.headline}</p>}
                {a.description && <p>{a.description}</p>}
                {a.instruction && <p>{a.instruction}</p>}
                <p class="alert-meta">
                  {a.senderName}
                  {a.areaDesc ? ` · ${a.areaDesc}` : ''} ·{' '}
                  <a href={`https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`} target="_blank" rel="noreferrer">
                    weather.gov
                  </a>
                </p>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
