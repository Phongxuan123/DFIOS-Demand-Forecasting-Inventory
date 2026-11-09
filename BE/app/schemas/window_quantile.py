from datetime import date
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field


class WindowQuantileResponse(BaseModel):
    """
    Schema phản hồi phân phối nhu cầu cửa sổ Route (c) cho Frontend hiển thị.
    """
    id: str
    model_run_id: str
    store_id: str
    item_id: str
    origin_date: date
    horizon_days: int = Field(10, description="Độ dài cửa sổ bảo vệ H = L + R")
    point_window: float = Field(..., description="Tổng dự báo điểm trên cửa sổ F_hat(H)")
    q_levels: Dict[str, float] = Field(..., description="19 mức quantile thực nghiệm Q_hat(tau)")
    tau_95: float = Field(..., description="Mức phân vị 95% chuẩn cho chính sách đặt hàng s")
    route: str = Field("c", description="Phương thức xác định phân phối: 'c' là thực nghiệm")

    class Config:
        from_attributes = True
