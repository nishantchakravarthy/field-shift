"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { YEAR_MAX, YEAR_MIN, yearLabel } from "@/lib/scale";

const PLAY_MS = 7000;
const TICKS = [2020, 2030, 2040, 2050];
const RING = 2 * Math.PI * 27; // circumference of the play-button progress ring

/** Area sparkline of districts scoring 50+, one point per slider year. */
function Sparkline({ series, total, year }: { series: number[]; total: number; year: number }) {
  const W = 300;
  const H = 26;
  const max = Math.max(1, total);
  const X = (i: number) => (i / (series.length - 1)) * W;
  const Y = (v: number) => H - 2 - (v / max) * (H - 6);
  const line = series.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  const idx = Math.round(year - YEAR_MIN);
  const now = series[Math.min(series.length - 1, Math.max(0, idx))];
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] leading-none">
        <span className="text-mute">Districts scoring 50+</span>
        <span className="num text-fg">
          {now} of {total}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[26px] w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E0A43A" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#E0A43A" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line}L${W} ${H}L0 ${H}Z`} fill="url(#spark-fill)" />
        <path d={line} fill="none" stroke="#E0A43A" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export default function TimeSlider({
  hasMidWindow,
  compact = false,
  series,
  total = 0,
}: {
  hasMidWindow: boolean;
  compact?: boolean;
  series?: number[];
  total?: number;
}) {
  const { year, playing, set } = useStore();
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const from = useStore.getState().year >= YEAR_MAX ? YEAR_MIN : useStore.getState().year;
    const start = performance.now();
    const span = ((YEAR_MAX - from) / (YEAR_MAX - YEAR_MIN)) * PLAY_MS;
    // Ease in and out so the shift starts and lands gently.
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / span);
      const y = from + (YEAR_MAX - from) * ease(t);
      if (t >= 1) set({ year: YEAR_MAX, playing: false });
      else {
        set({ year: y });
        raf.current = requestAnimationFrame(tick);
      }
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, set]);

  const progress = (year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN);
  const fill = progress * 100;

  return (
    <div
      className="rounded border border-line bg-panel/95 px-4 pb-3 pt-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur"
      style={{ width: `min(${compact ? 500 : 580}px, calc(100vw - 32px))` }}
    >
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => set({ playing: !playing })}
          aria-label={
            playing ? "Pause the shift animation" : "Play the shift from baseline to 2050"
          }
          className="play-btn relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-fg text-ink transition-transform active:scale-95"
        >
          <svg className="absolute -inset-[5px] -rotate-90" viewBox="0 0 58 58" aria-hidden>
            <circle cx="29" cy="29" r="27" fill="none" stroke="#2A3030" strokeWidth="2.5" />
            <circle
              cx="29"
              cy="29"
              r="27"
              fill="none"
              stroke="#E0A43A"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={RING}
              strokeDashoffset={RING * (1 - progress)}
            />
          </svg>
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <rect x="2" y="1" width="3.5" height="12" fill="currentColor" />
              <rect x="8.5" y="1" width="3.5" height="12" fill="currentColor" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M4 1l9 6-9 6z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between">
            <span className="text-micro uppercase tracking-[0.08em] text-mute">Climate window</span>
            <span className="num text-xl font-semibold leading-none tracking-tight text-fg" aria-live="off">
              {yearLabel(year)}
            </span>
          </div>
          {series && series.length > 1 && (
            <div className="mt-2">
              <Sparkline series={series} total={total} year={year} />
            </div>
          )}
          <input
            type="range"
            className="shift-range"
            min={YEAR_MIN}
            max={YEAR_MAX}
            step="any"
            value={year}
            onChange={(e) => set({ year: Number(e.target.value), playing: false })}
            onPointerUp={(e) => set({ year: Math.round(Number(e.currentTarget.value)) })}
            aria-label="Year, from the 2001–2020 baseline to 2050"
            aria-valuetext={yearLabel(year)}
            style={{ ["--fill" as string]: `${fill}%` }}
          />
          <div className="num relative mt-0.5 h-4 text-micro text-mute">
            {TICKS.map((t) => (
              <button
                key={t}
                type="button"
                tabIndex={-1}
                onClick={() => set({ year: t, playing: false })}
                className="absolute -translate-x-1/2 hover:text-fg first:translate-x-0 last:-translate-x-full"
                style={{ left: `${((t - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100}%` }}
              >
                {t === YEAR_MIN ? "2001–20" : t}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-micro text-mute">
        Modelled windows: 2001–2020{hasMidWindow ? ", 2021–2040" : ""} and 2041–2060 (“2050”). Years
        in between are interpolated.
      </p>
    </div>
  );
}
