"use client";

import { useStore } from "@/lib/store";
import { CROPS, CROP_LABEL, SCENARIOS, SCENARIO_LABEL, SCENARIO_NOTE } from "@/lib/types";

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  render,
  title,
  disabled = false,
  aside,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => string;
  title?: (v: T) => string;
  disabled?: boolean;
  aside?: React.ReactNode;
}) {
  return (
    <div className={disabled ? "opacity-45" : undefined}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-micro uppercase tracking-[0.08em] text-mute">{label}</span>
        {aside}
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex rounded border border-line bg-ink p-0.5"
      >
        {options.map((o) => {
          const active = o === value;
          return (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              title={title?.(o)}
              onClick={() => onChange(o)}
              className={`flex-1 whitespace-nowrap rounded-[4px] px-2 py-1.5 text-sm transition-colors ${
                active ? "bg-fg font-semibold text-ink" : "text-mute hover:text-fg"
              }`}
            >
              {render(o)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const VIEW_LABEL = { "3d": "3D", flat: "Flat", swipe: "Swipe 2050" } as const;
const VIEW_TITLE = {
  "3d": "Columns rise with the score",
  flat: "Flat, north-up map",
  swipe: "Drag a divider between the baseline and 2050",
} as const;

const MODE_LABEL = { score: "Score", change: "Change", best: "Best crop" } as const;
const MODE_TITLE = {
  score: "Suitability score, 0–100",
  change: "Change in score since the 2001–2020 baseline",
  best: "Which of the three crops scores highest",
} as const;

export default function Controls() {
  const { crop, scenario, mode, is3d, swipe, set } = useStore();
  const view = swipe ? "swipe" : is3d ? "3d" : "flat";
  return (
    <div className="w-[300px] space-y-3 rounded border border-line bg-panel p-4 max-md:w-full">
      <Segmented
        label={mode === "best" ? "Crop (all three compared)" : "Crop"}
        options={CROPS}
        value={crop}
        onChange={(v) => set({ crop: v })}
        render={(v) => CROP_LABEL[v]}
        disabled={mode === "best"}
      />
      <Segmented
        label="Emissions scenario"
        options={SCENARIOS}
        value={scenario}
        onChange={(v) => set({ scenario: v })}
        render={(v) => SCENARIO_LABEL[v]}
        title={(v) => SCENARIO_NOTE[v]}
      />
      <Segmented
        label="Colour by"
        options={["score", "change", "best"] as const}
        value={mode}
        onChange={(v) => set({ mode: v })}
        render={(v) => MODE_LABEL[v]}
        title={(v) => MODE_TITLE[v]}
      />
      <Segmented
        label="View"
        options={["3d", "flat", "swipe"] as const}
        value={view}
        onChange={(v) =>
          set(
            v === "swipe"
              ? { swipe: true, playing: false }
              : { swipe: false, is3d: v === "3d" },
          )
        }
        render={(v) => VIEW_LABEL[v]}
        title={(v) => VIEW_TITLE[v]}
      />
    </div>
  );
}
