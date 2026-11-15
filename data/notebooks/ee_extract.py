# %% [markdown]
# # Field Shift: Earth Engine extraction (alternative path)
#
# This notebook-style script reproduces the district tables with the Google
# Earth Engine Python API. It is the path for teams that have an approved
# Earth Engine account and Cloud project.
#
# **It was not run for the data shipped in this repository.** The shipped JSON
# was built from NASA's open endpoints by the scripts in `data/scripts/`
# (see the root README). Use this file to cross-check those numbers or to
# rebuild them at full resolution with a true cropland mask.
#
# Open in VS Code / Jupyter (cells are marked with `# %%`) or paste into Colab.
# Each export lands in Google Drive as a CSV, one row per district per year.
#
# Check every catalog ID in the Earth Engine data catalog before running;
# versions change.

# %%
import ee

PROJECT = "your-cloud-project-id"  # set this to your own Cloud project
DRIVE_FOLDER = "field_shift_exports"

ee.Authenticate()
ee.Initialize(project=PROJECT)

# %% [markdown]
# ## Configuration

# %%
MODELS = ["ACCESS-CM2", "MIROC6", "MRI-ESM2-0", "IPSL-CM6A-LR", "NorESM2-MM"]
SCENARIOS = ["ssp245", "ssp585"]
BASELINE_YEARS = list(range(2001, 2021))  # 2001-2014 historical, 2015-2020 SSP
FUTURE_YEARS = list(range(2041, 2061))  # labelled "2050" in the app
SEASON_START_MONTH = 6  # kharif: June
SEASON_END_MONTH = 10  # to October

CMIP6 = "NASA/GDDP-CMIP6"
IMERG = "NASA/GPM_L3/IMERG_MONTHLY_V07"
NDVI = "MODIS/061/MOD13Q1"
LST = "MODIS/061/MOD11A2"
WORLDCOVER = "ESA/WorldCover/v200"
GAUL = "FAO/GAUL/2015/level2"

# %% [markdown]
# ## Districts and cropland mask
#
# GAUL 2015 predates some district splits, so it has fewer districts than the
# present-day 31. Join on names carefully in the pandas step.

# %%
districts = ee.FeatureCollection(GAUL).filter(ee.Filter.eq("ADM1_NAME", "Karnataka"))
cropland = ee.ImageCollection(WORLDCOVER).first().eq(40).selfMask()
print("districts:", districts.size().getInfo())


def season_filter(year):
    """Date filter for the kharif season of one year."""
    start = ee.Date.fromYMD(year, SEASON_START_MONTH, 1)
    end = ee.Date.fromYMD(year, SEASON_END_MONTH, 1).advance(1, "month")
    return ee.Filter.date(start, end)


def reduce_to_districts(image, scale, extra):
    """Mean over cropland pixels per district, with `extra` columns added."""
    masked = image.updateMask(cropland)
    table = masked.reduceRegions(
        collection=districts, reducer=ee.Reducer.mean(), scale=scale, tileScale=4
    )
    return table.map(lambda f: f.set(extra).setGeometry(None))


def export(table, name, columns):
    task = ee.batch.Export.table.toDrive(
        collection=table,
        description=name,
        folder=DRIVE_FOLDER,
        fileNamePrefix=name,
        fileFormat="CSV",
        selectors=columns,
    )
    task.start()
    print("started", name)
    return task


# %% [markdown]
# ## 1. NEX-GDDP-CMIP6 seasonal climate
#
# Per model, scenario and year: kharif total rainfall (mm), mean `tas` and mean
# `tasmax` (degrees C).
#
# Units: `pr` is kg m-2 s-1, so one day is `pr * 86400` mm; temperatures are
# Kelvin, so subtract 273.15.
#
# In the catalog, years up to 2014 carry `scenario = 'historical'`; 2015 onward
# carry the SSP name. The baseline window therefore mixes both.


# %%
def cmip6_season(model, scenario, year):
    """One image with bands rain_mm, tas_c, tasmax_c for a model-year."""
    catalog_scenario = "historical" if year <= 2014 else scenario
    daily = (
        ee.ImageCollection(CMIP6)
        .filter(ee.Filter.eq("model", model))
        .filter(ee.Filter.eq("scenario", catalog_scenario))
        .filter(season_filter(year))
    )
    rain = daily.select("pr").sum().multiply(86400).rename("rain_mm")
    tas = daily.select("tas").mean().subtract(273.15).rename("tas_c")
    tasmax = daily.select("tasmax").mean().subtract(273.15).rename("tasmax_c")
    return rain.addBands(tas).addBands(tasmax)


def cmip6_table(model, scenario, years):
    tables = [
        reduce_to_districts(
            cmip6_season(model, scenario, year),
            scale=25000,
            extra={"model": model, "scenario": scenario, "year": year},
        )
        for year in years
    ]
    return ee.FeatureCollection(tables).flatten()


CMIP6_COLUMNS = ["ADM2_NAME", "model", "scenario", "year", "rain_mm", "tas_c", "tasmax_c"]

