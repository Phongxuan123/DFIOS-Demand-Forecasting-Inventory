from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.models.user import User
from app.schemas.pipeline import (
    BatchScheduleCreateRequest,
    BatchScheduleListResponse,
    BatchScheduleResponse,
    PipelineRunRequest,
    PipelineRunResponse,
)
from app.services.pipeline_service import pipeline_service

router = APIRouter()


@router.post(
    "/schedule",
    response_model=BatchScheduleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="UC49 - Thiết lập lịch chạy dự báo tự động định kỳ (Admin only)",
    description="Admin cấu hình tần suất và biểu thức cron để hệ thống tự động suy luận dự báo nhu cầu định kỳ.",
)
def create_batch_schedule(
    request: BatchScheduleCreateRequest,
    admin: User = Depends(require_admin),
) -> BatchScheduleResponse:
    return pipeline_service.create_schedule(request)


@router.get(
    "/schedule",
    response_model=BatchScheduleListResponse,
    summary="UC49 - Danh sách các lịch chạy dự báo tự động định kỳ (Admin only)",
    description="Tra cứu danh sách các tác vụ lập lịch dự báo cron job đang hoạt động.",
)
def list_batch_schedules(
    admin: User = Depends(require_admin),
) -> BatchScheduleListResponse:
    return pipeline_service.list_schedules()


@router.delete(
    "/schedule/{schedule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="UC49 - Hủy hoặc xóa lịch chạy dự báo định kỳ (Admin only)",
)
def delete_batch_schedule(
    schedule_id: str,
    admin: User = Depends(require_admin),
):
    pipeline_service.delete_schedule(schedule_id)


@router.post(
    "/pipeline/trigger-run",
    response_model=PipelineRunResponse,
    summary="UC50 - Tự động tính lại SS/ROP/EOQ và ABC-XYZ sau dự báo (Admin only)",
    description="Kích hoạt chuỗi tác vụ toàn trình khép kín: Dự báo -> Tự động tính lại tham số tồn kho -> Tự động phân khúc ABC/XYZ -> Tự động sinh đề xuất nhập hàng.",
)
def trigger_pipeline_run(
    request: PipelineRunRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PipelineRunResponse:
    return pipeline_service.trigger_pipeline_run(
        db,
        request=request,
        admin_email=admin.email,
    )
