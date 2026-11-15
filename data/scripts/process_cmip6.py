"""Reduce the NEX-GDDP-CMIP6 kharif subsets to one row per model, scenario, year, district.

For each district the daily value is the area-weighted mean of the 0.25 degree grid
cells that intersect it (weight = overlap area x cos(latitude); ocean cells, which
the dataset leaves empty, are ignored).

Per year (1 June - 31 October):
  rain_mm    kharif rainfall total   (pr kg m-2 s-1 x 86,400 = mm/day, summed)
  tas_c      mean temperature        (K - 273.15)
  tasmax_c   mean daily maximum      (K - 273.15)
  onset_doy  monsoon onset: first day from 1 June with 5-day rain >= 25 mm and no
             7-day spell below 5 mm starting within the following 21 days

Output: data/raw/{region}/cmip6_district_year.csv

Usage: python data/scripts/process_cmip6.py
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import csv

import numpy as np
from netCDF4 import Dataset
from shapely.geometry import box, shape

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from region import RAW as REGION_RAW  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RAW = REGION_RAW / "cmip6"
GEOJSON = ROOT / "web" / "public" / "data" / "districts.geojson"
OUT = REGION_RAW / "cmip6_district_year.csv"

JUNE_1_DOY = 152  # day of year of 1 June in a non-leap year
SEASON_DAYS = 153


def grid_weights(lats: np.ndarray, lons: np.ndarray, geoms: list) -> np.ndarray:
    """Return weights[district, lat, lon] for a regular lat/lon grid of cell centres."""
    dlat = float(abs(lats[1] - lats[0]))
    dlon = float(abs(lons[1] - lons[0]))
    w = np.zeros((len(geoms), len(lats), len(lons)))
    for d, geom in enumerate(geoms):
        minx, miny, maxx, maxy = geom.bounds
        for i, lat in enumerate(lats):
            if lat + dlat / 2 < miny or lat - dlat / 2 > maxy:
                continue
            for j, lon in enumerate(lons):
                if lon + dlon / 2 < minx or lon - dlon / 2 > maxx:
                    continue
                cell = box(lon - dlon / 2, lat - dlat / 2, lon + dlon / 2, lat + dlat / 2)
                area = geom.intersection(cell).area
                if area > 0:
                    w[d, i, j] = area * np.cos(np.radians(lat))
    return w


def district_series(data: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """data[time, lat, lon] -> out[time, district], ignoring empty (NaN) cells."""
    ok = np.isfinite(data[0])
    w = weights * ok[None, :, :]
    w = w / w.sum(axis=(1, 2), keepdims=True)
    return np.einsum("tij,dij->td", np.where(ok[None], data, 0.0), w)


def onset_day(rain: np.ndarray) -> float:
    """Index (0 = 1 June) of monsoon onset in a daily rainfall series, or NaN."""
    n = len(rain)
    c = np.concatenate([[0.0], np.cumsum(rain)])
    for d in range(0, n - 28):
        if c[d + 5] - c[d] < 25.0:
            continue
        # 7-day windows starting on days d+5 .. d+21
        dry = any(c[s + 7] - c[s] < 5.0 for s in range(d + 5, d + 22))
        if not dry:
            return float(d)
    return float("nan")


def main() -> None:
    feats = json.loads(GEOJSON.read_text(encoding="utf-8"))["features"]
    ids = [f["properties"]["id"] for f in feats]
    geoms = [shape(f["geometry"]) for f in feats]

    rows = []
    missing = []
    weights_cache: dict[tuple, np.ndarray] = {}
    for model_dir in sorted(p for p in RAW.iterdir() if p.is_dir()):
        for scen_dir in sorted(p for p in model_dir.iterdir() if p.is_dir()):
            years = sorted({int(p.stem.split("_")[1]) for p in scen_dir.glob("pr_*.nc")})
            for year in years:
                series = {}
                for var in ("pr", "tas", "tasmax"):
                    path = scen_dir / f"{var}_{year}.nc"
                    if not path.exists():
                        missing.append(str(path))
                        break
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        with Dataset(path) as ds:
                            lats = np.asarray(ds.variables["lat"][:], dtype="float64")
                            lons = np.asarray(ds.variables["lon"][:], dtype="float64")
                            data = np.ma.filled(ds.variables[var][:].astype("float64"), np.nan)
                    data[np.abs(data) > 1e10] = np.nan
                    key = (len(lats), len(lons), float(lats[0]), float(lons[0]))
                    if key not in weights_cache:
                        weights_cache[key] = grid_weights(lats, lons, geoms)
                    series[var] = district_series(data, weights_cache[key])
                if len(series) < 3:
                    continue
                rain = series["pr"] * 86400.0  # kg m-2 s-1 -> mm/day
                # scale totals to a 153-day season for models on other calendars
                scale = SEASON_DAYS / rain.shape[0]
                for d, did in enumerate(ids):
                    rows.append(
                        {
                            "model": model_dir.name,
                            "scenario": scen_dir.name,
                            "year": year,
                            "id": did,
                            "rain_mm": rain[:, d].sum() * scale,
                            "tas_c": series["tas"][:, d].mean() - 273.15,
                            "tasmax_c": series["tasmax"][:, d].mean() - 273.15,
                            "onset_doy": JUNE_1_DOY + onset_day(rain[:, d]),
                            "n_days": rain.shape[0],
                        }
                    )
            print(model_dir.name, scen_dir.name, len(years), "years", flush=True)

    cols = ["model", "scenario", "year", "id", "rain_mm", "tas_c", "tasmax_c", "onset_doy", "n_days"]
    with OUT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in rows:
            w.writerow([f"{r[c]:.4f}" if isinstance(r[c], float) and np.isfinite(r[c]) else ("" if isinstance(r[c], float) else r[c]) for c in cols])
    print(f"wrote {OUT} ({len(rows)} rows); incomplete years skipped: {len(missing)}")
    spans: dict[tuple[str, str], set[int]] = {}
    for r in rows:
        spans.setdefault((r["model"], r["scenario"]), set()).add(r["year"])
    for (m, sc), ys in sorted(spans.items()):
        print(f"  {m:14s} {sc:10s} {min(ys)}-{max(ys)} ({len(ys)} years)")
    print("onset not found in", sum(1 for r in rows if not np.isfinite(r["onset_doy"])), "district-years")


if __name__ == "__main__":
    main()
