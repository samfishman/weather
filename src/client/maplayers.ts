// Base maps and weather overlays for the map. All sources are free; US-only ones say so.

import type * as Leaflet from 'leaflet';

type L = typeof Leaflet;

export type BaseKey = 'topo' | 'streets' | 'satellite';
export type OverlayKey = 'radar' | 'usRadar' | 'clouds' | 'avalanche' | 'snowDepth' | 'lands';

const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const BASES: { key: BaseKey; label: string; make: (L: L) => Leaflet.Layer }[] = [
  {
    key: 'topo',
    label: 'Topo',
    make: (L) =>
      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        subdomains: 'abc',
        attribution: `Map data ${OSM}, SRTM | Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
      }),
  },
  {
    key: 'streets',
    label: 'Streets',
    make: (L) => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM }),
  },
  {
    key: 'satellite',
    label: 'Satellite',
    make: (L) =>
      L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
        }),
        // Place names over the imagery.
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
        }),
      ]),
  },
];

export interface OverlayDef {
  key: OverlayKey;
  label: string;
  note: string;
  /** ArcGIS MapServer whose legend to show, and optionally which of its layer ids. */
  legendFrom?: string;
  legendLayers?: number[];
}

export const OVERLAYS: OverlayDef[] = [
  { key: 'radar', label: 'Radar (animated)', note: 'Last 2 hours, worldwide · RainViewer' },
  { key: 'usRadar', label: 'Radar, high-res (US)', note: 'Latest NOAA MRMS base reflectivity' },
  { key: 'clouds', label: 'Satellite clouds', note: 'Latest GOES GeoColor · NASA GIBS' },
  { key: 'avalanche', label: 'Avalanche danger (US)', note: "Today's rating by forecast zone · avalanche.org" },
  {
    key: 'snowDepth',
    label: 'Snow depth (US)',
    note: 'Daily NOHRSC snow analysis, inches · NOAA',
    legendFrom: 'https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer',
    legendLayers: [3],
  },
  {
    key: 'lands',
    label: 'Public lands (US)',
    note: 'Surface management agency · BLM',
    legendFrom: 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer',
  },
];

/** North American avalanche danger scale colors. */
export const AVALANCHE_SCALE: [string, string][] = [
  ['#50b848', '1 Low'],
  ['#fff200', '2 Moderate'],
  ['#f7941e', '3 Considerable'],
  ['#ed1c24', '4 High'],
  ['#231f20', '5 Extreme'],
];

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Map pane for weather overlays: above the base map, below markers and popups. */
export const WEATHER_PANE = 'weather';

/** Builds a static overlay layer. Radar animation is handled separately (see radarFrames). */
export async function makeOverlay(L: L, key: Exclude<OverlayKey, 'radar'>, centerLon: number): Promise<Leaflet.Layer> {
  switch (key) {
    case 'usRadar':
      return L.tileLayer.wms('https://mapservices.weather.noaa.gov/eventdriven/services/radar/radar_base_reflectivity_time/ImageServer/WMSServer', {
        layers: 'radar_base_reflectivity_time',
        format: 'image/png',
        transparent: true,
        pane: WEATHER_PANE,
        opacity: 0.75,
        attribution: 'Radar © NOAA',
      });
    case 'clouds': {
      // GOES-West covers the Pacific and western North America; GOES-East the rest of the Americas.
      const sat = centerLon < -105 ? 'GOES-West' : 'GOES-East';
      return L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${sat}_ABI_GeoColor/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`, {
        maxNativeZoom: 7,
        maxZoom: 19,
        pane: WEATHER_PANE,
        opacity: 0.7,
        attribution: 'Satellite: NASA GIBS / NOAA GOES',
      });
    }
    case 'snowDepth':
      return L.tileLayer.wms('https://mapservices.weather.noaa.gov/raster/services/snow/NOHRSC_Snow_Analysis/MapServer/WMSServer', {
        layers: '3',
        format: 'image/png',
        transparent: true,
        pane: WEATHER_PANE,
        opacity: 0.7,
        attribution: 'Snow depth © NOAA NOHRSC',
      });
    case 'lands':
      return L.tileLayer('https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 14,
        maxZoom: 19,
        pane: WEATHER_PANE,
        opacity: 0.55,
        attribution: 'Land status © BLM',
      });
    case 'avalanche': {
      const res = await fetch('https://api.avalanche.org/v2/public/products/map-layer');
      const geo: any = await res.json();
      return L.geoJSON(geo, {
        style: (f: any) => ({
          color: f.properties.off_season ? '#888888' : '#111213',
          weight: 1,
          fillColor: f.properties.color ?? '#888888',
          fillOpacity: f.properties.off_season || f.properties.danger_level < 1 ? 0.15 : 0.45,
        }),
        onEachFeature: (f: any, layer) => {
          const p = f.properties;
          const rating = p.off_season ? 'Off season' : p.danger_level >= 1 ? escape(String(p.danger)) : 'No rating';
          layer.bindPopup(
            `<b>${escape(p.name)}</b><br>${rating}${p.travel_advice && !p.off_season ? `<br><small>${escape(p.travel_advice)}</small>` : ''}` +
              (p.link ? `<br><a href="${escape(p.link)}" target="_blank" rel="noreferrer">Full forecast</a>` : ''),
          );
        },
      });
    }
  }
}

export interface RadarFrame {
  time: number;
  url: string;
}

/** The last ~2 hours of RainViewer radar frames (10-minute steps). */
export async function radarFrames(): Promise<RadarFrame[]> {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  const d: any = await res.json();
  return (d.radar?.past ?? []).map((f: { time: number; path: string }) => ({
    time: f.time,
    // 256 px tiles, color scheme 2, smoothed, with snow shown in its own colors.
    url: `${d.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
  }));
}

export interface LegendItem {
  label: string;
  image: string;
}

/** Legend swatches from an ArcGIS MapServer's /legend endpoint. */
export async function arcgisLegend(server: string, layerIds?: number[]): Promise<LegendItem[]> {
  const res = await fetch(`${server}/legend?f=json`);
  const d: any = await res.json();
  const items: LegendItem[] = [];
  for (const layer of d.layers ?? []) {
    if (layerIds && !layerIds.includes(layer.layerId)) continue;
    for (const l of layer.legend ?? []) {
      if (!l.imageData) continue;
      const label = String(l.label || '').trim();
      // Skip unlabeled and repeated classes (some services list each class once per scale range).
      if (!label || /boundary|footprint/i.test(layer.layerName) || items.some((i) => i.label === label)) continue;
      items.push({ label, image: `data:${l.contentType};base64,${l.imageData}` });
    }
  }
  return items.slice(0, 16);
}
