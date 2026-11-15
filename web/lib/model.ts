import { suitKey } from "./api";
import {
  NO_DATA,
  YEAR_MIN,
  changeColor,
  scoreAt,
  scoreColor,
  signed,
  yearLabel,
  type RGB,
} from "./scale";
import { CROPS, CROP_LABEL, type Crop, type Scenario, type SuitabilityIndex } from "./types";
import type { ViewMode } from "./store";

export type Range = [number, number];

export interface CropRange {
  temp_opt: Range;
  temp_abs: Range;
  rain_opt: Range;
  rain_abs: Range;
  source?: string;
}

const isRange = (r: unknown): r is Range =>
  Array.isArray(r) && r.length === 2 && r.every((n) => typeof n === "number" && isFinite(n));

/** Crop tolerance ranges from meta.json, or null when the file does not carry them. */
export function cropRanges(meta: object | null | undefined): Record<Crop, CropRange> | null {
  const raw = (meta as { crops?: unknown } | null | undefined)?.crops as
    Record<string, Partial<CropRange>> | undefined;
  if (!raw) return null;
  const out = {} as Record<Crop, CropRange>;
  for (const c of CROPS) {
    const r = raw[c];
    if (!r || !isRange(r.temp_opt) || !isRange(r.temp_abs)) return null;
    if (!isRange(r.rain_opt) || !isRange(r.rain_abs)) return null;
    out[c] = r as CropRange;
  }
  return out;
}

/** Trapezoid membership: 0 outside the absolute range, 1 inside the optimal range. */
export function trapezoid(x: number, abs: Range, opt: Range): number {
  if (x <= abs[0] || x >= abs[1]) return 0;
  if (x < opt[0]) return (x - abs[0]) / (opt[0] - abs[0]);
  if (x <= opt[1]) return 1;
  return (abs[1] - x) / (abs[1] - opt[1]);
}

/** Categorical colours for the "leading crop" map. Legend and tooltips always name the crop. */
export const CROP_COLOR: Record<Crop, RGB> = {
  paddy: [46, 140, 134],
  ragi: [181, 80, 45],
  maize: [201, 162, 39],
};

export interface Cell {
  /** Score that drives the column height, 0–100. */
  score: number | null;
  color: RGB;
  /** Tooltip rows: label, value. */
  tip: [string, string][];
  best?: Crop;
}

export function bestCropAt(
  suit: SuitabilityIndex,
  scenario: Scenario,
  id: string,
  year: number,
): { crop: Crop; score: number } | null {
  let best: { crop: Crop; score: number } | null = null;
  for (const crop of CROPS) {
    const s = scoreAt(suit[suitKey(crop, scenario)]?.[id], year);
    if (s !== null && (!best || s > best.score)) best = { crop, score: s };
  }
  return best;
}

/** Everything the map draws for one frame: one cell per district. */
export function computeCells(
  suit: SuitabilityIndex | null | undefined,
  ids: string[],
  crop: Crop,
  scenario: Scenario,
  year: number,
  mode: ViewMode,
): Record<string, Cell> | undefined {
  if (!suit) return undefined;
  const out: Record<string, Cell> = {};
  const when = yearLabel(year);
  for (const id of ids) {
    if (mode === "best") {
      const now = bestCropAt(suit, scenario, id, year);
      const base = bestCropAt(suit, scenario, id, YEAR_MIN);
      if (!now || !base) {
        out[id] = { score: null, color: NO_DATA, tip: [] };
        continue;
      }
      out[id] = {
        score: now.score,
        color: CROP_COLOR[now.crop],
        best: now.crop,
        tip: [
          [`Leading crop · ${when}`, CROP_LABEL[now.crop]],
          ["Its score", `${Math.round(now.score)} / 100`],
          ["Leading crop at baseline", CROP_LABEL[base.crop]],
        ],
      };
      continue;
    }
    const row = suit[suitKey(crop, scenario)]?.[id];
    const s = scoreAt(row, year);
    if (!row || s === null) {
      out[id] = { score: null, color: NO_DATA, tip: [] };
      continue;
    }
    out[id] = {
      score: s,
      color: mode === "change" ? changeColor(s - row.baseline) : scoreColor(s),
      tip: [
        [`${CROP_LABEL[crop]} · ${when}`, `${Math.round(s)} / 100`],
        ["Change by 2050", `${signed(row.change)} pts`],
      ],
    };
  }
  return out;
}

export interface StateSummary {
  total: number;
  mean: number;
  /** Districts scoring 50 or more. */
  suitable: number;
  losing: number;
  gaining: number;
  meanChange: number;
}

export function summarise(
  suit: SuitabilityIndex,
  crop: Crop,
  scenario: Scenario,
  year: number,
): StateSummary | null {
  const rows = Object.values(suit[suitKey(crop, scenario)] ?? {});
  if (rows.length === 0) return null;
  const scores = rows.map((r) => scoreAt(r, year) ?? 0);
  return {
    total: rows.length,
    mean: scores.reduce((a, b) => a + b, 0) / rows.length,
    suitable: scores.filter((s) => s >= 50).length,
    losing: rows.filter((r) => r.change < 0).length,
    gaining: rows.filter((r) => r.change > 0).length,
    meanChange: rows.reduce((a, r) => a + r.change, 0) / rows.length,
  };
}

/** Number of districts led by each crop at a year, and how many changed leader since baseline. */
export function leaders(suit: SuitabilityIndex, ids: string[], scenario: Scenario, year: number) {
  const count: Record<Crop, number> = { paddy: 0, ragi: 0, maize: 0 };
  let switched = 0;
  let total = 0;
  for (const id of ids) {
    const now = bestCropAt(suit, scenario, id, year);
    const base = bestCropAt(suit, scenario, id, YEAR_MIN);
    if (!now || !base) continue;
    total++;
    count[now.crop]++;
    if (now.crop !== base.crop) switched++;
  }
  return { count, switched, total };
}
