from typing import Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_manager_or_admin
from app.models.user import User
from app.schemas.dashboard import (
    DashboardAlertsResponse,
    DashboardKPIs,
    DashboardOverviewResponse,
    DemandTrendResponse,
    RealtimeStockAlertTriggerResponse,
)
from app.services.dashboard_service import dashboard_service

router = APIRouter()


@router.get(
    "/kpis",
    response_model=DashboardKPIs,
    summary="Lấy các chỉ số KPI điều hành tổng thể (UC07)",
    description="Cung cấp các KPI trọng yếu: tổng giá trị tồn kho, tỷ lệ hết hàng (stockout rate), "
    "service level ước tính, và số lượng cảnh báo đặt hàng cần xử lý.",
)
def get_executive_kpis(
    store_id: Optional[str] = Query(None, description="Lọc theo mã cửa hàng (ví dụ: CA_1, CA_2, ...)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DashboardKPIs:
    return dashboard_service.get_kpis(db, store_id=store_id)


@router.get(
    "/demand-trend",
    response_model=DemandTrendResponse,
    summary="Biểu đồ xu hướng nhu cầu bán hàng thực tế và dự báo (UC08)",
    description="Lấy chuỗi dữ liệu thời gian cho biểu đồ xu hướng nhu cầu, hỗ trợ lọc theo cửa hàng, ngành hàng và độ chi tiết (daily/weekly/monthly).",
)
def get_demand_trend(
    store_id: Optional[str] = Query(None, description="Mã cửa hàng (ví dụ: CA_1)"),
    category: Optional[str] = Query(None, description="Ngành hàng (ví dụ: FOODS, HOBBIES, HOUSEHOLD)"),
    days: int = Query(30, ge=7, le=90, description="Khoảng thời gian phân tích (ngày)"),
    granularity: str = Query("daily", pattern="^(daily|weekly|monthly)$", description="Độ chi tiết: daily | weekly | monthly"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DemandTrendResponse:
    return dashboard_service.get_demand_trend(
        db,
        store_id=store_id,
        category=category,
        days=days,
        granularity=granularity,
    )


@router.get(
    "/alerts",
    response_model=DashboardAlertsResponse,
    summary="Bảng cảnh báo tồn kho phân màu theo ngưỡng SS và ROP (UC09)",
    description="So sánh tồn kho hiện tại với mức an toàn (Safety Stock) và điểm đặt hàng lại (ROP). "
    "Phân loại mức độ nghiêm trọng: CRITICAL (đỏ), WARNING (vàng), HEALTHY (xanh).",
)
def get_stock_alerts(
    store_id: Optional[str] = Query(None, description="Lọc theo mã cửa hàng"),
    severity: Optional[str] = Query(None, description="Lọc theo mức độ cảnh báo: CRITICAL, WARNING, HEALTHY"),
    limit: int = Query(50, ge=1, le=500, description="Số lượng bản ghi tối đa"),
    offset: int = Query(0, ge=0, description="Vị trí bắt đầu"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DashboardAlertsResponse:
    return dashboard_service.get_alerts(
        db,
        store_id=store_id,
        severity=severity,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/check-alerts",
    response_model=RealtimeStockAlertTriggerResponse,
    summary="Kích hoạt quét ngưỡng tồn kho và phát cảnh báo thời gian thực qua SSE (UC10)",
    description="Dành cho Warehouse Manager và Admin: quét các mặt hàng chạm ngưỡng nguy hiểm, ghi nhận vào hệ thống và phát broadcast sự kiện realtime.",
)
async def trigger_realtime_stock_alerts(
    store_id: Optional[str] = Query(None, description="Mã cửa hàng cần quét (để trống nếu quét toàn hệ thống)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
) -> RealtimeStockAlertTriggerResponse:
    return await dashboard_service.trigger_realtime_stock_alerts(db, store_id=store_id)


@router.get(
    "/overview",
    response_model=DashboardOverviewResponse,
    summary="Tổng hợp toàn bộ số liệu Dashboard một chạm",
    description="Cung cấp payload toàn diện (KPIs, Forecast Trend, Inventory Health Donut, Reorder Urgency List) phục vụ giao diện Dashboard Cockpit.",
)
def get_dashboard_overview(
    store_id: Optional[str] = Query(None, description="Mã cửa hàng"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DashboardOverviewResponse:
    return dashboard_service.get_overview(db, store_id=store_id)
