// Registry of the forecast models shown in Forecast Range and Precipitation by Model.
// `api` is the Open-Meteo model name; `meta` is the dataset whose meta.json gives run times.

export type ModelKey =
  | 'aifs'
  | 'aigefs'
  | 'ecmwf'
  | 'eps'
  | 'gfs'
  | 'aigfs'
  | 'nbm'
  | 'gdps'
  | 'icon'
  | 'rdps'
  | 'hrrr';

export interface ModelDef {
  key: ModelKey;
  /** Name in the model dropdown, e.g. "European (ECMWF)". */
  label: string;
  /** Short name used in run labels and table rows, e.g. "ECMWF". */
  short: string;
  flag: 'eu' | 'us' | 'de' | 'ca';
  kind: 'deterministic' | 'ensemble';
  api: string;
  meta: string;
  /** Hours between the runs we show. Hourly models are stepped by 6 h on synoptic hours. */
  stepHours: number;
  /** True when the model only covers part of the globe (it is hidden where it has no data). */
  regional?: boolean;
  /** NBM publishes its own snow level (NWS wet-bulb 0.5 °C method); use it instead of computing one. */
  nativeSnowLevel?: boolean;
}

// Order matches OpenSnow's table: long-range global models first, short-range regional last.
export const MODELS: ModelDef[] = [
  { key: 'aifs', label: 'European AI (AIFS)', short: 'AIFS', flag: 'eu', kind: 'deterministic', api: 'ecmwf_aifs025_single', meta: 'ecmwf_aifs025_single', stepHours: 6 },
  { key: 'aigefs', label: 'American AI Ens (AIGEFS)', short: 'AIGEFS', flag: 'us', kind: 'ensemble', api: 'ncep_aigefs025', meta: 'ncep_aigefs025', stepHours: 6 },
  { key: 'ecmwf', label: 'European (ECMWF)', short: 'ECMWF', flag: 'eu', kind: 'deterministic', api: 'ecmwf_ifs025', meta: 'ecmwf_ifs025', stepHours: 6 },
  { key: 'eps', label: 'European Ens (EPS)', short: 'EPS', flag: 'eu', kind: 'ensemble', api: 'ecmwf_ifs025', meta: 'ecmwf_ifs025_ensemble', stepHours: 6 },
  { key: 'gfs', label: 'American (GFS)', short: 'GFS', flag: 'us', kind: 'deterministic', api: 'gfs_seamless', meta: 'ncep_gfs013', stepHours: 6 },
  { key: 'aigfs', label: 'American AI (AIGFS)', short: 'AIGFS', flag: 'us', kind: 'deterministic', api: 'ncep_aigfs025', meta: 'ncep_aigfs025', stepHours: 6 },
  { key: 'nbm', label: 'American Blend (NBM)', short: 'NBM', flag: 'us', kind: 'deterministic', api: 'ncep_nbm_conus', meta: 'ncep_nbm_conus', stepHours: 6, regional: true, nativeSnowLevel: true },
  { key: 'gdps', label: 'Canadian (GDPS)', short: 'GDPS', flag: 'ca', kind: 'deterministic', api: 'gem_global', meta: 'cmc_gem_gdps_15km', stepHours: 12 },
  { key: 'icon', label: 'German (ICON)', short: 'ICON', flag: 'de', kind: 'deterministic', api: 'icon_seamless', meta: 'dwd_icon', stepHours: 6 },
  { key: 'rdps', label: 'Canadian Regional (RDPS)', short: 'RDPS', flag: 'ca', kind: 'deterministic', api: 'gem_regional', meta: 'cmc_gem_rdps_10km', stepHours: 6, regional: true },
  { key: 'hrrr', label: 'American Hi-Res (HRRR)', short: 'HRRR', flag: 'us', kind: 'deterministic', api: 'gfs_hrrr', meta: 'ncep_hrrr_conus', stepHours: 6, regional: true },
];

export const MODEL_BY_KEY = Object.fromEntries(MODELS.map((m) => [m.key, m])) as Record<ModelKey, ModelDef>;

/** How many runs of each deterministic model to show. Ensembles show their latest run only. */
export const RUNS_PER_MODEL = 3;
