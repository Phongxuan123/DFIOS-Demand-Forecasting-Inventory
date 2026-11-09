from datetime import datetime, date
from typing import List, Optional, Dict
from pydantic import BaseModel, ConfigDict, Field


class CalibrationStateItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    calibrator_id: str
    store_id: str
    class_id: str
    review_index: int
    review_date: date
    theta: float
    multiplier: float
    error_rate: float
    at_boundary: bool
    setpoint: float
    eta: float
    created_at: datetime


class ServiceOutcomeItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    calibrator_id: str
    store_id: str
    class_id: str
    cycle_index: int
    cycle_start: date
    cycle_end: date
    n_sku: int
    n_stockout: int
    error_rate: float
    consumed_at_review: Optional[int] = None
    created_at: datetime


class CalibrationStepRequest(BaseModel):
    store_id: Optional[str] = Field("CA_1", description="Mã cửa hàng/kho")
    review_index: Optional[int] = Field(None, description="Chỉ số kỳ review k (để trống để tự động tăng)")
    review_date: Optional[date] = Field(None, description="Ngày thực hiện review")
    lead_time_days: int = Field(3, ge=1, le=30, description="Lead time L (ngày)")
    review_period_days: int = Field(7, ge=1, le=30, description="Chu kỳ review R (ngày)")


class CalibrationStepResponse(BaseModel):
    success: bool
    review_index: int
    consumed_cycle_index: int
    states: List[CalibrationStateItem]
    warnings: List[str] = []
    message: str


class CalibrationStatusResponse(BaseModel):
    store_id: str
    latest_review_index: int
    latest_review_date: Optional[date] = None
    thetas: Dict[str, float]
    multipliers: Dict[str, float]
    at_boundary_classes: List[str]
    has_warning: bool
    states: List[CalibrationStateItem]
