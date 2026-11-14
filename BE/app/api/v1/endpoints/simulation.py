from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_manager_or_admin
from app.models.user import User
from app.schemas.simulation import PolicyComparisonRequest, PolicyComparisonResponse
from app.services.simulation_service import simulation_service

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
    Role: Warehouse Manager, Admin.
    """
    return simulation_service.compare_policies(
        db=db,
        store_id=body.store_id or "CA_1",
        horizon_days=body.horizon_days or 90,
        target_service_level=body.target_service_level or 0.96,
    )
