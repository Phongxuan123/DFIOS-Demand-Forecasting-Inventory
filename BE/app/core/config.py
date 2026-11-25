import os
from dotenv import load_dotenv

# Thứ tự ưu tiên: biến môi trường của shell > BE/.env.local (cấu hình riêng từng máy, không commit) > BE/.env
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, ".env.local"))
load_dotenv(os.path.join(BASE_DIR, ".env"))

_LOCAL_DB_HOSTS = {"localhost", "127.0.0.1", "::1", "host.docker.internal", "db", "postgres"}


def _assert_local_only() -> None:
    """DFIOS_LOCAL_ONLY=1: môi trường test tách biệt, cấm kết nối tới database ngoài máy (vd Supabase của nhóm)."""
    if os.getenv("DFIOS_LOCAL_ONLY", "").strip().lower() not in ("1", "true", "yes"):
        return
    from urllib.parse import urlparse
    url = os.getenv("DATABASE_URL", "").strip()
    # R5B-09: an unset URL means the localhost default; SQLite is a local file (the test suite uses it)
    if not url or url.lower().startswith("sqlite"):
        return
    host = (urlparse(url.replace("+psycopg2", "")).hostname or "").lower()
    if host not in _LOCAL_DB_HOSTS:
        raise RuntimeError(
            f"DFIOS_LOCAL_ONLY=1 but DATABASE_URL points to '{host}'. "
            "This machine is configured as an isolated test environment; refusing to connect to a remote database. "
            "Fix DATABASE_URL in BE/.env.local or unset DFIOS_LOCAL_ONLY."
        )


_assert_local_only()

class Settings:
    PROJECT_NAME: str = "DFIOS - Demand Forecasting & Inventory Optimization System"
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql+psycopg2://dfios:dfios123@localhost:5432/dfios")
    
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "dfios_default_secret_key_change_in_production")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))
    # demo.md §6.3 POST /auth/refresh: long-lived refresh token, revoked with the access tokens by token_version
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
    
    # Cấu hình Frontend
    FRONTEND_BASE_URL: str = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173")

    # Cấu hình gửi Email (SMTP - Gmail App Password / dịch vụ khác)
    SMTP_HOST: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    EMAILS_FROM_EMAIL: str = os.getenv("EMAILS_FROM_EMAIL", "noreply@dfios.com")
    EMAILS_FROM_NAME: str = os.getenv("EMAILS_FROM_NAME", "DFIOS Notification")
    EMAILS_USE_TLS: bool = os.getenv("EMAILS_USE_TLS", "True").lower() in ("true", "1", "yes")

    # Thời hạn hiệu lực của Token (TTL)
    TOKEN_EXPIRE_ACTIVATE_HOURS: int = int(os.getenv("TOKEN_EXPIRE_ACTIVATE_HOURS", "48"))
    TOKEN_EXPIRE_RESET_PASSWORD_MINUTES: int = int(os.getenv("TOKEN_EXPIRE_RESET_PASSWORD_MINUTES", "30"))
    TOKEN_EXPIRE_CHANGE_EMAIL_HOURS: int = int(os.getenv("TOKEN_EXPIRE_CHANGE_EMAIL_HOURS", "24"))

    # Rate Limit (số lần gửi mail tối đa / giờ / email)
    EMAIL_RATE_LIMIT_PER_HOUR: int = int(os.getenv("EMAIL_RATE_LIMIT_PER_HOUR", "5"))

    # Môi trường chạy hệ thống (development, staging, production)
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    ENABLE_TEST_ENDPOINTS: bool = os.getenv(
        "ENABLE_TEST_ENDPOINTS",
        "true" if os.getenv("ENVIRONMENT", "development") != "production" else "false",
    ).lower() in ("true", "1", "yes")

    # P-09: chỉ tin `X-Forwarded-For` khi kết nối đến từ các proxy này (IP hoặc CIDR, phân tách dấu phẩy).
    # Để trống (mặc định) nghĩa là không tin header, dùng IP kết nối trực tiếp.
    TRUSTED_PROXIES: list[str] = [
        p.strip() for p in os.getenv("TRUSTED_PROXIES", "").split(",") if p.strip()
    ]

    # P-05: thư mục chứa artifact khoa học (parquet, npz, csv, MODEL/*).
    ARTIFACTS_DIR: str = os.getenv("DFIOS_ARTIFACTS_DIR", "")

    # Allow Frontend Vite dev server
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

settings = Settings()

