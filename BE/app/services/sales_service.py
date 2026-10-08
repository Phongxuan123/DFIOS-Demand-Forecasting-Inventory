import csv
import io
import uuid
from datetime import datetime, date
from typing import Optional
from fastapi import HTTPException, status, UploadFile
from sqlalchemy.orm import Session

from app.models.sales_history import SalesHistory
from app.schemas.sales import (
    SaleRecordCreate,
    SaleRecordResponse,
    SalesQueryResponse,
    SalesSummaryResponse,
    SalesImportResponse,
)
from app.repositories.sales_repository import sales_repository
from app.services.audit_service import audit_service


class SalesService:
    """
    Dịch vụ quản lý dữ liệu bán hàng lịch sử (Historical Sales Data - UC15).
    """

    def query_sales(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        item_id: Optional[str] = None,
        store_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> SalesQueryResponse:
        items, total, total_qty, avg_qty = sales_repository.list_sales(
            db,
            skip=skip,
            limit=limit,
            item_id=item_id,
            store_id=store_id,
            start_date=start_date,
            end_date=end_date,
        )
        return SalesQueryResponse(
            items=[SaleRecordResponse.model_validate(s) for s in items],
            total=total,
            skip=skip,
            limit=limit,
            total_quantity=round(total_qty, 2),
            average_quantity=round(avg_qty, 2),
        )

    def get_summary(
        self,
        db: Session,
        item_id: Optional[str] = None,
        store_id: Optional[str] = None,
    ) -> SalesSummaryResponse:
        total_count, min_date, max_date, total_qty = sales_repository.get_summary(
            db, item_id=item_id, store_id=store_id
        )
        return SalesSummaryResponse(
            item_id=item_id,
            store_id=store_id,
            total_records=total_count,
            min_date=min_date,
            max_date=max_date,
            total_quantity=round(total_qty, 2),
        )

    def create_sale(
        self,
        db: Session,
        request: SaleRecordCreate,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> SaleRecordResponse:
        record_id = f"{request.item_id}_{request.store_id}_{request.sale_date.isoformat()}"
        new_record = SalesHistory(
            id=record_id,
            item_id=request.item_id.strip(),
            store_id=request.store_id.strip(),
            sale_date=request.sale_date,
            quantity=request.quantity,
        )
        saved = sales_repository.create(db, new_record)

        audit_service.log(
            db,
            action="sales.create",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Thêm bản ghi bán hàng: SKU {request.item_id}, Kho {request.store_id}, Ngày {request.sale_date}, Số lượng {request.quantity}",
        )
        db.commit()
        return SaleRecordResponse.model_validate(saved)

    def import_csv_file(
        self,
        db: Session,
        file: UploadFile,
        admin_email: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> SalesImportResponse:
        """
        UC15: Import dữ liệu bán hàng lịch sử từ file CSV.
        Định dạng CSV yêu cầu các cột: item_id, store_id, sale_date (hoặc date), quantity
        """
        if not file.filename or not file.filename.lower().endswith(".csv"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tệp tải lên phải có định dạng CSV (.csv)",
            )

        try:
            content = file.file.read().decode("utf-8")
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Không thể đọc nội dung file. Vui lòng đảm bảo file được mã hóa định dạng UTF-8.",
            )

        csv_reader = csv.DictReader(io.StringIO(content))
        if not csv_reader.fieldnames:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File CSV rỗng hoặc không có tiêu đề cột.",
            )

        # Chuẩn hóa tên cột
        fieldnames = [f.strip().lower() for f in csv_reader.fieldnames]
        date_col = "sale_date" if "sale_date" in fieldnames else ("date" if "date" in fieldnames else None)

        if "item_id" not in fieldnames or "store_id" not in fieldnames or not date_col or "quantity" not in fieldnames:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cấu trúc file CSV không hợp lệ. Cần chứa các cột: item_id, store_id, sale_date (hoặc date), quantity.",
            )

        records_to_insert = []
        skipped_count = 0

        for row in csv_reader:
            try:
                item_id = row.get("item_id", "").strip()
                store_id = row.get("store_id", "").strip()
                raw_date = row.get(date_col, "").strip()
                raw_qty = row.get("quantity", "").strip()

                if not item_id or not store_id or not raw_date:
                    skipped_count += 1
                    continue

                parsed_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
                qty = float(raw_qty)

                rec_id = f"{item_id}_{store_id}_{parsed_date.isoformat()}"
                records_to_insert.append(
                    SalesHistory(
                        id=rec_id,
                        item_id=item_id,
                        store_id=store_id,
                        sale_date=parsed_date,
                        quantity=qty,
                    )
                )
            except Exception:
                skipped_count += 1

        if not records_to_insert:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Không có dòng dữ liệu hợp lệ nào được tìm thấy trong file CSV.",
            )

        inserted_count = sales_repository.bulk_insert(db, records_to_insert)

        audit_service.log(
            db,
            action="sales.import_csv",
            actor_email=admin_email,
            ip_address=ip_address,
            details=f"Import CSV bán hàng lịch sử: {inserted_count} dòng thành công, {skipped_count} dòng bỏ qua.",
        )
        db.commit()

        return SalesImportResponse(
            imported_count=inserted_count,
            skipped_count=skipped_count,
            message=f"Đã import thành công {inserted_count} bản ghi bán hàng lịch sử. Bỏ qua {skipped_count} dòng không hợp lệ.",
        )


sales_service = SalesService()
