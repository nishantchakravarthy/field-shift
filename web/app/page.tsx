import Link from "next/link";
import LandingBackdrop from "@/components/LandingBackdrop";
import { readFindings, readMeta, type Finding } from "@/lib/server-data";
import { CROPS, CROP_LABEL, SCENARIOS, SCENARIO_LABEL, SCENARIO_NOTE } from "@/lib/types";

/** The headline is chosen from the data: the crop × scenario with the most districts moving one way. */
function pickHeadline(findings: Finding[]): Finding | null {
  if (findings.length === 0) return null;
  const paddyHigh = findings.find((f) => f.crop === "paddy" && f.scenario === "ssp585");
  if (paddyHigh && paddyHigh.losing >= paddyHigh.total / 2) return paddyHigh;
  return [...findings].sort(
    (a, b) => Math.max(b.losing, b.gaining) - Math.max(a.losing, a.gaining),
  )[0];
}

const signed = (v: number, digits = 1) =>
  `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;

/** Districts losing (left, rust) and gaining (right, teal) around a shared zero line. */
function LoseGainBar({ f }: { f: Finding }) {
  return (
    <div
      className="grid grid-cols-[28px_1fr_28px] items-center gap-2"
      role="img"
      aria-label={`${f.losing} of ${f.total} districts lose, ${f.gaining} gain`}
    >
      <span className="num text-right text-sm text-fg">{f.losing}</span>
      <span className="relative block h-3">
        <span className="absolute inset-y-0 left-1/2 w-px bg-mute" />
        <span
          className="absolute inset-y-0 right-1/2 mr-px rounded-l-sm bg-rust"
          style={{ width: `${(f.losing / f.total) * 50}%` }}
        />
        <span
          className="absolute inset-y-0 left-1/2 ml-px rounded-r-sm bg-teal"
          style={{ width: `${(f.gaining / f.total) * 50}%` }}
        />
      </span>
      <span className="num text-sm text-fg">{f.gaining}</span>
    </div>
  );
}

const SCREENS = [
  {
    name: "Shift Map",
    text: "Every district as a column whose height and colour are its suitability score. Drag the slider from the 2001–2020 baseline to 2050 and the map reshapes itself.",
  },
  {
    name: "District X-Ray",
    text: "Click a district for its observed 20-year record of rainfall, crop greenness and land surface temperature, and where it sits on each crop’s tolerance curve.",
  },
  {
    name: "Adaptation Plan",
    text: "The highest-scoring crop today and in 2050, the shift in monsoon onset in weeks, the rain-fed water gap in millimetres, and the actions that follow from those numbers.",
  },
];

export default async function Landing() {
  const [findings, meta] = await Promise.all([readFindings(), readMeta()]);
  const f = pickHeadline(findings);
  const loses = f ? f.losing >= f.gaining : true;
  const count = f ? (loses ? f.losing : f.gaining) : 0;
  const datasets = meta?.datasets ?? [];
  const models = meta?.models ?? [];
  const credits = datasets.map((d) => d.name).slice(0, 6);

  return (
    <main className="bg-ink">
      <section className="relative h-screen min-h-[640px] w-full overflow-hidden">
        {f && <LandingBackdrop crop={f.crop} scenario={f.scenario} />}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, rgba(14,17,17,0.94) 0%, rgba(14,17,17,0.78) 38%, rgba(14,17,17,0) 68%)",
          }}
        />

        <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-8 py-6 max-md:px-4">
          <span className="text-base font-semibold tracking-tight">Field Shift</span>
          <nav className="flex gap-6 text-sm text-mute">
            <Link href="/map" className="hover:text-fg">
              Shift Map
            </Link>
            <Link href="/methodology" className="hover:text-fg">
              Methodology
            </Link>
          </nav>
        </header>

        <div className="absolute inset-y-0 left-0 z-10 flex w-full max-w-[720px] flex-col justify-center px-8 max-md:px-4">
          <p className="text-micro uppercase tracking-[0.12em] text-mute">
            {(meta?.region as string | undefined)?.replace(/, India$/, "") ?? "Karnataka"} · kharif
            season · 2001–2020 vs 2041–2060
          </p>
          {f ? (
            <h1 className="mt-4 text-hero font-semibold tracking-tight max-md:text-xl">
              <span className="num text-amber">
                {count} of {f.total}
              </span>{" "}
              districts {loses ? "lose" : "gain"} {CROP_LABEL[f.crop].toLowerCase()} suitability by
              2050.
            </h1>
          ) : (
            <h1 className="mt-4 text-hero font-semibold tracking-tight max-md:text-xl">
              Where South India’s crops can grow is moving.
            </h1>
          )}
          <p className="mt-6 max-w-[560px] text-lg text-mute">
            {f ? (
              <>
                Under {SCENARIO_LABEL[f.scenario]}, NASA’s downscaled climate projections change
                rain-fed {CROP_LABEL[f.crop].toLowerCase()} suitability by an average of{" "}
                <span className="num text-fg">{signed(f.meanChange)} points</span> across{" "}
                {f.total} districts.
                See which districts shift, why, and what to plant instead.
              </>
            ) : (
              "District-by-district crop suitability from NASA climate projections and satellite records."
            )}
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href="/map"
              className="rounded bg-amber px-6 py-3 text-base font-semibold text-ink transition-colors hover:bg-fg"
            >
              Explore the map
            </Link>
            <Link
              href="/map?story=1"
              className="flex items-center gap-2 rounded border border-line bg-ink/60 px-5 py-3 text-base text-fg hover:border-fg"
            >
              <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden>
                <path d="M0 0l10 6-10 6z" fill="currentColor" />
              </svg>
              Play the guided story
            </Link>
          </div>
        </div>

        <footer className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line bg-ink/80 px-8 py-4 text-micro text-mute max-md:px-4">
          <span className="uppercase tracking-[0.08em]">Data</span>
          {(credits.length ? credits : ["NASA NEX-GDDP-CMIP6", "NASA MODIS", "FAO ECOCROP"]).map(
            (c) => (
              <span key={c}>{c}</span>
            ),
          )}
          <a href="#numbers" className="ml-auto text-fg hover:text-amber max-md:hidden">
            The numbers ↓
          </a>
        </footer>
      </section>

      {findings.length > 0 && (
        <section id="numbers" className="mx-auto max-w-[1080px] scroll-mt-8 px-8 py-24 max-md:px-4">
          <p className="text-micro uppercase tracking-[0.12em] text-mute">The shift in numbers</p>
          <h2 className="mt-3 max-w-[760px] text-xl font-semibold">
            How many districts lose or gain suitability for each crop by 2050
          </h2>
          <div className="mt-10 grid gap-10 md:grid-cols-2">
            {SCENARIOS.map((sc) => (
              <div key={sc}>
                <h3 className="flex items-baseline justify-between border-b border-line pb-2">
                  <span className="num text-lg font-semibold">{SCENARIO_LABEL[sc]}</span>
                  <span className="text-micro text-mute">{SCENARIO_NOTE[sc]}</span>
                </h3>
                <div className="mt-3 grid grid-cols-[72px_1fr_92px] gap-x-4 text-micro uppercase tracking-[0.06em] text-mute">
                  <span>Crop</span>
                  <span className="flex justify-between px-9">
                    <span>← lose</span>
                    <span>gain →</span>
                  </span>
                  <span className="text-right">Mean change</span>
                </div>
                {CROPS.map((crop) => {
                  const row = findings.find((x) => x.crop === crop && x.scenario === sc);
                  return row ? (
                    <div
                      key={crop}
                      className="grid grid-cols-[72px_1fr_92px] items-center gap-x-4 border-b border-line py-3"
                    >
                      <span className="text-base">{CROP_LABEL[crop]}</span>
                      <LoseGainBar f={row} />
                      <span className="num text-right text-sm text-fg">
                        {signed(row.meanChange)} pts
                      </span>
                    </div>
                  ) : null;
                })}
              </div>
            ))}
          </div>
          <p className="mt-4 text-micro text-mute">
            Districts of {findings[0].total}, change in suitability score (0–100) between 2001–2020
            and 2041–2060. Source: NASA NEX-GDDP-CMIP6
            {models.length ? `, ${models.length}-model mean` : ""} × FAO ECOCROP crop ranges.
            Rain-fed only.
          </p>
        </section>
      )}

      <section className="border-t border-line">
        <div className="mx-auto grid max-w-[1080px] gap-10 px-8 py-24 max-md:px-4 md:grid-cols-3">
          {SCREENS.map((s, i) => (
            <div key={s.name}>
              <p className="num text-micro text-mute">0{i + 1}</p>
              <h3 className="mt-2 text-lg font-semibold">{s.name}</h3>
              <p className="mt-3 text-mute">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {datasets.length > 0 && (
        <section className="border-t border-line">
          <div className="mx-auto max-w-[1080px] px-8 py-24 max-md:px-4">
            <p className="text-micro uppercase tracking-[0.12em] text-mute">Traceable by design</p>
            <h2 className="mt-3 text-xl font-semibold">Every number comes from a named dataset</h2>
            <ul className="mt-8 grid gap-x-10 md:grid-cols-2">
              {datasets.map((d) => (
                <li key={d.name} className="border-b border-line py-3">
                  <div className="flex items-baseline justify-between gap-4">
                    {d.link ? (
                      <a
                        href={String(d.link)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-base underline decoration-line underline-offset-4 hover:text-amber"
                      >
                        {d.name}
                      </a>
                    ) : (
                      <span className="text-base">{d.name}</span>
                    )}
                    <span className="num shrink-0 text-micro text-mute">
                      {String(d.period ?? "")}
                    </span>
                  </div>
                  {d.use ? <p className="mt-1 text-sm text-mute">{String(d.use)}</p> : null}
                </li>
              ))}
            </ul>
            <Link
              href="/methodology"
              className="mt-8 inline-block text-sm text-fg underline underline-offset-4 hover:text-amber"
            >
              Formula, validation and limitations
            </Link>
          </div>
        </section>
      )}

      <footer className="border-t border-line px-8 py-8 text-micro text-mute max-md:px-4">
        <div className="mx-auto flex max-w-[1080px] flex-wrap justify-between gap-4">
          <span>Field Shift · built on open NASA data</span>
          <span className="flex gap-6">
            <Link href="/map" className="hover:text-fg">
              Shift Map
            </Link>
            <Link href="/map?story=1" className="hover:text-fg">
              Story
            </Link>
            <Link href="/methodology" className="hover:text-fg">
              Methodology
            </Link>
          </span>
        </div>
      </footer>
    </main>
  );
}
