import unittest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.product import Product
from app.models.inventory import Inventory
from app.models.inventory_adjustment import InventoryAdjustment
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db
from app.core.events import event_bus
from app.schemas.event import EventType


class TestInventoryEndpoints(unittest.TestCase):
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
            manager = User(
                id="manager-01",
                email="manager@dfios.com",
                password_hash=get_password_hash("Manager123"),
                role="Warehouse Manager",
                display_name="Warehouse Manager",
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
            prod = Product(
                item_id="FOODS_1_001",
                name="Fresh Apple 1kg",
                dept_id="FOODS_1",
                cat_id="FOODS",
            )
            inv = Inventory(
                item_id="FOODS_1_001",
                store_id="CA_1",
                on_hand=50.0,
                on_order=20.0,
            )
            session.add_all([admin, manager, viewer, prod, inv])
            session.commit()

        self.admin_token = create_access_token(
            data={"sub": "admin@dfios.com", "role": "Admin", "user_id": "admin-01", "token_version": 1}
        )
        self.manager_token = create_access_token(
            data={"sub": "manager@dfios.com", "role": "Warehouse Manager", "user_id": "manager-01", "token_version": 1}
        )
        self.viewer_token = create_access_token(
            data={"sub": "viewer@dfios.com", "role": "Viewer", "user_id": "viewer-01", "token_version": 1}
        )
        self.client = TestClient(app)

    def tearDown(self):
        Base.metadata.drop_all(bind=self.engine)
        app.dependency_overrides.clear()

    def test_list_and_get_inventory(self):
        # Viewer có thể đọc thông tin tồn kho
        res = self.client.get(
            "/api/v1/inventory",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["item_id"], "FOODS_1_001")
        self.assertEqual(data["items"][0]["product_name"], "Fresh Apple 1kg")
        self.assertEqual(data["items"][0]["on_hand"], 50.0)

        # Xem chi tiết theo item_id và store_id
        res_detail = self.client.get(
            "/api/v1/inventory/FOODS_1_001/CA_1",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_detail.status_code, 200)
        self.assertEqual(res_detail.json()["on_order"], 20.0)

    def test_viewer_cannot_update_inventory(self):
        res = self.client.put(
            "/api/v1/inventory/FOODS_1_001/CA_1",
            json={"on_hand": 80.0},
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res.status_code, 403)

    @patch.object(event_bus, "publish", new_callable=AsyncMock)
    def test_manager_update_inventory_triggers_sse_and_audit(self, mock_publish):
        # Manager cập nhật tồn kho
        update_payload = {
            "on_hand": 75.0,
            "on_order": 10.0,
            "reason": "Kiểm kê định kỳ tháng 10",
        }
        res = self.client.put(
            "/api/v1/inventory/FOODS_1_001/CA_1",
            json=update_payload,
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["on_hand"], 75.0)
        self.assertEqual(data["on_order"], 10.0)

        # Kiểm tra sự kiện Realtime SSE đã được phát
        self.assertTrue(mock_publish.called)
        called_event = mock_publish.call_args[0][0]
        self.assertEqual(called_event.event, EventType.INVENTORY_UPDATED.value)
        self.assertEqual(called_event.data["sku_id"], "FOODS_1_001")
        self.assertEqual(called_event.data["actor_id"], "manager@dfios.com")

        # UC14: Kiểm tra lịch sử điều chỉnh tồn kho được ghi nhận
        history_res = self.client.get(
            "/api/v1/inventory/history?item_id=FOODS_1_001",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(history_res.status_code, 200)
        h_data = history_res.json()
        self.assertEqual(h_data["total"], 1)
        adj = h_data["items"][0]
        self.assertEqual(adj["old_on_hand"], 50.0)
        self.assertEqual(adj["new_on_hand"], 75.0)
        self.assertEqual(adj["old_on_order"], 20.0)
        self.assertEqual(adj["new_on_order"], 10.0)
        self.assertEqual(adj["reason"], "Kiểm kê định kỳ tháng 10")
        self.assertEqual(adj["adjusted_by"], "manager@dfios.com")


if __name__ == "__main__":
    unittest.main()
