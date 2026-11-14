from datetime import datetime, timezone
import re
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


def validate_cron_expression(expr: str) -> bool:
    """
    Kiểm tra tính hợp lệ của biểu thức cron 5 trường tiêu chuẩn (phút giờ ngày tháng thứ).
    """
    if not isinstance(expr, str):
        return False
    parts = expr.strip().split()
    if len(parts) != 5:
        return False
    field_patterns = [
        r"^(\*|[0-5]?[0-9])([,\-][0-5]?[0-9])*(\/[0-9]+)?$",  # minute (0-59)
        r"^(\*|1?[0-9]|2[0-3])([,\-](1?[0-9]|2[0-3]))*(\/[0-9]+)?$",  # hour (0-23)
        r"^(\*|[1-9]|[12][0-9]|3[01])([,\-]([1-9]|[12][0-9]|3[01]))*(\/[0-9]+)?$",  # day of month (1-31)
        r"^(\*|[1-9]|1[0-2])([,\-]([1-9]|1[0-2]))*(\/[0-9]+)?$",  # month (1-12)
        r"^(\*|[0-7])([,\-][0-7])*(\/[0-9]+)?$",  # day of week (0-7)
    ]
    for part, pattern in zip(parts, field_patterns):
        if not re.match(pattern, part):
            return False
    return True


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

    @field_validator("cron_expression")
    @classmethod
    def check_cron(cls, v: str) -> str:
        if not validate_cron_expression(v):
            raise ValueError("Biểu thức cron không hợp lệ. Phải tuân theo chuẩn 5 trường (phút giờ ngày tháng thứ), ví dụ: '0 2 * * *'")
        return v.strip()


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
