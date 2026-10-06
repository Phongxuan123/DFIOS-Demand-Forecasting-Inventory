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
    
    # Allow Frontend Vite dev server
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

settings = Settings()
