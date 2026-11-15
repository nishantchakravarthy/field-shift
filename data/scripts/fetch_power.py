"""Observed kharif rainfall per district, 2001-2020, from NASA POWER.

Parameter PRECTOTCORR (MERRA-2 bias-corrected precipitation, mm/day, monthly means on
a 0.5 x 0.625 degree grid) from the POWER regional monthly API, no login needed.
GPM IMERG itself needs an Earthdata login, and POWER's IMERG_PRECTOT parameter
returned only fill values for this period, so PRECTOTCORR is the observed-rain source.

Kharif total = sum over June-October of (monthly mean mm/day x days in month),
area-weighted over the grid cells that intersect each district.

The POWER regional API accepts boxes of at most 10 x 10 degrees, so the region's
bounding box (region.py) is requested in tiles and the grid points are merged.

Output: data/raw/{region}/power/prectotcorr_monthly_2001_2020.json (merged responses)
        data/raw/{region}/power_district_year.csv

Usage: python data/scripts/fetch_power.py
"""
from __future__ import annotations

import calendar
import json
import sys
import time
from pathlib import Path

import csv

import numpy as np
import requests
from shapely.geometry import shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from process_cmip6 import grid_weights  # noqa: E402
from region import BBOX  # noqa: E402
from region import RAW as REGION_RAW  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RAW = REGION_RAW / "power" / "prectotcorr_monthly_2001_2020.json"
OUT = REGION_RAW / "power_district_year.csv"
GEOJSON = ROOT / "web" / "public" / "data" / "districts.geojson"
MAX_SPAN = 10.0  # degrees per side allowed by the regional API

URL = "https://power.larc.nasa.gov/api/temporal/monthly/regional"
PARAMS = {
    "parameters": "PRECTOTCORR",
    "community": "AG",
    "start": 2001,
    "end": 2020,
    "format": "JSON",
}


def spans(lo: float, hi: float) -> list[tuple[float, float]]:
    """Split [lo, hi] into equal pieces no wider than MAX_SPAN (and at least 2 degrees)."""
    n = max(1, int(np.ceil((hi - lo) / MAX_SPAN)))
    step = (hi - lo) / n
    return [(round(lo + k * step, 3), round(lo + (k + 1) * step, 3)) for k in range(n)]


def download() -> dict:
    """Request every tile and merge the grid points (shared edges are de-duplicated)."""
    merged: dict[tuple[float, float], dict] = {}
    for lat0, lat1 in spans(BBOX["south"], BBOX["north"]):
        for lon0, lon1 in spans(BBOX["west"], BBOX["east"]):
            params = {**PARAMS, "latitude-min": lat0, "latitude-max": lat1, "longitude-min": lon0, "longitude-max": lon1}
            for attempt in range(5):
                try:
                    r = requests.get(URL, params=params, headers={"User-Agent": "field-shift-pipeline/1.0"}, timeout=300)
                    r.raise_for_status()
                    break
                except requests.RequestException:
                    if attempt == 4:
                        raise
                    time.sleep(10 * (attempt + 1))
            feats = r.json()["features"]
            print(f"  tile lat {lat0}-{lat1}, lon {lon0}-{lon1}: {len(feats)} points", flush=True)
            for f in feats:
                lon, lat = f["geometry"]["coordinates"][:2]
                merged[(round(lon, 4), round(lat, 4))] = f
    return {"type": "FeatureCollection", "features": list(merged.values())}
YEARS = range(2001, 2021)
KHARIF_MONTHS = range(6, 11)


def main() -> None:
    if not RAW.exists():
        RAW.parent.mkdir(parents=True, exist_ok=True)
        RAW.write_text(json.dumps(download()), encoding="utf-8")
    feats = json.loads(RAW.read_text(encoding="utf-8"))["features"]

    lons = np.array(sorted({f["geometry"]["coordinates"][0] for f in feats}))
    lats = np.array(sorted({f["geometry"]["coordinates"][1] for f in feats}))
    grid = np.full((len(YEARS), len(lats), len(lons)), np.nan)
    for f in feats:
        lon, lat = f["geometry"]["coordinates"][:2]
        i, j = int(np.argmin(abs(lats - lat))), int(np.argmin(abs(lons - lon)))
        series = f["properties"]["parameter"]["PRECTOTCORR"]
        for y, year in enumerate(YEARS):
            vals = [series[f"{year}{m:02d}"] for m in KHARIF_MONTHS]
            if min(vals) < 0:  # -999 fill
                continue
            grid[y, i, j] = sum(v * calendar.monthrange(year, m)[1] for v, m in zip(vals, KHARIF_MONTHS))

    districts = json.loads(GEOJSON.read_text(encoding="utf-8"))["features"]
    ids = [f["properties"]["id"] for f in districts]
    w = grid_weights(lats, lons, [shape(f["geometry"]) for f in districts])
    ok = np.isfinite(grid).all(axis=0)
    w = w * ok[None]
    w = w / w.sum(axis=(1, 2), keepdims=True)
    out = np.einsum("yij,dij->yd", np.where(ok[None], grid, 0.0), w)

    with OUT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["year", "id", "rain_mm"])
        for y, year in enumerate(YEARS):
            for d, did in enumerate(ids):
                w.writerow([year, did, f"{out[y, d]:.2f}"])
    print(f"wrote {OUT}")
    for d, did in enumerate(ids):
        print(f"  {did}: {out[:, d].mean():.0f} mm")


if __name__ == "__main__":
    main()
