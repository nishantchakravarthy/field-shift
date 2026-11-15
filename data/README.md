# Field Shift data pipeline

Everything the app shows is computed once, offline, by the scripts in `data/scripts/`.
No script needs an account or API key.

## Run order

```bash
pip install requests pandas numpy shapely xarray netCDF4 rasterio

python data/scripts/build_geojson.py     # district boundaries        (~10 s)
python data/scripts/fetch_cmip6.py       # NEX-GDDP-CMIP6 subsets     (~30 min, ~300 MB)
python data/scripts/fetch_cmip6.py --mid # optional: adds 2021-2040
python data/scripts/process_cmip6.py     # -> raw/cmip6_district_year.csv
python data/scripts/fetch_power.py       # -> raw/power_district_year.csv
python data/scripts/fetch_modis.py       # -> raw/modis/*.json
python data/scripts/build_scores.py      # -> api/data/ and web/public/data/
python data/scripts/validate.py          # contract and sanity checks
```

Every fetch script caches into `data/raw/` and skips what is already there, so a
failed run can simply be started again.

## Sources

| Field in the app | Dataset | How it is read |
| --- | --- | --- |
| Suitability scores, temperature, rainfall, monsoon onset (baseline and 2050) | NASA NEX-GDDP-CMIP6, daily `pr`, `tas`, `tasmax`, 0.25° | NCCS THREDDS NetCDF Subset Service, Karnataka bounding box, 1 Jun – 31 Oct |
| Observed rainfall history | NASA POWER `PRECTOTCORR` (MERRA-2 bias-corrected), monthly | POWER regional API |
| Observed peak NDVI | NASA MODIS MOD13Q1 v061, 250 m | Cloud-optimised GeoTIFFs, Planetary Computer mirror of LP DAAC |
| Observed daytime LST | NASA MODIS MOD11A2 v061, 1 km | same |
| Cropland mask for NDVI and LST | ESA WorldCover v200 (2021), class 40 | Planetary Computer, ~300 m overview |
| Crop ranges | FAO ECOCROP | `data/crops.json` |
| District boundaries | geoBoundaries gbOpen IND ADM2 (ODbL) | GitHub release |

## Method in short

* District value = area-weighted mean of the grid cells that overlap the district.
* Baseline = 2001–2020 (historical run to 2014, then the scenario run). "2050" = 2041–2060.
* Years are averaged inside each model first, then the models are averaged.
* `score = 100 × min(f_temp, f_rain)`, with `f` a trapezoid built from the ECOCROP
  optimal and absolute ranges, fed with mean kharif temperature and kharif rainfall.
* Monsoon onset = first day from 1 June with 5-day rain ≥ 25 mm and no 7-day spell
  under 5 mm starting in the following 21 days.

Limitations are written into `meta.json` and shown on the methodology page.
