import math
import re
from types import SimpleNamespace
from datetime import datetime, date, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.calibration_state import CalibrationState
from app.models.inventory import Inventory
from app.models.service_outcomes import ServiceOutcome
from app.models.classification import SKUClassification
from app.models.inventory_daily import InventoryDaily
from app.models.policy_selection import PolicySelection
from app.models.sim_clock import SimClock
from app.services import policy_config as pc

_KNOWN_STORE_RE = re.compile(r"(^|_)([A-Z]{2}_\d)(_|$)")


def selection_store(selection_id: Optional[str]) -> Optional[str]:
    """Store encoded in a selection_id (e.g. 'CA_1_quarter_2016_Q2'), or None for a global selection."""
    m = _KNOWN_STORE_RE.search(selection_id or "")
    return m.group(2) if m else None


class CalibratorService:
    """
    Module C³-OUT (Closed-Loop Continuous Calibrator) – Giai đoạn 5 (Task C3.1):
    Bộ điều khiển tích phân chuẩn bounded integral control (research.md §8.1):
      theta_{g, k} = theta_{g, k-1} + eta * ( e~_{g, k-d} - (1 - setpoint_g) )
    - Setpoint chuẩn: lấy từ policy_selection.setpoint (mặc định = target 0.95, guard chỉ áp 1 lần ở J5)
    - Hệ số khuếch đại: eta = 1.0
    - Trễ thông tin chu kỳ: d = ceil((L + R) / R)
    - Kẹp biên hai phía chuẩn: theta_g in [-2.0, 2.0] (research.md §8.1)
    - Quy ước biên chống bão hòa (Anti-windup): e~ = 0 khi theta >= 2.0, e~ = 1 khi theta <= -2.0
    """

    ALL_CLASSES = list(pc.ALL_CLASSES)
    DEFAULT_SETPOINT = pc.TARGET_AVAILABILITY
    DEFAULT_ETA = pc.CONTROLLER_ETA
    MAX_THETA = pc.THETA_MAX
    MIN_THETA = pc.THETA_MIN

    def latest_states(
        self, db: Session, store_id: Optional[str] = "CA_1", as_of: Optional[date] = None
    ) -> Dict[str, CalibrationState]:
        """
        Latest calibration state per class (P-02): ORDER BY review_index DESC, review_date DESC,
        created_at DESC, id DESC => deterministic; first row per class wins. States dated after
        ``as_of`` (future of the simulated clock) are ignored. store_id=None -> all stores.
        """
        q = db.query(CalibrationState)
        if store_id:
            q = q.filter(CalibrationState.store_id == store_id)
        if as_of is not None:
            q = q.filter(CalibrationState.review_date <= as_of)
        rows = q.order_by(
            CalibrationState.review_index.desc(),
            CalibrationState.review_date.desc(),
            CalibrationState.created_at.desc(),
            CalibrationState.id.desc(),
        ).all()
        latest: Dict[str, CalibrationState] = {}
        for r in rows:
            if r.class_id not in latest:
                latest[r.class_id] = r
        return latest

    def get_current_thetas(
        self, db: Session, store_id: Optional[str] = "CA_1", as_of: Optional[date] = None
    ) -> Dict[str, float]:
        """theta_g (latest) for the 9 classes, used by s = ceil(Q_hat * exp(theta_g))."""
        thetas = {c: 0.0 for c in self.ALL_CLASSES}
        for c, rec in self.latest_states(db, store_id, as_of).items():
            if rec.theta is not None and c in thetas:
                thetas[c] = float(rec.theta)
        return thetas

    def resolve_policies(
        self, db: Session, store_id: Optional[str] = "CA_1"
    ) -> Dict[str, PolicySelection]:
        """
        Policy per class: store-specific selections first, else global ones (selection_id without a
        store tag; selections of OTHER stores are ignored). Newest row wins in both cases (P-23, R-30).
        """
        rows = db.query(PolicySelection).order_by(
            PolicySelection.created_at.desc(), PolicySelection.selection_id.desc()
        ).all()
        specific: Dict[str, PolicySelection] = {}
        generic: Dict[str, PolicySelection] = {}
        for p in rows:
            st = selection_store(p.selection_id)
            if st is None:
                generic.setdefault(p.class_id, p)
            elif st == store_id:
                specific.setdefault(p.class_id, p)
        return {**generic, **specific}

    def get_current_multipliers(self, db: Session, store_id: str = "CA_1") -> Dict[str, float]:
        """
        Lấy hệ số nhân exp(theta_g) của cả 9 nhóm hàng.
        """
        thetas = self.get_current_thetas(db, store_id=store_id)
        return {k: round(math.exp(v), 4) for k, v in thetas.items()}

    def get_latest_calibration_state(
        self, db: Session, store_id: str = "CA_1"
    ) -> List[CalibrationState]:
        """Latest calibrator state of each of the 9 classes."""
        latest = self.latest_states(db, store_id)
        return [latest[c] for c in self.ALL_CLASSES if c in latest]

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

        # SKUs of the store grouped by class (R-30: only SKUs stocked in THIS store)
        class_rows = (
            db.query(SKUClassification.item_id, SKUClassification.segment)
            .join(
                Inventory,
                (SKUClassification.item_id == Inventory.item_id) & (Inventory.store_id == store_id),
            )
            .all()
        )
        skus_by_class: Dict[str, List[str]] = {}
        for item_id, seg in class_rows:
            skus_by_class.setdefault(seg, []).append(item_id)

        # P-14: OBSERVED availability (research.md §7.3 / §8.1). A SKU-period is unavailable when at
        # least one day ended with on_hand = 0, whether or not demand was lost that day.
        stocked_out = {
            r[0]
            for r in db.query(InventoryDaily.item_id)
            .filter(
                InventoryDaily.store_id == store_id,
                InventoryDaily.date >= cycle_start,
                InventoryDaily.date <= cycle_end,
                InventoryDaily.on_hand_end <= 0,
            )
            .distinct()
            .all()
        }

        for class_id in self.ALL_CLASSES:
            sku_ids = skus_by_class.get(class_id, [])
            n_sku = len(sku_ids)
            n_stockout = sum(1 for i in sku_ids if i in stocked_out)

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
        - Kẹp biên: theta_g in [-2.0, 2.0].
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

        # 4. policy_selection per class: store-specific first, then global; NEWEST row wins (P-23, R-30)
        store_policy_map = self.resolve_policies(db, store_id)

        for class_id in self.ALL_CLASSES:
            policy = store_policy_map.get(class_id)
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
                .order_by(CalibrationState.review_index.desc(), CalibrationState.created_at.desc())
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

            # Quy ước biên C³-OUT chống bão hòa tích phân (Anti-windup theo research.md §8.1):
            # ẽ = 0 khi prev_theta >= 2.0 (ngăn chặn windup khi kẹp trần trên)
            # ẽ = 1 khi prev_theta <= -2.0 (ngăn chặn windup khi kẹp sàn dưới)
            if prev_theta >= self.MAX_THETA:
                observed_error = 0.0
            elif prev_theta <= self.MIN_THETA:
                observed_error = 1.0

            # Công thức cập nhật tích phân C³-OUT (research.md §8.1)
            error_signal = observed_error - target_error_rate
            delta_theta = eta * error_signal
            raw_theta = prev_theta + delta_theta

            # Kẹp biên hai phía [-2.0, 2.0]
            new_theta = max(self.MIN_THETA, min(self.MAX_THETA, raw_theta))
            at_boundary = bool(new_theta >= self.MAX_THETA or new_theta <= self.MIN_THETA)

            if new_theta >= self.MAX_THETA:
                warnings.append(
                    f"Nhóm {class_id}: Hệ số theta đạt trần tối đa 2.0 tại review {review_index} - Mô hình dự báo có thể đã xuống cấp!"
                )
            elif new_theta <= self.MIN_THETA:
                warnings.append(
                    f"Nhóm {class_id}: Hệ số theta chạm sàn tối thiểu -2.0 tại review {review_index} - Tồn kho an toàn đã giảm tối đa."
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

    # ---- GLOBAL (all stores) aggregation (FE request: GLOBAL scope) ----------------------------------
    GLOBAL_KEYS = ("GLOBAL", "ALL")

    @classmethod
    def is_global(cls, store_id: Optional[str]) -> bool:
        return bool(store_id) and store_id.strip().upper() in cls.GLOBAL_KEYS

    @staticmethod
    def _aggregate(rows: List[CalibrationState], class_id: str, review_index: int) -> SimpleNamespace:
        n = len(rows)
        mean = lambda xs: sum(xs) / len(xs)  # noqa: E731
        top = max(rows, key=lambda r: (r.review_date, r.created_at or datetime.min))
        return SimpleNamespace(
            id=f"GLOBAL_{class_id}_rev_{review_index}", calibrator_id="global_mean_of_stores", store_id="GLOBAL",
            class_id=class_id, review_index=review_index, review_date=top.review_date,
            theta=mean([float(r.theta or 0.0) for r in rows]),
            multiplier=mean([float(r.multiplier if r.multiplier is not None else 1.0) for r in rows]),
            error_rate=mean([float(r.error_rate or 0.0) for r in rows]),
            at_boundary=any(bool(r.at_boundary) for r in rows),
            setpoint=mean([float(r.setpoint or 0.0) for r in rows]),
            eta=mean([float(r.eta or 0.0) for r in rows]),
            created_at=top.created_at or datetime.now(timezone.utc), n_stores=n,
        )

    def global_latest_states(self, db: Session) -> List[SimpleNamespace]:
        """Per class: mean over stores of each store's latest state (one store => equals that store)."""
        stores = [s for (s,) in db.query(CalibrationState.store_id).distinct().all()]
        per_class: Dict[str, List[CalibrationState]] = {}
        for st in stores:
            for c, rec in self.latest_states(db, st).items():
                per_class.setdefault(c, []).append(rec)
        return [
            self._aggregate(per_class[c], c, max(r.review_index for r in per_class[c]))
            for c in self.ALL_CLASSES if c in per_class
        ]

    def global_history(self, db: Session, class_id: Optional[str] = None, limit: int = 100) -> List[SimpleNamespace]:
        q = db.query(CalibrationState)
        if class_id:
            q = q.filter(CalibrationState.class_id == class_id)
        groups: Dict[Tuple[str, int], List[CalibrationState]] = {}
        for r in q.all():
            groups.setdefault((r.class_id, r.review_index), []).append(r)
        out = [self._aggregate(rows, c, k) for (c, k), rows in groups.items()]
        out.sort(key=lambda r: (-r.review_index, r.class_id))
        return out[:limit]


calibrator_service = CalibratorService()

