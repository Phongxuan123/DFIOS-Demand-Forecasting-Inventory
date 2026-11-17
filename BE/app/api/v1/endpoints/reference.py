from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.models.user import User
from app.services.reference_service import get_e10b_reference

router = APIRouter()


@router.get(
    "/e10b",
    summary="Khớp chuẩn E10b (Table 17): replay offline so với số liệu của giảng viên",
)
def get_e10b(current_user: User = Depends(get_current_user)) -> dict:
    return get_e10b_reference()
