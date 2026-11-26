"""
Simulator J1-J6 driven by ``POST /clock/advance`` (research.md §3, §7, assumptions A3/A4).

Day ``t`` is processed in this order (A4: review at the START of the day, order arrives L days later, so
the effective lead time is exactly L = 3 days, P-21):

  1. arrivals   orders APPROVED with ``review_date + L <= t`` are received once and set to COMPLETED
                (a COMPLETED order is NEVER received again, P-16)
  2. J6         if t is review k (t = t0 + k*R) and k >= d = ceil((L+R)/R): close the service cycle of review
                k - d, i.e. days [t_{k-d} + L, t_{k-d} + L + R - 1] (the days the order of that review serves,
                teacher G-01). It is the most recent COMPLETE cycle (its end is < t) and exactly the one the
                C3-OUT step of review k consumes; stored in ``service_outcomes`` (observed availability, §7.3)
  3. J5         refit every 91 days from the simulation start
  4. J3 / J4    review day: window quantiles (one bulk call), C3-OUT step, parameters, replenishment orders
                (auto-ordered: APPROVED + on_order += qty; strict trigger IP < s, G-02)
  5. J1         sales of day t served from on_hand, the remainder is lost (lost-sales model); the end-of-day
                stock is stored in ``inventory_daily`` (holding is charged on it)

The start date t0 is a full simulated day like every other one (teacher rss.py / replay_e10b): the advance that
leaves the clean start (clock at t0) runs the review at the START of t0 (review k = 0), then simulates the sales of
t0 and writes its ``inventory_daily`` row, then days t0+1 .. target. The clock's ``current_date`` is the last day
whose demand has been simulated, except at the clean start where nothing has been simulated yet.

A shadow baseline B0-MA-OUT-0.95 (teacher E10 ``e10_static_formula``, G-41) is simulated in parallel from the same
initial stock and demand (``sim_shadow_daily``): at every review S = ceil(mu56 * (L+R) + z_0.95 * sigma56 *
sqrt(L+R) - 1e-9), mu56 / sigma56 = mean / sample std (ddof = 1) of the daily sales of the 56 days BEFORE the review
(fewer when the history is shorter), order S - IP when IP < S (order-up-to, strict). No forecast, no controller.

Initial stock at the clock start (G-03): round(mean sales of the 28 days before the start * (L + R)) per SKU; the
legacy S from ``inventory_params`` is used only when the store has no sales at all in that 28-day window.

The whole advance is ONE transaction: the clock row is locked (``SELECT ... FOR UPDATE``), every service commit
is turned into a flush, the clock is saved last and a single commit makes the advance visible. On any error the
transaction is rolled back and the clock/inventory stay untouched (P-16 / N-08).

Performance (R-18): all per-SKU work is vectorised (numpy), inventory_daily rows are COPY-loaded, and
inventory is written back with one UPDATE ... FROM unnest(...).
"""
from __future__ import annotations

import math
import time
import uuid
from contextlib import contextmanager
from statistics import NormalDist
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from fastapi import HTTPException, status
from sqlalchemy import bindparam, delete, func, select, text, update
from sqlalchemy.orm import Session

from app.core.db_bulk import psql_insert_copy
from app.models.base import Base
from app.models.batch_run import BatchRun
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

REFIT_PERIOD_DAYS = 91  # teacher: J5 quarters are start + 91 * j (no calendar quarters)


def is_refit_day(delta_days: int) -> bool:
    """J5 refit trigger: every 91 days counted from the simulation start (delta_days = day index since start)."""
    return delta_days > 0 and delta_days % REFIT_PERIOD_DAYS == 0

