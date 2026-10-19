from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class BatchScheduleCreateRequest(BaseModel):
    """
    UC49: Yêu cầu thiết lập lịch chạy dự báo tự động định kỳ (cron).
    """
    name: str = Field(..., description="Tên tác vụ lập lịch")
    cron_expression: str = Field(default="0 2 * * *", description="Biểu thức cron (ví dụ: '0 2 * * *' chạy 2h sáng hàng ngày)")
    model_name: str = Field(default="lightgbm", description="Tên mô hình AI")
    horizon: int = Field(default=28, ge=7, le=28, description="Số ngày dự báo")
    store_id: Optional[str] = Field(default="CA_1", description="Mã cửa hàng áp dụng")
    auto_trigger_optimization: bool = Field(default=True, description="Tự động tính lại SS/ROP/EOQ và ABC-XYZ sau khi chạy (UC50)")


class BatchScheduleResponse(BaseModel):
    """
    UC49: Thông tin chi tiết một lịch chạy tự động.
    """
    id: str
    name: str
    cron_expression: str
    model_name: str
    horizon: int
    store_id: str
    auto_trigger_optimization: bool
    is_active: bool = True
    last_run_at: Optional[str] = None
    next_run_at: Optional[str] = None
    created_at: str


class BatchScheduleListResponse(BaseModel):
    total: int
    items: List[BatchScheduleResponse]


class PipelineRunRequest(BaseModel):
    """
    UC50: Yêu cầu kích hoạt chuỗi tác vụ toàn trình tự động hóa.
    """
    model_name: str = Field(default="lightgbm", description="Mô hình dự báo sử dụng")
    horizon: int = Field(default=28, ge=7, le=28, description="Khoảng thời gian dự báo")
    store_id: str = Field(default="CA_1", description="Mã cửa hàng")


class PipelineRunResponse(BaseModel):
    """
    UC50: Kết quả thực thi toàn trình quy trình tự động hóa sau dự báo.
    """
    run_id: str
    status: str = "COMPLETED"
    model_name: str
    store_id: str
    forecasts_generated: int
    inventory_params_updated: int
    classifications_updated: int
    replenishments_generated: int
    started_at: str
    completed_at: str
    duration_seconds: float
