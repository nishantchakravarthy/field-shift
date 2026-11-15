"""Point the API at the small fixture files before the app is imported."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

FIXTURES = Path(__file__).resolve().parent / "fixtures"
os.environ["FIELD_SHIFT_DATA_DIR"] = str(FIXTURES)
os.environ["ALLOWED_ORIGINS"] = "http://localhost:3000"

from main import app  # noqa: E402


@pytest.fixture()
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
