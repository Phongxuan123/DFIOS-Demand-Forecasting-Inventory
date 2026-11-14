import os
import sys
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))
from datetime import datetime, timezone
import pandas as pd
from sqlalchemy import text
from app.core.database import engine
from app.core.db_bulk import psql_insert_copy
ARTIFACTS_DIR = os.getenv("DFIOS_ARTIFACTS_DIR")
if not ARTIFACTS_DIR or not os.path.exists(ARTIFACTS_DIR):
    for candidate in [
        os.path.join(SCRIPT_DIR, "sample_data"),
        os.path.join(SCRIPT_DIR, "dfios_artifacts"),
        SCRIPT_DIR,
    ]:
        if os.path.exists(candidate):
            ARTIFACTS_DIR = candidate
            break

ENSEMBLE_PATH = os.path.join(ARTIFACTS_DIR, "forecasts_Ensemble.parquet") if ARTIFACTS_DIR else ""
QUANTILES_PATH = os.path.join(ARTIFACTS_DIR, "quantiles_tft.parquet") if ARTIFACTS_DIR else ""

if not ENSEMBLE_PATH or not os.path.exists(ENSEMBLE_PATH):
    ENSEMBLE_PATH = os.path.join(SCRIPT_DIR, "production_forecast.parquet")
if not QUANTILES_PATH or not os.path.exists(QUANTILES_PATH):
    QUANTILES_PATH = os.path.join(SCRIPT_DIR, "production_forecast.parquet")

STORE_ID = "CA_1"


def main():
    if not os.path.exists(ENSEMBLE_PATH):
        raise SystemExit(
            "Forecast parquet file not found. "
            "Please ensure production_forecast.parquet is placed in BE/scripts/ "
            "or configure DFIOS_ARTIFACTS_DIR in BE/.env"
        )
    print(f"Reading evaluation forecasts from: {ENSEMBLE_PATH}")
    df_ens = pd.read_parquet(ENSEMBLE_PATH)
    df_ens = df_ens[df_ens["store_id"] == STORE_ID].copy()

    if os.path.exists(QUANTILES_PATH):
        print(f"Reading TFT quantiles from: {QUANTILES_PATH}")
        df_q = pd.read_parquet(QUANTILES_PATH)
        df_q = df_q[df_q["id"].str.contains(f"_{STORE_ID}_")].copy()
        df_ens = pd.merge(df_ens, df_q[["id", "date", "h", "P10", "P50", "P90"]], on=["id", "date", "h"], how="left")
    else:
        df_ens["P10"] = df_ens["y_pred"] * 0.7
        df_ens["P50"] = df_ens["y_pred"]
        df_ens["P90"] = df_ens["y_pred"] * 1.3

    df_ens["sale_date"] = pd.to_datetime(df_ens["date"]).dt.date
    df_ens["history_id"] = df_ens["item_id"] + "_" + df_ens["store_id"] + "_" + df_ens["sale_date"].astype(str)

    sales_df = pd.DataFrame({
        "id": df_ens["history_id"],
        "item_id": df_ens["item_id"],
        "store_id": df_ens["store_id"],
        "sale_date": df_ens["sale_date"],
        "quantity": df_ens["y_true"].fillna(0.0).round(2),
    })

    now = datetime.now(timezone.utc)
    forecast_df = pd.DataFrame({
        "id": df_ens["id"],
        "item_id": df_ens["item_id"],
        "store_id": df_ens["store_id"],
        "forecast_date": df_ens["sale_date"],
        "h": df_ens["h"].astype(int),
        "y_pred": df_ens["y_pred"].fillna(0.0).round(4),
        "p10": df_ens["P10"].fillna(0.0).round(4),
        "p50": df_ens["P50"].fillna(0.0).round(4),
        "p90": df_ens["P90"].fillna(0.0).round(4),
        "available": True,
        "model_version": "Ensemble bundle 1.0",
        "generated_at": now,
    })

    print(f"Prepared {len(sales_df)} sales_history rows and {len(forecast_df)} forecast evaluation rows.")

    min_date = sales_df["sale_date"].min()
    max_date = sales_df["sale_date"].max()

    with engine.begin() as conn:
        print(f"Deleting existing records for {STORE_ID} between {min_date} and {max_date}...")
        conn.execute(
            text("DELETE FROM sales_history WHERE store_id = :s AND sale_date BETWEEN :d1 AND :d2"),
            {"s": STORE_ID, "d1": min_date, "d2": max_date}
        )
        conn.execute(
            text("DELETE FROM forecast WHERE store_id = :s AND forecast_date BETWEEN :d1 AND :d2"),
            {"s": STORE_ID, "d1": min_date, "d2": max_date}
        )

    print("Seeding sales_history table into database...")
    sales_df.to_sql("sales_history", engine, if_exists="append", index=False, method=psql_insert_copy)

    print("Seeding forecast table into database...")
    forecast_df.to_sql("forecast", engine, if_exists="append", index=False, method=psql_insert_copy)

    print("Sales evaluation data seeded successfully!")


if __name__ == "__main__":
    main()
