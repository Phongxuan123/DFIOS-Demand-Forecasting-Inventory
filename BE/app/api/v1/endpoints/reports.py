from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, require_admin
from app.models.user import User
from app.schemas.reports import (
    BacktestRequest,
    BacktestResponse,
    CostComparisonReportResponse,
    ForecastAccuracyReportResponse,
    InventoryPerformanceReportResponse,
)
from app.services.reports_service import reports_service

router = APIRouter()


@router.get(
    "/forecast-accuracy",
    response_model=ForecastAccuracyReportResponse,
    summary="UC39 - Báo cáo độ chính xác dự báo (MAE, RMSE, MASE, WRMSSE)",
    description="Tính toán các chỉ số sai số dự báo tổng thể và bóc tách theo từng nhóm phân loại ABC.",
)
def get_forecast_accuracy_report(
    model_name: str = Query("lightgbm", description="Tên mô hình dự báo"),
    start_date: Optional[date] = Query(None, description="Ngày bắt đầu (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="Ngày kết thúc (YYYY-MM-DD)"),
    store_id: Optional[str] = Query(None, description="Mã cửa hàng"),
    abc_class: Optional[str] = Query(None, pattern="^(A|B|C)$", description="Lọc theo nhóm hàng: A, B, hoặc C"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ForecastAccuracyReportResponse:
    return reports_service.get_forecast_accuracy(
        db,
        model_name=model_name,
        start_date=start_date,
        end_date=end_date,
        store_id=store_id,
        abc_class=abc_class,
    )


@router.get(
    "/inventory-performance",
    response_model=InventoryPerformanceReportResponse,
    summary="UC40 - Báo cáo hiệu quả tồn kho (Vòng quay tồn kho & Days of Supply)",
    description="Đánh giá hiệu quả chu chuyển hàng hóa: chỉ số vòng quay tồn kho (turnover) và số ngày bán hàng còn lại (Days of Supply).",
)
def get_inventory_performance_report(
    store_id: Optional[str] = Query(None, description="Mã cửa hàng"),
    category: Optional[str] = Query(None, description="Ngành hàng"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InventoryPerformanceReportResponse:
    return reports_service.get_inventory_performance(
        db,
        store_id=store_id,
        category=category,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/backtesting",
    response_model=BacktestResponse,
    summary="UC41 - Chạy kiểm định hồi cứu trên dữ liệu lịch sử (Admin only)",
    description="Mô phỏng lại hiệu quả tồn kho và mức độ giảm thiểu thiếu hàng (stockout reduction) nếu áp dụng mô hình ML trên dữ liệu lịch sử.",
)
def run_historical_backtesting(
    request: BacktestRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> BacktestResponse:
    return reports_service.run_backtesting(db, request=request)


@router.get(
    "/cost-comparison",
    response_model=CostComparisonReportResponse,
    summary="UC42 - Báo cáo so sánh chi phí tồn kho ML vs Baseline (Admin only)",
    description="So sánh chi phí lưu kho, chi phí đặt hàng và phạt thiếu hàng giữa phương pháp ML-driven và Baseline truyền thống.",
)
def get_cost_comparison_report(
    store_id: Optional[str] = Query(None, description="Mã cửa hàng"),
    category: Optional[str] = Query(None, description="Ngành hàng"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> CostComparisonReportResponse:
    return reports_service.get_cost_comparison(
        db,
        store_id=store_id,
        category=category,
    )


@router.get(
    "/export",
    summary="UC43 - Xuất báo cáo ra định dạng CSV tải về",
    description="Xuất nội dung báo cáo ra file CSV (chuẩn UTF-8 BOM hiển thị tiếng Việt trên Excel).",
)
def export_report_csv(
    report_type: str = Query(..., description="Loại báo cáo: forecast-accuracy | inventory | cost-comparison | backtest"),
    store_id: Optional[str] = Query(None, description="Mã cửa hàng"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    csv_content, filename = reports_service.export_report_csv(
        db,
        report_type=report_type,
        store_id=store_id,
    )
    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
