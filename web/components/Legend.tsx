"use client";

import { useStore } from "@/lib/store";
import { CROP_COLOR } from "@/lib/model";
import { CHANGE_DOMAIN, changeColor, rgbCss, scoreColor } from "@/lib/scale";
import { CROPS, CROP_LABEL } from "@/lib/types";

const stops = (fn: (v: number) => [number, number, number], from: number, to: number) =>
  Array.from({ length: 9 }, (_, i) => rgbCss(fn(from + ((to - from) * i) / 8))).join(", ");

export default function Legend() {
  const { mode, crop, is3d } = useStore();
  const title =
    mode === "score"
      ? `${CROP_LABEL[crop]} suitability score`
      : mode === "change"
        ? `Change in ${CROP_LABEL[crop].toLowerCase()} score vs baseline`
        : "Highest-scoring crop";
  return (
    <div className="w-[300px] rounded border border-line bg-panel p-4">
      <div className="text-sm font-semibold text-fg">{title}</div>
      {mode === "best" ? (
        <ul className="mt-3 flex gap-4">
          {CROPS.map((c) => (
            <li key={c} className="flex items-center gap-2 text-sm text-fg">
              <span
                className="h-3 w-3 rounded-sm"
                style={{ background: rgbCss(CROP_COLOR[c]) }}
                aria-hidden
              />
              {CROP_LABEL[c]}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div
            className="mt-3 h-2.5 rounded-sm"
            style={{
              background: `linear-gradient(to right, ${
                mode === "score"
                  ? stops(scoreColor, 0, 100)
                  : stops(changeColor, -CHANGE_DOMAIN, CHANGE_DOMAIN)
              })`,
            }}
          />
          <div className="num mt-1 flex justify-between text-micro text-mute">
            {mode === "score" ? (
              <>
                <span>0</span>
                <span>50</span>
                <span>100</span>
              </>
            ) : (
              <>
                <span>−{CHANGE_DOMAIN}</span>
                <span>0</span>
                <span>+{CHANGE_DOMAIN}</span>
              </>
            )}
          </div>
          <div className="mt-0.5 flex justify-between text-micro text-mute">
            {mode === "score" ? (
              <>
                <span>Unsuitable</span>
                <span>Optimal</span>
              </>
            ) : (
              <>
                <span>Loss (points)</span>
                <span>Gain</span>
              </>
            )}
          </div>
        </>
      )}
      <p className="mt-3 border-t border-line pt-2 text-micro text-mute [@media(max-height:800px)]:hidden">
        {is3d ? "Column height = score (0–100). " : ""}Rain-fed kharif season, Jun–Oct. Source: NASA
        NEX-GDDP-CMIP6 multi-model mean × FAO ECOCROP ranges.
      </p>
    </div>
  );
}
