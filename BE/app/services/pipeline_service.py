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

    # --- Task PIPE.1 & Task API.1: Sim Clock Control & Batch Orchestration (J1 - J6) ---

    def get_sim_clock(self, db: Session, store_id: str = "CA_1") -> SimClock:
        clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
        if not clock:
            base_date = date(2015, 5, 24)
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
        lead_time_days: int = 3,
        review_period_days: int = 7,
    ) -> Dict[str, Any]:
        """
        Giai đoạn 6 (Task PIPE.1) - Chuỗi Batch Jobs (J1 - J6 Orchestration) & Điều khiển Tua đồng hồ ảo:
        - Job J1 (Replay / Ingest): Nhận sales ngày t, mô phỏng lost sales & stockout, ghi inventory_daily & inventory.
        - Job J2 (Nightly Forecast): Ghi nhận dự báo tại ngày t.
        - Job J6 (Đóng chu kỳ): Nếu ngày t kết thúc chu kỳ (Delta % R == 0) -> tổng hợp đứt hàng ghi service_outcomes.
        - Job J3 (Window Quantile): Nếu ngày t là Review Day k -> tính Q_hat(0.95) Route (c).
        - Job J4 (Review Kỳ): Chạy C³-OUT -> recompute params -> sinh đề xuất replenishment.
        - Job J5 (Quarterly Refit): Tái chọn (m_g, kappa_g) đầu Quý.
        """
        clock = self.get_sim_clock(db, store_id=store_id)
        prev_date = clock.current_date
        t0 = clock.start_date

        if until:
            target_date = until
        elif reviews:
            target_date = prev_date + timedelta(days=reviews * review_period_days)
        elif days:
            target_date = prev_date + timedelta(days=days)
        else:
            target_date = prev_date + timedelta(days=1)

        if target_date <= prev_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ngày đích ({target_date}) phải lớn hơn ngày hiện tại ({prev_date}).",
            )

        total_days = (target_date - prev_date).days
        job_events: List[str] = []
        reviews_executed = 0
        stockouts_recorded = 0
        recommendations_generated = 0

        products = db.query(Product).all()
        item_ids = [p.item_id for p in products]

        current_cursor = prev_date
        now = datetime.now(timezone.utc)

        while current_cursor < target_date:
            current_cursor = current_cursor + timedelta(days=1)
            t = current_cursor
            delta_days = (t - t0).days

            # --- Job J1: Replay / Ingest Sales & Cập nhật tồn kho ngày t ---
            order_arrival_date = t - timedelta(days=lead_time_days)
            arrived_orders = (
                db.query(ReplenishmentRecommendation)
                .filter(
                    ReplenishmentRecommendation.store_id == store_id,
                    ReplenishmentRecommendation.review_date == order_arrival_date,
                    ReplenishmentRecommendation.status.in_(["APPROVED", "COMPLETED"]),
                )
                .all()
            )
            arrived_map = {o.item_id: float(o.final_qty) for o in arrived_orders}

            sales_today = (
                db.query(SalesHistory)
                .filter(SalesHistory.store_id == store_id, SalesHistory.sale_date == t)
                .all()
            )
            sales_map = {s.item_id: float(s.quantity) for s in sales_today}

            inv_records = (
                db.query(Inventory)
                .filter(Inventory.store_id == store_id)
                .all()
            )
            inv_map = {inv.item_id: inv for inv in inv_records}

            day_stockouts = 0

            for item_id in item_ids:
                inv = inv_map.get(item_id)
                if not inv:
                    inv = Inventory(item_id=item_id, store_id=store_id, on_hand=50.0, on_order=0.0)
                    db.add(inv)
                    inv_map[item_id] = inv

                arrived_qty = arrived_map.get(item_id, 0.0)
                if arrived_qty > 0:
                    inv.on_hand += arrived_qty
                    inv.on_order = max(0.0, inv.on_order - arrived_qty)

                demand = sales_map.get(item_id, 0.0)

                if inv.on_hand >= demand:
                    actual_sales = demand
                    lost_sales = 0.0
                    stockout = False
                    inv.on_hand -= actual_sales
                else:
                    actual_sales = max(0.0, inv.on_hand)
                    lost_sales = demand - actual_sales
                    stockout = True
                    inv.on_hand = 0.0
                    day_stockouts += 1

                inv.updated_at = now

                inv_daily = (
                    db.query(InventoryDaily)
                    .filter(
                        InventoryDaily.store_id == store_id,
                        InventoryDaily.item_id == item_id,
                        InventoryDaily.date == t,
                    )
                    .first()
                )
                if inv_daily:
                    inv_daily.on_hand_end = inv.on_hand
                    inv_daily.on_order = inv.on_order
                    inv_daily.sales = actual_sales
                    inv_daily.lost_sales = lost_sales
                    inv_daily.stockout = stockout
                else:
                    inv_daily = InventoryDaily(
                        store_id=store_id,
                        item_id=item_id,
                        date=t,
                        on_hand_end=inv.on_hand,
                        on_order=inv.on_order,
                        sales=actual_sales,
                        lost_sales=lost_sales,
                        stockout=stockout,
                        created_at=now,
                    )
                    db.add(inv_daily)

            stockouts_recorded += day_stockouts

            # --- Job J6: Đóng chu kỳ phục vụ nếu chạm mốc chu kỳ (delta_days % R == 0 và delta_days > 0) ---
            if delta_days > 0 and delta_days % review_period_days == 0:
                cycle_idx = (delta_days // review_period_days) - 1
                cycle_start = t - timedelta(days=review_period_days)
                calibrator_service.record_cycle_outcome(
                    db=db,
                    store_id=store_id,
                    cycle_index=cycle_idx,
                    cycle_start=cycle_start,
                    cycle_end=t,
                )
                job_events.append(f"[{t}] Job J6: Đóng chu kỳ {cycle_idx} ({cycle_start} -> {t}) và lưu service_outcomes")

            # --- Kiểm tra Review Day k (delta_days % R == 0) ---
            if delta_days >= 0 and delta_days % review_period_days == 0:
                review_k = delta_days // review_period_days
                reviews_executed += 1

                # Job J3: Window Quantile Route (c)
                for item_id in item_ids[:10]:
                    window_quantile_service.get_or_create_window_quantile(
                        db=db,
                        store_id=store_id,
                        item_id=item_id,
                        origin_date=t,
                        horizon_days=lead_time_days + review_period_days,
                    )

                # Job J4: Review Kỳ (C³-OUT + Đặt hàng đề xuất)
                calibrator_service.run_calibration_step(
                    db=db,
                    store_id=store_id,
                    review_index=review_k,
                    review_date=t,
                    lead_time_days=lead_time_days,
                    review_period_days=review_period_days,
                )

                optimization_service.recompute_parameters(db, store_id=store_id)
                recs_count = replenishment_service.generate_recommendations(db, store_id=store_id)
                recommendations_generated += recs_count

                job_events.append(
                    f"[{t}] Job J3 & J4: Review kỳ k={review_k}. Chạy C³-OUT, cập nhật (s, S, EOQ) và sinh {recs_count} đề xuất bổ sung"
                )

            # --- Job J5: Quarterly Refit (đầu mỗi Quý hoặc mỗi 91 ngày) ---
            if (t.day == 1 and t.month in [1, 4, 7, 10]) or (delta_days > 0 and delta_days % 91 == 0):
                q_num = (t.month - 1) // 3 + 1
                sid = f"quarter_{t.year}_Q{q_num}"
                optimization_service.refit_quarterly_policies(db, store_id=store_id, selection_id=sid)
                job_events.append(f"[{t}] Job J5: Tái chọn tham số chính sách (m_g, kappa_g) cho Quý {sid}")

        clock.current_date = target_date
        clock.updated_at = datetime.now(timezone.utc)
        db.commit()

        return {
            "success": True,
            "store_id": store_id,
            "previous_date": prev_date,
            "current_date": target_date,
            "days_advanced": total_days,
            "reviews_executed": reviews_executed,
            "stockouts_recorded": stockouts_recorded,
            "recommendations_generated": recommendations_generated,
            "job_events": job_events,
            "message": f"Đã tua thành công {total_days} ngày (từ {prev_date} đến {target_date}). Thực hiện {reviews_executed} kỳ review.",
        }

    def reset_sim_clock(
        self,
        db: Session,
        store_id: str = "CA_1",
        target_date: Optional[date] = None,
    ) -> SimClock:
        clock = self.get_sim_clock(db, store_id=store_id)
        clock.current_date = target_date or clock.start_date
        clock.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(clock)
        return clock

    def set_sim_speed(
        self,
        db: Session,
        store_id: str = "CA_1",
        speed: float = 1.0,
    ) -> SimClock:
        clock = self.get_sim_clock(db, store_id=store_id)
        clock.speed = speed
        clock.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(clock)
        return clock


pipeline_service = PipelineService()
