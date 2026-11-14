"""
Route (c) window quantiles for the demo origin (research.md §6.1; P-01, N-13, R-06, R-07, R-15, P-24, P-35).

Single implementation: ``WindowQuantileService.build_records`` (the same code the API and J4 use):
  * F_hat from the Tier-1 Ensemble forecast run chosen by origin (strict model filter),
  * residuals only from matured origins with COMPLETE actuals (a missing day is never 0),
  * actuals from sales_history and, for days not in the DB, from the M5 CSV (M5_SALES_CSV_PATH).
The origin is the ONE demo date of policy_config.DEMO_START_DATE (= sim_clock start).
Idempotent: existing rows of this model run / origin are replaced.
"""
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

from sqlalchemy import text

from app.core.database import SessionLocal, engine
from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.services import policy_config as pc
from app.services.window_quantile_service import DEFAULT_MODEL_RUN_ID, m5_actuals, window_quantile_service

STORE_ID = pc.DEMO_STORE_ID
ORIGINS = [pc.DEMO_START_DATE]


def main() -> None:
    ForecastWindowQuantile.__table__.create(bind=engine, checkfirst=True)
    if not m5_actuals.path():
        print("WARNING: M5_SALES_CSV_PATH not set / missing. Only sales_history actuals are available, so most "
              "residual windows are incomplete and the labelled Gaussian fallback (route 'c_fb') is used.")
    db = SessionLocal()
    try:
        item_ids = [r[0] for r in db.execute(
            text("SELECT DISTINCT item_id FROM inventory WHERE store_id = :s ORDER BY item_id"), {"s": STORE_ID})]
        if not item_ids:
            print("No inventory rows for the store; nothing to do.")
            return
        # drop every previous row of this run (also rows of other origins computed by older code)
        db.query(ForecastWindowQuantile).filter(
            ForecastWindowQuantile.store_id == STORE_ID,
            ForecastWindowQuantile.model_run_id == DEFAULT_MODEL_RUN_ID,
        ).delete(synchronize_session=False)
        db.commit()
        for origin in ORIGINS:
            recs = window_quantile_service.build_records(db, STORE_ID, item_ids, origin, pc.HORIZON_DAYS)
            db.add_all(recs)
            db.commit()
            emp = sum(1 for r in recs if r.route == pc.ROUTE_EMPIRICAL)
            below = sum(1 for r in recs if r.q_levels.get("0.95", 0) < r.point_window - 1e-9)
            print(f"origin {origin}: {len(recs)} SKUs, empirical route 'c': {emp}, fallback 'c_fb': {len(recs) - emp}, "
                  f"Q0.95 < F_hat: {below}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
