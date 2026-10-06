from typing import List, Optional, Tuple
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.product import Product
from app.schemas.product import (
    ProductCreate,
    ProductUpdate,
    ProductResponse,
    ProductListResponse,
    ProductBulkCreateRequest,
    ProductBulkCreateResponse,
)
from app.repositories.product_repository import product_repository
from app.services.audit_service import audit_service


class ProductService:
    """
    Dịch vụ quản lý danh mục sản phẩm (SKU Master Data - UC11).
    """

    def list_products(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        search: Optional[str] = None,
        dept_id: Optional[str] = None,
        cat_id: Optional[str] = None,
    ) -> ProductListResponse:
        items, total = product_repository.list_products(
            db, skip=skip, limit=limit, search=search, dept_id=dept_id, cat_id=cat_id
        )
        return ProductListResponse(
            items=[ProductResponse.model_validate(p) for p in items],
            total=total,
            skip=skip,
            limit=limit,
        )

    def get_product(self, db: Session, item_id: str) -> ProductResponse:
        prod = product_repository.get_by_item_id(db, item_id)
        if not prod:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy sản phẩm có mã SKU '{item_id}'",
            )
        return ProductResponse.model_validate(prod)

    def create_product(
        self,
        db: Session,
        request: ProductCreate,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> ProductResponse:
        clean_item_id = request.item_id.strip()
        existing = product_repository.get_by_item_id(db, clean_item_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Sản phẩm có mã SKU '{clean_item_id}' đã tồn tại trong hệ thống.",
            )

        new_prod = Product(
            item_id=clean_item_id,
            name=request.name.strip(),
            dept_id=request.dept_id.strip() if request.dept_id else None,
            cat_id=request.cat_id.strip() if request.cat_id else None,
        )
        saved = product_repository.create(db, new_prod)

        audit_service.log(
            db,
            action="product.create",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Tạo mới sản phẩm SKU '{clean_item_id}' - {request.name}",
        )
        db.commit()
        return ProductResponse.model_validate(saved)

    def update_product(
        self,
        db: Session,
        item_id: str,
        request: ProductUpdate,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> ProductResponse:
        prod = product_repository.get_by_item_id(db, item_id)
        if not prod:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy sản phẩm có mã SKU '{item_id}'",
            )

        if request.name is not None and request.name.strip():
            prod.name = request.name.strip()
        if request.dept_id is not None:
            prod.dept_id = request.dept_id.strip() if request.dept_id else None
        if request.cat_id is not None:
            prod.cat_id = request.cat_id.strip() if request.cat_id else None

        db.commit()
        db.refresh(prod)

        audit_service.log(
            db,
            action="product.update",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Cập nhật thông tin sản phẩm SKU '{item_id}'",
        )
        db.commit()
        return ProductResponse.model_validate(prod)

    def delete_product(
        self,
        db: Session,
        item_id: str,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> None:
        prod = product_repository.get_by_item_id(db, item_id)
        if not prod:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy sản phẩm có mã SKU '{item_id}'",
            )

        product_repository.delete_by_item_id(db, item_id)

        audit_service.log(
            db,
            action="product.delete",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Xóa sản phẩm SKU '{item_id}'",
        )
        db.commit()

    def bulk_create(
        self,
        db: Session,
        request: ProductBulkCreateRequest,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> ProductBulkCreateResponse:
        inserted = 0
        skipped = 0
        for item in request.items:
            clean_item_id = item.item_id.strip()
            if product_repository.get_by_item_id(db, clean_item_id):
                skipped += 1
                continue
            new_prod = Product(
                item_id=clean_item_id,
                name=item.name.strip(),
                dept_id=item.dept_id.strip() if item.dept_id else None,
                cat_id=item.cat_id.strip() if item.cat_id else None,
            )
            db.add(new_prod)
            inserted += 1

        db.commit()

        audit_service.log(
            db,
            action="product.bulk_create",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Import danh mục sản phẩm: thêm mới {inserted}, bỏ qua {skipped}",
        )
        db.commit()

        return ProductBulkCreateResponse(
            inserted=inserted,
            skipped=skipped,
            message=f"Đã thêm thành công {inserted} sản phẩm, bỏ qua {skipped} sản phẩm trùng mã SKU.",
        )

    def get_categories(self, db: Session) -> List[str]:
        return product_repository.get_distinct_categories(db)

    def get_departments(self, db: Session) -> List[str]:
        return product_repository.get_distinct_departments(db)


product_service = ProductService()
