import json
import zoneinfo
from typing import Any, Dict, List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.schemas.system_setting import (
    SettingItem,
    SettingsListResponse,
    SettingUpdateRequest,
)
from app.repositories.system_setting_repository import system_setting_repository
from app.services.audit_service import audit_service


class SystemSettingService:
    """
    Dịch vụ quản trị cấu hình hệ thống chung (UC44 - System Administration).
    """

    def validate_setting(self, key: str, value: Any) -> None:
        """
        Xác thực kiểu dữ liệu và khoảng giá trị hợp lệ cho từng tham số hệ thống.
        """
        if key == "timezone":
            if not isinstance(value, str) or not value.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Múi giờ phải là chuỗi ký tự không được để trống.",
                )
            available = zoneinfo.available_timezones()
            if value.strip() not in available:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Múi giờ '{value}' không hợp lệ theo chuẩn IANA timezone (ví dụ: 'Asia/Ho_Chi_Minh', 'UTC').",
                )

        elif key == "currency":
            if not isinstance(value, str) or len(value.strip()) < 1 or len(value.strip()) > 10:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Đơn vị tiền tệ phải là chuỗi ký tự từ 1 đến 10 ký tự (ví dụ: 'USD', 'VND').",
                )

        elif key == "forecast_horizons":
            if not isinstance(value, list) or len(value) == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="forecast_horizons phải là danh sách chứa ít nhất một khoảng ngày dự báo.",
                )
            for h in value:
                if not isinstance(h, int) or isinstance(h, bool) or h <= 0:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Mỗi khoảng dự báo trong forecast_horizons phải là số nguyên dương (nhận được '{h}').",
                    )

        elif key == "default_alert_thresholds":
            if not isinstance(value, dict) or len(value) == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="default_alert_thresholds phải là một object chứa các tham số ngưỡng cảnh báo.",
                )
            # Kiểm tra critical_service_level nếu có
            if "critical_service_level" in value:
                csl = value["critical_service_level"]
                if not isinstance(csl, (int, float)) or csl < 0.5 or csl > 1.0:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="critical_service_level phải là số thực trong khoảng từ 0.5 đến 1.0 (ví dụ: 0.95).",
                    )
            # Kiểm tra lead_time_buffer_days nếu có
            if "lead_time_buffer_days" in value:
                ltb = value["lead_time_buffer_days"]
                if not isinstance(ltb, (int, float)) or ltb < 0:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="lead_time_buffer_days phải là số không âm (>= 0).",
                    )
            # Kiểm tra stockout_warning_ratio nếu có
            if "stockout_warning_ratio" in value:
                swr = value["stockout_warning_ratio"]
                if not isinstance(swr, (int, float)) or swr <= 0:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="stockout_warning_ratio phải là số dương (> 0).",
                    )

    def get_all_settings(self, db: Session) -> SettingsListResponse:
        records = system_setting_repository.get_all_settings(db)
        items = [SettingItem.model_validate(r) for r in records]
        settings_dict = {r.key: r.value for r in records}
        return SettingsListResponse(settings=items, settings_dict=settings_dict)

    def get_setting(self, db: Session, key: str) -> SettingItem:
        system_setting_repository.ensure_default_settings(db)
        setting = system_setting_repository.get_by_key(db, key)
        if not setting:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy tham số cấu hình hệ thống với key '{key}'.",
            )
        return SettingItem.model_validate(setting)

    def update_setting(
        self,
        db: Session,
        key: str,
        request: SettingUpdateRequest,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> SettingItem:
        # Xác thực tính hợp lệ của tham số
        self.validate_setting(key, request.value)

        # Lấy giá trị cũ phục vụ ghi audit log
        system_setting_repository.ensure_default_settings(db)
        existing = system_setting_repository.get_by_key(db, key)
        old_val_str = json.dumps(existing.value, ensure_ascii=False) if existing else "null"
        new_val_str = json.dumps(request.value, ensure_ascii=False)

        updated = system_setting_repository.upsert_setting(
            db, key=key, value=request.value, description=request.description
        )

        audit_service.log(
            db,
            action="settings.update",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Cập nhật cấu hình '{key}': cũ={old_val_str} -> mới={new_val_str}",
        )
        db.commit()

        return SettingItem.model_validate(updated)


system_setting_service = SystemSettingService()
