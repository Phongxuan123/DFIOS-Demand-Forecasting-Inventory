import csv
import io
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from fastapi import HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session

from app.models.replenishment import ReplenishmentRecommendation
from app.models.product import Product
from app.models.supplier import Supplier
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.schemas.inventory import InventoryUpdate
from app.schemas.replenishment import (
    ReplenishmentItemResponse,
    ReplenishmentListResponse,
    ReplenishmentAdjustRequest,
)
from app.repositories.replenishment_repository import replenishment_repository
from app.repositories.inventory_repository import inventory_repository
from app.repositories.inventory_param_repository import inventory_param_repository
from app.repositories.product_repository import product_repository
from app.repositories.supplier_repository import supplier_repository
from app.services.inventory_service import inventory_service
from app.services.optimization_service import optimization_service
from app.services.audit_service import audit_service


class ReplenishmentService:
    """
    Module G: Replenishment Recommendations (UC33 - UC38)
    Sinh, điều chỉnh, phê duyệt, từ chối và xuất báo cáo đề xuất đặt hàng bổ sung tồn kho.
    """

    def generate_recommendations(self, db: Session, store_id: str = "CA_1") -> int:
        """
        UC33 - Tự động sinh đề xuất đặt hàng khi On_hand + On_order <= ROP.
        Số lượng đề xuất = EOQ, gán mức ưu tiên (CRITICAL, HIGH, MEDIUM, LOW).
        Chống sinh trùng đề xuất PENDING cho cùng SKU/kho.
        """
        products = db.query(Product).all()
        if not products:
            return 0

        # Lấy supplier mặc định nếu có
        default_supplier = db.query(Supplier).first()
        default_supp_id = default_supplier.id if default_supplier else None

        generated_count = 0
        now = datetime.now(timezone.utc)

        for prod in products:
            item_id = prod.item_id

            # Kiểm tra xem SKU đã có đề xuất PENDING chưa (chống sinh trùng lặp)
            existing_pending = replenishment_repository.get_pending_by_sku_store(
                db, item_id=item_id, store_id=store_id
            )
            if existing_pending:
                continue

            # Lấy số liệu tồn kho
            inv = inventory_repository.get(db, item_id, store_id)
            on_hand = float(inv.on_hand) if inv else 0.0
            on_order = float(inv.on_order) if inv else 0.0

            # Lấy tham số tối ưu (ROP, SS, EOQ)
            param = inventory_param_repository.get_by_item_store(db, item_id, store_id)
            if not param:
                # Nếu chưa có, tính toán nhanh tham số cho SKU
                optimization_service.recompute_parameters(
                    db, store_id=store_id, item_id=item_id
                )
                param = inventory_param_repository.get_by_item_store(
                    db, item_id, store_id
                )

            rop = float(param.reorder_point) if param else 50.0
            safety_stock = float(param.safety_stock) if param else 20.0
            eoq = float(param.eoq) if param else 60.0

            # Điều kiện kích hoạt đề xuất: On_hand + On_order <= ROP
            if (on_hand + on_order) <= rop:
                # Xác định mức độ ưu tiên
                if on_hand <= 0:
                    priority = "CRITICAL"
                elif on_hand <= safety_stock:
                    priority = "HIGH"
                elif on_hand <= rop:
                    priority = "MEDIUM"
                else:
                    priority = "LOW"

                recommended_qty = max(1.0, round(eoq, 0))

                rec = ReplenishmentRecommendation(
                    id=str(uuid.uuid4()),
                    item_id=item_id,
                    store_id=store_id,
                    supplier_id=default_supp_id,
                    recommended_qty=recommended_qty,
                    final_qty=recommended_qty,
                    priority=priority,
                    status="PENDING",
                    reason="Hệ thống tự động sinh: Tồn kho hiện tại đạt điểm đặt hàng lại (ROP)",
                    decided_by=None,
                    created_at=now,
                    decided_at=None,
                )
                db.add(rec)
                generated_count += 1

        if generated_count > 0:
            db.commit()

        return generated_count

    def _build_response_item(
        self,
        db: Session,
        rec: ReplenishmentRecommendation,
        product_map: Dict[str, Any],
        supplier_map: Dict[str, Any],
        inv_map: Dict[Tuple[str, str], Any],
        param_map: Dict[Tuple[str, str], Any],
    ) -> ReplenishmentItemResponse:
        prod = product_map.get(rec.item_id)
        supp = supplier_map.get(rec.supplier_id) if rec.supplier_id else None
        inv = inv_map.get((rec.item_id, rec.store_id))
        param = param_map.get((rec.item_id, rec.store_id))

        return ReplenishmentItemResponse(
            id=rec.id,
            item_id=rec.item_id,
            store_id=rec.store_id,
            product_name=prod.name if prod else rec.item_id,
            category=prod.cat_id if prod else None,
            supplier_id=rec.supplier_id,
            supplier_name=supp.name if supp else None,
            on_hand=float(inv.on_hand) if inv else 0.0,
            on_order=float(inv.on_order) if inv else 0.0,
            rop=float(param.reorder_point) if param else 0.0,
            safety_stock=float(param.safety_stock) if param else 0.0,
            recommended_qty=rec.recommended_qty,
            final_qty=rec.final_qty,
            priority=rec.priority,
            status=rec.status,
            reason=rec.reason,
            decided_by=rec.decided_by,
            created_at=rec.created_at,
            decided_at=rec.decided_at,
        )

    def list_recommendations(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        store_id: Optional[str] = None,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        search: Optional[str] = None,
        item_id: Optional[str] = None,
        auto_generate: bool = True,
    ) -> ReplenishmentListResponse:
        """
        UC33 - Lấy danh sách đề xuất nhập hàng (có phân trang, tìm kiếm, lọc).
        Tự động sinh đề xuất nếu bảng chưa có bản ghi PENDING nào.
        """
        if auto_generate:
            total_pending = (
                db.query(ReplenishmentRecommendation)
                .filter(ReplenishmentRecommendation.status == "PENDING")
                .count()
            )
            if total_pending == 0:
                self.generate_recommendations(db, store_id=store_id or "CA_1")

        items, total = replenishment_repository.list_recommendations(
            db,
            skip=skip,
            limit=limit,
            store_id=store_id,
            status=status,
            priority=priority,
            search=search,
            item_id=item_id,
        )

        pending_count = (
            db.query(ReplenishmentRecommendation)
            .filter(ReplenishmentRecommendation.status == "PENDING")
            .count()
        )
        approved_count = (
            db.query(ReplenishmentRecommendation)
            .filter(ReplenishmentRecommendation.status == "APPROVED")
            .count()
        )

        # Batch lookup metadata để tối ưu truy vấn N+1
        product_map = {p.item_id: p for p in db.query(Product).all()}
        supplier_map = {s.id: s for s in db.query(Supplier).all()}
        inv_map = {(i.item_id, i.store_id): i for i in db.query(Inventory).all()}
        param_map = {
            (p.item_id, p.store_id): p for p in db.query(InventoryParam).all()
        }

        response_items = [
            self._build_response_item(
                db, it, product_map, supplier_map, inv_map, param_map
            )
            for it in items
        ]

        return ReplenishmentListResponse(
            items=response_items,
            total=total,
            skip=skip,
            limit=limit,
            pending_count=pending_count,
            approved_count=approved_count,
        )

    def adjust_quantity(
        self,
        db: Session,
        rec_id: str,
        request: ReplenishmentAdjustRequest,
        user_email: str,
        ip_address: Optional[str] = None,
    ) -> ReplenishmentRecommendation:
        """
        UC34 - Điều chỉnh số lượng đặt hàng đề xuất (Warehouse Manager / Admin).
        Bắt buộc lý do, chỉ được sửa khi đơn ở trạng thái PENDING.
        """
        rec = replenishment_repository.get(db, rec_id)
        if not rec:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy đề xuất nhập hàng với mã '{rec_id}'.",
            )

        if rec.status != "PENDING":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Chỉ được phép điều chỉnh đề xuất đang ở trạng thái 'PENDING' (Trạng thái hiện tại: {rec.status}).",
            )

        if not request.reason or len(request.reason.strip()) < 3:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Lý do điều chỉnh số lượng là bắt buộc (tối thiểu 3 ký tự).",
            )

        old_qty = rec.final_qty
        rec.final_qty = round(float(request.final_qty), 2)
        rec.reason = request.reason.strip()
        rec.decided_by = user_email

        replenishment_repository.update(db, rec)

        audit_service.log(
            db,
            action="replenishment.adjust",
            actor_email=user_email,
            ip_address=ip_address,
            details=f"Điều chỉnh số lượng đơn {rec_id} (SKU {rec.item_id}): cũ={old_qty} -> mới={rec.final_qty}. Lý do: {rec.reason}",
        )
        db.commit()

        return rec

    def approve_recommendation(
        self,
        db: Session,
        rec_id: str,
        user_email: str,
        ip_address: Optional[str] = None,
        background_tasks: Optional[BackgroundTasks] = None,
    ) -> ReplenishmentRecommendation:
        """
        UC35 - Phê duyệt đề xuất nhập hàng (PENDING -> APPROVED).
        Tự động tăng on_order tương ứng trong bảng inventory, kích hoạt SSE realtime.
        Không cho phép duyệt lần hai.
        """
        rec = replenishment_repository.get(db, rec_id)
        if not rec:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy đề xuất nhập hàng với mã '{rec_id}'.",
            )

        if rec.status == "APPROVED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Đề xuất này đã được phê duyệt trước đó, không thể phê duyệt lần 2.",
            )

        if rec.status != "PENDING":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Chỉ có thể phê duyệt đề xuất đang ở trạng thái 'PENDING' (Hiện tại: {rec.status}).",
            )

        # 1. Cập nhật trạng thái đề xuất
        rec.status = "APPROVED"
        rec.decided_by = user_email
        rec.decided_at = datetime.now(timezone.utc)
        replenishment_repository.update(db, rec)

        # 2. Tăng on_order trong bảng inventory thông qua inventory_service
        inv = inventory_repository.get(db, rec.item_id, rec.store_id)
        current_on_order = float(inv.on_order) if inv else 0.0
        new_on_order = current_on_order + rec.final_qty

        inventory_service.update_inventory(
            db=db,
            item_id=rec.item_id,
            store_id=rec.store_id,
            request=InventoryUpdate(
                on_order=new_on_order,
                reason=f"Phê duyệt đề xuất nhập hàng #{rec.id[:8]} (+{rec.final_qty})",
            ),
            background_tasks=background_tasks,
            user_email=user_email,
            ip_address=ip_address,
        )

        # 3. Ghi audit log
        audit_service.log(
            db,
            action="replenishment.approve",
            actor_email=user_email,
            ip_address=ip_address,
            details=f"Phê duyệt đề xuất nhập hàng {rec_id} cho SKU {rec.item_id}: số lượng duyệt={rec.final_qty}, on_order ({current_on_order} -> {new_on_order})",
        )
        db.commit()

        return rec

    def reject_recommendation(
        self,
        db: Session,
        rec_id: str,
        reason: Optional[str],
        user_email: str,
        ip_address: Optional[str] = None,
    ) -> ReplenishmentRecommendation:
        """
        UC36 - Từ chối đề xuất nhập hàng (PENDING -> REJECTED).
        Bắt buộc nhập lý do từ chối.
        """
        rec = replenishment_repository.get(db, rec_id)
        if not rec:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy đề xuất nhập hàng với mã '{rec_id}'.",
            )

        if rec.status != "PENDING":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Chỉ có thể từ chối đề xuất đang ở trạng thái 'PENDING' (Hiện tại: {rec.status}).",
            )

        if not reason or not reason.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Lý do từ chối đề xuất nhập hàng là bắt buộc.",
            )

        rec.status = "REJECTED"
        rec.reason = reason.strip()
        rec.decided_by = user_email
        rec.decided_at = datetime.now(timezone.utc)
        replenishment_repository.update(db, rec)

        audit_service.log(
            db,
            action="replenishment.reject",
            actor_email=user_email,
            ip_address=ip_address,
            details=f"Từ chối đề xuất nhập hàng {rec_id} cho SKU {rec.item_id}. Lý do: {rec.reason}",
        )
        db.commit()

        return rec

    def cancel_recommendation(
        self,
        db: Session,
        rec_id: str,
        reason: Optional[str],
        user_email: str,
        ip_address: Optional[str] = None,
        background_tasks: Optional[BackgroundTasks] = None,
    ) -> ReplenishmentRecommendation:
        """
        UC36 - Hủy đề xuất đã duyệt (APPROVED -> CANCELLED) và hoàn trả on_order.
        Bắt buộc nhập lý do hủy.
        """
        rec = replenishment_repository.get(db, rec_id)
        if not rec:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy đề xuất nhập hàng với mã '{rec_id}'.",
            )

        if rec.status != "APPROVED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Chỉ có thể hủy đơn đặt hàng đã ở trạng thái 'APPROVED' (Hiện tại: {rec.status}).",
            )

        if not reason or not reason.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Lý do hủy đơn đặt hàng là bắt buộc.",
            )

        # 1. Giảm lại on_order
        inv = inventory_repository.get(db, rec.item_id, rec.store_id)
        current_on_order = float(inv.on_order) if inv else 0.0
        reverted_on_order = max(0.0, current_on_order - rec.final_qty)

        inventory_service.update_inventory(
            db=db,
            item_id=rec.item_id,
            store_id=rec.store_id,
            request=InventoryUpdate(
                on_order=reverted_on_order,
                reason=f"Hủy đơn đặt hàng #{rec.id[:8]} (-{rec.final_qty}): {reason}",
            ),
            background_tasks=background_tasks,
            user_email=user_email,
            ip_address=ip_address,
        )

        # 2. Cập nhật trạng thái CANCELLED
        rec.status = "CANCELLED"
        rec.reason = f"Đã hủy: {reason.strip()}"
        rec.decided_by = user_email
        rec.decided_at = datetime.now(timezone.utc)
        replenishment_repository.update(db, rec)

        # 3. Ghi audit log
        audit_service.log(
            db,
            action="replenishment.cancel",
            actor_email=user_email,
            ip_address=ip_address,
            details=f"Hủy đơn đặt hàng đã duyệt {rec_id} cho SKU {rec.item_id}: hoàn trả on_order ({current_on_order} -> {reverted_on_order}). Lý do: {reason}",
        )
        db.commit()

        return rec

    def list_history(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        store_id: Optional[str] = None,
        item_id: Optional[str] = None,
        status: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> ReplenishmentListResponse:
        """
        UC37 - Xem lịch sử xử lý đề xuất nhập hàng (Viewer, Warehouse Manager, Admin).
        """
        items, total = replenishment_repository.list_history(
            db,
            skip=skip,
            limit=limit,
            store_id=store_id,
            item_id=item_id,
            status=status,
            start_date=start_date,
            end_date=end_date,
        )

        product_map = {p.item_id: p for p in db.query(Product).all()}
        supplier_map = {s.id: s for s in db.query(Supplier).all()}
        inv_map = {(i.item_id, i.store_id): i for i in db.query(Inventory).all()}
        param_map = {
            (p.item_id, p.store_id): p for p in db.query(InventoryParam).all()
        }

        response_items = [
            self._build_response_item(
                db, it, product_map, supplier_map, inv_map, param_map
            )
            for it in items
        ]

        return ReplenishmentListResponse(
            items=response_items,
            total=total,
            skip=skip,
            limit=limit,
            pending_count=0,
            approved_count=total,
        )

    def export_recommendations_csv(
        self,
        db: Session,
        store_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> str:
        """
        UC38 - Xuất danh sách đề xuất nhập hàng ra file CSV định dạng UTF-8 BOM.
        """
        items, _ = replenishment_repository.list_recommendations(
            db,
            skip=0,
            limit=10000,
            store_id=store_id,
            status=status,
        )

        product_map = {p.item_id: p for p in db.query(Product).all()}
        supplier_map = {s.id: s for s in db.query(Supplier).all()}
        inv_map = {(i.item_id, i.store_id): i for i in db.query(Inventory).all()}
        param_map = {
            (p.item_id, p.store_id): p for p in db.query(InventoryParam).all()
        }

        output = io.StringIO()
        # Thêm UTF-8 BOM để Excel hiển thị đúng dấu tiếng Việt
        output.write("\ufeff")
        writer = csv.writer(output)

        # Header
        writer.writerow([
            "Mã Đề Xuất",
            "Mã SKU",
            "Tên Sản Phẩm",
            "Ngành Hàng",
            "Kho/Cửa Hàng",
            "Nhà Cung Cấp",
            "Tồn Kho Hiện Tại (On-hand)",
            "Đang Đặt Hàng (On-order)",
            "Điểm Đặt Hàng Lại (ROP)",
            "Tồn Kho An Toàn (SS)",
            "SL Đề Xuất (EOQ)",
            "SL Đặt Hàng Thực Tế",
            "Mức Độ Ưu Tiên",
            "Trạng Thái",
            "Lý Do",
            "Người Xử Lý",
            "Ngày Tạo",
            "Ngày Phê Duyệt",
        ])

        for rec in items:
            prod = product_map.get(rec.item_id)
            supp = supplier_map.get(rec.supplier_id) if rec.supplier_id else None
            inv = inv_map.get((rec.item_id, rec.store_id))
            param = param_map.get((rec.item_id, rec.store_id))

            writer.writerow([
                rec.id,
                rec.item_id,
                prod.name if prod else rec.item_id,
                prod.cat_id if prod else "",
                rec.store_id,
                supp.name if supp else "",
                float(inv.on_hand) if inv else 0.0,
                float(inv.on_order) if inv else 0.0,
                float(param.reorder_point) if param else 0.0,
                float(param.safety_stock) if param else 0.0,
                rec.recommended_qty,
                rec.final_qty,
                rec.priority,
                rec.status,
                rec.reason or "",
                rec.decided_by or "",
                rec.created_at.strftime("%Y-%m-%d %H:%M:%S") if rec.created_at else "",
                rec.decided_at.strftime("%Y-%m-%d %H:%M:%S") if rec.decided_at else "",
            ])

        return output.getvalue()


replenishment_service = ReplenishmentService()
