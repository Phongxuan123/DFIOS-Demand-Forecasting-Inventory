from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


class SimClockResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    store_id: str
    current_date: date
    start_date: date
    mode: str = "replay"
    speed: float = 1.0
    updated_at: datetime
    days_elapsed: int = 0
    reviews_elapsed: int = Field(
        0, description="Index k of the latest review (days_elapsed // R); does NOT count the day-0 review"
    )
    reviews_executed_total: int = Field(
        0,
        description="Reviews run since start_date INCLUDING the day-0 review (0 before the first advance, else k + 1); "
                    "counted like ClockAdvanceResponse.reviews_executed",
    )
    # --- provenance / semantics (additive) ---
    source: str = "sim_clock"
    as_of: Optional[date] = None  # == current_date
    n_skus: Optional[int] = None
    lead_time_days: int = 3
    review_period_days: int = 7
    next_review_date: Optional[date] = None  # start_date + k*R, review at START of that day (A4)
    snapshot_restored: Optional[bool] = None  # only set by POST /clock/reset
    inventory_source: Optional[str] = None  # only set by POST /clock/reset


class ClockAdvanceRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho")
    days: Optional[int] = Field(None, ge=1, le=365, description="Số ngày cần tua")
    reviews: Optional[int] = Field(None, ge=1, le=52, description="Số kỳ review cần tua qua")
    until: Optional[date] = Field(None, description="Tua đến ngày cụ thể (YYYY-MM-DD)")


class ClockAdvanceResponse(BaseModel):
    success: bool
    store_id: str
    previous_date: date
    current_date: date
    days_advanced: int
    reviews_executed: int = Field(..., description="Reviews run by this advance, including the day-0 review when it started at start_date")
    day0_review_executed: bool = Field(False, description="True when reviews_executed includes the day-0 review")
    stockouts_recorded: int
    recommendations_generated: int
    job_events: List[str] = []
    message: str
    # --- additive provenance ---
    orders_received: int = 0
    b0_shadow_stockouts_recorded: Optional[int] = None
    lead_time_days: int = 3
    review_period_days: int = 7
    n_skus: Optional[int] = None
    source: str = "simulator"
    as_of: Optional[date] = None
    duration_seconds: Optional[float] = None


class ClockResetRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho")
    target_date: Optional[date] = Field(None, description="Ngày cần reset về (mặc định lấy start_date)")


class ClockSpeedRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho")
    speed: float = Field(..., ge=0.1, le=10.0, description="Hệ số tốc độ tua (0.1x - 10.0x)")
