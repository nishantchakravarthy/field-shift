"use client";

import { useId, useMemo, useState } from "react";

interface Props {
  title: string;
  unit: string;
  source: string;
  years: number[];
  values: (number | null)[];
  digits?: number;
  /** Stroke colour of the single series. */
  color?: string;
}

const W = 372;
const H = 132;
const M = { top: 10, right: 12, bottom: 22, left: 44 };

function niceTicks(min: number, max: number): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / 2;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toPrecision(10)));
  return out;
}

export default function LineChart({
  title,
  unit,
  source,
  years,
  values,
  digits = 0,
  color = "#C9A227",
}: Props) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const pts = years
      .map((year, i) => ({ year, v: values[i] }))
      .filter((p): p is { year: number; v: number } => typeof p.v === "number" && isFinite(p.v));
    if (pts.length < 2) return null;
    const vs = pts.map((p) => p.v);
    const ticks = niceTicks(Math.min(...vs), Math.max(...vs));
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    const x0 = years[0];
    const x1 = years[years.length - 1];
    const x = (yr: number) => M.left + ((yr - x0) / (x1 - x0 || 1)) * (W - M.left - M.right);
    const y = (v: number) => H - M.bottom - ((v - y0) / (y1 - y0 || 1)) * (H - M.top - M.bottom);
    const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
    // Break the line across missing years rather than bridging them.
    let d = "";
    let prevYear: number | null = null;
    for (const p of pts) {
      const gap = prevYear === null || p.year - prevYear > 1;
      d += `${gap ? "M" : "L"}${x(p.year).toFixed(1)},${y(p.v).toFixed(1)}`;
      prevYear = p.year;
    }
    return { pts, ticks, x, y, mean, d, x0, x1 };
  }, [years, values]);

  const fmt = (v: number) => v.toFixed(digits);

  if (!model) {
    return (
      <figure>
        <figcaption className="text-sm font-semibold text-fg">{title}</figcaption>
        <div className="mt-2 flex h-[100px] items-center justify-center rounded border border-dashed border-line text-sm text-mute">
          No observations available for this district
        </div>
        <p className="mt-1 text-micro text-mute">Source: {source}</p>
      </figure>
    );
  }

  const { pts, ticks, x, y, mean, d, x0, x1 } = model;
  const active = hover !== null ? pts[hover] : null;
  const xTicks = [x0, ...[2005, 2010, 2015].filter((t) => t > x0 && t < x1), x1];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++)
      if (Math.abs(x(pts[i].year) - px) < Math.abs(x(pts[best].year) - px)) best = i;
    setHover(best);
  };

  return (
    <figure>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-fg">
          {title} <span className="font-normal text-mute">({unit})</span>
        </span>
        <span className="num text-micro text-mute">
          {active
            ? `${active.year}: ${fmt(active.v)} ${unit}`
            : `${x0}–${x1} mean ${fmt(mean)} ${unit}`}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 block w-full touch-none"
        role="img"
        aria-labelledby={id}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title id={id}>
          {title} in {unit}, {x0} to {x1}. Mean {fmt(mean)} {unit}.
        </title>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(t)}
              y2={y(t)}
              stroke="#2A3030"
              strokeWidth={1}
            />
            <text
              x={M.left - 8}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              fill="#9AA19E"
              fontSize={11}
              className="num"
            >
              {fmt(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={H - 6}
            textAnchor={t === x0 ? "start" : t === x1 ? "end" : "middle"}
            fill="#9AA19E"
            fontSize={11}
            className="num"
          >
            {t}
          </text>
        ))}
        <line
          x1={M.left}
          x2={W - M.right}
          y1={y(mean)}
          y2={y(mean)}
          stroke="#9AA19E"
          strokeWidth={1}
          strokeDasharray="3 4"
        />
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {active && (
          <g>
            <line
              x1={x(active.year)}
              x2={x(active.year)}
              y1={M.top}
              y2={H - M.bottom}
              stroke="#9AA19E"
              strokeWidth={1}
            />
            <circle
              cx={x(active.year)}
              cy={y(active.v)}
              r={4.5}
              fill={color}
              stroke="#161A1A"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      <p className="text-micro text-mute">Source: {source} · dashed line = period mean</p>
    </figure>
  );
}
