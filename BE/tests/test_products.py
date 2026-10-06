import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.product import Product
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestProductMasterEndpoints(unittest.TestCase):
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
            prod1 = Product(
                item_id="FOODS_1_001",
                name="Fresh Apple 1kg",
                dept_id="FOODS_1",
                cat_id="FOODS",
            )
            prod2 = Product(
                item_id="HOBBIES_1_001",
                name="Board Game Classic",
                dept_id="HOBBIES_1",
                cat_id="HOBBIES",
            )
            session.add_all([admin, viewer, prod1, prod2])
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

    def test_list_products_and_filter(self):
        # Viewer có thể đọc danh sách
        res = self.client.get(
            "/api/v1/products",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total"], 2)
        self.assertEqual(len(data["items"]), 2)

        # Lọc theo cat_id
        res_cat = self.client.get(
            "/api/v1/products?cat_id=FOODS",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_cat.status_code, 200)
        self.assertEqual(res_cat.json()["total"], 1)
        self.assertEqual(res_cat.json()["items"][0]["item_id"], "FOODS_1_001")

        # Tìm kiếm theo tên
        res_search = self.client.get(
            "/api/v1/products?search=Board Game",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_search.status_code, 200)
        self.assertEqual(res_search.json()["total"], 1)
        self.assertEqual(res_search.json()["items"][0]["item_id"], "HOBBIES_1_001")

    def test_get_product_detail(self):
        res = self.client.get(
            "/api/v1/products/FOODS_1_001",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["name"], "Fresh Apple 1kg")

        # 404 cho SKU không tồn tại
        res_not_found = self.client.get(
            "/api/v1/products/NON_EXISTENT",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_not_found.status_code, 404)

    def test_viewer_cannot_create_or_modify_products(self):
        # Viewer tạo sản phẩm -> 403
        res = self.client.post(
            "/api/v1/products",
            json={"item_id": "TEST_001", "name": "Test Item", "dept_id": "TEST", "cat_id": "TEST"},
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 403)

        # Viewer xóa sản phẩm -> 403
        res_del = self.client.delete(
            "/api/v1/products/FOODS_1_001",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_del.status_code, 403)

    def test_admin_crud_product(self):
        # 1. Admin tạo sản phẩm mới
        create_res = self.client.post(
            "/api/v1/products",
            json={"item_id": "HOUSEHOLD_1_001", "name": "Dish Soap 500ml", "dept_id": "HOUSEHOLD_1", "cat_id": "HOUSEHOLD"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(create_res.status_code, 201)
        self.assertEqual(create_res.json()["item_id"], "HOUSEHOLD_1_001")

        # 2. Tạo trùng SKU -> 400
        dup_res = self.client.post(
            "/api/v1/products",
            json={"item_id": "HOUSEHOLD_1_001", "name": "Dish Soap Duplicate"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(dup_res.status_code, 400)

        # 3. Cập nhật thông tin sản phẩm
        update_res = self.client.put(
            "/api/v1/products/HOUSEHOLD_1_001",
            json={"name": "Dish Soap Organic 500ml"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(update_res.status_code, 200)
        self.assertEqual(update_res.json()["name"], "Dish Soap Organic 500ml")

        # 4. Xóa sản phẩm
        del_res = self.client.delete(
            "/api/v1/products/HOUSEHOLD_1_001",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(del_res.status_code, 204)

        # Kiểm tra lại xem đã xóa chưa -> 404
        check_res = self.client.get(
            "/api/v1/products/HOUSEHOLD_1_001",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(check_res.status_code, 404)

    def test_admin_bulk_import_products(self):
        bulk_payload = {
            "items": [
                {"item_id": "BULK_01", "name": "Bulk Item 1", "dept_id": "BULK", "cat_id": "TEST"},
                {"item_id": "BULK_02", "name": "Bulk Item 2", "dept_id": "BULK", "cat_id": "TEST"},
                {"item_id": "FOODS_1_001", "name": "Duplicate Item"},  # đã tồn tại
            ]
        }
        res = self.client.post(
            "/api/v1/products/bulk",
            json=bulk_payload,
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["inserted"], 2)
        self.assertEqual(data["skipped"], 1)


if __name__ == "__main__":
    unittest.main()
