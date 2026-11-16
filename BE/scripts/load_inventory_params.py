"""
Inventory parameters (s, S, SS, EOQ) for the demo store.

B-20 / R-28: there is ONE formula (REFIT-RSS-EOQ-G in ``OptimizationService``) with L = 3, R = 7, H = 10
from ``policy_config``. This loader no longer re-implements it (the old version used L = 7 and a
different safety-stock formula than load_c3out_data). It simply calls the service.
``sync_scientific_baseline`` recomputes once more at the end of the build, after the backtest forecasts,
quantiles, policies and theta are loaded.
"""
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

from app.core.database import SessionLocal, engine
from app.models.inventory_param import InventoryParam
from app.services import policy_config as pc
from app.services.optimization_service import optimization_service


def main() -> None:
    InventoryParam.__table__.create(bind=engine, checkfirst=True)
    db = SessionLocal()
    try:
        n = optimization_service.recompute_parameters(db, store_id=pc.DEMO_STORE_ID)
        print(f"Computed inventory_params for {n} SKUs (L={pc.LEAD_TIME_DAYS}, R={pc.REVIEW_PERIOD_DAYS}).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
