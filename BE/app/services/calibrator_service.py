import math
from datetime import datetime, date, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.calibration_state import CalibrationState
from app.models.inventory import Inventory
from app.models.service_outcomes import ServiceOutcome
from app.models.classification import SKUClassification
from app.models.inventory_daily import InventoryDaily
from app.models.policy_selection import PolicySelection
from app.models.sim_clock import SimClock


class CalibratorService:
    """
    Module C³-OUT (Closed-Loop Continuous Calibrator) – Giai đoạn 5 (Task C3.1):
    Bộ điều khiển tích phân một phía (One-Sided C³-OUT Integral Control):
      theta_{g, k} = theta_{g, k-1} + eta * ( e~_{g, k-d} - (1 - setpoint_g) )
    - Setpoint chuẩn: 0.96 (Target 0.95 + Guard 0.01)
    - Hệ số khuếch đại: eta = 1.0
    - Trễ thông tin chu kỳ: d = ceil((L + R) / R)
    - Kẹp biên một phía: theta_g in [0.0, 2.0]
    """

    ALL_CLASSES = ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"]
    DEFAULT_SETPOINT = 0.96
    DEFAULT_ETA = 1.0
    MAX_THETA = 2.0
    MIN_THETA = 0.0

    def get_current_thetas(self, db: Session, store_id: str = "CA_1") -> Dict[str, float]:
        """
        Lấy hệ số theta hiện tại của cả 9 nhóm hàng phục vụ tính s = ceil( Q_hat * exp(m_g + theta_g) ).
        """
        thetas = {c: 0.0 for c in self.ALL_CLASSES}
        for c in self.ALL_CLASSES:
            latest = (
                db.query(CalibrationState)
                .filter(CalibrationState.store_id == store_id, CalibrationState.class_id == c)
                .order_by(CalibrationState.review_index.desc())
                .first()
            )
            if latest and latest.theta is not None:
                thetas[c] = float(latest.theta)
        return thetas

    def get_current_multipliers(self, db: Session, store_id: str = "CA_1") -> Dict[str, float]:
        """
        Lấy hệ số nhân exp(theta_g) của cả 9 nhóm hàng.
        """
        thetas = self.get_current_thetas(db, store_id=store_id)
        return {k: round(math.exp(v), 4) for k, v in thetas.items()}

    def get_latest_calibration_state(
        self, db: Session, store_id: str = "CA_1"
    ) -> List[CalibrationState]:
        """
        Lấy danh sách bản ghi trạng thái calibrator mới nhất của 9 nhóm hàng.
        """
        states: List[CalibrationState] = []
        for c in self.ALL_CLASSES:
            rec = (
                db.query(CalibrationState)
                .filter(CalibrationState.store_id == store_id, CalibrationState.class_id == c)
                .order_by(CalibrationState.review_index.desc())
                .first()
            )
            if rec:
                states.append(rec)
        return states

    def record_cycle_outcome(
        self,
        db: Session,
        store_id: str = "CA_1",
        cycle_index: int = 0,
        cycle_start: Optional[date] = None,
        cycle_end: Optional[date] = None,
        calibrator_id: Optional[str] = None,
    ) -> List[ServiceOutcome]:
        """
        Job J6 - Tổng hợp kết quả phục vụ thực tế (đứt hàng) của chu kỳ vừa kết thúc.
        Tính tỷ lệ lỗi e~ = n_stockout / n_sku cho từng nhóm ABC-XYZ và lưu vào service_outcomes.
        """
        cid = calibrator_id or f"c3out_main_{store_id}"
        now = datetime.now(timezone.utc)

        if not cycle_end:
            clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
            cycle_end = clock.current_date if clock and clock.current_date else date.today()
        if not cycle_start:
            # Chu kỳ rà soát R = 7 ngày chính xác (không chồng lấn)
            cycle_start = cycle_end - timedelta(days=6)

        outcomes: List[ServiceOutcome] = []

        for class_id in self.ALL_CLASSES:
            skus = (
                db.query(SKUClassification.item_id)
                .join(
                    Inventory,
                    (SKUClassification.item_id == Inventory.item_id)
                    & (Inventory.store_id == store_id),
                )
                .filter(SKUClassification.segment == class_id)
                .all()
            )
            sku_ids = [s[0] for s in skus]
            n_sku = len(sku_ids)

            n_stockout = 0
            if sku_ids:
                # Đếm số SKU có ít nhất 1 ngày stockout trong chu kỳ
                stockout_query = (
                    db.query(InventoryDaily.item_id)
                    .filter(
                        InventoryDaily.store_id == store_id,
                        InventoryDaily.item_id.in_(sku_ids),
                        InventoryDaily.date >= cycle_start,
                        InventoryDaily.date <= cycle_end,
                        (InventoryDaily.stockout == True) | (
                            (InventoryDaily.on_hand_end <= 0) & (InventoryDaily.lost_sales > 0)
                        ),
                    )
                    .distinct()
                    .all()
                )
                n_stockout = len(stockout_query)

            # Tính tỷ lệ lỗi e~ thực tế
            error_rate = round(n_stockout / max(1, n_sku), 4) if n_sku > 0 else 0.0

            rec_id = f"{store_id}_{class_id}_cycle_{cycle_index}"
            existing = db.query(ServiceOutcome).filter(ServiceOutcome.id == rec_id).first()
            if existing:
                existing.cycle_start = cycle_start
                existing.cycle_end = cycle_end
                existing.n_sku = n_sku
                existing.n_stockout = n_stockout
                existing.error_rate = error_rate
                outcomes.append(existing)
            else:
                outcome = ServiceOutcome(
                    id=rec_id,
                    calibrator_id=cid,
                    store_id=store_id,
                    class_id=class_id,
                    cycle_index=cycle_index,
                    cycle_start=cycle_start,
                    cycle_end=cycle_end,
                    n_sku=n_sku,
                    n_stockout=n_stockout,
                    error_rate=error_rate,
                    consumed_at_review=None,
                    created_at=now,
                )
                db.add(outcome)
                outcomes.append(outcome)

        db.commit()
        return outcomes

    def run_calibration_step(
        self,
        db: Session,
        store_id: str = "CA_1",
        review_index: Optional[int] = None,
        review_date: Optional[date] = None,
        lead_time_days: int = 3,
        review_period_days: int = 7,
        calibrator_id: Optional[str] = None,
    ) -> Tuple[List[CalibrationState], List[str], int]:
        """
        Job J4 - Thực thi một bước cập nhật tích phân C³-OUT tại Ngày Review k (t_k):
          d = ceil((L + R) / R)
          theta_{g, k} = theta_{g, k-1} + eta * ( e~_{g, k-d} - (1 - setpoint_g) )
        - e~_{g, k-d}: Đọc từ bảng service_outcomes của chu kỳ k-d đã chín.
        - Kẹp biên: theta_g in [0.0, 2.0].
        - Nếu theta_g >= 2.0: Cảnh báo mô hình dự báo suy giảm.
        """
        cid = calibrator_id or f"c3out_main_{store_id}"
        now = datetime.now(timezone.utc)

        # 1. Xác định review_date
        if not review_date:
            clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
            review_date = clock.current_date if clock and clock.current_date else date.today()

        # 2. Xác định review_index
        if review_index is None:
            max_rev = (
                db.query(func.max(CalibrationState.review_index))
                .filter(CalibrationState.store_id == store_id)
                .scalar()
            )
            review_index = (max_rev + 1) if max_rev is not None else 1

        # 3. Tính độ trễ chu kỳ d = ceil((L + R) / R)
        delay_d = math.ceil((lead_time_days + review_period_days) / float(review_period_days))
        consumed_cycle_index = review_index - delay_d

        updated_states: List[CalibrationState] = []
        warnings: List[str] = []

        for class_id in self.ALL_CLASSES:
            # Lấy setpoint & eta từ policy_selection theo store_id nếu có (R-30)
            policy = (
                db.query(PolicySelection)
                .filter(
                    PolicySelection.class_id == class_id,
                    PolicySelection.selection_id.like(f"%{store_id}%"),
                )
                .order_by(PolicySelection.created_at.desc())
                .first()
            )
            if not policy:
                policy = (
                    db.query(PolicySelection)
                    .filter(PolicySelection.class_id == class_id)
                    .order_by(PolicySelection.created_at.desc())
                    .first()
                )
            setpoint = float(policy.setpoint) if policy and policy.setpoint else self.DEFAULT_SETPOINT
            eta = float(policy.gain_eta) if policy and policy.gain_eta else self.DEFAULT_ETA
            target_error_rate = 1.0 - setpoint

            # Lấy trạng thái theta trước đó (k-1)
            prev_state = (
                db.query(CalibrationState)
                .filter(
                    CalibrationState.store_id == store_id,
                    CalibrationState.class_id == class_id,
                    CalibrationState.review_index < review_index,
                )
                .order_by(CalibrationState.review_index.desc())
                .first()
            )
            prev_theta = float(prev_state.theta) if prev_state and prev_state.theta is not None else 0.0

            # Lấy tín hiệu lỗi e~_{g, k-d}
            observed_error = target_error_rate  # Mặc định trung hòa nếu chưa có phản hồi chín
            if consumed_cycle_index >= 0:
                outcome = (
                    db.query(ServiceOutcome)
                    .filter(
                        ServiceOutcome.store_id == store_id,
                        ServiceOutcome.class_id == class_id,
                        ServiceOutcome.cycle_index == consumed_cycle_index,
                    )
                    .first()
                )
                if outcome:
                    observed_error = float(outcome.error_rate)
                    outcome.consumed_at_review = review_index

            # Quy ước biên C³-OUT theo research.md §8.1:
            # ẽ = 0 khi prev_theta >= 2.0 (ngăn chặn windup khi kẹp trần trên)
            # ẽ = 1 khi prev_theta <= -2.0 (ngăn chặn windup khi kẹp sàn dưới)
            if prev_theta >= self.MAX_THETA:
                observed_error = 0.0
            elif prev_theta <= self.MIN_THETA:
                observed_error = 1.0

            # Công thức cập nhật tích phân một phía C³-OUT
            error_signal = observed_error - target_error_rate
            delta_theta = eta * error_signal
            raw_theta = prev_theta + delta_theta

            # Kẹp biên một phía [0.0, 2.0]
            new_theta = max(self.MIN_THETA, min(self.MAX_THETA, raw_theta))
            at_boundary = bool(new_theta >= self.MAX_THETA)

            if at_boundary:
                warnings.append(
                    f"Nhóm {class_id}: Hệ số theta đạt trần tối đa 2.0 tại review {review_index} - Mô hình dự báo có thể đã xuống cấp!"
                )

            multiplier = round(math.exp(new_theta), 4)

            # Lưu vào bảng calibration_state
            rec_id = f"{store_id}_{class_id}_rev_{review_index}"
            existing = db.query(CalibrationState).filter(CalibrationState.id == rec_id).first()
            if existing:
                existing.theta = round(new_theta, 4)
                existing.multiplier = multiplier
                existing.error_rate = round(observed_error, 4)
                existing.at_boundary = at_boundary
                existing.setpoint = setpoint
                existing.eta = eta
                existing.review_date = review_date
                updated_states.append(existing)
            else:
                new_state = CalibrationState(
                    id=rec_id,
                    calibrator_id=cid,
                    store_id=store_id,
                    class_id=class_id,
                    review_index=review_index,
                    review_date=review_date,
                    theta=round(new_theta, 4),
                    multiplier=multiplier,
                    error_rate=round(observed_error, 4),
                    at_boundary=at_boundary,
                    setpoint=setpoint,
                    eta=eta,
                    created_at=now,
                )
                db.add(new_state)
                updated_states.append(new_state)

        db.commit()
        return updated_states, warnings, consumed_cycle_index

    def get_calibration_history(
        self,
        db: Session,
        store_id: str = "CA_1",
        class_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[CalibrationState]:
        """
        Lấy lịch sử vết điều khiển theta theo thời gian phục vụ vẽ biểu đồ C³-OUT.
        """
        query = db.query(CalibrationState).filter(CalibrationState.store_id == store_id)
        if class_id:
            query = query.filter(CalibrationState.class_id == class_id)
        return query.order_by(CalibrationState.review_index.desc()).limit(limit).all()


calibrator_service = CalibratorService()

