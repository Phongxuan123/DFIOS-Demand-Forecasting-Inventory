import unittest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.models.base import Base
from app.models.user import User
from app.models.email_token import EmailToken
from app.models.audit_log import AuditLog
from app.core.security import get_password_hash, create_access_token
from app.services.email_service import email_sender, MockEmailSender
from app.services.email_token_service import rate_limiter, email_token_service
from app.api.deps import get_db


class TestEmailVerificationAndAuthFlows(unittest.TestCase):
    def setUp(self):
        # Thiết lập SQLite In-Memory Database cho test
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

        # Sử dụng Mock Email Sender để test không gửi email thật và có thể kiểm tra danh sách đã gửi
        import app.services.email_service as email_mod
        from app.services.email_service import MockEmailSender
        self.mock_email = MockEmailSender()
        self._orig_email_sender = email_mod.email_sender
        email_mod.email_sender = self.mock_email

        # Xóa lịch sử rate limiter trong test
        rate_limiter._requests.clear()

        # Tạo sẵn tài khoản Admin và tài khoản User test
        with self.TestingSessionLocal() as session:
            self.admin = User(
                id="admin-01",
                email="admin@dfios.com",
                password_hash=get_password_hash("admin123"),
                role="Admin",
                display_name="System Admin",
                is_active=True,
                is_verified=True,
                token_version=1,
            )
            self.existing_user = User(
                id="user-01",
                email="sarah.jenkins@dfios.com",
                password_hash=get_password_hash("password123"),
                role="Warehouse Manager",
                display_name="Sarah Jenkins",
                is_active=True,
                is_verified=True,
                token_version=1,
            )
            self.second_user = User(
                id="user-02",
                email="occupied@dfios.com",
                password_hash=get_password_hash("password123"),
                role="Viewer",
                display_name="Occupied User",
                is_active=True,
                is_verified=True,
                token_version=1,
            )
            session.add_all([self.admin, self.existing_user, self.second_user])
            session.commit()

        self.admin_token = create_access_token(
            data={"sub": "admin@dfios.com", "role": "Admin", "user_id": "admin-01", "token_version": 1}
        )
        self.user_token = create_access_token(
            data={"sub": "sarah.jenkins@dfios.com", "role": "Warehouse Manager", "user_id": "user-01", "token_version": 1}
        )
        self.client = TestClient(app)

    def tearDown(self):
        import app.services.email_service as email_mod
        email_mod.email_sender = self._orig_email_sender
        Base.metadata.drop_all(bind=self.engine)
        app.dependency_overrides.clear()

    # 1. Admin tạo user: user chưa kích hoạt, gửi mail kích hoạt, đăng nhập trước kích hoạt bị 403
    def test_admin_create_user_and_activation_flow(self):
        create_res = self.client.post(
            "/api/v1/users",
            json={
                "email": "new.employee@dfios.com",
                "role": "Viewer",
                "display_name": "New Employee",
            },
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(create_res.status_code, 200)
        user_data = create_res.json()
        self.assertFalse(user_data["is_active"])
        self.assertFalse(user_data["is_verified"])

        # Kiểm tra email kích hoạt đã được gửi
        self.assertEqual(len(self.mock_email.sent_emails), 1)
        sent = self.mock_email.sent_emails[0]
        self.assertEqual(sent["to_email"], "new.employee@dfios.com")
        self.assertIn("Kích hoạt tài khoản", sent["subject"])
        self.assertIn("/activate?token=", sent["html_body"])

        # Trích xuất raw token từ link trong mail
        raw_token = sent["html_body"].split("/activate?token=")[1].split('"')[0]

        # Đăng nhập khi chưa kích hoạt -> Bị chặn 403
        login_fail = self.client.post(
            "/api/v1/auth/login",
            json={"email": "new.employee@dfios.com", "password": "anypassword"},
        )
        self.assertEqual(login_fail.status_code, 403)
        self.assertIn("chưa kích hoạt", login_fail.json()["detail"])

        # Kích hoạt tài khoản với token và thiết lập mật khẩu lần đầu
        act_res = self.client.post(
            "/api/v1/auth/activate",
            json={"token": raw_token, "password": "newSecurePassword123"},
        )
        self.assertEqual(act_res.status_code, 200)
        self.assertIn("thành công", act_res.json()["message"])

        # Đăng nhập thành công với mật khẩu vừa đặt
        login_success = self.client.post(
            "/api/v1/auth/login",
            json={"email": "new.employee@dfios.com", "password": "newSecurePassword123"},
        )
        self.assertEqual(login_success.status_code, 200)
        self.assertTrue(login_success.json()["user"]["is_active"])
        self.assertTrue(login_success.json()["user"]["is_verified"])

        # Dùng lại token lần 2 -> Bị từ chối (Token dùng 1 lần)
        act_reuse = self.client.post(
            "/api/v1/auth/activate",
            json={"token": raw_token, "password": "anotherPassword123"},
        )
        self.assertEqual(act_reuse.status_code, 400)
        self.assertEqual(act_reuse.json()["detail"], "Link không hợp lệ hoặc đã hết hạn")

    # 2. Token hết hạn hoặc sai mục đích (wrong purpose) đều trả thông báo chung
    def test_token_expiration_and_wrong_purpose_rejected(self):
        with self.TestingSessionLocal() as session:
            token_rec, raw_token = email_token_service.create_token(
                session, user_id="user-01", purpose="activate"
            )
            # Giả lập token đã hết hạn trong quá khứ
            token_rec.expires_at = datetime.now(timezone.utc) - timedelta(minutes=10)
            session.commit()

        # Token hết hạn -> Bị từ chối
        res = self.client.post(
            "/api/v1/auth/activate",
            json={"token": raw_token, "password": "pass123456"},
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["detail"], "Link không hợp lệ hoặc đã hết hạn")

        # Tạo token purpose=activate nhưng dùng ở endpoint reset_password -> Bị từ chối
        with self.TestingSessionLocal() as session:
            _, valid_act_token = email_token_service.create_token(
                session, user_id="user-01", purpose="activate"
            )
            session.commit()

        res_wrong = self.client.post(
            "/api/v1/auth/reset-password",
            json={"token": valid_act_token, "new_password": "pass123456"},
        )
        self.assertEqual(res_wrong.status_code, 400)
        self.assertEqual(res_wrong.json()["detail"], "Link không hợp lệ hoặc đã hết hạn")

    # 3. Forgot password: Phản hồi giống hệt nhau dù email tồn tại hay không; Reset password thu hồi JWT cũ
    def test_forgot_and_reset_password_revokes_jwt(self):
        # Email tồn tại
        res_exist = self.client.post(
            "/api/v1/auth/forgot-password",
            json={"email": "sarah.jenkins@dfios.com"},
        )
        self.assertEqual(res_exist.status_code, 200)

        # Email KHÔNG tồn tại
        res_non_exist = self.client.post(
            "/api/v1/auth/forgot-password",
            json={"email": "nonexistent.ghost@dfios.com"},
        )
        self.assertEqual(res_non_exist.status_code, 200)

        # Thông điệp trả về phải GIỐNG HỆT NHAU
        self.assertEqual(res_exist.json()["message"], res_non_exist.json()["message"])

        # Chỉ có 1 email được gửi đi (cho user tồn tại)
        self.assertEqual(len(self.mock_email.sent_emails), 1)
        sent = self.mock_email.sent_emails[0]
        self.assertEqual(sent["to_email"], "sarah.jenkins@dfios.com")
        raw_reset_token = sent["html_body"].split("/reset-password?token=")[1].split('"')[0]

        # Kiểm tra token cũ trước khi reset đang dùng được
        me_before = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )
        self.assertEqual(me_before.status_code, 200)

        # Thực hiện Reset Password
        reset_res = self.client.post(
            "/api/v1/auth/reset-password",
            json={"token": raw_reset_token, "new_password": "brandNewPassword123"},
        )
        self.assertEqual(reset_res.status_code, 200)

        # THU HỒI PHIÊN: Token cũ ngay lập tức bị từ chối 401
        me_after = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )
        self.assertEqual(me_after.status_code, 401)
        self.assertIn("thu hồi", me_after.json()["detail"])

        # Đăng nhập lại bằng mật khẩu mới thành công
        relogin = self.client.post(
            "/api/v1/auth/login",
            json={"email": "sarah.jenkins@dfios.com", "password": "brandNewPassword123"},
        )
        self.assertEqual(relogin.status_code, 200)

    # 4. Đổi email: Kiểm tra mật khẩu cũ, gửi link mail mới, confirm xong mới cập nhật và báo mail cũ
    def test_change_email_flow_and_collision(self):
        # Thử đổi sang email trùng với occupied@dfios.com -> Bị chặn
        dup_res = self.client.post(
            "/api/v1/auth/me/email",
            json={"new_email": "occupied@dfios.com", "current_password": "password123"},
            headers={"Authorization": f"Bearer {self.user_token}"},
        )
        self.assertEqual(dup_res.status_code, 400)
        self.assertIn("đã được sử dụng", dup_res.json()["detail"])

        # Thử đổi email nhưng sai mật khẩu hiện tại -> Bị chặn
        wrong_pwd = self.client.post(
            "/api/v1/auth/me/email",
            json={"new_email": "sarah.new@dfios.com", "current_password": "wrongpassword"},
            headers={"Authorization": f"Bearer {self.user_token}"},
        )
        self.assertEqual(wrong_pwd.status_code, 400)
        self.assertIn("không chính xác", wrong_pwd.json()["detail"])

        # Yêu cầu đổi sang email mới hợp lệ
        valid_req = self.client.post(
            "/api/v1/auth/me/email",
            json={"new_email": "sarah.new@dfios.com", "current_password": "password123"},
            headers={"Authorization": f"Bearer {self.user_token}"},
        )
        self.assertEqual(valid_req.status_code, 200)
        self.assertIn("sarah.new@dfios.com", valid_req.json()["message"])

        # Kiểm tra mail gửi tới email MỚI
        self.assertEqual(len(self.mock_email.sent_emails), 1)
        sent = self.mock_email.sent_emails[0]
        self.assertEqual(sent["to_email"], "sarah.new@dfios.com")
        self.assertIn("/confirm-email?token=", sent["html_body"])
        raw_change_token = sent["html_body"].split("/confirm-email?token=")[1].split('"')[0]

        # Kiểm tra DB: Email chưa đổi tại thời điểm này
        with self.TestingSessionLocal() as session:
            u = session.query(User).filter_by(id="user-01").first()
            self.assertEqual(u.email, "sarah.jenkins@dfios.com")

        # Xác nhận đổi email bằng link
        confirm_res = self.client.post(
            "/api/v1/auth/me/email/confirm",
            json={"token": raw_change_token},
        )
        self.assertEqual(confirm_res.status_code, 200)

        # Kiểm tra DB: Email ĐÃ ĐƯỢC ĐỔI sang sarah.new@dfios.com
        with self.TestingSessionLocal() as session:
            u = session.query(User).filter_by(id="user-01").first()
            self.assertEqual(u.email, "sarah.new@dfios.com")

        # Kiểm tra thông báo cảnh báo đã được gửi tới email CŨ
        self.assertEqual(len(self.mock_email.sent_emails), 2)
        sent_warning = self.mock_email.sent_emails[1]
        self.assertEqual(sent_warning["to_email"], "sarah.jenkins@dfios.com")
        self.assertIn("Cảnh báo bảo mật", sent_warning["subject"])

    # 5. Kiểm tra Rate Limiting: Vượt quá 5 lần / giờ trả về HTTP 429
    def test_rate_limiting_returns_429(self):
        target_email = "ratelimit.test@dfios.com"
        for _ in range(5):
            res = self.client.post(
                "/api/v1/auth/forgot-password",
                json={"email": target_email},
            )
            self.assertEqual(res.status_code, 200)

        # Lần thứ 6 vượt giới hạn -> 429 Too Many Requests
        rate_blocked = self.client.post(
            "/api/v1/auth/forgot-password",
            json={"email": target_email},
        )
        self.assertEqual(rate_blocked.status_code, 429)
        self.assertIn("quá nhiều lần", rate_blocked.json()["detail"])

    # 6. Kiểm tra Audit Logs (UC45) được ghi nhận đầy đủ
    def test_audit_logs_recorded(self):
        # Admin resend activation email
        resend = self.client.post(
            "/api/v1/users/user-01/resend-activation",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        # Vì user-01 đã active nên báo lỗi 400
        self.assertEqual(resend.status_code, 400)

        # Tạo user mới chưa active để test resend
        create_res = self.client.post(
            "/api/v1/users",
            json={"email": "audit.test@dfios.com", "role": "Viewer"},
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        user_id = create_res.json()["id"]

        # Gửi lại activation
        resend_ok = self.client.post(
            f"/api/v1/users/{user_id}/resend-activation",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(resend_ok.status_code, 200)

        # Kiểm tra bản ghi trong bảng audit_logs
        with self.TestingSessionLocal() as session:
            logs = session.query(AuditLog).all()
            actions = [log.action for log in logs]
            self.assertIn("admin.create_user", actions)
            self.assertIn("admin.resend_activation", actions)


if __name__ == "__main__":
    unittest.main()
