import uuid
from typing import List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.supplier import Supplier
from app.schemas.supplier import (
    SupplierCreate,
    SupplierUpdate,
    SupplierResponse,
    SupplierListResponse,
)
from app.repositories.supplier_repository import supplier_repository
from app.services.audit_service import audit_service


class SupplierService:
    """
    Dịch vụ quản lý nhà cung cấp và Lead Time (UC12).
    """

    def list_suppliers(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
    ) -> SupplierListResponse:
        items, total = supplier_repository.list_suppliers(
            db, skip=skip, limit=limit, search=search
        )
        return SupplierListResponse(
            items=[SupplierResponse.model_validate(s) for s in items],
            total=total,
            skip=skip,
            limit=limit,
        )

    def get_supplier(self, db: Session, id: str) -> SupplierResponse:
        sup = supplier_repository.get_by_id(db, id)
        if not sup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy nhà cung cấp có ID '{id}'",
            )
        return SupplierResponse.model_validate(sup)

    def create_supplier(
        self,
        db: Session,
        request: SupplierCreate,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> SupplierResponse:
        sup_id = request.id.strip() if request.id and request.id.strip() else str(uuid.uuid4())
        existing = supplier_repository.get_by_id(db, sup_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Nhà cung cấp có mã '{sup_id}' đã tồn tại trong hệ thống.",
            )

        new_sup = Supplier(
            id=sup_id,
            name=request.name.strip(),
            lead_time_days=request.lead_time_days,
        )
        saved = supplier_repository.create(db, new_sup)

        audit_service.log(
            db,
            action="supplier.create",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Tạo mới NCC '{saved.name}' (Lead time: {saved.lead_time_days} ngày)",
        )
        db.commit()
        return SupplierResponse.model_validate(saved)

    def update_supplier(
        self,
        db: Session,
        id: str,
        request: SupplierUpdate,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> SupplierResponse:
        sup = supplier_repository.get_by_id(db, id)
        if not sup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy nhà cung cấp có ID '{id}'",
            )

        if request.name is not None and request.name.strip():
            sup.name = request.name.strip()
        if request.lead_time_days is not None:
            sup.lead_time_days = request.lead_time_days

        db.commit()
        db.refresh(sup)

        audit_service.log(
            db,
            action="supplier.update",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Cập nhật NCC '{sup.name}' (ID: {id}, Lead time: {sup.lead_time_days} ngày)",
        )
        db.commit()
        return SupplierResponse.model_validate(sup)

    def delete_supplier(
        self,
        db: Session,
        id: str,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> None:
        sup = supplier_repository.get_by_id(db, id)
        if not sup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy nhà cung cấp có ID '{id}'",
            )

        supplier_repository.delete(db, id)

        audit_service.log(
            db,
            action="supplier.delete",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Xóa NCC '{sup.name}' (ID: {id})",
        )
        db.commit()


supplier_service = SupplierService()
