// Places: URL state, geolocation, place search and favorites.

export interface Place {
  lat: number;
  lon: number;
  name: string;
  /** "CO", "British Columbia", or a country name. */
  region?: string;
  country?: string;
  countryCode?: string;
  elevation?: number;
  /** True when this is the browser's own location. */
  mine?: boolean;
}

export interface SearchResult extends Place {
  /** "City - Colorado, United States" */
  detail: string;
}

const US_STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI',
  Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
};

const CA_PROVINCES: Record<string, string> = {
  Alberta: 'AB', 'British Columbia': 'BC', Manitoba: 'MB', 'New Brunswick': 'NB', 'Newfoundland and Labrador': 'NL',
  'Nova Scotia': 'NS', Ontario: 'ON', 'Prince Edward Island': 'PE', Quebec: 'QC', Saskatchewan: 'SK',
  'Northwest Territories': 'NT', Nunavut: 'NU', Yukon: 'YT',
};

function shortRegion(admin1: string | undefined, countryCode: string | undefined, country: string | undefined): string | undefined {
  if (countryCode === 'US' && admin1) return US_STATES[admin1] ?? admin1;
  if (countryCode === 'CA' && admin1) return CA_PROVINCES[admin1] ?? admin1;
  return country ?? admin1;
}

export function placeTitle(p: Place): string {
  return p.region ? `${p.name}, ${p.region}` : p.name;
}

export function flagEmoji(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  return String.fromCodePoint(...[...countryCode.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const FEATURE_TYPES: [RegExp, string][] = [
  [/^AIRP|^AIRF/, 'Airport'],
  [/^PRK|^RES/, 'Park'],
  [/^MT|^PK|^HLL|^RDG|^VLC/, 'Mountain'],
  [/^LK|^RSV/, 'Lake'],
  [/^ISL/, 'Island'],
  [/^PPL/, 'City'],
  [/^ADM/, 'Region'],
];

function featureType(code: string | undefined): string {
  if (!code) return 'Place';
  return FEATURE_TYPES.find(([re]) => re.test(code))?.[1] ?? 'Place';
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // Coordinates typed directly: "39.64, -106.37".
  const m = q.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return [{ lat, lon, name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, detail: 'Coordinates' }];
    }
  }
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
  const res = await fetch(url, { signal });
  const body: any = await res.json();
  return (body.results ?? []).map((r: any) => {
    const region = shortRegion(r.admin1, r.country_code, r.country);
    const where = [r.admin1, r.country].filter(Boolean).join(', ');
    return {
      lat: r.latitude,
      lon: r.longitude,
      name: r.name,
      region,
      country: r.country,
      countryCode: r.country_code,
      elevation: r.elevation,
      detail: `${featureType(r.feature_code)}${where ? ` - ${where}` : ''}`,
    };
  });
}

export function geolocate(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation is not available'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error(err.message || 'Location permission denied')),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  });
}

/** Neighborhood or city name for coordinates (BigDataCloud's free client-side endpoint; browser only). */
export async function reverseGeocode(lat: number, lon: number): Promise<Pick<Place, 'name' | 'region' | 'country' | 'countryCode'>> {
  try {
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    const r: any = await res.json();
    const name = r.locality || r.city || r.principalSubdivision || 'My Location';
    const sub: string | undefined = r.principalSubdivisionCode?.split('-')[1];
    const region = r.countryCode === 'US' || r.countryCode === 'CA' ? sub || r.principalSubdivision : r.countryName;
    return { name, region, country: r.countryName, countryCode: r.countryCode };
  } catch {
    return { name: `${lat.toFixed(2)}, ${lon.toFixed(2)}` };
  }
}

// ---- URL state: ?lat=..&lon=..&name=..&region=..#day3 ----

export function placeFromUrl(): Place | null {
  const q = new URLSearchParams(location.search);
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  if (!q.has('lat') || !q.has('lon') || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    name: q.get('name') ?? `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
    region: q.get('region') ?? undefined,
    countryCode: q.get('cc') ?? undefined,
    elevation: q.has('elev') ? Number(q.get('elev')) : undefined,
  };
}

export function placeToSearch(p: Place | null): string {
  if (!p || p.mine) return '';
  const q = new URLSearchParams({ lat: p.lat.toFixed(4), lon: p.lon.toFixed(4), name: p.name });
  if (p.region) q.set('region', p.region);
  if (p.countryCode) q.set('cc', p.countryCode);
  if (p.elevation != null) q.set('elev', String(Math.round(p.elevation)));
  return `?${q}`;
}

export function dayFromHash(): number {
  const m = location.hash.match(/day(\d+)/);
  return m ? Math.min(14, Number(m[1])) : 0;
}

// ---- Favorites (this browser only) ----

const FAV_KEY = 'weather:favorites';

export function loadFavorites(): Place[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveFavorites(list: Place[]) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
  } catch {
    // Storage can be unavailable (private mode); favorites then last for the session only.
  }
}

export const samePlace = (a: Place, b: Place) => Math.abs(a.lat - b.lat) < 0.005 && Math.abs(a.lon - b.lon) < 0.005;
