import { useEffect, useState } from 'preact/hooks';
import type { BlendMode, Bundle } from '../shared/types';
import { TopBar } from './components/TopBar';
import { RightNow } from './components/RightNow';
import { Daily, type HourlyTab } from './components/Daily';
import { ForecastRange, type ModelChoice } from './components/ForecastRange';
import { PrecipTable } from './components/PrecipTable';
import { MoreInfo } from './components/MoreInfo';
import { MapPicker } from './components/MapPicker';
import { Elevation } from './components/Elevation';
import { Icon } from './icons';
import { loadBundle, type BundleSource } from './data';
import type { Units } from './format';
import {
  dayFromHash,
  geolocate,
  loadFavorites,
  placeFromUrl,
  placeTitle,
  placeToSearch,
  reverseGeocode,
  samePlace,
  saveFavorites,
  terrainElevation,
  type Place,
} from './location';
import { dayStarts, nowIndex, type RangeMetric } from './metrics';

const DEFAULT_PLACE: Place = { lat: 37.7749, lon: -122.4194, name: 'San Francisco', region: 'CA', countryCode: 'US' };
const UNITS_KEY = 'weather:units';

function storedUnits(): Units {
  try {
    return localStorage.getItem(UNITS_KEY) === 'metric' ? 'metric' : 'imperial';
  } catch {
    return 'imperial';
  }
}

