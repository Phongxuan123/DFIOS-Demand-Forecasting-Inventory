"""
DFIOS worker process (demo.md §3 container ``worker``; research.md §10 offline/online split).

    python -m app.worker

* runs the queued batch jobs recorded by the API (``batch_runs`` status ``queued``: clock advances J1-J6 and J5
  refits) one at a time, claimed with FOR UPDATE SKIP LOCKED so several workers never run the same job;
* runs the saved cron schedules (``scheduler_service``) unless ``DFIOS_SCHEDULER=0``.

The API container runs with ``DFIOS_BATCH_EXECUTOR=queue`` and ``DFIOS_SCHEDULER=0`` so that every heavy batch job
runs here and never in a request. Local development keeps the default ``thread`` executor and needs no worker.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal

logger = logging.getLogger("dfios.worker")

POLL_SECONDS = float(os.getenv("DFIOS_WORKER_POLL_SECONDS", "1.0"))


def run_one() -> bool:
    """Claim and run at most one queued job. True when a job was run."""
    from app.core.database import SessionLocal
    from app.services.batch_service import batch_service

    with SessionLocal() as db:
        run_id = batch_service.claim_next(db)
    if run_id is None:
        return False
    logger.warning("running batch job %s", run_id)
    batch_service.execute(run_id)
    return True


async def job_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            ran = await asyncio.to_thread(run_one)
        except Exception:  # noqa: BLE001 - a failing job must not kill the worker
            logger.exception("batch job loop error")
            ran = False
        if not ran:
            try:
                await asyncio.wait_for(stop.wait(), timeout=POLL_SECONDS)
            except asyncio.TimeoutError:
                pass


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    from app.core.database import SessionLocal, engine
    from app.core.schema_upgrades import apply_schema_upgrades
    from app.services.batch_service import batch_service
    from app.services.scheduler_service import scheduler_enabled, scheduler_loop

    apply_schema_upgrades(engine)
    with SessionLocal() as db:
        n = batch_service.recover_orphans(db)  # jobs a previous worker left 'running' can never finish
        if n:
            logger.warning("marked %d orphan running job(s) as failed", n)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):  # Windows: Ctrl+C raises KeyboardInterrupt instead
            pass

    tasks = [asyncio.create_task(job_loop(stop))]
    if scheduler_enabled():
        tasks.append(asyncio.create_task(scheduler_loop()))
    logger.warning("DFIOS worker started (job poll %.1fs, scheduler %s)", POLL_SECONDS,
                   "on" if scheduler_enabled() else "off")
    await stop.wait()
    for t in tasks:
        t.cancel()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
