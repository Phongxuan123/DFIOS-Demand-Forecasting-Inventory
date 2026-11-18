"""
Model switch of the window-quantile source (demo.md §7 step 10: "Admin kích hoạt chronos-bolt thay cho Ensemble",
teacher E9c model-degradation scenario).

The engine reads one series of window quantiles (``forecast_window_quantile``, default model run, horizon L + R).
Activating model M for a store copies M's rows from ``window_quantile_source`` into that series for every review
origin the simulation has NOT reached yet (origin > clock date; origin = clock date too on a clean start, whose
day-0 review has not run). Origins already reviewed keep their rows, so no decision taken before the switch changes
(causality). The engine itself is unchanged: like the teacher's E9c run it does not know that the model changed;
C3-OUT reacts through the observed stock-outs and J5 re-tunes at its next 91-day refit.

Each copied row carries ``source_model = M``; ``window_model_activation`` logs the switch. A rollback is the
activation of the previous model. ``/clock/reset`` does not undo an activation (it is a configuration decision, not
simulated state); restore a demo snapshot for that.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.forecast_window_quantile import ForecastWindowQuantile
from app.models.sim_clock import SimClock
from app.models.window_quantile_source import WindowModelActivation, WindowQuantileSource
from app.services import policy_config as pc

H_DEFAULT = pc.HORIZON_DAYS
_CHUNK = 20_000


def _engine_run_id() -> str:
    from app.services.window_quantile_service import DEFAULT_MODEL_RUN_ID

    return DEFAULT_MODEL_RUN_ID


class ForecastSourceService:
    @staticmethod
    def ensure_tables(db: Session) -> None:
        bind = db.get_bind()
        WindowQuantileSource.__table__.create(bind=bind, checkfirst=True)
        WindowModelActivation.__table__.create(bind=bind, checkfirst=True)

    # ------------------------------------------------------------------ read
    def overview(self, db: Session, store_id: str, horizon_days: int = H_DEFAULT) -> Dict[str, Any]:
        """Models available as sources, the model currently serving the next review, and the activation log."""
        self.ensure_tables(db)
        clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
        models = [
            {"model": m, "n_origins": int(n), "first_origin": a, "last_origin": b}
            for m, n, a, b in db.execute(
                select(WindowQuantileSource.model, func.count(func.distinct(WindowQuantileSource.origin_date)),
                       func.min(WindowQuantileSource.origin_date), func.max(WindowQuantileSource.origin_date))
                .where(WindowQuantileSource.store_id == store_id, WindowQuantileSource.horizon_days == horizon_days)
                .group_by(WindowQuantileSource.model).order_by(WindowQuantileSource.model)
            ).all()
        ]
        log = [
            {"model": a.model, "previous_model": a.previous_model, "from_date": a.from_date, "n_origins": a.n_origins,
             "n_rows": a.n_rows, "activated_by": a.activated_by, "activated_at": a.activated_at}
            for a in db.query(WindowModelActivation).filter(WindowModelActivation.store_id == store_id)
            .order_by(WindowModelActivation.activated_at.desc()).limit(50)
        ]
        return {
            "store_id": store_id, "horizon_days": horizon_days,
            "clock_date": clock.current_date if clock else None,
            "active_model": self.model_at_next_review(db, store_id, horizon_days),
            "available_models": models, "activations": log,
        }

    def model_at_next_review(self, db: Session, store_id: str, horizon_days: int = H_DEFAULT) -> Optional[str]:
        """``source_model`` of the engine rows at the first origin the simulation has not reviewed yet."""
        first = self._first_open_origin(db, store_id)
        if first is None:
            return None
        base = (ForecastWindowQuantile.store_id == store_id,
                ForecastWindowQuantile.model_run_id == _engine_run_id(),
                ForecastWindowQuantile.horizon_days == horizon_days)
        next_origin = db.execute(
            select(func.min(ForecastWindowQuantile.origin_date)).where(*base, ForecastWindowQuantile.origin_date >= first)
        ).scalar()
        if next_origin is None:
            return None
        row = db.execute(
            select(ForecastWindowQuantile.source_model, func.count())
            .where(*base, ForecastWindowQuantile.origin_date == next_origin)
            .group_by(ForecastWindowQuantile.source_model).order_by(func.count().desc())
        ).first()
        return row[0] if row else None

    @staticmethod
    def _first_open_origin(db: Session, store_id: str) -> Optional[date]:
        """First day whose review has not run: the clock date on a clean start, else the next day."""
        from datetime import timedelta

        from app.services.simulator_service import simulator_service

        clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
        if clock is None:
            return None
        if simulator_service._is_clean_start(db, store_id, clock.current_date, clock.start_date):
            return clock.current_date
        return clock.current_date + timedelta(days=1)

    # ------------------------------------------------------------------ activate
    def activate(self, db: Session, store_id: str, model: str, actor: Optional[str] = None,
                 horizon_days: int = H_DEFAULT) -> Dict[str, Any]:
        self.ensure_tables(db)
        clock = (db.query(SimClock).filter(SimClock.store_id == store_id).with_for_update().first())
        if clock is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail=f"Đồng hồ mô phỏng (SimClock) không tồn tại cho cửa hàng '{store_id}'")
        first = self._first_open_origin(db, store_id)
        origins: List[date] = [r[0] for r in db.execute(
            select(WindowQuantileSource.origin_date).where(
                WindowQuantileSource.store_id == store_id, WindowQuantileSource.model == model,
                WindowQuantileSource.horizon_days == horizon_days, WindowQuantileSource.origin_date >= first)
            .distinct().order_by(WindowQuantileSource.origin_date)).all()]
        if not origins:
            have = db.execute(select(func.count()).select_from(WindowQuantileSource).where(
                WindowQuantileSource.store_id == store_id, WindowQuantileSource.model == model)).scalar()
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(f"Mô hình '{model}' không có quantile cửa sổ cho cửa hàng '{store_id}'"
                        + (f" từ ngày {first} trở đi." if have else
                           ". Nạp nguồn trước: scripts/load_teacher_data.py --steps sources --source-models ...")),
            )
        previous = self.model_at_next_review(db, store_id, horizon_days)
        run_id = _engine_run_id()
        now = datetime.now(timezone.utc)
        n_rows = 0
        for k in range(0, len(origins), 10):
            chunk = origins[k:k + 10]
            db.execute(delete(ForecastWindowQuantile).execution_options(synchronize_session=False).where(
                ForecastWindowQuantile.store_id == store_id, ForecastWindowQuantile.model_run_id == run_id,
                ForecastWindowQuantile.horizon_days == horizon_days, ForecastWindowQuantile.origin_date.in_(chunk)))
            src = db.execute(select(WindowQuantileSource.item_id, WindowQuantileSource.origin_date,
                                    WindowQuantileSource.point_window, WindowQuantileSource.q_levels)
                             .where(WindowQuantileSource.store_id == store_id, WindowQuantileSource.model == model,
                                    WindowQuantileSource.horizon_days == horizon_days,
                                    WindowQuantileSource.origin_date.in_(chunk))).all()
            rows = [{
                "id": f"{run_id}_{store_id}_{iid}_{od}_{horizon_days}", "model_run_id": run_id, "store_id": store_id,
                "item_id": iid, "origin_date": od, "horizon_days": horizon_days, "point_window": pw,
                "q_levels": ql, "route": pc.ROUTE_TEACHER, "source_model": model, "created_at": now,
            } for iid, od, pw, ql in src]
            for j in range(0, len(rows), _CHUNK):
                db.execute(ForecastWindowQuantile.__table__.insert(), rows[j:j + _CHUNK])
            n_rows += len(rows)
        act = WindowModelActivation(store_id=store_id, model=model, previous_model=previous, from_date=origins[0],
                                    n_origins=len(origins), n_rows=n_rows, activated_by=actor, activated_at=now)
        db.add(act)
        from app.services.audit_service import audit_service

        audit_service.log(db, action="forecast_source.activate", actor_email=actor,
                          details=f"Kích hoạt mô hình '{model}' (trước: {previous}) cho {store_id} từ kỳ review "
                                  f"{origins[0]}: {len(origins)} kỳ, {n_rows} dòng quantile")
        db.commit()
        return {"store_id": store_id, "model": model, "previous_model": previous, "from_date": origins[0],
                "to_date": origins[-1], "n_origins": len(origins), "n_rows": n_rows, "clock_date": clock.current_date,
                "activation_id": act.id}


forecast_source_service = ForecastSourceService()
