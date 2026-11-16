"""
Simulator J1-J6 driven by ``POST /clock/advance`` (research.md §3, §7, assumptions A3/A4).

Day ``t`` is processed in this order (A4: review at the START of the day, order arrives L days later, so
the effective lead time is exactly L = 3 days, P-21):

  1. arrivals   orders APPROVED with ``review_date + L <= t`` are received once and set to COMPLETED
                (a COMPLETED order is NEVER received again, P-16)
  2. J6         if t is a review day (t0 + k*R, k >= 1): close the previous cycle [t-R, t-1] into
                ``service_outcomes`` (observed availability, §7.3)
  3. J5         refit at quarter start
  4. J3 / J4    review day: window quantiles (one bulk call), C3-OUT step, parameters, replenishment orders
                (auto-ordered: APPROVED + on_order += qty)
  5. J1         sales of day t served from on_hand, the remainder is lost (lost-sales model)

A shadow baseline B0 (raw quantile tau = 0.95, order-up-to S0 = ceil(Q_hat_0.95), no controller) is simulated in
parallel from the same initial stock and demand (``sim_shadow_daily``), replacing the fixed C3 x ratio tables (N-03).

The whole advance is ONE transaction: the clock row is locked (``SELECT ... FOR UPDATE``), every service commit
is turned into a flush, the clock is saved last and a single commit makes the advance visible. On any error the
transaction is rolled back and the clock/inventory stay untouched (P-16 / N-08).

Performance (R-18): all per-SKU work is vectorised (numpy), inventory_daily rows are COPY-loaded, and
inventory is written back with one UPDATE ... FROM unnest(...).
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from fastapi import HTTPException, status
from sqlalchemy import bindparam, delete, func, select, text, update
from sqlalchemy.orm import Session

from app.core.db_bulk import psql_insert_copy
from app.models.base import Base
from app.models.calibration_state import CalibrationState
from app.models.inventory import Inventory
from app.models.inventory_daily import InventoryDaily
from app.models.inventory_param import InventoryParam
from app.models.policy_selection import PolicySelection
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.service_outcomes import ServiceOutcome
from app.models.sim_clock import SimClock
from app.models.sim_state import SimShadowDaily, SimSnapshot
from app.services import policy_config as pc

SIM_ACTOR = "simulator"
B0_TAU = 0.95
MAX_ADVANCE_DAYS = 90
_tables_ready_for: set = set()


@contextmanager
def atomic(db: Session):
    """
    Make every ``db.commit()`` inside the block a flush so that the nested services (calibrator,
    optimization, replenishment) join ONE transaction. The caller commits once at the end.
    """
    original = db.__dict__.get("commit")
    db.commit = db.flush  # type: ignore[method-assign]
    try:
        yield
    finally:
        if original is None:
            db.__dict__.pop("commit", None)
        else:
            db.commit = original  # type: ignore[method-assign]


def ensure_tables(db: Session) -> None:
    bind = db.get_bind()
    key = id(bind)
    if key in _tables_ready_for:
        return
    Base.metadata.create_all(
        bind=bind, tables=[SimSnapshot.__table__, SimShadowDaily.__table__], checkfirst=True
    )
    _tables_ready_for.add(key)


def _is_pg(db: Session) -> bool:
    return db.get_bind().dialect.name == "postgresql"


def _copy_df(db: Session, table: str, df: pd.DataFrame) -> None:
    if df is None or len(df) == 0:
        return
    df.to_sql(table, db.connection(), if_exists="append", index=False, method=psql_insert_copy, chunksize=50000)


def write_inventory(db: Session, store_id: str, item_ids: List[str], on_hand: np.ndarray, on_order: np.ndarray) -> None:
    """Write the full inventory state of the store back (one statement on PostgreSQL)."""
    now = datetime.now(timezone.utc)
    oh = [float(x) for x in on_hand]
    oo = [float(x) for x in on_order]
    if _is_pg(db):
        db.execute(
            text(
                "UPDATE inventory i SET on_hand = u.oh, on_order = u.oo, updated_at = :now "
                "FROM unnest(CAST(:ids AS text[]), CAST(:oh AS float8[]), CAST(:oo AS float8[])) AS u(item_id, oh, oo) "
                "WHERE i.store_id = :s AND i.item_id = u.item_id"
            ),
            {"ids": list(item_ids), "oh": oh, "oo": oo, "s": store_id, "now": now},
        )
    else:
        t = Inventory.__table__
        stmt = (
            update(t)
            .where(t.c.store_id == bindparam("b_store"), t.c.item_id == bindparam("b_item"))
            .values(on_hand=bindparam("b_oh"), on_order=bindparam("b_oo"), updated_at=now)
        )
        db.execute(
            stmt,
            [{"b_store": store_id, "b_item": i, "b_oh": a, "b_oo": b} for i, a, b in zip(item_ids, oh, oo)],
        )


class SimulatorService:
    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _lock_clock(db: Session, store_id: str) -> Optional[SimClock]:
        q = db.query(SimClock).filter(SimClock.store_id == store_id).with_for_update()
        clock = q.populate_existing().first()
        return clock

    @staticmethod
    def _inventory_arrays(db: Session, store_id: str, item_ids: List[str]) -> Tuple[np.ndarray, np.ndarray, int]:
        """(on_hand, on_order, created) aligned with item_ids; missing rows are created with 0 stock."""
        rows = db.execute(
            select(Inventory.item_id, Inventory.on_hand, Inventory.on_order).where(Inventory.store_id == store_id)
        ).all()
        have = {r[0]: (float(r[1] or 0.0), float(r[2] or 0.0)) for r in rows}
        missing = [i for i in item_ids if i not in have]
        if missing:
            db.execute(
                Inventory.__table__.insert(),
                [{"item_id": i, "store_id": store_id, "on_hand": 0.0, "on_order": 0.0,
                  "updated_at": datetime.now(timezone.utc)} for i in missing],
            )
            for i in missing:
                have[i] = (0.0, 0.0)
        on_hand = np.array([have[i][0] for i in item_ids], dtype=float)
        on_order = np.array([have[i][1] for i in item_ids], dtype=float)
        return on_hand, on_order, len(missing)

    @staticmethod
    def initial_inventory_levels(db: Session, store_id: str, item_ids: List[str]) -> np.ndarray:
        """
        R-09: initial stock consistent with (R, s, S), L = 3, R = 7: each SKU starts at its order-up-to level S
        from inventory_params; if absent, at mean daily demand x H (H = L + R = 10).
        """
        pos = {i: k for k, i in enumerate(item_ids)}
        out = np.full(len(item_ids), np.nan)
        for iid, s_lvl, S_lvl, eoq, rop in db.execute(
            select(InventoryParam.item_id, InventoryParam.s, InventoryParam.S, InventoryParam.eoq,
                   InventoryParam.reorder_point).where(InventoryParam.store_id == store_id)
        ).all():
            if iid not in pos:
                continue
            if S_lvl is not None:
                out[pos[iid]] = float(S_lvl)
            elif s_lvl is not None:
                out[pos[iid]] = float(s_lvl) + float(eoq or 0.0)
            elif rop is not None:
                out[pos[iid]] = float(rop) + float(eoq or 0.0)
        miss = np.isnan(out)
        if miss.any():
            means = dict(
                db.execute(
                    select(SalesHistory.item_id, func.avg(SalesHistory.quantity))
                    .where(SalesHistory.store_id == store_id)
                    .group_by(SalesHistory.item_id)
                ).all()
            )
            for iid, k in pos.items():
                if miss[k]:
                    out[k] = float(means.get(iid) or 0.0) * pc.HORIZON_DAYS
        return np.ceil(np.maximum(out, 0.0))

    @staticmethod
    def _max_sale_date(db: Session, store_id: str) -> Optional[date]:
        return db.execute(select(func.max(SalesHistory.sale_date)).where(SalesHistory.store_id == store_id)).scalar()

    def initialise_baseline(self, db: Session, store_id: str) -> Dict[str, Any]:
        """
        Q-03: policy-consistent starting point. Every SKU starts at its order-up-to level S (from
        ``inventory_params``; mean demand x H when absent), nothing on order; this state is stored as the
        reset snapshot. Called by the bootstrap once the parameters are final.
        """
        ensure_tables(db)
        item_ids = [r[0] for r in db.execute(select(Product.item_id).order_by(Product.item_id)).all()]
        on_hand = self.initial_inventory_levels(db, store_id, item_ids)
        on_order = np.zeros(len(item_ids))
        self._inventory_arrays(db, store_id, item_ids)  # creates missing rows
        write_inventory(db, store_id, item_ids, on_hand, on_order)
        clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
        as_of = clock.start_date if clock else pc.DEMO_START_DATE
        db.execute(delete(SimSnapshot).execution_options(synchronize_session=False).where(SimSnapshot.store_id == store_id))
        db.execute(
            SimSnapshot.__table__.insert(),
            [{"store_id": store_id, "item_id": i, "on_hand": float(a), "on_order": 0.0, "as_of_date": as_of,
              "created_at": datetime.now(timezone.utc)} for i, a in zip(item_ids, on_hand)],
        )
        db.commit()
        return {"n_skus": len(item_ids), "total_on_hand": float(on_hand.sum())}

    # ------------------------------------------------------------------ reset
    def reset(self, db: Session, store_id: str, target_date: Optional[date] = None) -> Tuple[SimClock, Dict[str, Any]]:
        ensure_tables(db)
        clock = self._lock_clock(db, store_id)
        if not clock:
            raise ValueError(f"Đồng hồ mô phỏng (SimClock) không tồn tại cho cửa hàng '{store_id}'")
        start = clock.start_date
        if target_date is not None and target_date != start:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Reset chỉ về start_date ({start}) vì trạng thái tồn kho được khôi phục từ snapshot; "
                    f"dùng /clock/advance để tiến tới {target_date}."
                ),
            )
        try:
            with atomic(db):
                item_ids = [r[0] for r in db.execute(select(Product.item_id).order_by(Product.item_id)).all()]
                db.execute(delete(InventoryDaily).execution_options(synchronize_session=False).where(InventoryDaily.store_id == store_id, InventoryDaily.date > start))
                db.execute(delete(SimShadowDaily).execution_options(synchronize_session=False).where(SimShadowDaily.store_id == store_id))
                db.execute(delete(ServiceOutcome).execution_options(synchronize_session=False).where(ServiceOutcome.store_id == store_id, ServiceOutcome.cycle_start >= start))
                db.execute(delete(CalibrationState).execution_options(synchronize_session=False).where(CalibrationState.store_id == store_id, CalibrationState.review_index >= 1))
                # Q-04: review_index 0 (neutral state or the labelled artifact warm start) is the BASELINE and stays.
                # Q-05: J5 selections made by this store's simulation (store-scoped ids) are dropped, so the
                # policy returns to the seeded selection.
                db.execute(delete(PolicySelection).execution_options(synchronize_session=False).where(
                    PolicySelection.selection_id.startswith(f"{store_id}_quarter_", autoescape=True)))
                db.execute(
                    delete(ReplenishmentRecommendation).execution_options(synchronize_session=False).where(
                        ReplenishmentRecommendation.store_id == store_id,
                        ReplenishmentRecommendation.decided_by == SIM_ACTOR,
                    )
                )
                snap = {
                    r[0]: (float(r[1]), float(r[2]))
                    for r in db.execute(
                        select(SimSnapshot.item_id, SimSnapshot.on_hand, SimSnapshot.on_order)
                        .where(SimSnapshot.store_id == store_id)
                    ).all()
                }
                restored = bool(snap)
                on_hand, on_order, _ = self._inventory_arrays(db, store_id, item_ids)
                if restored:
                    for k, i in enumerate(item_ids):
                        if i in snap:
                            on_hand[k], on_order[k] = snap[i]
                else:
                    on_hand = self.initial_inventory_levels(db, store_id, item_ids)
                    on_order = np.zeros(len(item_ids))
                write_inventory(db, store_id, item_ids, on_hand, on_order)
                clock.current_date = start
                clock.updated_at = datetime.now(timezone.utc)
                db.flush()
            db.commit()
        except Exception:
            db.rollback()
            raise
        db.refresh(clock)
        return clock, {
            "snapshot_restored": restored,
            "inventory_source": "snapshot" if restored else "initial_levels_S_from_inventory_params",
            "n_skus": len(item_ids),
        }

    # ------------------------------------------------------------------ advance
    def advance(
        self,
        db: Session,
        store_id: str = "CA_1",
        days: Optional[int] = None,
        reviews: Optional[int] = None,
        until: Optional[date] = None,
        lead_time_days: int = pc.LEAD_TIME_DAYS,
        review_period_days: int = pc.REVIEW_PERIOD_DAYS,
    ) -> Dict[str, Any]:
        from app.services.calibrator_service import calibrator_service
        from app.services.optimization_service import optimization_service
        from app.services.replenishment_service import replenishment_service
        from app.services.window_quantile_service import window_quantile_service

        t_start = time.time()
        ensure_tables(db)
        clock = self._lock_clock(db, store_id)
        if not clock:
            raise ValueError(f"Đồng hồ mô phỏng (SimClock) không tồn tại cho cửa hàng '{store_id}'")
        prev_date, t0 = clock.current_date, clock.start_date
        L, R = int(lead_time_days), int(review_period_days)

        if until:
            target_date = until
        elif reviews:
            target_date = prev_date + timedelta(days=reviews * R)
        elif days:
            target_date = prev_date + timedelta(days=days)
        else:
            target_date = prev_date + timedelta(days=1)
        if target_date <= prev_date:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ngày đích ({target_date}) phải lớn hơn ngày hiện tại ({prev_date}).",
            )
        total_days = (target_date - prev_date).days
        if total_days > MAX_ADVANCE_DAYS:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Khoảng thời gian tua ({total_days} ngày) vượt quá giới hạn tối đa cho phép ({MAX_ADVANCE_DAYS} ngày).",
            )

        # demand must exist for every simulated day (never silently simulate zero demand)
        have_days = {
            r[0] for r in db.execute(
                select(SalesHistory.sale_date).where(
                    SalesHistory.store_id == store_id,
                    SalesHistory.sale_date > prev_date, SalesHistory.sale_date <= target_date,
                ).distinct()
            ).all()
        }
        need_days = [prev_date + timedelta(days=i) for i in range(1, total_days + 1)]
        missing_days = [d for d in need_days if d not in have_days]
        if missing_days:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Không có dữ liệu cầu (sales_history) của cửa hàng '{store_id}' cho {len(missing_days)} ngày, "
                    f"ngày đầu tiên thiếu: {missing_days[0]}. Nạp dữ liệu bán hàng trước khi tua."
                ),
            )

        try:
            with atomic(db):
                result = self._run(
                    db, clock, store_id, prev_date, target_date, t0, L, R,
                    calibrator_service, optimization_service, replenishment_service, window_quantile_service,
                )
                clock.current_date = target_date
                clock.updated_at = datetime.now(timezone.utc)
                db.flush()
            db.commit()
        except Exception:
            db.rollback()
            raise
        result["duration_seconds"] = round(time.time() - t_start, 2)
        return result

    # ------------------------------------------------------------------ core loop
    def _run(
        self, db, clock, store_id, prev_date, target_date, t0, L, R,
        calibrator_service, optimization_service, replenishment_service, window_quantile_service,
    ) -> Dict[str, Any]:
        item_ids = [r[0] for r in db.execute(select(Product.item_id).order_by(Product.item_id)).all()]
        n = len(item_ids)
        pos = {i: k for k, i in enumerate(item_ids)}
        on_hand, on_order, _created = self._inventory_arrays(db, store_id, item_ids)

        # snapshot of the initial state (only from a clean start, so reset can restore it)
        if prev_date == t0:
            has_snap = db.execute(select(func.count()).select_from(SimSnapshot).where(SimSnapshot.store_id == store_id)).scalar()
            if not has_snap:
                db.execute(
                    SimSnapshot.__table__.insert(),
                    [{"store_id": store_id, "item_id": i, "on_hand": float(a), "on_order": float(b),
                      "as_of_date": t0, "created_at": datetime.now(timezone.utc)}
                     for i, a, b in zip(item_ids, on_hand, on_order)],
                )

        # ---- shadow B0 state: from the last shadow row, else the same initial stock as the main policy
        sh_on_hand = on_hand.copy()
        sh_pipeline: List[Tuple[date, np.ndarray]] = []
        last_sh = db.execute(
            select(SimShadowDaily.item_id, SimShadowDaily.on_hand_end)
            .where(SimShadowDaily.store_id == store_id, SimShadowDaily.date == prev_date)
        ).all()
        if last_sh:
            sh_on_hand = np.zeros(n)
            for iid, oh in last_sh:
                if iid in pos:
                    sh_on_hand[pos[iid]] = float(oh or 0.0)
            by_date: Dict[date, np.ndarray] = {}
            for iid, d, q in db.execute(
                select(SimShadowDaily.item_id, SimShadowDaily.date, SimShadowDaily.order_qty)
                .where(SimShadowDaily.store_id == store_id, SimShadowDaily.date > prev_date - timedelta(days=L),
                       SimShadowDaily.date <= prev_date, SimShadowDaily.order_qty > 0)
            ).all():
                if iid in pos:
                    by_date.setdefault(d + timedelta(days=L), np.zeros(n))[pos[iid]] += float(q)
            sh_pipeline = sorted(by_date.items())

        # ---- demand matrix for the days to simulate
        days_list = [prev_date + timedelta(days=i) for i in range((target_date - prev_date).days + 1)][1:]
        didx = {d: k for k, d in enumerate(days_list)}
        D = np.zeros((len(days_list), n))
        for iid, d, q in db.execute(
            select(SalesHistory.item_id, SalesHistory.sale_date, SalesHistory.quantity).where(
                SalesHistory.store_id == store_id, SalesHistory.sale_date > prev_date,
                SalesHistory.sale_date <= target_date)
        ).all():
            if iid in pos and d in didx:
                D[didx[d], pos[iid]] += float(q or 0.0)

        price = np.ones(n)
        for iid, p in db.execute(select(Product.item_id, Product.price)).all():
            if iid in pos and p is not None:
                price[pos[iid]] = float(p)

        job_events: List[str] = []
        reviews_executed = 0
        stockouts_recorded = 0
        b0_stockouts_recorded = 0
        recommendations_generated = 0
        arrivals_total = 0
        main_rows: List[Dict[str, Any]] = []   # per-day arrays collected, flushed lazily
        shadow_rows: List[Dict[str, Any]] = []
        now = datetime.now(timezone.utc)

        def flush_state() -> None:
            """Persist everything simulated so far so that DB-reading services see day t-1."""
            nonlocal main_rows, shadow_rows
            if main_rows:
                dates = sorted({r["date"] for r in main_rows})
                db.execute(delete(InventoryDaily).execution_options(synchronize_session=False).where(InventoryDaily.store_id == store_id, InventoryDaily.date.in_(dates)))
                _copy_df(db, "inventory_daily", pd.concat([r["df"] for r in main_rows], ignore_index=True))
                main_rows = []
            if shadow_rows:
                dates = sorted({r["date"] for r in shadow_rows})
                db.execute(delete(SimShadowDaily).execution_options(synchronize_session=False).where(SimShadowDaily.store_id == store_id, SimShadowDaily.date.in_(dates)))
                _copy_df(db, "sim_shadow_daily", pd.concat([r["df"] for r in shadow_rows], ignore_index=True))
                shadow_rows = []
            write_inventory(db, store_id, item_ids, on_hand, on_order)
            db.flush()
            db.expire_all()

        def review_block(t: date, review_k: int, refit: bool = False) -> np.ndarray:
            """J6 (close previous cycle) -> J5 (quarter start) -> J3 quantiles -> J4 (C3-OUT step, params, orders)
            -> shadow B0 review. ``review_k = 0`` is the review at the START of day 0 (A4): nothing to close and
            no controller step (theta keeps its warm-start state)."""
            nonlocal on_hand, on_order, reviews_executed, recommendations_generated
            reviews_executed += 1
            if review_k >= 1:
                cycle_idx = review_k - 1
                calibrator_service.record_cycle_outcome(
                    db=db, store_id=store_id, cycle_index=cycle_idx,
                    cycle_start=t - timedelta(days=R), cycle_end=t - timedelta(days=1),
                )
                job_events.append(
                    f"[{t}] Job J6: đóng chu kỳ {cycle_idx} ({t - timedelta(days=R)} -> {t - timedelta(days=1)}), lưu service_outcomes"
                )
            if refit:
                q_num = (t.month - 1) // 3 + 1
                sid = f"{store_id}_quarter_{t.year}_Q{q_num}"
                optimization_service.refit_quarterly_policies(db, store_id=store_id, selection_id=sid)
                flush_state()
                job_events.append(f"[{t}] Job J5: tái chọn (m_g, kappa_g) cho {sid}")
            # --- J3: window quantiles, ONE bulk call
            recs = window_quantile_service.get_or_create_window_quantiles_bulk(
                db, store_id, item_ids, t, horizon_days=L + R
            )
            # shadow B0 reads Q_hat(0.95) now (before the session objects are expired)
            q95 = np.zeros(n)
            for iid, rec in recs.items():
                k = pos.get(iid)
                if k is not None:
                    q95[k] = window_quantile_service.tau_value(rec.q_levels or {}, B0_TAU, rec.point_window)
            # --- J4: C3-OUT step (not at k = 0), parameters, orders (auto-ordered)
            if review_k >= 1:
                calibrator_service.run_calibration_step(
                    db=db, store_id=store_id, review_index=review_k, review_date=t,
                    lead_time_days=L, review_period_days=R,
                )
            optimization_service.recompute_parameters(db, store_id=store_id)
            db.flush()
            db.expire_all()
            recs_count = replenishment_service.generate_recommendations(
                db, store_id=store_id, review_date=t, auto_order=True
            )
            recommendations_generated += recs_count
            db.flush()
            db.expire_all()
            on_hand, on_order, _ = self._inventory_arrays(db, store_id, item_ids)

            # shadow B0 review: order up to S0 = ceil(raw Q_hat(0.95))
            S0 = np.ceil(np.maximum(q95, 0.0))
            sh_ip = sh_on_hand + sum((q for _, q in sh_pipeline), np.zeros(n))
            order_today = np.where(sh_ip <= S0, np.maximum(S0 - sh_ip, 0.0), 0.0)
            if (order_today > 0).any():
                sh_pipeline.append((t + timedelta(days=L), order_today.copy()))
            job_events.append(
                f"[{t}] Job J3 & J4: review k={review_k} (đầu ngày), C³-OUT, cập nhật (s, S), {recs_count} đơn đặt "
                f"(về sau {L} ngày); B0 shadow đặt {(order_today > 0).sum()} đơn"
            )
            return order_today

        # Q-03 / A4: review at the START of day 0 from the policy-consistent initial stock (S). It runs once per
        # clean start (clock at t0; reset puts the clock back there and clears the simulated orders).
        if prev_date == t0:
            clock.current_date = t0
            flush_state()
            day0_order = review_block(t0, 0)
            # row of day 0 for the shadow: keeps the day-0 order in the persisted B0 pipeline (it arrives at t0 + L)
            shadow_rows.append({
                "date": t0,
                "df": pd.DataFrame({
                    "store_id": store_id, "item_id": item_ids, "date": t0,
                    "on_hand_end": sh_on_hand, "on_order": day0_order, "sales": 0.0, "lost_sales": 0.0,
                    "stockout": sh_on_hand <= 0, "order_qty": day0_order, "created_at": now,
                }),
            })

        for t in days_list:
            delta_days = (t - t0).days
            ti = didx[t]
            arrive_dt = datetime.combine(t, datetime.min.time(), tzinfo=timezone.utc)

            # --- 1. arrivals (main): APPROVED only, each order is received exactly once -> COMPLETED
            cutoff = t - timedelta(days=L)
            due = db.execute(
                select(ReplenishmentRecommendation.id, ReplenishmentRecommendation.item_id,
                       ReplenishmentRecommendation.final_qty, ReplenishmentRecommendation.recommended_qty)
                .where(
                    ReplenishmentRecommendation.store_id == store_id,
                    ReplenishmentRecommendation.status == "APPROVED",
                    ReplenishmentRecommendation.review_date.is_not(None),
                    ReplenishmentRecommendation.review_date <= cutoff,
                )
            ).all()
            due_ids = []
            for rid, iid, fq, rq in due:
                k = pos.get(iid)
                if k is None:
                    continue
                qty = float(fq or rq or 0.0)
                on_hand[k] += qty
                on_order[k] = max(0.0, on_order[k] - qty)
                due_ids.append(rid)
            if due_ids:
                db.execute(
                    update(ReplenishmentRecommendation).execution_options(synchronize_session=False)
                    .where(ReplenishmentRecommendation.id.in_(due_ids))
                    .values(status="COMPLETED", decided_at=arrive_dt)
                )
                arrivals_total += len(due_ids)

            # --- 1b. arrivals (shadow B0)
            while sh_pipeline and sh_pipeline[0][0] <= t:
                sh_on_hand = sh_on_hand + sh_pipeline.pop(0)[1]

            is_review = delta_days > 0 and delta_days % R == 0
            is_refit = (t.day == 1 and t.month in (1, 4, 7, 10)) or (delta_days > 0 and delta_days % 91 == 0)
            sh_order_today = np.zeros(n)

            if is_review or is_refit:
                clock.current_date = t   # services use the clock as the origin of every quantile / theta lookup
                flush_state()

            if is_review:
                review_k = delta_days // R
                sh_order_today = review_block(t, review_k, refit=is_refit)
            elif is_refit:
                q_num = (t.month - 1) // 3 + 1
                sid = f"{store_id}_quarter_{t.year}_Q{q_num}"
                optimization_service.refit_quarterly_policies(db, store_id=store_id, selection_id=sid)
                flush_state()
                job_events.append(f"[{t}] Job J5: tái chọn (m_g, kappa_g) cho {sid}")

            # --- 5. J1: sales of day t (vectorised) - main policy
            d = D[ti]
            sold = np.minimum(on_hand, d)
            lost = d - sold
            on_hand = on_hand - sold
            stockouts_recorded += int((lost > 0).sum())
            main_rows.append({
                "date": t,
                "df": pd.DataFrame({
                    "store_id": store_id, "item_id": item_ids, "date": t,
                    "on_hand_end": on_hand, "on_order": on_order, "sales": sold, "lost_sales": lost,
                    "stockout": lost > 0, "created_at": now,
                }),
            })

            # shadow B0 sales
            sh_sold = np.minimum(sh_on_hand, d)
            sh_lost = d - sh_sold
            sh_on_hand = sh_on_hand - sh_sold
            b0_stockouts_recorded += int((sh_lost > 0).sum())
            sh_inflight = sum((q for _, q in sh_pipeline), np.zeros(n))
            shadow_rows.append({
                "date": t,
                "df": pd.DataFrame({
                    "store_id": store_id, "item_id": item_ids, "date": t,
                    "on_hand_end": sh_on_hand, "on_order": sh_inflight, "sales": sh_sold, "lost_sales": sh_lost,
                    "stockout": sh_lost > 0, "order_qty": sh_order_today, "created_at": now,
                }),
            })

        clock.current_date = target_date
        flush_state()
        total_days = (target_date - prev_date).days
        return {
            "success": True,
            "store_id": store_id,
            "previous_date": prev_date,
            "current_date": target_date,
            "days_advanced": total_days,
            "reviews_executed": reviews_executed,
            "day0_review_executed": prev_date == t0,
            "stockouts_recorded": stockouts_recorded,
            "recommendations_generated": recommendations_generated,
            "orders_received": arrivals_total,
            "b0_shadow_stockouts_recorded": b0_stockouts_recorded,
            "job_events": job_events,
            "lead_time_days": L,
            "review_period_days": R,
            "n_skus": n,
            "source": "simulator",
            "as_of": target_date.isoformat(),
            "message": (
                f"Đã tua thành công {total_days} ngày (từ {prev_date} đến {target_date}). "
                f"Thực hiện {reviews_executed} kỳ review (review đầu ngày, L={L})."
            ),
        }


simulator_service = SimulatorService()
