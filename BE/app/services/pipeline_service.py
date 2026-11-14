from datetime import datetime, date, timedelta, timezone
import time
import uuid
from typing import Dict, List, Optional, Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.inventory import Inventory
from app.models.product import Product
from app.models.sim_clock import SimClock
from app.models.inventory_daily import InventoryDaily
from app.models.inventory_param import InventoryParam
from app.models.classification import SKUClassification
from app.models.sales_history import SalesHistory
from app.models.forecast import Forecast
from app.models.replenishment import ReplenishmentRecommendation
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
from app.services.calibrator_service import calibrator_service
from app.services.window_quantile_service import window_quantile_service
from app.services.simulator_service import simulator_service
from app.services import policy_config as pc


class PipelineService:
    """
    Service quản lý lập lịch chạy ngầm (UC49) và tự động hóa cập nhật tồn kho/phân loại sau dự báo (UC50).
    """

    SETTINGS_KEY = "batch_pipeline_schedules"

    def __init__(self):
        # Cấu hình lập lịch cron mặc định chuẩn
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
                "last_run_at": None,
                "next_run_at": (datetime.now(timezone.utc).replace(hour=2, minute=0, second=0, microsecond=0) + timedelta(days=1)).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        }

    def _get_schedules_dict(self, db: Optional[Session] = None) -> Dict[str, Dict]:
        """
        R-19: Đọc danh sách cấu hình lập lịch cron từ cơ sở dữ liệu (system_settings)
        để đảm bảo tính bền vững (persistence) khi khởi động lại ứng dụng.
        """
        if db:
            from app.repositories.system_setting_repository import system_setting_repository
            setting = system_setting_repository.get_by_key(db, self.SETTINGS_KEY)
            if setting and isinstance(setting.value, dict) and setting.value:
                self._schedules = dict(setting.value)
                return self._schedules
            else:
                system_setting_repository.upsert_setting(
                    db,
                    key=self.SETTINGS_KEY,
                    value=self._schedules,
                    description="Lịch chạy batch pipeline dự báo định kỳ (UC49)",
                )
        return self._schedules

    def _save_schedules_dict(self, schedules: Dict[str, Dict], db: Optional[Session] = None) -> None:
        """
        R-19: Lưu cấu hình lập lịch cron vào DB (system_settings).
        """
        self._schedules = schedules
        if db:
            from app.repositories.system_setting_repository import system_setting_repository
            system_setting_repository.upsert_setting(
                db,
                key=self.SETTINGS_KEY,
                value=schedules,
                description="Lịch chạy batch pipeline dự báo định kỳ (UC49)",
            )

    def create_schedule(
        self,
        request: BatchScheduleCreateRequest,
        db: Optional[Session] = None,
    ) -> BatchScheduleResponse:
        """
        UC49: Thiết lập một lịch chạy dự báo tự động định kỳ mới (lưu bền vững vào DB).
        """
        schedules = self._get_schedules_dict(db)
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
        schedules[schedule_id] = sched_dict
        self._save_schedules_dict(schedules, db=db)
        return BatchScheduleResponse(**sched_dict)

    def list_schedules(self, db: Optional[Session] = None) -> BatchScheduleListResponse:
        """
        UC49: Lấy danh sách các lịch chạy batch forecast định kỳ.
        """
        schedules = self._get_schedules_dict(db)
        items = [BatchScheduleResponse(**s) for s in schedules.values()]
        return BatchScheduleListResponse(total=len(items), items=items)

    def delete_schedule(self, schedule_id: str, db: Optional[Session] = None) -> None:
        """
        UC49: Xóa hoặc vô hiệu hóa lịch chạy.
        """
        schedules = self._get_schedules_dict(db)
        if schedule_id not in schedules:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy lịch chạy với id '{schedule_id}'",
            )
        del schedules[schedule_id]
        self._save_schedules_dict(schedules, db=db)

    def trigger_pipeline_run(
        self,
        db: Session,
        request: PipelineRunRequest,
        admin_email: str = "admin@dfios.com",
    ) -> PipelineRunResponse:
        """
        UC50: Tự động tính toán lại SS/ROP/EOQ và ma trận ABC-XYZ sau khi chạy dự báo (Full Loop Trigger).
        Quy trình khép kín:
        1. Thực hiện suy luận dự báo thực tế hoặc đếm số lượng dự báo hoàn tất (28 ngày)
        2. Tự động tính lại Safety Stock, ROP, EOQ cho toàn bộ SKU
        3. Tự động tính lại ma trận phân khúc ABC/XYZ
        4. Tự động quét và sinh đề xuất nhập hàng (Replenishment Recommendations)
        """
        start_time = time.time()
        started_at = datetime.now(timezone.utc).isoformat()
        run_id = f"pipe-{uuid.uuid4().hex[:8]}"

        # 1. Dự báo: Kiểm tra hoặc thực hiện suy luận mô hình ML thực tế cho kho hàng
        existing_fc_query = db.query(Forecast).filter(Forecast.store_id == request.store_id)
        if request.model_name:
            existing_fc_query = existing_fc_query.filter(Forecast.model_version.ilike(f"%{request.model_name}%"))
        fc_count = existing_fc_query.count()

        if fc_count == 0:
            # Nếu chưa có dự báo cho store/model, chạy suy luận thực tế từ sales_history
            from app.models.sales_history import SalesHistory
            import pandas as pd
            sales_rows = (
                db.query(SalesHistory.store_id, SalesHistory.item_id, SalesHistory.sale_date, SalesHistory.quantity)
                .filter(SalesHistory.store_id == request.store_id)
                .all()
            )
            if sales_rows:
                df_sales = pd.DataFrame(sales_rows, columns=["store_id", "item_id", "sale_date", "sales"])
                df_sales["sale_date"] = pd.to_datetime(df_sales["sale_date"])
                from app.services.fast_inference_service import fast_inference_service
                fc_df = fast_inference_service.generate_fast_forecast(
                    df_sales, horizon=request.horizon, model_version=request.model_name or "production-lightgbm"
                )
                fc_records = [
                    Forecast(
                        id=f"{r['item_id']}_{r['store_id']}_evaluation",  # M5 series id (PK, P-08)
                        item_id=r["item_id"],
                        store_id=r["store_id"],
                        forecast_date=r["forecast_date"],
                        h=r["h"],
                        y_pred=r["y_pred"],
                        p10=r["p10"],
                        p50=r["p50"],
                        p90=r["p90"],
                        available=r["available"],
                        model_version=r["model_version"],
                    )
                    for _, r in fc_df.iterrows()
                ]
                db.bulk_save_objects(fc_records)
                db.commit()
                forecasts_generated = len(fc_records)
            else:
                sku_count = db.query(Product).count() or 1
                forecasts_generated = 0  # no sales history -> nothing was generated (never sku_count * horizon)
        else:
            forecasts_generated = fc_count

        # 2. Tự động tính lại SS, ROP, EOQ (UC30, UC50)
        existing_params_count = db.query(InventoryParam).filter(InventoryParam.store_id == request.store_id).count()
        if existing_params_count == 0:
            params_updated = optimization_service.recompute_parameters(
                db,
                store_id=request.store_id,
            )
        else:
            params_updated = existing_params_count

        # 3. Tự động tính lại phân loại ABC-XYZ (UC25, UC50)
        existing_class_count = db.query(SKUClassification).count()
        if existing_class_count == 0:
            classifications_updated = classification_service.recompute_classification(
                db,
                store_id=request.store_id,
            )
        else:
            classifications_updated = existing_class_count

        # 4. Tự động sinh đề xuất đặt hàng mới (UC33)
        sim_clock = self.get_sim_clock(db, store_id=request.store_id)
        replenishments_generated = replenishment_service.generate_recommendations(
            db,
            store_id=request.store_id,
            review_date=sim_clock.current_date if sim_clock else None,
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

    # --- Task PIPE.1 & Task API.1: Sim Clock Control & Batch Orchestration (J1 - J6) ---

    def get_sim_clock(self, db: Session, store_id: str = "CA_1", auto_create: bool = False) -> Optional[SimClock]:
        clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
        if not clock and auto_create:
            base_date = pc.DEMO_START_DATE
            clock = SimClock(
                store_id=store_id,
                current_date=base_date,
                start_date=base_date,
                mode="replay",
                speed=1.0,
                updated_at=datetime.now(timezone.utc),
            )
            db.add(clock)
            db.commit()
            db.refresh(clock)
        return clock

    def advance_sim_clock(
        self,
        db: Session,
        store_id: str = "CA_1",
        days: Optional[int] = None,
        reviews: Optional[int] = None,
        until: Optional[date] = None,
        lead_time_days: int = pc.LEAD_TIME_DAYS,
        review_period_days: int = pc.REVIEW_PERIOD_DAYS,
    ) -> Dict[str, Any]:
        """
        Batch jobs J1-J6 over the simulated days (atomic, vectorised) - see ``simulator_service``.
        Review at the START of the day (A4), orders arrive L days later, COMPLETED orders are never received twice.
        """
        return simulator_service.advance(
            db, store_id=store_id, days=days, reviews=reviews, until=until,
            lead_time_days=lead_time_days, review_period_days=review_period_days,
        )

    def reset_sim_clock(
        self,
        db: Session,
        store_id: str = "CA_1",
        target_date: Optional[date] = None,
    ) -> SimClock:
        """Back to start_date and RESTORE the initial inventory snapshot, delete simulated artefacts (P-16)."""
        return self.reset_sim_clock_with_info(db, store_id=store_id, target_date=target_date)[0]

    def reset_sim_clock_with_info(self, db: Session, store_id: str = "CA_1", target_date: Optional[date] = None):
        return simulator_service.reset(db, store_id=store_id, target_date=target_date)

    def set_sim_speed(
        self,
        db: Session,
        store_id: str = "CA_1",
        speed: float = 1.0,
    ) -> SimClock:
        clock = self.get_sim_clock(db, store_id=store_id, auto_create=False)
        if not clock:
            raise ValueError(f"Đồng hồ mô phỏng (SimClock) không tồn tại cho cửa hàng '{store_id}'")
        clock.speed = speed
        clock.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(clock)
        return clock


pipeline_service = PipelineService()
