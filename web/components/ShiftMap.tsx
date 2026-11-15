"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { GeoJsonLayer, PathLayer, TextLayer } from "@deck.gl/layers";
import { AmbientLight, DirectionalLight, LightingEffect } from "@deck.gl/core";
import type { PickingInfo } from "@deck.gl/core";
import { ClipExtension, CollisionFilterExtension } from "@deck.gl/extensions";
import type { ClipExtensionProps, CollisionFilterExtensionProps } from "@deck.gl/extensions";
import type { DistrictCollection, DistrictProps, StateCollection } from "@/lib/types";
import { getStates } from "@/lib/api";
import { NO_DATA } from "@/lib/scale";
import type { Cell } from "@/lib/model";

type Feature = DistrictCollection["features"][number];
type RGBA = [number, number, number, number];
/** What is currently drawn for one district: column height (m), fill, hover/selection lift (m), dimming 0–1. */
type Shown = { e: number; c: RGBA; l: number; d: number };

const TWEEN_MS = 700;
const ELEVATION_PER_POINT = 550; // metres per suitability point for a region ~7 degrees across (Karnataka)
const LIFT_HOVER = 2200; // metres a hovered district rises (same reference size)
const LIFT_SELECTED = 3800; // metres the selected district rises (same reference size)
const REFERENCE_SPAN_DEG = 7;
const INTRO_SPREAD_MS = 1300; // south-to-north rise when the map first appears
const SWITCH_SPREAD_MS = 420; // outward ripple when crop, scenario or mode changes
const RIPPLE = { amp: 5200, speed: 5.5, width: 1.1, decay: 1.7, life: 2200 }; // m, deg/s, deg, 1/s, ms
const INK: [number, number, number] = [14, 17, 17];
const LEFT_RAIL = 316; // px taken by the control column on wide screens
type Bounds = [[number, number], [number, number]];

/** Bounding box of every district, in degrees. */
function boundsOf(fc: { features: { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }[] }): Bounds {
  let x0 = 180;
  let y0 = 90;
  let x1 = -180;
  let y1 = -90;
  for (const f of fc.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys)
      for (const [x, y] of poly[0]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  }
  return [
    [x0, y0],
    [x1, y1],
  ];
}

/** Camera that frames the whole region for the current viewport, flat or pitched. */
function viewFor(
  map: maplibregl.Map,
  bounds: Bounds,
  is3d: boolean,
  padRight = 0,
  ambient = false,
  padBottom = 0,
) {
  const narrow = map.getContainer().clientWidth < 768;
  const width = map.getContainer().clientWidth;
  const cam = map.cameraForBounds(bounds, {
    padding: ambient
      ? { top: 90, bottom: 150, left: narrow ? 16 : Math.round(width * 0.36), right: 60 }
      : {
          top: narrow ? 70 : 40,
          bottom: (narrow ? 150 : 140) + padBottom,
          left: narrow ? 16 : 330,
          right: 16 + padRight,
        },
  });
  const center = cam?.center ?? { lng: 76.25, lat: 15 };
  const zoom = cam?.zoom ?? 6.2;
  return is3d
    ? { center, zoom: zoom + 0.12, pitch: 50, bearing: -14 }
    : { center, zoom, pitch: 0, bearing: 0 };
}

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0E1111" } },
    {
      id: "imagery",
      type: "raster",
      source: "imagery",
      paint: { "raster-brightness-max": 0.42, "raster-saturation": -0.35, "raster-contrast": 0.08 },
    },
  ],
};

/**
 * Soft light from the south-west and above. Column tops receive ~1.0 total light,
 * so they still match the legend; the sides fall into shade and give the columns depth.
 */
const LIGHTING = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 0.74 }),
  sun: new DirectionalLight({ color: [255, 244, 228], intensity: 0.32, direction: [-1, -2, -3] }),
});
const MATERIAL = { ambient: 1, diffuse: 1, shininess: 24, specularColor: [26, 26, 26] as [number, number, number] };

