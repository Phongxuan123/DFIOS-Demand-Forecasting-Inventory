import math
from datetime import date
from typing import Dict, List, Optional, Tuple
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.data_quality import DataQualityRun
from app.models.sales_history import SalesHistory
from app.models.product import Product
from app.schemas.data_quality import (
    DataQualityRunRequest,
    DataQualityRunResponse,
    DataQualityIssue,
    DataQualitySummary,
    DataQualityRunListResponse,
)
from app.repositories.data_quality_repository import data_quality_repository
from app.services.audit_service import audit_service


class DataQualityService:
    """
    Dịch vụ kiểm tra chất lượng dữ liệu và phòng chống rò rỉ dữ liệu ML (UC46).
    """

    def run_check(
        self,
        db: Session,
        request: DataQualityRunRequest,
        admin_email: Optional[str] = None,
    ) -> DataQualityRunResponse:
        # B-02: Tối ưu hóa bộ nhớ (RAM Exhaustion Prevention) bằng các hàm tổng hợp SQL trực tiếp:
        # Xây dựng bộ lọc cơ sở cho SalesHistory
        base_filters = []
        if request.item_ids:
            base_filters.append(SalesHistory.item_id.in_(request.item_ids))
        if request.store_id:
            base_filters.append(SalesHistory.store_id == request.store_id)

        # 1. Đếm tổng số bản ghi và kiểm tra rỗng qua func.count (không nạp toàn bộ vào RAM)
        total_records = db.query(func.count(SalesHistory.id)).filter(*base_filters).scalar() or 0

        issues: List[DataQualityIssue] = []
        summary = DataQualitySummary()
        summary.total_records = total_records

        if total_records == 0:
            issues.append(
                DataQualityIssue(
                    check_type="EMPTY_DATA",
                    severity="CRITICAL",
                    message="Không tìm thấy bản ghi bán hàng lịch sử nào trong bảng sales_history để kiểm tra.",
                )
            )
            run = DataQualityRun(
                triggered_by=admin_email,
                status="FAILED",
                passed=False,
                summary=summary.model_dump(),
                issues=[i.model_dump() for i in issues],
            )
            saved = data_quality_repository.create(db, run)
            self._log_audit(db, admin_email, "FAILED", False, len(issues))
            return self._to_response(saved)

        # 2. Kiểm tra SKU không tồn tại trong Product Master (A) bằng SQL outerjoin
        unknown_skus_query = (
            db.query(SalesHistory.item_id, SalesHistory.store_id)
            .outerjoin(Product, SalesHistory.item_id == Product.item_id)
            .filter(*base_filters, Product.item_id.is_(None))
            .distinct()
        )
        unknown_skus = unknown_skus_query.all()
        summary.invalid_sku_count = len(unknown_skus)
        for item_id, store_id in unknown_skus[:50]:
            issues.append(
                DataQualityIssue(
                    check_type="UNKNOWN_SKU",
                    item_id=item_id,
                    store_id=store_id,
                    severity="CRITICAL",
                    message=f"SKU '{item_id}' không tồn tại trong danh mục sản phẩm (Product Master).",
                )
            )

        # 3. Kiểm tra số lượng bán âm (B) qua truy vấn có điều kiện
        neg_query = (
            db.query(
                SalesHistory.item_id,
                SalesHistory.store_id,
                SalesHistory.sale_date,
                SalesHistory.quantity,
            )
            .filter(*base_filters, SalesHistory.quantity < 0)
        )
        summary.negative_values_count = neg_query.count()
        for r in neg_query.limit(50).all():
            issues.append(
                DataQualityIssue(
                    check_type="NEGATIVE_VALUE",
                    item_id=r.item_id,
                    store_id=r.store_id,
                    severity="CRITICAL",
                    message=f"Số lượng bán âm: {r.quantity} vào ngày {r.sale_date}.",
                    metric_value=float(r.quantity),
                )
            )

        # 4. Kiểm tra trùng lặp ngày bán hàng (C) qua GROUP BY HAVING count > 1
        dup_query = (
            db.query(
                SalesHistory.item_id,
                SalesHistory.store_id,
                SalesHistory.sale_date,
                func.count(SalesHistory.id).label("cnt"),
            )
            .filter(*base_filters)
            .group_by(SalesHistory.item_id, SalesHistory.store_id, SalesHistory.sale_date)
            .having(func.count(SalesHistory.id) > 1)
        )
        dup_records = dup_query.all()
        summary.duplicate_dates_count = sum(r.cnt - 1 for r in dup_records)
        for r in dup_records[:50]:
            issues.append(
                DataQualityIssue(
                    check_type="DUPLICATE_DATE",
                    item_id=r.item_id,
                    store_id=r.store_id,
                    severity="HIGH",
                    message=f"Trùng lặp dữ liệu bán hàng cho ngày {r.sale_date} ({r.cnt} lần).",
                )
            )

        # 5. Kiểm tra rò rỉ dữ liệu sau mốc cutoff_date (D)
        if request.cutoff_date:
            leak_query = (
                db.query(
                    SalesHistory.item_id,
                    SalesHistory.store_id,
                    SalesHistory.sale_date,
                )
                .filter(*base_filters, SalesHistory.sale_date > request.cutoff_date)
            )
            leak_count = leak_query.count()
            if leak_count > 0:
                summary.leakage_detected = True
                for r in leak_query.limit(50).all():
                    issues.append(
                        DataQualityIssue(
                            check_type="DATA_LEAKAGE",
                            item_id=r.item_id,
                            store_id=r.store_id,
                            severity="CRITICAL",
                            message=f"Rò rỉ dữ liệu: Bản ghi ngày {r.sale_date} xảy ra sau mốc cutoff_date ({request.cutoff_date}).",
                        )
                    )

        # 6. Tổng hợp chỉ số chuỗi theo (item_id, store_id): Missing days & Outliers (E, F) bằng SQL Aggregation
        series_agg = (
            db.query(
                SalesHistory.item_id,
                SalesHistory.store_id,
                func.count(SalesHistory.sale_date.distinct()).label("act_days"),
                func.min(SalesHistory.sale_date).label("min_date"),
                func.max(SalesHistory.sale_date).label("max_date"),
                func.avg(SalesHistory.quantity).label("mean_qty"),
                func.sum(SalesHistory.quantity * SalesHistory.quantity).label("sum_sq"),
                func.count(SalesHistory.id).label("total_pts"),
            )
            .filter(*base_filters)
            .group_by(SalesHistory.item_id, SalesHistory.store_id)
            .all()
        )

        total_missing_days = 0
        total_expected_days = 0
        outlier_candidates = []

        for s in series_agg:
            # E. Kiểm tra khoảng trống / ngày bị thiếu (Missing Days)
            if s.min_date and s.max_date:
                min_d = s.min_date if isinstance(s.min_date, date) else date.fromisoformat(str(s.min_date))
                max_d = s.max_date if isinstance(s.max_date, date) else date.fromisoformat(str(s.max_date))
                exp_days = (max_d - min_d).days + 1
                act_days = int(s.act_days)
                miss_days = max(0, exp_days - act_days)

                total_expected_days += exp_days
                total_missing_days += miss_days

                series_missing_rate = miss_days / exp_days if exp_days > 0 else 0.0
                if series_missing_rate > request.max_missing_rate:
                    issues.append(
                        DataQualityIssue(
                            check_type="MISSING_VALUES",
                            item_id=s.item_id,
                            store_id=s.store_id,
                            severity="HIGH" if series_missing_rate > 0.1 else "MEDIUM",
                            message=f"Tỷ lệ thiếu ngày bán hàng ({series_missing_rate:.1%}) vượt ngưỡng tối đa ({request.max_missing_rate:.1%}).",
                            metric_value=round(series_missing_rate, 4),
                        )
                    )

            # F. Phát hiện giá trị ngoại lai (Outliers theo Z-score)
            if s.total_pts >= 5 and s.mean_qty is not None and s.sum_sq is not None:
                mean_val = float(s.mean_qty)
                var_val = max(0.0, (float(s.sum_sq) / s.total_pts) - (mean_val ** 2))
                std_val = math.sqrt(var_val)
                if std_val > 0.001:
                    outlier_candidates.append((s.item_id, s.store_id, mean_val, std_val))

        # 7. Truy vấn giá trị ngoại lai cho các chuỗi có độ lệch chuẩn đáng kể
        for item_id, store_id, mean_val, std_val in outlier_candidates:
            high_cut = mean_val + request.outlier_threshold_std * std_val
            low_cut = mean_val - request.outlier_threshold_std * std_val
            outlier_rows = (
                db.query(
                    SalesHistory.item_id,
                    SalesHistory.store_id,
                    SalesHistory.sale_date,
                    SalesHistory.quantity,
                )
                .filter(
                    *base_filters,
                    SalesHistory.item_id == item_id,
                    SalesHistory.store_id == store_id,
                    (SalesHistory.quantity >= high_cut) | (SalesHistory.quantity <= low_cut),
                )
                .all()
            )
            for r in outlier_rows:
                z_score = abs(float(r.quantity) - mean_val) / std_val
                summary.outliers_count += 1
                issues.append(
                    DataQualityIssue(
                        check_type="OUTLIER",
                        item_id=r.item_id,
                        store_id=r.store_id,
                        severity="LOW" if z_score < 4.0 else "MEDIUM",
                        message=f"Số lượng bán ngoại lai {r.quantity} (Z-score: {z_score:.2f}) vào ngày {r.sale_date}.",
                        metric_value=float(r.quantity),
                    )
                )

        # 8. Tổng hợp chỉ số
        summary.missing_rate = (
            round(total_missing_days / total_expected_days, 4) if total_expected_days > 0 else 0.0
        )

        has_critical = any(i.severity == "CRITICAL" for i in issues)
        has_high = any(i.severity == "HIGH" for i in issues)

        if has_critical or summary.leakage_detected or summary.negative_values_count > 0 or summary.invalid_sku_count > 0:
            status_val = "FAILED"
            passed_val = False
        elif has_high or summary.missing_rate > request.max_missing_rate:
            status_val = "FAILED"
            passed_val = False
        elif len(issues) > 0:
            status_val = "WARNING"
            passed_val = True
        else:
            status_val = "PASSED"
            passed_val = True

        # 5. Lưu vào database (Giới hạn tối đa 200 issues chi tiết vào DB để chống tràn RAM/JSON, B-02)
        capped_issues = issues[:200]
        if len(issues) > 200:
            capped_issues.append(
                DataQualityIssue(
                    check_type="NOTE",
                    severity="LOW",
                    message=f"Đã phát hiện tổng cộng {len(issues)} vấn đề. Đã giới hạn hiển thị 200 bản ghi chi tiết đầu tiên.",
                )
            )

        run = DataQualityRun(
            triggered_by=admin_email,
            status=status_val,
            passed=passed_val,
            summary=summary.model_dump(),
            issues=[i.model_dump() for i in capped_issues],
        )
        saved = data_quality_repository.create(db, run)
        self._log_audit(db, admin_email, status_val, passed_val, len(issues))

        return self._to_response(saved)

    def get_run(self, db: Session, run_id: str) -> DataQualityRunResponse:
        run = data_quality_repository.get_by_id(db, run_id)
        if not run:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy lượt kiểm tra chất lượng dữ liệu với ID: {run_id}",
            )
        return self._to_response(run)

    def list_runs(self, db: Session, skip: int = 0, limit: int = 20) -> DataQualityRunListResponse:
        items, total = data_quality_repository.list_runs(db, skip=skip, limit=limit)
        return DataQualityRunListResponse(
            items=[self._to_response(r) for r in items],
            total=total,
        )

    def _to_response(self, run: DataQualityRun) -> DataQualityRunResponse:
        return DataQualityRunResponse(
            id=run.id,
            status=run.status,
            passed=run.passed,
            triggered_by=run.triggered_by,
            summary=DataQualitySummary(**run.summary),
            issues=[DataQualityIssue(**i) for i in run.issues],
            created_at=run.created_at,
        )

    def _log_audit(
        self,
        db: Session,
        admin_email: Optional[str],
        status_val: str,
        passed_val: bool,
        issue_count: int,
    ) -> None:
        audit_service.log(
            db,
            action="ml.data_quality.run",
            actor_email=admin_email,
            details=f"Kiểm tra chất lượng dữ liệu ML (UC46): Trạng thái {status_val}, Passed={passed_val}, {issue_count} vấn đề phát hiện.",
        )
        db.commit()


data_quality_service = DataQualityService()
