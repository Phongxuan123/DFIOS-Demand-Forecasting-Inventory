from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class DashboardKPIs(BaseModel):
    """
    UC07: Executive Dashboard KPIs.
    """
    total_skus: int = Field(..., description="Tổng số SKU đang quản lý")
    total_inventory_value: float = Field(..., description="Tổng giá trị tồn kho hiện tại (USD)")
    stockout_rate: float = Field(..., description="Tỷ lệ hết hàng (% SKU có on_hand <= 0)")
    estimated_service_level: float = Field(..., description="Mức độ phục vụ ước tính (%)")
    reorder_alerts_count: int = Field(..., description="Số SKU có tồn kho <= ROP (cần đặt hàng)")
    pending_replenishments_count: int = Field(..., description="Số đề xuất đặt hàng đang chờ duyệt (PENDING)")
    avg_forecast_accuracy: str = Field(default="94.2%", description="Độ chính xác dự báo trung bình")
    total_suppliers: int = Field(..., description="Tổng số nhà cung cấp đang hợp tác")


class DemandTrendPoint(BaseModel):
    """
    Điểm dữ liệu trên biểu đồ xu hướng nhu cầu (UC08).
    """
    date: str
    actual: Optional[float] = None
    predicted: Optional[float] = None


class DemandTrendResponse(BaseModel):
    """
    UC08: Dữ liệu chuỗi thời gian xu hướng nhu cầu.
    """
    granularity: str = "daily"
    store_id: Optional[str] = None
    category: Optional[str] = None
    data: List[DemandTrendPoint] = []


class InventoryAlertItem(BaseModel):
    """
    UC09: Thông tin cảnh báo tồn kho phân cấp traffic-light.
    """
    item_id: str
    product_name: str
    category: Optional[str] = None
    store_id: str
    on_hand: float
    on_order: float = 0.0
    safety_stock: float
    reorder_point: float
    severity: str = Field(..., description="Mức độ cảnh báo: CRITICAL (đỏ), WARNING (vàng), HEALTHY (xanh)")
    suggested_action: str
    updated_at: Optional[str] = None


class AlertSummary(BaseModel):
    critical_count: int = 0
    warning_count: int = 0
    healthy_count: int = 0
    total_monitored: int = 0


class DashboardAlertsResponse(BaseModel):
    """
    UC09: Danh sách cảnh báo tồn kho và tóm tắt phân bổ sức khỏe kho.
    """
    summary: AlertSummary
    items: List[InventoryAlertItem]
    total: int


class RealtimeStockAlertTriggerResponse(BaseModel):
    """
    UC10: Kết quả kích hoạt quét và phát sự kiện cảnh báo thời gian thực.
    """
    alerts_generated: int
    broadcast_count: int
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class DashboardOverviewResponse(BaseModel):
    """
    Tổng hợp dữ liệu Dashboard một chạm tương thích với Frontend Cockpit.
    """
    kpis: Dict[str, Any]
    charts: Dict[str, Any]
    recent_alerts: List[Dict[str, Any]] = []
