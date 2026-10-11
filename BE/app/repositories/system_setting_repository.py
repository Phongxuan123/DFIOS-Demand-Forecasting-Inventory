from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.models.system_setting import SystemSetting
from app.repositories.base_repository import BaseRepository

DEFAULT_SYSTEM_SETTINGS = [
    {
        "key": "timezone",
        "value": "Asia/Ho_Chi_Minh",
        "description": "Múi giờ vận hành hệ thống",
    },
    {
        "key": "currency",
        "value": "USD",
        "description": "Đơn vị tiền tệ chính cho định giá và tính toán chi phí",
    },
    {
        "key": "default_alert_thresholds",
        "value": {
            "critical_service_level": 0.95,
            "lead_time_buffer_days": 2,
            "stockout_warning_ratio": 1.0,
        },
        "description": "Ngưỡng cảnh báo hết hàng và dịch vụ mặc định",
    },
    {
        "key": "forecast_horizons",
        "value": [7, 14, 28],
        "description": "Danh sách các khoảng dự báo nhu cầu mặc định (ngày)",
    },
]


class SystemSettingRepository(BaseRepository[SystemSetting]):
    def __init__(self):
        super().__init__(SystemSetting)

    def get_by_key(self, db: Session, key: str) -> Optional[SystemSetting]:
        return db.query(SystemSetting).filter(SystemSetting.key == key).first()

    def get_all_settings(self, db: Session) -> List[SystemSetting]:
        self.ensure_default_settings(db)
        return db.query(SystemSetting).order_by(SystemSetting.key.asc()).all()

    def ensure_default_settings(self, db: Session) -> None:
        """
        Đảm bảo các tham số cấu hình mặc định luôn có sẵn trong DB.
        """
        existing_keys = {row[0] for row in db.query(SystemSetting.key).all()}
        added = False
        for item in DEFAULT_SYSTEM_SETTINGS:
            if item["key"] not in existing_keys:
                setting = SystemSetting(
                    key=item["key"],
                    value=item["value"],
                    description=item["description"],
                    updated_at=datetime.now(timezone.utc),
                )
                db.add(setting)
                added = True
        if added:
            db.commit()

    def upsert_setting(
        self, db: Session, key: str, value: Any, description: Optional[str] = None
    ) -> SystemSetting:
        setting = self.get_by_key(db, key)
        if setting:
            setting.value = value
            if description is not None:
                setting.description = description
            setting.updated_at = datetime.now(timezone.utc)
        else:
            setting = SystemSetting(
                key=key,
                value=value,
                description=description,
                updated_at=datetime.now(timezone.utc),
            )
            db.add(setting)
        db.commit()
        db.refresh(setting)
        return setting


system_setting_repository = SystemSettingRepository()
