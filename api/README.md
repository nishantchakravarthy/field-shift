# Field Shift API

Read-only FastAPI service over the precomputed files in `api/data/`.

## Run

```bash
cd api
pip install -r requirements-dev.txt
uvicorn main:app --reload --port 8000
```

Interactive docs: http://localhost:8000/docs

## Endpoints (GET only)

| URL | Returns | Errors |
| --- | --- | --- |
| `/api/districts` | district GeoJSON FeatureCollection | 503 if the file is missing |
| `/api/suitability?crop=paddy&scenario=ssp245` | `{crop, scenario, districts[{id, baseline, y2050, change, y2030?}]}` | 422 bad or missing `crop`/`scenario`, 503 file missing |
| `/api/district/{id}` | history, climate and plan for one district | 404 unknown id |
| `/api/meta` | datasets, CMIP6 models, generation date, limitations | 503 file missing |
| `/health` | `{status, data_dir, districts, files_ok}` | |

`crop` is `paddy`, `ragi` or `maize`; `scenario` is `ssp245` or `ssp585`.
District ids are lowercase slugs (`mandya`, `dakshina_kannada`).

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `FIELD_SHIFT_DATA_DIR` | `./data` | folder with the JSON files |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | comma-separated CORS origins |

Files are cached in memory and re-read when they change on disk, so the data
pipeline can replace them without a restart.

## Checks

```bash
python -m ruff check . && python -m ruff format --check .
python -m pytest -q
```

Tests run against the small fixtures in `tests/fixtures`, not the real data.
