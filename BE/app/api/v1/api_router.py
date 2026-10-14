from fastapi import APIRouter
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.users import router as users_router
from app.api.v1.endpoints.events import router as events_router
from app.api.v1.endpoints.audit_logs import router as audit_logs_router
from app.api.v1.endpoints.products import router as products_router
from app.api.v1.endpoints.suppliers import router as suppliers_router
from app.api.v1.endpoints.inventory import router as inventory_router
from app.api.v1.endpoints.sales import router as sales_router
from app.api.v1.endpoints.events_calendar import router as events_calendar_router
from app.api.v1.endpoints.settings import router as settings_router
from app.api.v1.endpoints.data_quality import router as data_quality_router
from app.api.v1.endpoints.ml_training import router as ml_training_router
from app.api.v1.endpoints.model_registry import router as model_registry_router
from app.api.v1.endpoints.forecasts import router as forecasts_router

api_router = APIRouter()

# UC01 - UC05: Authentication & Profile
api_router.include_router(auth_router, prefix="/auth", tags=["Authentication & Access"])

# UC06: User & Role Management (Admin)
api_router.include_router(users_router, prefix="/users", tags=["User & Role Management"])

# UC11: Master Data - Products (SKU CRUD)
api_router.include_router(products_router, prefix="/products", tags=["Master Data - Products (UC11)"])

# UC12: Master Data - Suppliers & Lead Time
api_router.include_router(suppliers_router, prefix="/suppliers", tags=["Master Data - Suppliers (UC12)"])

# UC13, UC14: Inventory & Adjustment History
api_router.include_router(inventory_router, prefix="/inventory", tags=["Inventory Management (UC13, UC14)"])

# UC15: Master Data - Historical Sales Data
api_router.include_router(sales_router, prefix="/sales", tags=["Master Data - Historical Sales (UC15)"])

# UC16: Master Data - Event & Promotion Calendar
api_router.include_router(events_calendar_router, prefix="/events-calendar", tags=["Master Data - Event Calendar (UC16)"])

# UC17 - UC24: Demand Forecasting (Forecast Explorer)
api_router.include_router(forecasts_router, prefix="/forecasts", tags=["Demand Forecasting - Forecast Explorer (UC17-UC24)"])

# UC25 - UC28: Inventory Classification (ABC/XYZ)
from app.api.v1.endpoints.classification import router as classification_router
api_router.include_router(classification_router, prefix="/classification", tags=["Inventory Classification - ABC/XYZ (UC25-UC28)"])

# UC29 - UC32: Inventory Optimization (Module F)
from app.api.v1.endpoints.optimization import router as optimization_router
api_router.include_router(optimization_router, prefix="/optimization", tags=["Inventory Optimization (UC29-UC32)"])

# Realtime Server-Sent Events (SSE)
api_router.include_router(events_router, tags=["Realtime Events"])

# UC45: System Administration & Audit Logs (Admin)
api_router.include_router(audit_logs_router, prefix="/audit-logs", tags=["System Administration & Audit Logs (UC45)"])

# UC44: System Administration - General Settings
api_router.include_router(settings_router, prefix="/settings", tags=["System Administration - General Settings (UC44)"])

# UC46, UC47, UC48: ML Pipeline & Model Ops
api_router.include_router(data_quality_router, prefix="/ml", tags=["ML Pipeline & Model Ops (UC46)"])
api_router.include_router(ml_training_router, prefix="/ml", tags=["ML Pipeline & Model Ops (UC47)"])
api_router.include_router(model_registry_router, prefix="/ml", tags=["ML Pipeline & Model Ops (UC48)"])

# Alias cho /me/email và /me/email/confirm (đáp ứng cả 2 cấu trúc URL)
from app.api.v1.endpoints.auth import request_change_email, confirm_change_email
api_router.add_api_route("/me/email", request_change_email, methods=["POST"], tags=["User Profile & Settings"], summary="UC05 - Đổi email (Alias)")
api_router.add_api_route("/me/email/confirm", confirm_change_email, methods=["POST"], tags=["User Profile & Settings"], summary="UC05 - Xác nhận đổi email (Alias)")
