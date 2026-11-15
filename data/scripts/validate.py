"""Check the final JSON files against the data contract. Exits non-zero on any failure.

Usage: python data/scripts/validate.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIRS = [ROOT / "api" / "data", ROOT / "web" / "public" / "data"]
CROPS = ["paddy", "ragi", "maize"]
SCENARIOS = ["ssp245", "ssp585"]
errors: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        errors.append(msg)


def walk(node, path: str) -> None:
    """No null / NaN / Infinity anywhere, and no leftover mock marker."""
    if isinstance(node, dict):
        check("mock" not in node, f"{path}: contains a 'mock' key")
        for k, v in node.items():
            walk(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk(v, f"{path}[{i}]")
    elif node is None:
        # MODIS history years that were not downloaded are allowed as gaps
        check(".history.ndvi_peak[" in path or ".history.lst_day_c[" in path, f"{path}: null")
    elif isinstance(node, float):
        check(math.isfinite(node), f"{path}: non-finite number")


def one_decimal(x) -> bool:
    return isinstance(x, (int, float)) and abs(x * 10 - round(x * 10)) < 1e-6


def validate_dir(d: Path) -> None:
    def load(name: str):
        p = d / name
        if not p.exists():
            check(False, f"{p}: missing")
            return None
        text = p.read_text(encoding="utf-8")
        check("NaN" not in text and "Infinity" not in text, f"{p}: NaN/Infinity literal")
        data = json.loads(text)
        walk(data, name)
        return data

    geo = load("districts.geojson")
    ids = [f["properties"]["id"] for f in geo["features"]]
    check(len(ids) == len(set(ids)) and len(ids) >= 30, f"{d}: expected >= 30 unique districts, got {len(ids)}")
    for f in geo["features"]:
        check(set(f["properties"]) in ({"id", "name"}, {"id", "name", "state"}), f"{d}: geojson properties must be id, name and optionally state")

    for p in d.glob("*.json"):
        walk(json.loads(p.read_text(encoding="utf-8")), p.name)
    for p in d.glob("district_*.json"):
        check(p.stem[len("district_"):] in ids, f"{p}: district id not in districts.geojson")

    scores: dict[tuple[str, str, str], dict] = {}
    for crop in CROPS:
        for scen in SCENARIOS:
            name = f"suitability_{crop}_{scen}.json"
            s = load(name)
            if s is None:
                continue
            check(s["crop"] == crop and s["scenario"] == scen, f"{name}: wrong crop/scenario header")
            check([r["id"] for r in s["districts"]] == ids, f"{name}: district list differs from geojson")
            for r in s["districts"]:
                for k in ("baseline", "y2050") + (("y2030",) if "y2030" in r else ()):
                    check(isinstance(r[k], int) and 0 <= r[k] <= 100, f"{name}:{r['id']}.{k} not an int in 0-100")
                check(r["change"] == r["y2050"] - r["baseline"], f"{name}:{r['id']} change != y2050 - baseline")
                scores[(crop, scen, r["id"])] = r

    for did in ids:
        name = f"district_{did}.json"
        dj = load(name)
        if dj is None:
            continue
        check(dj["id"] == did and isinstance(dj["name"], str) and dj["name"], f"{name}: id/name")
        h = dj["history"]
        n = len(h["years"])
        check(h["years"] == list(range(2001, 2021)), f"{name}: history years must be 2001-2020")
        for k in ("rain_mm", "ndvi_peak", "lst_day_c"):
            check(len(h[k]) == n, f"{name}: history.{k} length")
        check(all(0 <= v <= 6000 for v in h["rain_mm"]), f"{name}: rain_mm out of range")
        check(all(v is None or 0 < v <= 1 for v in h["ndvi_peak"]), f"{name}: ndvi out of range")
        check(all(v is None or 10 <= v <= 60 for v in h["lst_day_c"]), f"{name}: lst out of range (is it still in K?)")
        for scen in SCENARIOS:
            c = dj["climate"][scen]
            for k in ("temp_base_c", "temp_2050_c", "rain_base_mm", "rain_2050_mm", "onset_shift_weeks"):
                check(k in c and one_decimal(c[k]), f"{name}: climate.{scen}.{k} missing or not 1 decimal")
            check(10 <= c["temp_base_c"] <= 40 and 10 <= c["temp_2050_c"] <= 45, f"{name}: temperature not in deg C")
            check(100 <= c["rain_base_mm"] <= 6000, f"{name}: baseline rain implausible")
            p = dj["plan"][scen]
            check(p["best_now"] in CROPS and p["best_2050"] in CROPS, f"{name}: best crop")
            check(isinstance(p["switch"], bool), f"{name}: switch")
            check(set(p["water_gap_mm"]) == set(CROPS) and all(v >= 0 for v in p["water_gap_mm"].values()), f"{name}: water_gap_mm")
            check(2 <= len(p["actions"]) <= 3, f"{name}: needs 2-3 actions")
            check(all(any(ch.isdigit() for ch in a) for a in p["actions"]), f"{name}: every action must carry a number")
            check(set(p["limiting"]) == set(CROPS) and set(p["limiting"].values()) <= {"temp", "rain"}, f"{name}: limiting")
            for crop in CROPS:
                r = scores.get((crop, scen, did))
                if r:
                    check(
                        p["scores"][crop] == {"baseline": r["baseline"], "y2050": r["y2050"]},
                        f"{name}: plan.{scen}.scores.{crop} disagrees with suitability file",
                    )
            top = max(p["scores"][c]["y2050"] for c in CROPS)
            check(p["scores"][p["best_2050"]]["y2050"] == top, f"{name}: best_2050 is not the top-scoring crop")

    meta = load("meta.json")
    if meta:
        for k in ("datasets", "models", "generated", "limitations", "windows", "crops", "validation", "boundaries", "headline"):
            check(k in meta, f"meta.json: missing {k}")
        uses = " | ".join(x["use"] for x in meta["datasets"])
        for word in ("rainfall", "NDVI", "LST"):
            check(word in uses, f"meta.json: no dataset 'use' mentions {word}")
        for x in meta["datasets"]:
            check(all(k in x for k in ("name", "ee_id", "link", "period", "use")), f"meta.json: dataset {x.get('name')} incomplete")
        check(len(meta["models"]) >= 3, "meta.json: fewer than 3 models")
        check(meta["boundaries"]["district_count"] == len(ids), "meta.json: district_count")
        check(-1 <= meta["validation"]["pearson_r"] <= 1 and meta["validation"]["n"] == len(ids), "meta.json: validation")
        check(set(meta["crops"]) == set(CROPS), "meta.json: crops")


def main() -> None:
    for d in DIRS:
        validate_dir(d)
    a, b = DIRS
    names_a = sorted(p.name for p in a.glob("*json"))
    names_b = sorted(p.name for p in b.glob("*json"))
    check(names_a == names_b, "api/data and web/public/data hold different file sets")
    for n in set(names_a) & set(names_b):
        check((a / n).read_bytes() == (b / n).read_bytes(), f"{n}: api/data and web/public/data copies differ")
    if errors:
        print(f"FAILED: {len(errors)} problem(s)")
        for e in errors[:60]:
            print(" -", e)
        sys.exit(1)
    print(f"OK: {len(names_a)} files per directory, all checks passed")


if __name__ == "__main__":
    main()
