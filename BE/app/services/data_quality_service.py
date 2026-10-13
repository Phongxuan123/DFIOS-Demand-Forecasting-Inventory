import math
from datetime import date
from typing import Dict, List, Optional, Tuple
from fastapi import HTTPException, status
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
        # 1. Truy vấn dữ liệu bán hàng lịch sử
        query = db.query(SalesHistory)
        if request.item_ids:
            query = query.filter(SalesHistory.item_id.in_(request.item_ids))
        if request.store_id:
            query = query.filter(SalesHistory.store_id == request.store_id)
        
        records = query.order_by(SalesHistory.item_id, SalesHistory.store_id, SalesHistory.sale_date).all()

        issues: List[DataQualityIssue] = []
        summary = DataQualitySummary()

        if not records:
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

        # 2. Lấy danh mục SKU hợp lệ
        valid_sku_set = {row[0] for row in db.query(Product.item_id).all()}

        # 3. Gom nhóm theo chuỗi (item_id, store_id)
        grouped: Dict[Tuple[str, str], List[SalesHistory]] = {}
        for r in records:
            key = (r.item_id, r.store_id)
            grouped.setdefault(key, []).append(r)

        total_missing_days = 0
        total_expected_days = 0

        for (item_id, store_id), series in grouped.items():
            # A. Kiểm tra SKU có tồn tại trong Product Master
            if item_id not in valid_sku_set:
                summary.invalid_sku_count += 1
                issues.append(
                    DataQualityIssue(
                        check_type="UNKNOWN_SKU",
                        item_id=item_id,
                        store_id=store_id,
                        severity="CRITICAL",
                        message=f"SKU '{item_id}' không tồn tại trong danh mục sản phẩm (Product Master).",
                    )
                )

            dates_seen = set()
            quantities: List[float] = []

            for r in series:
                # B. Kiểm tra giá trị âm
                if r.quantity < 0:
                    summary.negative_values_count += 1
                    issues.append(
                        DataQualityIssue(
                            check_type="NEGATIVE_VALUE",
                            item_id=item_id,
                            store_id=store_id,
                            severity="CRITICAL",
                            message=f"Số lượng bán âm: {r.quantity} vào ngày {r.sale_date}.",
                            metric_value=float(r.quantity),
                        )
                    )

                # C. Kiểm tra trùng lặp ngày
                if r.sale_date in dates_seen:
                    summary.duplicate_dates_count += 1
                    issues.append(
                        DataQualityIssue(
                            check_type="DUPLICATE_DATE",
                            item_id=item_id,
                            store_id=store_id,
                            severity="HIGH",
                            message=f"Trùng lặp dữ liệu bán hàng cho ngày {r.sale_date}.",
                        )
                    )
                else:
                    dates_seen.add(r.sale_date)

                # D. Kiểm tra rò rỉ dữ liệu (Data Leakage)
                if request.cutoff_date and r.sale_date > request.cutoff_date:
                    summary.leakage_detected = True
                    issues.append(
                        DataQualityIssue(
                            check_type="DATA_LEAKAGE",
                            item_id=item_id,
                            store_id=store_id,
                            severity="CRITICAL",
                            message=f"Rò rỉ dữ liệu: Bản ghi ngày {r.sale_date} xảy ra sau mốc cutoff_date ({request.cutoff_date}).",
                        )
                    )

                quantities.append(float(r.quantity))

            # E. Kiểm tra khoảng trống / ngày bị thiếu (Missing Days)
            sorted_dates = sorted(dates_seen)
            if sorted_dates:
                min_d = sorted_dates[0]
                max_d = sorted_dates[-1]
                exp_days = (max_d - min_d).days + 1
                act_days = len(sorted_dates)
                miss_days = max(0, exp_days - act_days)

                total_expected_days += exp_days
                total_missing_days += miss_days

                series_missing_rate = miss_days / exp_days if exp_days > 0 else 0.0
                if series_missing_rate > request.max_missing_rate:
                    issues.append(
                        DataQualityIssue(
                            check_type="MISSING_VALUES",
                            item_id=item_id,
                            store_id=store_id,
                            severity="HIGH" if series_missing_rate > 0.1 else "MEDIUM",
                            message=f"Tỷ lệ thiếu ngày bán hàng ({series_missing_rate:.1%}) vượt ngưỡng tối đa ({request.max_missing_rate:.1%}).",
                            metric_value=round(series_missing_rate, 4),
                        )
                    )

            # F. Phát hiện giá trị ngoại lai (Outliers theo Z-score)
            if len(quantities) >= 5:
                mean_val = sum(quantities) / len(quantities)
                var_val = sum((q - mean_val) ** 2 for q in quantities) / len(quantities)
                std_val = math.sqrt(var_val)

                if std_val > 0.001:
                    for r in series:
                        z_score = abs(r.quantity - mean_val) / std_val
                        if z_score >= request.outlier_threshold_std:
                            summary.outliers_count += 1
                            issues.append(
                                DataQualityIssue(
                                    check_type="OUTLIER",
                                    item_id=item_id,
                                    store_id=store_id,
                                    severity="LOW" if z_score < 4.0 else "MEDIUM",
                                    message=f"Số lượng bán ngoại lai {r.quantity} (Z-score: {z_score:.2f}) vào ngày {r.sale_date}.",
                                    metric_value=float(r.quantity),
                                )
                            )

        # 4. Tổng hợp chỉ số
        summary.total_records = len(records)
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

        # 5. Lưu vào database
        run = DataQualityRun(
            triggered_by=admin_email,
            status=status_val,
            passed=passed_val,
            summary=summary.model_dump(),
            issues=[i.model_dump() for i in issues],
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
