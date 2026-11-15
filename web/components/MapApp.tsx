"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { getAllSuitability, getDistricts, getMeta, suitKey } from "@/lib/api";
import { computeCells, summarise } from "@/lib/model";
import { queryFromState, stateFromQuery, useStore } from "@/lib/store";
import { YEAR_MAX, YEAR_MIN } from "@/lib/scale";
import type { DistrictCollection, MetaFile, SuitabilityIndex } from "@/lib/types";
import Controls from "./Controls";
import DistrictPanel from "./DistrictPanel";
import DistrictSearch from "./DistrictSearch";
import Legend from "./Legend";
import StatePulse from "./StatePulse";
import Story from "./Story";
import TimeSlider from "./TimeSlider";

const ShiftMap = dynamic(() => import("./ShiftMap"), { ssr: false });

const PANEL_WIDTH = 420;
const LEFT_RAIL = 316;
const STORY_WIDTH = 380;

export default function MapApp() {
  const state = useStore();
  const { crop, scenario, year, districtId, mode, is3d, hoverId, story, bearing, swipe, split, set } =
    state;
  const [districts, setDistricts] = useState<DistrictCollection | null>(null);
  const [suit, setSuit] = useState<SuitabilityIndex | null>(null);
  const [meta, setMeta] = useState<MetaFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [wide, setWide] = useState(true);
  const [sheet, setSheet] = useState(false);

  // URL → state once, then state → URL
  useEffect(() => {
    set(stateFromQuery(new URLSearchParams(window.location.search)));
    setHydrated(true);
  }, [set]);

  useEffect(() => {
    if (!hydrated || state.playing) return;
    window.history.replaceState(null, "", `${window.location.pathname}?${queryFromState(state)}`);
  }, [hydrated, state]);

  useEffect(() => {
    Promise.all([getDistricts(), getAllSuitability()])
      .then(([d, s]) => {
        setDistricts(d);
        setSuit(s);
      })
      .catch(() => setFailed(true));
    getMeta()
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Keyboard: arrows step the year, Space plays, Esc closes the panel.
  // While the story runs it owns these keys (see Story.tsx).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const s = useStore.getState();
      if (s.story !== null) return;
      if (e.key === "Escape") s.set({ districtId: null });
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowRight" ? 1 : -1);
        s.set({
          year: Math.min(YEAR_MAX, Math.max(YEAR_MIN, Math.round(s.year) + step)),
          playing: false,
        });
      } else if (e.key === " " && el?.tagName !== "BUTTON") {
        e.preventDefault();
        s.set({ playing: !s.playing });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const names = useMemo(
    () =>
      Object.fromEntries(
        [...(districts?.features ?? [])]
          .sort((a, b) => a.properties.name.localeCompare(b.properties.name))
          .map((f) => [f.properties.id, f.properties.name]),
      ),
    [districts],
  );
  const ids = useMemo(() => Object.keys(names), [names]);
  const cells = useMemo(
    () => computeCells(suit, ids, crop, scenario, year, mode),
    [suit, ids, crop, scenario, year, mode],
  );
  // Start the swipe divider through the middle of the visible map area (right of the controls).
  useEffect(() => {
    if (!swipe) return;
    const w = window.innerWidth;
    set({ split: w >= 768 ? (LEFT_RAIL + 16 + w) / 2 / w : 0.5 });
  }, [swipe, set]);

  const swipeCells = useMemo(
    () =>
      swipe
        ? {
            left: computeCells(suit, ids, crop, scenario, YEAR_MIN, mode),
            right: computeCells(suit, ids, crop, scenario, YEAR_MAX, mode),
          }
        : null,
    [swipe, suit, ids, crop, scenario, mode],
  );
  // Districts scoring 50+ at every slider year, for the timeline sparkline.
  const series = useMemo(
    () =>
      suit
        ? Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) =>
            mode === "best" ? 0 : (summarise(suit, crop, scenario, YEAR_MIN + i)?.suitable ?? 0),
          )
        : undefined,
    [suit, crop, scenario, mode],
  );
  const rows = suit?.[suitKey(crop, scenario)];
  const hasMidWindow = useMemo(
    () => !!rows && Object.values(rows).some((r) => typeof r.y2030 === "number"),
    [rows],
  );

  const selectedName = districtId ? names[districtId] : undefined;
  const panelOpen = !!selectedName && !!suit;
  const shifted = panelOpen && wide;
  // The story caption sits in the right column, or in the bottom dock once the panel is open.
  const storySide = story !== null && wide && !panelOpen;
  const storyDock = story !== null && !storySide;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-ink">
      <h1 className="sr-only">Field Shift: South India crop suitability map, baseline to 2050</h1>

      {districts && hydrated && (
        <ShiftMap
          districts={districts}
          cells={cells}
          tweenKey={`${crop}|${scenario}|${mode}|${swipe ? "swipe" : "map"}`}
          is3d={is3d}
          selectedId={districtId}
          highlightId={hoverId}
          onSelect={(id) => set({ districtId: id })}
          padRight={shifted ? PANEL_WIDTH : storySide ? STORY_WIDTH + 16 : 0}
          padBottom={storyDock && wide ? 260 : 0}
          bearing={bearing}
          swipe={swipeCells}
          split={split}
          onSplit={(f) => set({ split: f })}
        />
      )}

      {!districts && !failed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-[320px] space-y-3" aria-busy="true" aria-label="Loading map data">
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton h-40 w-full" />
            <div className="skeleton h-4 w-3/4" />
          </div>
        </div>
      )}

      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-md rounded border border-line bg-panel p-6">
            <h2 className="text-lg font-semibold">Map data could not be loaded</h2>
            <p className="mt-2 text-sm text-mute">
              Neither the API nor the bundled data files responded. Reload the page to try again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded border border-line px-4 py-2 text-sm hover:border-amber"
            >
              Reload
            </button>
          </div>
        </div>
      )}

      {/* Left rail */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-col gap-3 max-md:right-4 [&>*]:pointer-events-auto">
        <div className="flex w-[300px] items-center justify-between gap-3 rounded border border-line bg-panel px-4 py-2.5 max-md:w-full">
          <Link
            href="/"
            className="text-base font-semibold tracking-tight text-fg hover:text-amber"
          >
            Field Shift
          </Link>
          <div className="flex items-center gap-3">
            {suit && story === null && (
              <button
                type="button"
                onClick={() => set({ story: 0 })}
                className="flex items-center gap-1.5 rounded border border-line px-2.5 py-1 text-sm text-fg hover:border-amber"
              >
                <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden>
                  <path d="M0 0l9 5-9 5z" fill="currentColor" />
                </svg>
                Story
              </button>
            )}
            <button
              type="button"
              onClick={() => setSheet((v) => !v)}
              aria-expanded={sheet}
              className="rounded border border-line px-2.5 py-1 text-sm text-fg md:hidden"
            >
              Layers
            </button>
            <Link href="/methodology" className="text-sm text-mute hover:text-fg max-md:hidden">
              Method
            </Link>
          </div>
        </div>
        <div className={sheet ? "flex flex-col gap-3" : "flex flex-col gap-3 max-md:hidden"}>
          <Controls />
          {suit && <StatePulse suit={suit} names={names} />}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 z-10 max-lg:hidden [&>*]:pointer-events-auto">
        <Legend />
      </div>

      {/* Right: quick jump, replaced by the district panel once one is selected */}
      {suit && storySide && (
        <div className="absolute right-4 top-4 z-10">
          <Story suit={suit} names={names} width={STORY_WIDTH} />
        </div>
      )}
      {suit && districts && !panelOpen && story === null && (
        <div className="absolute right-4 top-4 z-10 max-md:hidden">
          <DistrictSearch suit={suit} names={names} />
          <p className="mt-2 text-right text-micro text-mute">
            Click a district for its 20-year record and adaptation plan
          </p>
        </div>
      )}

      {/* Bottom dock: story caption and time slider */}
      <div
        className={`pointer-events-none absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-3 [&>*]:pointer-events-auto ${
          panelOpen && !wide ? "hidden" : ""
        }`}
        style={{
          marginLeft: shifted
            ? (LEFT_RAIL - PANEL_WIDTH) / 2
            : storySide
              ? (LEFT_RAIL - STORY_WIDTH - 16) / 2
              : wide
                ? LEFT_RAIL / 4
                : 0,
        }}
      >
        {suit && storyDock && <Story suit={suit} names={names} width={shifted ? 500 : 560} />}
        {swipe ? (
          <div className="rounded border border-line bg-panel/95 px-4 py-3 text-sm shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur">
            <span className="text-fg">Drag the divider</span>
            <span className="text-mute">
              {" "}
              to compare the 2001–2020 baseline (left) with 2050 (right).{" "}
            </span>
            <button
              type="button"
              onClick={() => set({ swipe: false })}
              className="ml-1 rounded border border-line px-2 py-0.5 text-micro text-fg hover:border-amber"
            >
              Back to timeline
            </button>
          </div>
        ) : (
          <TimeSlider
            hasMidWindow={hasMidWindow}
            compact={shifted}
            series={mode === "best" ? undefined : series}
            total={ids.length}
          />
        )}
      </div>

      <AnimatePresence>
        {panelOpen && selectedName && suit && districtId && (
          <DistrictPanel key="panel" id={districtId} name={selectedName} suit={suit} meta={meta} />
        )}
      </AnimatePresence>
    </main>
  );
}
