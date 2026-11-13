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
        "lead_time_days": 3,
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
    # B-18: Upsert theo khóa tự nhiên (email hoặc name) để tránh tráo dữ liệu nhà cung cấp khi query không ORDER BY
    existing_by_email = {s.email: s for s in session.query(Supplier).all() if s.email}
    existing_by_name = {s.name: s for s in session.query(Supplier).all() if s.name}

    updated_count = 0
    inserted_count = 0

    for s_data in suppliers:
        target = existing_by_email.get(s_data["email"]) or existing_by_name.get(s_data["name"])
        if target:
            target.name = s_data["name"]
            target.lead_time_days = s_data["lead_time_days"]
            target.contact_name = s_data["contact_name"]
            target.email = s_data["email"]
            target.phone = s_data["phone"]
            target.address = s_data["address"]
            updated_count += 1
        else:
            session.add(Supplier(
                id=str(uuid.uuid4()),
                name=s_data["name"],
                lead_time_days=s_data["lead_time_days"],
                contact_name=s_data["contact_name"],
                email=s_data["email"],
                phone=s_data["phone"],
                address=s_data["address"],
            ))
            inserted_count += 1

    session.commit()
    print(f"Synchronized suppliers: {updated_count} updated, {inserted_count} inserted!")