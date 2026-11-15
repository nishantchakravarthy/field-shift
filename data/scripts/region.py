"""The study region, in one place. Every pipeline script reads its states, bounding box
and raw-data folder from here, so switching region means editing only this file.

To go back to Karnataka only: STATES = {"Karnataka": "KA"}, BBOX as noted below, TAG = "karnataka".
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

LABEL = "South India"

# geoBoundaries ADM1 shapeName -> short code (used only to make district ids unique)
STATES = {
    "Karnataka": "KA",
    "Tamil Nadu": "TN",
    "Kerala": "KL",
    "Andhra Pradesh": "AP",
    "Telangana": "TG",
    "Goa": "GA",
}

# Degrees, with a margin of at least one 0.25 degree climate cell around the states.
# Karnataka alone was {"north": 18.75, "south": 11.25, "west": 73.75, "east": 79.0}.
BBOX = {"north": 20.25, "south": 7.75, "west": 73.5, "east": 85.0}

# MODIS sinusoidal tiles that cover the states (h = column, v = row).
MODIS_TILES = ["h25v07", "h25v08", "h26v07"]

# Raw downloads for this region live in their own folder, so the Karnataka cache is kept.
TAG = "south_india"
RAW = ROOT / "data" / "raw" / TAG