SIM_ACTOR = "simulator"
# Order approval of the simulated reviews (demo.md §4.4 / §6 step 6-7):
#   auto    every proposal is placed at once (APPROVED, decided_by = simulator) - replay / equivalence runs
#   planner the review leaves its proposals PENDING (origin = simulator); the advance STOPS at that review day so the
#           planner edits / approves them (q_final = final_qty is what arrives L days later)
# In BOTH modes the next advance is refused (409) while proposals of the simulator are still open, unless
# expire_pending=True (they then become REJECTED "expired": not ordered). Without this an auto advance after a planner
# stop would silently leave them PENDING forever: those orders would never be placed.
APPROVAL_AUTO = "auto"
APPROVAL_PLANNER = "planner"
APPROVAL_MODES = (APPROVAL_AUTO, APPROVAL_PLANNER)
OPEN_STATUSES = ("PENDING", "PROPOSED")
B0_TAU = 0.95
B0_Z = NormalDist().inv_cdf(B0_TAU)   # 1.6449 (z_0.95 of the teacher's B0-MA-OUT-0.95)
B0_MA_WINDOW_DAYS = 56                # teacher e10_static_formula.moving_stats WINDOW
INIT_STOCK_WINDOW_DAYS = 28           # G-03
CEIL_EPS = 1e-9
MAX_ADVANCE_DAYS = 90
_tables_ready_for: set = set()


