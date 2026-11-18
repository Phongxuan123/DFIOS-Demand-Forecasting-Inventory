"""batch_runs read API (demo.md §5 Admin "Lịch sử batch", §6 step 7, E7 timings)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_manager_or_admin
from app.models.user import User
from app.services.batch_service import batch_service

router = APIRouter()


@router.get("", summary="Lịch sử batch job (ADVANCE, J1, J3-J6): trạng thái, thời lượng, lỗi")
def list_batch_runs(
    store_id: Optional[str] = Query(None, description="Lọc theo cửa hàng"),
    job: Optional[str] = Query(None, pattern="^(ADVANCE|J1|J3|J4|J5|J6)$", description="Lọc theo job"),
    status_filter: Optional[str] = Query(None, alias="status", pattern="^(running|success|failed)$"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """Mới nhất trước. Role: Warehouse Manager, Admin."""
    return batch_service.list_runs(db, store_id=store_id, job=job, status=status_filter, limit=limit, offset=offset)


@router.get("/{run_id}", summary="Trạng thái một lần chạy (job id) và thời lượng từng job J1-J6")
def get_batch_run(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    """``status`` của dòng ADVANCE: running / success / failed; ``jobs`` là các job con; ``totals_by_job`` cộng
    thời lượng theo job (số liệu E7). Role: Warehouse Manager, Admin."""
    run = batch_service.get_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Không tìm thấy batch run '{run_id}'.")
    return run
