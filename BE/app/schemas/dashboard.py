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
    estimated_service_level: Optional[float] = Field(None, description="Mức độ phục vụ ước tính (%) = 100 - tỷ lệ SKU on_hand<=0 tại thời điểm hiện tại; null khi chưa có tồn kho")
    reorder_alerts_count: int = Field(..., description="Số SKU có vị thế tồn kho IP < s (sẽ được đặt ở kỳ review, như J4)")
    pending_replenishments_count: int = Field(..., description="Số đề xuất đặt hàng đang chờ duyệt (PENDING)")
    avg_forecast_accuracy: str = Field(default="N/A", description="Chỉ số sai số / độ chính xác dự báo mô hình sản xuất (ví dụ: WRMSSE 0.4935)")
    total_suppliers: int = Field(..., description="Tổng số nhà cung cấp đang hợp tác")
    production_wrmsse: Optional[float] = Field(None, description="WRMSSE numeric of the Production model (null when not in the registry)")
    production_model_id: Optional[str] = Field(None, description="Registry id of the Production model")
    replay_wrmsse: Optional[float] = Field(None, description="WRMSSE of the backtest engine the replay runs on (registry scope 'replay'); the production WRMSSE is the frozen engine's 28-day test score")
    replay_model_id: Optional[str] = Field(None, description="Registry id of the replay (backtest) model")
    orders_placed_count: int = Field(0, description="Orders placed = APPROVED + COMPLETED recommendations with review_date in the simulated clock window")


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
    # additive (U-04): the series is bounded by the simulated clock
    as_of: Optional[str] = None
    forecast_note: Optional[str] = None
    # additive (demo.md §4.3 step 6): in replay the forecast line is the causal backtest run
    forecast_source: Optional[str] = None        # e.g. "backtest-ensemble-v1"; None = production / stored forecasts
    forecast_past_horizon: Optional[int] = None  # days up to the clock: forecast made h days before (1)
    forecast_as_of: Optional[str] = None         # days after the clock: the forecast made at the end of this day


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
    suggested_action_code: Optional[str] = Field(
        None, description="Stable code of suggested_action: out_of_stock | below_ss_and_rop | ip_below_rop | healthy")
    suggested_action_params: Dict[str, Any] = Field(
        default_factory=dict, description="Numbers used in the text (on_hand, safety_stock, inventory_position, reorder_point)")
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
