import sys, os, uuid
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import bcrypt
from dotenv import load_dotenv
from app.core.database import engine
from app.models import User
from sqlalchemy.orm import sessionmaker

load_dotenv(os.path.join(SCRIPT_DIR, "..", ".env"))

Session = sessionmaker(bind=engine)

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

required_vars = ["ADMIN_PASSWORD", "MANAGER_PASSWORD", "VIEWER_PASSWORD"]
missing = [v for v in required_vars if not os.getenv(v)]
if missing:
    raise SystemExit(f"Thiếu biến môi trường trong .env: {', '.join(missing)}")

sample_users = [
    {"email": "admin@dfios.com", "password": os.getenv("ADMIN_PASSWORD"), "role": "Admin", "display_name": "Admin"},
    {"email": "manager@dfios.com", "password": os.getenv("MANAGER_PASSWORD"), "role": "Warehouse Manager", "display_name": "Warehouse Manager"},
    {"email": "viewer@dfios.com", "password": os.getenv("VIEWER_PASSWORD"), "role": "Viewer", "display_name": "Viewer"},
]

with Session() as session:
    for u in sample_users:
        exists = session.query(User).filter_by(email=u["email"]).first()
        if exists:
            print(f"Skip (already exists): {u['email']}")
            continue
        user = User(
            id=str(uuid.uuid4()),
            email=u["email"],
            password_hash=hash_password(u["password"]),
            role=u["role"],
            display_name=u["display_name"],
        )
        session.add(user)
    session.commit()

print("Done!")