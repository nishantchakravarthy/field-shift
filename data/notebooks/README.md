# Earth Engine notebooks

`ee_extract.py` is a notebook-style script (cells marked `# %%`; opens as a
notebook in VS Code and Jupyter, or paste the cells into Colab).

It is the **alternative extraction path** for teams with an approved Google
Earth Engine account. It uses the catalog IDs from the implementation plan
(`NASA/GDDP-CMIP6`, `NASA/GPM_L3/IMERG_MONTHLY_V07`, `MODIS/061/MOD13Q1`,
`MODIS/061/MOD11A2`, `ESA/WorldCover/v200`, `FAO/GAUL/2015/level2`).

It was **not run** to produce the JSON in this repository. That data came from
NASA's open endpoints through `data/scripts/`. See the root README.

To use it: `pip install earthengine-api`, set `PROJECT` to your Cloud project,
run the cells, then download the CSVs from the `field_shift_exports` Drive
folder into `data/raw/`.
