import sys, os, uuid
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

import bcrypt
from app.database import engine
from app.models import User
from sqlalchemy.orm import sessionmaker

Session = sessionmaker(bind=engine)
session = Session()

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

sample_users = [
    {"email": "admin@dfios.com", "password": "Admin@123", "role": "Admin", "display_name": "Admin"},
    {"email": "manager@dfios.com", "password": "Manager@123", "role": "Warehouse Manager", "display_name": "Warehouse Manager"},
    {"email": "viewer@dfios.com", "password": "Viewer@123", "role": "Viewer", "display_name": "Viewer"},
]

for u in sample_users:
    user = User(
        id=str(uuid.uuid4()),
        email=u["email"],
        password_hash=hash_password(u["password"]),
        role=u["role"],
        display_name=u["display_name"],
    )
    session.add(user)

session.commit()
print(f"Seeded {len(sample_users)} users!")