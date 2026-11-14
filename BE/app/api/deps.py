from typing import Generator, List, Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.user import User
from app.repositories.user_repository import user_repository
from app.core.security import decode_access_token

security_scheme = HTTPBearer(auto_error=False)

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security_scheme),
    db: Session = Depends(get_db)
) -> User:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Thiếu Authorization header Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = credentials.credentials
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token không hợp lệ hoặc đã hết hạn",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # B-12: Tra cứu ưu tiên theo User ID (sub = user.id theo chuẩn RFC 7519), tương thích ngược nếu sub là email
    sub_val: str | None = payload.get("sub")
    user_id: str | None = payload.get("user_id") or (sub_val if sub_val and "@" not in sub_val else None)
    user_email: str | None = payload.get("email") or (sub_val if sub_val and "@" in sub_val else None)

    if not sub_val and not user_id and not user_email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token không chứa thông tin định danh người dùng",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user = None
    if user_id:
        user = user_repository.get_by_id(db, user_id)
    if not user and user_email:
        user = user_repository.get_by_email(db, user_email)
    if not user and sub_val:
        user = user_repository.get_by_id(db, sub_val) or user_repository.get_by_email(db, sub_val)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Người dùng không tồn tại trong hệ thống",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Kiểm tra trạng thái tài khoản
    if not getattr(user, "is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đã bị vô hiệu hóa",
        )
    
    # Kiểm tra thu hồi phiên đăng nhập cũ (Session revocation)
    token_version = payload.get("token_version")
    if token_version is not None and token_version != getattr(user, "token_version", 1):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phiên đăng nhập đã bị thu hồi do tài khoản đã đổi mật khẩu",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user

def require_roles(allowed_roles: List[str]):
    """
    Dependency kiểm tra quyền hạn (Role-based access control - RBAC)
    """
    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Bạn không có quyền thực hiện thao tác này. Quyền yêu cầu: {', '.join(allowed_roles)}",
            )
        return current_user
    return role_checker

# Helper shortcuts cho các role
require_admin = require_roles(["Admin"])
require_manager_or_admin = require_roles(["Admin", "Warehouse Manager"])


def get_client_ip(request: Request) -> Optional[str]:
    """
    Trích xuất IP client tập trung (R-44).
    Ưu tiên header 'X-Forwarded-For' khi chạy sau reverse proxy (Nginx, Docker),
    nếu không có thì fallback về 'request.client.host'.
    """
    if not request:
        return None
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = getattr(request, "client", None)
    return client.host if client else None
