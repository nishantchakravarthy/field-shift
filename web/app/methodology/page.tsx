import type { Metadata } from "next";
import Link from "next/link";
import ScoreCalculator from "@/components/ScoreCalculator";
import { cropRanges } from "@/lib/model";
import { readFindings, readMeta } from "@/lib/server-data";
import { CROPS, CROP_LABEL, SCENARIO_LABEL } from "@/lib/types";

export const metadata: Metadata = {
  title: "Methodology — Field Shift",
  description:
    "How Field Shift scores crop suitability: datasets, formula, validation and limitations.",
};

type Range = [number, number];
interface CropRange {
  temp_opt?: Range;
  temp_abs?: Range;
  rain_opt?: Range;
  rain_abs?: Range;
  source?: string;
}

const range = (r: Range | undefined, unit: string) =>
  r ? `${r[0].toLocaleString("en-IN")}–${r[1].toLocaleString("en-IN")} ${unit}` : "—";

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-16 scroll-mt-8 border-t border-line pt-6 text-xl font-semibold">
      {children}
    </h2>
  );
}

/** The trapezoid membership function, drawn rather than described. */
function Trapezoid() {
  return (
    <figure className="mt-6 rounded border border-line bg-panel p-6">
      <svg viewBox="0 0 560 190" className="w-full" role="img" aria-labelledby="trap-title">
        <title id="trap-title">
          Factor score rises linearly from 0 at the absolute minimum to 1 at the optimal minimum,
          stays at 1 across the optimal range, and falls to 0 at the absolute maximum.
        </title>
        <line x1="50" y1="150" x2="530" y2="150" stroke="#2A3030" />
        <line x1="50" y1="40" x2="530" y2="40" stroke="#2A3030" strokeDasharray="3 4" />
        <path
          d="M50,150 L120,150 L220,40 L380,40 L470,150 L530,150"
          fill="none"
          stroke="#C9A227"
          strokeWidth="2"
        />
        {[
          [120, "absolute min"],
          [220, "optimal min"],
          [380, "optimal max"],
          [470, "absolute max"],
        ].map(([x, label]) => (
          <g key={label}>
            <line x1={x} y1="150" x2={x} y2="156" stroke="#9AA19E" />
            <text x={x} y="174" textAnchor="middle" fill="#9AA19E" fontSize="12">
              {label}
            </text>
          </g>
        ))}
        <text x="42" y="44" textAnchor="end" fill="#9AA19E" fontSize="12" className="num">
          1
        </text>
        <text x="42" y="154" textAnchor="end" fill="#9AA19E" fontSize="12" className="num">
          0
        </text>
        <text x="300" y="30" textAnchor="middle" fill="#E8E6E1" fontSize="12">
          fully suitable
        </text>
      </svg>
      <figcaption className="mt-2 text-micro text-mute">
        Factor score f(x) for one climate variable (season temperature or season rainfall). Ranges
        per crop are in the table below.
      </figcaption>
    </figure>
  );
}

