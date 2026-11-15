"""Join the extracted tables, score crop suitability and write the app's JSON files.

Inputs (all produced by the other scripts in this folder):
  data/raw/{region}/cmip6_district_year.csv   NEX-GDDP-CMIP6 kharif climate per model/year/district
  data/raw/{region}/power_district_year.csv   observed kharif rainfall (NASA POWER)
  data/raw/{region}/modis/*.json              observed peak NDVI and daytime LST (MODIS)
  data/crops.json                    FAO ECOCROP ranges

Outputs, written identically to api/data/ and web/public/data/:
  suitability_{crop}_{scenario}.json, district_{id}.json, meta.json

Score: f(x) is a trapezoid, 1 inside the crop's optimal range and falling linearly
to 0 at its absolute limits. score = 100 x min(f_temp(mean kharif temperature),
f_rain(kharif rainfall)). Climate is the ensemble mean of the listed CMIP6 models.

Usage: python data/scripts/build_scores.py
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import csv
import math
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from region import LABEL, MODIS_TILES, STATES  # noqa: E402
from region import RAW  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT_DIRS = [ROOT / "api" / "data", ROOT / "web" / "public" / "data"]

CROPS = ["paddy", "ragi", "maize"]
SCENARIOS = ["ssp245", "ssp585"]
BASE_YEARS = range(2001, 2021)
MID_YEARS = range(2021, 2041)
FUT_YEARS = range(2041, 2061)
MIN_CROPLAND = 0.05  # below this cropland share, MODIS stats use all pixels
CLIMATE_VARS = ["rain_mm", "tas_c", "tasmax_c", "onset_doy"]


def trapezoid(x: float, opt: list[float], absolute: list[float]) -> float:
    a_min, a_max = absolute
    o_min, o_max = opt
    if x <= a_min or x >= a_max:
        return 0.0
    if x < o_min:
        return (x - a_min) / (o_min - a_min)
    if x <= o_max:
        return 1.0
    return (a_max - x) / (a_max - o_max)


def headroom(x: float, opt: list[float]) -> float:
    """Distance inside the optimal range as a share of its width (negative = outside)."""
    return min(x - opt[0], opt[1] - x) / (opt[1] - opt[0])


def crop_eval(crop: dict, temp: float, rain: float) -> dict:
    f_t = trapezoid(temp, crop["temp_opt"], crop["temp_abs"])
    f_r = trapezoid(rain, crop["rain_opt"], crop["rain_abs"])
    h_t = headroom(temp, crop["temp_opt"])
    h_r = headroom(rain, crop["rain_opt"])
    if f_t != f_r:
        limiting = "temp" if f_t < f_r else "rain"
    else:
        limiting = "temp" if h_t < h_r else "rain"
    return {"score": int(round(100 * min(f_t, f_r))), "limiting": limiting, "margin": min(h_t, h_r)}


def best_crop(evals: dict[str, dict]) -> str:
    """Highest score; ties go to the crop sitting deepest inside its optimal ranges."""
    return max(CROPS, key=lambda c: (evals[c]["score"], evals[c]["margin"]))


def r1(x: float) -> float:
    return round(float(x), 1)


def doy_to_date(doy: float) -> str:
    d = dt.date(2021, 1, 1) + dt.timedelta(days=int(round(doy)) - 1)
    return f"{d.day} {d.strftime('%b')}"


def _num(x: str) -> float:
    return float(x) if x not in ("", "nan", "NaN") else math.nan


def load_cmip6(path: Path) -> list[dict]:
    """Rows of cmip6_district_year.csv with numbers parsed (missing onset = NaN)."""
    with path.open(newline="", encoding="utf-8") as fh:
        return [
            {"model": r["model"], "scenario": r["scenario"], "year": int(r["year"]), "id": r["id"], **{v: _num(r[v]) for v in CLIMATE_VARS}}
            for r in csv.DictReader(fh)
        ]


def _mean(values: list[float]) -> float:
    """Mean ignoring NaN (as pandas does); NaN when nothing is left."""
    ok = [v for v in values if not math.isnan(v)]
    return sum(ok) / len(ok) if ok else math.nan


def window_means(rows: list[dict], scenario: str, years: range, models: list[str]) -> tuple[dict, dict]:
    """Ensemble mean per district: average years within each model, then models.

    Returns ({id: {var: value}}, {(model, id): {var: value}})."""
    scen, yrs, ms = {"historical", scenario}, set(years), set(models)
    groups: dict[tuple[str, str], dict[str, list[float]]] = {}
    for r in rows:
        if r["model"] in ms and r["scenario"] in scen and r["year"] in yrs:
            g = groups.setdefault((r["model"], r["id"]), {v: [] for v in CLIMATE_VARS})
            for v in CLIMATE_VARS:
                g[v].append(r[v])
    per_model = {k: {v: _mean(vals) for v, vals in g.items()} for k, g in groups.items()}
    by_id: dict[str, dict[str, list[float]]] = {}
    for (_, did), vals in per_model.items():
        g = by_id.setdefault(did, {v: [] for v in CLIMATE_VARS})
        for v in CLIMATE_VARS:
            g[v].append(vals[v])
    return {did: {v: _mean(vals) for v, vals in g.items()} for did, g in by_id.items()}, per_model


def complete_models(rows: list[dict], years_by_scen: dict[str, set[int]]) -> list[str]:
    have: dict[str, dict[str, set[int]]] = {}
    for r in rows:
        have.setdefault(r["model"], {}).setdefault(r["scenario"], set()).add(r["year"])
    return sorted(m for m, by in have.items() if all(need <= by.get(s, set()) for s, need in years_by_scen.items()))


def build_actions(names: dict, p: dict, clim: dict, crops: dict) -> list[str]:
    now, fut = p["best_now"], p["best_2050"]
    s = p["scores"]
    actions = []
    if now != fut:
        verb = "Switch" if p["switch"] else "Start moving"
        actions.append(
            f"{verb} the main rainfed crop from {names[now]} to {names[fut]}: {names[now]} suitability goes "
            f"{s[now]['baseline']} → {s[now]['y2050']}, {names[fut]} {s[fut]['baseline']} → {s[fut]['y2050']}."
        )
    else:
        actions.append(
            f"Keep {names[fut]} as the main rainfed crop: suitability {s[fut]['baseline']} → {s[fut]['y2050']} by 2050, "
            f"no other crop scores higher."
        )

    shift = clim["onset_shift_weeks"]
    span = f"monsoon onset moves from {doy_to_date(clim['onset_base_doy'])} to {doy_to_date(clim['onset_2050_doy'])}"
    if abs(shift) >= 0.5:
        direction = "later" if shift > 0 else "earlier"
        actions.append(f"Shift sowing {abs(shift):.1f} weeks {direction}: projected {span}.")
    else:
        actions.append(f"Keep the current sowing window: projected {span} ({shift:+.1f} weeks).")

    rain, gap = clim["rain_2050_mm"], p["water_gap_mm"][fut]
    opt = crops[fut]["rain_opt"]
    d_temp = clim["temp_2050_c"] - clim["temp_base_c"]
    if gap > 0:
        actions.append(
            f"Plan for {gap:.0f} mm of supplemental irrigation for {names[fut]}: projected kharif rain is "
            f"{rain:.0f} mm against an optimal minimum of {opt[0]:.0f} mm."
        )
    elif rain > opt[1]:
        actions.append(
            f"Plan field drainage: projected kharif rain of {rain:.0f} mm is {rain - opt[1]:.0f} mm above "
            f"{names[fut]}'s optimal maximum of {opt[1]:.0f} mm."
        )
    else:
        actions.append(
            f"Prepare for heat: mean kharif temperature rises {d_temp:+.1f} °C ({clim['temp_base_c']:.1f} → "
            f"{clim['temp_2050_c']:.1f} °C) and the mean daily maximum reaches {clim['tmax_2050_c']:.1f} °C."
        )
    return actions


def pearson(a: list[float], b: list[float]) -> float:
    return float(np.corrcoef(np.array(a, dtype=float), np.array(b, dtype=float))[0, 1])


def main() -> None:
    crops_file = json.loads((ROOT / "data" / "crops.json").read_text(encoding="utf-8"))
    crops = {c: crops_file[c] for c in CROPS}
    names = {"paddy": "paddy", "ragi": "ragi", "maize": "maize"}
    geo = json.loads((ROOT / "web" / "public" / "data" / "districts.geojson").read_text(encoding="utf-8"))
    districts = [(f["properties"]["id"], f["properties"]["name"]) for f in geo["features"]]
    state_of = {f["properties"]["id"]: f["properties"].get("state", LABEL) for f in geo["features"]}
    ids = [d for d, _ in districts]

    cm = load_cmip6(RAW / "cmip6_district_year.csv")
    need = {"historical": set(range(2001, 2015))}
    for s in SCENARIOS:
        need[s] = set(range(2015, 2021)) | set(FUT_YEARS)
    models = complete_models(cm, need)
    assert len(models) >= 3, f"need at least 3 complete models, have {models}"
    need_mid = {s: need[s] | set(MID_YEARS) for s in SCENARIOS} | {"historical": need["historical"]}
    has_mid = complete_models(cm, need_mid) == models
    used = [r for r in cm if r["model"] in models]
    onset_missing_pct = 100.0 * sum(math.isnan(r["onset_doy"]) for r in used) / len(used)

    power: dict[int, dict[str, float]] = {}
    with (RAW / "power_district_year.csv").open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            power.setdefault(int(r["year"]), {})[r["id"]] = float(r["rain_mm"])
    cropland = json.loads((RAW / "modis" / "cropland.json").read_text(encoding="utf-8"))
    modis: dict[str, dict[int, dict]] = {"ndvi": {}, "lst": {}}
    for kind in modis:
        for year in BASE_YEARS:
            path = RAW / "modis" / f"{kind}_{year}.json"
            if not path.exists():  # year not downloaded: shown as a gap in the chart
                continue
            rec = json.loads(path.read_text(encoding="utf-8"))
            modis[kind][year] = {
                did: {"cropland": rec["cropland"][i], "all": rec["all"][i]} for i, did in enumerate(rec["ids"])
            }

    def modis_value(kind: str, year: int, did: str) -> float | None:
        if year not in modis[kind]:
            return None
        rec = modis[kind][year][did]
        use_crop = cropland[did] >= MIN_CROPLAND and rec["cropland"] is not None
        val = rec["cropland"] if use_crop else rec["all"]
        return val

    # ---- climate windows and scores -------------------------------------------------
    result: dict[str, dict[str, dict]] = {s: {} for s in SCENARIOS}
    for scen in SCENARIOS:
        base, base_pm = window_means(cm, scen, BASE_YEARS, models)
        fut, fut_pm = window_means(cm, scen, FUT_YEARS, models)
        mid = window_means(cm, scen, MID_YEARS, models)[0] if has_mid else None
        for did in ids:
            b, f = base[did], fut[did]
            assert all(math.isfinite(b[v]) and math.isfinite(f[v]) for v in CLIMATE_VARS), (did, b, f)
            ev_b = {c: crop_eval(crops[c], b["tas_c"], b["rain_mm"]) for c in CROPS}
            ev_f = {c: crop_eval(crops[c], f["tas_c"], f["rain_mm"]) for c in CROPS}
            ev_m = None
            if mid is not None:
                m = mid[did]
                ev_m = {c: crop_eval(crops[c], m["tas_c"], m["rain_mm"]) for c in CROPS}
            d_rain = [fut_pm[(mo, did)]["rain_mm"] - base_pm[(mo, did)]["rain_mm"] for mo in models]
            d_temp = [fut_pm[(mo, did)]["tas_c"] - base_pm[(mo, did)]["tas_c"] for mo in models]
            clim = {
                "temp_base_c": r1(b["tas_c"]),
                "temp_2050_c": r1(f["tas_c"]),
                "rain_base_mm": r1(b["rain_mm"]),
                "rain_2050_mm": r1(f["rain_mm"]),
                "onset_shift_weeks": r1((f["onset_doy"] - b["onset_doy"]) / 7.0),
                "tmax_base_c": r1(b["tasmax_c"]),
                "tmax_2050_c": r1(f["tasmax_c"]),
                "onset_base_doy": r1(b["onset_doy"]),
                "onset_2050_doy": r1(f["onset_doy"]),
                "rain_change_pct": r1(100.0 * (f["rain_mm"] - b["rain_mm"]) / b["rain_mm"]),
                "models_wetter": int(sum(x > 0 for x in d_rain)),
                "temp_change_range_c": [r1(min(d_temp)), r1(max(d_temp))],
            }
            now, future = best_crop(ev_b), best_crop(ev_f)
            if ev_f[now]["score"] == ev_f[future]["score"]:
                future = now  # a tie in 2050 is no reason to change crop
            plan = {
                "best_now": now,
                "best_2050": future,
                "switch": bool(now != future and ev_f[now]["score"] < 50),
                "water_gap_mm": {c: r1(max(0.0, crops[c]["rain_opt"][0] - f["rain_mm"])) for c in CROPS},
                "scores": {c: {"baseline": ev_b[c]["score"], "y2050": ev_f[c]["score"]} for c in CROPS},
                "limiting": {c: ev_f[c]["limiting"] for c in CROPS},
            }
            plan["actions"] = build_actions(names, plan, clim, crops)
            result[scen][did] = {"climate": clim, "plan": plan, "ev_b": ev_b, "ev_f": ev_f, "ev_m": ev_m}

    # ---- write files -----------------------------------------------------------------
    files: dict[str, dict] = {}
    for crop in CROPS:
        for scen in SCENARIOS:
            rows = []
            for did in ids:
                r = result[scen][did]
                row = {
                    "id": did,
                    "baseline": r["ev_b"][crop]["score"],
                    "y2050": r["ev_f"][crop]["score"],
                    "change": r["ev_f"][crop]["score"] - r["ev_b"][crop]["score"],
                }
                if r["ev_m"] is not None:
                    row["y2030"] = r["ev_m"][crop]["score"]
                rows.append(row)
            files[f"suitability_{crop}_{scen}.json"] = {"crop": crop, "scenario": scen, "districts": rows}

    years = list(BASE_YEARS)
    ndvi_mean = {}
    for did, name in districts:
        ndvi = [None if (v := modis_value("ndvi", y, did)) is None else round(v, 3) for y in years]
        got = [v for v in ndvi if v is not None]
        ndvi_mean[did] = float(np.mean(got)) if got else float("nan")
        files[f"district_{did}.json"] = {
            "id": did,
            "name": name,
            "state": state_of[did],
            "history": {
                "years": years,
                "rain_mm": [r1(power[y][did]) for y in years],
                "ndvi_peak": ndvi,
                "lst_day_c": [None if (v := modis_value("lst", y, did)) is None else r1(v) for y in years],
                "modis_mask": "cropland" if cropland[did] >= MIN_CROPLAND else "all land",
                "cropland_share": round(cropland[did], 3),
            },
            "climate": {s: result[s][did]["climate"] for s in SCENARIOS},
            "plan": {s: result[s][did]["plan"] for s in SCENARIOS},
        }

    # ---- headline numbers and validation ---------------------------------------------
    name_of = dict(districts)
    headline: dict[str, dict] = {}
    for scen in SCENARIOS:
        per_crop = {}
        for crop in CROPS:
            rows = files[f"suitability_{crop}_{scen}.json"]["districts"]
            ordered = sorted(rows, key=lambda r: r["change"])
            per_crop[crop] = {
                "districts_losing": sum(r["change"] < 0 for r in rows),
                "districts_gaining": sum(r["change"] > 0 for r in rows),
                "districts_unchanged": sum(r["change"] == 0 for r in rows),
                "suitable_now": sum(r["baseline"] >= 50 for r in rows),
                "suitable_2050": sum(r["y2050"] >= 50 for r in rows),
                "mean_baseline": r1(np.mean([r["baseline"] for r in rows])),
                "mean_2050": r1(np.mean([r["y2050"] for r in rows])),
                "biggest_drop": {"id": ordered[0]["id"], "name": name_of[ordered[0]["id"]], "baseline": ordered[0]["baseline"], "y2050": ordered[0]["y2050"], "change": ordered[0]["change"]},
                "biggest_gain": {"id": ordered[-1]["id"], "name": name_of[ordered[-1]["id"]], "baseline": ordered[-1]["baseline"], "y2050": ordered[-1]["y2050"], "change": ordered[-1]["change"]},
            }
        clim = [result[scen][d]["climate"] for d in ids]
        headline[scen] = {
            "crops": per_crop,
            "districts_best_crop_changes": sum(result[scen][d]["plan"]["best_now"] != result[scen][d]["plan"]["best_2050"] for d in ids),
            "districts_switch_flag": sum(result[scen][d]["plan"]["switch"] for d in ids),
            "mean_warming_c": r1(np.mean([c["temp_2050_c"] - c["temp_base_c"] for c in clim])),
            "mean_rain_change_pct": r1(np.mean([c["rain_change_pct"] for c in clim])),
            "mean_onset_shift_weeks": r1(np.mean([c["onset_shift_weeks"] for c in clim])),
        }

    ref = SCENARIOS[0]
    ndvi_vec = [ndvi_mean[d] for d in ids]
    best_score = [max(result[ref][d]["ev_b"][c]["score"] for c in CROPS) for d in ids]
    per_crop_r = {c: round(pearson([result[ref][d]["ev_b"][c]["score"] for d in ids], ndvi_vec), 2) for c in CROPS}
    rain_model = [result[ref][d]["climate"]["rain_base_mm"] for d in ids]
    rain_obs = [float(np.mean([power[y][d] for y in years])) for d in ids]
    validation = {
        "pearson_r": round(pearson(best_score, ndvi_vec), 2),
        "n": len(ids),
        "description": "Pearson correlation across districts between the baseline (2001–2020) score of the best-scoring crop and the 2001–2020 mean observed peak NDVI (MODIS MOD13Q1).",
        "note": "The best-crop score barely varies (most districts score 100 for ragi or maize), so this correlation is weak. Per crop, paddy scores track greenness because both follow rainfall; ragi and maize score highest in the drier, less green interior.",
        "per_crop_score_vs_ndvi_r": per_crop_r,
        "rain_model_vs_observed_r": round(pearson(rain_model, rain_obs), 2),
        "rain_model_vs_observed_description": "Pearson correlation across districts between CMIP6 ensemble baseline kharif rainfall and NASA POWER observed kharif rainfall, 2001–2020.",
        "rain_model_minus_observed_mean_mm": r1(np.mean(np.array(rain_model) - np.array(rain_obs))),
    }

    windows = {"baseline": "2001–2020", "y2050": "2041–2060"}
    if has_mid:
        windows["y2030"] = "2021–2040"
    meta = {
        "generated": dt.date.today().isoformat(),
        "region": f"{LABEL}, India",
        "states": {st: sum(1 for d in ids if state_of[d] == st) for st in STATES},
        "season": "Kharif, 1 June – 31 October",
        "models": models,
        "scenarios": SCENARIOS,
        "windows": windows,
        "datasets": [
            {
                "name": "NASA NEX-GDDP-CMIP6",
                "ee_id": "NASA/GDDP-CMIP6",
                "endpoint": "NCCS THREDDS NetCDF Subset Service, AMES/NEX/GDDP-CMIP6",
                "link": "https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6",
                "period": "2001–2014 historical; 2015–2020 and 2041–2060 under SSP2-4.5 and SSP5-8.5" + ("; 2021–2040" if has_mid else ""),
                "resolution": "0.25° (~25 km), daily",
                "variables": "pr, tas, tasmax",
                "use": "Baseline and 2050 kharif temperature, rainfall and monsoon onset behind every suitability score",
            },
            {
                "name": "NASA POWER PRECTOTCORR (MERRA-2 bias-corrected precipitation)",
                "ee_id": "POWER monthly regional API",
                "endpoint": "https://power.larc.nasa.gov/api/temporal/monthly/regional",
                "link": "https://power.larc.nasa.gov/",
                "period": "2001–2020",
                "resolution": "0.5° × 0.625°, monthly",
                "variables": "PRECTOTCORR",
                "use": "Observed kharif rainfall history chart",
            },
            {
                "name": "NASA MODIS Terra Vegetation Indices (MOD13Q1 v061)",
                "ee_id": "MODIS/061/MOD13Q1",
                "endpoint": "LP DAAC product read as cloud-optimised GeoTIFF from the Microsoft Planetary Computer mirror (collection modis-13Q1-061), tiles " + ", ".join(MODIS_TILES),
                "link": "https://lpdaac.usgs.gov/products/mod13q1v061/",
                "period": "2001–2020",
                "resolution": "250 m, 16-day",
                "variables": "250m_16_days_NDVI",
                "use": "Observed peak NDVI history chart (per-pixel kharif maximum, cropland mean) and score validation",
            },
            {
                "name": "NASA MODIS Terra Land Surface Temperature (MOD11A2 v061)",
                "ee_id": "MODIS/061/MOD11A2",
                "endpoint": "LP DAAC product read as cloud-optimised GeoTIFF from the Microsoft Planetary Computer mirror (collection modis-11A2-061), tiles " + ", ".join(MODIS_TILES),
                "link": "https://lpdaac.usgs.gov/products/mod11a2v061/",
                "period": "2001–2020",
                "resolution": "1 km, 8-day",
                "variables": "LST_Day_1km",
                "use": "Observed daytime LST history chart (June–October mean over cropland)",
            },
            {
                "name": "ESA WorldCover v200",
                "ee_id": "ESA/WorldCover/v200",
                "endpoint": "Microsoft Planetary Computer collection esa-worldcover, read at ~300 m overview",
                "link": "https://esa-worldcover.org/",
                "period": "2021",
                "resolution": "10 m (sampled at ~300 m)",
                "variables": "class 40 = cropland",
                "use": "Cropland mask for the MODIS NDVI and LST district means",
            },
            {
                "name": "FAO ECOCROP",
                "ee_id": "not in Earth Engine",
                "endpoint": "EcoCrop_DB.csv",
                "link": "https://github.com/OpenCLIM/ecocrop",
                "period": "static",
                "resolution": "per crop",
                "variables": "optimal and absolute temperature and rainfall ranges",
                "use": "Crop requirement ranges in the suitability score",
            },
            {
                "name": "geoBoundaries gbOpen IND ADM2",
                "ee_id": "not in Earth Engine",
                "endpoint": "geoBoundaries release 9469f09",
                "link": "https://www.geoboundaries.org/",
                "period": "boundary year 2021",
                "resolution": "vector",
                "variables": "district polygons",
                "use": "District boundaries for the map and for every district average",
            },
        ],
        "crops": {
            c: {
                "temp_opt": crops[c]["temp_opt"],
                "temp_abs": crops[c]["temp_abs"],
                "rain_opt": crops[c]["rain_opt"],
                "rain_abs": crops[c]["rain_abs"],
                "source": f"FAO ECOCROP, {crops[c]['ecocrop_name']}",
            }
            for c in CROPS
        },
        "score": "score = 100 × min(f_temp(mean kharif temperature), f_rain(kharif rainfall)); f is 1 inside the optimal range and falls linearly to 0 at the absolute limits.",
        "boundaries": {
            "source": "geoBoundaries gbOpen IND ADM2 (Pathways Data Pvt. Ltd., lgdirectory.gov.in), boundary year 2021",
            "licence": "Open Data Commons Open Database License 1.0",
            "district_count": len(ids),
            "note": f"{len(ids)} districts across {', '.join(STATES)}. Districts created after the 2021 boundary year (for example Vijayanagara in Karnataka, or Andhra Pradesh's 2022 districts) are not separated and are counted inside their parent district.",
        },
        "validation": validation,
        "limitations": [
            "Rainfed only: irrigation is not modelled, so canal- and tank-irrigated paddy districts (Mandya, the Kaveri and Godavari deltas) score low for paddy on rainfall alone.",
            "Scores use district averages of ~25 km climate grid cells; local variation inside a district, steep coastal and Western Ghats gradients in particular, is smoothed out.",
            "Kharif (June–October) only: the north-east monsoon (October–December), which waters much of Tamil Nadu and coastal Andhra Pradesh, and the rabi season are not scored.",
            "Climate values are not cropland-masked: every grid cell overlapping a district counts, weighted by overlap area. Only the MODIS NDVI and LST averages use the WorldCover cropland mask.",
            f"In districts with under {int(MIN_CROPLAND * 100)}% mapped cropland (coastal and forested districts) the MODIS averages use all land pixels.",
            "Crop ranges come from the global FAO ECOCROP database, not from local varieties; rainfall ranges are per growing cycle and are compared with June–October rainfall.",
            f"Monsoon onset is searched from 1 June, so an onset before that date is recorded as 1 June; the onset rule never triggers in {onset_missing_pct:.1f}% of district-years (dry years in the interior), and those years are left out of the onset average.",
            "Observed rainfall is NASA POWER (MERRA-2 based, ~50 km), not GPM IMERG, which needs an Earthdata login.",
            f"Projections are the mean of {len(models)} CMIP6 models, one ensemble member each; model spread is reported per district but not propagated into the score.",
            "MODIS daytime LST under monsoon cloud is sampled on clear days only.",
            *([f"MODIS history in this build covers NDVI for {', '.join(map(str, sorted(modis['ndvi'])))} and LST for {', '.join(map(str, sorted(modis['lst'])))}; the other years were not downloaded in time and show as gaps (rerun fetch_modis.py to complete them). The score itself does not use MODIS."] if len(modis['ndvi']) < 20 or len(modis['lst']) < 20 else []),
        ],
        "headline": headline,
    }
    files["meta.json"] = meta

    for out_dir in OUT_DIRS:
        out_dir.mkdir(parents=True, exist_ok=True)
        keep = set(files) | {"districts.geojson"}
        for old in out_dir.glob("*.json"):
            if old.name not in keep and (old.name.startswith("district_") or old.name.startswith("suitability_")):
                old.unlink()
        for name, payload in files.items():
            text = json.dumps(payload, ensure_ascii=False, allow_nan=False, indent=1 if name == "meta.json" else None, separators=None if name == "meta.json" else (",", ":"))
            (out_dir / name).write_text(text, encoding="utf-8")
    print(f"wrote {len(files)} files to each of: {', '.join(str(p) for p in OUT_DIRS)}")
    print("models:", models, "| 2030 window:", has_mid)
    print(json.dumps({"validation": validation, "headline": headline}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
