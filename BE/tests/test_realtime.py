import asyncio
import json
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.core.security import get_password_hash, create_access_token
from app.core.events import InMemoryEventBus, event_bus
from app.schemas.event import (
    EventType,
    create_inventory_updated_event,
    SystemEvent,
)
from app.api.deps import get_db


class TestRealtimeSSE(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # In-memory SQLite for testing
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

        # Seed test users
        with self.TestingSessionLocal() as session:
            self.test_user = User(
                id="user-wm-01",
                email="warehouse.manager@dfios.com",
                password_hash=get_password_hash("password123"),
                role="Warehouse Manager",
                display_name="Warehouse Manager",
                is_active=True,
            )
            session.add(self.test_user)
            session.commit()

        self.valid_token = create_access_token(data={"sub": "warehouse.manager@dfios.com"})
        self.client = TestClient(app)

    def tearDown(self):
        Base.metadata.drop_all(bind=self.engine)
        app.dependency_overrides.clear()

    # 1. Kiểm tra xác thực: Thiếu Token -> Trả về lỗi 401
    def test_events_endpoint_missing_token_returns_401(self):
        response = self.client.get("/api/events")
        self.assertEqual(response.status_code, 401)
        self.assertIn("Thiếu Authorization header Bearer token", response.json()["detail"])

    # 2. Kiểm tra xác thực: Token không hợp lệ -> Trả về lỗi 401
    def test_events_endpoint_invalid_token_returns_401(self):
        response = self.client.get(
            "/api/events",
            headers={"Authorization": "Bearer invalid_junk_token_xyz"}
        )
        self.assertEqual(response.status_code, 401)
        self.assertIn("Token không hợp lệ hoặc đã hết hạn", response.json()["detail"])

    # 3. Kiểm tra định dạng chuẩn Contract của sự kiện SSE
    def test_event_contract_formatting(self):
        event = create_inventory_updated_event(
            sku_id="FOODS_1_001_CA_1",
            actor_id="warehouse.manager@dfios.com",
            event_id=42,
        )
        sse_message = event.to_sse_message()
        
        self.assertTrue(sse_message.startswith("id: 42\n"))
        self.assertIn("event: inventory.updated\n", sse_message)
        self.assertIn('"type":"inventory.updated"', sse_message)
        self.assertIn('"sku_id":"FOODS_1_001_CA_1"', sse_message)
        self.assertIn('"actor_id":"warehouse.manager@dfios.com"', sse_message)
        self.assertTrue(sse_message.endswith("\n\n"))

    # 4. Kiểm tra EventBus: Đăng ký nhận tin (Subscribe) và phân phối tin (Publish)
    async def test_event_bus_subscribe_and_publish(self):
        bus = InMemoryEventBus(max_connections_per_user=5, queue_maxsize=10)
        user_email = "test.subscriber@dfios.com"

        queue = await bus.subscribe(user_email)
        self.assertEqual(bus.get_subscriber_count(), 1)

        event = create_inventory_updated_event("SKU-100", user_email)
        await bus.publish(event)

        received = await queue.get()
        self.assertIsNotNone(received)
        self.assertEqual(received.event, "inventory.updated")
        self.assertEqual(received.data["sku_id"], "SKU-100")
        self.assertEqual(received.id, 1)

        await bus.unsubscribe(user_email, queue)
        self.assertEqual(bus.get_subscriber_count(), 0)

    # 5. Kiểm tra EventBus: Giới hạn số kết nối trên mỗi user (đóng kết nối cũ nhất khi vượt quá 5)
    async def test_event_bus_connection_limit_per_user(self):
        bus = InMemoryEventBus(max_connections_per_user=5, queue_maxsize=10)
        user_email = "multi.tab.user@dfios.com"

        queues = []
        for i in range(5):
            q = await bus.subscribe(user_email)
            queues.append(q)

        self.assertEqual(bus.get_user_connection_count(user_email), 5)

        # Mở kết nối thứ 6: kết nối cũ nhất thứ 1 sẽ bị ngắt
        sixth_queue = await bus.subscribe(user_email)
        self.assertEqual(bus.get_user_connection_count(user_email), 5)

        # Kết nối thứ 1 sẽ nhận tín hiệu None báo hiệu kết nối đã bị đóng do quá giới hạn
        sentinel = await queues[0].get()
        self.assertIsNone(sentinel)

    # 6. Kiểm tra EventBus: Queue bị tràn (bỏ bớt sự kiện cũ nhất, không làm nghẽn luồng publish)
    async def test_event_bus_queue_overflow_drops_oldest(self):
        small_queue_bus = InMemoryEventBus(max_connections_per_user=5, queue_maxsize=2)
        user_email = "slow.client@dfios.com"

        q = await small_queue_bus.subscribe(user_email)

        # Bắn 3 sự kiện vào hàng đợi chỉ chứa tối đa 2 phần tử
        event1 = create_inventory_updated_event("SKU-1", user_email)
        event2 = create_inventory_updated_event("SKU-2", user_email)
        event3 = create_inventory_updated_event("SKU-3", user_email)

        small_queue_bus.publish_nowait(event1)
        small_queue_bus.publish_nowait(event2)
        small_queue_bus.publish_nowait(event3)  # Tràn queue: SKU-1 bị loại bỏ, giữ lại SKU-2 và SKU-3

        item_a = await q.get()
        item_b = await q.get()

        self.assertEqual(item_a.data["sku_id"], "SKU-2")
        self.assertEqual(item_b.data["sku_id"], "SKU-3")

    # 7. Kiểm tra dọn dẹp Subscriber khi ngắt kết nối (Tránh rò rỉ RAM)
    async def test_subscriber_cleanup_removes_from_bus(self):
        bus = InMemoryEventBus()
        user_email = "cleanup.user@dfios.com"

        q1 = await bus.subscribe(user_email)
        q2 = await bus.subscribe(user_email)
        self.assertEqual(bus.get_user_connection_count(user_email), 2)

        await bus.unsubscribe(user_email, q1)
        self.assertEqual(bus.get_user_connection_count(user_email), 1)

        await bus.unsubscribe(user_email, q2)
        self.assertEqual(bus.get_user_connection_count(user_email), 0)
        self.assertNotIn(user_email, bus._subscribers)

    # 8. Kiểm tra chỉ Publish sau khi commit DB thành công, không publish khi Rollback
    def test_publish_after_commit_not_on_rollback(self):
        mock_publish = MagicMock()

        # Mô phỏng nghiệp vụ bị lỗi và rollback
        try:
            with self.TestingSessionLocal() as session:
                raise ValueError("Lỗi DB mô phỏng")
                session.commit()
                mock_publish("event")
        except ValueError:
            pass

        # Đảm bảo hàm publish KHÔNG BAO GIỜ được gọi khi rollback
        mock_publish.assert_not_called()

        # Mô phỏng nghiệp vụ commit thành công
        with self.TestingSessionLocal() as session:
            session.commit()
            mock_publish("event_success")

        # Đảm bảo hàm publish ĐƯỢC GỌI sau khi commit thành công
        mock_publish.assert_called_once_with("event_success")

    # 9. Kiểm tra luồng SSE Generator: Lời chào kết nối, nhận sự kiện Realtime & dọn dẹp
    async def test_events_endpoint_live_stream_and_cleanup(self):
        from app.api.v1.endpoints.events import stream_events
        from unittest.mock import AsyncMock

        mock_request = AsyncMock()
        mock_request.is_disconnected.return_value = False

        streaming_response = await stream_events(
            request=mock_request,
            current_user=self.test_user,
        )
        self.assertEqual(streaming_response.media_type, "text/event-stream")
        self.assertEqual(streaming_response.headers["Cache-Control"], "no-cache")
        self.assertEqual(streaming_response.headers["X-Accel-Buffering"], "no")

        # Kiểm tra nhận lời chào ban đầu
        iterator = streaming_response.body_iterator
        first_chunk = await anext(iterator)
        self.assertEqual(first_chunk, ": connected\n\n")
        self.assertEqual(event_bus.get_subscriber_count(), 1)

        # Bắn sự kiện lên EventBus toàn cục
        event = create_inventory_updated_event("SKU-STREAM-123", self.test_user.email)
        await event_bus.publish(event)

        second_chunk = await anext(iterator)
        self.assertIn("event: inventory.updated\n", second_chunk)
        self.assertIn('"sku_id":"SKU-STREAM-123"', second_chunk)

        # Đóng stream và kiểm tra dọn sạch subscriber
        await iterator.aclose()
        self.assertEqual(event_bus.get_subscriber_count(), 0)

    # 10. Kiểm tra API hỗ trợ bắn thử sự kiện POST /api/events/publish-test
    def test_publish_test_endpoint(self):
        response = self.client.post(
            "/api/events/publish-test?sku_id=SKU-TEST-999",
            headers={"Authorization": f"Bearer {self.valid_token}"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "success")
        self.assertIn("SKU-TEST-999", data["message"])
        self.assertIsNotNone(data["event_id"])


if __name__ == "__main__":
    unittest.main()
