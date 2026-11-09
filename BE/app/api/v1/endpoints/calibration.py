from typing import Optional, List
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin, require_manager_or_admin
from app.models.user import User
from app.schemas.calibration import (
    CalibrationStateItem,
    ServiceOutcomeItem,
    CalibrationStepRequest,
    CalibrationStepResponse,
    CalibrationStatusResponse,
)
from app.services.calibrator_service import calibrator_service

router = APIRouter()


@router.get(
    "/status",
    response_model=CalibrationStatusResponse,
    summary="Xem trạng thái bộ điều khiển vòng kín C³-OUT của 9 nhóm hàng",
)
def get_calibration_status(
    store_id: str = Query("CA_1", description="Mã kho/cửa hàng"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **C³-OUT Calibration Status**:
    Xem trạng thái hệ số theta, hệ số nhân exp(theta), và cờ cảnh báo bão hòa biên của 9 nhóm ABC/XYZ.
    """
    states = calibrator_service.get_latest_calibration_state(db, store_id=store_id)
    thetas = calibrator_service.get_current_thetas(db, store_id=store_id)
    multipliers = calibrator_service.get_current_multipliers(db, store_id=store_id)

    at_boundary_classes = [c for c, th in thetas.items() if th >= calibrator_service.MAX_THETA]
    has_warning = len(at_boundary_classes) > 0

    latest_rev = max([s.review_index for s in states], default=0)
    latest_date = states[0].review_date if states else None

    return CalibrationStatusResponse(
        store_id=store_id,
        latest_review_index=latest_rev,
        latest_review_date=latest_date,
        thetas=thetas,
        multipliers=multipliers,
        at_boundary_classes=at_boundary_classes,
        has_warning=has_warning,
        states=[CalibrationStateItem.model_validate(s) for s in states],
    )


@router.post(
    "/step",
    response_model=CalibrationStepResponse,
    summary="Job J4 - Thực thi một bước cập nhật tích phân C³-OUT (Admin only)",
)
def trigger_calibration_step(
    body: Optional[CalibrationStepRequest] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    **Job J4 - Execute C³-OUT Calibration Step**:
    Cập nhật hệ số theta_{g, k} dựa trên sai số phục vụ e~_{g, k-d} từ chu kỳ k-d đã chín.
    Role: Admin only.
    """
    store_id = body.store_id if body and body.store_id else "CA_1"
    rev_index = body.review_index if body else None
    rev_date = body.review_date if body else None
    lt = body.lead_time_days if body else 3
    rp = body.review_period_days if body else 7

    states, warnings, consumed_cycle = calibrator_service.run_calibration_step(
        db=db,
        store_id=store_id,
        review_index=rev_index,
        review_date=rev_date,
        lead_time_days=lt,
        review_period_days=rp,
    )

    rev_idx_val = states[0].review_index if states else 0
    state_items = [CalibrationStateItem.model_validate(s) for s in states]

    return CalibrationStepResponse(
        success=True,
        review_index=rev_idx_val,
        consumed_cycle_index=consumed_cycle,
        states=state_items,
        warnings=warnings,
        message=f"Đã cập nhật thành công C³-OUT cho {len(states)} nhóm hàng tại review kỳ {rev_idx_val} (tiêu thụ chu kỳ {consumed_cycle}).",
    )


@router.get(
    "/history",
    response_model=List[CalibrationStateItem],
    summary="Xem lịch sử biến thiên hệ số điều khiển theta của các nhóm",
)
def get_calibration_history(
    store_id: str = Query("CA_1", description="Mã kho/cửa hàng"),
    class_id: Optional[str] = Query(None, description="Mã nhóm hàng (AX, AY, ...)"),
    limit: int = Query(100, ge=1, le=500, description="Số bản ghi tối đa"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **Calibration History**:
    Lấy chuỗi thời gian theta_{g, k} phục vụ vẽ biểu đồ giám sát vòng kín trên UI.
    """
    records = calibrator_service.get_calibration_history(
        db=db, store_id=store_id, class_id=class_id, limit=limit
    )
    return [CalibrationStateItem.model_validate(r) for r in records]

