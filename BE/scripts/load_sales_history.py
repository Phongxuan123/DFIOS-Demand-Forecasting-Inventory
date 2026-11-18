import os
import sys
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))
from datetime import datetime, timezone
import pandas as pd
from app.core.database import engine
from app.core.db_bulk import replace_rows
# P-19: y_true chỉ có trong forecasts_Ensemble.parquet. Không bao giờ rơi về sample_data/ hay production_forecast.parquet.
ARTIFACTS_DIR = os.getenv("DFIOS_ARTIFACTS_DIR") or SCRIPT_DIR
ENSEMBLE_PATH = os.path.join(ARTIFACTS_DIR, "forecasts_Ensemble.parquet")
QUANTILES_PATH = os.path.join(ARTIFACTS_DIR, "quantiles_tft.parquet")

STORE_ID = "CA_1"


def main():
    if not os.path.exists(ENSEMBLE_PATH):
        raise SystemExit(
            f"Missing artifact: {ENSEMBLE_PATH}. Run `python scripts/check_artifacts.py` "
            "and obtain the file from the project owner (or set DFIOS_ARTIFACTS_DIR)."
        )
    print(f"Reading evaluation forecasts from: {ENSEMBLE_PATH}")
    df_ens = pd.read_parquet(ENSEMBLE_PATH)
    if "y_true" not in df_ens.columns:
        raise SystemExit(f"{ENSEMBLE_PATH} has no 'y_true' column - wrong artifact (expected forecasts_Ensemble.parquet).")
    df_ens = df_ens[df_ens["store_id"] == STORE_ID].copy()

    if os.path.exists(QUANTILES_PATH):
        print(f"Reading TFT quantiles from: {QUANTILES_PATH}")
        df_q = pd.read_parquet(QUANTILES_PATH)
        df_q = df_q[df_q["id"].str.contains(f"_{STORE_ID}_")].copy()
        df_ens = pd.merge(df_ens, df_q[["id", "date", "h", "P10", "P50", "P90"]], on=["id", "date", "h"], how="left")
    else:
        # no TFT quantile artifact: the band is UNKNOWN (NULL), never invented from the point forecast
        # (the former y_pred * 0.7 / 1.3 band was a made-up number, demo.md §1 "không dùng số giả")
        print(f"WARNING: {QUANTILES_PATH} missing - p10/p50/p90 stored as NULL")
        df_ens["P10"] = float("nan")
        df_ens["P50"] = float("nan")
        df_ens["P90"] = float("nan")

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
        # a missing quantile stays NULL (not 0: a 0 band would claim certainty the model never gave)
        "p10": df_ens["P10"].round(4).astype(object).where(df_ens["P10"].notna(), None),
        "p50": df_ens["P50"].round(4).astype(object).where(df_ens["P50"].notna(), None),
        "p90": df_ens["P90"].round(4).astype(object).where(df_ens["P90"].notna(), None),
        "available": True,
        "model_version": "Ensemble bundle 1.0",
        "generated_at": now,
    })

    print(f"Prepared {len(sales_df)} sales_history rows and {len(forecast_df)} forecast evaluation rows.")

    min_date = sales_df["sale_date"].min()
    max_date = sales_df["sale_date"].max()

    # P-11/R-33: DELETE + COPY trong MỘT transaction/connection; lỗi thì rollback toàn bộ
    with engine.begin() as conn:
        print(f"Replacing sales_history/forecast for {STORE_ID} between {min_date} and {max_date}...")
        params = {"s": STORE_ID, "d1": min_date, "d2": max_date}
        replace_rows(conn, "sales_history", sales_df,
                     "DELETE FROM sales_history WHERE store_id = :s AND sale_date BETWEEN :d1 AND :d2", params)
        replace_rows(conn, "forecast", forecast_df,
                     "DELETE FROM forecast WHERE store_id = :s AND forecast_date BETWEEN :d1 AND :d2", params)

    print("Sales evaluation data seeded successfully!")


if __name__ == "__main__":
    main()