class _JobTimer:
    """Collects the per-job timings of one advance (written to ``batch_runs``, E7)."""

    def __init__(self) -> None:
        self.rows: List[Dict[str, Any]] = []
        self.j1_ms = 0.0
        self.j1_days = 0
        self.n_items: Optional[int] = None

    @contextmanager
    def job(self, job: str, sim_date: date, review_index: Optional[int] = None, n_items: Optional[int] = None):
        started = datetime.now(timezone.utc)
        t = time.perf_counter()
        row: Dict[str, Any] = {"job": job, "sim_date": sim_date, "review_index": review_index, "n_items": n_items,
                               "started_at": started}
        yield row
        row["duration_ms"] = round((time.perf_counter() - t) * 1000.0, 2)
        row["finished_at"] = datetime.now(timezone.utc)
        self.rows.append(row)


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
        bind=bind, tables=[SimSnapshot.__table__, SimShadowDaily.__table__, BatchRun.__table__], checkfirst=True
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
    def initial_inventory_levels(
        db: Session, store_id: str, item_ids: List[str], as_of: Optional[date] = None,
        lead_time_days: int = pc.LEAD_TIME_DAYS, review_period_days: int = pc.REVIEW_PERIOD_DAYS,
    ) -> np.ndarray:
        """
        G-03 (teacher e10b/e9c): initial stock = round(mean daily sales of the 28 days BEFORE the clock start *
        (L + R)) per SKU. The mean is taken over the days of that window on which the store has sales rows (an SKU
        without a row on such a day sold 0). ``as_of`` defaults to the clock's start_date.
        Legacy fallback (R-09) when the store has NO sales in that window: the order-up-to level S from
        inventory_params; if absent, mean daily demand x H (H = L + R = 10).
        """
        pos = {i: k for k, i in enumerate(item_ids)}
        if as_of is None:
            clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
            as_of = clock.start_date if clock else None
        if as_of is not None:
            lo = as_of - timedelta(days=INIT_STOCK_WINDOW_DAYS)
            rows = db.execute(
                select(SalesHistory.item_id, SalesHistory.sale_date, SalesHistory.quantity).where(
                    SalesHistory.store_id == store_id, SalesHistory.sale_date >= lo, SalesHistory.sale_date < as_of)
            ).all()
            n_days = len({r[1] for r in rows})
            if n_days:
                tot = np.zeros(len(item_ids))
                for iid, _d, q in rows:
                    k = pos.get(iid)
                    if k is not None:
                        tot[k] += float(q or 0.0)
                return np.round(tot / n_days * (int(lead_time_days) + int(review_period_days)))
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
    def b0_ma_out_order_up_to(history: np.ndarray, lead_time_days: int, review_period_days: int) -> np.ndarray:
        """
        G-41: order-up-to level of B0-MA-OUT-0.95 from a (n_items, days) matrix of the daily sales BEFORE the review
        (the last ``B0_MA_WINDOW_DAYS`` columns are used): S = ceil(mu * (L+R) + z_0.95 * sigma * sqrt(L+R) - 1e-9)
        with mu = mean and sigma = sample std (ddof = 1; 0 with < 2 days). No history -> S = 0.
        """
        h = np.asarray(history, dtype=float)[:, -B0_MA_WINDOW_DAYS:]
        n_items, n_days = h.shape
        if n_days == 0:
            return np.zeros(n_items)
        H = float(int(lead_time_days) + int(review_period_days))
        mu = h.mean(axis=1)
        sigma = h.std(axis=1, ddof=1) if n_days >= 2 else np.zeros(n_items)
        return np.maximum(np.ceil(mu * H + B0_Z * sigma * math.sqrt(H) - CEIL_EPS), 0.0)

    @staticmethod
    def _sales_matrix(db: Session, store_id: str, pos: Dict[str, int], n: int, lo: date, hi: date) -> np.ndarray:
        """Daily sales (n_items, days) of [lo, hi) from sales_history, restricted to the days on which the store has
        rows (a missing SKU row on such a day = 0 sold); days without any store row are dropped."""
        rows = db.execute(
            select(SalesHistory.item_id, SalesHistory.sale_date, SalesHistory.quantity).where(
                SalesHistory.store_id == store_id, SalesHistory.sale_date >= lo, SalesHistory.sale_date < hi)
        ).all()
        days = sorted({r[1] for r in rows})
        col = {d: j for j, d in enumerate(days)}
        M = np.zeros((n, len(days)))
        for iid, d, q in rows:
            k = pos.get(iid)
            if k is not None:
                M[k, col[d]] += float(q or 0.0)
        return M

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
                # the start date is a simulated day too (its sales/holding row), so it is cleared with the rest
                db.execute(delete(InventoryDaily).execution_options(synchronize_session=False).where(InventoryDaily.store_id == store_id, InventoryDaily.date >= start))
                db.execute(delete(SimShadowDaily).execution_options(synchronize_session=False).where(SimShadowDaily.store_id == store_id))
                db.execute(delete(ServiceOutcome).execution_options(synchronize_session=False).where(ServiceOutcome.store_id == store_id, ServiceOutcome.cycle_start >= start))
                db.execute(delete(CalibrationState).execution_options(synchronize_session=False).where(CalibrationState.store_id == store_id, CalibrationState.review_index >= 1))
                # Q-04: review_index 0 (neutral state or the labelled artifact warm start) is the BASELINE and stays.
                # Q-05: J5 selections made by this store's simulation (store-scoped ids) are dropped, so the
                # policy returns to the seeded selection: the J5 refits ``<store>_refit_<j>`` and the legacy
                # calendar-quarter ids ``<store>_quarter_*``. Nothing else (other stores, global ids) is touched.
                db.execute(delete(PolicySelection).execution_options(synchronize_session=False).where(
                    PolicySelection.selection_id.startswith(f"{store_id}_quarter_", autoescape=True)
                    | PolicySelection.selection_id.startswith(f"{store_id}_refit_", autoescape=True)))
                db.execute(
                    delete(ReplenishmentRecommendation).execution_options(synchronize_session=False).where(
                        ReplenishmentRecommendation.store_id == store_id,
                        (ReplenishmentRecommendation.decided_by == SIM_ACTOR)
                        | (ReplenishmentRecommendation.origin == SIM_ACTOR),
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
        # R5 FE review: (s, S, SS, ROP) of the LAST simulated review stayed in inventory_params, so the restored
        # day-0 stock was judged against them (stale CRITICAL alerts after a reset). Recompute them at the clock
        # origin (= start_date): same quantiles, baseline theta (review 0) and seeded policy selection as day 0.
        from app.services.optimization_service import optimization_service
        n_params = optimization_service.recompute_parameters(db, store_id=store_id)
        db.commit()
        return clock, {
            "snapshot_restored": restored,
            "inventory_source": "snapshot" if restored else "initial_levels_S_from_inventory_params",
            "n_skus": len(item_ids),
            "parameters_recomputed": n_params,
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
        approval_mode: str = APPROVAL_AUTO,
        expire_pending: bool = False,
        triggered_by: Optional[str] = None,
        run_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        from app.services.calibrator_service import calibrator_service
        from app.services.optimization_service import optimization_service
        from app.services.replenishment_service import replenishment_service
        from app.services.window_quantile_service import window_quantile_service

        if approval_mode not in APPROVAL_MODES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"approval_mode phải là một trong {list(APPROVAL_MODES)} (nhận '{approval_mode}').",
            )
        planner = approval_mode == APPROVAL_PLANNER
        t_start = time.time()
        ensure_tables(db)
        clock = self._lock_clock(db, store_id)
        if not clock:
            raise ValueError(f"Đồng hồ mô phỏng (SimClock) không tồn tại cho cửa hàng '{store_id}'")
        prev_date, t0 = clock.current_date, clock.start_date
        L, R = int(lead_time_days), int(review_period_days)
        clean_start = self._is_clean_start(db, store_id, prev_date, t0)

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

        # open proposals of a previous simulated review (left by a planner-mode stop) must be decided first, whatever
        # the mode of this advance: approved -> ordered, rejected / expired -> not ordered, never silently pending
        pending_expired = 0
        open_ids = [r[0] for r in db.execute(
            select(ReplenishmentRecommendation.id).where(
                ReplenishmentRecommendation.store_id == store_id,
                ReplenishmentRecommendation.origin == SIM_ACTOR,
                ReplenishmentRecommendation.status.in_(OPEN_STATUSES),
            )
        ).all()]
        if open_ids and not expire_pending:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Còn {len(open_ids)} đề xuất đặt hàng của kỳ review trước đang chờ duyệt. Duyệt / sửa / từ "
                    f"chối chúng trước khi tua tiếp, hoặc gửi expire_pending=true để bỏ qua (không đặt hàng)."
                ),
            )
        pending_expired = len(open_ids)

        # planner-in-the-loop: stop at the first review day of the span so the planner decides its proposals
        stopped_at_review = False
        if planner:
            next_review = self._first_review_day(prev_date, t0, R, clean_start)
            if next_review is not None and next_review <= target_date:
                target_date, stopped_at_review = next_review, True
        total_days = (target_date - prev_date).days
        if total_days > MAX_ADVANCE_DAYS:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Khoảng thời gian tua ({total_days} ngày) vượt quá giới hạn tối đa cho phép ({MAX_ADVANCE_DAYS} ngày).",
            )

        # demand must exist for every simulated day (never silently simulate zero demand); on the clean start the
        # start date itself is simulated as well
        first_day = prev_date if clean_start else prev_date + timedelta(days=1)
        if target_date < first_day:
            # only possible in planner mode: day 0 was already simulated and the clip found no later review
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ngày đích ({target_date}) phải lớn hơn ngày hiện tại ({prev_date}).",
            )
        have_days = {
            r[0] for r in db.execute(
                select(SalesHistory.sale_date).where(
                    SalesHistory.store_id == store_id,
                    SalesHistory.sale_date >= first_day, SalesHistory.sale_date <= target_date,
                ).distinct()
            ).all()
        }
        need_days = [first_day + timedelta(days=i) for i in range((target_date - first_day).days + 1)]
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

        run_id = run_id or str(uuid.uuid4())
        timer = _JobTimer()
        started_at = datetime.now(timezone.utc)
        params = {"prev_date": str(prev_date), "target_date": str(target_date), "approval_mode": approval_mode,
                  "expire_pending": bool(expire_pending), "L": L, "R": R}
        try:
            with atomic(db):
                if pending_expired:
                    db.execute(
                        update(ReplenishmentRecommendation).execution_options(synchronize_session=False)
                        .where(
                            ReplenishmentRecommendation.store_id == store_id,
                            ReplenishmentRecommendation.origin == SIM_ACTOR,
                            ReplenishmentRecommendation.status.in_(OPEN_STATUSES),
                        )
                        .values(
                            status="REJECTED", decided_by=SIM_ACTOR, decided_at=datetime.now(timezone.utc),
                            reason="Hết hạn: không được duyệt trước kỳ tua tiếp theo (không đặt hàng)",
                        )
                    )
                result = self._run(
                    db, clock, store_id, prev_date, target_date, t0, L, R,
                    calibrator_service, optimization_service, replenishment_service, window_quantile_service,
                    clean_start=clean_start, auto_order=not planner, timer=timer,
                )
                clock.current_date = target_date
                clock.updated_at = datetime.now(timezone.utc)
                self._write_batch_runs(db, run_id, store_id, target_date, started_at, timer, result, params,
                                       triggered_by)
                db.flush()
            db.commit()
        except Exception as exc:
            db.rollback()
            self._write_failed_run(db, run_id, store_id, target_date, started_at, params, triggered_by, exc)
            raise
        result["run_id"] = run_id
        result.update({
            "approval_mode": approval_mode,
            "stopped_at_review": stopped_at_review,
            "pending_expired": pending_expired,
        })
        result["duration_seconds"] = round(time.time() - t_start, 2)
        return result

    @staticmethod
    def _write_batch_runs(db: Session, run_id: str, store_id: str, target_date: date, started_at: datetime,
                          timer: "_JobTimer", result: Dict[str, Any], params: Dict[str, Any],
                          triggered_by: Optional[str]) -> None:
        """ADVANCE row + J1 (aggregated over the simulated days) + one row per review job, same transaction."""
        finished = datetime.now(timezone.utc)
        rows = [{
            "job": "ADVANCE", "sim_date": target_date, "started_at": started_at, "finished_at": finished,
            "duration_ms": round((finished - started_at).total_seconds() * 1000.0, 2),
            "n_items": getattr(timer, "n_items", None),
            "details": {**params, "days_simulated": result.get("days_simulated"),
                        "reviews_executed": result.get("reviews_executed"),
                        "orders": result.get("recommendations_generated"),
                        "orders_received": result.get("orders_received")},
        }, {
            "job": "J1", "sim_date": target_date, "started_at": started_at, "finished_at": finished,
            "duration_ms": round(timer.j1_ms, 2), "n_items": getattr(timer, "n_items", None),
            "details": {"days": timer.j1_days, "stockouts": result.get("stockouts_recorded"),
                        "orders_received": result.get("orders_received")},
        }] + timer.rows
        # an async job (batch_service) left an ADVANCE row 'running' under this run_id: replace it
        db.execute(delete(BatchRun).execution_options(synchronize_session=False)
                   .where(BatchRun.run_id == run_id, BatchRun.status.in_(("queued", "running"))))
        db.execute(BatchRun.__table__.insert(), [{
            "id": str(uuid.uuid4()), "run_id": run_id, "store_id": store_id, "status": "success",
            "triggered_by": triggered_by, "job": r["job"], "sim_date": r.get("sim_date"),
            "review_index": r.get("review_index"), "started_at": r["started_at"], "finished_at": r.get("finished_at"),
            "duration_ms": r.get("duration_ms"), "n_items": r.get("n_items"), "details": r.get("details"),
            "error": None,
        } for r in rows])

    @staticmethod
    def _write_failed_run(db: Session, run_id: str, store_id: str, target_date: date, started_at: datetime,
                          params: Dict[str, Any], triggered_by: Optional[str], exc: BaseException) -> None:
        """The advance was rolled back as a whole: record it alone as failed (never masks the original error)."""
        detail = getattr(exc, "detail", None) or str(exc) or exc.__class__.__name__
        finished = datetime.now(timezone.utc)
        try:
            db.execute(delete(BatchRun).execution_options(synchronize_session=False)
                       .where(BatchRun.run_id == run_id, BatchRun.status.in_(("queued", "running"))))
            db.execute(BatchRun.__table__.insert(), [{
                "id": str(uuid.uuid4()), "run_id": run_id, "store_id": store_id, "job": "ADVANCE",
                "sim_date": target_date, "status": "failed", "started_at": started_at, "finished_at": finished,
                "duration_ms": round((finished - started_at).total_seconds() * 1000.0, 2), "n_items": None,
                "triggered_by": triggered_by, "error": f"{exc.__class__.__name__}: {detail}"[:4000], "details": params,
                "review_index": None,
            }])
            db.commit()
        except Exception:  # noqa: BLE001 - logging the failure must not hide it
            db.rollback()

    @staticmethod
    def _is_clean_start(db: Session, store_id: str, prev_date: date, t0: date) -> bool:
        """Nothing simulated yet: the clock is at t0 AND day t0 has no ``inventory_daily`` row. The second test lets
        a planner-mode advance stop right after day 0 (clock still at t0, day 0 simulated) without the next advance
        re-running the day-0 review."""
        if prev_date != t0:
            return False
        done = db.execute(
            select(InventoryDaily.item_id).where(InventoryDaily.store_id == store_id, InventoryDaily.date == t0).limit(1)
        ).first()
        return done is None

    @staticmethod
    def _first_review_day(prev_date: date, t0: date, R: int, clean_start: bool) -> Optional[date]:
        """First day after the clock (t0 itself on a clean start) at which a review runs (t0 + k*R)."""
        if clean_start:
            return t0
        delta = (prev_date - t0).days + 1   # first day still to simulate
        k = -(-delta // R)                   # ceil
        return t0 + timedelta(days=max(k, 1) * R)

    # ------------------------------------------------------------------ core loop
    def _run(
        self, db, clock, store_id, prev_date, target_date, t0, L, R,
        calibrator_service, optimization_service, replenishment_service, window_quantile_service,
        clean_start: Optional[bool] = None, auto_order: bool = True, timer: Optional["_JobTimer"] = None,
    ) -> Dict[str, Any]:
        timer = timer if timer is not None else _JobTimer()
        if clean_start is None:
            clean_start = prev_date == t0
        item_ids = [r[0] for r in db.execute(select(Product.item_id).order_by(Product.item_id)).all()]
        n = len(item_ids)
        pos = {i: k for k, i in enumerate(item_ids)}
        on_hand, on_order, _created = self._inventory_arrays(db, store_id, item_ids)

        # snapshot of the initial state (only from a clean start, so reset can restore it)
        if clean_start:
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

        # ---- demand matrix for the days to simulate: (prev_date, target], plus t0 itself on the clean start
        first_day = prev_date if clean_start else prev_date + timedelta(days=1)
        days_list = [first_day + timedelta(days=i) for i in range((target_date - first_day).days + 1)]
        didx = {d: k for k, d in enumerate(days_list)}
        D = np.zeros((len(days_list), n))
        for iid, d, q in db.execute(
            select(SalesHistory.item_id, SalesHistory.sale_date, SalesHistory.quantity).where(
                SalesHistory.store_id == store_id, SalesHistory.sale_date >= first_day,
                SalesHistory.sale_date <= target_date)
        ).all():
            if iid in pos and d in didx:
                D[didx[d], pos[iid]] += float(q or 0.0)

        # the simulator moves units only; money (holding / lost at the price of each day, G-37 price_history with the
        # products.price fallback) is valued by the readers of inventory_daily and by J5 / the parameters

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
            # G-01: cycle j = days [t_j + L, t_j + L + R - 1]; at review k the latest COMPLETE one is j = k - d,
            # d = ceil((L + R) / R) (its end t_j + L + R - 1 <= t - 1), the cycle the C3-OUT step of review k reads.
            cycle_idx = review_k - math.ceil((L + R) / R)
            if cycle_idx >= 0:
                c_start = t0 + timedelta(days=cycle_idx * R + L)
                c_end = c_start + timedelta(days=R - 1)
                with timer.job("J6", t, review_k, n_items=n) as jr:
                    calibrator_service.record_cycle_outcome(
                        db=db, store_id=store_id, cycle_index=cycle_idx, cycle_start=c_start, cycle_end=c_end,
                    )
                    jr["details"] = {"cycle_index": cycle_idx, "cycle_start": str(c_start), "cycle_end": str(c_end)}
                job_events.append(
                    f"[{t}] Job J6: đóng chu kỳ {cycle_idx} ({c_start} -> {c_end}), lưu service_outcomes"
                )
            if refit:
                sid = f"{store_id}_refit_{(t - t0).days // REFIT_PERIOD_DAYS}"
                with timer.job("J5", t, review_k) as jr:
                    optimization_service.refit_quarterly_policies(db, store_id=store_id, selection_id=sid)
                    flush_state()
                    jr["details"] = {"selection_id": sid}
                job_events.append(f"[{t}] Job J5: tái chọn (m_g, kappa_g) cho {sid}")
            # --- J2: the forecast published for this review (precomputed in the replay; research_v2 H7)
            with timer.job("J2", t, review_k) as jr:
                cov = window_quantile_service.forecast_coverage(db, store_id, t, n, horizon_days=L + R)
                jr["n_items"] = cov["items_published"]
                jr["details"] = cov
            # --- J3: window quantiles, ONE bulk call
            with timer.job("J3", t, review_k, n_items=n):
                window_quantile_service.get_or_create_window_quantiles_bulk(
                    db, store_id, item_ids, t, horizon_days=L + R
                )
            # --- J4: C3-OUT step (not at k = 0), parameters, orders (auto-ordered or left to the planner)
            with timer.job("J4", t, review_k) as jr:
                if review_k >= 1:
                    calibrator_service.run_calibration_step(
                        db=db, store_id=store_id, review_index=review_k, review_date=t,
                        lead_time_days=L, review_period_days=R,
                    )
                optimization_service.recompute_parameters(db, store_id=store_id)
                db.flush()
                db.expire_all()
                recs_count = replenishment_service.generate_recommendations(
                    db, store_id=store_id, review_date=t, auto_order=auto_order, origin=SIM_ACTOR
                )
                recommendations_generated += recs_count
                db.flush()
                db.expire_all()
                jr["n_items"] = int(recs_count)
                jr["details"] = {"orders": int(recs_count), "approval": "auto" if auto_order else "planner",
                                 "c3_step": review_k >= 1}
            on_hand, on_order, _ = self._inventory_arrays(db, store_id, item_ids)

            # shadow B0-MA-OUT-0.95 review (G-41): S from the 56 days of sales before t; IP = on-hand (today's
            # arrivals already received) + B0 orders still in transit; order S - IP when IP < S (strict)
            hist = self._sales_matrix(db, store_id, pos, n, t - timedelta(days=B0_MA_WINDOW_DAYS), t)
            S0 = self.b0_ma_out_order_up_to(hist, L, R)
            sh_ip = sh_on_hand + sum((q for _, q in sh_pipeline), np.zeros(n))
            order_today = np.where(sh_ip < S0, np.maximum(S0 - sh_ip, 0.0), 0.0)
            if (order_today > 0).any():
                sh_pipeline.append((t + timedelta(days=L), order_today.copy()))
            job_events.append(
                f"[{t}] Job J3 & J4: review k={review_k} (đầu ngày), C³-OUT, cập nhật (s, S), {recs_count} đơn đặt "
                f"(về sau {L} ngày); B0 shadow đặt {(order_today > 0).sum()} đơn"
            )
            return order_today

        for t in days_list:
            delta_days = (t - t0).days
            ti = didx[t]
            arrive_dt = datetime.combine(t, datetime.min.time(), tzinfo=timezone.utc)

            # --- 1. arrivals (main): APPROVED only, each order is received exactly once -> COMPLETED
            j1_t = time.perf_counter()
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
            timer.j1_ms += (time.perf_counter() - j1_t) * 1000.0

            is_day0 = clean_start and t == t0
            is_review = delta_days > 0 and delta_days % R == 0
            is_refit = is_refit_day(delta_days)
            sh_order_today = np.zeros(n)

            if is_day0 or is_review or is_refit:
                clock.current_date = t   # services use the clock as the origin of every quantile / theta lookup
                flush_state()

            if is_day0:
                # Q-03 / A4: review k = 0 at the START of day 0 from the initial stock, once per clean start (clock
                # at t0; reset puts it back there and clears the simulated orders); day 0's sales follow below
                sh_order_today = review_block(t0, 0)
            elif is_review:
                review_k = delta_days // R
                sh_order_today = review_block(t, review_k, refit=is_refit)
            elif is_refit:
                sid = f"{store_id}_refit_{delta_days // REFIT_PERIOD_DAYS}"
                with timer.job("J5", t, None) as jr:
                    optimization_service.refit_quarterly_policies(db, store_id=store_id, selection_id=sid)
                    flush_state()
                    jr["details"] = {"selection_id": sid}
                job_events.append(f"[{t}] Job J5: tái chọn (m_g, kappa_g) cho {sid}")

            # --- 5. J1: sales of day t (vectorised) - main policy
            j1_t = time.perf_counter()
            timer.j1_days += 1
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
            timer.j1_ms += (time.perf_counter() - j1_t) * 1000.0

        clock.current_date = target_date
        j1_t = time.perf_counter()
        flush_state()   # writes the remaining inventory_daily / shadow rows (J1 persistence)
        timer.j1_ms += (time.perf_counter() - j1_t) * 1000.0
        timer.n_items = n
        total_days = (target_date - prev_date).days
        return {
            "success": True,
            "store_id": store_id,
            "previous_date": prev_date,
            "current_date": target_date,
            "days_advanced": total_days,
            "reviews_executed": reviews_executed,
            "day0_review_executed": clean_start,
            "days_simulated": len(days_list),
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
