// The data contract. Must match api/models.py exactly.

export const CROPS = ["paddy", "ragi", "maize"] as const;
export type Crop = (typeof CROPS)[number];

export const SCENARIOS = ["ssp245", "ssp585"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface SuitabilityRow {
  id: string;
  baseline: number;
  y2050: number;
  change: number;
  y2030?: number;
}

export interface SuitabilityFile {
  crop: Crop;
  scenario: Scenario;
  districts: SuitabilityRow[];
}

export interface DistrictHistory {
  years: number[];
  rain_mm: (number | null)[];
  ndvi_peak: (number | null)[];
  lst_day_c: (number | null)[];
}

export interface DistrictClimate {
  temp_base_c: number;
  temp_2050_c: number;
  rain_base_mm: number;
  rain_2050_mm: number;
  onset_shift_weeks: number;
  tmax_base_c?: number;
  tmax_2050_c?: number;
  onset_base_doy?: number;
  onset_2050_doy?: number;
}

export interface DistrictPlan {
  best_now: Crop;
  best_2050: Crop;
  switch: boolean;
  water_gap_mm: Record<Crop, number>;
  actions: string[];
  scores?: Record<Crop, { baseline: number; y2050: number }>;
  limiting?: Partial<Record<Crop, "temp" | "rain">>;
}

export interface DistrictFile {
  id: string;
  name: string;
  history: DistrictHistory;
  climate: Record<Scenario, DistrictClimate>;
  plan: Record<Scenario, DistrictPlan>;
}

export interface MetaDataset {
  name: string;
  id?: string;
  link?: string;
  period?: string;
  use?: string;
  [k: string]: unknown;
}

export interface MetaFile {
  datasets?: MetaDataset[];
  models?: string[];
  generated?: string;
  limitations?: string[];
  [k: string]: unknown;
}

export type DistrictProps = { id: string; name: string; state?: string };
export type StateProps = { id: string; name: string };
export type StateCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  StateProps
>;
export type DistrictCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  DistrictProps
>;

export type SuitabilityIndex = Record<string, Record<string, SuitabilityRow>>;

export const CROP_LABEL: Record<Crop, string> = {
  paddy: "Paddy",
  ragi: "Ragi",
  maize: "Maize",
};

export const SCENARIO_LABEL: Record<Scenario, string> = {
  ssp245: "SSP2-4.5",
  ssp585: "SSP5-8.5",
};

export const SCENARIO_NOTE: Record<Scenario, string> = {
  ssp245: "Middle-of-the-road emissions",
  ssp585: "High emissions",
};
