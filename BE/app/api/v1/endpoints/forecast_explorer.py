"""G-49 - Forecast Explorer: L+R window distribution, window error stats vs baselines, implied s/S."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.services.forecast_explorer_service import (
    DEFAULT_LOOKBACK_DAYS,
    ForecastWindowExplorerResponse,
    forecast_explorer_service,
)

router = APIRouter()


@router.get("/window", response_model=ForecastWindowExplorerResponse,
            summary="G-49 - L+R window distribution, MASE/bias vs baselines and implied s/S for one SKU")
def get_forecast_window(
    store_id: str = Query(..., description="Store (GLOBAL/ALL rejected)"),
    item_id: str = Query(..., description="SKU"),
    review_date: Optional[date] = Query(None, description="Review date (default: simulated clock date)"),
    lookback_days: int = Query(DEFAULT_LOOKBACK_DAYS, ge=14, le=728, description="Error-stat lookback in days"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return forecast_explorer_service.window(
        db, store_id=store_id, item_id=item_id, review_date=review_date, lookback_days=lookback_days)
