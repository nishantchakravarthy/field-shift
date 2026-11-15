"""Download NASA NEX-GDDP-CMIP6 daily fields for the study region, kharif season only.

Source: NASA Center for Climate Simulation THREDDS server, NetCDF Subset Service
(https://ds.nccs.nasa.gov/thredds/catalog/AMES/NEX/GDDP-CMIP6/catalog.html).
Each request is one model x scenario x variable x year, cut to the region's
bounding box (region.py) and to 1 June - 31 October, so a file is ~1 MB instead of ~200 MB.

Files land in data/raw/{region}/cmip6/{model}/{scenario}/{var}_{year}.nc and are skipped
when already present, so the script is resumable.

Usage:
  python data/scripts/fetch_cmip6.py            # baseline + 2041-2060
  python data/scripts/fetch_cmip6.py --mid      # also 2021-2040
"""
from __future__ import annotations

import argparse
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from region import BBOX, RAW  # noqa: E402

OUT = RAW / "cmip6"

THREDDS = "https://ds.nccs.nasa.gov/thredds"
MODELS = ["ACCESS-CM2", "MIROC6", "MRI-ESM2-0", "IPSL-CM6A-LR", "NorESM2-MM"]
VARIANT = "r1i1p1f1"
VARS = ["pr", "tas", "tasmax"]
HEADERS = {"User-Agent": "field-shift-pipeline/1.0 (python-requests)"}
WORKERS = 6


def periods(mid: bool) -> list[tuple[str, int]]:
    jobs = [("historical", y) for y in range(2001, 2015)]
    for scen in ("ssp245", "ssp585"):
        jobs += [(scen, y) for y in range(2015, 2021)]
        jobs += [(scen, y) for y in range(2041, 2061)]
        if mid:
            jobs += [(scen, y) for y in range(2021, 2041)]
    return jobs


def version_key(name: str) -> tuple[int, int]:
    m = re.search(r"_v(\d+)\.(\d+)\.nc$", name)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


_catalog_cache: dict[tuple[str, str, str], dict[int, str]] = {}


def catalog(model: str, scen: str, var: str) -> dict[int, str]:
    """Map year -> newest file name published for this model/scenario/variable."""
    key = (model, scen, var)
    if key not in _catalog_cache:
        url = f"{THREDDS}/catalog/AMES/NEX/GDDP-CMIP6/{model}/{scen}/{VARIANT}/{var}/catalog.xml"
        for attempt in range(5):
            try:
                r = requests.get(url, headers=HEADERS, timeout=60)
                r.raise_for_status()
                break
            except requests.RequestException:
                if attempt == 4:
                    raise
                time.sleep(3 * (attempt + 1))
        best: dict[int, str] = {}
        for name in re.findall(r'name="([^"]+\.nc)"', r.text):
            m = re.search(r"_(\d{4})(?:_v\d+\.\d+)?\.nc$", name)
            if not m:
                continue
            year = int(m.group(1))
            if year not in best or version_key(name) > version_key(best[year]):
                best[year] = name
        _catalog_cache[key] = best
    return _catalog_cache[key]


def fetch(model: str, scen: str, var: str, year: int) -> str:
    dest = OUT / model / scen / f"{var}_{year}.nc"
    if dest.exists() and dest.stat().st_size > 10_000:
        return "cached"
    dest.parent.mkdir(parents=True, exist_ok=True)
    name = catalog(model, scen, var)[year]
    url = f"{THREDDS}/ncss/grid/AMES/NEX/GDDP-CMIP6/{model}/{scen}/{VARIANT}/{var}/{name}"
    params = {
        "var": var,
        **BBOX,
        "horizStride": 1,
        "time_start": f"{year}-06-01T00:00:00Z",
        "time_end": f"{year}-10-31T23:59:59Z",
        "accept": "netcdf4-classic",
    }
    last = ""
    for attempt in range(6):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=180)
            if r.status_code == 200 and r.content[:4] in (b"\x89HDF", b"CDF\x01", b"CDF\x02"):
                tmp = dest.with_suffix(".part")
                tmp.write_bytes(r.content)
                tmp.replace(dest)
                (dest.parent / f"{var}_{year}.src").write_text(name, encoding="utf-8")
                return "ok"
            last = f"HTTP {r.status_code}"
        except requests.RequestException as exc:
            last = type(exc).__name__
        time.sleep(4 * (attempt + 1))
    return f"FAILED {last}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mid", action="store_true", help="also fetch 2021-2040")
    ap.add_argument("--models", nargs="*", default=MODELS)
    args = ap.parse_args()

    jobs = [(m, s, v, y) for m in args.models for (s, y) in periods(args.mid) for v in VARS]
    print(f"{len(jobs)} files requested", flush=True)
    done = failed = 0
    t0 = time.time()
    with ThreadPoolExecutor(WORKERS) as pool:
        futs = {pool.submit(fetch, *j): j for j in jobs}
        for fut in as_completed(futs):
            job = futs[fut]
            try:
                res = fut.result()
            except Exception as exc:  # noqa: BLE001 - report and continue
                res = f"FAILED {exc!r}"
            done += 1
            if res.startswith("FAILED"):
                failed += 1
                print(f"{res}: {job}", flush=True)
            if done % 50 == 0:
                print(f"{done}/{len(jobs)}  failed={failed}  {time.time() - t0:.0f}s", flush=True)
    print(f"finished: {done} files, {failed} failed, {time.time() - t0:.0f}s", flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