export function App() {
  const [place, setPlace] = useState<Place | null>(() => placeFromUrl());
  const [notice, setNotice] = useState<string | null>(null);
  const [units, setUnitsState] = useState<Units>(storedUnits);
  const [data, setData] = useState<{ bundle: Bundle; source: BundleSource; key: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(dayFromHash);
  const [tab, setTab] = useState<HourlyTab>('temp');
  const [model, setModel] = useState<ModelChoice>('all');
  const [rangeDays, setRangeDays] = useState(15);
  const [metric, setMetric] = useState<RangeMetric>('temp');
  const [tableDays, setTableDays] = useState(15);
  const [storm, setStorm] = useState(false);
  const [marker, setMarker] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<Place[]>(loadFavorites);
  const [mapOpen, setMapOpen] = useState(false);
  // Terrain elevation under the current point, for the elevation readout and as the default forecast elevation.
  const [terrain, setTerrain] = useState<{ key: string; m: number | null } | null>(null);
  const blendParam = new URLSearchParams(location.search).get('blend');
  const blendMode: BlendMode = blendParam === 'median' || blendParam === 'best_match' ? blendParam : 'auto';

  const setUnits = (u: Units) => {
    setUnitsState(u);
    try {
      localStorage.setItem(UNITS_KEY, u);
    } catch {
      // Not persisted in private mode.
    }
  };

  const useMyLocation = async () => {
    setNotice(null);
    try {
      const { lat, lon } = await geolocate();
      const info = await reverseGeocode(lat, lon);
      setPlace({ lat, lon, ...info, mine: true });
      setDay(0);
      setMarker(null);
      history.pushState(null, '', location.pathname);
    } catch (e) {
      setNotice(`Couldn't get your location (${e instanceof Error ? e.message : e}). Search for any place above.`);
      setPlace((p) => p ?? DEFAULT_PLACE);
    }
  };

  useEffect(() => {
    if (!place) useMyLocation();
    const onPop = () => {
      const p = placeFromUrl();
      if (p) setPlace(p);
      setDay(dayFromHash());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const pointKey = place ? `${place.lat.toFixed(5)},${place.lon.toFixed(5)}` : '';
  useEffect(() => {
    if (!place) return;
    let cancelled = false;
    terrainElevation(place.lat, place.lon).then((m) => !cancelled && setTerrain({ key: pointKey, m }));
    return () => {
      cancelled = true;
    };
  }, [pointKey]);

  // The forecast is always for an explicit elevation: the place's own (listed or chosen), else the terrain under the point.
  const terrainHere = terrain?.key === pointKey ? terrain.m : undefined;
  const forecastElevation = place?.elevation ?? (terrainHere === undefined ? undefined : terrainHere);
  const elevationSource = place?.elevation != null ? (place.elevationSource ?? 'listed') : 'terrain';
  const key = place && forecastElevation !== undefined ? `${pointKey},${forecastElevation == null ? 'terrain' : Math.round(forecastElevation)},${blendMode}` : '';
  useEffect(() => {
    if (!place || !key) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadBundle(place.lat, place.lon, forecastElevation ?? null, blendMode)
      .then((r) => !cancelled && setData({ ...r, key }))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const changeElevation = (m: number | null) => {
    if (!place) return;
    const next: Place = m == null ? { ...place, elevation: undefined, elevationSource: undefined } : { ...place, elevation: Math.round(m * 10) / 10, elevationSource: 'custom' };
    setPlace(next);
  };

  // Keep the URL shareable: place in the query, selected day in the hash.
  useEffect(() => {
    if (!place) return;
    const blendQuery = blendMode === 'auto' ? '' : `${place.mine ? '?' : '&'}blend=${blendMode}`;
    const url = `${location.pathname}${placeToSearch(place)}${blendQuery}${day ? `#day${day}` : ''}`;
    if (url !== location.pathname + location.search + location.hash) history.replaceState(null, '', url);
    document.title = place.mine ? 'Current Location | Isobar' : `${placeTitle(place)} | Isobar`;
  }, [place, day]);

  const pick = (p: Place) => {
    setPlace(p);
    setDay(0);
    setMarker(null);
    setMapOpen(false);
    history.pushState(null, '', `${location.pathname}${placeToSearch(p)}`);
  };

  const isFav = place ? favorites.some((f) => samePlace(f, place)) : false;
  const toggleFav = () => {
    if (!place) return;
    const fav: Place = { ...place, mine: false };
    const next = isFav ? favorites.filter((f) => !samePlace(f, place)) : [...favorites, fav];
    setFavorites(next);
    saveFavorites(next);
  };

  const bundle = data?.bundle;
  const selectDay = (d: number) => {
    setDay(d);
    if (bundle) {
      // Move the Model Spread marker to the middle of that day's daytime period (or now, for today).
      setMarker(d === 0 ? nowIndex(bundle) : dayStarts(bundle)[d] + 11);
    }
  };
  const markerHour = bundle ? (marker ?? nowIndex(bundle)) : 0;
  const stale = loading && data?.key !== key;

  return (
    <>
      <TopBar onPick={pick} onMyLocation={useMyLocation} onMap={() => setMapOpen(true)} isMine={!!place?.mine} favorites={favorites} units={units} onUnits={setUnits} />
      <MapPicker open={mapOpen} onClose={() => setMapOpen(false)} onPick={pick} current={place} units={units} />
      <main class="page">
        {place && (
          <div class="titlebar">
            <div>
              <h1>{place.mine ? 'Current Location' : placeTitle(place)}</h1>
              <div class="subtitle">
                <Icon name="pin" size={15} />
                <button class="linkbtn subtitle-link" onClick={() => setMapOpen(true)} title="Choose a point on the map">
                  {place.mine ? `${placeTitle(place)} · ` : ''}
                  {place.lat.toFixed(4)}, {place.lon.toFixed(4)} <Icon name="map" size={14} />
                </button>
              </div>
            </div>
            <Elevation
              forecast={forecastElevation ?? null}
              source={elevationSource}
              terrain={terrainHere ?? null}
              placeName={place.name}
              units={units}
              onChange={changeElevation}
            />
            <button class="iconbtn" onClick={toggleFav} aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'} title={isFav ? 'Remove from favorites' : 'Add to favorites'}>
              <Icon name={isFav ? 'starFilled' : 'star'} size={26} />
            </button>
          </div>
        )}
        {notice && <div class="banner">{notice}</div>}
        {error && !bundle && <div class="banner">Couldn't load the forecast: {error}</div>}
        {!bundle && !error && <div class="loading">Loading forecast…</div>}
        {bundle && (
          <div class={stale ? 'stale' : ''}>
            {error && <div class="banner">Couldn't refresh the forecast: {error}</div>}
            <RightNow bundle={bundle} units={units} />
            <Daily bundle={bundle} units={units} day={Math.min(day, bundle.daily.time.length - 1)} onDay={selectDay} tab={tab} onTab={setTab} />
            <ForecastRange
              bundle={bundle}
              units={units}
              model={model}
              onModel={setModel}
              days={rangeDays}
              onDays={setRangeDays}
              metric={metric}
              onMetric={setMetric}
              marker={markerHour}
              onMarker={setMarker}
            />
            <PrecipTable bundle={bundle} units={units} model={model} onModel={setModel} days={tableDays} onDays={setTableDays} storm={storm} onStorm={setStorm} />
            <MoreInfo bundle={bundle} units={units} source={data!.source} />
          </div>
        )}
      </main>
    </>
  );
}