for model in MODELS:
    for scenario in SCENARIOS:
        export(
            cmip6_table(model, scenario, BASELINE_YEARS + FUTURE_YEARS),
            f"cmip6_{model}_{scenario}",
            CMIP6_COLUMNS,
        )

# %% [markdown]
# ## 2. NEX-GDDP-CMIP6 daily rainfall for monsoon onset
#
# Onset is found in pandas from daily district rainfall: the first day after
# 1 June with 5-day rain of at least 25 mm and no 7-day dry spell (under 5 mm)
# in the following 21 days. This export gives the daily series from 15 May to
# 31 October. It is the slowest export, so start it first on hackathon day, or
# cut it to three models.


# %%
def cmip6_daily_rain(model, scenario, year):
    catalog_scenario = "historical" if year <= 2014 else scenario
    daily = (
        ee.ImageCollection(CMIP6)
        .filter(ee.Filter.eq("model", model))
        .filter(ee.Filter.eq("scenario", catalog_scenario))
        .filter(ee.Filter.date(f"{year}-05-15", f"{year}-11-01"))
        .select("pr")
    )

    def per_day(image):
        rain = image.multiply(86400).rename("rain_mm")
        extra = {
            "model": model,
            "scenario": scenario,
            "date": image.date().format("YYYY-MM-dd"),
        }
        return reduce_to_districts(rain, scale=25000, extra=extra)

    return ee.FeatureCollection(daily.map(per_day)).flatten()


DAILY_COLUMNS = ["ADM2_NAME", "model", "scenario", "date", "mean"]

for model in MODELS:
    for scenario in SCENARIOS:
        for label, years in (("base", BASELINE_YEARS), ("2050", FUTURE_YEARS)):
            table = ee.FeatureCollection(
                [cmip6_daily_rain(model, scenario, year) for year in years]
            ).flatten()
            export(table, f"cmip6_daily_{model}_{scenario}_{label}", DAILY_COLUMNS)

# %% [markdown]
# ## 3. Observed kharif rainfall: GPM IMERG monthly
#
# `precipitation` is a mean rate in mm/hr, so each month is multiplied by the
# hours in that month before summing June to October.


# %%
def imerg_season(year):
    monthly = ee.ImageCollection(IMERG).filter(season_filter(year)).select("precipitation")

    def to_mm(image):
        start = image.date()
        hours = start.advance(1, "month").difference(start, "hour")
        return image.multiply(hours)

    return monthly.map(to_mm).sum().rename("rain_mm")


imerg_table = ee.FeatureCollection(
    [
        reduce_to_districts(imerg_season(year), scale=10000, extra={"year": year})
        for year in BASELINE_YEARS
    ]
).flatten()
export(imerg_table, "imerg_kharif_rain", ["ADM2_NAME", "year", "mean"])

# %% [markdown]
# ## 4. Crop greenness: MODIS MOD13Q1 peak NDVI
#
# Per-pixel maximum NDVI over the season, then the cropland mean per district.
# Scale factor 0.0001.


# %%
def ndvi_peak(year):
    season = ee.ImageCollection(NDVI).filter(season_filter(year)).select("NDVI")
    return season.max().multiply(0.0001).rename("ndvi_peak")


ndvi_table = ee.FeatureCollection(
    [
        reduce_to_districts(ndvi_peak(year), scale=250, extra={"year": year})
        for year in BASELINE_YEARS
    ]
).flatten()
export(ndvi_table, "modis_ndvi_peak", ["ADM2_NAME", "year", "mean"])

# %% [markdown]
# ## 5. Heat: MODIS MOD11A2 daytime land surface temperature
#
# Seasonal mean of `LST_Day_1km`. Scale factor 0.02, Kelvin to degrees C.


# %%
def lst_day(year):
    season = ee.ImageCollection(LST).filter(season_filter(year)).select("LST_Day_1km")
    return season.mean().multiply(0.02).subtract(273.15).rename("lst_day_c")


lst_table = ee.FeatureCollection(
    [
        reduce_to_districts(lst_day(year), scale=1000, extra={"year": year})
        for year in BASELINE_YEARS
    ]
).flatten()
export(lst_table, "modis_lst_day", ["ADM2_NAME", "year", "mean"])

# %% [markdown]
# ## 6. District boundaries

# %%
ee.batch.Export.table.toDrive(
    collection=districts.select(["ADM2_NAME"]),
    description="karnataka_districts",
    folder=DRIVE_FOLDER,
    fileNamePrefix="karnataka_districts",
    fileFormat="GeoJSON",
).start()

# %% [markdown]
# ## Check task status
#
# Single-band reductions write their value to a column called `mean`.
# Download the CSVs from Drive into `data/raw/` and join them in pandas
# (average years into the two windows first, then average the models, and use
# the same model list for both scenarios).

# %%
for task in ee.batch.Task.list()[:40]:
    status = task.status()
    print(status["description"], status["state"])
