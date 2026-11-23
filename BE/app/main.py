import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.v1.api_router import api_router

logger = logging.getLogger("dfios.startup")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # P-10: đưa schema DB đã tồn tại lên bản mới (idempotent, chỉ chạy trên PostgreSQL, không chặn khởi động nếu lỗi)
    try:
        from app.core.database import engine
        from app.core.schema_upgrades import apply_schema_upgrades
        applied = apply_schema_upgrades(engine)
        if applied:
            logger.warning("Schema upgrades applied: %s", ", ".join(applied))
    except Exception as exc:  # noqa: BLE001
        logger.error("Schema upgrade check failed (run scripts/init_tables.py): %s", exc)
    # R-17: the default ML schedule is created HERE (and by scripts/init_tables.py), never by a GET
    try:
        import sys
        if "pytest" not in sys.modules:  # tests use their own databases (never write to the configured one)
            from app.core.database import SessionLocal
            from app.services import policy_config as pc
            from app.services.pipeline_service import pipeline_service
            with SessionLocal() as db:
                anchor = pc.load_calendar_setting(db)  # a replay DB shifted as a whole keeps its own calendar
                if anchor != pc.M5_DAY0_DEFAULT:
                    logger.warning("Replay calendar shifted: d_1 = %s", anchor)
                costs = pc.sync_costs(db)  # demo.md §1.3: h, b, c from Settings
                if costs != {"holding_rate": pc.HOLDING_RATE_DAILY_DEFAULT,
                             "stockout_penalty_rate": pc.STOCKOUT_PENALTY_RATE_DEFAULT,
                             "order_cost": pc.ORDER_COST_C_DEFAULT}:
                    logger.warning("Simulation costs from Settings: %s", costs)
                if pipeline_service.ensure_default_schedule(db):
                    logger.warning("Default ML pipeline schedule created")
            # batch jobs left 'running' by a previous (dead) API process can never finish: mark them failed. Only
            # when this process is the executor (thread mode); in queue mode the worker container owns the jobs.
            from app.services.batch_service import EXECUTOR_THREAD, batch_service, executor_mode
            if executor_mode() == EXECUTOR_THREAD:
                with SessionLocal() as db:
                    n_orphans = batch_service.recover_orphans(db)
                    if n_orphans:
                        logger.warning("Marked %d orphan batch_runs row(s) as failed", n_orphans)
    except Exception as exc:  # noqa: BLE001 - startup must not fail on an optional seed
        logger.error("Default schedule check failed: %s", exc)
    task = None
    try:
        from app.services.scheduler_service import scheduler_enabled, scheduler_loop
        if scheduler_enabled():
            import asyncio
            task = asyncio.create_task(scheduler_loop())
    except Exception as exc:  # noqa: BLE001
        logger.error("Scheduler start failed: %s", exc)
    yield
    if task is not None:
        task.cancel()


app = FastAPI(
    lifespan=lifespan,
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Backend API cho hệ thống dự báo nhu cầu & tối ưu tồn kho DFIOS"
)

# Cấu hình CORS để Frontend (React/Vite) gọi được sang Backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "Content-Disposition"],
)

# Đăng ký API router v1: /api/v1/... và alias /api/...
app.include_router(api_router, prefix="/api/v1")
app.include_router(api_router, prefix="/api")

@app.get("/api/health", tags=["Health"], summary="Kiểm tra trạng thái hệ thống")
def health_check():
    return {
        "status": "healthy",
        "project": "DFIOS",
        "version": "1.0.0"
    }
