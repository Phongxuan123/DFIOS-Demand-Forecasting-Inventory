"""Quality metrics endpoints: forecast quality of the window quantiles (G-30) and C3-OUT controller monitoring
(G-19 rolling violation, G-21 recovery). Definitions: app/services/quality_metrics_service.py."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_manager_or_admin, require_planner_or_above
from app.models.user import User
from app.services import policy_config as pc
from app.services.quality_metrics_service import controller_metrics_from_db, forecast_quality_from_db

router = APIRouter()


@router.get("/forecast-quality", summary="G-30: coverage, SPL, window MASE and bias of the stored window quantiles")
def get_forecast_quality(
    store_id: str = Query("CA_1", description="Store"),
    horizon_days: int = Query(pc.HORIZON_DAYS, ge=1, le=56, description="Window length H (L+R)"),
    model_run_id: Optional[str] = Query(None, description="Quantile model run (default: the run with most rows)"),
    start_date: Optional[date] = Query(None, description="First origin date (inclusive)"),
    end_date: Optional[date] = Query(None, description="Last origin date (inclusive)"),
    max_origins: int = Query(60, ge=1, le=400, description="Cap: evenly spaced complete origins"),
    max_items: int = Query(500, ge=1, le=10000, description="Cap: evenly spaced SKUs"),
    scale_end_date: Optional[date] = Query(None, description="Scale s1 uses history strictly before this date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_planner_or_above),
) -> dict:
    return forecast_quality_from_db(db, store_id, horizon_days, model_run_id, start_date, end_date,
                                    max_origins, max_items, scale_end_date)


@router.get("/controller", summary="G-19 / G-21: rolling violation, recovery days and Warm-up/Active/Boundary status")
def get_controller_metrics(
    store_id: str = Query("CA_1", description="Store"),
    event_date: Optional[date] = Query(None, description="Event day for the recovery measurement"),
    lead_time_days: int = Query(pc.LEAD_TIME_DAYS, ge=0, le=60, description="L (review day = cycle start - L)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
) -> dict:
    return controller_metrics_from_db(db, store_id, event_date, lead_time_days)
