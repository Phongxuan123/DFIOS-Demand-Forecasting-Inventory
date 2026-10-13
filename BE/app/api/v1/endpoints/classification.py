from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_current_user, require_admin, require_manager_or_admin
from app.models.user import User
from app.schemas.classification import (
    ClassificationThresholds,
    ClassificationThresholdsUpdate,
    ClassificationMatrixResponse,
    SKUClassificationListResponse,
    RecommendationResponse,
    ClassificationRecomputeResponse,
)
from app.services.classification_service import classification_service

router = APIRouter()


def get_client_ip(request: Request) -> Optional[str]:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("/thresholds", response_model=ClassificationThresholds, summary="UC25 - Xem cấu hình ngưỡng phân loại ABC/XYZ")
def get_classification_thresholds(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC25 - View Classification Thresholds**:
    Xem các ngưỡng phân loại ABC (Pareto doanh thu A 80% / B 15% / C 5%) và XYZ (hệ số biến động CV: X <= 0.5, Y 0.5-1.0, Z > 1.0).
    """
    return classification_service.get_thresholds(db)


@router.put("/thresholds", response_model=ClassificationThresholds, summary="UC25 - Điều chỉnh ngưỡng phân loại ABC/XYZ (Admin only)")
def update_classification_thresholds(
    body: ClassificationThresholdsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC25 - Configure ABC/XYZ Thresholds**:
    Admin điều chỉnh ngưỡng phần trăm dùng để phân loại A/B/C và X/Y/Z.
    Hệ thống tự động kích hoạt tính toán lại phân loại cho toàn bộ SKU và ghi audit log.
    """
    ip = get_client_ip(request)
    return classification_service.update_thresholds(
        db,
        request=body,
        current_user=admin,
        ip_address=ip,
    )


@router.post("/recompute", response_model=ClassificationRecomputeResponse, summary="UC25 - Kích hoạt tính lại phân loại toàn bộ SKU (Manager & Admin only)")
def trigger_recompute_classification(
    db: Session = Depends(get_db),
    user: User = Depends(require_manager_or_admin),
):
    """
    **UC25 - Recompute Classification**:
    Chủ động chạy lại thuật toán phân loại Pareto ABC & CV XYZ cho toàn bộ SKU theo dữ liệu mới nhất.
    """
    count = classification_service.recompute_classification(db)
    thresholds = classification_service.get_thresholds(db)
    return ClassificationRecomputeResponse(
        success=True,
        message=f"Đã phân loại lại thành công cho {count} SKU sản phẩm.",
        total_skus_classified=count,
        thresholds=thresholds,
        recomputed_at=datetime.now(timezone.utc),
    )


@router.get("/matrix", response_model=ClassificationMatrixResponse, summary="UC26 - Xem ma trận phân loại 3x3 ABC-XYZ")
def get_classification_matrix(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC26 - View ABC-XYZ Matrix**:
    Người dùng xem ma trận 3x3 thể hiện số lượng và tỷ trọng SKU, doanh thu tương ứng theo 9 phân khúc (AX...CZ).
    """
    return classification_service.get_matrix(db)


@router.get("/skus", response_model=SKUClassificationListResponse, summary="UC27 - Lọc danh sách SKU theo phân khúc ABC/XYZ")
def get_classification_skus(
    abc: Optional[str] = Query(None, description="Lọc theo nhóm ABC (A, B, C)"),
    xyz: Optional[str] = Query(None, description="Lọc theo nhóm XYZ (X, Y, Z)"),
    segment: Optional[str] = Query(None, description="Lọc theo phân khúc cụ thể (AX, AY, ..., CZ)"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo mã SKU hoặc tên sản phẩm"),
    category: Optional[str] = Query(None, description="Lọc theo ngành hàng (category / cat_id)"),
    skip: int = Query(0, ge=0, description="Số lượng bản ghi bỏ qua"),
    limit: int = Query(50, ge=1, le=500, description="Số lượng bản ghi tối đa lấy về"),
    sort_by: str = Query("revenue", description="Trường sắp xếp (revenue, revenue_share, cv, mean_demand, item_id)"),
    order: str = Query("desc", description="Thứ tự sắp xếp (desc hoặc asc)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC27 - Filter SKU by ABC-XYZ Segment**:
    Xem chi tiết danh sách SKU theo từng ô phân khúc ma trận, hỗ trợ lọc ngành hàng, tìm kiếm và phân trang.
    """
    return classification_service.get_skus(
        db,
        abc=abc,
        xyz=xyz,
        segment=segment,
        search=search,
        category=category,
        skip=skip,
        limit=limit,
        sort_by=sort_by,
        order=order,
    )


@router.get("/recommendations", response_model=List[RecommendationResponse], summary="UC28 - Danh sách khuyến nghị chính sách tồn kho cho 9 phân khúc (Manager & Admin only)")
def list_classification_recommendations(
    user: User = Depends(require_manager_or_admin),
):
    """
    **UC28 - Classification-based Inventory Recommendations**:
    Xem toàn bộ gợi ý chính sách quản lý tồn kho và bổ sung hàng hóa cho 9 phân khúc ma trận.
    Quyền: Warehouse Manager, Admin (Viewer bị 403).
    """
    return classification_service.list_all_recommendations()


@router.get("/recommendations/{segment}", response_model=RecommendationResponse, summary="UC28 - Xem khuyến nghị chính sách tồn kho cho 1 phân khúc cụ thể (Manager & Admin only)")
def get_classification_recommendation(
    segment: str,
    user: User = Depends(require_manager_or_admin),
):
    """
    **UC28 - View Recommendation by Segment**:
    Xem chi tiết chiến lược tồn kho, tần suất kiểm tra, chính sách đặt hàng và mức tồn kho an toàn cho một phân khúc cụ thể (ví dụ: AX, CZ).
    Quyền: Warehouse Manager, Admin (Viewer bị 403).
    """
    return classification_service.get_recommendation_for_segment(segment)
