"""
Batch jobs run off the request thread (demo.md §5 "trả job id", §6 step 7; research.md §10.1 offline/online split).

``submit_advance`` records a ``batch_runs`` row (job ADVANCE, status ``running``) under a fresh ``run_id``, returns the
id at once (HTTP 202) and runs the clock advance on a single background worker thread with its OWN database session.
When the advance finishes the simulator replaces the ``running`` row by the real rows (ADVANCE + J1/J3-J6, status
``success``) in the same transaction as the simulation, or by one ``failed`` ADVANCE row with the error. The client
polls ``GET /batch-runs/{run_id}``.

Executors (env ``DFIOS_BATCH_EXECUTOR``):
  thread (default, local dev)  the API process runs the job on ONE background thread. Advances of a store are
                               serialised anyway by the clock row lock (SELECT ... FOR UPDATE).
  queue  (docker compose)      the API only records the job as ``queued``; the ``worker`` container
                               (``python -m app.worker``) claims it (FOR UPDATE SKIP LOCKED on PostgreSQL) and runs it,
                               so heavy batch work never runs in the API process (demo.md §3 container ``worker``).
The job's arguments are stored in ``details.kwargs`` so either executor runs it from the row alone.
``recover_orphans`` marks rows left ``running`` by a dead process as ``failed`` so they never look alive forever.
"""
from __future__ import annotations

import logging
import os
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Any, Callable, Dict, Optional

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models.batch_run import BatchRun

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = ("queued", "running")
EXECUTOR_THREAD = "thread"
EXECUTOR_QUEUE = "queue"
JOBS = ("ADVANCE", "J5")


def executor_mode() -> str:
    mode = (os.getenv("DFIOS_BATCH_EXECUTOR") or EXECUTOR_THREAD).strip().lower()
    return mode if mode in (EXECUTOR_THREAD, EXECUTOR_QUEUE) else EXECUTOR_THREAD


def _encode(kwargs: Dict[str, Any]) -> Dict[str, Any]:
    return {k: (v.isoformat() if isinstance(v, date) else v) for k, v in kwargs.items()}


