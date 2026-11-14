"""
Lightweight in-process scheduler for the saved ML/pipeline schedules (UC49, R-19).

* One asyncio task started in the FastAPI lifespan; every ``TICK_SECONDS`` it loads the persisted schedules
  (``system_settings.batch_pipeline_schedules``) and runs every active one whose 5-field cron expression matches
  the current UTC minute (at most once per minute) through ``pipeline_service.trigger_pipeline_run``.
* Disabled with ``DFIOS_SCHEDULER=0`` and automatically under pytest. When disabled the schedules are only
  stored and ``mode`` of every schedule is reported as ``"manual"`` (honest, nothing executes them).
* Single-process only: with several uvicorn workers every worker would run the job (use ``DFIOS_SCHEDULER=0``
  on all but one).
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
    """Next UTC minute (within 366 days) matching the cron expression, else None."""
    t = (after or datetime.now(timezone.utc)).replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(366 * 24 * 60):
        if cron_matches(expr, t):
            return t
        t += timedelta(minutes=1)
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


def _tick() -> None:
    from app.core.database import SessionLocal

    with SessionLocal() as db:
        run_due_schedules(db)


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
