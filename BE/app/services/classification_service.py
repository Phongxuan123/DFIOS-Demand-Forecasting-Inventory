import json
import math
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.classification import CLASS_SOURCE_GROUND_TRUTH, CLASS_SOURCE_LEGACY, SKUClassification
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
)
from app.repositories.classification_repository import classification_repository
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

        # Tính lại phân loại sau khi đổi ngưỡng cho mọi kho đang có phân lớp (từng kho một, P-10)
        stores = classification_repository.list_stores(db) or [self.DEFAULT_STORE_ID]
        for sid in stores:
            self.recompute_classification(db, store_id=sid)

        return ClassificationThresholds(**new_data)

    DEFAULT_STORE_ID = "CA_1"
    VALID_SEGMENTS = {"AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"}

    @staticmethod
    def _ground_truth_file() -> Optional[str]:
        """Path of c3ok_sku_class.csv on this machine, or None when the artifact is not installed."""
        import os
        from app.core.config import settings

        cur_dir = os.path.dirname(os.path.abspath(__file__))
        be_dir = os.path.abspath(os.path.join(cur_dir, "..", ".."))
        paths = [
            os.path.join(be_dir, "MODEL", "c3ok_sku_class.csv"),
            os.path.join(be_dir, "scripts", "c3ok_sku_class.csv"),
        ]
        if settings.ARTIFACTS_DIR:
            paths.insert(0, os.path.join(settings.ARTIFACTS_DIR, "c3ok_sku_class.csv"))
        return next((p for p in paths if os.path.exists(p)), None)

    def _load_ground_truth_classes(self, store_id: Optional[str] = "CA_1") -> Dict[str, str]:
        """
        Nạp ánh xạ phân lớp C3-OUT cố định theo item x store từ c3ok_sku_class.csv (chuẩn A5 research.md).
        Trả về {} khi không có file hoặc kho không có trong file (khi đó dùng ngưỡng UC25).
        File hỏng định dạng thì báo lỗi rõ ràng thay vì âm thầm bỏ qua.
        """
        import pandas as pd

        class_file = self._ground_truth_file()
        if not class_file:
            return {}

        df = pd.read_csv(class_file)
        if "id" not in df.columns or "class" not in df.columns:
            raise ValueError(f"{class_file}: thiếu cột 'id' hoặc 'class'")
        target_store = store_id or self.DEFAULT_STORE_ID
        df_store = df[df["id"].astype(str).str.contains(f"_{target_store}_", regex=False)]
        if df_store.empty:
            return {}
        item_ids = df_store["id"].astype(str).str.split("_").str[:3].str.join("_")
        classes = df_store["class"].astype(str).str.strip().str.upper()
        return {i: c for i, c in zip(item_ids, classes) if c in self.VALID_SEGMENTS}

    def verify_ground_truth_labels(self, db: Session) -> Optional[int]:
        """
        Q-15: every row labelled ``class_source = "ground_truth"`` must match the C3-OUT mapping
        (c3ok_sku_class.csv) of its store. Rows that do not match - or every such row of a store absent from the
        mapping - are relabelled ``legacy_unverified`` (their class is kept, only the claim is withdrawn).
        Returns the number of relabelled rows, or None when the mapping file is not installed on this machine:
        R5B-04 - nothing is changed then, so a teammate without the artifacts cannot withdraw every label of a
        shared database; the check runs again on a machine that has the file.
        """
        if not self._ground_truth_file():
            return None
        stores = [r[0] for r in db.query(SKUClassification.store_id)
                  .filter(SKUClassification.class_source == CLASS_SOURCE_GROUND_TRUTH).distinct().all()]
        relabelled = 0
        for store in stores:
            try:
                gt = self._load_ground_truth_classes(store_id=store)
            except (OSError, ValueError):
                gt = {}
            rows = db.query(SKUClassification.id, SKUClassification.item_id, SKUClassification.segment).filter(
                SKUClassification.store_id == store, SKUClassification.class_source == CLASS_SOURCE_GROUND_TRUTH).all()
            bad = [rid for rid, iid, seg in rows if gt.get(iid) != seg]
            for k in range(0, len(bad), 900):
                db.query(SKUClassification).filter(SKUClassification.id.in_(bad[k:k + 900])).update(
                    {SKUClassification.class_source: CLASS_SOURCE_LEGACY}, synchronize_session=False)
            relabelled += len(bad)
        db.commit()
        return relabelled

    def _demand_stats(self, db: Session, store_id: Optional[str]) -> Dict[str, Tuple[int, float, float]]:
        """
        Gom (n, tổng, tổng bình phương) nhu cầu theo SKU bằng 2 truy vấn tổng hợp
        (thay cho 1 truy vấn / SKU). Ưu tiên sales_history; SKU chưa có lịch sử bán thì dùng
        dự báo hiệu dụng (đã áp override, B-01).
        """
        sales_q = db.query(
            SalesHistory.item_id,
            func.count(SalesHistory.quantity),
            func.sum(SalesHistory.quantity),
            func.sum(SalesHistory.quantity * SalesHistory.quantity),
        )
        if store_id:
            sales_q = sales_q.filter(SalesHistory.store_id == store_id)
        stats: Dict[str, Tuple[int, float, float]] = {
            r[0]: (int(r[1] or 0), float(r[2] or 0.0), float(r[3] or 0.0))
            for r in sales_q.group_by(SalesHistory.item_id).all()
        }

        from app.models.forecast import ForecastOverride
        eff = func.coalesce(ForecastOverride.override_value, Forecast.y_pred)
        fc_q = (
            db.query(Forecast.item_id, func.count(eff), func.sum(eff), func.sum(eff * eff))
            .select_from(Forecast)
            .outerjoin(
                ForecastOverride,
                (ForecastOverride.item_id == Forecast.item_id)
                & (ForecastOverride.store_id == Forecast.store_id)
                & (ForecastOverride.forecast_date == Forecast.forecast_date)
                & (ForecastOverride.is_active.is_(True)),
            )
        )
        if store_id:
            fc_q = fc_q.filter(Forecast.store_id == store_id)
        for r in fc_q.group_by(Forecast.item_id).all():
            if r[0] not in stats:
                stats[r[0]] = (int(r[1] or 0), float(r[2] or 0.0), float(r[3] or 0.0))
        return stats

    def resolve_store_id(self, db: Session, store_id: Optional[str] = None) -> str:
        """Kho dùng cho các endpoint đọc khi client không truyền store_id (tương thích ngược)."""
        if store_id and store_id.strip():
            return store_id.strip()
        stores = classification_repository.list_stores(db)
        if stores and self.DEFAULT_STORE_ID not in stores:
            return stores[0]
        return self.DEFAULT_STORE_ID

    @staticmethod
    def threshold_segment(cum_share: float, cv: float, is_top: bool, thresholds: ClassificationThresholds) -> str:
        """UC25 threshold class (ABC by cumulative revenue share, XYZ by CV) for one SKU."""
        if cum_share <= thresholds.a_cutoff or is_top:
            abc = "A"
        elif cum_share <= thresholds.b_cutoff:
            abc = "B"
        else:
            abc = "C"
        if cv <= thresholds.cv_x:
            xyz = "X"
        elif cv <= thresholds.cv_y:
            xyz = "Y"
        else:
            xyz = "Z"
        return f"{abc}{xyz}"

    def recompute_classification(
        self,
        db: Session,
        store_id: Optional[str] = "CA_1",
        source: str = "auto",
    ) -> int:
        """
        R-12 / P-10: tính phân loại ABC (Pareto tích lũy doanh thu) và XYZ (CV = sigma / mu) cho MỘT kho.
        - Chỉ thay thế các dòng của kho đó; kho khác giữ nguyên.
        - Lớp theo ngưỡng UC25 luôn được tính và lưu ở `threshold_segment`.
        - `source="auto"` (mặc định): SKU có trong ánh xạ C3-OUT ground truth (A5) dùng lớp ground truth
          (`class_source="ground_truth"`), còn lại dùng ngưỡng (`class_source="thresholds"`).
        - `source="thresholds"`: bỏ qua ground truth, lớp hiệu lực = lớp theo ngưỡng UC25.
        - Nhu cầu gián đoạn/ít bán được gán CV = 2.0 (vào lớp Z, tuyệt đối không rơi vào X).
        """
        if source not in ("auto", "thresholds"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="source phải là 'auto' hoặc 'thresholds'",
            )
        store_id = (store_id or self.DEFAULT_STORE_ID).strip() or self.DEFAULT_STORE_ID
        thresholds = self.get_thresholds(db)
        products = db.query(Product.item_id, Product.price).all()
        if not products:
            return 0

        demand = self._demand_stats(db, store_id)
        if demand:  # Q-12: only the SKUs this store actually sells (partial assortments); legacy: all if no sales yet
            products = [p for p in products if p[0] in demand]
            if not products:
                return 0
        sku_stats: List[Dict[str, Any]] = []
        for item_id, price in products:
            n, total_qty, sum_sq = demand.get(item_id, (1, 0.0, 0.0))
            mean_d = total_qty / n if n > 0 else 0.0
            if n > 1 and mean_d > 0.05:
                variance = max(0.0, (sum_sq - n * mean_d * mean_d) / (n - 1))
                std_d = math.sqrt(variance)
                cv_val = std_d / mean_d
            else:
                std_d = 0.0
                # SKU ít bán / cầu gián đoạn (intermittent/lumpy) thuộc nhóm bất định cao Z
                cv_val = 2.0
            unit_price = float(price) if price and float(price) > 0 else 1.0
            sku_stats.append({
                "item_id": item_id,
                "revenue": round(total_qty * unit_price, 2),
                "mean_demand": mean_d,
                "std_demand": std_d,
                "cv": cv_val,
            })

        # Sắp xếp theo doanh thu giảm dần để xếp hạng Pareto ABC (item_id làm khóa phụ cho kết quả ổn định)
        sku_stats.sort(key=lambda x: (-x["revenue"], x["item_id"]))
        total_revenue = sum(x["revenue"] for x in sku_stats)
        total_skus = len(sku_stats)

        c3_map = self._load_ground_truth_classes(store_id=store_id) if source == "auto" else {}

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

            # Lớp theo ngưỡng UC25 – luôn tính
            threshold_segment = self.threshold_segment(cum_share, stat["cv"], idx == 0, thresholds)

            item_id = stat["item_id"]
            if item_id in c3_map:
                segment = c3_map[item_id]
                class_source = "ground_truth"
            else:
                segment = threshold_segment
                class_source = "thresholds"

            db_records.append(
                SKUClassification(
                    id=f"{item_id}_{store_id}",
                    item_id=item_id,
                    store_id=store_id,
                    abc_class=segment[0],
                    xyz_class=segment[1],
                    segment=segment,
                    class_source=class_source,
                    threshold_segment=threshold_segment,
                    revenue=rev,
                    revenue_share=round(rev_share, 2),
                    cumulative_share=round(cum_share, 2),
                    mean_demand=round(stat["mean_demand"], 2),
                    std_demand=round(stat["std_demand"], 2),
                    cv=round(stat["cv"], 3),
                )
            )

        classification_repository.bulk_save(db, db_records, store_id=store_id)
        return len(db_records)

    def get_source_summary(self, db: Session, store_id: str) -> Dict[str, int]:
        q = db.query(SKUClassification.class_source, func.count(SKUClassification.id))
        if store_id.upper() not in ("GLOBAL", "ALL"):
            q = q.filter(SKUClassification.store_id == store_id)
        rows = q.group_by(SKUClassification.class_source).all()
        summary = {"ground_truth": 0, "thresholds": 0}
        for src, cnt in rows:
            summary[src or "thresholds"] = summary.get(src or "thresholds", 0) + int(cnt)
        return summary

    def get_matrix(self, db: Session, store_id: Optional[str] = None) -> ClassificationMatrixResponse:
        """
        UC26 - View ABC-XYZ Matrix:
        Xem ma trận 3x3 thể hiện số lượng và tỷ trọng SKU, doanh thu theo từng phân khúc.
        """
        store_id = self.resolve_store_id(db, store_id)
        # Q-13: GLOBAL / ALL = every real store (SKU-store pairs); never "recompute" a pseudo store
        is_global = store_id.upper() in ("GLOBAL", "ALL")
        if not is_global and classification_repository.count(db, store_id=store_id) == 0:
            self.recompute_classification(db, store_id=store_id)

        thresholds = self.get_thresholds(db)
        agg_map = classification_repository.get_matrix_aggregation(db, store_id=None if is_global else store_id)

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

        latest_q = db.query(SKUClassification.updated_at)
        if not is_global:
            latest_q = latest_q.filter(SKUClassification.store_id == store_id)
        latest_cls = latest_q.order_by(SKUClassification.updated_at.desc()).first()
        if latest_cls and latest_cls[0]:
            last_updated = latest_cls[0] if latest_cls[0].tzinfo else latest_cls[0].replace(tzinfo=timezone.utc)
        else:
            last_updated = datetime.now(timezone.utc)

        return ClassificationMatrixResponse(
            total_skus=total_skus,
            total_revenue=round(total_revenue, 2),
            segments=segments_list,
            matrix=matrix_dict,
            thresholds=thresholds,
            last_updated=last_updated,
            store_id=store_id,
            class_sources=self.get_source_summary(db, store_id),
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
        store_id: Optional[str] = None,
    ) -> SKUClassificationListResponse:
        """
        UC27 - Filter SKU by Segment:
        Xem danh sách SKU thuộc nhóm phân loại, hỗ trợ tìm kiếm và phân trang.
        """
        store_id = self.resolve_store_id(db, store_id)
        if classification_repository.count(db, store_id=store_id) == 0:
            self.recompute_classification(db, store_id=store_id)

        total, results = classification_repository.filter_skus(
            db,
            store_id=store_id,
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
                store_id=c.store_id,
                class_source=c.class_source,
                threshold_segment=c.threshold_segment,
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
