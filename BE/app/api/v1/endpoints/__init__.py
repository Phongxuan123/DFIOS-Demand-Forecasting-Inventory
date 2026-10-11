from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.users import router as users_router
from app.api.v1.endpoints.events import router as events_router
from app.api.v1.endpoints.audit_logs import router as audit_logs_router
from app.api.v1.endpoints.products import router as products_router
from app.api.v1.endpoints.suppliers import router as suppliers_router
from app.api.v1.endpoints.inventory import router as inventory_router
from app.api.v1.endpoints.sales import router as sales_router
from app.api.v1.endpoints.events_calendar import router as events_calendar_router

__all__ = [
    "auth_router",
    "users_router",
    "events_router",
    "audit_logs_router",
    "products_router",
    "suppliers_router",
    "inventory_router",
    "sales_router",
    "events_calendar_router",
]
