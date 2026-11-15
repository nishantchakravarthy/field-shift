"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { getDistrict, suitKey } from "@/lib/api";
import { KN, KN_CROP, kannadaActions } from "@/lib/kannada";
import { cropRanges } from "@/lib/model";
import { useStore } from "@/lib/store";
import { rgbCss, scoreColor, signed } from "@/lib/scale";
import {
  CROPS,
  CROP_LABEL,
  SCENARIO_LABEL,
  type Crop,
  type DistrictFile,
  type MetaFile,
  type SuitabilityIndex,
} from "@/lib/types";
import LineChart from "./LineChart";
import RangePlot, { SowingStrip } from "./RangePlot";

const MODEL_SOURCE = "NASA NEX-GDDP-CMIP6";

function sourceFor(meta: MetaFile | null, pattern: RegExp, fallback: string): string {
  const ds = meta?.datasets?.find((d) => pattern.test(`${d.use ?? ""} ${d.name}`));
  return ds ? `${ds.name}${ds.period ? `, ${ds.period}` : ""}` : fallback;
}

function SectionTitle({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-micro font-semibold uppercase tracking-[0.08em] text-mute">{children}</h3>
      {note && <span className="text-micro text-mute">{note}</span>}
    </div>
  );
}

function ScoreRow({
  crop,
  baseline,
  y2050,
  active,
  onPick,
}: {
  crop: Crop;
  baseline: number;
  y2050: number;
  active: boolean;
  onPick: () => void;
}) {
  const lo = Math.min(baseline, y2050);
  const hi = Math.max(baseline, y2050);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      title={`Show ${CROP_LABEL[crop].toLowerCase()} on the map`}
      className={`grid w-full grid-cols-[64px_1fr_118px] items-center gap-3 rounded-sm px-1 py-1.5 text-left hover:bg-ink ${
        active ? "bg-ink" : ""
      }`}
    >
      <span className={`text-sm ${active ? "font-semibold text-fg" : "text-mute"}`}>
        {CROP_LABEL[crop]}
      </span>
      <span className="relative block h-4" aria-hidden>
        <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
        <motion.span
          className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-mute/60"
          initial={false}
          animate={{ left: `${lo}%`, width: `${hi - lo}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        <motion.span
          className="absolute top-1/2 -ml-[5px] h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-mute bg-panel"
          initial={false}
          animate={{ left: `${baseline}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        <motion.span
          className="absolute top-1/2 -ml-1.5 h-3 w-3 -translate-y-1/2 rounded-full ring-2 ring-panel"
          initial={false}
          animate={{ left: `${y2050}%`, backgroundColor: rgbCss(scoreColor(y2050)) }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </span>
      <span className="num text-right text-sm text-fg">
        {baseline} → {y2050} <span className="text-mute">({signed(y2050 - baseline)})</span>
      </span>
    </button>
  );
}

function Stat({
  label,
  base,
  future,
  delta,
  unit,
}: {
  label: string;
  base: string;
  future: string;
  delta: string;
  unit: string;
}) {
  return (
    <div className="rounded border border-line bg-ink px-3 py-2.5">
      <div className="text-micro text-mute">{label}</div>
      <div className="num mt-1 text-lg font-semibold text-fg">{delta}</div>
      <div className="num text-micro text-mute">
        {base} → {future} {unit}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-label="Loading district data">
      <div className="skeleton h-8 w-2/3" />
      <div className="skeleton h-20 w-full" />
      <div className="skeleton h-24 w-full" />
      <div className="skeleton h-32 w-full" />
      <div className="skeleton h-32 w-full" />
    </div>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
      className="flex h-8 items-center rounded border border-line px-2.5 text-micro text-mute hover:border-amber hover:text-fg"
    >
      <span aria-live="polite">{copied ? "Link copied" : "Copy link"}</span>
    </button>
  );
}

export default function DistrictPanel({
  id,
  name,
  suit,
  meta,
}: {
  id: string;
  name: string;
  suit: SuitabilityIndex;
  meta: MetaFile | null;
}) {
  const { crop, scenario, lang, set } = useStore();
  const [data, setData] = useState<DistrictFile | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ranges = useMemo(() => cropRanges(meta), [meta]);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(false);
    getDistrict(id)
      .then((d) => live && setData(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [id, attempt]);

  const climate = data?.climate[scenario];
  const plan = data?.plan[scenario];
  const row = suit[suitKey(crop, scenario)]?.[id];
  const rainPct =
    climate && climate.rain_base_mm > 0
      ? ((climate.rain_2050_mm - climate.rain_base_mm) / climate.rain_base_mm) * 100
      : 0;
  const hasOnset =
    climate &&
    typeof climate.onset_base_doy === "number" &&
    typeof climate.onset_2050_doy === "number";
  const kn = lang === "kn";

  return (
    <motion.aside
      initial={{ x: 440 }}
      animate={{ x: 0 }}
      exit={{ x: 440 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="thin-scroll absolute bottom-0 right-0 top-0 z-20 w-full max-w-[420px] overflow-y-auto border-l border-line bg-panel max-md:top-auto max-md:h-[62vh] max-md:max-w-none max-md:border-l-0 max-md:border-t"
      aria-label={`District X-Ray: ${name}`}
    >
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-panel px-6 pb-4 pt-5">
        <div className="min-w-0">
          <div className="text-micro uppercase tracking-[0.08em] text-mute">
            District X-Ray · {SCENARIO_LABEL[scenario]}
          </div>
          <h2 className="mt-1 truncate text-xl font-semibold leading-tight text-fg">{name}</h2>
          {row && (
            <p className="mt-1 text-sm text-mute">
              {CROP_LABEL[crop]} suitability{" "}
              <span className="num text-fg">
                {row.baseline} → {row.y2050}
              </span>{" "}
              by 2050
            </p>
          )}
        </div>
        <div className="mt-1 flex shrink-0 gap-2">
          <CopyLink />
          <button
            type="button"
            onClick={() => set({ districtId: null })}
            aria-label="Close district panel (Esc)"
            className="flex h-8 w-8 items-center justify-center rounded border border-line text-mute hover:border-amber hover:text-fg"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </header>

      {error ? (
        <div className="p-6 text-sm text-mute">
          <p className="font-semibold text-fg">District data could not be loaded.</p>
          <p className="mt-1">The map scores are still valid.</p>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-4 rounded border border-line px-4 py-2 text-sm text-fg hover:border-amber"
          >
            Try again
          </button>
        </div>
      ) : !data || !climate || !plan ? (
        <Skeleton />
      ) : (
        <div className="space-y-8 px-6 pb-8 pt-6">
          <section>
            <SectionTitle note="○ 2001–2020  ● 2050">Suitability, 0–100</SectionTitle>
            {CROPS.map((c) => {
              const r = suit[suitKey(c, scenario)]?.[id];
              return r ? (
                <ScoreRow
                  key={c}
                  crop={c}
                  baseline={r.baseline}
                  y2050={r.y2050}
                  active={c === crop}
                  onPick={() => set({ crop: c })}
                />
              ) : null;
            })}
            <p className="mt-2 text-micro text-mute">
              Source: {MODEL_SOURCE} multi-model mean, kharif season (Jun–Oct) · FAO ECOCROP ranges
            </p>
          </section>

          {ranges && (
            <section className="space-y-4">
              <SectionTitle note="○ 2001–2020  ● 2050">
                Why: {CROP_LABEL[crop].toLowerCase()} tolerance vs this district
              </SectionTitle>
              <RangePlot
                title="Season mean temperature"
                unit="°C"
                digits={1}
                abs={ranges[crop].temp_abs}
                opt={ranges[crop].temp_opt}
                markers={[
                  { value: climate.temp_base_c, kind: "base" },
                  { value: climate.temp_2050_c, kind: "future" },
                ]}
              />
              <RangePlot
                title="Season rainfall"
                unit="mm"
                abs={ranges[crop].rain_abs}
                opt={ranges[crop].rain_opt}
                markers={[
                  { value: climate.rain_base_mm, kind: "base" },
                  { value: climate.rain_2050_mm, kind: "future" },
                ]}
              />
              <p className="text-micro text-mute">
                Score = 100 × the lower of the two factors. Ranges: FAO ECOCROP. Climate:{" "}
                {MODEL_SOURCE}, {SCENARIO_LABEL[scenario]}.
              </p>
            </section>
          )}

          <section>
            <SectionTitle note="2001–2020 → 2041–2060">Kharif climate shift</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              <Stat
                label="Mean temperature"
                delta={`${signed(climate.temp_2050_c - climate.temp_base_c, 1)} °C`}
                base={climate.temp_base_c.toFixed(1)}
                future={climate.temp_2050_c.toFixed(1)}
                unit="°C"
              />
              <Stat
                label="Season rainfall"
                delta={`${signed(rainPct, 0)} %`}
                base={climate.rain_base_mm.toFixed(0)}
                future={climate.rain_2050_mm.toFixed(0)}
                unit="mm"
              />
              <Stat
                label="Monsoon onset"
                delta={`${signed(climate.onset_shift_weeks, 1)} wk`}
                base="today"
                future="2050"
                unit=""
              />
            </div>
            {hasOnset && (
              <div className="mt-4">
                <SowingStrip
                  baseDoy={climate.onset_base_doy as number}
                  futureDoy={climate.onset_2050_doy as number}
                  shiftWeeks={climate.onset_shift_weeks}
                />
              </div>
            )}
            <p className="mt-2 text-micro text-mute">
              Source: {MODEL_SOURCE}, {SCENARIO_LABEL[scenario]}. Onset: + = later, − = earlier.
            </p>
          </section>

          <section>
            <SectionTitle
              note={
                <span role="radiogroup" aria-label="Plan language" className="flex gap-1">
                  {(["en", "kn"] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      role="radio"
                      aria-checked={lang === l}
                      onClick={() => set({ lang: l })}
                      className={`rounded-sm border px-2 py-0.5 text-micro ${
                        lang === l ? "border-fg text-fg" : "border-line text-mute hover:text-fg"
                      }`}
                    >
                      {l === "en" ? "English" : "ಕನ್ನಡ"}
                    </button>
                  ))}
                </span>
              }
            >
              {kn ? KN.heading : "Adaptation plan"}
            </SectionTitle>
            <div className="rounded border border-line bg-ink p-4" lang={kn ? "kn" : "en"}>
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-micro text-mute">{kn ? KN.bestNow : "Best crop today"}</div>
                  <div className="text-lg font-semibold text-fg">
                    {kn ? KN_CROP[plan.best_now] : CROP_LABEL[plan.best_now]}
                  </div>
                </div>
                <svg width="28" height="12" viewBox="0 0 28 12" className="text-mute" aria-hidden>
                  <path
                    d="M0 6h26M21 1l5 5-5 5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                  />
                </svg>
                <div>
                  <div className="text-micro text-mute">{kn ? KN.best2050 : "Best crop 2050"}</div>
                  <div className="text-lg font-semibold text-fg">
                    {kn ? KN_CROP[plan.best_2050] : CROP_LABEL[plan.best_2050]}
                  </div>
                </div>
                <span
                  className={`ml-auto rounded-sm border px-2 py-1 text-micro font-semibold tracking-[0.06em] ${
                    plan.switch ? "border-amber text-amber" : "border-line text-mute"
                  } ${kn ? "" : "uppercase"}`}
                >
                  {plan.switch
                    ? kn
                      ? KN.switchAdvised
                      : "Switch advised"
                    : kn
                      ? KN.noSwitch
                      : "No switch"}
                </span>
              </div>
              <ol className="mt-4 space-y-2 border-t border-line pt-3">
                {(kn ? kannadaActions(plan, climate) : plan.actions).map((a, i) => (
                  <li key={i} className="flex gap-3 text-sm text-fg">
                    <span className="num text-mute">{i + 1}</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ol>
              {kn && (
                <p className="mt-3 text-micro text-mute" lang="en">
                  Kannada summary generated from the same plan numbers; wording not yet reviewed by
                  an agronomist.
                </p>
              )}
            </div>
            <table className="mt-3 w-full text-sm">
              <caption className="mb-1 text-left text-micro text-mute">
                Rain-fed water gap in 2050 = crop’s optimal minimum − projected season rainfall
              </caption>
              <tbody>
                {CROPS.map((c) => {
                  const gap = plan.water_gap_mm[c] ?? 0;
                  const lim = plan.limiting?.[c];
                  return (
                    <tr key={c} className="border-t border-line">
                      <th scope="row" className="py-1.5 text-left font-normal text-mute">
                        {CROP_LABEL[c]}
                      </th>
                      <td className="text-micro text-mute">
                        {lim ? `limited by ${lim === "temp" ? "temperature" : "rainfall"}` : ""}
                      </td>
                      <td className="num py-1.5 text-right text-fg">
                        {gap > 0 ? `${gap.toFixed(0)} mm short` : "no gap"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="space-y-6">
            <SectionTitle note="Observed">20-year satellite record</SectionTitle>
            <LineChart
              title="Kharif rainfall"
              unit="mm"
              years={data.history.years}
              values={data.history.rain_mm}
              source={sourceFor(meta, /rain|precip/i, "NASA satellite precipitation")}
              color="#2E8C86"
            />
            <LineChart
              title="Peak crop greenness, NDVI"
              unit="index"
              digits={2}
              years={data.history.years}
              values={data.history.ndvi_peak}
              source={sourceFor(meta, /ndvi|vegetation/i, "NASA MODIS MOD13Q1")}
              color="#3F8F4F"
            />
            <LineChart
              title="Daytime land surface temperature"
              unit="°C"
              digits={1}
              years={data.history.years}
              values={data.history.lst_day_c}
              source={sourceFor(meta, /lst|surface temp/i, "NASA MODIS MOD11A2")}
              color="#C9A227"
            />
          </section>

          <footer className="border-t border-line pt-4 text-micro text-mute">
            District means; irrigation is not modelled.{" "}
            <Link
              href="/methodology"
              className="text-fg underline underline-offset-2 hover:text-amber"
            >
              Method, data sources and limitations
            </Link>
          </footer>
        </div>
      )}
    </motion.aside>
  );
}
