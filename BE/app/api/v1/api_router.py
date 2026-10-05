from fastapi import APIRouter
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.users import router as users_router

api_router = APIRouter()

# UC01 - UC05: Authentication & Profile
api_router.include_router(auth_router, prefix="/auth", tags=["Authentication & Access"])

# UC06: User & Role Management (Admin)
api_router.include_router(users_router, prefix="/users", tags=["User & Role Management"])
