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

# Realtime Server-Sent Events (SSE)
api_router.include_router(events_router, tags=["Realtime Events"])

# UC45: System Administration & Audit Logs (Admin)
api_router.include_router(audit_logs_router, prefix="/audit-logs", tags=["System Administration & Audit Logs (UC45)"])

# Alias cho /me/email và /me/email/confirm (đáp ứng cả 2 cấu trúc URL)
from app.api.v1.endpoints.auth import request_change_email, confirm_change_email
api_router.add_api_route("/me/email", request_change_email, methods=["POST"], tags=["User Profile & Settings"], summary="UC05 - Đổi email (Alias)")
api_router.add_api_route("/me/email/confirm", confirm_change_email, methods=["POST"], tags=["User Profile & Settings"], summary="UC05 - Xác nhận đổi email (Alias)")
