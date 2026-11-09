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
    summary="Task API.5 - Mô phỏng đối đầu 4 chính sách tồn kho (P0, P1, P4, P6)",
)
def compare_policies(
    body: PolicyComparisonRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """
    **Task API.5 - What-If Policy Simulation**:
    Chạy mô phỏng song song 4 chính sách tồn kho:
    - P0: Cổ điển (Gaussian SS + ROP + EOQ)
    - P1: Raw Route (c) Quantile (không shift m_g, theta=0)
    - P4/B2: Tĩnh đóng băng (REFIT-RSS-EOQ-G từ đầu năm, theta=0)
    - P6: C³-OUT vòng kín (REFIT-RSS-EOQ-G + One-sided C³-OUT calibrator thích nghi)
    So sánh tổng chi phí, chi phí lưu kho, chi phí đặt hàng, chi phí phạt hết hàng, và Availability.
    Role: Warehouse Manager, Admin.
    """
    return simulation_service.compare_policies(
        db=db,
        store_id=body.store_id or "CA_1",
        horizon_days=body.horizon_days or 90,
        target_service_level=body.target_service_level or 0.96,
    )
