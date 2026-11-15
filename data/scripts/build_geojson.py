"""Build the district GeoJSON used by the map and by every extraction script.

Source: geoBoundaries gbOpen IND ADM2 (boundary year 2021, ODbL 1.0), filtered to the
states listed in region.py. Each district goes to the state that holds most of its area.
Districts created after the boundary year (for example Vijayanagara, split from Ballari
in 2021, or Andhra Pradesh's 2022 districts) are not separated in this source.

Also writes states.geojson: one outline per state, for the map.

Usage: python data/scripts/build_geojson.py
"""
from __future__ import annotations

import json
import shutil
import unicodedata
import urllib.request
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

from region import STATES

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "boundaries"
OUT_PATHS = [ROOT / "web" / "public" / "data" / "districts.geojson", ROOT / "api" / "data" / "districts.geojson"]
STATE_PATHS = [ROOT / "web" / "public" / "data" / "states.geojson", ROOT / "api" / "data" / "states.geojson"]
STATE_SIMPLIFY_DEG = 0.01

BASE = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND"
SOURCES = {
    "ind_adm1_simplified.geojson": f"{BASE}/ADM1/geoBoundaries-IND-ADM1_simplified.geojson",
    "ind_adm2_simplified.geojson": f"{BASE}/ADM2/geoBoundaries-IND-ADM2_simplified.geojson",
}

# geoBoundaries name -> current official district name
RENAME = {
    "Bagalkot": "Bagalkote",
    "Bangalore": "Bengaluru Urban",
    "Bangalore Rural": "Bengaluru Rural",
    "Belgaum": "Belagavi",
    "Bellary": "Ballari",
    "Bijapur": "Vijayapura",
    "Chamarajanagar": "Chamarajanagara",
    "Chikmagalur": "Chikkamagaluru",
    "Gulbarga": "Kalaburagi",
    "Mysore": "Mysuru",
    "Shimoga": "Shivamogga",
    "Tumkur": "Tumakuru",
}

SIMPLIFY_DEG = 0.0015  # ~160 m; invisible at state zoom
PRECISION = 4


def slug(name: str) -> str:
    return name.lower().replace(" ", "_")


def round_coords(obj):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(obj[0], PRECISION), round(obj[1], PRECISION)]
        return [round_coords(o) for o in obj]
    return obj


def polygonal(geom):
    """Keep only polygon parts of a geometry (make_valid can emit collections)."""
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    parts = [g for g in getattr(geom, "geoms", []) if g.geom_type in ("Polygon", "MultiPolygon")]
    out = parts[0]
    for p in parts[1:]:
        out = out.union(p)
    return out


def plain(name: str) -> str:
    """Drop diacritics: geoBoundaries writes 'Karnātaka', 'Tamil Nādu'."""
    return "".join(ch for ch in unicodedata.normalize("NFKD", name) if not unicodedata.combining(ch)).strip()


def norm(name: str) -> str:
    return "".join(ch for ch in plain(name).lower() if ch.isalpha())


def write(paths: list[Path], fc: dict) -> str:
    text = json.dumps(fc, separators=(",", ":"), ensure_ascii=False)
    paths[0].parent.mkdir(parents=True, exist_ok=True)
    paths[0].write_text(text, encoding="utf-8")
    paths[1].parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(paths[0], paths[1])
    return text


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        if not (RAW / name).exists():
            urllib.request.urlretrieve(url, RAW / name)

    adm1 = json.loads((RAW / "ind_adm1_simplified.geojson").read_text(encoding="utf-8"))
    adm2 = json.loads((RAW / "ind_adm2_simplified.geojson").read_text(encoding="utf-8"))
    by_name = {norm(f["properties"]["shapeName"]): f for f in adm1["features"]}
    states: dict[str, object] = {}
    for state_name in STATES:
        f = by_name.get(norm(state_name))
        if f is None:
            raise SystemExit(
                f"State '{state_name}' not found in geoBoundaries ADM1. Available: "
                + ", ".join(sorted(x["properties"]["shapeName"] for x in adm1["features"]))
            )
        states[state_name] = shape(f["geometry"]).buffer(0)

    features = []
    used: set[str] = set()
    members: dict[str, list] = {s: [] for s in STATES}
    for f in adm2["features"]:
        geom = shape(f["geometry"]).buffer(0)
        if geom.area == 0:
            continue
        # the state that holds most of this district, if it holds at least half
        best, share = None, 0.0
        for state_name, sgeom in states.items():
            if not geom.intersects(sgeom):
                continue
            s = geom.intersection(sgeom).area / geom.area
            if s > share:
                best, share = state_name, s
        if best is None or share < 0.5:
            continue
        raw_name = plain(f["properties"]["shapeName"])
        name = RENAME.get(raw_name, raw_name)
        did = "".join(ch for ch in slug(name) if ch.isalnum() or ch == "_")
        if did in used:  # same district name in two states
            did = f"{did}_{STATES[best].lower()}"
        used.add(did)
        geom = polygonal(make_valid(geom.simplify(SIMPLIFY_DEG, preserve_topology=True)))
        members[best].append(geom)
        gj = mapping(geom)
        features.append(
            {
                "type": "Feature",
                "id": did,
                "properties": {"id": did, "name": name, "state": best},
                "geometry": {"type": gj["type"], "coordinates": round_coords(gj["coordinates"])},
            }
        )
    features.sort(key=lambda x: x["properties"]["id"])
    for f in features:
        assert shape(f["geometry"]).is_valid, f["properties"]["id"]

    text = write(OUT_PATHS, {"type": "FeatureCollection", "features": features})
    print(f"{len(features)} districts, {len(text) / 1024:.0f} KB")
    for state_name in STATES:
        ids = [f["properties"]["id"] for f in features if f["properties"]["state"] == state_name]
        print(f"  {state_name}: {len(ids)} districts")
        assert ids, f"no districts found for {state_name}"

    outlines = []
    for state_name, geoms in members.items():
        merged = polygonal(make_valid(unary_union(geoms).buffer(0.002).buffer(-0.002)))
        merged = polygonal(make_valid(merged.simplify(STATE_SIMPLIFY_DEG, preserve_topology=True)))
        gj = mapping(merged)
        outlines.append(
            {
                "type": "Feature",
                "id": STATES[state_name],
                "properties": {"id": STATES[state_name], "name": state_name},
                "geometry": {"type": gj["type"], "coordinates": round_coords(gj["coordinates"])},
            }
        )
    text = write(STATE_PATHS, {"type": "FeatureCollection", "features": outlines})
    print(f"{len(outlines)} state outlines, {len(text) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
