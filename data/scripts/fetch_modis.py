"""Observed crop greenness and land-surface temperature per district, 2001-2020.

Products (NASA LP DAAC, collection 6.1), read as cloud-optimised GeoTIFFs from the
Microsoft Planetary Computer mirror, which needs no login. Files are read with the
small pure-Python reader in cogread.py (no GDAL/rasterio needed):
  * MOD13Q1  250 m 16-day NDVI           -> yearly peak NDVI (per-pixel kharif maximum)
  * MOD11A2  1 km  8-day LST_Day_1km     -> yearly mean daytime LST, June-October
Cropland mask: ESA WorldCover v200 (2021), class 40, sampled onto the MODIS grid.

The region spans several MODIS tiles (region.py). Each tile is read in a window that
covers only its districts; per-district sums and pixel counts are added across tiles,
so a district on a tile edge is averaged over both parts. NDVI is read at 500 m (the
COG overview), which is plenty for district means and quarters the download.
For every district the statistic is the mean over cropland pixels (all pixels are
also stored for reference).

Output: data/raw/{region}/modis/ndvi_{year}.json, lst_{year}.json, cropland.json (resumable).

Usage: python data/scripts/fetch_modis.py [--reverse] [--from YEAR]
(--reverse and --from change the year order, so several processes can share the work)
"""
from __future__ import annotations

import json
import math
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from collections import namedtuple

import numpy as np
import requests
import shapely
from shapely.geometry import box, shape
from shapely.ops import transform as shp_transform
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cogread import COG  # noqa: E402
from region import MODIS_TILES  # noqa: E402
from region import RAW as REGION_RAW  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = REGION_RAW / "modis"
GEOJSON = ROOT / "web" / "public" / "data" / "districts.geojson"

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SIGN = "https://planetarycomputer.microsoft.com/api/sas/v1/sign"
HEADERS = {"User-Agent": "field-shift-pipeline/1.0 (python-requests)"}
YEARS = range(2001, 2021)

R = 6371007.181  # MODIS sinusoidal sphere radius, m
TILE_SIZE = 1111950.5196666666  # metres per MODIS tile side
X_MIN, Y_MAX = -20015109.354, 10007554.677  # upper-left corner of tile h00v00
PX1K = 926.6254330558334
NDVI_FACTOR = 2  # NDVI grid: 1 km / 2 = ~463 m (native 250 m, read from the overview)


def tile_origin(tile: str) -> tuple[float, float]:
    m = re.match(r"h(\d{2})v(\d{2})$", tile)
    h, v = int(m.group(1)), int(m.group(2))
    return X_MIN + h * TILE_SIZE, Y_MAX - v * TILE_SIZE


def from_sinu(x, y, z=None):
    lat = np.degrees(np.asarray(y) / R)
    lon = np.degrees(np.asarray(x) / (R * np.cos(np.radians(lat))))
    return lon, lat
NDVI_DOY = (177, 305)  # 16-day composites starting 26 Jun .. 1 Nov
LST_DOY = (153, 297)  # 8-day composites starting 2 Jun .. 24 Oct
WORKERS = 6


def to_sinu(lon, lat, z=None):
    lat_r = np.radians(lat)
    return R * np.radians(lon) * np.cos(lat_r), R * lat_r


def retry(fn, tries=6, wait=4):
    for attempt in range(tries):
        try:
            return fn()
        except Exception:  # noqa: BLE001 - network calls, retried
            if attempt == tries - 1:
                raise
            time.sleep(wait * (attempt + 1))


def sign(href: str) -> str:
    def go():
        r = requests.get(SIGN, params={"href": href}, headers=HEADERS, timeout=60)
        r.raise_for_status()
        return r.json()["href"]

    return retry(go)


