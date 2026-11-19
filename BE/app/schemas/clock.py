from datetime import datetime, date
from typing import Literal, Optional, List
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
    m5_day0: Optional[date] = Field(None, description="Date of M5 d_1 on this database's calendar (2011-01-29 unless "
                                                      "the replay data were shifted as a whole)")
    snapshot_restored: Optional[bool] = None  # only set by POST /clock/reset
    inventory_source: Optional[str] = None  # only set by POST /clock/reset


class ClockAdvanceRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho")
    days: Optional[int] = Field(None, ge=1, le=365, description="Số ngày cần tua")
    reviews: Optional[int] = Field(None, ge=1, le=52, description="Số kỳ review cần tua qua")
    until: Optional[date] = Field(None, description="Tua đến ngày cụ thể (YYYY-MM-DD)")
    approval_mode: Literal["auto", "planner"] = Field(
        "auto",
        description="auto: đơn của mỗi kỳ review được đặt ngay (replay). planner: dừng ở kỳ review kế tiếp, đơn ở "
                    "trạng thái PENDING chờ Planner sửa/duyệt; số đã duyệt (final_qty) về kho sau L ngày.",
    )
    expire_pending: bool = Field(
        False,
        description="Chỉ dùng với planner: bỏ qua (REJECTED, không đặt hàng) các đề xuất mô phỏng còn chờ duyệt "
                    "thay vì từ chối lệnh tua (409).",
    )
    async_job: bool = Field(
        False,
        description="true: chạy nền, trả 202 + run_id ngay; theo dõi bằng GET /batch-runs/{run_id}. "
                    "false (mặc định): chạy đồng bộ như trước.",
    )


class BatchJobAccepted(BaseModel):
    run_id: str
    job: str = "ADVANCE"
    status: str = "running"
    store_id: Optional[str] = None
    started_at: datetime
    poll_url: str


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
    approval_mode: str = "auto"
    stopped_at_review: bool = Field(
        False, description="planner: the advance stopped at a review day; its proposals wait for the planner"
    )
    pending_expired: int = Field(0, description="planner: open simulator proposals expired by expire_pending")
    run_id: Optional[str] = Field(None, description="batch_runs.run_id of this advance (GET /batch-runs/{run_id})")


class ClockResetRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho")
    target_date: Optional[date] = Field(None, description="Ngày cần reset về (mặc định lấy start_date)")


class ClockSpeedRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho")
    speed: float = Field(..., ge=0.1, le=10.0, description="Hệ số tốc độ tua (0.1x - 10.0x)")
