from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
from app.core.config import settings

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except (jwt.PyJWTError, Exception):
        return None

def create_password_reset_token(email: str, expires_minutes: int = 15) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    to_encode = {
        "sub": email,
        "type": "reset_password",
        "exp": expire,
    }
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

def verify_password_reset_token(token: str) -> str | None:
    payload = decode_access_token(token)
    if not payload:
        return None
    if payload.get("type") != "reset_password":
        return None
    return payload.get("sub")

import secrets
import hashlib
import hmac

def generate_secure_token() -> str:
    """
    Sinh chuỗi token ngẫu nhiên bảo mật cao độ dài 32 bytes (URL-safe string).
    """
    return secrets.token_urlsafe(32)

def hash_token(token: str) -> str:
    """
    Băm token bằng SHA-256 trước khi lưu DB. Tuyệt đối không lưu token thô.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def verify_token_hash(token: str, token_hash: str) -> bool:
    """
    So sánh an toàn chống tấn công timing attack bằng hmac.compare_digest.
    """
    computed = hash_token(token)
    return hmac.compare_digest(computed, token_hash)


