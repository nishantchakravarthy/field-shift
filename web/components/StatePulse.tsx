"use client";

import { useMemo } from "react";
import { suitKey } from "@/lib/api";
import { CROP_COLOR, leaders, summarise } from "@/lib/model";
import { changeColor, rgbCss, scoreAt, scoreColor, signed, yearLabel } from "@/lib/scale";
import { useStore } from "@/lib/store";
import { CROPS, CROP_LABEL, SCENARIO_LABEL, type SuitabilityIndex } from "@/lib/types";

const W = 268;
const H = 58;
const PAD = 6;
const x = (score: number) => PAD + (score / 100) * (W - PAD * 2);

/** Statewide read-out that moves with the slider: counters and one tick per district. */
export default function StatePulse({
  suit,
  names,
}: {
  suit: SuitabilityIndex;
  names: Record<string, string>;
}) {
  const { crop, scenario, year, mode, districtId, hoverId, set } = useStore();
  const ids = useMemo(() => Object.keys(names), [names]);
  const rows = suit[suitKey(crop, scenario)];
  const summary = useMemo(
    () => summarise(suit, crop, scenario, year),
    [suit, crop, scenario, year],
  );
  const lead = useMemo(
    () => (mode === "best" ? leaders(suit, ids, scenario, year) : null),
    [mode, suit, ids, scenario, year],
  );

  if (mode === "best" && lead) {
    return (
      <section className="w-[300px] rounded border border-line bg-panel p-4 max-md:w-full">
        <h2 className="text-sm font-semibold text-fg">
          Leading crop by district · <span className="num">{yearLabel(year)}</span>
        </h2>
        <ul className="mt-3 space-y-2">
          {CROPS.map((c) => (
            <li key={c} className="grid grid-cols-[52px_1fr_28px] items-center gap-2 text-sm">
              <span className="text-fg">{CROP_LABEL[c]}</span>
              <span className="h-2.5 rounded-sm bg-ink">
                <span
                  className="block h-full rounded-sm"
                  style={{
                    width: `${lead.total ? (lead.count[c] / lead.total) * 100 : 0}%`,
                    background: rgbCss(CROP_COLOR[c]),
                  }}
                />
              </span>
              <span className="num text-right text-fg">{lead.count[c]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-2 text-sm text-mute">
          <span className="num font-semibold text-fg">
            {lead.switched} of {lead.total}
          </span>{" "}
          districts have a different leading crop than at baseline.
        </p>
        <p className="mt-1 text-micro text-mute">
          Districts, {SCENARIO_LABEL[scenario]}. Source: NASA NEX-GDDP-CMIP6 × FAO ECOCROP.
        </p>
      </section>
    );
  }

  if (!summary || !rows) return null;
  const active = hoverId ?? districtId;
  const activeScore = active ? scoreAt(rows[active], year) : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best: string | null = null;
    let dist = 12;
    for (const id of ids) {
      const s = scoreAt(rows[id], year);
      if (s === null) continue;
      const d = Math.abs(x(s) - px);
      if (d < dist) {
        dist = d;
        best = id;
      }
    }
    if (best !== hoverId) set({ hoverId: best });
  };

  return (
    <section className="w-[300px] rounded border border-line bg-panel p-4 max-md:w-full">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-micro text-mute">Mean score</div>
          <div className="num text-lg font-semibold text-fg">
            {summary.mean.toFixed(0)}
            <span className="text-sm font-normal text-mute"> / 100</span>
          </div>
        </div>
        <div>
          <div className="text-micro text-mute">Scoring 50 or more</div>
          <div className="num text-lg font-semibold text-fg">
            {summary.suitable}
            <span className="text-sm font-normal text-mute"> of {summary.total}</span>
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 block w-full cursor-pointer touch-none"
        role="img"
        aria-label={`Distribution of ${CROP_LABEL[crop]} suitability scores across ${summary.total} districts, ${yearLabel(year)}. Mean ${summary.mean.toFixed(0)} of 100.`}
        onPointerMove={onMove}
        onPointerLeave={() => set({ hoverId: null })}
        onClick={() => hoverId && set({ districtId: hoverId })}
      >
        <line x1={PAD} x2={W - PAD} y1={40} y2={40} stroke="#2A3030" />
        <line x1={x(50)} x2={x(50)} y1={6} y2={40} stroke="#9AA19E" strokeDasharray="2 3" />
        {ids.map((id) => {
          const row = rows[id];
          const s = scoreAt(row, year);
          if (s === null || !row) return null;
          const on = id === active;
          const selected = id === districtId;
          return (
            <rect
              key={id}
              x={x(s) - (on ? 1.5 : 1)}
              y={on ? 6 : 16}
              width={on ? 3 : 2}
              height={on ? 34 : 24}
              rx={1}
              fill={
                selected
                  ? "#E0A43A"
                  : on
                    ? "#E8E6E1"
                    : rgbCss(mode === "change" ? changeColor(s - row.baseline) : scoreColor(s))
              }
            />
          );
        })}
        {[0, 50, 100].map((t) => (
          <text
            key={t}
            x={x(t)}
            y={54}
            textAnchor={t === 0 ? "start" : t === 100 ? "end" : "middle"}
            fill="#9AA19E"
            fontSize={11}
            className="num"
          >
            {t}
          </text>
        ))}
      </svg>

      <p className="mt-1 min-h-[20px] text-sm text-mute">
        {active && activeScore !== null && rows[active] ? (
          <>
            <span className="text-fg">{names[active]}</span>{" "}
            <span className="num text-fg">{Math.round(activeScore)}</span> ·{" "}
            <span className="num">{signed(rows[active].change)} pts</span> by 2050
          </>
        ) : (
          <>
            <span className="num text-fg">{summary.losing}</span> lose,{" "}
            <span className="num text-fg">{summary.gaining}</span> gain by 2050
          </>
        )}
      </p>
      <p className="mt-1 text-micro text-mute">
        One tick per district · {CROP_LABEL[crop].toLowerCase()} score (0–100),{" "}
        <span className="num">{yearLabel(year).toLowerCase()}</span>, {SCENARIO_LABEL[scenario]}
      </p>
    </section>
  );
}
