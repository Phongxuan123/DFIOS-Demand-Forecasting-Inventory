from abc import ABC, abstractmethod
import email.mime.multipart
import email.mime.text
import logging
import smtplib
from typing import List, Dict, Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class BaseEmailSender(ABC):
    """
    Interface dịch vụ gửi email.
    Dễ dàng cắm các provider khác (SendGrid, SES, Resend) sau này.
    """
    @abstractmethod
    def send_email(self, to_email: str, subject: str, html_body: str, text_body: str) -> None:
        pass


class SmtpEmailSender(BaseEmailSender):
    """
    Triển khai gửi email qua giao thức SMTP (hỗ trợ Gmail SMTP với App Password).
    """
    def __init__(
        self,
        host: str = settings.SMTP_HOST,
        port: int = settings.SMTP_PORT,
        user: str = settings.SMTP_USER,
        password: str = settings.SMTP_PASSWORD,
        from_email: str = settings.EMAILS_FROM_EMAIL,
        from_name: str = settings.EMAILS_FROM_NAME,
        use_tls: bool = settings.EMAILS_USE_TLS,
    ):
        self.host = host
        self.port = port
        self.user = user
        self.password = password
        self.from_email = from_email
        self.from_name = from_name
        self.use_tls = use_tls

    def send_email(self, to_email: str, subject: str, html_body: str, text_body: str) -> None:
        try:
            msg = email.mime.multipart.MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"{self.from_name} <{self.from_email}>"
            msg["To"] = to_email

            part1 = email.mime.text.MIMEText(text_body, "plain", "utf-8")
            part2 = email.mime.text.MIMEText(html_body, "html", "utf-8")
            msg.attach(part1)
            msg.attach(part2)

            with smtplib.SMTP(self.host, self.port, timeout=15) as server:
                if self.use_tls:
                    server.starttls()
                if self.user and self.password:
                    server.login(self.user, self.password)
                server.sendmail(self.from_email, [to_email], msg.as_string())
            
            logger.info(f"Đã gửi email thành công tới {to_email} qua SMTP.")
        except Exception as e:
            logger.error(f"Lỗi khi gửi email tới {to_email}: {e}")


class MockEmailSender(BaseEmailSender):
    """
    Dịch vụ email giả lập (Mock) cho môi trường Dev/Test.
    Ghi thông tin ra log và lưu trong bộ nhớ để kiểm tra.
    """
    def __init__(self):
        self.sent_emails: List[Dict[str, Any]] = []

    def send_email(self, to_email: str, subject: str, html_body: str, text_body: str) -> None:
        record = {
            "to_email": to_email,
            "subject": subject,
            "html_body": html_body,
            "text_body": text_body,
        }
        self.sent_emails.append(record)
        logger.info(f"[MOCK EMAIL] Gửi tới: {to_email} | Tiêu đề: {subject}")


# Khởi tạo instance email sender phù hợp
if settings.SMTP_USER and settings.SMTP_PASSWORD:
    email_sender: BaseEmailSender = SmtpEmailSender()
else:
    email_sender: BaseEmailSender = MockEmailSender()


# ==========================================
# CÁC TEMPLATE EMAIL TIẾNG VIỆT
# ==========================================

def render_activation_email(to_email: str, token: str) -> tuple[str, str, str]:
    """
    Template kích hoạt tài khoản lần đầu (UC06).
    """
    link = f"{settings.FRONTEND_BASE_URL}/activate?token={token}"
    subject = "[DFIOS] Kích hoạt tài khoản và thiết lập mật khẩu"
    
    text_body = f"""Xin chào,

Tài khoản của bạn trên hệ thống DFIOS (Demand Forecasting & Inventory Optimization System) đã được quản trị viên tạo thành công.

Vui lòng truy cập liên kết dưới đây để kích hoạt tài khoản và thiết lập mật khẩu của bạn:
{link}

Liên kết này có hiệu lực trong vòng {settings.TOKEN_EXPIRE_ACTIVATE_HOURS} giờ.

Nếu bạn không yêu cầu tài khoản này, vui lòng bỏ qua email này.

Trân trọng,
Đội ngũ DFIOS
"""

    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #2563eb;">Chào mừng bạn đến với DFIOS</h2>
        <p>Tài khoản của bạn trên hệ thống <strong>DFIOS</strong> đã được quản trị viên tạo thành công.</p>
        <p>Vui lòng bấm vào nút bên dưới để kích hoạt tài khoản và đặt mật khẩu lần đầu:</p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="{link}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Kích hoạt tài khoản</a>
        </p>
        <p style="font-size: 13px; color: #666;">Hoặc copy liên kết sau vào trình duyệt: <br><a href="{link}">{link}</a></p>
        <p style="font-size: 13px; color: #ef4444;">Liên kết này có hiệu lực trong vòng <strong>{settings.TOKEN_EXPIRE_ACTIVATE_HOURS} giờ</strong>.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888;">Nếu bạn không yêu cầu tài khoản này, vui lòng bỏ qua email này.</p>
    </div>
    """
    return subject, html_body, text_body


def render_password_reset_email(to_email: str, token: str) -> tuple[str, str, str]:
    """
    Template đặt lại mật khẩu (UC03).
    """
    link = f"{settings.FRONTEND_BASE_URL}/reset-password?token={token}"
    subject = "[DFIOS] Yêu cầu đặt lại mật khẩu"

    text_body = f"""Xin chào,

Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản {to_email} trên hệ thống DFIOS.

