from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query, Request, Response, BackgroundTasks, status
from sqlalchemy.orm import Session

from app.api.deps import (
    get_db,
    get_current_user,
    require_manager_or_admin,
)
from app.models.user import User
from app.schemas.replenishment import (
    ReplenishmentItemResponse,
    ReplenishmentListResponse,
    ReplenishmentAdjustRequest,
    ReplenishmentActionRequest,
    ReplenishmentGenerateResponse,
)
from app.services.replenishment_service import replenishment_service

router = APIRouter()


def get_client_ip(request: Request) -> Optional[str]:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


# --- UC33: View & Generate Replenishment Recommendations ---

@router.get(
    "",
    response_model=ReplenishmentListResponse,
    summary="UC33 - Xem danh sách đề xuất đặt hàng bổ sung (Warehouse Manager, Admin)",
)
def list_replenishments(
    skip: int = Query(0, ge=0, description="Số bản ghi bỏ qua (phân trang)"),
    limit: int = Query(50, ge=1, le=200, description="Số lượng bản ghi tối đa lấy về"),
    store_id: Optional[str] = Query(None, description="Lọc theo mã kho/cửa hàng"),
    status: Optional[str] = Query(None, description="Lọc theo trạng thái: PENDING, APPROVED, REJECTED, CANCELLED"),
    priority: Optional[str] = Query(None, description="Lọc theo mức độ ưu tiên: CRITICAL, HIGH, MEDIUM, LOW"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo mã SKU hoặc lý do"),
    item_id: Optional[str] = Query(None, description="Lọc chính xác theo mã SKU"),
    auto_generate: bool = Query(True, description="Tự động sinh đề xuất nếu bảng chưa có đơn PENDING"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **UC33 - View Replenishment Recommendation List**:
    Xem danh sách các đề xuất đặt hàng bổ sung tự động sinh khi On_hand + On_order <= ROP.
    Số lượng đề xuất = EOQ, có phân cấp ưu tiên CRITICAL, HIGH, MEDIUM, LOW.
    Role: Warehouse Manager, Admin (Viewer 403).
    """
    return replenishment_service.list_recommendations(
        db=db,
        skip=skip,
        limit=limit,
        store_id=store_id,
        status=status,
        priority=priority,
        search=search,
        item_id=item_id,
        auto_generate=auto_generate,
    )


@router.post(
    "/generate",
    response_model=ReplenishmentGenerateResponse,
    summary="UC33 - Kích hoạt tự động quét và sinh đề xuất nhập hàng",
)
def generate_replenishments(
    store_id: str = Query("CA_1", description="Mã kho/cửa hàng cần quét sinh đề xuất"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **UC33 - Auto-generate Replenishment Recommendations**:
    Kích hoạt hệ thống quét toàn bộ SKU tại kho, tính toán tồn kho khả dụng vs ROP
    để sinh các đề xuất mới (chống sinh trùng lặp các đơn PENDING).
    Role: Warehouse Manager, Admin (Viewer 403).
    """
    count = replenishment_service.generate_recommendations(db, store_id=store_id)
    return ReplenishmentGenerateResponse(
        success=True,
        generated_count=count,
        message=f"Đã quét và sinh thành công {count} đề xuất nhập hàng mới.",
    )


# --- UC37: View Replenishment History (Đặt TRƯỚC /{id} để tránh bị bắt nhầm) ---

@router.get(
    "/history",
    response_model=ReplenishmentListResponse,
    summary="UC37 - Xem lịch sử xử lý đề xuất nhập hàng (Viewer, Warehouse Manager, Admin)",
)
def get_replenishment_history(
    skip: int = Query(0, ge=0, description="Số bản ghi bỏ qua"),
    limit: int = Query(50, ge=1, le=200, description="Số bản ghi tối đa lấy về"),
    store_id: Optional[str] = Query(None, description="Lọc theo kho/cửa hàng"),
    item_id: Optional[str] = Query(None, description="Lọc theo mã SKU"),
    status: Optional[str] = Query(None, description="Lọc theo trạng thái đã xử lý (APPROVED, REJECTED, CANCELLED)"),
    start_date: Optional[datetime] = Query(None, description="Lọc từ ngày"),
    end_date: Optional[datetime] = Query(None, description="Lọc đến ngày"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    **UC37 - View Replenishment History**:
    Xem lịch sử các đề xuất nhập hàng đã được phê duyệt, từ chối hoặc hủy.
    Role: Cả 3 role (Viewer, Warehouse Manager, Admin).
    """
    return replenishment_service.list_history(
        db=db,
        skip=skip,
        limit=limit,
        store_id=store_id,
        item_id=item_id,
        status=status,
        start_date=start_date,
        end_date=end_date,
    )


# --- UC38: Export Replenishment List (Đặt TRƯỚC /{id} để tránh bị bắt nhầm) ---

@router.get(
    "/export",
    summary="UC38 - Xuất danh sách đề xuất nhập hàng ra CSV/Excel (Warehouse Manager, Admin)",
)
def export_replenishments(
    store_id: Optional[str] = Query(None, description="Lọc theo kho/cửa hàng"),
    status: Optional[str] = Query(None, description="Lọc theo trạng thái"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **UC38 - Export Replenishment List**:
    Xuất danh sách đề xuất đặt hàng ra file CSV định dạng UTF-8 BOM (tương thích mở trực tiếp bằng Microsoft Excel).
    Role: Warehouse Manager, Admin (Viewer 403).
    """
    csv_content = replenishment_service.export_recommendations_csv(
        db, store_id=store_id, status=status
    )
    filename = f"replenishment_recommendations_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# --- UC34: Adjust Recommended Order Quantity ---

@router.put(
    "/{rec_id}/adjust",
    response_model=ReplenishmentItemResponse,
    summary="UC34 - Điều chỉnh số lượng đặt hàng đề xuất (Warehouse Manager, Admin)",
)
def adjust_replenishment_quantity(
    rec_id: str,
    body: ReplenishmentAdjustRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **UC34 - Adjust Recommended Order Quantity**:
    Điều chỉnh số lượng đặt hàng thực tế (final_qty), bắt buộc nhập lý do điều chỉnh.
    Chỉ được phép sửa khi đề xuất đang ở trạng thái PENDING.
    Role: Warehouse Manager, Admin (Viewer 403).
    """
    ip = get_client_ip(request)
    rec = replenishment_service.adjust_quantity(
        db=db,
        rec_id=rec_id,
        request=body,
        user_email=current_user.email,
        ip_address=ip,
    )
    # Lấy response hoàn chỉnh với thông tin liên kết
    res = replenishment_service.list_recommendations(db, item_id=rec.item_id, limit=1, auto_generate=False)
    if res.items:
        return res.items[0]
    return rec


# --- UC35: Approve Replenishment ---

@router.post(
    "/{rec_id}/approve",
    response_model=ReplenishmentItemResponse,
    summary="UC35 - Phê duyệt đề xuất nhập hàng (Warehouse Manager, Admin)",
)
def approve_replenishment(
    rec_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **UC35 - Approve Replenishment**:
    Phê duyệt đề xuất đặt hàng (PENDING -> APPROVED).
    Tự động tăng số lượng đang đặt (On_order) trong bảng tồn kho tương ứng,
    bắn sự kiện Realtime SSE inventory.updated. Không cho phép duyệt lần 2.
    Role: Warehouse Manager, Admin (Viewer 403).
    """
    ip = get_client_ip(request)
    rec = replenishment_service.approve_recommendation(
        db=db,
        rec_id=rec_id,
        user_email=current_user.email,
        ip_address=ip,
        background_tasks=background_tasks,
    )
    res = replenishment_service.list_recommendations(db, item_id=rec.item_id, limit=1, auto_generate=False)
    if res.items:
        return res.items[0]
    return rec


# --- UC36: Reject / Cancel Replenishment ---

@router.post(
    "/{rec_id}/reject",
    response_model=ReplenishmentItemResponse,
    summary="UC36 - Từ chối đề xuất nhập hàng (Warehouse Manager, Admin)",
)
def reject_replenishment(
    rec_id: str,
    body: ReplenishmentActionRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **UC36 - Reject Replenishment**:
    Từ chối đề xuất nhập hàng đang PENDING kèm lý do bắt buộc.
    Role: Warehouse Manager, Admin (Viewer 403).
    """
    ip = get_client_ip(request)
    rec = replenishment_service.reject_recommendation(
        db=db,
        rec_id=rec_id,
        reason=body.reason,
        user_email=current_user.email,
        ip_address=ip,
    )
    res = replenishment_service.list_recommendations(db, item_id=rec.item_id, limit=1, auto_generate=False)
    if res.items:
        return res.items[0]
    return rec


@router.post(
    "/{rec_id}/cancel",
    response_model=ReplenishmentItemResponse,
    summary="UC36 - Hủy đơn đặt hàng đã phê duyệt (Warehouse Manager, Admin)",
)
def cancel_replenishment(
    rec_id: str,
    body: ReplenishmentActionRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **UC36 - Cancel Approved Order**:
    Hủy đơn đặt hàng đã APPROVED khi nhà cung cấp hết hàng hoặc huỷ đơn.
    Bắt buộc có lý do. Tự động giảm (hoàn trả) On_order tương ứng trong bảng tồn kho.
    Role: Warehouse Manager, Admin (Viewer 403).
    """
    ip = get_client_ip(request)
    rec = replenishment_service.cancel_recommendation(
        db=db,
        rec_id=rec_id,
        reason=body.reason,
        user_email=current_user.email,
        ip_address=ip,
        background_tasks=background_tasks,
    )
    res = replenishment_service.list_recommendations(db, item_id=rec.item_id, limit=1, auto_generate=False)
    if res.items:
        return res.items[0]
    return rec
