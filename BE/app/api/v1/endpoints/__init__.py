from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.users import router as users_router
from app.api.v1.endpoints.events import router as events_router

__all__ = ["auth_router", "users_router", "events_router"]