function outerRings(f: Feature): number[][][] {
  return f.geometry.type === "Polygon"
    ? [f.geometry.coordinates[0]]
    : f.geometry.coordinates.map((p) => p[0]);
}

function ringCentroid(ring: number[][]): { c: [number, number]; area: number } {
  let a = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const k = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += k;
    x += (ring[j][0] + ring[i][0]) * k;
    y += (ring[j][1] + ring[i][1]) * k;
  }
  if (a === 0) return { c: [ring[0][0], ring[0][1]], area: 0 };
  return { c: [x / (3 * a), y / (3 * a)], area: Math.abs(a / 2) };
}

function centroid(f: Feature): [number, number] {
  let best = { c: [0, 0] as [number, number], area: -1 };
  for (const ring of outerRings(f)) {
    const r = ringCentroid(ring);
    if (r.area > best.area) best = r;
  }
  return best.c;
}

// The map always animates: Play is a deliberate action, and Windows' "Animation effects"
// setting (which turns on prefers-reduced-motion) otherwise freezes the whole demo.
const reducedMotion = () => false;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export interface ShiftMapProps {
  districts: DistrictCollection;
  /** One cell per district for the current frame; undefined while data loads. */
  cells: Record<string, Cell> | undefined;
  /** Changes when the encoding changes (crop, scenario, mode): triggers a tween. */
  tweenKey: string;
  is3d: boolean;
  selectedId?: string | null;
  /** District highlighted from outside the map (list or chart hover). */
  highlightId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Non-interactive backdrop (landing page). */
  ambient?: boolean;
  /** Right-hand space covered by the district panel, in px. */
  padRight?: number;
  /** Extra space at the bottom covered by the story caption, in px. */
  padBottom?: number;
  /** Camera bearing requested from outside (story chapters), degrees. */
  bearing?: number | null;
  /** Before/after swipe: baseline cells left of the divider, 2050 cells right of it. */
  swipe?: { left: Record<string, Cell> | undefined; right: Record<string, Cell> | undefined } | null;
  /** Divider position as a fraction of the map width. */
  split?: number;
  onSplit?: (fraction: number) => void;
}

