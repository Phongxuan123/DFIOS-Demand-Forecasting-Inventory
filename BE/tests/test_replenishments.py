import unittest
from datetime import date, datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.product import Product
from app.models.supplier import Supplier
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.replenishment import ReplenishmentRecommendation
from app.models.audit_log import AuditLog
from app.core.security import get_password_hash, create_access_token
from app.api.deps import get_db


class TestReplenishmentEndpoints(unittest.TestCase):
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
                display_name="Viewer User",
                is_active=True,
                is_verified=True,
                token_version=1,
            )
            session.add_all([admin, manager, viewer])

            # Seed Supplier
            supplier = Supplier(
                id="SUP_001",
                name="Walmart Distribution Center",
                lead_time_days=7,
            )
            session.add(supplier)

            # Seed Products
            p1 = Product(item_id="FOODS_1_001", name="Fresh Milk", dept_id="FOODS_1", cat_id="FOODS")
            p2 = Product(item_id="HOBBIES_1_001", name="Board Game", dept_id="HOBBIES_1", cat_id="HOBBIES")
            session.add_all([p1, p2])

            # Seed Inventory: FOODS_1_001 có on_hand = 10, on_order = 0 (dưới ROP)
            inv1 = Inventory(
                item_id="FOODS_1_001",
                store_id="CA_1",
                on_hand=10.0,
                on_order=0.0,
                updated_at=datetime.now(timezone.utc),
            )
            # HOBBIES_1_001 có on_hand = 100, on_order = 50 (vượt ROP -> không cần nhập)
            inv2 = Inventory(
                item_id="HOBBIES_1_001",
                store_id="CA_1",
                on_hand=100.0,
                on_order=50.0,
                updated_at=datetime.now(timezone.utc),
            )
            session.add_all([inv1, inv2])

            # Seed InventoryParams: ROP = 50, SS = 20, EOQ = 80 cho FOODS_1_001
            param1 = InventoryParam(
                id="CA_1_FOODS_1_001",
                item_id="FOODS_1_001",
                store_id="CA_1",
                service_level=0.95,
                lead_time_days=7,
                safety_stock=20.0,
                reorder_point=50.0,
                eoq=80.0,
                annual_demand=2500.0,
                holding_cost=2.0,
                order_cost=50.0,
                unit_price=10.0,
                source="ml",
            )
            param2 = InventoryParam(
                id="CA_1_HOBBIES_1_001",
                item_id="HOBBIES_1_001",
                store_id="CA_1",
                service_level=0.95,
                lead_time_days=7,
                safety_stock=15.0,
                reorder_point=40.0,
                eoq=50.0,
                annual_demand=1200.0,
                holding_cost=2.0,
                order_cost=50.0,
                unit_price=10.0,
                source="static",
            )
            session.add_all([param1, param2])

            session.commit()

        self.client = TestClient(app)
        self.admin_token = create_access_token({"sub": "admin@dfios.com", "role": "Admin", "token_version": 1})
        self.manager_token = create_access_token({"sub": "manager@dfios.com", "role": "Warehouse Manager", "token_version": 1})
        self.viewer_token = create_access_token({"sub": "viewer@dfios.com", "role": "Viewer", "token_version": 1})

    def tearDown(self):
        app.dependency_overrides.clear()

    # ==========================================
    # UC33: View & Generate Recommendations
    # ==========================================

    def test_list_recommendations_and_auto_generate(self):
        # Manager truy cập danh sách -> hệ thống tự động quét và sinh đề xuất
        res = self.client.get(
            "/api/v1/replenishments",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreaterEqual(data["total"], 1)
        self.assertEqual(data["pending_count"], 1)

        # Kiểm tra chi tiết đề xuất cho FOODS_1_001
        item = data["items"][0]
        self.assertEqual(item["item_id"], "FOODS_1_001")
        self.assertEqual(item["status"], "PENDING")
        self.assertEqual(item["priority"], "HIGH")  # On_hand (10) <= SS (20)
        self.assertEqual(item["recommended_qty"], 80.0)
        self.assertEqual(item["final_qty"], 80.0)
        self.assertEqual(item["product_name"], "Fresh Milk")
        self.assertEqual(item["category"], "FOODS")
        self.assertEqual(item["supplier_name"], "Walmart Distribution Center")

        # Viewer bị cấm xem danh sách đề xuất (403)
        res_viewer = self.client.get(
            "/api/v1/replenishments",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)

    def test_generate_idempotency_no_duplicates(self):
        # Gọi sinh đề xuất thủ công lần 1
        res1 = self.client.post(
            "/api/v1/replenishments/generate?store_id=CA_1",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res1.status_code, 200)
        count1 = res1.json()["generated_count"]

        # Gọi lần 2: Không sinh thêm đơn trùng lặp cho SKU đã có đơn PENDING
        res2 = self.client.post(
            "/api/v1/replenishments/generate?store_id=CA_1",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["generated_count"], 0)

    # ==========================================
    # UC34: Adjust Recommended Order Quantity
    # ==========================================

    def test_adjust_quantity_success_and_validation(self):
        # Lấy danh sách để có ID đơn PENDING
        list_res = self.client.get(
            "/api/v1/replenishments",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        rec_id = list_res.json()["items"][0]["id"]

        # Điều chỉnh hợp lệ (80 -> 120 kèm lý do)
        payload = {"final_qty": 120.0, "reason": "Tăng số lượng để đủ kiện hàng nhà cung cấp (Full pallet)"}
        res_adj = self.client.put(
            f"/api/v1/replenishments/{rec_id}/adjust",
            json=payload,
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_adj.status_code, 200)
        self.assertEqual(res_adj.json()["final_qty"], 120.0)
        self.assertEqual(res_adj.json()["reason"], payload["reason"])

        # Kiểm tra audit log
        with self.TestingSessionLocal() as session:
            log = session.query(AuditLog).filter(AuditLog.action == "replenishment.adjust").first()
            self.assertIsNotNone(log)
            self.assertEqual(log.actor_email, "manager@dfios.com")

        # Lỗi: Số lượng âm hoặc bằng 0 -> 422
        res_zero = self.client.put(
            f"/api/v1/replenishments/{rec_id}/adjust",
            json={"final_qty": 0, "reason": "Lý do hợp lệ"},
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_zero.status_code, 422)

        # Lỗi: Lý do quá ngắn (< 3 ký tự) -> 422
        res_short_reason = self.client.put(
            f"/api/v1/replenishments/{rec_id}/adjust",
            json={"final_qty": 100, "reason": "ok"},
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_short_reason.status_code, 422)

    # ==========================================
    # UC35: Approve Replenishment
    # ==========================================

    def test_approve_recommendation_and_update_on_order(self):
        # 1. Lấy đơn PENDING
        list_res = self.client.get(
            "/api/v1/replenishments",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        rec_id = list_res.json()["items"][0]["id"]
        qty = list_res.json()["items"][0]["final_qty"]

        # 2. Phê duyệt đơn
        res_appr = self.client.post(
            f"/api/v1/replenishments/{rec_id}/approve",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_appr.status_code, 200)
        self.assertEqual(res_appr.json()["status"], "APPROVED")

        # 3. Kiểm tra On_order trong bảng inventory được cộng dồn chính xác
        with self.TestingSessionLocal() as session:
            inv = session.query(Inventory).filter(Inventory.item_id == "FOODS_1_001").first()
            self.assertEqual(inv.on_order, qty)  # ban đầu là 0, sau duyệt là 0 + qty

        # 4. Kiểm tra không cho phép duyệt lần hai -> 400
        res_reapprove = self.client.post(
            f"/api/v1/replenishments/{rec_id}/approve",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_reapprove.status_code, 400)

    # ==========================================
    # UC36: Reject & Cancel Replenishment
    # ==========================================

    def test_reject_recommendation(self):
        # Tạo đơn PENDING mới
        with self.TestingSessionLocal() as session:
            rec = ReplenishmentRecommendation(
                id="rec-test-reject",
                item_id="FOODS_1_001",
                store_id="CA_1",
                recommended_qty=50.0,
                final_qty=50.0,
                priority="MEDIUM",
                status="PENDING",
                created_at=datetime.now(timezone.utc),
            )
            session.add(rec)
            session.commit()

        # Từ chối không có lý do -> 422
        res_no_reason = self.client.post(
            "/api/v1/replenishments/rec-test-reject/reject",
            json={"reason": ""},
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_no_reason.status_code, 422)

        # Từ chối hợp lệ
        res_rej = self.client.post(
            "/api/v1/replenishments/rec-test-reject/reject",
            json={"reason": "Kho lân cận đang dư thừa hàng, sẽ chuyển kho nội bộ"},
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_rej.status_code, 200)
        self.assertEqual(res_rej.json()["status"], "REJECTED")

    def test_cancel_approved_recommendation_reverts_on_order(self):
        # Duyệt một đơn trước
        list_res = self.client.get(
            "/api/v1/replenishments",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        rec_id = list_res.json()["items"][0]["id"]
        qty = list_res.json()["items"][0]["final_qty"]

        self.client.post(
            f"/api/v1/replenishments/{rec_id}/approve",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )

        # Hủy đơn đã duyệt kèm lý do
        res_cancel = self.client.post(
            f"/api/v1/replenishments/{rec_id}/cancel",
            json={"reason": "Nhà cung cấp thông báo đứt gãy chuỗi cung ứng, không giao được"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(res_cancel.status_code, 200)
        self.assertEqual(res_cancel.json()["status"], "CANCELLED")

        # Kiểm tra On_order được hoàn trả (giảm đi đúng bằng qty đã hủy)
        with self.TestingSessionLocal() as session:
            inv = session.query(Inventory).filter(Inventory.item_id == "FOODS_1_001").first()
            self.assertEqual(inv.on_order, 0.0)

    # ==========================================
    # UC37: View Replenishment History
    # ==========================================

    def test_view_history_all_roles(self):
        # Tạo một đơn đã duyệt để có lịch sử
        with self.TestingSessionLocal() as session:
            rec = ReplenishmentRecommendation(
                id="rec-hist-01",
                item_id="FOODS_1_001",
                store_id="CA_1",
                recommended_qty=30.0,
                final_qty=30.0,
                priority="LOW",
                status="APPROVED",
                decided_by="manager@dfios.com",
                created_at=datetime.now(timezone.utc) - timedelta(days=2),
                decided_at=datetime.now(timezone.utc) - timedelta(days=1),
            )
            session.add(rec)
            session.commit()

        # Viewer cũng xem được lịch sử (UC37)
        res_viewer = self.client.get(
            "/api/v1/replenishments/history",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 200)
        data = res_viewer.json()
        self.assertGreaterEqual(data["total"], 1)

        # Manager và Admin cũng xem được
        res_mgr = self.client.get(
            "/api/v1/replenishments/history",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res_mgr.status_code, 200)

    # ==========================================
    # UC38: Export Replenishment List
    # ==========================================

    def test_export_csv_success_and_role(self):
        # Manager xuất danh sách
        res = self.client.get(
            "/api/v1/replenishments/export",
            headers={"Authorization": f"Bearer {self.manager_token}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/csv", res.headers["content-type"])
        self.assertIn("attachment; filename=", res.headers["content-disposition"])

        # Kiểm tra nội dung CSV có header tiếng Việt và BOM
        content = res.text
        self.assertIn("Mã Đề Xuất", content)
        self.assertIn("Mã SKU", content)
        self.assertIn("Tên Sản Phẩm", content)
        self.assertIn("SL Đề Xuất (EOQ)", content)

        # Viewer bị cấm xuất danh sách (403)
        res_viewer = self.client.get(
            "/api/v1/replenishments/export",
            headers={"Authorization": f"Bearer {self.viewer_token}"},
        )
        self.assertEqual(res_viewer.status_code, 403)
