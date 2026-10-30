import { useEffect, useRef, useState } from 'preact/hooks';
import type { Map as LeafletMap, CircleMarker } from 'leaflet';
import { Icon } from '../icons';
import { heightUnit, toHeight, type Units } from '../format';
import { reverseGeocode, searchPlaces, terrainElevation, type Place, type SearchResult } from '../location';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (p: Place) => void;
  current: Place | null;
  units: Units;
}

interface Pending {
  lat: number;
  lon: number;
  terrain: number | null;
  name: string | null;
  region?: string;
  countryCode?: string;
}

const fmt = (m: number | null, u: Units) => (m == null ? '–' : `${Math.round(toHeight(m, u)).toLocaleString('en-US')} ${heightUnit(u)}`);
const fromDisplay = (v: number, u: Units) => (u === 'imperial' ? v / 3.28084 : v);

// Topographic tiles by default so valley floors, ridges and contours are visible when choosing a point.
const TOPO = {
  url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  options: {
    maxZoom: 17,
    subdomains: 'abc',
    attribution: 'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  },
};
const STREETS = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  options: { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
};

export function MapPicker({ open, onClose, onPick, current, units }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const pendingMarker = useRef<CircleMarker | null>(null);
  const currentMarker = useRef<CircleMarker | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [hover, setHover] = useState<{ lat: number; lon: number; elev: number | null } | null>(null);
  const [elevInput, setElevInput] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
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

  // Create the map the first time the dialog opens. Leaflet loads only then.
  useEffect(() => {
    if (!open || map.current || !mapEl.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !mapEl.current) return;
      const center: [number, number] = current ? [current.lat, current.lon] : [39.5, -98.35];
      const m = L.map(mapEl.current, { zoomControl: true, worldCopyJump: true }).setView(center, current ? 12 : 4);
      const topo = L.tileLayer(TOPO.url, TOPO.options).addTo(m);
      const streets = L.tileLayer(STREETS.url, STREETS.options);
      L.control.layers({ Topo: topo, Streets: streets }, {}, { position: 'topright' }).addTo(m);
      L.control.scale({ imperial: units === 'imperial', metric: units === 'metric' }).addTo(m);
      m.on('click', (e) => choose(e.latlng.lat, e.latlng.lng));
      // Elevation under the cursor once it rests, to help find the valley floor or a ridge.
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
      drawCurrent();
      setTimeout(() => m.invalidateSize(), 50);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Keep the current forecast point marked.
  const drawCurrent = async () => {
    const L = (await import('leaflet')).default;
    const m = map.current;
    if (!m) return;
    currentMarker.current?.remove();
    if (!current) return;
    currentMarker.current = L.circleMarker([current.lat, current.lon], {
      radius: 6, color: '#ffffff', weight: 2, fillColor: '#8a96a4', fillOpacity: 1,
    }).addTo(m).bindTooltip('Current forecast point');
  };
  useEffect(() => {
    if (!open) return;
    drawCurrent();
    setPending(null);
    if (current && map.current) map.current.setView([current.lat, current.lon], Math.max(map.current.getZoom(), 11));
  }, [open, current?.lat, current?.lon]);

  const choose = async (lat: number, lon: number) => {
    const L = (await import('leaflet')).default;
    const m = map.current;
    if (!m) return;
    pendingMarker.current?.remove();
    const signal = getComputedStyle(document.documentElement).getPropertyValue('--signal').trim() || '#c5ec4a';
    pendingMarker.current = L.circleMarker([lat, lon], { radius: 8, color: '#111213', weight: 2, fillColor: signal, fillOpacity: 1 }).addTo(m);
    setPending({ lat, lon, terrain: null, name: null });
    setElevInput('');
    const [terrain, info] = await Promise.all([terrainElevation(lat, lon), reverseGeocode(lat, lon)]);
    setPending((p) => (p && p.lat === lat && p.lon === lon ? { lat, lon, terrain, name: info.name, region: info.region, countryCode: info.countryCode } : p));
    if (terrain != null) setElevInput(String(Math.round(toHeight(terrain, unitsRef.current))));
  };

  // Search inside the map to jump somewhere, then click to fine-tune.
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
    map.current?.setView([r.lat, r.lon], 13);
    choose(r.lat, r.lon);
  };

  const confirm = () => {
    if (!pending) return;
    const typed = Number(elevInput);
    const custom = elevInput.trim() !== '' && Number.isFinite(typed) ? fromDisplay(typed, units) : null;
    const terrain = pending.terrain;
    const isTerrain = custom == null || (terrain != null && Math.abs(custom - terrain) < 1);
    onPick({
      lat: Number(pending.lat.toFixed(5)),
      lon: Number(pending.lon.toFixed(5)),
      name: pending.name ?? `${pending.lat.toFixed(3)}, ${pending.lon.toFixed(3)}`,
      region: pending.region,
      countryCode: pending.countryCode,
      elevation: custom != null ? Math.round(custom * 10) / 10 : (terrain ?? undefined),
      elevationSource: isTerrain ? 'terrain' : 'custom',
    });
  };

  const typedM = elevInput.trim() !== '' && Number.isFinite(Number(elevInput)) ? fromDisplay(Number(elevInput), units) : null;
  const differs = pending?.terrain != null && typedM != null && Math.abs(typedM - pending.terrain) >= 1;

  return (
    <dialog class="mapdlg" ref={dialog} onClose={onClose} onCancel={onClose}>
      <div class="mapdlg-head">
        <h3>Choose a forecast point</h3>
        <div class="search mapdlg-search">
          <Icon name="search" size={16} />
          <input type="search" placeholder="Jump to a place…" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} aria-label="Search the map" />
          {results && (
            <div class="menu">
              {results.length === 0 && <div class="menu-empty">No places found.</div>}
              {results.map((r, i) => (
                <button class="menu-item" key={i} onClick={() => jump(r)}>
                  <span>
                    <div class="title">{r.region ? `${r.name}, ${r.region}` : r.name}</div>
                    <div class="detail">{r.detail}</div>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button class="iconbtn" onClick={onClose} aria-label="Close map">
          ✕
        </button>
      </div>
      <div class="mapdlg-map" ref={mapEl}>
        {hover && (
          <div class="maphover">
            Elev {fmt(hover.elev, units)} · {hover.lat.toFixed(4)}, {hover.lon.toFixed(4)}
          </div>
        )}
      </div>
      <div class="mapdlg-foot">
        {!pending ? (
          <p class="muted">
            Click the map to pick a point. Hover to read the terrain elevation; in steep places a few hundred feet sideways can
            change it by thousands of feet.
          </p>
        ) : (
          <>
            <div class="pick-info">
              <div class="pick-name">{pending.name ?? 'Looking up…'}{pending.region ? `, ${pending.region}` : ''}</div>
              <div class="pick-coords">
                {pending.lat.toFixed(4)}, {pending.lon.toFixed(4)} · terrain {fmt(pending.terrain, units)}
              </div>
            </div>
            <label class="pick-elev">
              <span>Forecast elevation</span>
              <span class="pick-elev-input">
                <input type="number" inputMode="numeric" value={elevInput} onInput={(e) => setElevInput((e.target as HTMLInputElement).value)} aria-label="Forecast elevation" />
                {heightUnit(units)}
              </span>
              <span class="pick-elev-note">{differs ? 'Custom: the forecast is adjusted to this height' : 'Terrain at this point'}</span>
            </label>
            <button class="pill active" onClick={confirm} disabled={pending.terrain == null && elevInput === ''}>
              Forecast here
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
