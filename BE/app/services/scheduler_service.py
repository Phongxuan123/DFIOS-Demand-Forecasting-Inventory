"""
Lightweight in-process scheduler for the saved ML/pipeline schedules (UC49, R-19).

* One asyncio task started in the FastAPI lifespan; every ``TICK_SECONDS`` it loads the persisted schedules
  (``system_settings.batch_pipeline_schedules``) and runs every active one whose 5-field cron expression matches
  the current UTC minute (at most once per minute) through ``pipeline_service.trigger_pipeline_run``.
* Disabled with ``DFIOS_SCHEDULER=0`` and automatically under pytest. When disabled the schedules are only
  stored and ``mode`` of every schedule is reported as ``"manual"`` (honest, nothing executes them).
* Multi-worker safe on PostgreSQL: a ``pg_try_advisory_lock`` held for the tick lets only one worker run the
  due schedules (Q-09); SQLite is single-process.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger("dfios.scheduler")

TICK_SECONDS = 20
_state = {"running": False}


def scheduler_running() -> bool:
    """True only while the asyncio loop of this process is really alive (drives the honest `mode` field)."""
    return _state["running"]


def scheduler_enabled() -> bool:
    if os.getenv("DFIOS_SCHEDULER", "1").strip() == "0":
        return False
    return "pytest" not in sys.modules and "PYTEST_CURRENT_TEST" not in os.environ


def _field_matches(field: str, value: int, lo: int, hi: int) -> bool:
    for part in field.split(","):
        step = 1
        if "/" in part:
            part, step_s = part.split("/", 1)
            step = max(1, int(step_s))
        if part == "*":
            a, b = lo, hi
        elif "-" in part:
            a_s, b_s = part.split("-", 1)
            a, b = int(a_s), int(b_s)
        else:
            a = b = int(part)
            if step > 1:
                b = hi
        if a <= value <= b and (value - a) % step == 0:
            return True
    return False


def cron_matches(expr: str, when: datetime) -> bool:
    """Standard 5-field cron (minute hour day-of-month month day-of-week; 0 and 7 = Sunday)."""
    try:
        m, h, dom, mon, dow = expr.split()
        cron_dow = (when.weekday() + 1) % 7  # Python Monday=0 -> cron Sunday=0
        dow_ok = _field_matches(dow, cron_dow, 0, 7) or (cron_dow == 0 and _field_matches(dow, 7, 0, 7))
        return (
            _field_matches(m, when.minute, 0, 59) and _field_matches(h, when.hour, 0, 23)
            and _field_matches(dom, when.day, 1, 31) and _field_matches(mon, when.month, 1, 12) and dow_ok
        )
    except (ValueError, TypeError):
        return False


def next_run(expr: str, after: Optional[datetime] = None) -> Optional[datetime]:
    """Next UTC minute (within 366 days) matching the cron expression, else None.
    Day-by-day search over the date fields, then only the matching hour/minute pairs (Q-09: no 527 k-step loop)."""
    try:
        m_f, h_f, dom_f, mon_f, dow_f = expr.split()
        start = (after or datetime.now(timezone.utc)).replace(second=0, microsecond=0) + timedelta(minutes=1)
        hours = [h for h in range(24) if _field_matches(h_f, h, 0, 23)]
        minutes = [m for m in range(60) if _field_matches(m_f, m, 0, 59)]
        for d in range(367):
            day = start + timedelta(days=d)
            cron_dow = (day.weekday() + 1) % 7
            dow_ok = _field_matches(dow_f, cron_dow, 0, 7) or (cron_dow == 0 and _field_matches(dow_f, 7, 0, 7))
            if not (_field_matches(mon_f, day.month, 1, 12) and _field_matches(dom_f, day.day, 1, 31) and dow_ok):
                continue
            for h in hours:
                for m in minutes:
                    cand = day.replace(hour=h, minute=m)
                    if cand >= start:
                        return cand
    except (ValueError, TypeError):
        return None
    return None


def run_due_schedules(db, now: Optional[datetime] = None) -> int:
    """Run every active schedule due at ``now`` (UTC minute). Returns the number of runs started. Sync."""
    from app.schemas.pipeline import PipelineRunRequest
    from app.services.pipeline_service import pipeline_service

    now = (now or datetime.now(timezone.utc)).replace(second=0, microsecond=0)
    schedules = pipeline_service._get_schedules_dict(db)
    started = 0
    for sid, sched in list(schedules.items()):
        if not sched.get("is_active", True) or not cron_matches(sched.get("cron_expression", ""), now):
            continue
        last = sched.get("last_run_at")
        if last and datetime.fromisoformat(last).replace(second=0, microsecond=0) >= now:
            continue  # already ran in this minute
        try:
            pipeline_service.trigger_pipeline_run(
                db,
                PipelineRunRequest(
                    model_name=sched.get("model_name") or "lightgbm",
                    horizon=int(sched.get("horizon") or 28),
                    store_id=sched.get("store_id") or "CA_1",
                ),
                admin_email="scheduler@dfios.local",
            )
            sched["last_run_status"] = "COMPLETED"
        except Exception as exc:  # noqa: BLE001 - a failing job must not kill the scheduler loop
            db.rollback()
            logger.exception("scheduled run %s failed", sid)
            sched["last_run_status"] = f"FAILED: {type(exc).__name__}"
        sched["last_run_at"] = now.isoformat()
        nxt = next_run(sched["cron_expression"], now)
        sched["next_run_at"] = nxt.isoformat() if nxt else None
        started += 1
    if started:
        pipeline_service._save_schedules_dict(schedules, db=db)
    return started


SCHEDULER_LOCK_KEY = 727_001  # arbitrary application-wide advisory lock id


def _tick() -> int:
    """One scheduler tick. On PostgreSQL a session advisory lock (held on a dedicated connection for the whole
    tick) guarantees that with several uvicorn workers only ONE of them runs the due schedules (Q-09);
    the others skip the tick. SQLite (dev/tests) has a single process by construction."""
    from sqlalchemy import text

    from app.core.database import SessionLocal, engine

    if engine.dialect.name != "postgresql":
        with SessionLocal() as db:
            return run_due_schedules(db)
    with engine.connect() as lock_conn:
        got = lock_conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": SCHEDULER_LOCK_KEY}).scalar()
        if not got:
            return 0
        try:
            with SessionLocal() as db:
                return run_due_schedules(db)
        finally:
            lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": SCHEDULER_LOCK_KEY})
            lock_conn.commit()


async def scheduler_loop() -> None:
    logger.warning("DFIOS in-process scheduler started (tick %ss, UTC cron)", TICK_SECONDS)
    _state["running"] = True
    try:
        while True:
            try:
                await asyncio.to_thread(_tick)
            except Exception:  # noqa: BLE001 - a failing tick must not kill the loop
                logger.exception("scheduler tick failed")
            await asyncio.sleep(TICK_SECONDS)
    finally:
        _state["running"] = False