def search(
    collection: str, prefix: str, year: int, asset: str, doy_range: tuple[int, int], tile: str, point: tuple[float, float]
) -> list[tuple[int, str]]:
    """Return [(day_of_year, asset_href)] for one product, year and tile. `point` is a lon/lat inside the tile."""

    def go():
        body = {
            "collections": [collection],
            "bbox": [point[0] - 0.05, point[1] - 0.05, point[0] + 0.05, point[1] + 0.05],
            "datetime": f"{year}-05-25T00:00:00Z/{year}-11-10T00:00:00Z",
            "limit": 200,
        }
        r = requests.post(STAC, json=body, headers=HEADERS, timeout=90)
        r.raise_for_status()
        return r.json()["features"]

    found: dict[int, tuple[str, str]] = {}
    for item in retry(go):
        m = re.match(rf"{prefix}\.A(\d{{4}})(\d{{3}})\.{tile}\.061\.(\d+)", item["id"])
        if not m or int(m.group(1)) != year:
            continue
        doy = int(m.group(2))
        if doy_range[0] <= doy <= doy_range[1]:
            if doy not in found or m.group(3) > found[doy][0]:
                found[doy] = (m.group(3), item["assets"][asset]["href"])
    return sorted((d, h) for d, (_, h) in found.items())


Window = namedtuple("Window", "col_off row_off width height")


def read_window(href: str, window: Window, out_shape: tuple[int, int]) -> np.ndarray:
    """Read a window (in 1 km tile pixels) from the COG level whose grid matches out_shape.

    The tile is 1200 px wide at 1 km; out_shape at factor f reads the level 1200*f px wide
    (MOD13Q1: 4800 native, 2400 overview; MOD11A2: 1200 native)."""
    factor = out_shape[1] // window.width

    def go():
        cog = COG(sign(href))
        return cog.read(1200 * factor, window.col_off * factor, window.row_off * factor, out_shape[1], out_shape[0])

    return retry(go)


def rasterize_ids(shapes, out_shape: tuple[int, int], x0: float, y0: float, px: float) -> np.ndarray:
    """District id (1..n) of every pixel centre, 0 outside all districts."""
    ids = np.zeros(out_shape, dtype="uint16")
    xs = x0 + (np.arange(out_shape[1]) + 0.5) * px
    ys = y0 - (np.arange(out_shape[0]) + 0.5) * px
    for geom, val in shapes:
        minx, miny, maxx, maxy = geom.bounds
        c0, c1 = max(0, int((minx - x0) / px)), min(out_shape[1], int(math.ceil((maxx - x0) / px)) + 1)
        r0, r1 = max(0, int((y0 - maxy) / px)), min(out_shape[0], int(math.ceil((y0 - miny) / px)) + 1)
        if c0 >= c1 or r0 >= r1:
            continue
        gx, gy = np.meshgrid(xs[c0:c1], ys[r0:r1])
        shapely.prepare(geom)
        inside = shapely.contains_xy(geom, gx, gy)
        sub = ids[r0:r1, c0:c1]
        sub[inside & (sub == 0)] = val
    return ids


class Grid:
    """A window of one MODIS tile at a given pixel size, with district ids and cropland."""

    def __init__(self, tile: str, factor: int, win1k: tuple[int, int, int, int], shapes, worldcover):
        col1k, row1k, w1k, h1k = win1k
        tx0, ty0 = tile_origin(tile)
        self.px = PX1K / factor
        self.window = Window(col1k, row1k, w1k, h1k)  # in 1 km pixels of the tile
        self.shape = (h1k * factor, w1k * factor)
        x0 = tx0 + col1k * PX1K
        y0 = ty0 - row1k * PX1K
        self.ids = rasterize_ids(shapes, self.shape, x0, y0, self.px)
        # pixel-centre lon/lat -> WorldCover lookup
        ys = y0 - (np.arange(self.shape[0]) + 0.5) * self.px
        xs = x0 + (np.arange(self.shape[1]) + 0.5) * self.px
        lat = np.degrees(ys / R)
        lon = np.degrees(xs[None, :] / (R * np.cos(np.radians(lat))[:, None]))
        self.cropland = worldcover.is_cropland(lon, np.broadcast_to(lat[:, None], lon.shape)) & (self.ids > 0)

    def district_sums(self, values: np.ndarray, valid: np.ndarray, n: int) -> np.ndarray:
        """[[crop sum, crop count, all sum, all count]] per district (rows), for adding across tiles."""
        out = np.zeros((4, n))
        for k, mask in enumerate((self.cropland & valid, (self.ids > 0) & valid)):
            out[2 * k] = np.bincount(self.ids[mask], weights=values[mask], minlength=n + 1)[1 : n + 1]
            out[2 * k + 1] = np.bincount(self.ids[mask], minlength=n + 1)[1 : n + 1]
        return out


