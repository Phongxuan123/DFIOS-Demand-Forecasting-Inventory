from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple, Dict, List
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import generate_secure_token, hash_token, verify_token_hash
from app.models.email_token import EmailToken


class InMemoryRateLimiter:
    """
    Bộ giới hạn tần suất yêu cầu (Rate Limiter) lưu trong bộ nhớ.
    Được thiết kế độc lập để dễ dàng thay thế bằng Redis RateLimiter khi mở rộng.
    """
    def __init__(self):
        self._requests: Dict[str, List[float]] = {}

    def is_rate_limited(self, key: str, max_requests: int = 5, window_seconds: int = 3600) -> bool:
        now = datetime.now(timezone.utc).timestamp()
        if key not in self._requests:
            self._requests[key] = []

        # Lọc bỏ các mốc thời gian đã quá window_seconds
        cutoff = now - window_seconds
        self._requests[key] = [t for t in self._requests[key] if t > cutoff]

        if len(self._requests[key]) >= max_requests:
            return True

        self._requests[key].append(now)
        return False


rate_limiter = InMemoryRateLimiter()


class EmailTokenService:
    """
    Dịch vụ quản lý vòng đời token xác thực email dùng chung cho 3 luồng:
    1. activate (Kích hoạt tài khoản)
    2. reset_password (Đặt lại mật khẩu)
    3. change_email (Đổi email liên hệ)
    """

    @staticmethod
    def get_token_lifetime(purpose: str) -> timedelta:
        if purpose == "activate":
            return timedelta(hours=settings.TOKEN_EXPIRE_ACTIVATE_HOURS)
        elif purpose == "reset_password":
            return timedelta(minutes=settings.TOKEN_EXPIRE_RESET_PASSWORD_MINUTES)
        elif purpose == "change_email":
            return timedelta(hours=settings.TOKEN_EXPIRE_CHANGE_EMAIL_HOURS)
        return timedelta(hours=24)

    @classmethod
    def create_token(
        cls,
        db: Session,
        user_id: str,
        purpose: str,
        new_email: Optional[str] = None,
    ) -> Tuple[EmailToken, str]:
        """
        Tạo token mới:
        - Vô hiệu hóa các token cũ chưa sử dụng có cùng (user_id, purpose).
        - Sinh token an toàn (raw_token).
        - CHỈ lưu SHA-256 hash của token vào DB.
        - Trả về tuple: (EmailToken model, raw_token thô để gửi mail).
        """
        now = datetime.now(timezone.utc)

        # Vô hiệu hóa các token cũ chưa sử dụng
        db.query(EmailToken).filter(
            EmailToken.user_id == user_id,
            EmailToken.purpose == purpose,
            EmailToken.used_at.is_(None),
        ).update({"used_at": now}, synchronize_session=False)

        raw_token = generate_secure_token()
        token_hash = hash_token(raw_token)
        expires_at = now + cls.get_token_lifetime(purpose)

        token_record = EmailToken(
            user_id=user_id,
            purpose=purpose,
            token_hash=token_hash,
            new_email=new_email.strip().lower() if new_email else None,
            expires_at=expires_at,
            created_at=now,
        )
        db.add(token_record)
        db.flush()

        return token_record, raw_token

    @classmethod
    def consume_token(
        cls,
        db: Session,
        raw_token: str,
        expected_purpose: str,
    ) -> EmailToken:
        """
        Tiêu thụ token một lần duy nhất (One-time use):
        - So khớp hash và kiểm tra tính toàn vẹn trong cùng transaction.
        - Kiểm tra thời hạn hiệu lực và trạng thái chưa sử dụng.
        - Set used_at = now ngay trong transaction để tránh race condition khi click link nhiều lần.
        - Mọi lỗi (sai token, hết hạn, đã dùng, sai purpose) đều trả thông báo chung:
          'Link không hợp lệ hoặc đã hết hạn'.
        """
        generic_error_message = "Link không hợp lệ hoặc đã hết hạn"

        if not raw_token or not raw_token.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=generic_error_message,
            )

        token_hash = hash_token(raw_token.strip())

        token_record = db.query(EmailToken).filter(
            EmailToken.token_hash == token_hash,
            EmailToken.purpose == expected_purpose,
        ).first()

        if not token_record:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=generic_error_message,
            )

        # Kiểm tra token đã từng được sử dụng chưa
        if token_record.used_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=generic_error_message,
            )

        # So khớp hash an toàn
        if not verify_token_hash(raw_token.strip(), token_record.token_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=generic_error_message,
            )

        # Kiểm tra hạn sử dụng
        now = datetime.now(timezone.utc)
        # Chuẩn hóa múi giờ so sánh
        expires_at = token_record.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if expires_at < now:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=generic_error_message,
            )

        # Đánh dấu đã sử dụng (atomic update)
        token_record.used_at = now
        db.flush()

        return token_record

    @classmethod
    def cleanup_expired_tokens(cls, db: Session, days_threshold: int = 7) -> int:
        """
        Xóa dọn dẹp các token đã hết hạn quá số ngày quy định.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=days_threshold)
        deleted_count = db.query(EmailToken).filter(
            EmailToken.expires_at < cutoff
        ).delete(synchronize_session=False)
        db.commit()
        return deleted_count


email_token_service = EmailTokenService()
