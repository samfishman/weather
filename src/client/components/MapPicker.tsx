import { useEffect, useRef, useState } from 'preact/hooks';
import type * as Leaflet from 'leaflet';
import { Icon, WeatherIcon, precipChanceColor } from '../icons';
import { fmtPrecip, fmtSnow, fmtTemp, heightUnit, tempUnit, toHeight, type Units } from '../format';
import { geolocate, placeTitle, reverseGeocode, searchPlaces, terrainElevation, type Place, type SearchResult } from '../location';
import { AVALANCHE_SCALE, BASES, OVERLAYS, WEATHER_PANE, arcgisLegend, makeOverlay, radarFrames, type BaseKey, type LegendItem, type OverlayKey, type RadarFrame } from '../maplayers';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (p: Place) => void;
  current: Place | null;
  favorites: Place[];
  units: Units;
}

interface QuickDay {
  time: string;
  code: number | null;
  tmax: number | null;
  tmin: number | null;
  precip: number | null;
  snow: number | null;
  pop: number | null;
}

interface Pending {
  lat: number;
  lon: number;
  terrain: number | null;
  name: string | null;
  region?: string;
  countryCode?: string;
  days?: QuickDay[] | null;
}

const fmtElev = (m: number | null, u: Units) => (m == null ? '–' : `${Math.round(toHeight(m, u)).toLocaleString('en-US')} ${heightUnit(u)}`);
const fromDisplay = (v: number, u: Units) => (u === 'imperial' ? v / 3.28084 : v);
const PREFS_KEY = 'weather:map';

function loadPrefs(): { base: BaseKey; overlays: OverlayKey[] } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { base: p.base ?? 'topo', overlays: Array.isArray(p.overlays) ? p.overlays : [] };
  } catch {
    return { base: 'topo', overlays: [] };
  }
}

/** A three-day outlook for a tapped point, at the elevation the forecast would use. */
async function quickForecast(lat: number, lon: number, elevation: number | null, signal?: AbortSignal): Promise<QuickDay[] | null> {
  try {
    const q = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max',
      forecast_days: '3',
      timezone: 'auto',
    });
    if (elevation != null) q.set('elevation', String(Math.round(elevation)));
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal });
    const d: any = await res.json();
    if (!d.daily) return null;
    return d.daily.time.map((time: string, i: number) => ({
      time,
      code: d.daily.weather_code[i],
      tmax: d.daily.temperature_2m_max[i],
      tmin: d.daily.temperature_2m_min[i],
      precip: d.daily.precipitation_sum[i],
      snow: d.daily.snowfall_sum[i],
      pop: d.daily.precipitation_probability_max[i],
    }));
  } catch {
    return null;
  }
}

const dayName = (iso: string, i: number) =>
  i === 0 ? 'Today' : new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

