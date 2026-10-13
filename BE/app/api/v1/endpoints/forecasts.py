from datetime import date
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user, require_manager_or_admin
from app.models.user import User
from app.schemas.forecast import (
    ForecastListResponse,
    HistoricalDemandResponse,
    ForecastCompareResponse,
    ForecastUncertaintyResponse,
    ForecastExplanationResponse,
    ForecastOverrideCreate,
    ForecastOverrideResponse,
    ForecastOverrideRevertResponse,
)
from app.services.forecast_service import forecast_service

router = APIRouter()


def get_client_ip(request: Request) -> Optional[str]:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("", response_model=ForecastListResponse, summary="UC17 / UC18 / UC19 - Tra cứu danh sách dự báo nhu cầu")
def get_forecasts(
    horizon: Optional[int] = Query(None, description="Khoảng ngày dự báo (7, 14, 28). Mặc định theo cấu hình hệ thống"),
    item_id: Optional[str] = Query(None, description="Lọc theo mã SKU sản phẩm"),
    category: Optional[str] = Query(None, description="Lọc theo ngành hàng (category / cat_id)"),
    store_id: Optional[str] = Query(None, description="Lọc theo mã cửa hàng / kho"),
    start_date: Optional[date] = Query(None, description="Ngày bắt đầu (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="Ngày kết thúc (YYYY-MM-DD)"),
    model_version: Optional[str] = Query(None, description="Phiên bản mô hình ML"),
    skip: int = Query(0, ge=0, description="Số lượng bản ghi bỏ qua (phân trang)"),
    limit: int = Query(50, ge=1, le=500, description="Số lượng bản ghi tối đa lấy về"),
    sort_by: str = Query("forecast_date", description="Trường sắp xếp (forecast_date, y_pred, item_id, h)"),
    order: str = Query("asc", description="Thứ tự sắp xếp (asc hoặc desc)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC17 / UC18 / UC19 - Demand Forecast Explorer**:
    Xem dự báo nhu cầu theo SKU, hỗ trợ chọn horizon (7/14/28), lọc SKU, ngành hàng, cửa hàng, phân trang và sắp xếp.
    Tự động áp dụng giá trị override thủ công (nếu có).
    """
    return forecast_service.get_forecasts(
        db,
        horizon=horizon,
        item_id=item_id,
        category=category,
        store_id=store_id,
        start_date=start_date,
        end_date=end_date,
        model_version=model_version,
        skip=skip,
        limit=limit,
        sort_by=sort_by,
        order=order,
    )


@router.get("/{sku}/history", response_model=HistoricalDemandResponse, summary="UC20 - Xem dữ liệu nhu cầu bán hàng lịch sử")
def get_historical_demand(
    sku: str,
    store_id: Optional[str] = Query(None, description="Lọc theo mã cửa hàng"),
    start_date: Optional[date] = Query(None, description="Ngày bắt đầu (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="Ngày kết thúc (YYYY-MM-DD)"),
    granularity: str = Query("daily", description="Mức độ gộp dữ liệu: daily, weekly, monthly"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC20 - View Historical Demand**:
    Tra cứu sản lượng bán hàng lịch sử của một SKU tách biệt khỏi phần dự báo.
    Hỗ trợ gộp theo ngày (daily), tuần (weekly), tháng (monthly) kèm thống kê tổng lượng, trung bình, min/max.
    """
    return forecast_service.get_historical_demand(
        db,
        sku=sku,
        store_id=store_id,
        start_date=start_date,
        end_date=end_date,
        granularity=granularity,
    )


@router.get("/{sku}/compare", response_model=ForecastCompareResponse, summary="UC21 - So sánh doanh số thực tế vs dự báo")
def compare_actual_vs_predicted(
    sku: str,
    store_id: Optional[str] = Query(None, description="Lọc theo mã cửa hàng"),
    start_date: Optional[date] = Query(None, description="Ngày bắt đầu (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="Ngày kết thúc (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC21 - Compare Actual vs Predicted**:
    So sánh chuỗi doanh số thực tế và dự báo trên cùng khung thời gian đã có thực tế.
    Trả về sai số từng ngày cùng các chỉ số đánh giá tổng hợp: MAE, RMSE, MAPE.
    """
    return forecast_service.compare_actual_vs_predicted(
        db,
        sku=sku,
        store_id=store_id,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/{sku}/uncertainty", response_model=ForecastUncertaintyResponse, summary="UC22 - Xem dải bất định và khoảng tin cậy (p10/p50/p90)")
def get_uncertainty_band(
    sku: str,
    store_id: Optional[str] = Query(None, description="Lọc theo mã cửa hàng"),
    horizon: Optional[int] = Query(None, description="Khoảng ngày dự báo (7, 14, 28)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC22 - View Prediction Uncertainty Band**:
    Xem dải tin cậy p10, p50, p90, độ lệch chuẩn sigma và phân bố sai số (error distribution percentiles) của SKU.
    """
    return forecast_service.get_uncertainty_band(
        db,
        sku=sku,
        store_id=store_id,
        horizon=horizon,
    )


@router.get("/{sku}/explanation", response_model=ForecastExplanationResponse, summary="UC23 - Giải thích dự báo SHAP (Manager & Admin only)")
def get_forecast_explanation(
    sku: str,
    store_id: Optional[str] = Query(None, description="Lọc theo mã cửa hàng"),
    model_version: Optional[str] = Query(None, description="Phiên bản mô hình"),
    model_name: Optional[str] = Query(None, description="Tên mô hình (lightgbm, xgboost, arima,...)"),
    db: Session = Depends(get_db),
    user: User = Depends(require_manager_or_admin),
):
    """
    **UC23 - View Forecast Explanation (SHAP)**:
    Xem mức độ đóng góp (feature importance / SHAP) của các yếu tố (giá bán, khuyến mãi, thời điểm, lag) đến dự báo.
    Quyền: Warehouse Manager, Admin (Viewer bị 403). Nếu mô hình là ARIMA trả lỗi 404 rõ ràng.
    """
    return forecast_service.get_forecast_explanation(
        db,
        sku=sku,
        store_id=store_id,
        model_version=model_version,
        model_name=model_name,
    )


@router.post("/{sku}/override", response_model=ForecastOverrideResponse, status_code=status.HTTP_201_CREATED, summary="UC24 - Điều chỉnh thủ công dự báo (Manager & Admin only)")
def create_forecast_override(
    sku: str,
    body: ForecastOverrideCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_manager_or_admin),
):
    """
    **UC24 - Manual Forecast Override**:
    Người dùng điều chỉnh thủ công giá trị dự báo của SKU khi có biến động bất thường kèm lý do bắt buộc.
    Lưu giá trị gốc + giá trị mới và ghi nhận vào audit log hệ thống.
    """
    ip = get_client_ip(request)
    return forecast_service.create_override(
        db,
        sku=sku,
        request=body,
        current_user=user,
        ip_address=ip,
    )


@router.delete("/{sku}/override/{id}", response_model=ForecastOverrideRevertResponse, summary="UC24 - Hoàn tác điều chỉnh thủ công (Manager & Admin only)")
def revert_forecast_override(
    sku: str,
    id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_manager_or_admin),
):
    """
    **UC24 - Revert Manual Forecast Override**:
    Hoàn tác can thiệp thủ công, khôi phục lại giá trị dự báo gốc ban đầu và ghi audit log.
    """
    ip = get_client_ip(request)
    return forecast_service.revert_override(
        db,
        sku=sku,
        override_id=id,
        current_user=user,
        ip_address=ip,
    )


@router.get("/{sku}/overrides", response_model=List[ForecastOverrideResponse], summary="UC24 - Lịch sử điều chỉnh thủ công của SKU")
def list_forecast_overrides(
    sku: str,
    store_id: Optional[str] = Query(None, description="Lọc theo mã cửa hàng"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC24 - List Overrides**:
    Xem toàn bộ lịch sử các lần can thiệp điều chỉnh dự báo của một SKU.
    """
    return forecast_service.list_overrides(db, sku=sku, store_id=store_id)
