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
from app.models.product import Product
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
            prod1 = Product(item_id="FOODS_1_001", name="Food 1")
            prod2 = Product(item_id="FOODS_1_002", name="Food 2")
            prod3 = Product(item_id="HOBBIES_1_001", name="Hobby 1")
            session.add_all([admin, viewer, prod1, prod2, prod3, sale1, sale2, sale3])
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

    def test_import_sales_csv_with_sales_header_and_new_store_onboarding(self):
        # UC15/N-23: Test import CSV using 'sales' column header and onboarding new store (STORE_VN_01)
        csv_content = "item_id,store_id,sale_date,sales,price\nFOODS_1_001,STORE_VN_01,2016-03-01,25.0,3.5\nFOODS_1_001,STORE_VN_01,2016-03-02,30.0,3.5\n"
        csv_file = io.BytesIO(csv_content.encode("utf-8"))

        res = self.client.post(
            "/api/v1/sales/import",
            files={"file": ("sales_vn.csv", csv_file, "text/csv")},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["imported_count"], 2)
        self.assertEqual(data["skipped_count"], 0)

        # Assert SimClock and Inventory were onboarded
        from app.models.sim_clock import SimClock
        from app.models.inventory import Inventory
        with self.TestingSessionLocal() as session:
            clock = session.query(SimClock).filter(SimClock.store_id == "STORE_VN_01").first()
            self.assertIsNotNone(clock)
            self.assertEqual(clock.current_date, date(2016, 3, 2))

            inv = session.query(Inventory).filter(
                Inventory.store_id == "STORE_VN_01",
                Inventory.item_id == "FOODS_1_001",
            ).first()
            self.assertIsNotNone(inv)

    def test_admin_import_sales_csv_utf8_bom_and_skip_invalid(self):
        csv_content = "\ufeffITEM_ID , Store_Id , Sale_Date , Quantity \nFOODS_1_002,CA_1,2016-03-01,10.0\nFOODS_1_002,CA_1,2016-03-02,-5.0\nNON_EXISTENT_SKU,CA_1,2016-03-03,8.0\n"
        csv_bytes = csv_content.encode("utf-8-sig")
        csv_file = io.BytesIO(csv_bytes)

        res = self.client.post(
            "/api/v1/sales/import",
            files={"file": ("bom_sales.csv", csv_file, "text/csv")},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["imported_count"], 1)
        self.assertEqual(data["skipped_count"], 2)

    def test_download_import_template_headers(self):
        # UC-Import/N-23: Template endpoint /data/template has consistent headers matching FE
        res = self.client.get(
            "/api/v1/data/template",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("item_id,store_id,sale_date,quantity,sell_price", res.text)


if __name__ == "__main__":
    unittest.main()
