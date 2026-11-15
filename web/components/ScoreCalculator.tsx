"use client";

import { useState } from "react";
import { trapezoid, type CropRange } from "@/lib/model";
import { rgbCss, scoreColor } from "@/lib/scale";
import { CROPS, CROP_LABEL, type Crop } from "@/lib/types";
import RangePlot from "./RangePlot";

const mid = (r: [number, number]) => (r[0] + r[1]) / 2;

/** Try the model by hand: pick a crop, set a season, read the score. */
export default function ScoreCalculator({ crops }: { crops: Record<Crop, CropRange> }) {
  const [crop, setCrop] = useState<Crop>("paddy");
  const r = crops[crop];
  const [temp, setTemp] = useState(() => mid(crops.paddy.temp_opt));
  const [rain, setRain] = useState(() => mid(crops.paddy.rain_opt));

  const tempMax = Math.max(...CROPS.map((c) => crops[c].temp_abs[1])) + 3;
  const tempMin = Math.max(0, Math.min(...CROPS.map((c) => crops[c].temp_abs[0])) - 3);
  const rainMax = Math.max(...CROPS.map((c) => crops[c].rain_abs[1])) + 200;

  const fTemp = trapezoid(temp, r.temp_abs, r.temp_opt);
  const fRain = trapezoid(rain, r.rain_abs, r.rain_opt);
  const score = Math.round(100 * Math.min(fTemp, fRain));
  const limiting = fTemp === fRain ? null : fTemp < fRain ? "temperature" : "rainfall";

  return (
    <div className="mt-6 rounded border border-line bg-panel p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Try it</h3>
          <p className="mt-1 text-sm text-mute">
            Set a kharif season and see how each factor produces the score.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Crop"
          className="flex rounded border border-line bg-ink p-0.5"
        >
          {CROPS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === crop}
              onClick={() => setCrop(c)}
              className={`rounded-[4px] px-4 py-1.5 text-sm ${
                c === crop ? "bg-fg font-semibold text-ink" : "text-mute hover:text-fg"
              }`}
            >
              {CROP_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div>
          <RangePlot
            title="Season mean temperature"
            unit="°C"
            digits={1}
            abs={r.temp_abs}
            opt={r.temp_opt}
            markers={[{ value: temp, kind: "future" }]}
          />
          <input
            type="range"
            className="shift-range mt-2"
            min={tempMin}
            max={tempMax}
            step={0.1}
            value={temp}
            onChange={(e) => setTemp(Number(e.target.value))}
            aria-label="Season mean temperature, °C"
            aria-valuetext={`${temp.toFixed(1)} °C`}
            style={{
              ["--fill" as string]: `${((temp - tempMin) / (tempMax - tempMin)) * 100}%`,
            }}
          />
        </div>
        <div>
          <RangePlot
            title="Season rainfall"
            unit="mm"
            abs={r.rain_abs}
            opt={r.rain_opt}
            markers={[{ value: rain, kind: "future" }]}
          />
          <input
            type="range"
            className="shift-range mt-2"
            min={0}
            max={rainMax}
            step={10}
            value={rain}
            onChange={(e) => setRain(Number(e.target.value))}
            aria-label="Season rainfall, mm"
            aria-valuetext={`${rain.toFixed(0)} mm`}
            style={{ ["--fill" as string]: `${(rain / rainMax) * 100}%` }}
          />
        </div>
      </div>

      <div
        className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line pt-5"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <span
            className="h-10 w-2 rounded-sm"
            style={{ background: rgbCss(scoreColor(score)) }}
            aria-hidden
          />
          <div>
            <div className="text-micro text-mute">{CROP_LABEL[crop]} suitability</div>
            <div className="num text-xl font-semibold">
              {score}
              <span className="text-sm font-normal text-mute"> / 100</span>
            </div>
          </div>
        </div>
        <p className="num text-sm text-mute">
          100 × min( <span className="text-fg">{fTemp.toFixed(2)}</span>,{" "}
          <span className="text-fg">{fRain.toFixed(2)}</span> )
        </p>
        <p className="text-sm text-mute">
          {score === 100
            ? "Both factors are inside the optimal range."
            : limiting
              ? `Limited by ${limiting}.`
              : "Both factors limit equally."}
        </p>
      </div>
    </div>
  );
}
