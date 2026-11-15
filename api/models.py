"""Pydantic schemas for the Field Shift API.

These models are the data contract. `web/lib/types.ts` must match them.
Units: temperatures in degrees C, rainfall in mm, scores are integers 0-100.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class Crop(str, Enum):
    paddy = "paddy"
    ragi = "ragi"
    maize = "maize"


class Scenario(str, Enum):
    ssp245 = "ssp245"
    ssp585 = "ssp585"


class LimitingFactor(str, Enum):
    temp = "temp"
    rain = "rain"


class Contract(BaseModel):
    """Base model: unknown fields written by the data pipeline pass through."""

    model_config = ConfigDict(extra="allow")


# --- suitability_{crop}_{scenario}.json -------------------------------------


class DistrictScore(Contract):
    id: str
    baseline: int = Field(ge=0, le=100)
    y2050: int = Field(ge=0, le=100)
    change: int = Field(ge=-100, le=100, description="y2050 minus baseline")
    y2030: Optional[int] = Field(default=None, ge=0, le=100)


class Suitability(Contract):
    crop: Crop
    scenario: Scenario
    districts: List[DistrictScore]


# --- district_{id}.json ------------------------------------------------------


class History(Contract):
    years: List[int]
    rain_mm: List[Optional[float]]
    ndvi_peak: List[Optional[float]]
    lst_day_c: List[Optional[float]]


class Climate(Contract):
    temp_base_c: float
    temp_2050_c: float
    rain_base_mm: float
    rain_2050_mm: float
    onset_shift_weeks: Optional[float] = None
    tmax_base_c: Optional[float] = None
    tmax_2050_c: Optional[float] = None
    onset_base_doy: Optional[float] = None
    onset_2050_doy: Optional[float] = None


class CropScore(Contract):
    baseline: int = Field(ge=0, le=100)
    y2050: int = Field(ge=0, le=100)


class Plan(Contract):
    best_now: Crop
    best_2050: Crop
    switch: bool
    water_gap_mm: Dict[Crop, float]
    actions: List[str]
    scores: Optional[Dict[Crop, CropScore]] = None
    limiting: Optional[Dict[Crop, LimitingFactor]] = None


class District(Contract):
    id: str
    name: str
    history: History
    climate: Dict[Scenario, Climate]
    plan: Dict[Scenario, Plan]


# --- meta.json ---------------------------------------------------------------


class Dataset(Contract):
    name: str
    ee_id: Optional[str] = None
    link: Optional[str] = None
    period: Optional[str] = None


class Meta(Contract):
    datasets: List[Dataset] = Field(default_factory=list)
    models: List[str] = Field(default_factory=list)
    generated: Optional[str] = None
    limitations: List[str] = Field(default_factory=list)
    headline: Optional[Any] = None
    validation: Optional[Any] = None


# --- misc --------------------------------------------------------------------


class Health(BaseModel):
    status: str
    data_dir: str
    districts: int
    files_ok: bool
