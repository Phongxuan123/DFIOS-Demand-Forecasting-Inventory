"""Window-quantile model switch (demo.md §7 step 10, Admin "Model versions": activate / rollback)."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.models.user import User
from app.services.forecast_source_service import forecast_source_service

router = APIRouter()


class ActivateSourceRequest(BaseModel):
    store_id: str = Field("CA_1", description="Mã cửa hàng")
    model: str = Field(..., min_length=1, max_length=40, description="Mô hình nguồn, ví dụ chronos_bolt hoặc ensemble")
    horizon_days: Optional[int] = Field(None, ge=1, le=60, description="Cửa sổ L+R (mặc định 10)")


@router.get("", summary="Mô hình nguồn của quantile cửa sổ: các mô hình có sẵn, mô hình đang phục vụ, lịch sử kích hoạt")
def get_forecast_sources(
    store_id: str = Query("CA_1"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Role: Admin."""
    return forecast_source_service.overview(db, store_id)


@router.post("/activate", summary="Kích hoạt mô hình nguồn (hoặc rollback) cho các kỳ review chưa chạy")
def activate_forecast_source(
    body: ActivateSourceRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Thay quantile cửa sổ của mọi kỳ review SAU đồng hồ mô phỏng bằng quantile của ``model`` (kịch bản E9c).
    Các kỳ đã review giữ nguyên, nên không quyết định nào trong quá khứ thay đổi. Rollback = kích hoạt lại mô hình
    trước đó. Role: Admin."""
    kw = {"horizon_days": body.horizon_days} if body.horizon_days else {}
    return forecast_source_service.activate(db, body.store_id, body.model, actor=admin.email, **kw)
