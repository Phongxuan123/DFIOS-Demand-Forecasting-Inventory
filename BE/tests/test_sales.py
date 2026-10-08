import io
import unittest
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.sales_history import SalesHistory
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestSalesEndpoints(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.TestingSessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=self.engine, expire_on_commit=False
        )
        Base.metadata.create_all(bind=self.engine)

        def override_get_db():
            db = self.TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db

        with self.TestingSessionLocal() as session:
            admin = User(
                id="admin-01",
                email="admin@dfios.com",
                password_hash=get_password_hash("Admin123"),
                role="Admin",
                display_name="System Admin",
                is_active=True,
                is_verified=True,
                token_version=1,
            )
            viewer = User(
                id="viewer-01",
                email="viewer@dfios.com",
                password_hash=get_password_hash("Viewer123"),
                role="Viewer",
                display_name="Warehouse Viewer",
                is_active=True,
                is_verified=True,
                token_version=1,
            )
            sale1 = SalesHistory(
                id="FOODS_1_001_CA_1_2016-01-01",
                item_id="FOODS_1_001",
                store_id="CA_1",
                sale_date=date(2016, 1, 1),
                quantity=15.0,
            )
            sale2 = SalesHistory(
                id="FOODS_1_001_CA_1_2016-01-02",
                item_id="FOODS_1_001",
                store_id="CA_1",
                sale_date=date(2016, 1, 2),
                quantity=25.0,
            )
            sale3 = SalesHistory(
                id="HOBBIES_1_001_TX_1_2016-01-03",
                item_id="HOBBIES_1_001",
                store_id="TX_1",
                sale_date=date(2016, 1, 3),
                quantity=5.0,
            )
            session.add_all([admin, viewer, sale1, sale2, sale3])
            session.commit()

        self.admin_token = create_access_token(
            data={"sub": "admin@dfios.com", "role": "Admin", "user_id": "admin-01", "token_version": 1}
        )
        self.viewer_token = create_access_token(
            data={"sub": "viewer@dfios.com", "role": "Viewer", "user_id": "viewer-01", "token_version": 1}
        )
        self.client = TestClient(app)

    def tearDown(self):
        Base.metadata.drop_all(bind=self.engine)
        app.dependency_overrides.clear()

    def test_query_sales_and_filtering(self):
        # Viewer có thể tra cứu toàn bộ
        res = self.client.get(
            "/api/v1/sales",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total"], 3)
        self.assertEqual(data["total_quantity"], 45.0)
        self.assertEqual(data["average_quantity"], 15.0)

        # Lọc theo SKU
        res_sku = self.client.get(
            "/api/v1/sales?item_id=FOODS_1_001",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_sku.status_code, 200)
        self.assertEqual(res_sku.json()["total"], 2)
        self.assertEqual(res_sku.json()["total_quantity"], 40.0)

        # Lọc theo khoảng ngày
        res_date = self.client.get(
            "/api/v1/sales?start_date=2016-01-02&end_date=2016-01-03",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_date.status_code, 200)
        self.assertEqual(res_date.json()["total"], 2)

    def test_sales_summary(self):
        res = self.client.get(
            "/api/v1/sales/summary?item_id=FOODS_1_001",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_records"], 2)
        self.assertEqual(data["min_date"], "2016-01-01")
        self.assertEqual(data["max_date"], "2016-01-02")
        self.assertEqual(data["total_quantity"], 40.0)

    def test_viewer_cannot_create_or_import_sales(self):
        # Viewer không có quyền tạo bản ghi
        res = self.client.post(
            "/api/v1/sales",
            json={"item_id": "FOODS_1_001", "store_id": "CA_1", "sale_date": "2016-01-05", "quantity": 10.0},
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 403)

    def test_admin_create_sale_record(self):
        res = self.client.post(
            "/api/v1/sales",
            json={"item_id": "FOODS_1_001", "store_id": "CA_1", "sale_date": "2016-01-10", "quantity": 30.0},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["quantity"], 30.0)

    def test_admin_import_sales_csv(self):
        csv_content = "item_id,store_id,sale_date,quantity\nFOODS_1_002,CA_2,2016-02-01,12.5\nFOODS_1_002,CA_2,2016-02-02,18.0\n"
        csv_file = io.BytesIO(csv_content.encode("utf-8"))

        res = self.client.post(
            "/api/v1/sales/import",
            files={"file": ("sales_data.csv", csv_file, "text/csv")},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["imported_count"], 2)
        self.assertEqual(data["skipped_count"], 0)

        # Kiểm tra dữ liệu vừa import
        check_res = self.client.get(
            "/api/v1/sales?item_id=FOODS_1_002",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(check_res.status_code, 200)
        self.assertEqual(check_res.json()["total"], 2)


if __name__ == "__main__":
    unittest.main()
