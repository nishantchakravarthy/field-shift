import { trapezoid, type Range } from "@/lib/model";

const W = 372;
const H = 92;
const X0 = 10;
const X1 = W - 10;
const Y_TOP = 16;
const Y_BASE = 60;

export interface RangeMarker {
  value: number;
  /** "base" draws a hollow marker, "future" a solid one. */
  kind: "base" | "future";
}

/**
 * A crop's tolerance trapezoid for one climate variable, with the district's
 * values marked on it. Shows why a score is what it is.
 */
export default function RangePlot({
  title,
  unit,
  abs,
  opt,
  markers,
  digits = 0,
}: {
  title: string;
  unit: string;
  abs: Range;
  opt: Range;
  markers: RangeMarker[];
  digits?: number;
}) {
  const values = markers.map((m) => m.value);
  const span = Math.max(abs[1], ...values) - Math.min(abs[0], ...values);
  const lo = Math.min(abs[0], ...values) - span * 0.06;
  const hi = Math.max(abs[1], ...values) + span * 0.06;
  const x = (v: number) => X0 + ((v - lo) / (hi - lo)) * (X1 - X0);
  const y = (f: number) => Y_BASE - f * (Y_BASE - Y_TOP);
  const shape = `M${X0},${Y_BASE} L${x(abs[0])},${Y_BASE} L${x(opt[0])},${Y_TOP} L${x(opt[1])},${Y_TOP} L${x(abs[1])},${Y_BASE} L${X1},${Y_BASE}`;
  const base = markers.find((m) => m.kind === "base");
  const future = markers.find((m) => m.kind === "future");
  const fmt = (v: number) => v.toFixed(digits);
  const f = (v: number) => trapezoid(v, abs, opt);

  return (
    <figure>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-semibold text-fg">
          {title} <span className="font-normal text-mute">({unit})</span>
        </span>
        <span className="num text-micro text-mute">
          {base ? `${fmt(base.value)}` : ""}
          {base && future ? " → " : ""}
          {future ? `${fmt(future.value)} ${unit}` : ""}
          {future ? ` · factor ${f(future.value).toFixed(2)}` : ""}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 block w-full"
        role="img"
        aria-label={`${title}: optimal ${opt[0]}–${opt[1]} ${unit}, absolute limits ${abs[0]}–${abs[1]} ${unit}.${
          base ? ` Baseline ${fmt(base.value)} ${unit}.` : ""
        }${future ? ` 2050 ${fmt(future.value)} ${unit}, factor ${f(future.value).toFixed(2)}.` : ""}`}
      >
        <path d={`${shape} Z`} fill="#2A3030" opacity={0.55} />
        <path d={shape} fill="none" stroke="#9AA19E" strokeWidth={1.5} />
        {[abs[0], opt[0], opt[1], abs[1]].map((t, i) => (
          <g key={i}>
            <line x1={x(t)} x2={x(t)} y1={Y_BASE} y2={Y_BASE + 4} stroke="#9AA19E" />
            <text
              x={x(t)}
              y={Y_BASE + 16}
              textAnchor="middle"
              fill="#9AA19E"
              fontSize={11}
              className="num"
            >
              {t.toLocaleString("en-IN")}
            </text>
          </g>
        ))}
        <text
          x={(x(opt[0]) + x(opt[1])) / 2}
          y={Y_BASE + 29}
          textAnchor="middle"
          fill="#9AA19E"
          fontSize={10}
        >
          optimal
        </text>
        {base && future && (
          <line
            x1={x(base.value)}
            y1={y(f(base.value))}
            x2={x(future.value)}
            y2={y(f(future.value))}
            stroke="#E8E6E1"
            strokeWidth={1.5}
          />
        )}
        {base && (
          <circle
            cx={x(base.value)}
            cy={y(f(base.value))}
            r={4.5}
            fill="#161A1A"
            stroke="#E8E6E1"
            strokeWidth={2}
          />
        )}
        {future && (
          <circle
            cx={x(future.value)}
            cy={y(f(future.value))}
            r={5}
            fill="#E8E6E1"
            stroke="#161A1A"
            strokeWidth={2}
          />
        )}
      </svg>
    </figure>
  );
}

const doyDate = (doy: number) =>
  new Date(Date.UTC(2021, 0, Math.round(doy))).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** Sowing calendar: monsoon onset today and in 2050 on one date axis. */
export function SowingStrip({
  baseDoy,
  futureDoy,
  shiftWeeks,
}: {
  baseDoy: number;
  futureDoy: number;
  shiftWeeks: number;
}) {
  const lo = Math.min(152, baseDoy - 10, futureDoy - 10);
  const hi = Math.max(213, baseDoy + 10, futureDoy + 10);
  const x = (d: number) => X0 + ((d - lo) / (hi - lo)) * (X1 - X0);
  const months: [number, string][] = [
    [121, "1 May"],
    [152, "1 Jun"],
    [182, "1 Jul"],
    [213, "1 Aug"],
    [244, "1 Sep"],
  ];
  const yMid = 20;
  return (
    <figure>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-fg">Sowing window</span>
        <span className="num text-micro text-mute">
          {doyDate(baseDoy)} → {doyDate(futureDoy)} ·{" "}
          {shiftWeeks > 0 ? "+" : shiftWeeks < 0 ? "−" : "±"}
          {Math.abs(shiftWeeks).toFixed(1)} wk
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} 48`}
        className="mt-1 block w-full"
        role="img"
        aria-label={`Monsoon onset moves from ${doyDate(baseDoy)} at baseline to ${doyDate(futureDoy)} in 2050.`}
      >
        <line x1={X0} x2={X1} y1={yMid} y2={yMid} stroke="#2A3030" />
        {months
          .filter(([d]) => d >= lo && d <= hi)
          .map(([d, label]) => (
            <g key={d}>
              <line x1={x(d)} x2={x(d)} y1={yMid - 4} y2={yMid + 4} stroke="#9AA19E" />
              <text
                x={x(d)}
                y={42}
                textAnchor={x(d) > X1 - 24 ? "end" : x(d) < X0 + 24 ? "start" : "middle"}
                fill="#9AA19E"
                fontSize={11}
                className="num"
              >
                {label}
              </text>
            </g>
          ))}
        <line
          x1={x(baseDoy)}
          x2={x(futureDoy)}
          y1={yMid}
          y2={yMid}
          stroke="#E8E6E1"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={x(baseDoy)} cy={yMid} r={4.5} fill="#161A1A" stroke="#E8E6E1" strokeWidth={2} />
        <circle cx={x(futureDoy)} cy={yMid} r={5} fill="#E8E6E1" stroke="#161A1A" strokeWidth={2} />
      </svg>
    </figure>
  );
}
