import sys, os, uuid
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import bcrypt
from dotenv import load_dotenv
from app.database import engine
from app.models import User
from sqlalchemy.orm import sessionmaker

load_dotenv(os.path.join(SCRIPT_DIR, "..", ".env"))

Session = sessionmaker(bind=engine)
session = Session()

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

sample_users = [
    {"email": "admin@dfios.com", "password": os.getenv("ADMIN_PASSWORD", "Admin@123"), "role": "Admin", "display_name": "Admin"},
    {"email": "manager@dfios.com", "password": os.getenv("MANAGER_PASSWORD", "Manager@123"), "role": "Warehouse Manager", "display_name": "Warehouse Manager"},
    {"email": "viewer@dfios.com", "password": os.getenv("VIEWER_PASSWORD", "Viewer@123"), "role": "Viewer", "display_name": "Viewer"},
]

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