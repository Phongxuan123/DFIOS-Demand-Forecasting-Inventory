from fastapi import APIRouter
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.users import router as users_router
from app.api.v1.endpoints.events import router as events_router

api_router = APIRouter()

# UC01 - UC05: Authentication & Profile
api_router.include_router(auth_router, prefix="/auth", tags=["Authentication & Access"])

# UC06: User & Role Management (Admin)
api_router.include_router(users_router, prefix="/users", tags=["User & Role Management"])

# Realtime Server-Sent Events (SSE)
api_router.include_router(events_router, tags=["Realtime Events"])

# Alias cho /me/email và /me/email/confirm (đáp ứng cả 2 cấu trúc URL)
from app.api.v1.endpoints.auth import request_change_email, confirm_change_email
api_router.add_api_route("/me/email", request_change_email, methods=["POST"], tags=["User Profile & Settings"], summary="UC05 - Đổi email (Alias)")
api_router.add_api_route("/me/email/confirm", confirm_change_email, methods=["POST"], tags=["User Profile & Settings"], summary="UC05 - Xác nhận đổi email (Alias)")


