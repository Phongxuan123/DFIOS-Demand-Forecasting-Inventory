from datetime import datetime
from typing import Optional, Dict, Any, List
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


class FastInferenceResponse(BaseModel):
    success: bool
    store_id: str
    horizon: int
    skus_forecasted: int
    records_generated: int
    duration_seconds: float
    message: str
