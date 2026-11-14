from datetime import timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin, require_manager_or_admin
from app.models.inventory import Inventory
from app.models.user import User
from app.services import policy_config as pc
from app.schemas.clock import (
    SimClockResponse,
    ClockAdvanceRequest,
    ClockAdvanceResponse,
    ClockResetRequest,
    ClockSpeedRequest,
)
from app.services.pipeline_service import pipeline_service

router = APIRouter()


def _clock_response(db: Session, clock, **extra) -> SimClockResponse:
    days_elapsed = (clock.current_date - clock.start_date).days
    k = max(0, days_elapsed // pc.REVIEW_PERIOD_DAYS)
    n_skus = db.query(func.count(Inventory.item_id)).filter(Inventory.store_id == clock.store_id).scalar() or None
    return SimClockResponse(
        store_id=clock.store_id,
        current_date=clock.current_date,
        start_date=clock.start_date,
        mode=clock.mode or "replay",
        speed=clock.speed or 1.0,
        updated_at=clock.updated_at,
        days_elapsed=days_elapsed,
        reviews_elapsed=k,
        as_of=clock.current_date,
        n_skus=n_skus,
        lead_time_days=pc.LEAD_TIME_DAYS,
        review_period_days=pc.REVIEW_PERIOD_DAYS,
        next_review_date=clock.start_date + timedelta(days=(k + 1) * pc.REVIEW_PERIOD_DAYS),
        **extra,
    )


@router.get(
    "",
    response_model=SimClockResponse,
    summary="Task API.1 - Lấy thông tin đồng hồ mô phỏng ảo (sim_clock)",
)
def get_clock(
    store_id: str = Query("CA_1", description="Mã kho/cửa hàng"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **Task API.1 - Get Sim Clock**:
    Lấy ngày mô phỏng hiện tại, trạng thái, tốc độ tua và số chu kỳ review đã qua.
    Role: Warehouse Manager, Admin.
    """
    clock = pipeline_service.get_sim_clock(db, store_id=store_id, auto_create=False)
    if not clock:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Đồng hồ mô phỏng (SimClock) không tồn tại cho cửa hàng '{store_id}'",
        )
    return _clock_response(db, clock)


@router.post(
    "/advance",
    response_model=ClockAdvanceResponse,
    summary="Task API.1 - Tua đồng hồ ảo và điều phối chuỗi Batch Jobs J1 - J6 (Admin only)",
)
def advance_clock(
    body: ClockAdvanceRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **Task API.1 - Advance Sim Clock & Batch Orchestration (J1 - J6)**:
    Tua thời gian mô phỏng theo số ngày, số kỳ review, hoặc đến ngày cụ thể.
    Tự động kích hoạt chuỗi batch:
    - J1: Replay sales & daily inventory
    - J2: Nightly forecast
    - J6: Đóng chu kỳ và tính tỷ lệ lỗi service_outcomes
    - J3: Phân phối cửa sổ Route (c)
    - J4: Review kỳ C³-OUT và sinh đề xuất replenishment
    - J5: Tái chọn tham số chính sách (m_g, kappa_g) đầu Quý.
    Role: Admin only.
    """
    store_id = body.store_id or "CA_1"
    try:
        result = pipeline_service.advance_sim_clock(
            db=db,
            store_id=store_id,
            days=body.days,
            reviews=body.reviews,
            until=body.until,
        )
    except ValueError as e:
        status_code = status.HTTP_400_BAD_REQUEST if "vượt quá" in str(e) else status.HTTP_404_NOT_FOUND
        raise HTTPException(status_code=status_code, detail=str(e))
    return ClockAdvanceResponse(**result)


@router.post(
    "/reset",
    response_model=SimClockResponse,
    summary="Task API.1 - Đặt lại đồng hồ ảo về mốc xuất phát ban đầu (Admin only)",
)
def reset_clock(
    body: Optional[ClockResetRequest] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **Task API.1 - Reset Sim Clock**:
    Đặt lại ngày mô phỏng về start_date, KHÔI PHỤC tồn kho ban đầu từ snapshot và xóa dữ liệu mô phỏng sau start_date.
    Role: Admin only.
    """
    store_id = body.store_id if body and body.store_id else "CA_1"
    target_date = body.target_date if body else None
    try:
        clock, info = pipeline_service.reset_sim_clock_with_info(db, store_id=store_id, target_date=target_date)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    return _clock_response(
        db, clock, snapshot_restored=info["snapshot_restored"], inventory_source=info["inventory_source"]
    )


@router.post(
    "/speed",
    response_model=SimClockResponse,
    summary="Task API.1 - Cài đặt tốc độ tua của đồng hồ ảo (Admin only)",
)
def set_clock_speed(
    body: ClockSpeedRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **Task API.1 - Set Sim Clock Speed**:
    Cài đặt hệ số tốc độ tua (0.1x - 10.0x).
    Role: Admin only.
    """
    try:
        clock = pipeline_service.set_sim_speed(db, store_id=body.store_id or "CA_1", speed=body.speed)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return _clock_response(db, clock)