export function MapPicker({ open, onClose, onPick, current, favorites, units }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const Lref = useRef<typeof Leaflet | null>(null);
  const baseLayer = useRef<Leaflet.Layer | null>(null);
  const overlayLayers = useRef(new Map<OverlayKey, Leaflet.Layer>());
  const radarLayers = useRef<Leaflet.TileLayer[]>([]);
  const pendingMarker = useRef<Leaflet.CircleMarker | null>(null);
  const currentMarker = useRef<Leaflet.CircleMarker | null>(null);
  const favLayer = useRef<Leaflet.LayerGroup | null>(null);

  const [ready, setReady] = useState(false);
  const [base, setBase] = useState<BaseKey>(() => loadPrefs().base);
  const [overlays, setOverlays] = useState<OverlayKey[]>(() => loadPrefs().overlays);
  const [panel, setPanel] = useState(false);
  // Legends start folded on phones so they don't cover the map.
  const [legendOpen, setLegendOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 720);
  const [legends, setLegends] = useState<Partial<Record<OverlayKey, LegendItem[]>>>({});
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [hover, setHover] = useState<{ lat: number; lon: number; elev: number | null } | null>(null);
  const [elevInput, setElevInput] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  // Leaflet handlers are bound once, so they read the latest units through a ref.
  const unitsRef = useRef(units);
  unitsRef.current = units;

  // Open and close the dialog with the prop.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (open) setTimeout(() => map.current?.invalidateSize(), 50);
  }, [open]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ base, overlays }));
    } catch {
      // Not saved in private mode.
    }
  }, [base, overlays]);

  // Create the map the first time the dialog opens. Leaflet loads only then.
  useEffect(() => {
    if (!open || map.current || !mapEl.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !mapEl.current) return;
      Lref.current = L;
      const center: [number, number] = current ? [current.lat, current.lon] : [39.5, -98.35];
      const m = L.map(mapEl.current, { zoomControl: false, worldCopyJump: true }).setView(center, current ? 11 : 4);
      m.createPane(WEATHER_PANE);
      const pane = m.getPane(WEATHER_PANE)!;
      pane.style.zIndex = '350';
      pane.style.pointerEvents = 'none';
      L.control.zoom({ position: 'topright' }).addTo(m);
      L.control.scale({ imperial: unitsRef.current === 'imperial', metric: unitsRef.current === 'metric', position: 'bottomright' }).addTo(m);
      m.on('click', (e) => choose(e.latlng.lat, e.latlng.lng));
      // Terrain elevation under the cursor once it rests (mouse only).
      let timer: ReturnType<typeof setTimeout> | undefined;
      let ctrl: AbortController | undefined;
      m.on('mousemove', (e) => {
        clearTimeout(timer);
        ctrl?.abort();
        const { lat, lng } = e.latlng;
        timer = setTimeout(async () => {
          ctrl = new AbortController();
          const elev = await terrainElevation(lat, lng, ctrl.signal);
          setHover({ lat, lon: lng, elev });
        }, 300);
      });
      m.on('mouseout', () => {
        clearTimeout(timer);
        setHover(null);
      });
      map.current = m;
      setReady(true);
      setTimeout(() => m.invalidateSize(), 50);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Base map.
  useEffect(() => {
    const L = Lref.current;
    const m = map.current;
    if (!ready || !L || !m) return;
    baseLayer.current?.remove();
    const def = BASES.find((b) => b.key === base) ?? BASES[0];
    baseLayer.current = def.make(L).addTo(m);
    (baseLayer.current as any).bringToBack?.();
  }, [ready, base]);

  // Static overlays: add the switched-on ones, remove the rest.
  useEffect(() => {
    const L = Lref.current;
    const m = map.current;
    if (!ready || !L || !m) return;
    for (const [key, layer] of overlayLayers.current) {
      if (!overlays.includes(key)) {
        layer.remove();
        overlayLayers.current.delete(key);
      }
    }
    for (const key of overlays) {
      if (key === 'radar' || overlayLayers.current.has(key)) continue;
      makeOverlay(L, key, m.getCenter().lng)
        .then((layer) => {
          if (!overlays.includes(key) || overlayLayers.current.has(key)) return;
          overlayLayers.current.set(key, layer.addTo(m));
        })
        .catch(() => {});
      const def = OVERLAYS.find((o) => o.key === key);
      if (def?.legendFrom && !legends[key]) {
        arcgisLegend(def.legendFrom, def.legendLayers)
          .then((items) => setLegends((l) => ({ ...l, [key]: items })))
          .catch(() => {});
      }
    }
  }, [ready, overlays]);

  // Animated radar: one tile layer per frame, shown in turn.
  const radarOn = overlays.includes('radar');
  useEffect(() => {
    const L = Lref.current;
    const m = map.current;
    if (!ready || !L || !m) return;
    if (!radarOn) {
      radarLayers.current.forEach((l) => l.remove());
      radarLayers.current = [];
      setFrames([]);
      return;
    }
    let cancelled = false;
    radarFrames()
      .then((fs) => {
        if (cancelled || !fs.length) return;
        radarLayers.current = fs.map((f) =>
          L.tileLayer(f.url, { pane: WEATHER_PANE, maxNativeZoom: 6, maxZoom: 19, opacity: 0, attribution: 'Radar © <a href="https://www.rainviewer.com/">RainViewer</a>' }).addTo(m),
        );
        setFrames(fs);
        setFrame(fs.length - 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready, radarOn]);

  useEffect(() => {
    radarLayers.current.forEach((l, i) => l.setOpacity(i === frame ? 0.7 : 0));
  }, [frame, frames]);

  useEffect(() => {
    if (!frames.length || !playing) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % frames.length), 600);
    return () => clearInterval(t);
  }, [frames, playing]);

  // The current forecast point and saved places.
  useEffect(() => {
    const L = Lref.current;
    const m = map.current;
    if (!ready || !L || !m) return;
    currentMarker.current?.remove();
    if (current) {
      currentMarker.current = L.circleMarker([current.lat, current.lon], { radius: 7, color: '#ffffff', weight: 2, fillColor: '#8a96a4', fillOpacity: 1 })
        .addTo(m)
        .bindTooltip('Current forecast point');
    }
    favLayer.current?.remove();
    favLayer.current = L.layerGroup(
      favorites
        .filter((f) => !current || Math.abs(f.lat - current.lat) > 1e-4 || Math.abs(f.lon - current.lon) > 1e-4)
        .map((f) =>
          L.circleMarker([f.lat, f.lon], { radius: 6, color: '#111213', weight: 2, fillColor: '#e8e6df', fillOpacity: 1 })
            .bindTooltip(placeTitle(f), { permanent: true, direction: 'right', offset: [8, 0], className: 'fav-label' })
            .on('click', (e) => {
              L.DomEvent.stopPropagation(e);
              choose(f.lat, f.lon, f);
            }),
        ),
    ).addTo(m);
  }, [ready, current?.lat, current?.lon, favorites]);

  useEffect(() => {
    if (!open) return;
    setPending(null);
    pendingMarker.current?.remove();
    if (current && map.current) map.current.setView([current.lat, current.lon], Math.max(map.current.getZoom(), 10));
  }, [open, current?.lat, current?.lon]);

  const choose = async (lat: number, lon: number, saved?: Place) => {
    const L = Lref.current;
    const m = map.current;
    if (!L || !m) return;
    pendingMarker.current?.remove();
    const signal = getComputedStyle(document.documentElement).getPropertyValue('--signal').trim() || '#c5ec4a';
    pendingMarker.current = L.circleMarker([lat, lon], { radius: 9, color: '#111213', weight: 2, fillColor: signal, fillOpacity: 1 }).addTo(m);
    setPanel(false);
    setPending({ lat, lon, terrain: null, name: saved ? saved.name : null, region: saved?.region, countryCode: saved?.countryCode, days: undefined });
    setElevInput('');
    const [terrain, info] = await Promise.all([terrainElevation(lat, lon), saved ? Promise.resolve(saved) : reverseGeocode(lat, lon)]);
    const elevation = saved?.elevation ?? terrain;
    setPending((p) => (p && p.lat === lat && p.lon === lon ? { ...p, terrain, name: info.name, region: info.region, countryCode: info.countryCode } : p));
    if (elevation != null) setElevInput(String(Math.round(toHeight(elevation, unitsRef.current))));
  };

  // Refresh the quick outlook when the point or the typed elevation changes.
  const typedM = elevInput.trim() !== '' && Number.isFinite(Number(elevInput)) ? fromDisplay(Number(elevInput), units) : null;
  useEffect(() => {
    if (!pending) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const days = await quickForecast(pending.lat, pending.lon, typedM ?? pending.terrain, ctrl.signal);
      if (!ctrl.signal.aborted) setPending((p) => (p && p.lat === pending.lat && p.lon === pending.lon ? { ...p, days } : p));
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [pending?.lat, pending?.lon, pending?.terrain, typedM]);

  // Search inside the map to jump somewhere, then tap to fine-tune.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => searchPlaces(query, ctrl.signal).then(setResults).catch(() => {}), 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const jump = (r: SearchResult) => {
    setQuery('');
    setResults(null);
    map.current?.setView([r.lat, r.lon], 12);
    choose(r.lat, r.lon);
  };

  const locate = async () => {
    setLocError(null);
    try {
      const { lat, lon } = await geolocate();
      map.current?.setView([lat, lon], 13);
      choose(lat, lon);
    } catch (e) {
      setLocError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggle = (key: OverlayKey) => setOverlays((o) => (o.includes(key) ? o.filter((k) => k !== key) : [...o, key]));

  const confirm = () => {
    if (!pending) return;
    const terrain = pending.terrain;
    const isTerrain = typedM == null || (terrain != null && Math.abs(typedM - terrain) < 1);
    onPick({
      lat: Number(pending.lat.toFixed(5)),
      lon: Number(pending.lon.toFixed(5)),
      name: pending.name ?? `${pending.lat.toFixed(3)}, ${pending.lon.toFixed(3)}`,
      region: pending.region,
      countryCode: pending.countryCode,
      elevation: typedM != null ? Math.round(typedM * 10) / 10 : (terrain ?? undefined),
      elevationSource: isTerrain ? 'terrain' : 'custom',
    });
  };

  const differs = pending?.terrain != null && typedM != null && Math.abs(typedM - pending.terrain) >= 1;
  const frameTime = frames[frame] ? new Date(frames[frame].time * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const activeLegends = overlays.filter((k) => k === 'avalanche' || legends[k]?.length || k === 'radar' || k === 'usRadar');

  return (
    <dialog class="mapdlg" ref={dialog} onClose={onClose} onCancel={onClose}>
      <div class="mapdlg-head">
        <button class="iconbtn" onClick={onClose} aria-label="Close map">
          <Icon name="chevronLeft" size={18} />
        </button>
        <div class="search mapdlg-search">
          <Icon name="search" size={16} />
          <input type="search" placeholder="Jump to a place" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} aria-label="Search the map" />
          {results && (
            <div class="menu">
              {results.length === 0 && <div class="menu-empty">No places found.</div>}
              {results.map((r, i) => (
                <button class="menu-item" key={i} onClick={() => jump(r)}>
                  <span>
                    <div class="title">{placeTitle(r)}</div>
                    <div class="detail">{r.detail}</div>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button class="iconbtn" onClick={locate} aria-label="Go to my location" title="Go to my location">
          <Icon name="locate" size={18} />
        </button>
        <button class={`iconbtn${panel ? ' on' : ''}`} onClick={() => setPanel(!panel)} aria-label="Map layers" aria-expanded={panel} title="Map layers">
          <Icon name="map" size={18} />
        </button>
      </div>

      <div class="mapdlg-map">
        {/* Panels sit beside the Leaflet container, not inside it, so their clicks don't reach the map. */}
        <div class="leafmap" ref={mapEl} />
        {panel && (
          <div class="layerpanel" role="dialog" aria-label="Map layers">
            <div class="lp-title">Base map</div>
            <div class="lp-bases">
              {BASES.map((b) => (
                <button key={b.key} class={`pill${base === b.key ? ' active' : ''}`} onClick={() => setBase(b.key)}>
                  {b.label}
                </button>
              ))}
            </div>
            <div class="lp-title">Overlays</div>
            {OVERLAYS.map((o) => (
              <label class="lp-item" key={o.key}>
                <input type="checkbox" checked={overlays.includes(o.key)} onChange={() => toggle(o.key)} />
                <span>
                  <span class="lp-name">{o.label}</span>
                  <span class="lp-note">{o.note}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        {activeLegends.length > 0 && !pending && !legendOpen && (
          <button class="maplegend-toggle" onClick={() => setLegendOpen(true)}>Legend</button>
        )}
        {activeLegends.length > 0 && !pending && legendOpen && (
          <div class="maplegend">
            <button class="lg-close" onClick={() => setLegendOpen(false)} aria-label="Hide legend">✕</button>
            {overlays.includes('radar') || overlays.includes('usRadar') ? (
              <div class="lg-row">
                <span class="lg-label">Radar</span>
                <span class="lg-ramp radar" />
                <span class="lg-ends"><span>Light</span><span>Heavy</span></span>
              </div>
            ) : null}
            {overlays.includes('avalanche') && (
              <div class="lg-row">
                <span class="lg-label">Avalanche danger</span>
                <span class="lg-swatches">
                  {AVALANCHE_SCALE.map(([c, l]) => (
                    <span key={l} class="lg-sw"><i style={{ background: c }} />{l}</span>
                  ))}
                  <span class="lg-sw"><i style={{ background: '#888888' }} />No rating or off season</span>
                </span>
              </div>
            )}
            {(['snowDepth', 'lands'] as OverlayKey[]).filter((k) => overlays.includes(k) && legends[k]?.length).map((k) => (
              <div class="lg-row" key={k}>
                <span class="lg-label">{OVERLAYS.find((o) => o.key === k)!.label}</span>
                <span class="lg-swatches">
                  {legends[k]!.map((it) => (
                    <span key={it.label} class="lg-sw"><img src={it.image} alt="" />{it.label}</span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}

        {frames.length > 0 && (
          <div class="radarbar">
            <button class="iconbtn" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause radar' : 'Play radar'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <input type="range" min={0} max={frames.length - 1} value={frame} onInput={(e) => { setPlaying(false); setFrame(Number((e.target as HTMLInputElement).value)); }} aria-label="Radar time" />
            <span class="radartime">{frameTime}</span>
          </div>
        )}

        {hover && !pending && (
          <div class="maphover">
            Elev {fmtElev(hover.elev, units)} · {hover.lat.toFixed(4)}, {hover.lon.toFixed(4)}
          </div>
        )}
        {locError && <div class="maphover">Location unavailable: {locError}</div>}
      </div>

      {pending ? (
        <div class="mapsheet">
          <div class="ms-head">
            <div>
              <div class="pick-name">{pending.name ?? 'Looking up…'}{pending.region ? `, ${pending.region}` : ''}</div>
              <div class="pick-coords">{pending.lat.toFixed(4)}, {pending.lon.toFixed(4)} · terrain {fmtElev(pending.terrain, units)}</div>
            </div>
            <button
              class="iconbtn"
              aria-label="Clear point"
              onClick={() => {
                setPending(null);
                pendingMarker.current?.remove();
              }}
            >
              ✕
            </button>
          </div>
          <div class="ms-days">
            {pending.days === undefined && <span class="muted small">Loading outlook…</span>}
            {pending.days === null && <span class="muted small">Outlook unavailable.</span>}
            {pending.days?.map((d, i) => (
              <div class="ms-day" key={d.time}>
                <div class="ms-dname">{dayName(d.time, i)}</div>
                <WeatherIcon code={d.code} precipColor={precipChanceColor(d.pop)} size={24} />
                <div class="ms-temps">
                  <b>{fmtTemp(d.tmax, units)}°</b> {fmtTemp(d.tmin, units)}°
                </div>
                <div class="ms-precip">{d.snow && d.snow > 0.05 ? fmtSnow(d.snow, units) + ' snow' : d.precip && d.precip > 0.05 ? fmtPrecip(d.precip, units) : 'dry'}</div>
              </div>
            ))}
          </div>
          <div class="ms-actions">
            <label class="pick-elev">
              <span>Forecast elevation</span>
              <span class="pick-elev-input">
                <input type="number" inputMode="numeric" value={elevInput} onInput={(e) => setElevInput((e.target as HTMLInputElement).value)} aria-label="Forecast elevation" />
                {heightUnit(units)}
              </span>
              <span class="pick-elev-note">{differs ? 'Custom: the forecast is adjusted to this height' : 'Terrain at this point'}</span>
            </label>
            <button class="pill active ms-go" onClick={confirm} disabled={pending.terrain == null && elevInput === ''}>
              Full forecast here
            </button>
          </div>
          <div class="ms-unit muted small">Temperatures in {tempUnit(units)}</div>
        </div>
      ) : (
        <div class="mapdlg-foot">
          <p class="muted">Tap the map for a quick outlook at that point. Layers adds radar, satellite, avalanche danger, snow depth and public lands.</p>
        </div>
      )}
    </dialog>
  );
}
