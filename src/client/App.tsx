import { useEffect, useState } from 'preact/hooks';
import type { BlendMode, Bundle } from '../shared/types';
import { TopBar } from './components/TopBar';
import { RightNow } from './components/RightNow';
import { Daily, type HourlyTab } from './components/Daily';
import { ForecastRange, type ModelChoice } from './components/ForecastRange';
import { PrecipTable } from './components/PrecipTable';
import { MoreInfo } from './components/MoreInfo';
import { Icon } from './icons';
import { loadBundle, type BundleSource } from './data';
import { fmtElevation, type Units } from './format';
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
  const blendMode: BlendMode = new URLSearchParams(location.search).get('blend') === 'median' ? 'median' : 'best_match';

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

  const key = place ? `${place.lat.toFixed(3)},${place.lon.toFixed(3)},${blendMode}` : '';
  useEffect(() => {
    if (!place) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadBundle(place.lat, place.lon, place.elevation ?? null, blendMode)
      .then((r) => !cancelled && setData({ ...r, key }))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Keep the URL shareable: place in the query, selected day in the hash.
  useEffect(() => {
    if (!place) return;
    const url = `${location.pathname}${placeToSearch(place)}${blendMode === 'median' ? (place.mine ? '?blend=median' : '&blend=median') : ''}${day ? `#day${day}` : ''}`;
    if (url !== location.pathname + location.search + location.hash) history.replaceState(null, '', url);
    document.title = place.mine ? 'My Location | Weather' : `${placeTitle(place)} | Weather`;
  }, [place, day]);

  const pick = (p: Place) => {
    setPlace(p);
    setDay(0);
    setMarker(null);
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
      // Move the Forecast Range marker to the middle of that day's daytime period (or now, for today).
      setMarker(d === 0 ? nowIndex(bundle) : dayStarts(bundle)[d] + 11);
    }
  };
  const markerHour = bundle ? (marker ?? nowIndex(bundle)) : 0;
  const stale = loading && data?.key !== key;

  return (
    <>
      <TopBar onPick={pick} onMyLocation={useMyLocation} isMine={!!place?.mine} favorites={favorites} units={units} onUnits={setUnits} />
      <main class="page">
        {place && (
          <div class="titlebar">
            <div>
              <h1>{place.mine ? 'My Location' : placeTitle(place)}</h1>
              <div class="subtitle">
                <Icon name="pin" size={15} />
                <a href={`https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=11/${place.lat}/${place.lon}`} target="_blank" rel="noreferrer">
                  {place.mine ? placeTitle(place) : `${place.lat.toFixed(2)}, ${place.lon.toFixed(2)}`}
                  {bundle && !stale ? ` • ${fmtElevation(bundle.location.elevation, units)}` : ''}{' '}
                  <Icon name="map" size={14} />
                </a>
              </div>
            </div>
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