def _decode(job: str, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(kwargs or {})
    if job == "ADVANCE" and out.get("until"):
        out["until"] = date.fromisoformat(str(out["until"]))
    return out


class BatchService:
    def __init__(self) -> None:
        self._executor: Optional[ThreadPoolExecutor] = None
        # overridable in tests (an in-memory SQLite session factory)
        self.session_factory: Optional[Callable[[], Session]] = None

    # ------------------------------------------------------------------ infrastructure
    def _get_executor(self) -> ThreadPoolExecutor:
        if self._executor is None:
            self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dfios-batch")
        return self._executor

    def _new_session(self) -> Session:
        if self.session_factory is not None:
            return self.session_factory()
        from app.core.database import SessionLocal

        return SessionLocal()

    @staticmethod
    def ensure_table(db: Session) -> None:
        BatchRun.__table__.create(bind=db.get_bind(), checkfirst=True)

    # ------------------------------------------------------------------ submit / execute
    def _submit(self, db: Session, job: str, store_id: str, triggered_by: Optional[str],
                kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Record the job row (committed, visible at once) and hand it to the executor. Returns the job handle."""
        self.ensure_table(db)
        mode = executor_mode()
        run_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        status = "queued" if mode == EXECUTOR_QUEUE else "running"
        db.add(BatchRun(id=str(uuid.uuid4()), run_id=run_id, job=job, store_id=store_id, status=status,
                        started_at=now, triggered_by=triggered_by, details={"kwargs": _encode(kwargs)}))
        db.commit()
        if mode == EXECUTOR_THREAD:
            self._get_executor().submit(self.execute, run_id)
        return {"run_id": run_id, "job": job, "status": status, "store_id": store_id, "started_at": now,
                "poll_url": f"/api/v1/batch-runs/{run_id}"}

    def submit_advance(self, db: Session, *, store_id: str, triggered_by: Optional[str], **advance_kwargs: Any
                       ) -> Dict[str, Any]:
        return self._submit(db, "ADVANCE", store_id, triggered_by, advance_kwargs)

    def submit_refit(self, db: Session, *, store_id: str, triggered_by: Optional[str], **refit_kwargs: Any
                     ) -> Dict[str, Any]:
        return self._submit(db, "J5", store_id, triggered_by, refit_kwargs)

    def execute(self, run_id: str) -> None:
        """Run the job recorded under ``run_id`` in a fresh session (worker thread or worker container)."""
        db = self._new_session()
        try:
            row = db.execute(select(BatchRun).where(BatchRun.run_id == run_id,
                                                    BatchRun.status.in_(ACTIVE_STATUSES))).scalars().first()
            if row is None:
                return
            job, store_id, triggered_by = row.job, row.store_id, row.triggered_by
            kwargs = _decode(job, (row.details or {}).get("kwargs") or {})
            if row.status != "running":
                row.status = "running"
                db.commit()
            try:
                if job == "ADVANCE":
                    from app.services.pipeline_service import pipeline_service

                    pipeline_service.advance_sim_clock(db=db, store_id=store_id, triggered_by=triggered_by,
                                                       run_id=run_id, **kwargs)
                elif job == "J5":
                    self.run_refit(db, store_id=store_id, triggered_by=triggered_by, run_id=run_id, **kwargs)
                else:
                    raise ValueError(f"unknown batch job {job!r}")
            except Exception as exc:  # noqa: BLE001 - the job already wrote its failed row; make sure no active row is left
                logger.warning("batch %s %s failed: %s", job, run_id, getattr(exc, "detail", exc))
                self._close_dangling(db, run_id, exc)
        finally:
            db.close()

    def claim_next(self, db: Session) -> Optional[str]:
        """Worker container: take the oldest queued job (SKIP LOCKED on PostgreSQL), mark it running, return its id."""
        self.ensure_table(db)
        q = select(BatchRun).where(BatchRun.status == "queued").order_by(BatchRun.started_at).limit(1)
        if db.get_bind().dialect.name == "postgresql":
            q = q.with_for_update(skip_locked=True)
        row = db.execute(q).scalars().first()
        if row is None:
            db.rollback()
            return None
        row.status = "running"
        run_id = row.run_id
        db.commit()
        return run_id

    def _close_dangling(self, db: Session, run_id: str, exc: BaseException) -> None:
        try:
            db.rollback()
            left = db.execute(select(BatchRun.id).where(BatchRun.run_id == run_id,
                                                        BatchRun.status.in_(ACTIVE_STATUSES))).first()
            has_final = db.execute(select(BatchRun.id).where(BatchRun.run_id == run_id,
                                                             BatchRun.status.in_(("success", "failed")))).first()
            if left and has_final:
                db.execute(delete(BatchRun).where(BatchRun.run_id == run_id, BatchRun.status.in_(ACTIVE_STATUSES)))
            elif left:  # failed before the simulator could record anything (e.g. validation error)
                detail = getattr(exc, "detail", None) or str(exc) or exc.__class__.__name__
                db.execute(update(BatchRun).where(BatchRun.run_id == run_id, BatchRun.status.in_(ACTIVE_STATUSES))
                           .values(status="failed", finished_at=datetime.now(timezone.utc),
                                   error=f"{exc.__class__.__name__}: {detail}"[:4000]))
            db.commit()
        except Exception:  # noqa: BLE001  # pragma: no cover
            db.rollback()

    # ------------------------------------------------------------------ J5 on demand
    def run_refit(self, db: Session, *, store_id: str, triggered_by: Optional[str], run_id: Optional[str] = None,
                  **refit_kwargs: Any) -> Dict[str, Any]:
        """J5 (``optimization_service.refit_quarterly_policies``) recorded as one ``batch_runs`` row (job J5).
        Runs in the caller's session; used both synchronously and by the worker thread."""
        from app.services.optimization_service import optimization_service

        self.ensure_table(db)
        run_id = run_id or str(uuid.uuid4())
        started = datetime.now(timezone.utc)
        try:
            results = optimization_service.refit_quarterly_policies(db=db, store_id=store_id, **refit_kwargs)
        except Exception as exc:
            db.rollback()
            self._finish(db, run_id, "J5", store_id, started, triggered_by, "failed", error=exc,
                         details={k: (str(v) if v is not None else None) for k, v in refit_kwargs.items()})
            raise
        sid = results[0]["selection_id"] if results else None
        self._finish(db, run_id, "J5", store_id, started, triggered_by, "success", n_items=len(results),
                     details={**{k: (str(v) if v is not None else None) for k, v in refit_kwargs.items()},
                              "selection_id": sid})  # the selection actually saved (the request may pass None)
        return {"run_id": run_id, "selection_id": sid, "results": results}

    def _finish(self, db: Session, run_id: str, job: str, store_id: str, started: datetime,
                triggered_by: Optional[str], status: str, n_items: Optional[int] = None,
                details: Optional[Dict[str, Any]] = None, error: Optional[BaseException] = None) -> None:
        finished = datetime.now(timezone.utc)
        err = None
        if error is not None:
            detail = getattr(error, "detail", None) or str(error) or error.__class__.__name__
            err = f"{error.__class__.__name__}: {detail}"[:4000]
        try:
            db.execute(delete(BatchRun).where(BatchRun.run_id == run_id, BatchRun.status.in_(ACTIVE_STATUSES)))
            db.add(BatchRun(id=str(uuid.uuid4()), run_id=run_id, job=job, store_id=store_id, status=status,
                            started_at=started, finished_at=finished,
                            duration_ms=round((finished - started).total_seconds() * 1000.0, 2), n_items=n_items,
                            triggered_by=triggered_by, error=err, details=details))
            db.commit()
        except Exception:  # noqa: BLE001 - recording must not hide the job's own outcome
            db.rollback()

    def wait_idle(self, timeout: float = 30.0) -> None:
        """Tests: block until every queued job has run."""
        if self._executor is not None:
            fut: Future = self._executor.submit(lambda: None)
            fut.result(timeout=timeout)

    # ------------------------------------------------------------------ startup
    def recover_orphans(self, db: Session) -> int:
        """Rows still 'running' at process start belong to a dead process: mark them failed."""
        self.ensure_table(db)
        n = db.execute(
            update(BatchRun).where(BatchRun.status == "running")  # queued jobs stay for the worker
            .values(status="failed", finished_at=datetime.now(timezone.utc),
                    error="Tiến trình API khởi động lại khi job đang chạy (job bị hủy).")
        ).rowcount
        db.commit()
        return int(n or 0)

    # ------------------------------------------------------------------ read
    @staticmethod
    def _as_dict(r: BatchRun) -> Dict[str, Any]:
        return {
            "id": r.id, "run_id": r.run_id, "job": r.job, "store_id": r.store_id, "sim_date": r.sim_date,
            "review_index": r.review_index, "status": r.status, "started_at": r.started_at,
            "finished_at": r.finished_at, "duration_ms": r.duration_ms, "n_items": r.n_items,
            "triggered_by": r.triggered_by, "error": r.error, "details": r.details,
        }

    def get_run(self, db: Session, run_id: str) -> Optional[Dict[str, Any]]:
        self.ensure_table(db)
        rows = db.execute(select(BatchRun).where(BatchRun.run_id == run_id)
                          .order_by(BatchRun.started_at, BatchRun.job)).scalars().all()
        if not rows:
            return None
        head = next((r for r in rows if r.job == "ADVANCE"), rows[0])
        jobs = [self._as_dict(r) for r in rows if r is not head]
        totals: Dict[str, Dict[str, float]] = {}
        for j in jobs:
            t = totals.setdefault(j["job"], {"count": 0, "duration_ms": 0.0})
            t["count"] += 1
            t["duration_ms"] = round(t["duration_ms"] + float(j["duration_ms"] or 0.0), 2)
        return {**self._as_dict(head), "jobs": jobs, "totals_by_job": totals}

    def list_runs(self, db: Session, store_id: Optional[str] = None, job: Optional[str] = None,
                  status: Optional[str] = None, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        self.ensure_table(db)
        q = select(BatchRun)
        if store_id:
            q = q.where(BatchRun.store_id == store_id)
        if job:
            q = q.where(BatchRun.job == job)
        if status:
            q = q.where(BatchRun.status == status)
        from sqlalchemy import func

        total = db.execute(select(func.count()).select_from(q.subquery())).scalar() or 0
        rows = db.execute(q.order_by(BatchRun.started_at.desc(), BatchRun.job).limit(limit).offset(offset)
                          ).scalars().all()
        return {"total": int(total), "limit": limit, "offset": offset, "items": [self._as_dict(r) for r in rows]}


batch_service = BatchService()
