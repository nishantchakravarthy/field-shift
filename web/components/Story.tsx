"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildStory } from "@/lib/story";
import { useStore } from "@/lib/store";
import type { SuitabilityIndex } from "@/lib/types";

/** Guided tour of the findings: one click runs the whole demo. */
export default function Story({
  suit,
  names,
  width,
}: {
  suit: SuitabilityIndex;
  names: Record<string, string>;
  width: number;
}) {
  const story = useStore((s) => s.story);
  const scenario = useStore((s) => s.scenario);
  const set = useStore((s) => s.set);
  const [paused, setPaused] = useState(false);
  const chapters = useMemo(() => buildStory(suit, names, scenario), [suit, names, scenario]);
  const index = story === null ? -1 : Math.min(story, chapters.length - 1);
  const chapter = index >= 0 ? chapters[index] : null;
  const last = index === chapters.length - 1;

  const exit = useCallback(() => set({ story: null, playing: false, bearing: null }), [set]);
  const go = useCallback(
    (to: number) => set({ story: Math.max(0, Math.min(chapters.length - 1, to)) }),
    [set, chapters.length],
  );

  // Apply the chapter's view when it becomes active.
  useEffect(() => {
    if (chapter) set(chapter.patch);
    // Only the chapter index should re-apply the view, not edits made while it is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, chapters.length]);

  // Auto-advance
  useEffect(() => {
    if (!chapter || paused || last) return;
    const timer = setTimeout(() => go(index + 1), chapter.ms);
    return () => clearTimeout(timer);
  }, [chapter, paused, last, index, go]);

  // Keyboard: arrows change chapter, Space pauses, Esc leaves the story.
  useEffect(() => {
    if (index < 0) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "INPUT") return;
      if (e.key === "Escape") exit();
      else if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === " " && el?.tagName !== "BUTTON") setPaused((p) => !p);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go, exit]);

  if (!chapter) return null;

  const button =
    "rounded border border-line px-3 py-1.5 text-sm text-mute hover:border-amber hover:text-fg disabled:opacity-40 disabled:hover:border-line disabled:hover:text-mute";

  return (
    <section
      className="rounded border border-line bg-panel p-4"
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      aria-label="Guided story"
      aria-live="polite"
    >
      <div className="flex gap-1" aria-hidden>
        {chapters.map((c, i) => (
          <span key={c.title} className="h-0.5 flex-1 overflow-hidden rounded-full bg-line">
            <span
              key={`${i}-${index}-${paused}`}
              className="block h-full bg-amber"
              style={
                i < index || (i === index && (last || paused))
                  ? { width: "100%" }
                  : i === index
                    ? { animation: `story-fill ${c.ms}ms linear forwards` }
                    : { width: 0 }
              }
            />
          </span>
        ))}
      </div>
      <p className="num mt-3 text-micro uppercase tracking-[0.08em] text-mute">
        Story · {index + 1} of {chapters.length}
      </p>
      <h2 className="mt-1 text-lg font-semibold text-fg">{chapter.title}</h2>
      <p className="mt-1 text-base text-mute">
        {chapter.body.map((seg, i) =>
          seg.num ? (
            <span key={i} className="num text-fg">
              {seg.t}
            </span>
          ) : (
            <span key={i}>{seg.t}</span>
          ),
        )}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className={button}
          onClick={() => go(index - 1)}
          disabled={index === 0}
        >
          Back
        </button>
        {!last && (
          <button type="button" className={button} onClick={() => setPaused((p) => !p)}>
            {paused ? "Resume" : "Pause"}
          </button>
        )}
        {!last && (
          <button type="button" className={button} onClick={() => go(index + 1)}>
            Next
          </button>
        )}
        <button
          type="button"
          onClick={exit}
          className={
            last
              ? "ml-auto rounded bg-amber px-4 py-1.5 text-sm font-semibold text-ink hover:bg-fg"
              : `${button} ml-auto`
          }
        >
          {last ? "Explore the map yourself" : "Exit story (Esc)"}
        </button>
      </div>
    </section>
  );
}
