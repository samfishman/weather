# Isobar

A weather dashboard for any location, with the features of OpenSnow's "My Location" page and its own instrument-panel look, built on free [Open-Meteo](https://open-meteo.com/) data. It runs as a Cloudflare Worker.

## What's on the page

- **Now**: temperature, feels-like, conditions, wind and gusts, stamped in the location's time zone.
- **15-Day Outlook**: a 15-day strip. Picking a day drives an hourly chart with 7 tabs (temperature, feels-like, precip chance with rain/mix/snow totals, wind with gusts and direction, cloud, humidity, lightning chance) and a sunrise, sunset, moonrise, moonset and moon phase panel.
- **Model Spread**: every run of every model (the last 3 runs of each deterministic model, plus ensemble means) on one chart for 1 to 15 days, for temperature, total precip, 12-hour precip, wind, gusts, cloud cover and snow level. Below it are cloud cover and precip chance by type. Pick a model to highlight its runs; hover to name a line; the readout shows blend, max and min, or the blend against the picked model.
- **Precip by Model Run**: a 12-hour liquid precip heatmap (5am to 5pm and 5pm to 5am) for every run, shaded for rain, mix, snow and heavy snow, with N/A where a run ends and a Storm Totals toggle.
- **About This Forecast**: the forecast point and elevation, update time, and how to read the data.
- Place search (cities, mountains, airports, or `lat, lon`), browser geolocation, favorites, °F/°C, and shareable URLs (`?lat=..&lon=..&name=..#day3`).

## Models

| Dropdown | Open-Meteo model | Runs shown |
| --- | --- | --- |
| European AI (AIFS) | `ecmwf_aifs025_single` | last 3 |
| American AI Ens (AIGEFS) | `ncep_aigefs025` (ensemble mean) | latest |
| European (ECMWF) | `ecmwf_ifs025` | last 3 |
| European Ens (EPS) | `ecmwf_ifs025` ensemble (mean) | latest |
| American (GFS) | `gfs_seamless` | last 3 |
| American AI (AIGFS) | `ncep_aigfs025` | last 3 |
| American Blend (NBM) | `ncep_nbm_conus` (US only) | last 3 |
| Canadian (GDPS) | `gem_global` | last 3 |
| German (ICON) | `icon_seamless` | last 3 |
| Canadian Regional (RDPS) | `gem_regional` (North America) | last 3 |
| American Hi-Res (HRRR) | `gfs_hrrr` (US only) | last 3 synoptic runs |

Past runs come from the [Single Runs API](https://open-meteo.com/en/docs/single-runs-api), and run times from each model's `meta.json`. Models with no data at a location are hidden.

## Main forecast and blend

Now, the 15-day strip, the hourly tabs and the **blend** (the thick line and the top table row) come from one main forecast:

- **In the US:** NOAA's National Blend of Models (NBM), which blends about 30 models and corrects them against observations. It covers roughly 11 days, then fades over 12 hours into Open-Meteo's `best_match`. Over one week of late-October next-day forecasts at 15 US airports, NBM's mean temperature error was 1.43 °C against 1.96 °C for best match. It was better at 12 of the 15 stations, slightly worse at three mountain stations (Denver, Truckee, Eagle) and about 7% worse on wind.
- **Elsewhere:** Open-Meteo's `best_match`, the best-suited local model at each lead time.

Two URL options change this: `?blend=best_match` never uses NBM, and `?blend=median` makes the blend the median of every model's latest run. The logic is in `src/shared/primary.ts` and `BlendMode` in `src/shared/types.ts`.

## Snow level

Snow level is the height where the wet-bulb temperature falls to +0.5 °C. That is the NWS Western Region standard ([TA 19-01](https://www.weather.gov/media/wrh/online_publications/TAs/TA1901.pdf)), which the National Blend of Models also uses. It is computed for every model run and hour from pressure-level temperature, humidity and geopotential height, plus the 2 m values at the forecast elevation. NBM supplies its own snow level (`snowfall_height`). When the whole column is colder than 0.5 °C, the level is extrapolated below the point at 6 °C/km. The method lives in `src/shared/snowlevel.ts`, with optional heavy-precip and windward-terrain adjustments that are off by default.

Checked against NBM's snow level at four ski areas, the median difference was within about 300 ft. The gap from the freezing level ranged from about 400 ft in humid air to 3,600 ft in dry air.

## How it works

```
browser ── /api/forecast?lat&lon ──► Worker ──► Open-Meteo (best match, NBM, meta.json, single runs, ensembles)
   │                                   └── caches: bundle 15 min, single runs 24 h (KV + memory)
   └── if the Worker gets 429 from Open-Meteo, the browser builds the same bundle itself
```

- `src/shared/` builds the bundle and runs in both the Worker and the browser: `bundle.ts` (pipeline), `primary.ts` (NBM and best match merge), `snowlevel.ts`, `models.ts`, `openmeteo.ts`, `moon.ts`, `derive.ts`.
- Run requests go out three at a time, because Open-Meteo rejects too many heavy requests at once. Its transient "too many concurrent requests" errors are retried. US-only models (NBM, HRRR) and RDPS aren't requested outside their areas.
- `src/worker/index.ts` serves `/api/forecast` and the static page.
- `src/client/` is the Preact UI. `styles.css` holds layout; `theme.css` holds the look (graphite surfaces, IBM Plex type, one chartreuse signal color, and a light "paper chart recorder" mode) and defines every color token the charts read.

Daily values are recomputed from hourly data in real local days, because Open-Meteo buckets daily values with today's UTC offset, which shifts days by an hour after a daylight-saving change.

## Develop

```sh
npm install
npm run dev        # Vite + the Worker in workerd, http://localhost:5173
npm test           # unit tests for the shared modules
LIVE=1 npx vitest run test/live.test.ts   # end-to-end pipeline check against Open-Meteo
npm run typecheck
```

## Deploy

```sh
npm run deploy     # vite build && wrangler deploy
```

`wrangler.jsonc` binds a KV namespace as `CACHE`. Without it the Worker still runs, caching only in memory. The Cache API isn't used because it does nothing on `*.workers.dev`.

## Limits

- Open-Meteo's free tier is for non-commercial use: 600 calls a minute, 5,000 an hour, 10,000 a day. Calls are weighted by variables and days. A new location costs a few hundred weighted calls; cached refreshes cost far less.
- OpenSnow's PEAKS model is proprietary, so there's nothing to show for it.
- Ensembles show the mean of their latest run only, since the Single Runs API doesn't serve ensembles.
- Lightning chance is derived from thunderstorm weather codes, CAPE and precip chance, because Open-Meteo's lightning potential only covers Central Europe.
