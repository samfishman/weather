import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../icons';
import { flagEmoji, placeTitle, searchPlaces, type Place, type SearchResult } from '../location';
import type { Units } from '../format';

interface Props {
  onPick: (p: Place) => void;
  onMyLocation: () => void;
  isMine: boolean;
  favorites: Place[];
  units: Units;
  onUnits: (u: Units) => void;
}

export function TopBar({ onPick, onMyLocation, isMine, favorites, units, onUnits }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [active, setActive] = useState(0);
  const [favOpen, setFavOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchPlaces(query, ctrl.signal)
        .then((r) => {
          setResults(r);
          setActive(0);
        })
        .catch(() => {});
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setResults(null);
        setFavOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (p: Place) => {
    setQuery('');
    setResults(null);
    setFavOpen(false);
    onPick(p);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!results?.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      pick(results[active]);
    } else if (e.key === 'Escape') {
      setResults(null);
    }
  };

  return (
    <header class="topbar">
      <div class="topbar-inner" ref={wrap}>
        <a class="brand" href="/" onClick={(e) => { e.preventDefault(); onMyLocation(); }}>
          <img src="/favicon.svg" alt="" />
          <span>WEATHER</span>
        </a>
        <button class={`navbtn${isMine ? ' active' : ''}`} onClick={onMyLocation} title="Forecast for my location">
          <Icon name="locate" size={18} />
          <span>My Location</span>
        </button>
        <div class="favwrap">
          <button class={`navbtn${favOpen ? ' active' : ''}`} onClick={() => setFavOpen(!favOpen)} title="Favorites">
            <Icon name="star" size={18} />
            <span>Favorites</span>
          </button>
          {favOpen && (
            <div class="menu">
              {favorites.length === 0 && <div class="menu-empty">Star a location to keep it here.</div>}
              {favorites.map((f) => (
                <button class="menu-item" key={`${f.lat},${f.lon}`} onClick={() => pick(f)}>
                  <span class="flag">{flagEmoji(f.countryCode)}</span>
                  <span class="title">{placeTitle(f)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div class="search">
          <Icon name="search" size={17} />
          <input
            type="search"
            placeholder="Search cities, mountains, airports, or lat, lon…"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={onKey}
            aria-label="Search for a location"
          />
          {results && (
            <div class="menu" role="listbox">
              {results.length === 0 && <div class="menu-empty">No places found.</div>}
              {results.map((r, i) => (
                <button class={`menu-item${i === active ? ' active' : ''}`} key={`${r.lat},${r.lon},${i}`} onMouseEnter={() => setActive(i)} onClick={() => pick(r)}>
                  <span class="flag">{flagEmoji(r.countryCode) || '📍'}</span>
                  <span>
                    <div class="title">{placeTitle(r)}</div>
                    <div class="detail">{r.detail}</div>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button class="unitbtn" onClick={() => onUnits(units === 'imperial' ? 'metric' : 'imperial')} title="Switch units">
          {units === 'imperial' ? '°F' : '°C'}
        </button>
      </div>
    </header>
  );
}
