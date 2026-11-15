"""Endpoint tests against the fixture data in tests/fixtures."""

from __future__ import annotations

from fastapi.testclient import TestClient

from models import District, Meta, Suitability


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["districts"] == 1
    assert body["files_ok"] is True


def test_districts_geojson(client: TestClient) -> None:
    response = client.get("/api/districts")
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert {f["properties"]["id"] for f in body["features"]} == {"testpur", "sample_nagar"}
    assert "max-age" in response.headers["cache-control"]


def test_suitability_ok(client: TestClient) -> None:
    response = client.get("/api/suitability", params={"crop": "paddy", "scenario": "ssp245"})
    assert response.status_code == 200
    parsed = Suitability.model_validate(response.json())
    assert parsed.crop.value == "paddy"
    assert len(parsed.districts) == 2
    for item in parsed.districts:
        assert item.change == item.y2050 - item.baseline
    by_id = {d["id"]: d for d in response.json()["districts"]}
    assert by_id["testpur"]["y2030"] == 62
    assert "y2030" not in by_id["sample_nagar"]


def test_suitability_bad_crop_is_422(client: TestClient) -> None:
    response = client.get("/api/suitability", params={"crop": "wheat", "scenario": "ssp245"})
    assert response.status_code == 422


def test_suitability_bad_scenario_is_422(client: TestClient) -> None:
    response = client.get("/api/suitability", params={"crop": "paddy", "scenario": "ssp999"})
    assert response.status_code == 422


def test_suitability_missing_params_is_422(client: TestClient) -> None:
    assert client.get("/api/suitability").status_code == 422


def test_suitability_missing_file_is_503(client: TestClient) -> None:
    response = client.get("/api/suitability", params={"crop": "maize", "scenario": "ssp585"})
    assert response.status_code == 503


def test_district_ok(client: TestClient) -> None:
    response = client.get("/api/district/testpur")
    assert response.status_code == 200
    parsed = District.model_validate(response.json())
    assert parsed.name == "Testpur"
    assert len(parsed.history.years) == len(parsed.history.rain_mm) == 3
    body = response.json()
    assert body["climate"]["ssp245"]["tmax_2050_c"] == 32.6
    assert body["plan"]["ssp245"]["scores"]["ragi"] == {"baseline": 65, "y2050": 80}
    assert body["plan"]["ssp245"]["limiting"]["paddy"] == "rain"
    assert "scores" not in body["plan"]["ssp585"]


def test_district_unknown_is_404(client: TestClient) -> None:
    response = client.get("/api/district/atlantis")
    assert response.status_code == 404
    assert "atlantis" in response.json()["detail"]


def test_district_bad_id_is_404(client: TestClient) -> None:
    assert client.get("/api/district/..%5Cmeta").status_code == 404
    assert client.get("/api/district/Testpur").status_code == 404


def test_meta_keeps_extras(client: TestClient) -> None:
    response = client.get("/api/meta")
    assert response.status_code == 200
    body = response.json()
    parsed = Meta.model_validate(body)
    assert parsed.models == ["ACCESS-CM2", "MIROC6", "MRI-ESM2-0"]
    assert parsed.datasets[0].ee_id == "NASA/GDDP-CMIP6"
    assert body["fixture_only_extra"] == "kept"


def test_post_not_allowed(client: TestClient) -> None:
    assert client.post("/api/meta").status_code == 405


def test_cors_allows_only_configured_origin(client: TestClient) -> None:
    allowed = client.get("/api/meta", headers={"Origin": "http://localhost:3000"})
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:3000"
    blocked = client.get("/api/meta", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in blocked.headers


def test_gzip_applied(client: TestClient) -> None:
    response = client.get("/api/district/testpur", headers={"Accept-Encoding": "gzip"})
    assert response.headers.get("content-encoding") == "gzip"
