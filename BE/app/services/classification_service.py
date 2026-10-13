import json
import math
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.classification import SKUClassification
from app.models.product import Product
from app.models.sales_history import SalesHistory
from app.models.forecast import Forecast
from app.models.user import User
from app.schemas.classification import (
    ClassificationThresholds,
    ClassificationThresholdsUpdate,
    SegmentSummary,
    ClassificationMatrixResponse,
    SKUClassificationItem,
    SKUClassificationListResponse,
    RecommendationResponse,
    ClassificationRecomputeResponse,
)
from app.repositories.classification_repository import classification_repository
from app.repositories.product_repository import product_repository
from app.repositories.system_setting_repository import system_setting_repository
from app.services.audit_service import audit_service
from app.core.classification_rules import CLASSIFICATION_RECOMMENDATIONS


class ClassificationService:
    """
    Dịch vụ phân loại tồn kho ma trận ABC/XYZ (Module E — UC25 đến UC28).
    """

    SETTINGS_KEY = "abc_xyz_thresholds"

    def get_thresholds(self, db: Session) -> ClassificationThresholds:
        """
        UC25 - Lấy ngưỡng phân loại ABC/XYZ hiện tại từ cấu hình hệ thống.
        """
        setting = system_setting_repository.get_by_key(db, self.SETTINGS_KEY)
        if setting and isinstance(setting.value, dict):
            val = setting.value
            return ClassificationThresholds(
                a_cutoff=float(val.get("a_cutoff", 80.0)),
                b_cutoff=float(val.get("b_cutoff", 95.0)),
                c_cutoff=float(val.get("c_cutoff", 100.0)),
                cv_x=float(val.get("cv_x", 0.5)),
                cv_y=float(val.get("cv_y", 1.0)),
            )
        return ClassificationThresholds()

    def update_thresholds(
        self,
        db: Session,
        request: ClassificationThresholdsUpdate,
        current_user: User,
        ip_address: Optional[str] = None,
    ) -> ClassificationThresholds:
        """
        UC25 - Cập nhật ngưỡng phân loại ABC/XYZ (Admin only).
        Tự động kích hoạt tính lại phân loại toàn bộ SKU và ghi audit log.
        """
        old_thresholds = self.get_thresholds(db)
        old_val_str = json.dumps(old_thresholds.model_dump(), ensure_ascii=False)

        new_data = {
            "a_cutoff": request.a_cutoff,
            "b_cutoff": request.b_cutoff,
            "c_cutoff": 100.0,
            "cv_x": request.cv_x,
            "cv_y": request.cv_y,
        }
        new_val_str = json.dumps(new_data, ensure_ascii=False)

        system_setting_repository.upsert_setting(
            db,
            key=self.SETTINGS_KEY,
            value=new_data,
            description="Ngưỡng phân loại ma trận ABC/XYZ (Pareto doanh thu & hệ số biến động CV)",
        )

        audit_service.log(
            db,
            action="classification.update_thresholds",
            actor_email=current_user.email,
            ip_address=ip_address,
            details=f"Cập nhật ngưỡng ABC/XYZ: cũ={old_val_str} -> mới={new_val_str}",
        )
        db.commit()

        # Tính lại phân loại toàn bộ SKU sau khi đổi ngưỡng
        self.recompute_classification(db)

        return ClassificationThresholds(**new_data)

    def recompute_classification(self, db: Session) -> int:
        """
        Tính toán phân loại ABC (Pareto tích lũy doanh thu) và XYZ (CV = sigma / mu) cho toàn bộ SKU.
        """
        thresholds = self.get_thresholds(db)
        products = db.query(Product).all()
        if not products:
            return 0

        # Thu thập số liệu doanh thu và nhu cầu cho từng SKU
        sku_stats: List[Dict[str, Any]] = []

        for p in products:
            item_id = p.item_id

            # Lấy lịch sử bán hàng
            sales_rows = (
                db.query(SalesHistory.quantity)
                .filter(SalesHistory.item_id == item_id)
                .all()
            )

            if sales_rows:
                quantities = [float(r[0]) for r in sales_rows]
            else:
                # Nếu chưa có sales_history, fallback sang dự báo
                fc_rows = (
                    db.query(Forecast.y_pred)
                    .filter(Forecast.item_id == item_id)
                    .all()
                )
                quantities = [float(r[0]) for r in fc_rows] if fc_rows else [0.0]

            n = len(quantities)
            total_qty = sum(quantities)
            mean_d = total_qty / n if n > 0 else 0.0

            if n > 1 and mean_d > 0:
                variance = sum((q - mean_d) ** 2 for q in quantities) / (n - 1)
                std_d = math.sqrt(variance)
                cv_val = std_d / mean_d
            else:
                std_d = 0.0
                cv_val = 0.0

            # Giả định đơn giá tiêu chuẩn $10.0 cho sản lượng (hoặc tính theo tổng số lượng bán)
            revenue = round(total_qty * 10.0, 2)

            sku_stats.append({
                "item_id": item_id,
                "revenue": revenue,
                "mean_demand": mean_d,
                "std_demand": std_d,
                "cv": cv_val,
            })

        # Sắp xếp theo doanh thu giảm dần để xếp hạng Pareto ABC
        sku_stats.sort(key=lambda x: x["revenue"], reverse=True)
        total_revenue = sum(x["revenue"] for x in sku_stats)
        total_skus = len(sku_stats)

        accumulated_rev = 0.0
        db_records: List[SKUClassification] = []

        for idx, stat in enumerate(sku_stats):
            rev = stat["revenue"]
            if total_revenue > 0:
                rev_share = (rev / total_revenue) * 100.0
            else:
                rev_share = 100.0 / total_skus if total_skus > 0 else 0.0

            accumulated_rev += rev_share
            cum_share = min(accumulated_rev, 100.0)

            # Phân loại ABC theo ngưỡng tích lũy Pareto
            if cum_share <= thresholds.a_cutoff or idx == 0:
                abc = "A"
            elif cum_share <= thresholds.b_cutoff:
                abc = "B"
            else:
                abc = "C"

            # Phân loại XYZ theo hệ số biến động CV = sigma / mu
            cv_val = stat["cv"]
            if cv_val <= thresholds.cv_x:
                xyz = "X"
            elif cv_val <= thresholds.cv_y:
                xyz = "Y"
            else:
                xyz = "Z"

            segment = f"{abc}{xyz}"

            db_records.append(
                SKUClassification(
                    id=f"cls_{stat['item_id']}",
                    item_id=stat["item_id"],
                    abc_class=abc,
                    xyz_class=xyz,
                    segment=segment,
                    revenue=rev,
                    revenue_share=round(rev_share, 2),
                    cumulative_share=round(cum_share, 2),
                    mean_demand=round(stat["mean_demand"], 2),
                    std_demand=round(stat["std_demand"], 2),
                    cv=round(cv_val, 3),
                )
            )

        classification_repository.bulk_save(db, db_records)
        return len(db_records)

    def get_matrix(self, db: Session) -> ClassificationMatrixResponse:
        """
        UC26 - View ABC-XYZ Matrix:
        Xem ma trận 3x3 thể hiện số lượng và tỷ trọng SKU, doanh thu theo từng phân khúc.
        """
        if classification_repository.count(db) == 0:
            self.recompute_classification(db)

        thresholds = self.get_thresholds(db)
        agg_map = classification_repository.get_matrix_aggregation(db)

        all_segments = ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"]
        total_skus = sum(item["sku_count"] for item in agg_map.values())
        total_revenue = sum(item["revenue"] for item in agg_map.values())

        segments_list: List[SegmentSummary] = []
        matrix_dict: Dict[str, SegmentSummary] = {}

        for seg in all_segments:
            abc_part = seg[0]
            xyz_part = seg[1]

            if seg in agg_map:
                count = agg_map[seg]["sku_count"]
                rev = agg_map[seg]["revenue"]
            else:
                count = 0
                rev = 0.0

            sku_pct = round((count / total_skus) * 100.0, 2) if total_skus > 0 else 0.0
            rev_pct = round((rev / total_revenue) * 100.0, 2) if total_revenue > 0 else 0.0

            summary = SegmentSummary(
                segment=seg,
                abc=abc_part,
                xyz=xyz_part,
                sku_count=count,
                sku_percentage=sku_pct,
                revenue=round(rev, 2),
                revenue_percentage=rev_pct,
            )
            segments_list.append(summary)
            matrix_dict[seg] = summary

        latest_cls = db.query(SKUClassification.updated_at).order_by(SKUClassification.updated_at.desc()).first()
        last_updated = latest_cls[0] if latest_cls else datetime.now(timezone.utc)

        return ClassificationMatrixResponse(
            total_skus=total_skus,
            total_revenue=round(total_revenue, 2),
            segments=segments_list,
            matrix=matrix_dict,
            thresholds=thresholds,
            last_updated=last_updated,
        )

    def get_skus(
        self,
        db: Session,
        abc: Optional[str] = None,
        xyz: Optional[str] = None,
        segment: Optional[str] = None,
        search: Optional[str] = None,
        category: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
        sort_by: str = "revenue",
        order: str = "desc",
    ) -> SKUClassificationListResponse:
        """
        UC27 - Filter SKU by Segment:
        Xem danh sách SKU thuộc nhóm phân loại, hỗ trợ tìm kiếm và phân trang.
        """
        if classification_repository.count(db) == 0:
            self.recompute_classification(db)

        total, results = classification_repository.filter_skus(
            db,
            abc=abc,
            xyz=xyz,
            segment=segment,
            search=search,
            category=category,
            skip=skip,
            limit=limit,
            sort_by=sort_by,
            order=order,
        )

        items: List[SKUClassificationItem] = [
            SKUClassificationItem(
                id=c.id,
                item_id=c.item_id,
                product_name=p_name,
                category=p_cat,
                abc=c.abc_class,
                xyz=c.xyz_class,
                segment=c.segment,
                revenue=c.revenue,
                revenue_share=c.revenue_share,
                cumulative_share=c.cumulative_share,
                mean_demand=c.mean_demand,
                std_demand=c.std_demand,
                cv=c.cv,
                updated_at=c.updated_at,
            )
            for c, p_name, p_cat in results
        ]

        return SKUClassificationListResponse(
            items=items,
            total=total,
            skip=skip,
            limit=limit,
        )

    def get_recommendation_for_segment(self, segment: str) -> RecommendationResponse:
        """
        UC28 - Classification-based Recommendation:
        Lấy gợi ý chiến lược tồn kho tương ứng với một nhóm phân loại (Manager & Admin only).
        """
        seg_upper = segment.strip().upper()
        if seg_upper not in CLASSIFICATION_RECOMMENDATIONS:
            valid_segs = list(CLASSIFICATION_RECOMMENDATIONS.keys())
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Phân khúc '{segment}' không tồn tại. Các phân khúc hợp lệ: {valid_segs}.",
            )
        return RecommendationResponse.model_validate(CLASSIFICATION_RECOMMENDATIONS[seg_upper])

    def list_all_recommendations(self) -> List[RecommendationResponse]:
        """
        UC28 - Danh sách khuyến nghị chiến lược tồn kho cho toàn bộ 9 nhóm.
        """
        return [
            RecommendationResponse.model_validate(data)
            for data in CLASSIFICATION_RECOMMENDATIONS.values()
        ]


classification_service = ClassificationService()