export default function ShiftMap({
  districts,
  cells,
  tweenKey,
  is3d,
  selectedId = null,
  highlightId = null,
  onSelect,
  ambient = false,
  padRight = 0,
  padBottom = 0,
  bearing = null,
  swipe = null,
  split = 0.5,
  onSplit,
}: ShiftMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [ready, setReady] = useState(false);
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    id: string;
    name: string;
    state?: string;
  } | null>(null);
  const [splitLng, setSplitLng] = useState<number | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const swiping = !!swipe && !ambient;
  /** Columns are drawn only in 3D; the swipe view is always a flat, north-up map. */
  const d3 = is3d && !swiping;

  const centroids = useMemo(
    () => Object.fromEntries(districts.features.map((f) => [f.properties.id, centroid(f)])),
    [districts],
  );
  const bounds = useMemo(() => boundsOf(districts), [districts]);
  const centre = useMemo<[number, number]>(
    () => [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2],
    [bounds],
  );
  /** Heights grow with the region so columns keep their proportions when zoomed out. */
  const heightScale = useMemo(
    () =>
      Math.max(1, Math.max(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1]) / REFERENCE_SPAN_DEG),
    [bounds],
  );

  // State outlines and names (present when the data covers more than one state).
  const [states, setStates] = useState<StateCollection | null>(null);
  useEffect(() => {
    let live = true;
    getStates().then((s) => {
      if (live && s && s.features.length > 1) setStates(s);
    });
    return () => {
      live = false;
    };
  }, []);
  const stateLabels = useMemo(
    () =>
      (states?.features ?? []).map((f) => ({
        name: f.properties.name,
        c: centroid(f as unknown as Feature),
      })),
    [states],
  );

  /** Where the camera should rest for the current props. */
  const cameraTarget = (map: maplibregl.Map) => {
    const base = viewFor(map, bounds, d3, padRight, ambient, padBottom);
    const c = selectedId && !ambient ? centroids[selectedId] : undefined;
    const narrow = map.getContainer().clientWidth < 768;
    if (!c)
      return {
        ...base,
        bearing: d3 ? (bearing ?? base.bearing) : 0,
        offset: [0, 0] as [number, number],
      };
    return {
      center: { lng: c[0], lat: c[1] },
      zoom: base.zoom + 0.45,
      pitch: d3 ? 54 : 0,
      bearing: d3 ? (bearing ?? map.getBearing()) : 0,
      offset: (narrow ? [0, -120] : [(LEFT_RAIL - padRight) / 2, 30 - padBottom / 2]) as [
        number,
        number,
      ],
    };
  };
  const cameraTargetRef = useRef(cameraTarget);
  cameraTargetRef.current = cameraTarget;

  // Map + overlay lifecycle
  useEffect(() => {
    if (!container.current) return;
    const still = reducedMotion();
    const map = new maplibregl.Map({
      container: container.current,
      style: STYLE,
      center: [78.5, 17],
      zoom: 4.2,
      minZoom: 4,
      maxZoom: 10,
      maxPitch: 70,
      interactive: !ambient,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    if (!ambient) {
      // Compass (shows bearing and pitch; click to face north) and a metric scale bar.
      map.addControl(
        new maplibregl.NavigationControl({ showZoom: true, showCompass: true, visualizePitch: true }),
        "bottom-right",
      );
      map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-right");
    }
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay);
    mapRef.current = map;
    overlayRef.current = overlay;

    map.once("load", () => {
      setReady(true);
      const target = cameraTargetRef.current(map);
      if (still) map.jumpTo(target);
      else map.flyTo({ ...target, duration: 3000, curve: 1.3, essential: true });
    });
    // Fonts for the deck.gl label atlas must be loaded before the atlas is drawn.
    const family = getComputedStyle(document.body).getPropertyValue("--font-plex-sans").trim();
    if (family && document.fonts?.load) {
      document.fonts
        .load(`600 12px ${family}`)
        .then(() => setFontFamily(family))
        .catch(() => setFontFamily("sans-serif"));
    } else {
      setFontFamily("sans-serif");
    }

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // The map is created once; view changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lighting only in 3D: flat maps stay unlit so fills match the legend exactly.
  useEffect(() => {
    if (!ready) return;
    overlayRef.current?.setProps({ effects: d3 ? [LIGHTING] : [] });
  }, [d3, ready]);

  // Camera: state view, or a closer look at the selected district
  const firstView = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (firstView.current) {
      firstView.current = false; // the load handler has already started the fly-in
      return;
    }
    map.easeTo({
      ...cameraTargetRef.current(map),
      duration: reducedMotion() ? 0 : 1100,
      essential: true,
    });
  }, [d3, padRight, padBottom, selectedId, bearing, ready, bounds]);

  // Swipe divider: the longitude under the divider, kept in step with pans and zooms.
  const splitRef = useRef(split);
  splitRef.current = split;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !swiping) {
      setSplitLng(null);
      return;
    }
    const update = () => {
      const w = map.getContainer().clientWidth;
      const h = map.getContainer().clientHeight;
      setSplitLng(map.unproject([splitRef.current * w, h / 2]).lng);
    };
    update();
    map.on("move", update);
    map.on("resize", update);
    return () => {
      map.off("move", update);
      map.off("resize", update);
    };
  }, [ready, swiping, split]);

  // Layers. Values are animated here in JS (a few dozen districts) rather than with
  // deck.gl attribute transitions, so slider, playback, crop switches, hover lift and
  // click ripples share one path.
  const shown = useRef<Record<string, Shown>>({});
  const tween = useRef<{
    from: Record<string, Shown>;
    start: number;
    delay: Record<string, number>;
  } | null>(null);
  const ripples = useRef<{ c: [number, number]; t0: number }[]>([]);
  const lastKey = useRef("");
  const frame = useRef(0);
  const raf = useRef(0);
  const kick = useRef<() => void>(() => {});
  const hoverId = hover?.id ?? null;

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !ready) return;
    const still = reducedMotion();

    const target = (id: string): { e: number; c: RGBA } => {
      const cell = cells?.[id];
      if (!cell || cell.score === null) return { e: 0, c: [...NO_DATA, 200] };
      return { e: d3 ? cell.score * ELEVATION_PER_POINT * heightScale : 0, c: [...cell.color, 235] };
    };
    const liftOf = (id: string) =>
      !d3 || ambient
        ? 0
        : (id === selectedId ? LIFT_SELECTED : id === hoverId || id === highlightId ? LIFT_HOVER : 0) *
          heightScale;
    const dimOf = (id: string) => (selectedId && !ambient && id !== selectedId ? 1 : 0);

    const key = `${tweenKey}|${d3}|${cells ? 1 : 0}`;
    if (key !== lastKey.current) {
      const intro = Object.keys(shown.current).length === 0 || !lastKey.current.endsWith("|1");
      lastKey.current = key;
      if (still) tween.current = null;
      else {
        // Intro: districts rise south to north. Later switches ripple outward from the centre.
        const lats = districts.features.map((f) => centroids[f.properties.id][1]);
        const lo = Math.min(...lats);
        const hi = Math.max(...lats);
        const delay: Record<string, number> = {};
        for (const f of districts.features) {
          const [x, y] = centroids[f.properties.id];
          delay[f.properties.id] = intro
            ? ((y - lo) / Math.max(0.1, hi - lo)) * INTRO_SPREAD_MS
            : (Math.hypot(x - centre[0], y - centre[1]) / (4.5 * heightScale)) * SWITCH_SPREAD_MS;
        }
        tween.current = { from: { ...shown.current }, start: performance.now(), delay };
      }
    }

    const ripple = (id: string, now: number) => {
      if (!d3 || still || ambient) return 0;
      const c = centroids[id];
      let sum = 0;
      for (const r of ripples.current) {
        const age = (now - r.t0) / 1000;
        const dist = Math.hypot(c[0] - r.c[0], c[1] - r.c[1]);
        const front = age * RIPPLE.speed * heightScale - dist;
        if (front > 0 && front < RIPPLE.width * 3) {
          sum +=
            Math.sin((front / RIPPLE.width) * Math.PI) *
            RIPPLE.amp *
            heightScale *
            Math.exp(-age * RIPPLE.decay) *
            Math.exp(-dist / (6 * heightScale));
        }
      }
      return sum;
    };

    const dimmed = (c: RGBA, d: number): RGBA =>
      d <= 0.001
        ? c
        : [
            Math.round(c[0] + (INK[0] - c[0]) * 0.55 * d),
            Math.round(c[1] + (INK[1] - c[1]) * 0.55 * d),
            Math.round(c[2] + (INK[2] - c[2]) * 0.55 * d),
            c[3],
          ];

    const tooltipHandlers = {
      onHover: (info: PickingInfo<Feature>) => {
        const map = mapRef.current;
        if (map) map.getCanvas().style.cursor = info.object ? "pointer" : "";
        setHover(
          info.object
            ? {
                x: info.x,
                y: info.y,
                id: info.object.properties.id,
                name: info.object.properties.name,
                state: info.object.properties.state,
              }
            : null,
        );
      },
      onClick: (info: PickingInfo<Feature>) => {
        if (!info.object) return;
        const id = info.object.properties.id;
        ripples.current.push({ c: centroids[id], t0: performance.now() });
        kick.current();
        onSelectRef.current?.(id);
      },
    };

    const build = (v: Record<string, Shown>, rip: Record<string, number>, trigger: number) => {
      const elevation = (id: string) => (v[id]?.e ?? 0) + (v[id]?.l ?? 0) + (rip[id] ?? 0);
      const fill = (id: string) =>
        v[id] ? dimmed(v[id].c, v[id].d) : ([...NO_DATA, 200] as RGBA);
      const outline = (id: string | null, lift: number) =>
        districts.features
          .filter((f) => f.properties.id === id)
          .flatMap((f) => {
            const z = elevation(f.properties.id) + lift;
            return outerRings(f).map((ring) => ({ path: ring.map(([x, y]) => [x, y, z]) }));
          });

      const swipeLayer = (side: "left" | "right") => {
        const src = swipe?.[side];
        const lng = splitLng ?? 0;
        return new GeoJsonLayer<DistrictProps, ClipExtensionProps>({
          id: `swipe-${side}`,
          data: districts,
          filled: true,
          extruded: false,
          stroked: true,
          getFillColor: (f): RGBA => {
            const cell = src?.[f.properties.id];
            return cell && cell.score !== null
              ? [cell.color[0], cell.color[1], cell.color[2], 235]
              : [NO_DATA[0], NO_DATA[1], NO_DATA[2], 200];
          },
          getLineColor: [14, 17, 17, 255],
          getLineWidth: 1,
          lineWidthUnits: "pixels",
          pickable: true,
          autoHighlight: true,
          highlightColor: [232, 230, 225, 46],
          extensions: [new ClipExtension()],
          clipBounds: side === "left" ? [-180, -90, lng, 90] : [lng, -90, 180, 90],
          updateTriggers: { getFillColor: [src, trigger] },
          ...tooltipHandlers,
        });
      };

      const districtLayers = swiping
        ? [swipeLayer("left"), swipeLayer("right")]
        : [
            new GeoJsonLayer<DistrictProps>({
              id: "districts",
              data: districts,
              filled: true,
              extruded: d3,
              wireframe: d3,
              stroked: !d3,
              getFillColor: (f) => fill(f.properties.id),
              getElevation: (f) => elevation(f.properties.id),
              getLineColor: d3 ? [10, 12, 12, 150] : [14, 17, 17, 255],
              getLineWidth: 1,
              lineWidthUnits: "pixels",
              material: d3 ? MATERIAL : false,
              pickable: !ambient,
              autoHighlight: !ambient,
              highlightColor: [232, 230, 225, 40],
              updateTriggers: { getFillColor: trigger, getElevation: trigger },
              ...tooltipHandlers,
            }),
          ];

      return [
        ...districtLayers,
        new PathLayer<{ path: number[][] }>({
          id: "highlight-outline",
          data:
            !swiping && highlightId && highlightId !== selectedId ? outline(highlightId, 60) : [],
          getPath: (d) => d.path as [number, number, number][],
          getColor: [232, 230, 225, 255],
          getWidth: 2,
          widthUnits: "pixels",
          jointRounded: true,
          capRounded: true,
          parameters: { depthCompare: "always" },
        }),
        new PathLayer<{ path: number[][] }>({
          id: "selected-glow",
          data: swiping ? [] : outline(selectedId, 60),
          getPath: (d) => d.path as [number, number, number][],
          getColor: [224, 164, 58, 70],
          getWidth: 11,
          widthUnits: "pixels",
          jointRounded: true,
          capRounded: true,
          parameters: { depthCompare: "always" },
          updateTriggers: { getPath: trigger },
        }),
        new PathLayer<{ path: number[][] }>({
          id: "selected-outline",
          data: swiping ? [] : outline(selectedId, 60),
          getPath: (d) => d.path as [number, number, number][],
          getColor: [240, 182, 78, 255],
          getWidth: 3,
          widthUnits: "pixels",
          jointRounded: true,
          capRounded: true,
          parameters: { depthCompare: "always" },
          updateTriggers: { getPath: trigger },
        }),
        new PathLayer<{ path: number[][] }>({
          id: "state-outlines",
          data: (states?.features ?? []).flatMap((f) =>
            outerRings(f as unknown as Feature).map((ring) => ({ path: ring })),
          ),
          getPath: (d) => d.path as [number, number][],
          getColor: [232, 230, 225, d3 ? 120 : 210],
          getWidth: d3 ? 1.5 : 2,
          widthUnits: "pixels",
          jointRounded: true,
          parameters: { depthCompare: d3 ? "always" : "less-equal" },
          updateTriggers: { getColor: d3, getWidth: d3 },
        }),
        ...(fontFamily && stateLabels.length > 0
          ? [
              new TextLayer<{ name: string; c: [number, number] }>({
                id: "state-labels",
                data: stateLabels,
                getText: (d) => d.name.toUpperCase(),
                getPosition: (d) => [d.c[0], d.c[1], d3 ? 70000 * heightScale : 0],
                getSize: ambient ? 13 : 15,
                getColor: [232, 230, 225, ambient ? 150 : 205],
                fontFamily,
                fontWeight: 600,
                fontSettings: { sdf: true, fontSize: 64, buffer: 8 },
                outlineWidth: 4,
                outlineColor: [14, 17, 17, 230],
                characterSet: "auto",
                getPixelOffset: [0, -18],
                parameters: { depthCompare: "always" },
                updateTriggers: { getPosition: [d3, heightScale] },
              }),
            ]
          : []),
        ...(fontFamily && !ambient
          ? [
              new TextLayer<Feature, CollisionFilterExtensionProps<Feature>>({
                id: "labels",
                data: districts.features,
                getText: (f) => f.properties.name,
                getPosition: (f) => {
                  const c = centroids[f.properties.id];
                  return [c[0], c[1], (swiping ? 0 : elevation(f.properties.id)) + 200];
                },
                getSize: (f) => (f.properties.id === selectedId ? 14 : 11.5),
                getColor: (f) =>
                  selectedId && f.properties.id !== selectedId
                    ? [232, 230, 225, 150]
                    : [232, 230, 225, 240],
                fontFamily,
                fontWeight: 600,
                fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
                outlineWidth: 3,
                outlineColor: [14, 17, 17, 220],
                characterSet: "auto",
                parameters: { depthCompare: "always" },
                extensions: [new CollisionFilterExtension()],
                collisionTestProps: { sizeScale: 2.4 },
                getCollisionPriority: (f: Feature) =>
                  f.properties.id === selectedId || f.properties.id === highlightId ? 1000 : 0,
                updateTriggers: { getPosition: trigger, getSize: selectedId, getColor: selectedId },
              }),
            ]
          : []),
      ];
    };

    const draw = () => {
      const now = performance.now();
      const tw = tween.current;
      let moving = false;
      const next: Record<string, Shown> = {};
      const rip: Record<string, number> = {};
      ripples.current = ripples.current.filter((r) => now - r.t0 < RIPPLE.life);
      if (ripples.current.length) moving = true;
      for (const f of districts.features) {
        const id = f.properties.id;
        const to = target(id);
        const prev = shown.current[id];
        let e = to.e;
        let c = to.c;
        if (tw) {
          const lt = Math.min(1, Math.max(0, (now - tw.start - (tw.delay[id] ?? 0)) / TWEEN_MS));
          if (lt < 1) {
            moving = true;
            const k = easeOut(lt);
            // Districts with no previous state rise from the ground.
            const from = tw.from[id] ?? { e: 0, c: to.c, l: 0, d: 0 };
            e = from.e + (to.e - from.e) * k;
            c = to.c.map((val, n) => Math.round(from.c[n] + (val - from.c[n]) * k)) as RGBA;
          }
        }
        const tl = liftOf(id);
        const td = dimOf(id);
        const l = still || !prev ? tl : prev.l + (tl - prev.l) * 0.18;
        const d = still || !prev ? td : prev.d + (td - prev.d) * 0.16;
        if (Math.abs(tl - l) > 15 || Math.abs(td - d) > 0.01) moving = true;
        next[id] = { e, c, l, d };
        rip[id] = ripple(id, now);
      }
      if (tw && !moving) tween.current = null;
      shown.current = next;
      overlay.setProps({ layers: build(next, rip, ++frame.current) });
      if (moving) raf.current = requestAnimationFrame(draw);
    };
    kick.current = () => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(draw);
    };

    cancelAnimationFrame(raf.current);
    draw();
    return () => cancelAnimationFrame(raf.current);
  }, [
    ready,
    districts,
    cells,
    tweenKey,
    d3,
    selectedId,
    highlightId,
    hoverId,
    fontFamily,
    centroids,
    ambient,
    swiping,
    swipe,
    splitLng,
    heightScale,
    centre,
    states,
    stateLabels,
  ]);

  // Divider drag
  const dragging = useRef(false);
  const onDividerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !container.current) return;
    const r = container.current.getBoundingClientRect();
    onSplit?.(Math.min(0.95, Math.max(0.05, (e.clientX - r.left) / r.width)));
  };

  const tip = hover ? (swiping ? undefined : cells?.[hover.id]?.tip) : undefined;
  const swipeTip =
    hover && swiping
      ? {
          left: swipe?.left?.[hover.id]?.tip?.[0],
          right: swipe?.right?.[hover.id]?.tip?.[0],
        }
      : null;

  return (
    <div className="absolute inset-0">
      {/* Inline style: maplibre-gl.css sets position: relative on the container. */}
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {/* Vignette: keeps the eye on the state and the chrome legible over bright imagery. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 55% 50%, rgba(14,17,17,0) 45%, rgba(14,17,17,0.62) 100%)",
        }}
      />
      {swiping && (
        <div
          className="swipe-divider absolute inset-y-0 z-[5]"
          style={{ left: `${split * 100}%` }}
          aria-hidden={false}
        >
          <div className="swipe-line" />
          <div
            className="swipe-knob"
            role="slider"
            tabIndex={0}
            aria-label="Before and after divider: baseline on the left, 2050 on the right"
            aria-valuemin={5}
            aria-valuemax={95}
            aria-valuenow={Math.round(split * 100)}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={onDividerMove}
            onPointerUp={() => {
              dragging.current = false;
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") onSplit?.(Math.max(0.05, split - 0.03));
              else if (e.key === "ArrowRight") onSplit?.(Math.min(0.95, split + 0.03));
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden>
              <path
                d="M8 1L2 7l6 6M18 1l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="swipe-tag swipe-tag-left">Baseline 2001–20</span>
          <span className="swipe-tag swipe-tag-right">2050</span>
        </div>
      )}
      {hover && !ambient && (
        <div
          className="pointer-events-none absolute z-10 min-w-[200px] rounded border border-line bg-panel px-3 py-2 text-sm"
          style={{
            left: Math.min(hover.x + 14, (container.current?.clientWidth ?? 9999) - 240),
            top: hover.y + 14,
          }}
          role="status"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold text-fg">{hover.name}</span>
            {hover.state && states && <span className="text-micro text-mute">{hover.state}</span>}
          </div>
          {swipeTip ? (
            <div className="mt-1 space-y-0.5 text-mute">
              {[swipeTip.left, swipeTip.right].map((row, n) =>
                row ? (
                  <div key={n} className="flex justify-between gap-4">
                    <span>{row[0]}</span>
                    <span className="num text-fg">{row[1]}</span>
                  </div>
                ) : null,
              )}
            </div>
          ) : tip && tip.length > 0 ? (
            <div className="mt-1 space-y-0.5 text-mute">
              {tip.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span>{label}</span>
                  <span className="num text-fg">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-mute">No data for this district</div>
          )}
        </div>
      )}
    </div>
  );
}
