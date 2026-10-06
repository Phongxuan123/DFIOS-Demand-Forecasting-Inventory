import os
from dotenv import load_dotenv

# Load BE/.env
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, ".env"))

class Settings:
    PROJECT_NAME: str = "DFIOS - Demand Forecasting & Inventory Optimization System"
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql+psycopg2://dfios:dfios123@localhost:5432/dfios")
    
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "dfios_default_secret_key_change_in_production")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))
    
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

    # Allow Frontend Vite dev server
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

settings = Settings()

