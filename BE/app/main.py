from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.v1.api_router import api_router

app = FastAPI(
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
