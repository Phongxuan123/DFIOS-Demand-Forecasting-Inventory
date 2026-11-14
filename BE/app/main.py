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
    yield


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
