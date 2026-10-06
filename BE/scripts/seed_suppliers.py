import sys, os, uuid
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

from app.database import engine
from app.models import Supplier
from sqlalchemy.orm import sessionmaker

Session = sessionmaker(bind=engine)

suppliers = [
    {"name": "Nhà cung cấp A", "lead_time_days": 5},
    {"name": "Nhà cung cấp B", "lead_time_days": 7},
    {"name": "Nhà cung cấp C", "lead_time_days": 10},
    {"name": "Nhà cung cấp D", "lead_time_days": 3},
    {"name": "Nhà cung cấp E", "lead_time_days": 14},
]

with Session() as session:
    existing = session.query(Supplier).count()
    if existing > 0:
        print("Suppliers already seeded, nothing to do.")
    else:
        for s in suppliers:
            session.add(Supplier(id=str(uuid.uuid4()), name=s["name"], lead_time_days=s["lead_time_days"]))
        session.commit()
        print(f"Seeded {len(suppliers)} suppliers!")