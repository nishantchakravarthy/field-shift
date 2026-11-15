"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { suitKey } from "@/lib/api";
import { signed } from "@/lib/scale";
import { useStore } from "@/lib/store";
import { CROP_LABEL, SCENARIO_LABEL, type SuitabilityIndex } from "@/lib/types";

/** Quick jump: every district, ranked by 2050 change for the current crop, filterable. */
export default function DistrictSearch({
  suit,
  names,
}: {
  suit: SuitabilityIndex;
  names: Record<string, string>;
}) {
  const { crop, scenario, set } = useStore();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const ranked = useMemo(() => {
    const rows = suit[suitKey(crop, scenario)] ?? {};
    return Object.keys(names)
      .map((id) => ({ id, name: names[id], row: rows[id] }))
      .sort((a, b) => (a.row?.change ?? 0) - (b.row?.change ?? 0))
      .map((d, i) => ({ ...d, rank: i + 1 }));
  }, [suit, crop, scenario, names]);

  const q = query.trim().toLowerCase();
  const shown = q ? ranked.filter((d) => d.name.toLowerCase().includes(q)) : ranked;

  // "/" focuses the search from anywhere on the map page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "/" && el?.tagName !== "INPUT") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setCursor(0);
    set({ hoverId: null });
  };
  const choose = (id: string) => {
    set({ districtId: id, hoverId: null });
    setOpen(false);
    setQuery("");
    input.current?.blur();
  };

  return (
    <div
      className="relative w-[300px]"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <div className="flex items-center gap-2 rounded border border-line bg-panel px-3 py-2.5">
        <svg width="14" height="14" viewBox="0 0 14 14" className="text-mute" aria-hidden>
          <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(shown.length - 1, c + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === "Enter" && shown[cursor]) {
              e.preventDefault();
              choose(shown[cursor].id);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              close();
              input.current?.blur();
            }
          }}
          role="combobox"
          aria-expanded={open}
          aria-controls="district-list"
          aria-autocomplete="list"
          aria-label="Find a district"
          placeholder="Find a district"
          className="min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-mute focus:outline-none"
        />
        <kbd className="num rounded-sm border border-line px-1.5 text-micro text-mute">/</kbd>
      </div>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 rounded border border-line bg-panel">
          <div className="flex justify-between border-b border-line px-3 py-2 text-micro text-mute">
            <span>
              Ranked by {CROP_LABEL[crop].toLowerCase()} change, {SCENARIO_LABEL[scenario]}
            </span>
            <span>2001–20 → 2050</span>
          </div>
          {shown.length === 0 ? (
            <p className="px-3 py-4 text-sm text-mute">No district matches “{query}”.</p>
          ) : (
            <ul
              ref={list}
              id="district-list"
              role="listbox"
              className="thin-scroll max-h-[46vh] overflow-y-auto py-1"
            >
              {shown.map((d, i) => (
                <li
                  key={d.id}
                  role="option"
                  aria-selected={i === cursor}
                  tabIndex={-1}
                  onPointerEnter={() => {
                    setCursor(i);
                    set({ hoverId: d.id });
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(d.id)}
                  className={`grid cursor-pointer grid-cols-[24px_1fr_auto_44px] items-center gap-2 px-3 py-1.5 text-sm ${
                    i === cursor ? "bg-ink text-fg" : "text-mute"
                  }`}
                >
                  <span className="num text-micro">{d.rank}</span>
                  <span className="truncate text-fg">{d.name}</span>
                  <span className="num text-micro">
                    {d.row ? `${d.row.baseline} → ${d.row.y2050}` : "—"}
                  </span>
                  <span className="num text-right text-fg">
                    {d.row ? signed(d.row.change) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
