# sample_data

| File | What it is |
|---|---|
| `template_store_import.csv` | CSV template served by `GET /api/v1/imports/template` (synthetic, no third-party data). |
| `sample_store_CA1.csv`, `shock_scenario_data.csv` | Small synthetic/demo files for the import and scenario features. |
| `calendar.csv` | **Third-party data (P-45).** This is the calendar table of the Kaggle *M5 Forecasting - Accuracy* competition (Walmart; event / SNAP columns, days d_1..d_1969). It is kept only as a convenience fallback for `scripts/load_calendar.py`; it is **not** original work of this project and is subject to the competition's terms (https://www.kaggle.com/competitions/m5-forecasting-accuracy/rules - data may be used for non-commercial / academic purposes). If you redistribute this repository outside the course/capstone, remove this file and point `M5_CALENDAR_CSV_PATH` at your own copy downloaded from Kaggle. |

The full M5 sales file (`sales_train_evaluation.csv`) is never committed; set `M5_SALES_CSV_PATH`.
