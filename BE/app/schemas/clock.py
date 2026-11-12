from datetime import datetime, date
from typing import Optional, List, Dict, Any
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
    reviews_elapsed: int = 0


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
    reviews_executed: int
    stockouts_recorded: int
    recommendations_generated: int
    job_events: List[str] = []
    message: str


class ClockResetRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho")
    target_date: Optional[date] = Field(None, description="Ngày cần reset về (mặc định lấy start_date)")


class ClockSpeedRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho")
    speed: float = Field(..., ge=0.1, le=10.0, description="Hệ số tốc độ tua (0.1x - 10.0x)")
