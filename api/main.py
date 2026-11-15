"""Field Shift API: read-only access to the precomputed Karnataka crop files.

Run from this directory:  uvicorn main:app --reload --port 8000

Environment:
  FIELD_SHIFT_DATA_DIR  directory holding the JSON files (default: ./data)
  ALLOWED_ORIGINS       comma-separated CORS origins (default: localhost:3000)
"""

from __future__ import annotations

import json
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Dict, Tuple

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from models import Crop, District, Health, Meta, Scenario, Suitability

DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
DISTRICT_ID = re.compile(r"^[a-z0-9_]{1,64}$")
CACHE_HEADER = "public, max-age=300"


def data_dir() -> Path:
    return Path(os.environ.get("FIELD_SHIFT_DATA_DIR", str(DEFAULT_DATA_DIR)))


def allowed_origins() -> list[str]:
    raw = os.environ.get("ALLOWED_ORIGINS", DEFAULT_ORIGINS)
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


class DataStore:
    """Reads JSON files once and re-reads only when a file changes on disk."""

    def __init__(self) -> None:
        self._cache: Dict[Path, Tuple[int, Any]] = {}

    def load(self, name: str) -> Any:
        """Return parsed JSON for `name`, or raise FileNotFoundError."""
        path = data_dir() / name
        mtime = path.stat().st_mtime_ns
        cached = self._cache.get(path)
        if cached is not None and cached[0] == mtime:
            return cached[1]
        with path.open(encoding="utf-8") as handle:
            payload = json.load(handle)
        self._cache[path] = (mtime, payload)
        return payload

    def warm(self) -> int:
        """Preload every JSON/GeoJSON file; unreadable files are skipped."""
        loaded = 0
        folder = data_dir()
        if not folder.is_dir():
            return loaded
        for path in sorted(folder.iterdir()):
            if path.suffix in {".json", ".geojson"}:
                try:
                    self.load(path.name)
                    loaded += 1
                except (OSError, ValueError):
                    continue
        return loaded


store = DataStore()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    store.warm()
    yield


app = FastAPI(
    title="Field Shift API",
    description=(
        "Precomputed crop suitability for Karnataka districts, baseline "
        "(2001-2020) and 2050 (2041-2060), from NASA NEX-GDDP-CMIP6, GPM IMERG "
        "and MODIS. All endpoints are read-only."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_methods=["GET"],
    allow_headers=["*"],
)


def read_or_503(name: str) -> Any:
    try:
        return store.load(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"Data file missing: {name}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=f"Data file unreadable: {name}") from exc


@app.get("/health", response_model=Health, tags=["ops"])
def health() -> Health:
    folder = data_dir()
    districts = len(list(folder.glob("district_*.json"))) if folder.is_dir() else 0
    files_ok = (folder / "districts.geojson").is_file() and (folder / "meta.json").is_file()
    return Health(status="ok", data_dir=folder.name, districts=districts, files_ok=files_ok)


@app.get("/api/districts", tags=["data"])
def get_districts(response: Response) -> Dict[str, Any]:
    """Simplified district boundaries as a GeoJSON FeatureCollection."""
    response.headers["Cache-Control"] = CACHE_HEADER
    return read_or_503("districts.geojson")


@app.get(
    "/api/suitability",
    response_model=Suitability,
    response_model_exclude_none=True,
    tags=["data"],
)
def get_suitability(
    response: Response,
    crop: Crop = Query(..., description="paddy, ragi or maize"),
    scenario: Scenario = Query(..., description="ssp245 or ssp585"),
) -> Any:
    """Baseline and 2050 suitability scores (0-100) for every district."""
    response.headers["Cache-Control"] = CACHE_HEADER
    return read_or_503(f"suitability_{crop.value}_{scenario.value}.json")


@app.get(
    "/api/district/{district_id}",
    response_model=District,
    response_model_exclude_none=True,
    tags=["data"],
)
def get_district(district_id: str, response: Response) -> Any:
    """History series, climate summary and adaptation plan for one district."""
    if not DISTRICT_ID.match(district_id):
        raise HTTPException(status_code=404, detail=f"Unknown district: {district_id}")
    try:
        payload = store.load(f"district_{district_id}.json")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown district: {district_id}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="District file unreadable") from exc
    response.headers["Cache-Control"] = CACHE_HEADER
    return payload


@app.get("/api/meta", response_model=Meta, response_model_exclude_none=True, tags=["data"])
def get_meta(response: Response) -> Any:
    """Datasets, CMIP6 models, generation date and stated limitations."""
    response.headers["Cache-Control"] = CACHE_HEADER
    return read_or_503("meta.json")