export default async function Methodology() {
  const [meta, findings] = await Promise.all([readMeta(), readFindings()]);
  const crops = (meta?.crops ?? {}) as Record<string, CropRange>;
  const validation = meta?.validation as
    | {
        pearson_r?: number;
        n?: number;
        description?: string;
        note?: string;
        per_crop_score_vs_ndvi_r?: Record<string, number>;
        rain_model_vs_observed_r?: number;
        rain_model_minus_observed_mean_mm?: number;
      }
    | undefined;
  const windows = meta?.windows as
    { baseline?: string; y2050?: string; y2030?: string } | undefined;
  const boundaries = meta?.boundaries as
    { source?: string; licence?: string; district_count?: number; note?: string } | undefined;
  const models = meta?.models ?? [];
  const calcRanges = cropRanges(meta);

  return (
    <main className="mx-auto max-w-[860px] px-6 pb-24 pt-8">
      <header className="flex items-center justify-between text-sm">
        <Link href="/" className="text-base font-semibold tracking-tight hover:text-amber">
          Field Shift
        </Link>
        <Link href="/map" className="text-mute hover:text-fg">
          Shift Map →
        </Link>
      </header>

      <p className="mt-16 text-micro uppercase tracking-[0.12em] text-mute">Methodology</p>
      <h1 className="mt-3 text-xl font-semibold md:text-hero">How the score works</h1>
      <p className="mt-6 text-lg text-mute">
        Field Shift is a transparent, rule-based model. Every number on the map can be traced to a
        named dataset and reproduced with the formula on this page. Nothing is computed live: the
        app reads files generated once by the pipeline
        {meta?.generated ? (
          <>
            {" "}
            on <span className="num text-fg">{String(meta.generated).slice(0, 10)}</span>
          </>
        ) : null}
        .
      </p>

      <H2 id="score">1. The suitability score</H2>
      <p className="mt-4 text-mute">
        For each district, crop and climate window we take two numbers from the kharif season
        (June–October): mean air temperature and total rainfall. Each is converted to a factor score
        between 0 and 1 with a trapezoid built from the crop’s published tolerance ranges.
      </p>
      <Trapezoid />
      <pre className="num mt-6 overflow-x-auto rounded border border-line bg-panel p-6 text-sm text-fg">
        {`score = 100 × min( f_temp(T_season), f_rain(R_season) )`}
      </pre>
      <p className="mt-4 text-mute">
        The minimum, not the average, is used on purpose: by Liebig’s law the scarcest factor limits
        growth, so plentiful rain cannot compensate for lethal heat. The district panel names which
        factor is limiting in 2050.
      </p>

      <h3 className="mt-8 text-base font-semibold">Crop tolerance ranges</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-micro uppercase tracking-[0.06em] text-mute">
              <th className="py-2 font-semibold">Crop</th>
              <th className="py-2 font-semibold">Temp optimal</th>
              <th className="py-2 font-semibold">Temp absolute</th>
              <th className="py-2 font-semibold">Rain optimal</th>
              <th className="py-2 font-semibold">Rain absolute</th>
            </tr>
          </thead>
          <tbody className="num">
            {CROPS.map((c) => (
              <tr key={c} className="border-b border-line">
                <th scope="row" className="py-2 text-left font-sans font-normal">
                  {CROP_LABEL[c]}
                </th>
                <td>{range(crops[c]?.temp_opt, "°C")}</td>
                <td>{range(crops[c]?.temp_abs, "°C")}</td>
                <td>{range(crops[c]?.rain_opt, "mm")}</td>
                <td>{range(crops[c]?.rain_abs, "mm")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-micro text-mute">
        Source: {crops.paddy?.source ?? "FAO ECOCROP crop environmental requirements database"}.
        Rainfall is per growing season.
      </p>

      {calcRanges && <ScoreCalculator crops={calcRanges} />}

      <H2 id="data">2. Data sources</H2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-micro uppercase tracking-[0.06em] text-mute">
              <th className="py-2 pr-4 font-semibold">Dataset</th>
              <th className="py-2 pr-4 font-semibold">Used for</th>
              <th className="py-2 font-semibold">Period</th>
            </tr>
          </thead>
          <tbody>
            {(meta?.datasets ?? []).map((d) => (
              <tr key={d.name} className="border-b border-line align-top">
                <td className="py-2 pr-4">
                  {d.link ? (
                    <a
                      href={String(d.link)}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-amber"
                    >
                      {d.name}
                    </a>
                  ) : (
                    d.name
                  )}
                  {(d.ee_id ?? d.id) ? (
                    <div className="num text-micro text-mute">{String(d.ee_id ?? d.id)}</div>
                  ) : null}
                </td>
                <td className="py-2 pr-4 text-mute">{String(d.use ?? "")}</td>
                <td className="num py-2 text-mute">{String(d.period ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {models.length > 0 && (
        <p className="mt-4 text-mute">
          Climate projections are the mean of a <span className="num text-fg">{models.length}</span>
          -model CMIP6 ensemble (<span className="num text-sm">{models.join(", ")}</span>), the same
          models for both scenarios, averaged over {windows?.baseline ?? "2001–2020"} for the
          baseline and {windows?.y2050 ?? "2041–2060"} for “2050”.
        </p>
      )}
      {boundaries && (
        <p className="mt-3 text-sm text-mute">
          District boundaries: {boundaries.source}
          {boundaries.licence ? ` (${boundaries.licence})` : ""}
          {boundaries.district_count ? `, ${boundaries.district_count} districts` : ""}.{" "}
          {boundaries.note}
        </p>
      )}

      <H2 id="pipeline">3. From satellite grid to district plan</H2>
      <ol className="mt-4 space-y-3 text-mute">
        {[
          "Daily NEX-GDDP-CMIP6 grids (precipitation, mean and maximum temperature) are subset to the study region (Karnataka, Tamil Nadu, Kerala, Andhra Pradesh, Telangana and Goa) for June–October of every year, per model and scenario. Units are converted: kg m⁻² s⁻¹ × 86,400 = mm/day; K − 273.15 = °C.",
          "Grid cells are averaged per district, weighted by the area of each cell that falls inside the district.",
          "Per year: season rainfall total, season mean temperature and monsoon onset (first day after 1 June with ≥ 25 mm in 5 days and no 7-day dry spell in the following 21 days).",
          "Years are averaged into the climate windows, then the models are averaged.",
          "Scores, best crop, sowing-window shift (2050 onset − baseline onset) and rain-fed water gap (crop’s optimal minimum rain − 2050 season rain) are computed per district and written to static JSON.",
        ].map((step, i) => (
          <li key={i} className="flex gap-4">
            <span className="num text-fg">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <H2 id="results">4. What the model finds</H2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-micro uppercase tracking-[0.06em] text-mute">
              <th className="py-2 font-semibold">Crop</th>
              <th className="py-2 font-semibold">Scenario</th>
              <th className="py-2 text-right font-semibold">Districts losing</th>
              <th className="py-2 text-right font-semibold">Gaining</th>
              <th className="py-2 text-right font-semibold">Mean change (pts)</th>
            </tr>
          </thead>
          <tbody className="num">
            {findings.map((f) => (
              <tr key={`${f.crop}${f.scenario}`} className="border-b border-line">
                <td className="py-2 font-sans">{CROP_LABEL[f.crop]}</td>
                <td>{SCENARIO_LABEL[f.scenario]}</td>
                <td className="text-right">
                  {f.losing} / {f.total}
                </td>
                <td className="text-right">
                  {f.gaining} / {f.total}
                </td>
                <td className="text-right">
                  {f.meanChange > 0 ? "+" : f.meanChange < 0 ? "−" : ""}
                  {Math.abs(f.meanChange).toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-micro text-mute">
        Change = 2050 score − baseline score, per district. Computed from the same files the map
        reads.
      </p>

      <H2 id="validation">5. Validation</H2>
      {validation ? (
        <div className="mt-4 space-y-4 text-mute">
          {typeof validation.rain_model_vs_observed_r === "number" && (
            <p>
              <span className="text-fg">Modelled vs observed rainfall.</span> Across districts, the
              CMIP6 ensemble’s baseline kharif rainfall correlates with NASA POWER observed rainfall
              at Pearson r ={" "}
              <span className="num text-fg">{validation.rain_model_vs_observed_r.toFixed(2)}</span>
              {typeof validation.rain_model_minus_observed_mean_mm === "number" ? (
                <>
                  ; the model is{" "}
                  <span className="num text-fg">
                    {Math.abs(validation.rain_model_minus_observed_mean_mm).toFixed(0)} mm
                  </span>{" "}
                  {validation.rain_model_minus_observed_mean_mm < 0 ? "drier" : "wetter"} on average
                </>
              ) : null}
              .
            </p>
          )}
          {validation.per_crop_score_vs_ndvi_r && (
            <p>
              <span className="text-fg">Score vs observed greenness.</span> Baseline score against
              2001–2020 mean peak NDVI (MODIS MOD13Q1), per crop:{" "}
              {CROPS.filter(
                (c) => typeof validation.per_crop_score_vs_ndvi_r?.[c] === "number",
              ).map((c, i) => (
                <span key={c}>
                  {i > 0 ? ", " : ""}
                  {CROP_LABEL[c].toLowerCase()} r ={" "}
                  <span className="num text-fg">
                    {validation.per_crop_score_vs_ndvi_r?.[c].toFixed(2)}
                  </span>
                </span>
              ))}
              {typeof validation.pearson_r === "number" ? (
                <>
                  ; best-crop score r ={" "}
                  <span className="num text-fg">{validation.pearson_r.toFixed(2)}</span>
                  {validation.n ? ` (n = ${validation.n})` : ""}
                </>
              ) : null}
              . {validation.note}
            </p>
          )}
          <p>
            A climate-only score is not expected to match greenness closely: NDVI also reflects
            irrigation, forest cover and soils.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-mute">
          Baseline scores were checked against the known rain-fed paddy belt (coast and Malnad) and
          the dry north-east interior.
        </p>
      )}

      <H2 id="limits">6. Limitations</H2>
      <ul className="mt-4 space-y-2 text-mute">
        {(meta?.limitations?.length
          ? meta.limitations
          : [
              "Rain-fed only: irrigation is not modelled.",
              "District averages hide local variation.",
              "Crop ranges come from a global database, not local varieties.",
            ]
        ).map((l) => (
          <li key={l} className="flex gap-3">
            <span className="text-rust" aria-hidden>
              —
            </span>
            <span>{l}</span>
          </li>
        ))}
        <li className="flex gap-3">
          <span className="text-rust" aria-hidden>
            —
          </span>
          <span>
            Slider positions between the modelled windows are linear interpolation, shown for
            continuity, not separate model runs.
          </span>
        </li>
      </ul>

      <footer className="mt-16 border-t border-line pt-6 text-sm text-mute">
        Field Shift · built on open NASA data.{" "}
        <Link href="/map" className="text-fg underline underline-offset-2 hover:text-amber">
          Open the Shift Map
        </Link>
      </footer>
    </main>
  );
}
