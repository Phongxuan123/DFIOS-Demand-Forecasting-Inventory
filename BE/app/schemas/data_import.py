from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel, ConfigDict, Field


class DataImportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    file_name: str
    file_type: str
    row_count: int
    status: str
    uploaded_by: str
    summary: Optional[Dict[str, Any]] = None
    created_at: datetime


class FastInferenceRequest(BaseModel):
    store_id: str = Field("CA_1", description="Mã cửa hàng/kho")
    horizon: int = Field(28, ge=7, le=56, description="Số ngày dự báo tương lai (mặc định 28)")
    prefer_production: bool = Field(
        True,
        description="R-37: when the store already has a production (Ensemble) forecast, use it and do NOT generate "
                    "the SBA fallback. false forces the SBA fallback.",
    )


class FastInferenceResponse(BaseModel):
    success: bool
    store_id: str
    horizon: int
    skus_forecasted: int
    records_generated: int
    duration_seconds: float
    message: str
    # --- R-37 provenance (additive) ---
    source: str = Field(
        "sba_fallback",
        description="production_forecast (existing Ensemble rows of the store are used, nothing generated) | "
                    "sba_fallback (store-wide SBA-Croston + day-of-week profile, NOT the production model)",
    )
    model_version: Optional[str] = None
    method: Optional[str] = None
    records_available: Optional[int] = Field(None, description="production_forecast: forecast rows of that version")
    history_start: Optional[str] = None
    history_end: Optional[str] = None
    clock_date: Optional[str] = Field(None, description="sba_fallback: the store's simulated clock; sales after it are not used")
    note: Optional[str] = None