Vui lòng truy cập liên kết dưới đây để tạo mật khẩu mới:
{link}

Liên kết này có hiệu lực trong vòng {settings.TOKEN_EXPIRE_RESET_PASSWORD_MINUTES} phút.

Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này. Tài khoản của bạn vẫn an toàn.

Trân trọng,
Đội ngũ DFIOS
"""

    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #2563eb;">Yêu cầu đặt lại mật khẩu</h2>
        <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản <strong>{to_email}</strong> trên hệ thống DFIOS.</p>
        <p>Vui lòng bấm vào nút bên dưới để tạo mật khẩu mới:</p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="{link}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Đặt lại mật khẩu</a>
        </p>
        <p style="font-size: 13px; color: #666;">Hoặc copy liên kết sau vào trình duyệt: <br><a href="{link}">{link}</a></p>
        <p style="font-size: 13px; color: #ef4444;">Liên kết này có hiệu lực trong vòng <strong>{settings.TOKEN_EXPIRE_RESET_PASSWORD_MINUTES} phút</strong>.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888;">Nếu bạn không gửi yêu cầu này, vui lòng bỏ qua email. Mật khẩu hiện tại của bạn sẽ không bị thay đổi.</p>
    </div>
    """
    return subject, html_body, text_body


def render_confirm_change_email(new_email: str, token: str) -> tuple[str, str, str]:
    """
    Template xác nhận đổi email gửi đến địa chỉ email MỚI (UC05).
    """
    link = f"{settings.FRONTEND_BASE_URL}/confirm-email?token={token}"
    subject = "[DFIOS] Xác nhận thay đổi địa chỉ email"

    text_body = f"""Xin chào,

Bạn đã yêu cầu đổi địa chỉ email tài khoản DFIOS sang {new_email}.

Vui lòng truy cập liên kết dưới đây để xác nhận thay đổi:
{link}

Liên kết này có hiệu lực trong vòng {settings.TOKEN_EXPIRE_CHANGE_EMAIL_HOURS} giờ.

Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.

Trân trọng,
Đội ngũ DFIOS
"""

    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #2563eb;">Xác nhận địa chỉ email mới</h2>
        <p>Bạn đã gửi yêu cầu thay đổi email liên hệ của tài khoản DFIOS sang <strong>{new_email}</strong>.</p>
        <p>Vui lòng bấm vào nút dưới đây để xác nhận:</p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="{link}" style="background-color: #10b981; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Xác nhận đổi email</a>
        </p>
        <p style="font-size: 13px; color: #666;">Hoặc copy liên kết sau vào trình duyệt: <br><a href="{link}">{link}</a></p>
        <p style="font-size: 13px; color: #ef4444;">Liên kết này có hiệu lực trong vòng <strong>{settings.TOKEN_EXPIRE_CHANGE_EMAIL_HOURS} giờ</strong>.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888;">Nếu không phải bạn yêu cầu, hãy bỏ qua email này.</p>
    </div>
    """
    return subject, html_body, text_body


def render_notify_old_email_changed(old_email: str, new_email: str) -> tuple[str, str, str]:
    """
    Template thông báo gửi đến địa chỉ email CŨ sau khi đổi email thành công.
    """
    subject = "[DFIOS] Cảnh báo bảo mật: Email tài khoản của bạn đã được thay đổi"

    text_body = f"""Xin chào,

Địa chỉ email cho tài khoản DFIOS của bạn ({old_email}) vừa được thay đổi thành công sang: {new_email}.

Nếu chính bạn đã thực hiện thao tác này, bạn không cần làm gì thêm.
Nếu bạn KHÔNG thực hiện thao tác này, tài khoản của bạn có thể đã bị xâm phạm. Vui lòng liên hệ ngay với Quản trị viên hệ thống để được hỗ trợ.

Trân trọng,
Đội ngũ DFIOS
"""

    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #ef4444;">Cảnh báo bảo mật tài khoản</h2>
        <p>Địa chỉ email liên hệ cho tài khoản DFIOS của bạn (<strong>{old_email}</strong>) vừa được thay đổi thành: <strong>{new_email}</strong>.</p>
        <p>Nếu bạn là người thực hiện, bạn có thể an tâm bỏ qua thông báo này.</p>
        <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; margin: 20px 0;">
            <p style="margin: 0; color: #991b1b; font-size: 14px;"><strong>Lưu ý:</strong> Nếu bạn KHÔNG thực hiện thao tác này, vui lòng liên hệ ngay với Quản trị viên để khóa tài khoản và bảo vệ dữ liệu.</p>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888;">Email này được gửi tự động từ hệ thống DFIOS.</p>
    </div>
    """
    return subject, html_body, text_body
