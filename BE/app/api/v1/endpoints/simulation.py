from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_manager_or_admin
from app.models.user import User
from app.schemas.simulation import PolicyComparisonRequest, PolicyComparisonResponse, WhatIfRequest, WhatIfResponse
from app.services.simulation_service import simulation_service
from app.services.what_if_service import what_if_service

router = APIRouter()


@router.post(
    "/compare-policies",
    response_model=PolicyComparisonResponse,
    summary="Task API.5 - Mô phỏng đối đầu 4 chính sách tồn kho (B0, B2, P-CR, P6)",
)
def compare_policies(
    body: PolicyComparisonRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **Task API.5 - What-If Policy Comparison (artifact extract)**:
    Trả về kết quả offline của 4 chính sách trong artifact M5 (c3ok_results.csv), quy đổi theo số SKU/ngày:
    - B0: raw quantile τ=0.95 (DFIOS gốc) | B2: raw quantile τ*=0.99
    - PCR: C³-OUT với setpoint = critical ratio (τ=0.9615) | P6: C³-OUT τ=0.95 (bộ điều khiển mức phục vụ)
    Phản hồi gắn `source="artifact_extract"`, `simulated=false`; thiếu artifact -> 503.
    Khi body có `what_if`, trường `what_if` của phản hồi chứa kết quả MÔ PHỎNG THẬT (giống `POST /simulation/what-if`).
    Role: Warehouse Manager, Admin.
    """
    res = simulation_service.compare_policies(
        db=db,
        store_id=body.store_id or "CA_1",
        horizon_days=body.horizon_days or 90,
        target_service_level=body.target_service_level or 0.96,
    )
    if body.what_if is not None:
        res.what_if = what_if_service.run(db, body.what_if).model_dump(mode="json")
        res.what_if_reason = None
    return res


@router.post(
    "/what-if",
    response_model=WhatIfResponse,
    summary="FR10 - What-if: mô phỏng lại (R, s, S) trên lịch sử của cửa hàng với L, R, h, b, c và tham số chính sách",
)
def run_what_if(
    body: WhatIfRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **FR10 - What-if simulation (REAL, `source="simulated"`)**: replays the last `n_reviews` reviews before the store's
    simulated clock with the vectorised lost-sales (R, s, S) backtest (engine of J5), causal route-(c) quantiles of the
    stored review forecasts, realised demand and the user's L (1|3|7), R, h, b, c and policies. Returns cost /
    availability / orders per policy and per ABC-XYZ class. Unsupported inputs or insufficient data -> 422 with
    `reason_code` + `reason` (e.g. R = 1: the stored review forecasts are weekly).
    Role: Warehouse Manager, Admin.
    """
    return what_if_service.run(db, body)
