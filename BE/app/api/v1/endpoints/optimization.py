from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import (
    get_db,
    get_current_user,
    require_admin,
    require_manager_or_admin,
    get_client_ip,
)
from app.models.user import User
from app.schemas.optimization import (
    ServiceLevelConfig,
    ServiceLevelConfigUpdate,
    InventoryParamsListResponse,
    RecomputeRequest,
    RecomputeResponse,
    CompareStaticResponse,
    SensitivityAnalysisRequest,
    SensitivityAnalysisResponse,
    RefitPoliciesRequest,
    RefitPoliciesResponse,
    PolicySelectionItem,
    CurrentPolicyItem,
)
from app.services.batch_service import batch_service
from app.services.optimization_service import optimization_service

router = APIRouter()


# --- UC29: Target Service Level Configuration ---

@router.get(
    "/service-level",
    response_model=ServiceLevelConfig,
    summary="UC29 - Xem cấu hình mức phục vụ mục tiêu",
)
def get_service_level(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **UC29 - View Target Service Level**:
    Xem mức phục vụ mục tiêu (critical ratio tau) toàn hệ thống và theo từng nhóm hàng/SKU.
    Role: Warehouse Manager, Admin.
    """
    return optimization_service.get_service_level_config(db)


@router.put(
    "/service-level",
    response_model=ServiceLevelConfig,
    summary="UC29 - Thiết lập mức phục vụ mục tiêu (Admin only)",
)
def update_service_level(
    body: ServiceLevelConfigUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC29 - Configure Target Service Level**:
    Admin thiết lập mức phục vụ mục tiêu tau in [0.85, 0.99] theo nhóm hàng hoặc SKU.
    Khi đổi tau, hệ thống tự động tính lại Safety Stock (SS) và Reorder Point (ROP) cho các SKU liên quan.
    Ghi audit log đầy đủ giá trị cũ -> mới.
    Role: Admin only.
    """
    ip = get_client_ip(request)
    return optimization_service.update_service_level_config(
        db,
        request=body,
        current_user=admin,
        ip_address=ip,
    )


# --- UC30: View & Recompute Safety Stock / ROP / EOQ ---

@router.get(
    "/parameters",
    response_model=InventoryParamsListResponse,
    summary="UC30 - Xem bảng tổng hợp Safety Stock / ROP / EOQ",
)
def get_inventory_parameters(
    skip: int = Query(0, ge=0, description="Số bản ghi bỏ qua"),
    limit: int = Query(50, ge=1, le=200, description="Số bản ghi tối đa trả về"),
    store_id: Optional[str] = Query(None, description="Lọc theo mã kho/cửa hàng"),
    item_id: Optional[str] = Query(None, description="Lọc theo mã SKU"),
    category: Optional[str] = Query(None, description="Lọc theo ngành hàng"),
    source: Optional[str] = Query(None, description="Lọc theo nguồn tính toán ('ml' hoặc 'static')"),
    search: Optional[str] = Query(None, description="Tìm kiếm nhanh theo mã SKU"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **UC30 - View Safety Stock / ROP / EOQ**:
    Người dùng xem bảng tổng hợp Safety Stock (SS), Reorder Point (ROP) và Economic Order Quantity (EOQ)
    tính toán cho từng SKU.
    Công thức:
    - SS = Z_tau * sigma_L
    - ROP = d_L + SS
    - EOQ = sqrt(2 * D * S / H)
    Role: Warehouse Manager, Admin (Viewer 403).
    """
    target_item = item_id or search
    return optimization_service.get_parameters(
        db=db,
        skip=skip,
        limit=limit,
        store_id=store_id,
        item_id=target_item,
        category=category,
        source=source,
    )


@router.post(
    "/recompute",
    response_model=RecomputeResponse,
    summary="UC30 - Kích hoạt tính toán lại tham số tồn kho tối ưu",
)
def recompute_inventory_parameters(
    body: RecomputeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **UC30 - Recompute Inventory Parameters**:
    Kích hoạt tính toán lại các tham số SS, ROP, EOQ cho toàn bộ hoặc theo SKU cụ thể.
    Có cơ chế Fallback 'static' (Moving Average) khi SKU chưa có mô hình ML production.
    Role: Warehouse Manager, Admin (Viewer 403).
    """
    count = optimization_service.recompute_parameters(
        db=db,
        store_id=body.store_id or "CA_1",
        item_id=body.item_id,
        force_static=body.force_static,
    )
    return RecomputeResponse(
        success=True,
        computed_count=count,
        message=f"Đã tính toán và cập nhật thành công tham số tồn kho cho {count} SKU.",
    )


# --- UC31: Compare ML vs Static Formula ---

@router.get(
    "/compare-static",
    response_model=CompareStaticResponse,
    summary="UC31 - So sánh tham số tồn kho ML với công thức tĩnh (Admin only)",
)
def compare_ml_vs_static(
    store_id: str = Query("CA_1", description="Mã kho/cửa hàng"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC31 - Compare ML-based Parameters with Static Formula**:
    So sánh song song tham số tồn kho tính từ dự báo ML với công thức tĩnh truyền thống (Moving Average).
    Trả về chênh lệch Safety Stock, ROP, EOQ và ước tính chi phí lưu kho tiết kiệm được cho từng SKU.
    Role: Admin only (Manager/Viewer 403).
    """
    return optimization_service.compare_ml_vs_static(db, store_id=store_id)


# --- UC32: Run Cost Sensitivity Analysis ---

@router.post(
    "/sensitivity-analysis",
    response_model=SensitivityAnalysisResponse,
    summary="UC32 - Chạy phân tích độ nhạy chi phí tồn kho (Admin only)",
)
def run_cost_sensitivity_analysis(
    body: SensitivityAnalysisRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **UC32 - Run Cost Sensitivity Analysis**:
    Mô phỏng thay đổi Lead Time (+-20%) hoặc Service Level (+-5%) để ước tính tác động
    lên chi phí lưu kho (Holding Cost) và chi phí thiếu hàng (Stockout Cost).
    Tuyệt đối chỉ mô phỏng trong bộ nhớ, KHÔNG ghi đè dữ liệu thật trong cơ sở dữ liệu.
    Role: Admin only (Manager/Viewer 403).
    """
    return optimization_service.run_sensitivity_analysis(db, request=body)


# --- Task OPT.2: Quarterly Refit Policies (Job J5) ---

@router.post(
    "/refit-policies",
    response_model=RefitPoliciesResponse,
    responses={202: {"description": "async_job=true: job J5 đã nhận, theo dõi qua poll_url"}},
    summary="Job J5 - Tái chọn tham số chính sách (m_g, kappa_g) định kỳ theo Quý (Manager, Admin)",
)
def refit_policies(
    body: Optional[RefitPoliciesRequest] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_manager_or_admin),
):
    """
    **Job J5 - Quarterly Policy Refit**:
    Tái chọn cặp tham số chính sách (m_g, kappa_g) cho 9 nhóm phân loại ABC/XYZ.
    Tối ưu hóa tổng chi phí lưu kho và đặt hàng dưới ràng buộc Availability >= target + guard (backtest (R,s,S) thật).
    Lưu vết vào bảng policy_selection; mỗi lần chạy ghi một dòng batch_runs (job J5).
    Role: Warehouse Manager, Admin (demo.md §5: Manager chạy J5).
    """
    store_id = body.store_id if body and body.store_id else "CA_1"
    selection_id = body.selection_id if body else None
    target_avail = body.target_availability if body and body.target_availability else None
    c3out_active = body.c3out_active if body else None

    refit_kwargs = dict(
        selection_id=selection_id,
        target_availability=target_avail,
        c3out_active=c3out_active,
        search_mode=body.search_mode if body else None,
    )
    if body is not None and body.async_job:
        handle = batch_service.submit_refit(db, store_id=store_id, triggered_by=admin.email, **refit_kwargs)
        return JSONResponse(status_code=202, content=jsonable_encoder(handle))
    run = batch_service.run_refit(db, store_id=store_id, triggered_by=admin.email, **refit_kwargs)
    results = run["results"]

    sid = results[0]["selection_id"] if results else "quarterly_refit"
    policy_items = [PolicySelectionItem(**p) for p in results]

    return RefitPoliciesResponse(
        success=True,
        selection_id=sid,
        policies=policy_items,
        message=f"Đã tái chọn và lưu thành công chính sách REFIT-RSS-EOQ-G cho {len(policy_items)} nhóm hàng.",
        run_id=run["run_id"],
    )



# --- demo.md 6.3 GET /policies/current: (m_g, kappa_g) in force per class + current theta_g ---

@router.get(
    "/policies/current",
    response_model=List[CurrentPolicyItem],
    summary="Chính sách đang áp dụng cho 9 nhóm ABC×XYZ của cửa hàng: (m_g, kappa_g) do J5 chọn và theta_g hiện tại",
)
def get_current_policies(
    store_id: str = Query("CA_1", description="Mã cửa hàng"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Same resolution as the engine (store-specific J5 selection first, else the global one; newest wins), so the
    screen shows exactly the parameters J4 uses at the next review. Classes without any selection are omitted.
    Role: every signed-in user (read only)."""
    from app.services.calibrator_service import calibrator_service, selection_store

    policies = calibrator_service.resolve_policies(db, store_id)
    thetas = calibrator_service.get_current_thetas(db, store_id=store_id)
    out = []
    for class_id in calibrator_service.ALL_CLASSES:
        p = policies.get(class_id)
        if p is None:
            continue
        out.append(CurrentPolicyItem(
            class_id=class_id, selection_id=p.selection_id,
            scope="store" if selection_store(p.selection_id) == store_id else "global",
            policy_type=p.policy_type or "REFIT_RSS_EOQ_G", m_g=float(p.m_g or 0.0), kappa_g=float(p.kappa_g or 0.0),
            setpoint=p.setpoint, val_cost=p.val_cost, val_service=p.val_service, is_feasible=p.is_feasible,
            source=p.source, selected_at=p.created_at, theta=thetas.get(class_id),
        ))
    return out
