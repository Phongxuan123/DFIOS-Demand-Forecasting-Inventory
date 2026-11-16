# sample_data

| File | What it is |
|---|---|
| `template_store_import.csv` | CSV template served by `GET /api/v1/imports/template` (synthetic, no third-party data). |
| `sample_store_CA1.csv`, `shock_scenario_data.csv` | Small synthetic/demo files for the import and scenario features. |

P-45: no third-party data is committed here any more. The Kaggle *M5 Forecasting - Accuracy* files
(`calendar.csv`, `sales_train_evaluation.csv`, `sell_prices.csv`; competition terms:
https://www.kaggle.com/competitions/m5-forecasting-accuracy/rules) are downloaded by each team member and
referenced with `M5_CALENDAR_CSV_PATH` / `M5_SALES_CSV_PATH` (see the README). A local copy dropped into this
folder is git-ignored (`.gitignore`) and still picked up by `scripts/load_calendar.py` as a fallback. The tests
never read these files (they build tiny synthetic fixtures).
