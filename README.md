# Field Shift

**South India crop suitability, today and in 2050, from NASA data.**

Field Shift is one combined 3D map of 131 districts across Karnataka, Tamil
Nadu, Kerala, Andhra Pradesh, Telangana and Goa. It shows how well each
district suits paddy, ragi and maize under the climate of 2001–2020, and how
that changes by 2041–2060 ("2050") under two emission scenarios, SSP2-4.5 and
SSP5-8.5. Clicking a district opens observed rainfall, crop greenness and land
surface temperature, and an adaptation plan: the best crop now and in 2050,
the shift in monsoon onset, and the water gap for each crop.

Every number in the app is precomputed. The live app only reads static files.

**Challenge:** NASA Space Apps Challenge 2026, "Field Shift: Adapting Farms
with NASA Data".

## Features

- **Shift Map**: 3D district columns (height and colour = suitability), state
  outlines and labels, a 2001 → 2060 time slider with play, a sparkline of
  districts scoring 50+, and score / change / best-crop modes.
- **Swipe 2050**: drag a divider to compare the baseline (left) with 2050
  (right) on the same map.
- **District panel**: observed history charts, 2050 climate summary and
  adaptation plan, with the source of every figure.
- **Story mode** at `/map?story=1` and a **methodology** page.

## Quick start

Install Node 20+, then:

```bash
cd web && npm install && npm run build && npx next start -p 3000
```

Open <http://localhost:3000>. On Windows, double-click `run-field-shift.cmd`
in the repo root instead. The app runs on its own from the bundled data in
`web/public/data`; the API and the data pipeline are optional.

## Status (15 Nov 2026)

- Region extended from Karnataka to South India (6 states, 131 districts).
  Districts created after the 2021 boundary year are counted inside their
  parent district, and Yanam (Puducherry) is grouped under Andhra Pradesh.
- Climate (NEX-GDDP-CMIP6) and observed rainfall (NASA POWER) are complete
  for all districts. The MODIS NDVI and LST history was only partly
  downloaded in time: missing years show as gaps in the district charts, and
  `meta.json` lists the years included. The suitability score does not use
  MODIS. Run `python data/scripts/fetch_modis.py` then `build_scores.py` to
  complete it.
- Scoring covers the kharif season (June–October) only, so Tamil Nadu and
  coastal Andhra Pradesh, which rely on the north-east monsoon, are
  under-represented.
- The original Karnataka-only data is kept in `_backup_karnataka_data/`.

## Findings

The headline numbers, the validation result and the generation date are
written by the data pipeline to [`web/public/data/meta.json`](web/public/data/meta.json).
Quote them from that file; none are repeated here, so this README cannot go
stale.

## How it works

```
NASA open endpoints ──► data/scripts (Python) ──► final JSON + district GeoJSON
                                                     │
                              ┌──────────────────────┴───────────────┐
                              ▼                                      ▼
                     api/data  ──► FastAPI            web/public/data (bundled copy)
                                      │                              │
                                      └────────► Next.js app ◄───────┘
                                                (falls back to the bundled copy
                                                 if the API is slow or down)
```

### Suitability score (0–100)

A transparent rule, not a machine-learning model. For each crop, season
temperature and season rainfall (kharif, June–October) each get a factor from a
trapezoid: 1 inside the crop's optimal range, falling linearly to 0 at its
absolute limits. The score is `100 × min(f_temp, f_rain)`: the scarcer factor
limits the crop. Crop ranges come from FAO ECOCROP.

### Adaptation plan

- **Best crop**: the highest 2050 score. A switch is flagged when it differs
  from today's best crop and today's best crop falls below 50.
- **Sowing window shift**: change in monsoon onset date between the two
  windows, in weeks.
- **Water gap**: the crop's optimal minimum rainfall minus 2050 season
  rainfall, in mm. Positive means irrigation is needed.

## Data sources

| Use | Dataset | Access in this build |
| --- | --- | --- |
| Future and baseline climate | NASA NEX-GDDP-CMIP6 (`pr`, `tas`, `tasmax`), multi-model mean | NCCS THREDDS subset service |
| Crop greenness | NASA MODIS MOD13Q1 NDVI | Cloud-optimised GeoTIFFs, Microsoft Planetary Computer mirror |
| Land surface temperature | NASA MODIS MOD11A2 LST | Cloud-optimised GeoTIFFs, Microsoft Planetary Computer mirror |
| Observed rainfall | NASA POWER | POWER regional API |
| Cropland mask | ESA WorldCover 2021 | Microsoft Planetary Computer |
| District and state boundaries | geoBoundaries IND ADM1 / ADM2 | geoBoundaries API |
| Crop requirements | FAO ECOCROP | values in `data/crops.json` |

**How the data was pulled.** This build reads NASA data from open endpoints
that need no account: NEX-GDDP-CMIP6 through the NCCS THREDDS server, MODIS
as cloud-optimised GeoTIFFs from the Microsoft Planetary Computer mirror, and
NASA POWER through its API. The pipeline needs only `requests`, `numpy`,
`shapely` and `netCDF4`. It does not
use Google Earth Engine. `meta.json` lists the exact datasets, periods and
CMIP6 models that went into the shipped files, and is the authority if it
differs from the table above.

