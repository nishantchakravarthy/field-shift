import type { SuitabilityRow } from "./types";

export type RGB = [number, number, number];

export const YEAR_MIN = 2020; // slider position of the 2001–2020 baseline window
export const YEAR_MAX = 2050; // slider position of the 2041–2060 window

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export const SOIL = hex("#5A3A22");
export const OCHRE = hex("#C9A227");
export const GREEN = hex("#3F8F4F");
export const RUST = hex("#B5502D");
export const TEAL = hex("#2E8C86");
export const NEUTRAL = hex("#5F6664");
export const NO_DATA: RGB = [42, 48, 48];

/** Sequential suitability scale, 0–100: soil brown → ochre → crop green. */
export function scoreColor(score: number): RGB {
  const t = clamp01(score / 100);
  return t < 0.5 ? mix(SOIL, OCHRE, t / 0.5) : mix(OCHRE, GREEN, (t - 0.5) / 0.5);
}

export const CHANGE_DOMAIN = 40;

/** Diverging change scale, −40…+40 points: rust ← grey → teal. */
export function changeColor(change: number): RGB {
  const t = clamp01(Math.abs(change) / CHANGE_DOMAIN);
  return mix(NEUTRAL, change < 0 ? RUST : TEAL, t);
}

export const rgbCss = (c: RGB) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/**
 * Score at a slider year. Modelled windows sit at 2020 (baseline), 2030 (when
 * the data includes it) and 2050; positions in between are linear interpolation.
 */
export function scoreAt(row: SuitabilityRow | undefined, year: number): number | null {
  if (!row) return null;
  const y = Math.min(YEAR_MAX, Math.max(YEAR_MIN, year));
  if (typeof row.y2030 === "number") {
    if (y <= 2030) return row.baseline + ((row.y2030 - row.baseline) * (y - 2020)) / 10;
    return row.y2030 + ((row.y2050 - row.y2030) * (y - 2030)) / 20;
  }
  return row.baseline + ((row.y2050 - row.baseline) * (y - YEAR_MIN)) / (YEAR_MAX - YEAR_MIN);
}

export const yearLabel = (year: number) =>
  year <= YEAR_MIN ? "Baseline" : String(Math.round(year));

export const signed = (n: number, digits = 0) =>
  `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(digits)}`;
