from datetime import datetime
from typing import Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict


class ModelRegisterRequest(BaseModel):
    name: str = Field(..., description="Tên định danh mô hình (vd: LightGBM-M5)")
    version: str = Field(..., description="Phiên bản (vd: v1.0.0)")
    algorithm: str = Field(..., description="Thuật toán (lightgbm, xgboost, baseline_naive...)")
    scope: str = Field(default="global", description="Phạm vi áp dụng (global, hoặc mã SKU / nhóm hàng)")
    is_production: bool = Field(default=False, description="Đánh dấu là phiên bản production")
    parameters: Optional[Dict] = Field(default=None, description="Siêu tham số huấn luyện")
    metrics: Optional[Dict] = Field(default=None, description="Bộ chỉ số đánh giá (mae, rmse, mase, wrmsse)")
    job_id: Optional[str] = Field(default=None, description="ID phiên huấn luyện tương ứng")


class ModelRegistryResponse(BaseModel):
    id: str
    name: str
    version: str
    algorithm: str
    scope: str
    is_production: bool
    parameters: Optional[Dict] = None
    metrics: Optional[Dict] = None
    trained_by: Optional[str] = None
    job_id: Optional[str] = None
    created_at: datetime
    promoted_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ModelPromoteResponse(BaseModel):
    promoted_model: ModelRegistryResponse
    demoted_model_id: Optional[str] = None
    message: str


class ModelRegistryListResponse(BaseModel):
    items: List[ModelRegistryResponse]
    total: int
