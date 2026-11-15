"""Minimal reader for tiled, DEFLATE-compressed cloud-optimised GeoTIFFs over HTTP.

Covers exactly what the MODIS (MOD13Q1, MOD11A2) and ESA WorldCover files on the
Planetary Computer use: classic little-endian TIFF, 512 or 1024 px tiles, DEFLATE
(compression 8), no predictor, one band, with internal overviews. It needs only
requests, zlib and numpy, so it runs where GDAL-based libraries cannot be loaded.
"""
from __future__ import annotations

import struct
import time
import zlib
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests

HEADERS = {"User-Agent": "field-shift-pipeline/1.0 (python-requests)"}
HEADER_BYTES = 1 << 18  # 256 KB holds every IFD of these files
TYPE_SIZE = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8}
TYPE_FMT = {1: "B", 3: "H", 4: "I", 16: "Q", 6: "b", 8: "h", 9: "i"}

_session = requests.Session()


def _get(url: str, start: int, end: int, tries: int = 6) -> bytes:
    """Bytes start..end inclusive, retried."""
    for attempt in range(tries):
        try:
            r = _session.get(url, headers={**HEADERS, "Range": f"bytes={start}-{end}"}, timeout=90)
            if r.status_code in (200, 206):
                return r.content if r.status_code == 206 else r.content[start : end + 1]
            err = f"HTTP {r.status_code}"
        except requests.RequestException as exc:
            err = type(exc).__name__
        time.sleep(3 * (attempt + 1))
    raise OSError(f"range read failed ({err}): {url[:80]}")


class Level:
    def __init__(self, tags: dict):
        self.width = tags[256]
        self.height = tags[257]
        self.tile_w = tags[322]
        self.tile_h = tags[323]
        self.offsets = tags[324]
        self.counts = tags[325]
        bits = tags[258]
        fmt = tags.get(339, 1)
        assert tags.get(259, 1) == 8, f"compression {tags.get(259)} not supported (DEFLATE only)"
        assert tags.get(317, 1) == 1, f"predictor {tags.get(317)} not supported"
        assert tags.get(277, 1) == 1, "single-band files only"
        self.dtype = np.dtype({(8, 1): "<u1", (16, 1): "<u2", (16, 2): "<i2", (32, 1): "<u4", (32, 2): "<i4"}[(bits, fmt)])
        self.tiles_x = (self.width + self.tile_w - 1) // self.tile_w


class COG:
    """Open a COG by URL and read windows from any of its resolution levels."""

    def __init__(self, url: str):
        self.url = url
        head = _get(url, 0, HEADER_BYTES - 1)
        assert head[:4] == b"II*\x00", "little-endian classic TIFF expected"
        self.levels: list[Level] = []
        off = struct.unpack("<I", head[4:8])[0]
        while off:
            if off + 2 > len(head):
                head += _get(url, len(head), off + 65535)
            n = struct.unpack("<H", head[off : off + 2])[0]
            tags = {}
            for k in range(n):
                e = head[off + 2 + 12 * k : off + 14 + 12 * k]
                tag, typ, count = struct.unpack("<HHI", e[:8])
                size = TYPE_SIZE.get(typ, 1) * count
                if size <= 4:
                    raw = e[8 : 8 + size]
                else:
                    ptr = struct.unpack("<I", e[8:12])[0]
                    if ptr + size > len(head):
                        raw = _get(url, ptr, ptr + size - 1)
                    else:
                        raw = head[ptr : ptr + size]
                if typ in TYPE_FMT:
                    vals = struct.unpack("<" + TYPE_FMT[typ] * count, raw[: TYPE_SIZE[typ] * count])
                    tags[tag] = vals[0] if count == 1 and tag not in (324, 325) else list(vals)
            self.levels.append(Level(tags))
            nxt = off + 2 + 12 * n
            if nxt + 4 > len(head):
                head += _get(url, len(head), nxt + 65535)
            off = struct.unpack("<I", head[nxt : nxt + 4])[0]

    def level(self, width: int) -> Level:
        for lv in self.levels:
            if lv.width == width:
                return lv
        raise ValueError(f"no level {width} px wide; have {[lv.width for lv in self.levels]}")

    def read(self, width: int, col: int, row: int, w: int, h: int, workers: int = 4) -> np.ndarray:
        """Window (col, row, w, h) in pixels of the level that is `width` pixels wide."""
        lv = self.level(width)
        out = np.zeros((h, w), dtype=lv.dtype)
        tx0, tx1 = col // lv.tile_w, (col + w - 1) // lv.tile_w
        ty0, ty1 = row // lv.tile_h, (row + h - 1) // lv.tile_h
        jobs = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]

        def fetch(job):
            tx, ty = job
            i = ty * lv.tiles_x + tx
            if lv.counts[i] == 0:
                return job, None
            data = zlib.decompress(_get(self.url, lv.offsets[i], lv.offsets[i] + lv.counts[i] - 1))
            return job, np.frombuffer(data, dtype=lv.dtype).reshape(lv.tile_h, lv.tile_w)

        with ThreadPoolExecutor(workers) as pool:
            for (tx, ty), tile in pool.map(fetch, jobs):
                if tile is None:
                    continue
                # overlap of this tile with the window, in level pixels
                x0, y0 = tx * lv.tile_w, ty * lv.tile_h
                a0, a1 = max(col, x0), min(col + w, x0 + lv.tile_w)
                b0, b1 = max(row, y0), min(row + h, y0 + lv.tile_h)
                out[b0 - row : b1 - row, a0 - col : a1 - col] = tile[b0 - y0 : b1 - y0, a0 - x0 : a1 - x0]
        return out
