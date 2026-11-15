import { create } from "zustand";
import { CROPS, SCENARIOS, type Crop, type Scenario } from "./types";
import { YEAR_MAX, YEAR_MIN } from "./scale";

export type ViewMode = "score" | "change" | "best";
export type Lang = "en" | "kn";

interface State {
  crop: Crop;
  scenario: Scenario;
  year: number;
  districtId: string | null;
  mode: ViewMode;
  is3d: boolean;
  /** Before/after swipe view: baseline left of the divider, 2050 right of it. */
  swipe: boolean;
  /** Divider position as a fraction of the map width. */
  split: number;
  playing: boolean;
  /** District highlighted from a list or chart (not the map itself). */
  hoverId: string | null;
  /** Active chapter of the guided story, or null when exploring freely. */
  story: number | null;
  /** Camera bearing requested by the story, degrees. */
  bearing: number | null;
  lang: Lang;
  set: (patch: Partial<Omit<State, "set">>) => void;
}

export type AppState = State;

export const useStore = create<State>((set) => ({
  crop: "paddy",
  scenario: "ssp585",
  year: YEAR_MIN,
  districtId: null,
  mode: "score",
  is3d: true,
  swipe: false,
  split: 0.5,
  playing: false,
  hoverId: null,
  story: null,
  bearing: null,
  lang: "en",
  set: (patch) => set(patch),
}));

/** Parse a shared URL (/map?crop=ragi&scenario=ssp585&year=2050&d=mandya). */
export function stateFromQuery(q: URLSearchParams): Partial<Omit<State, "set">> {
  const out: Partial<Omit<State, "set">> = {};
  const crop = q.get("crop");
  if (crop && (CROPS as readonly string[]).includes(crop)) out.crop = crop as Crop;
  const scenario = q.get("scenario");
  if (scenario && (SCENARIOS as readonly string[]).includes(scenario))
    out.scenario = scenario as Scenario;
  const year = q.get("year");
  if (year === "baseline") out.year = YEAR_MIN;
  else if (year && Number.isFinite(Number(year)))
    out.year = Math.min(YEAR_MAX, Math.max(YEAR_MIN, Number(year)));
  const d = q.get("d");
  if (d && /^[a-z0-9_]+$/.test(d)) out.districtId = d;
  const view = q.get("view");
  if (view === "change" || view === "best") out.mode = view;
  if (q.get("flat") === "1") out.is3d = false;
  if (q.get("swipe") === "1") out.swipe = true;
  if (q.get("story") === "1") out.story = 0;
  return out;
}

export function queryFromState(s: State): string {
  const q = new URLSearchParams();
  q.set("crop", s.crop);
  q.set("scenario", s.scenario);
  q.set("year", s.year <= YEAR_MIN ? "baseline" : String(Math.round(s.year)));
  if (s.districtId) q.set("d", s.districtId);
  if (s.mode !== "score") q.set("view", s.mode);
  if (!s.is3d) q.set("flat", "1");
  if (s.swipe) q.set("swipe", "1");
  return q.toString();
}
