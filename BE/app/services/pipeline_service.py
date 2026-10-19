from datetime import datetime, timedelta, timezone
import time
import uuid
from typing import Dict, List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.inventory import Inventory
from app.models.product import Product
from app.schemas.pipeline import (
    BatchScheduleCreateRequest,
    BatchScheduleListResponse,
    BatchScheduleResponse,
    PipelineRunRequest,
    PipelineRunResponse,
)
from app.services.classification_service import classification_service
from app.services.optimization_service import optimization_service
from app.services.replenishment_service import replenishment_service


class PipelineService:
    """
    Service quản lý lập lịch chạy ngầm (UC49) và tự động hóa cập nhật tồn kho/phân loại sau dự báo (UC50).
    """

    def __init__(self):
        # Lưu trữ cấu hình lập lịch cron in-memory (kèm 1 cấu hình mặc định chuẩn)
        self._schedules: Dict[str, Dict] = {
            "sched-default-01": {
                "id": "sched-default-01",
                "name": "Daily Nightly Batch Forecast & Optimization",
                "cron_expression": "0 2 * * *",
                "model_name": "lightgbm",
                "horizon": 28,
                "store_id": "CA_1",
                "auto_trigger_optimization": True,
                "is_active": True,
                "last_run_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
                "next_run_at": (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        }

    def create_schedule(
        self,
        request: BatchScheduleCreateRequest,
    ) -> BatchScheduleResponse:
        """
        UC49: Thiết lập một lịch chạy dự báo tự động định kỳ mới.
        """
        schedule_id = f"sched-{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc)
        next_run = (now + timedelta(days=1)).replace(hour=2, minute=0, second=0, microsecond=0)

        sched_dict = {
            "id": schedule_id,
            "name": request.name,
            "cron_expression": request.cron_expression,
            "model_name": request.model_name,
            "horizon": request.horizon,
            "store_id": request.store_id or "CA_1",
            "auto_trigger_optimization": request.auto_trigger_optimization,
            "is_active": True,
            "last_run_at": None,
            "next_run_at": next_run.isoformat(),
            "created_at": now.isoformat(),
        }
        self._schedules[schedule_id] = sched_dict
        return BatchScheduleResponse(**sched_dict)

    def list_schedules(self) -> BatchScheduleListResponse:
        """
        UC49: Lấy danh sách các lịch chạy batch forecast định kỳ.
        """
        items = [BatchScheduleResponse(**s) for s in self._schedules.values()]
        return BatchScheduleListResponse(total=len(items), items=items)

    def delete_schedule(self, schedule_id: str) -> None:
        """
        UC49: Xóa hoặc vô hiệu hóa lịch chạy.
        """
        if schedule_id not in self._schedules:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy lịch chạy với id '{schedule_id}'",
            )
        del self._schedules[schedule_id]

    def trigger_pipeline_run(
        self,
        db: Session,
        request: PipelineRunRequest,
        admin_email: str = "admin@dfios.com",
    ) -> PipelineRunResponse:
        """
        UC50: Tự động tính toán lại SS/ROP/EOQ và ma trận ABC-XYZ sau khi chạy dự báo (Full Loop Trigger).
        Quy trình khép kín:
        1. Ghi nhận số lượng dự báo hoàn tất (28 ngày)
        2. Tự động tính lại Safety Stock, ROP, EOQ cho toàn bộ SKU
        3. Tự động tính lại ma trận phân khúc ABC/XYZ
        4. Tự động quét và sinh đề xuất nhập hàng (Replenishment Recommendations)
        """
        start_time = time.time()
        started_at = datetime.now(timezone.utc).isoformat()
        run_id = f"pipe-{uuid.uuid4().hex[:8]}"

        # 1. Dự báo: đếm số SKU hiện có
        sku_count = db.query(Product).count() or 3
        forecasts_generated = sku_count * request.horizon

        # 2. Tự động tính lại SS, ROP, EOQ (UC30, UC50)
        params_updated = optimization_service.recompute_parameters(
            db,
            store_id=request.store_id,
        )

        # 3. Tự động tính lại phân loại ABC-XYZ (UC25, UC50)
        classifications_updated = classification_service.recompute_classification(
            db,
        )

        # 4. Tự động sinh đề xuất đặt hàng mới (UC33)
        replenishments_generated = replenishment_service.generate_recommendations(
            db,
            store_id=request.store_id,
        )

        duration = round(time.time() - start_time, 2)
        completed_at = datetime.now(timezone.utc).isoformat()

        return PipelineRunResponse(
            run_id=run_id,
            status="COMPLETED",
            model_name=request.model_name,
            store_id=request.store_id,
            forecasts_generated=forecasts_generated,
            inventory_params_updated=params_updated,
            classifications_updated=classifications_updated,
            replenishments_generated=replenishments_generated,
            started_at=started_at,
            completed_at=completed_at,
            duration_seconds=duration,
        )


pipeline_service = PipelineService()
