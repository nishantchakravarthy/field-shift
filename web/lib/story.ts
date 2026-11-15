import { suitKey } from "./api";
import { leaders, summarise } from "./model";
import { YEAR_MAX, YEAR_MIN, signed } from "./scale";
import type { AppState } from "./store";
import {
  CROPS,
  CROP_LABEL,
  SCENARIO_LABEL,
  type Crop,
  type Scenario,
  type SuitabilityIndex,
} from "./types";

/** A run of text; `num` segments are set in the mono face. */
export type Seg = { t: string; num?: boolean };

export interface Chapter {
  title: string;
  body: Seg[];
  patch: Partial<Omit<AppState, "set">>;
  /** Time on screen before auto-advancing, ms. */
  ms: number;
}

const n = (t: string | number): Seg => ({ t: String(t), num: true });
const s = (t: string): Seg => ({ t });

/**
 * The guided story. Every number is computed from the suitability files, and the
 * wording follows the direction of the data rather than assuming a loss.
 */
export function buildStory(
  suit: SuitabilityIndex,
  names: Record<string, string>,
  scenario: Scenario,
): Chapter[] {
  const ids = Object.keys(names);
  const base = summarise(suit, "paddy", scenario, YEAR_MIN);
  const end = summarise(suit, "paddy", scenario, YEAR_MAX);
  if (!base || !end) return [];
  const sc = SCENARIO_LABEL[scenario];
  const chapters: Chapter[] = [];

  chapters.push({
    title: "Today’s paddy map",
    body: [
      s("Averaged over 2001–2020, "),
      n(`${base.suitable} of ${base.total}`),
      s(" districts score 50 or more for rain-fed paddy. The mean across all districts is "),
      n(`${base.mean.toFixed(0)} / 100`),
      s(". Column height is the score."),
    ],
    patch: {
      crop: "paddy",
      mode: "score",
      is3d: true,
      year: YEAR_MIN,
      districtId: null,
      playing: false,
      bearing: -14,
    },
    ms: 7500,
  });

  chapters.push({
    title: "The shift to 2050",
    body: [
      s(`Under ${sc}, `),
      n(`${end.losing} of ${end.total}`),
      s(" districts lose paddy suitability and "),
      n(end.gaining),
      s(" gain. The mean across all districts moves from "),
      n(base.mean.toFixed(0)),
      s(" to "),
      n(end.mean.toFixed(0)),
      s("."),
    ],
    patch: { year: YEAR_MIN, playing: true, districtId: null, bearing: null },
    ms: 11000,
  });

  const paddy = Object.values(suit[suitKey("paddy", scenario)] ?? {});
  const mover = [...paddy].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
  const worst = [...paddy].sort((a, b) => a.change - b.change)[0];
  const focus = worst && worst.change < 0 ? worst : mover;
  if (focus && focus.change !== 0) {
    chapters.push({
      title:
        focus.change < 0 ? `Hardest hit: ${names[focus.id]}` : `Largest change: ${names[focus.id]}`,
      body: [
        s("Paddy suitability goes from "),
        n(focus.baseline),
        s(" to "),
        n(focus.y2050),
        s(", a change of "),
        n(`${signed(focus.change)} points`),
        s(". The panel shows the climate numbers behind it and the adaptation plan."),
      ],
      patch: { playing: false, year: YEAR_MAX, districtId: focus.id, bearing: 18 },
      ms: 10000,
    });
  }

  const others = CROPS.filter((c) => c !== "paddy")
    .map((c) => ({ crop: c as Crop, sum: summarise(suit, c, scenario, YEAR_MAX) }))
    .filter((o) => o.sum)
    .sort((a, b) => (b.sum?.meanChange ?? 0) - (a.sum?.meanChange ?? 0));
  const other = others[0];
  if (other?.sum) {
    const label = CROP_LABEL[other.crop];
    chapters.push({
      title: `${label} responds differently`,
      body: [
        n(other.sum.gaining),
        s(` districts gain ${label.toLowerCase()} suitability and `),
        n(other.sum.losing),
        s(" lose it. Mean change: "),
        n(`${signed(other.sum.meanChange, 1)} points`),
        s(", against "),
        n(`${signed(end.meanChange, 1)}`),
        s(" for paddy."),
      ],
      patch: {
        districtId: null,
        crop: other.crop,
        mode: "change",
        year: YEAR_MAX,
        playing: false,
        bearing: -32,
      },
      ms: 8500,
    });
  }

  const lead = leaders(suit, ids, scenario, YEAR_MAX);
  chapters.push({
    title: "What to plant in 2050",
    body: [
      n(`${lead.switched} of ${lead.total}`),
      s(" districts have a different highest-scoring crop in 2050 than today. "),
      s("Open any district for its sowing window, water gap and actions."),
    ],
    patch: { districtId: null, mode: "best", year: YEAR_MAX, playing: false, bearing: -14 },
    ms: 9000,
  });

  return chapters;
}