**Earth Engine path.** [`data/notebooks/ee_extract.py`](data/notebooks/ee_extract.py)
reproduces the extraction with the Earth Engine Python API (`NASA/GDDP-CMIP6`,
`NASA/GPM_L3/IMERG_MONTHLY_V07`, `MODIS/061/MOD13Q1`, `MODIS/061/MOD11A2`,
`ESA/WorldCover/v200`, `FAO/GAUL/2015/level2`). It is for teams with an
approved Earth Engine account and was not run for the shipped data.

## Repository layout

```
data/
  notebooks/     Earth Engine extraction (alternative path)
  scripts/       download and build scripts that write the final JSON
  raw/           downloaded intermediates (git-ignored)
api/
  main.py        FastAPI app
  models.py      Pydantic schemas = the data contract
  data/          final JSON files served by the API
  tests/         pytest suite with small fixtures
web/
  app/           Next.js routes
  components/    map, slider, district panel, charts
  lib/           API client, types, colour scales, store
  public/data/   bundled copy of the final JSON (offline fallback)
```

## Run it locally

Requirements: Python 3.10 or newer, Node 20 or newer.

### 1. Data (optional; the final files are committed)

```bash
python data/scripts/build_geojson.py
python data/scripts/fetch_cmip6.py --mid
python data/scripts/process_cmip6.py
python data/scripts/fetch_power.py
python data/scripts/fetch_modis.py
python data/scripts/build_scores.py
python data/scripts/validate.py
```

Run from the repo root, in this order; see `data/README.md` for dependencies.
The fetch scripts are resumable and need no account (a full run is about an hour).
The scripts write the final files to both `api/data/` and `web/public/data/`.
The two folders must hold the same files.

### 2. API

```bash
cd api
pip install -r requirements-dev.txt
uvicorn main:app --reload --port 8000
```

Docs at http://localhost:8000/docs.

| Endpoint | Returns |
| --- | --- |
| `GET /api/districts` | district GeoJSON |
| `GET /api/suitability?crop=paddy&scenario=ssp245` | baseline and 2050 scores for every district |
| `GET /api/district/{id}` | history series, climate summary, adaptation plan |
| `GET /api/meta` | datasets, CMIP6 models, generation date, limitations |
| `GET /health` | service and data status |

Unknown district: 404. Bad `crop` or `scenario`: 422.

### 3. Web

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000. The app works without the API: it reads
`web/public/data/` whenever the API is unset, slow or down.

### Checks

```bash
cd api && python -m ruff check . && python -m pytest -q
cd web && npx tsc --noEmit && npm run lint && npm run build
```

GitHub Actions runs the same checks on every push (`.github/workflows/ci.yml`).

## Deploy

- **Frontend (Vercel).** Import the repository and set the root directory to
  `web`. The bundled data ships with the build, so the site works on its own.
  Set `NEXT_PUBLIC_API_URL` (see `web/.env.example`) to the deployed API. The
  landing and methodology pages read `web/public/data` at build time, so
  rebuild after regenerating data.
- **API (Render).** `render.yaml` defines the service (root directory `api`).
  Set `ALLOWED_ORIGINS` to the Vercel URL; CORS allows only the origins listed
  there. `api/Dockerfile` is provided for Fly.io or Railway.

Free Render services sleep when idle. The frontend's bundled fallback covers
the cold start.

## Limitations

- **Rainfed only.** Irrigation is not modelled, so irrigated districts (canal
  paddy, for example) score lower than what farmers achieve today.
- **District averages** hide variation between taluks and fields.
- **Kharif only.** The north-east monsoon (October–December) and the rabi
  season are not scored.
- **Climate grid is about 25 km.** Small and coastal districts are covered by
  few grid cells.
- **Crop ranges are global** values from FAO ECOCROP, not tuned to local
  varieties.
- **Two factors only**: season temperature and rainfall. Soil, pests, prices
  and extreme events within a season are not scored.
- **Projections are scenarios, not forecasts.** The result is a multi-model
  mean; individual models differ.

`meta.json` and the app's methodology page carry the limitations specific to
the shipped data.

## Team

| Role | Name |
| --- | --- |
| Data lead | _add name_ |
| Backend and model lead | _add name_ |
| Map lead (frontend) | Nishant Chakravarthy |
| UI and story lead | _add name_ |

## Use of AI tools

AI coding assistance (Claude Code, by Anthropic) was used to write code and
documentation in this repository. All data comes from the NASA and FAO sources
listed above; no data, imagery or results were generated by AI.

## Credits

NASA NEX-GDDP-CMIP6 (NASA Center for Climate Simulation), MODIS (NASA LP DAAC,
via the Microsoft Planetary Computer), NASA POWER (NASA Langley Research
Center), ESA WorldCover, geoBoundaries, FAO ECOCROP.
NASA does not endorse this project.
