"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { getDistricts, getSuitability, suitKey } from "@/lib/api";
import { computeCells } from "@/lib/model";
import { YEAR_MAX, YEAR_MIN, yearLabel } from "@/lib/scale";
import type { Crop, DistrictCollection, Scenario, SuitabilityIndex } from "@/lib/types";

const ShiftMap = dynamic(() => import("./ShiftMap"), { ssr: false });

const LOOP_MS = 9000;

/** Ambient preview: the Shift Map looping baseline → 2050. */
export default function LandingBackdrop({ crop, scenario }: { crop: Crop; scenario: Scenario }) {
  const [districts, setDistricts] = useState<DistrictCollection | null>(null);
  const [suit, setSuit] = useState<SuitabilityIndex | null>(null);
  const [year, setYear] = useState(YEAR_MIN);

  useEffect(() => {
    getDistricts()
      .then(setDistricts)
      .catch(() => undefined);
    getSuitability(crop, scenario)
      .then((f) =>
        setSuit({
          [suitKey(crop, scenario)]: Object.fromEntries(f.districts.map((d) => [d.id, d])),
        }),
      )
      .catch(() => undefined);
  }, [crop, scenario]);

  useEffect(() => {
    let raf = 0;
    const start = performance.now() + 3400; // let the fly-in finish first
    const tick = (now: number) => {
      const t = Math.max(0, now - start) % LOOP_MS;
      // hold at baseline, sweep to 2050, hold, then restart
      const lin = Math.min(1, Math.max(0, (t / LOOP_MS - 0.15) / 0.55));
      const p = lin * lin * (3 - 2 * lin); // ease in and out
      setYear(YEAR_MIN + (YEAR_MAX - YEAR_MIN) * p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);

  const ids = useMemo(() => districts?.features.map((f) => f.properties.id) ?? [], [districts]);
  const cells = useMemo(
    () => computeCells(suit, ids, crop, scenario, year, "score"),
    [suit, ids, crop, scenario, year],
  );

  return (
    <div className="absolute inset-0" aria-hidden>
      {districts && (
        <ShiftMap
          districts={districts}
          cells={cells}
          tweenKey={`${crop}|${scenario}`}
          is3d
          ambient
        />
      )}
      <div className="num absolute bottom-20 right-8 z-10 text-right max-md:hidden">
        <div className="text-micro uppercase tracking-[0.08em] text-mute">Climate window</div>
        <div className="text-xl font-semibold text-fg">{yearLabel(year)}</div>
      </div>
    </div>
  );
}
