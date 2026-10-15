import sys, os, uuid
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(SCRIPT_DIR, ".."))

from app.core.database import engine
from app.models import Supplier
from sqlalchemy.orm import sessionmaker

Session = sessionmaker(bind=engine)

suppliers = [
    {
        "name": "Nhà cung cấp A (Thực phẩm)",
        "lead_time_days": 5,
        "contact_name": "Nguyễn Văn An",
        "email": "supplier_a@dfios-supply.com",
        "phone": "0901234561",
        "address": "Kho A1, KCN Tân Bình, TP.HCM"
    },
    {
        "name": "Nhà cung cấp B (Gia dụng)",
        "lead_time_days": 7,
        "contact_name": "Trần Thị Bình",
        "email": "supplier_b@dfios-supply.com",
        "phone": "0901234562",
        "address": "Kho B2, KCN Sóng Thần, Bình Dương"
    },
    {
        "name": "Nhà cung cấp C (Sở thích & Đồ chơi)",
        "lead_time_days": 10,
        "contact_name": "Lê Hoàng Cường",
        "email": "supplier_c@dfios-supply.com",
        "phone": "0901234563",
        "address": "Kho C3, KCN VSIP 1, Bình Dương"
    },
    {
        "name": "Nhà cung cấp D (Hàng tươi sống)",
        "lead_time_days": 3,
        "contact_name": "Phạm Minh Đức",
        "email": "supplier_d@dfios-supply.com",
        "phone": "0901234564",
        "address": "Kho Lạnh D4, Chợ Đầu Mối Thủ Đức, TP.HCM"
    },
    {
        "name": "Nhà cung cấp E (Hàng nhập khẩu)",
        "lead_time_days": 14,
        "contact_name": "Vũ Ngọc Em",
        "email": "supplier_e@dfios-supply.com",
        "phone": "0901234565",
        "address": "Cảng Cát Lái, TP. Thủ Đức, TP.HCM"
    },
]

with Session() as session:
    existing = session.query(Supplier).all()
    if existing:
        for idx, s in enumerate(existing):
            if idx < len(suppliers):
                s.name = suppliers[idx]["name"]
                s.lead_time_days = suppliers[idx]["lead_time_days"]
                s.contact_name = suppliers[idx]["contact_name"]
                s.email = suppliers[idx]["email"]
                s.phone = suppliers[idx]["phone"]
                s.address = suppliers[idx]["address"]
        session.commit()
        print(f"Updated {len(existing)} suppliers with contact info!")
    else:
        for s in suppliers:
            session.add(Supplier(
                id=str(uuid.uuid4()),
                name=s["name"],
                lead_time_days=s["lead_time_days"],
                contact_name=s["contact_name"],
                email=s["email"],
                phone=s["phone"],
                address=s["address"],
            ))
        session.commit()
        print(f"Seeded {len(suppliers)} suppliers!")