def means(acc: np.ndarray) -> tuple[list, list, list]:
    crop = [float(s / c) if c else None for s, c in zip(acc[0], acc[1])]
    allp = [float(s / c) if c else None for s, c in zip(acc[2], acc[3])]
    return crop, allp, [int(c) for c in acc[1]]


class WorldCover:
    """ESA WorldCover v200 mosaic, read at overview resolution (~300 m)."""

    SIZE = 1125  # pixels per 3-degree tile after decimation (36000 / 32)

    def __init__(self, bounds):
        self.lon0 = math.floor(bounds[0] / 3) * 3
        self.lat0 = math.floor(bounds[1] / 3) * 3
        self.lon1 = math.ceil(bounds[2] / 3) * 3
        self.lat1 = math.ceil(bounds[3] / 3) * 3
        cache = OUT / "worldcover_mosaic.npy"
        if cache.exists():
            self.mosaic = np.load(cache)
            return
        nx, ny = (self.lon1 - self.lon0) // 3, (self.lat1 - self.lat0) // 3
        self.mosaic = np.zeros((ny * self.SIZE, nx * self.SIZE), dtype="uint8")

        def items():
            body = {
                "collections": ["esa-worldcover"],
                "bbox": list(bounds),
                "datetime": "2021-01-01T00:00:00Z/2021-12-31T23:59:59Z",
                "limit": 100,
            }
            r = requests.post(STAC, json=body, headers=HEADERS, timeout=90)
            r.raise_for_status()
            return r.json()["features"]

        def load(item):
            # tile origin comes from the id (item bboxes are clipped to land)
            m = re.search(r"_([NS])(\d{2})([EW])(\d{3})$", item["id"])
            south = int(m.group(2)) * (1 if m.group(1) == "N" else -1)
            west = int(m.group(4)) * (1 if m.group(3) == "E" else -1)
            ix, iy = round((west - self.lon0) / 3), round((self.lat1 - (south + 3)) / 3)
            if not (0 <= ix < nx and 0 <= iy < ny):
                return

            def go():
                cog = COG(sign(item["assets"]["map"]["href"]))
                assert cog.levels[0].width == 36000, item["id"]
                return cog.read(self.SIZE, 0, 0, self.SIZE, self.SIZE)

            self.mosaic[iy * self.SIZE : (iy + 1) * self.SIZE, ix * self.SIZE : (ix + 1) * self.SIZE] = retry(go)

        with ThreadPoolExecutor(WORKERS) as pool:
            list(pool.map(load, retry(items)))
        np.save(cache, self.mosaic)

    def is_cropland(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        res = 3 / self.SIZE
        col = np.clip(((lon - self.lon0) / res).astype(int), 0, self.mosaic.shape[1] - 1)
        row = np.clip(((self.lat1 - lat) / res).astype(int), 0, self.mosaic.shape[0] - 1)
        return self.mosaic[row, col] == 40


def tile_windows(shapes) -> list[tuple[str, tuple[int, int, int, int], tuple[float, float]]]:
    """For every region tile that holds districts: (tile, 1 km window, a lon/lat inside it)."""
    union = unary_union([s for s, _ in shapes])
    out = []
    for tile in MODIS_TILES:
        tx0, ty0 = tile_origin(tile)
        tbox = box(tx0, ty0 - TILE_SIZE, tx0 + TILE_SIZE, ty0)
        part = union.intersection(tbox)
        if part.is_empty:
            print(f"{tile}: no districts, skipped", flush=True)
            continue
        minx, miny, maxx, maxy = part.bounds
        col = max(0, int((minx - tx0) / PX1K) - 1)
        row = max(0, int((ty0 - maxy) / PX1K) - 1)
        col1 = min(1200, int(math.ceil((maxx - tx0) / PX1K)) + 1)
        row1 = min(1200, int(math.ceil((ty0 - miny) / PX1K)) + 1)
        p = part.representative_point()
        lon, lat = from_sinu(p.x, p.y)
        out.append((tile, (col, row, col1 - col, row1 - row), (float(lon), float(lat))))
        print(f"{tile}: window {col1 - col} x {row1 - row} km", flush=True)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    feats = json.loads(GEOJSON.read_text(encoding="utf-8"))["features"]
    ids = [f["properties"]["id"] for f in feats]
    geoms = [shape(f["geometry"]) for f in feats]
    shapes = [(shp_transform(to_sinu, g), i + 1) for i, g in enumerate(geoms)]
    n = len(ids)

    lon_b = [min(g.bounds[0] for g in geoms), min(g.bounds[1] for g in geoms), max(g.bounds[2] for g in geoms), max(g.bounds[3] for g in geoms)]
    worldcover = WorldCover(lon_b)
    tiles = []
    for tile, win, point in tile_windows(shapes):
        tiles.append((tile, point, Grid(tile, NDVI_FACTOR, win, shapes, worldcover), Grid(tile, 1, win, shapes, worldcover)))

    total = np.zeros(n)
    crop = np.zeros(n)
    for _, _, gn, _ in tiles:
        total += np.bincount(gn.ids[gn.ids > 0], minlength=n + 1)[1 : n + 1]
        crop += np.bincount(gn.ids[gn.cropland], minlength=n + 1)[1 : n + 1]
    missing = [i for i, t in zip(ids, total) if t == 0]
    assert not missing, f"districts outside every MODIS tile in region.py: {missing}"
    (OUT / "cropland.json").write_text(
        json.dumps({i: round(float(c / t), 4) for i, c, t in zip(ids, crop, total)}, indent=1), encoding="utf-8"
    )
    print("cropland fraction computed for", n, "districts", flush=True)

    order = list(reversed(YEARS)) if "--reverse" in sys.argv else list(YEARS)
    if "--from" in sys.argv:  # start at a given year, then wrap around
        first = int(sys.argv[sys.argv.index("--from") + 1])
        order = [y for y in order if y >= first] + [y for y in order if y < first]
    for year in order:
        t0 = time.time()
        ndvi_path = OUT / f"ndvi_{year}.json"
        if not ndvi_path.exists():
            acc = np.zeros((4, n))
            doys: list[int] = []
            for tile, point, gn, _ in tiles:
                items = search("modis-13Q1-061", "MOD13Q1", year, "250m_16_days_NDVI", NDVI_DOY, tile, point)
                doys = sorted(set(doys) | {d for d, _ in items})
                peak = np.full(gn.shape, -32768, dtype="int16")
                with ThreadPoolExecutor(WORKERS) as pool:
                    for a in pool.map(lambda it, g=gn: read_window(it[1], g.window, g.shape), items):
                        ok = (a >= -2000) & (a <= 10000)
                        np.maximum(peak, np.where(ok, a, -32768).astype("int16"), out=peak)
                valid = peak > -32768
                acc += gn.district_sums(peak.astype("float64") * 0.0001, valid, n)
            mc, ma, nc = means(acc)
            ndvi_path.write_text(
                json.dumps({"year": year, "composites_doy": doys, "ids": ids, "cropland": mc, "all": ma, "n_cropland_px": nc}),
                encoding="utf-8",
            )
        lst_path = OUT / f"lst_{year}.json"
        if not lst_path.exists():
            acc = np.zeros((4, n))
            doys = []
            for tile, point, _, g1 in tiles:
                items = search("modis-11A2-061", "MOD11A2", year, "LST_Day_1km", LST_DOY, tile, point)
                doys = sorted(set(doys) | {d for d, _ in items})
                total_k = np.zeros(g1.shape, dtype="float64")
                count = np.zeros(g1.shape, dtype="int32")
                with ThreadPoolExecutor(WORKERS) as pool:
                    for a in pool.map(lambda it, g=g1: read_window(it[1], g.window, g.shape), items):
                        ok = a >= 7500  # 0 = fill; valid range 7500-65535 (x0.02 K)
                        total_k += np.where(ok, a, 0) * 0.02
                        count += ok
                valid = count >= 3
                mean_c = np.where(valid, total_k / np.maximum(count, 1) - 273.15, 0.0)
                acc += g1.district_sums(mean_c, valid, n)
            mc, ma, nc = means(acc)
            lst_path.write_text(
                json.dumps({"year": year, "composites_doy": doys, "ids": ids, "cropland": mc, "all": ma, "n_cropland_px": nc}),
                encoding="utf-8",
            )
        print(f"{year} done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
