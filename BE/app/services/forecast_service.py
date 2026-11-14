import logging
import math
import uuid
from datetime import date, datetime, timedelta

from typing import Dict, List, Optional
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.forecast import Forecast, ForecastOverride
from app.models.user import User
from app.schemas.forecast import (
    ForecastItemResponse,
    ForecastListResponse,
    HistoryPoint,
    HistoricalDemandResponse,
    ComparePoint,
    CompareMetrics,
    ForecastCompareResponse,
    UncertaintyPoint,
    ErrorDistribution,
    ForecastUncertaintyResponse,
    SHAPFeatureContribution,
    ForecastExplanationResponse,
    ForecastOverrideCreate,
    ForecastOverrideResponse,
    ForecastOverrideRevertResponse,
    BulkOverrideRequest,
    BulkOverrideResponse,
)
from app.repositories.forecast_repository import forecast_repository
from app.repositories.product_repository import product_repository
from app.repositories.system_setting_repository import system_setting_repository
from app.repositories.model_registry_repository import model_registry_repository
from app.services.audit_service import audit_service
from app.models.sim_clock import SimClock
from app.models.sales_history import SalesHistory
from types import SimpleNamespace

logger = logging.getLogger(__name__)


class ForecastService:
    """
    Dịch vụ quản trị và khai thác dự báo nhu cầu (Module D — Forecast Explorer, UC17 - UC24).
    """

    def get_allowed_horizons(self, db: Session) -> List[int]:
        """
        Lấy danh sách horizon hợp lệ từ cấu hình hệ thống (mặc định [7, 14, 28]).
        """
        setting = system_setting_repository.get_by_key(db, "forecast_horizons")
        if setting and isinstance(setting.value, list):
            return [int(x) for x in setting.value if isinstance(x, (int, float))]
        return [7, 14, 28]

    def get_forecasts(
        self,
        db: Session,
        horizon: Optional[int] = None,
        item_id: Optional[str] = None,
        category: Optional[str] = None,
        store_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        model_version: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
        sort_by: str = "forecast_date",
        order: str = "asc",
        model_name: Optional[str] = None,
    ) -> ForecastListResponse:
        """
        UC17, UC18, UC19: Xem, chọn horizon và lọc danh sách dự báo nhu cầu.
        """
        allowed_horizons = self.get_allowed_horizons(db)
        if horizon is not None:
            if horizon not in allowed_horizons:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Khoảng dự báo horizon={horizon} không hợp lệ. Các giá trị hợp lệ: {allowed_horizons}.",
                )
            selected_horizon = horizon
        else:
            selected_horizon = max(allowed_horizons) if allowed_horizons else 28

        self._reject_global(store_id, "GET /forecasts")
        target_store = store_id.strip() if store_id and store_id.strip() else "CA_1"

        # ONE version only (never mixed): explicit version > model_name filter > production algorithm > Ensemble > newest
        available = self._available_versions(db, target_store, item_id, model_name)
        active_version = model_version or self._pick_version(db, available, model_name)

        total, records = forecast_repository.get_forecasts(
            db,
            horizon=selected_horizon,
            item_id=item_id,
            category=category,
            store_id=store_id,
            start_date=start_date,
            end_date=end_date,
            model_version=active_version or "__no_matching_version__",
            skip=skip,
            limit=limit,
            sort_by=sort_by,
            order=order,
        )

        clock = db.query(SimClock).filter(SimClock.store_id == target_store).first()
        clock_date = clock.current_date if clock and clock.current_date else None

        # Lấy overrides đang hoạt động để áp dụng lên kết quả
        active_overrides = forecast_repository.get_active_overrides_dict(
            db, item_id=item_id, store_id=store_id
        )

        items: List[ForecastItemResponse] = []
        for fc, p_name, p_cat in records:
            key_h = f"{fc.item_id}_{fc.store_id}_{fc.forecast_date}_{fc.h}"
            key_base = f"{fc.item_id}_{fc.store_id}_{fc.forecast_date}"
            override = active_overrides.get(key_h) or active_overrides.get(key_base)

            if override:
                display_pred = override.override_value
                is_ov = True
                orig_val = fc.y_pred
                ov_reason = override.reason
            else:
                display_pred = fc.y_pred
                is_ov = False
                orig_val = None
                ov_reason = None

            # B-29: Đảm bảo id duy nhất cho từng bản ghi theo từng bước dự báo h thay vì lặp lại chuỗi series id
            unique_item_id = f"{fc.item_id}_{fc.store_id}_{fc.forecast_date}_{fc.h}"
            items.append(
                ForecastItemResponse(
                    id=unique_item_id,
                    item_id=fc.item_id,
                    store_id=fc.store_id,
                    forecast_date=fc.forecast_date,
                    h=fc.h,
                    y_pred=display_pred,
                    original_value=orig_val,
                    is_overridden=is_ov,
                    override_reason=ov_reason,
                    p10=fc.p10,
                    p50=fc.p50,
                    p90=fc.p90,
                    product_name=p_name,
                    category=p_cat,
                    model_version=fc.model_version,
                    generated_at=fc.generated_at,
                    backtest=bool(clock_date and fc.forecast_date <= clock_date),
                    source=self._source_label(fc.model_version, bool(clock_date and fc.forecast_date <= clock_date)),
                )
            )

        return ForecastListResponse(
            items=items,
            total=total,
            horizon=selected_horizon,
            model_name=model_name,
            store_id=target_store,
            source=self._source_label(active_version, False) if active_version else "none",
            backtest=any(i.backtest for i in items),
            available_versions=available,
            model_version=active_version,
            skip=skip,
            limit=limit,
        )

    @staticmethod
    def _is_global(store_id: Optional[str]) -> bool:
        return bool(store_id) and store_id.strip().upper() in ("GLOBAL", "ALL")

    def _reject_global(self, store_id: Optional[str], what: str) -> None:
        """GLOBAL/ALL has no aggregated forecast: 422 instead of silently answering with CA_1."""
        if self._is_global(store_id):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{what}: store_id={store_id} (GLOBAL/ALL) chưa hỗ trợ dự báo gộp; hãy chọn một cửa hàng cụ thể.",
            )

    @staticmethod
    def _source_label(model_version: Optional[str], backtest: bool) -> str:
        if backtest:
            return "backtest"
        if model_version and model_version.lower().startswith("ensemble"):
            return "production_artifact"
        return "forecast_table"

    def _available_versions(self, db: Session, store_id: str, item_id: Optional[str], model_name: Optional[str]) -> List[str]:
        q = db.query(Forecast.model_version, func.max(Forecast.generated_at)).filter(Forecast.store_id == store_id)
        if item_id:
            q = q.filter(Forecast.item_id == item_id)
        if model_name:
            q = q.filter(Forecast.model_version.ilike(f"%{model_name.strip()}%"))
        rows = q.group_by(Forecast.model_version).all()
        rows.sort(key=lambda r: r[1] or datetime.min, reverse=True)
        return [r[0] for r in rows if r[0]]

    def _pick_version(self, db: Session, available: List[str], model_name: Optional[str]) -> Optional[str]:
        if not available:
            return None
        if model_name:
            return available[0]  # newest version matching the name
        prod = (
            db.query(model_registry_repository.model)
            .filter(model_registry_repository.model.is_production.is_(True))
            .order_by(model_registry_repository.model.promoted_at.desc())
            .first()
        )
        if prod:
            for v in available:
                if prod.version == v or (prod.algorithm and prod.algorithm.lower() in v.lower()):
                    return v
        for v in available:
            if v.lower().startswith("ensemble"):
                return v
        return available[0]

    def get_historical_demand(
        self,
        db: Session,
        sku: str,
        store_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        granularity: str = "daily",
    ) -> HistoricalDemandResponse:
        """
        UC20 - View Historical Demand:
        Lấy dữ liệu bán hàng lịch sử của một SKU, gộp theo ngày/tuần/tháng.
        """
        valid_granularities = ["daily", "weekly", "monthly"]
        if granularity.lower() not in valid_granularities:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"granularity='{granularity}' không hợp lệ. Chỉ chấp nhận: {valid_granularities}.",
            )

        # Kiểm tra SKU tồn tại trong danh mục sản phẩm
        product = product_repository.get_by_item_id(db, sku)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy SKU sản phẩm '{sku}'.",
            )

        is_global = self._is_global(store_id)
        cap = self.clock_cap(db, store_id)
        bounded = bool(cap is not None and (end_date is None or end_date > cap))
        if bounded:
            end_date = cap
        sales = forecast_repository.get_historical_sales(
            db, item_id=sku, store_id=None if is_global else store_id, start_date=start_date, end_date=end_date
        )
        if is_global:  # real aggregate: demand of the SKU summed over all stores, per day
            agg: Dict[date, float] = {}
            for s in sales:
                agg[s.sale_date] = agg.get(s.sale_date, 0.0) + float(s.quantity)
            sales = [SimpleNamespace(sale_date=d, quantity=q) for d, q in sorted(agg.items())]

        if not sales:
            return HistoricalDemandResponse(
                item_id=sku,
                store_id=store_id,
                granularity=granularity.lower(),
                total_quantity=0.0,
                avg_quantity=0.0,
                min_quantity=0.0,
                max_quantity=0.0,
                count=0,
                history=[],
                as_of=str(cap) if cap else None,
                bounded_by_clock=bounded,
            )

        gran = granularity.lower()
        if gran == "daily":
            history_points = [
                HistoryPoint(date=str(s.sale_date), quantity=float(s.quantity)) for s in sales
            ]
        elif gran == "weekly":
            weekly_map: Dict[str, float] = {}
            for s in sales:
                iso_year, iso_week, _ = s.sale_date.isocalendar()
                week_key = f"{iso_year}-W{iso_week:02d}"
                weekly_map[week_key] = weekly_map.get(week_key, 0.0) + float(s.quantity)
            history_points = [
                HistoryPoint(date=wk, quantity=round(qty, 2))
                for wk, qty in sorted(weekly_map.items())
            ]
        else:  # monthly
            monthly_map: Dict[str, float] = {}
            for s in sales:
                month_key = f"{s.sale_date.year}-{s.sale_date.month:02d}"
                monthly_map[month_key] = monthly_map.get(month_key, 0.0) + float(s.quantity)
            history_points = [
                HistoryPoint(date=mo, quantity=round(qty, 2))
                for mo, qty in sorted(monthly_map.items())
            ]

        quantities = [p.quantity for p in history_points]
        total_qty = sum(quantities)
        count = len(quantities)
        avg_qty = round(total_qty / count, 2) if count > 0 else 0.0
        min_qty = min(quantities) if quantities else 0.0
        max_qty = max(quantities) if quantities else 0.0

        return HistoricalDemandResponse(
            item_id=sku,
            store_id=store_id,
            granularity=gran,
            total_quantity=round(total_qty, 2),
            avg_quantity=avg_qty,
            min_quantity=round(min_qty, 2),
            max_quantity=round(max_qty, 2),
            count=count,
            history=history_points,
            as_of=str(cap) if cap else None,
            bounded_by_clock=bounded,
        )

    def clock_cap(self, db: Session, store_id: Optional[str]) -> Optional[date]:
        """U-04: actuals after the simulated clock date are the "future" and are never returned.
        store -> its clock; GLOBAL -> the latest clock; no clock row -> no cap."""
        if not store_id or not store_id.strip() or self._is_global(store_id):
            return db.query(func.max(SimClock.current_date)).scalar()
        clock = db.query(SimClock).filter(SimClock.store_id == store_id.strip()).first()
        return clock.current_date if clock and clock.current_date else None

    def _resolve_forecast_version(self, db: Session, sku: str, store_id: str) -> Optional[str]:
        """B-05: one model_version for a SKU/store: the Tier-1 Ensemble if present, else the production
        registry version if the SKU has forecasts of it, else the newest forecast version."""
        rows = (
            db.query(Forecast.model_version, func.max(Forecast.generated_at))
            .filter(Forecast.item_id == sku, Forecast.store_id == store_id)
            .group_by(Forecast.model_version)
            .all()
        )
        if not rows:
            return None
        versions = {r[0]: r[1] for r in rows}
        ens = [v for v in versions if v and v.lower().startswith("ensemble")]
        if ens:
            return max(ens, key=lambda v: versions[v] or datetime.min)
        prod_model = (
            db.query(model_registry_repository.model)
            .filter(model_registry_repository.model.is_production.is_(True))
            .first()
        )
        if prod_model and prod_model.version in versions:
            return prod_model.version
        return max(versions, key=lambda v: versions[v] or datetime.min)

    def compare_actual_vs_predicted(
        self,
        db: Session,
        sku: str,
        store_id: Optional[str] = None,
        model_version: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> ForecastCompareResponse:
        """
        UC21 - Compare Actual vs Predicted:
        Đối chiếu chuỗi thực tế (sales_history) và dự báo (forecast) trên cùng khung thời gian đã có thực tế.
        """
        product = product_repository.get_by_item_id(db, sku)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy SKU sản phẩm '{sku}'.",
            )

        self._reject_global(store_id, "GET /forecasts/{sku}/compare")
        target_store = store_id.strip() if store_id and store_id.strip() else "CA_1"

        active_version = model_version or self._resolve_forecast_version(db, sku, target_store)

        cap = self.clock_cap(db, target_store)
        if cap is not None and (end_date is None or end_date > cap):
            end_date = cap  # U-04: no actuals from the simulated future
        sales = forecast_repository.get_historical_sales(
            db, item_id=sku, store_id=target_store, start_date=start_date, end_date=end_date
        )
        forecasts = forecast_repository.get_forecasts_for_sku(
            db,
            item_id=sku,
            store_id=target_store,
            start_date=start_date,
            end_date=end_date,
            model_version=active_version,
        )

        if not forecasts and model_version is None:
            forecasts = forecast_repository.get_forecasts_for_sku(
                db,
                item_id=sku,
                store_id=target_store,
                start_date=start_date,
                end_date=end_date,
                model_version=None,
            )

        overrides = forecast_repository.get_active_overrides_dict(
            db, item_id=sku, store_id=target_store
        )

        # Lập dict actual theo ngày
        actual_map: Dict[date, float] = {}
        for s in sales:
            actual_map[s.sale_date] = actual_map.get(s.sale_date, 0.0) + float(s.quantity)

        # Ghép cặp chỉ những ngày có cả actual và forecast
        forecast_by_date: Dict[date, Forecast] = {}
        for f in forecasts:
            if f.forecast_date not in forecast_by_date:
                forecast_by_date[f.forecast_date] = f
            else:
                curr = forecast_by_date[f.forecast_date]
                if (f.h and curr.h and f.h < curr.h) or (f.generated_at and curr.generated_at and f.generated_at > curr.generated_at):
                    forecast_by_date[f.forecast_date] = f

        selected_model_version = (
            model_version
            or (next(iter(forecast_by_date.values())).model_version if forecast_by_date else active_version)
        )

        comparison: List[ComparePoint] = []
        errors: List[float] = []
        abs_errors: List[float] = []
        pct_errors: List[float] = []
        total_actual = 0.0
        total_pred = 0.0

        for f_date, actual_val in sorted(actual_map.items()):
            if f_date in forecast_by_date:
                fc = forecast_by_date[f_date]
                ov_key_h = f"{sku}_{fc.store_id}_{f_date}_{fc.h}"
                ov_key_base = f"{sku}_{fc.store_id}_{f_date}"
                ov = overrides.get(ov_key_h) or overrides.get(ov_key_base)
                pred_val = ov.override_value if ov else fc.y_pred

                err = actual_val - pred_val
                abs_err = abs(err)
                pct_err = round(abs_err / actual_val * 100.0, 2) if actual_val > 0 else None

                errors.append(err)
                abs_errors.append(abs_err)
                if pct_err is not None:
                    pct_errors.append(pct_err)

                total_actual += actual_val
                total_pred += pred_val

                comparison.append(
                    ComparePoint(
                        date=f_date,
                        actual=round(actual_val, 2),
                        predicted=round(pred_val, 2),
                        error=round(err, 2),
                        abs_error=round(abs_err, 2),
                        percentage_error=pct_err,
                        p10=fc.p10,
                        p50=fc.p50,
                        p90=fc.p90,
                    )
                )

        n = len(comparison)
        mae = round(sum(abs_errors) / n, 2) if n > 0 else 0.0
        rmse = round(math.sqrt(sum(e**2 for e in errors) / n), 2) if n > 0 else 0.0
        mape = round(sum(pct_errors) / len(pct_errors), 2) if pct_errors else None

        # MASE: scale = mean |y_t - y_(t-1)| of the TRAINING history (sales strictly before the first compared day)
        mase = None
        scale_n = 0
        if comparison:
            first_day = min(c.date for c in comparison)
            hist = (
                db.query(SalesHistory.sale_date, SalesHistory.quantity)
                .filter(SalesHistory.item_id == sku, SalesHistory.store_id == target_store,
                        SalesHistory.sale_date < first_day)
                .order_by(SalesHistory.sale_date.asc()).all()
            )
            ys = [float(q) for _, q in hist]
            scale_n = len(ys)
            if scale_n >= 2:
                scale = sum(abs(ys[i] - ys[i - 1]) for i in range(1, scale_n)) / (scale_n - 1)
                if scale > 0:
                    mase = round((sum(abs_errors) / n) / scale, 4)

        metrics = CompareMetrics(
            mase=mase,
            mase_scale_n=scale_n,
            mae=mae,
            rmse=rmse,
            mape=mape,
            total_actual=round(total_actual, 2),
            total_predicted=round(total_pred, 2),
            data_points=n,
        )

        return ForecastCompareResponse(
            item_id=sku,
            store_id=store_id,
            model_version=selected_model_version,
            model_version_source=(
                "requested" if model_version
                else "none" if not selected_model_version
                else "resolved_ensemble" if str(selected_model_version).lower().startswith("ensemble")
                else "resolved_other"
            ),
            metrics=metrics,
            comparison=comparison,
        )

    def get_uncertainty_band(
        self,
        db: Session,
        sku: str,
        store_id: Optional[str] = None,
        horizon: Optional[int] = None,
    ) -> ForecastUncertaintyResponse:
        """
        UC22 - View Prediction Uncertainty Band:
        Trả khoảng tin cậy p10 / p50 / p90 và phân bố sai số cho một SKU.
        """
        allowed_horizons = self.get_allowed_horizons(db)
        if horizon is not None:
            if horizon not in allowed_horizons:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Khoảng dự báo horizon={horizon} không hợp lệ. Chỉ chấp nhận {allowed_horizons}.",
                )
            selected_horizon = horizon
        else:
            selected_horizon = max(allowed_horizons) if allowed_horizons else 28

        product = product_repository.get_by_item_id(db, sku)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy SKU sản phẩm '{sku}'.",
            )

        self._reject_global(store_id, "GET /forecasts/{sku}/uncertainty")
        _store_for_version = (
            store_id.strip()
            if store_id and store_id.strip() and store_id.strip().upper() not in ("GLOBAL", "ALL")
            else "CA_1"
        )
        forecasts = forecast_repository.get_forecasts_for_sku(
            db, item_id=sku, store_id=store_id, horizon=selected_horizon,
            model_version=self._resolve_forecast_version(db, sku, _store_for_version),
        )

        sigma_obj = forecast_repository.get_sigma(db, sku)
        sigma_val = None
        if sigma_obj:
            if selected_horizon <= 7:
                sigma_val = sigma_obj.sigma_d_h7
            elif selected_horizon <= 14:
                sigma_val = sigma_obj.sigma_d_h14
            else:
                sigma_val = sigma_obj.sigma_d_h28

        points: List[UncertaintyPoint] = []
        spreads: List[float] = []

        target_store = (
            store_id.strip()
            if store_id and store_id.strip() and store_id.strip().upper() not in ("GLOBAL", "ALL")
            else "CA_1"
        )
        active_overrides = forecast_repository.get_active_overrides_dict(
            db, item_id=sku, store_id=target_store
        )

        for fc in forecasts:
            ov_key_h = f"{sku}_{fc.store_id}_{fc.forecast_date}_{fc.h}"
            ov_key_base = f"{sku}_{fc.store_id}_{fc.forecast_date}"
            ov = active_overrides.get(ov_key_h) or active_overrides.get(ov_key_base)
            effective_pred = float(ov.override_value) if ov else fc.y_pred

            rng = round(fc.p90 - fc.p10, 2) if (fc.p90 is not None and fc.p10 is not None) else None
            if rng is not None:
                spreads.append(rng)

            points.append(
                UncertaintyPoint(
                    forecast_date=fc.forecast_date,
                    h=fc.h,
                    y_pred=effective_pred,
                    p10=fc.p10,
                    p50=fc.p50,
                    p90=fc.p90,
                    uncertainty_range=rng,
                )
            )

        # Truy vấn doanh số thực tế để tính sai số dự báo thực nghiệm r = y - y_hat (B-06, B-01)
        sales_recs = forecast_repository.get_historical_sales(
            db, item_id=sku, store_id=target_store
        )
        sales_map = {s.sale_date: float(s.quantity) for s in sales_recs}
        residuals: List[float] = []
        for fc in forecasts:
            if fc.forecast_date in sales_map:
                ov_key_h = f"{sku}_{fc.store_id}_{fc.forecast_date}_{fc.h}"
                ov_key_base = f"{sku}_{fc.store_id}_{fc.forecast_date}"
                ov = active_overrides.get(ov_key_h) or active_overrides.get(ov_key_base)
                effective_pred = float(ov.override_value) if ov else fc.y_pred
                residuals.append(round(sales_map[fc.forecast_date] - effective_pred, 2))

        # B-06: error_distribution = REAL residuals r = actual - prediction only. The p90-p10 band width has
        # its own field; it is never reported as a forecast error.
        def _dist(vals: List[float]) -> Optional[ErrorDistribution]:
            if not vals:
                return None
            sv = sorted(vals)
            m = sum(sv) / len(sv)
            std = math.sqrt(sum((x - m) ** 2 for x in sv) / len(sv))

            def pct(p: float) -> float:
                return sv[int(p * (len(sv) - 1))]

            return ErrorDistribution(
                mean=round(m, 2), std=round(std, 2), min=round(sv[0], 2), max=round(sv[-1], 2),
                p10=round(pct(0.10), 2), p25=round(pct(0.25), 2), p50=round(pct(0.50), 2),
                p75=round(pct(0.75), 2), p90=round(pct(0.90), 2),
            )

        err_dist = _dist(residuals)
        band_dist = _dist(spreads)

        return ForecastUncertaintyResponse(
            item_id=sku,
            store_id=store_id,
            horizon=selected_horizon,
            sigma_h=round(sigma_val, 2) if sigma_val is not None else None,
            points=points,
            error_distribution=err_dist,
            error_distribution_n=len(residuals),
            band_width_distribution=band_dist,
        )

    def get_forecast_explanation(
        self,
        db: Session,
        sku: str,
        store_id: Optional[str] = None,
        model_version: Optional[str] = None,
        model_name: Optional[str] = None,
    ) -> ForecastExplanationResponse:
        """
        UC23 - View Forecast Explanation (SHAP):
        Mức đóng góp của feature (giá, sự kiện, thời điểm).
        Mô hình ARIMA trả 404 kèm thông báo rõ.
        """
        self._reject_global(store_id, "GET /forecasts/{sku}/explanation")
        # Kiểm tra nếu người dùng hoặc hệ thống đang dùng mô hình ARIMA
        if model_name and "arima" in model_name.lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Mô hình ARIMA không hỗ trợ giải thích SHAP. Vui lòng sử dụng mô hình học máy (LightGBM / XGBoost) để xem phân tích SHAP.",
            )

        # Kiểm tra product
        product = product_repository.get_by_item_id(db, sku)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy SKU sản phẩm '{sku}'.",
            )

        # Truy vấn các bản ghi explanation đã lưu
        db_explanations = forecast_repository.get_explanations(
            db, item_id=sku, store_id=store_id, model_version=model_version
        )

        if db_explanations:
            features = [
                SHAPFeatureContribution(
                    feature_name=e.feature_name,
                    importance_score=round(e.importance_score, 4),
                    direction=e.direction,
                    description=e.description,
                )
                for e in db_explanations
            ]
            return ForecastExplanationResponse(
                item_id=sku, store_id=store_id, model_name=db_explanations[0].model_name,
                model_version=db_explanations[0].model_version, base_value=None, features=features,
                available=True, source="stored_explanations",
                reason=None,
            )

        # U-03: no explanation was computed for this SKU. The previous canned SHAP values (identical for every
        # SKU) were fabricated; the production forecast is an ensemble artifact without per-SKU attributions
        # in this database, so we say so instead of inventing numbers.
        return ForecastExplanationResponse(
            item_id=sku, store_id=store_id, model_name="n/a", model_version=model_version or "n/a",
            base_value=None, features=[], available=False, source="none",
            reason=(
                "No per-SKU feature attribution is available: the production forecast is an ensemble artifact "
                "(no SHAP values are stored for this SKU and none are fabricated)."
            ),
        )

    def create_override(
        self,
        db: Session,
        sku: str,
        request: ForecastOverrideCreate,
        current_user: User,
        ip_address: Optional[str] = None,
    ) -> ForecastOverrideResponse:
        """
        UC24 - Manual Forecast Override:
        Can thiệp thủ công giá trị dự báo kèm lý do bắt buộc. Lưu giá trị gốc + giá trị override. Ghi audit.
        """
        if not request.reason or not request.reason.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Lý do điều chỉnh (reason) là bắt buộc và không được để trống.",
            )

        # Kiểm tra product
        product = product_repository.get_by_item_id(db, sku)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy SKU sản phẩm '{sku}'.",
            )

        target_store = request.store_id or "CA_1"

        # Tìm bản ghi dự báo gốc
        original_fc = forecast_repository.get_single_forecast(
            db,
            item_id=sku,
            forecast_date=request.forecast_date,
            store_id=target_store,
            h=request.h,
        )
        if not original_fc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy bản ghi dự báo cho SKU '{sku}' vào ngày {request.forecast_date} để điều chỉnh.",
            )

        override = ForecastOverride(
            id=str(uuid.uuid4()),
            item_id=sku,
            store_id=target_store,
            forecast_date=request.forecast_date,
            h=request.h or original_fc.h,
            original_value=original_fc.y_pred,
            override_value=request.override_value,
            reason=request.reason.strip(),
            created_by=current_user.email,
            is_active=True,
        )

        saved = forecast_repository.create_override(db, override)

        # Ghi audit log
        audit_service.log(
            db,
            action="forecast.override",
            actor_email=current_user.email,
            ip_address=ip_address,
            details=f"Can thiệp dự báo SKU '{sku}' ngày {request.forecast_date}: cũ={original_fc.y_pred} -> mới={request.override_value}. Lý do: {request.reason.strip()}",
        )
        db.commit()

        # Tự động đồng bộ và tính lại ROP theo dự báo mới (B-01, N-20)
        try:
            from app.models.forecast_window_quantile import ForecastWindowQuantile
            from app.models.sim_clock import SimClock
            from app.services.optimization_service import optimization_service
            # N-20: Chỉ xóa quantile của origin bị ảnh hưởng bởi forecast_date này
            affected_origin = request.forecast_date - timedelta(days=original_fc.h if original_fc and original_fc.h else 1)
            db.query(ForecastWindowQuantile).filter(
                ForecastWindowQuantile.store_id == target_store,
                ForecastWindowQuantile.item_id == sku,
                ForecastWindowQuantile.origin_date == affected_origin,
            ).delete()
            clock = db.query(SimClock).filter(SimClock.store_id == target_store).first()
            if clock and clock.current_date and clock.current_date != affected_origin:
                db.query(ForecastWindowQuantile).filter(
                    ForecastWindowQuantile.store_id == target_store,
                    ForecastWindowQuantile.item_id == sku,
                    ForecastWindowQuantile.origin_date == clock.current_date,
                ).delete()
            optimization_service.recompute_parameters(db, store_id=target_store, item_id=sku)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error recomputing quantiles/params on override for {sku} in {target_store}: {e}",
                exc_info=True,
            )

        return ForecastOverrideResponse.model_validate(saved)

    def revert_override(
        self,
        db: Session,
        sku: str,
        override_id: str,
        current_user: User,
        ip_address: Optional[str] = None,
    ) -> ForecastOverrideRevertResponse:
        """
        UC24 - Hoàn tác can thiệp thủ công (Revert override), khôi phục giá trị ban đầu.
        """
        override = forecast_repository.get_override_by_id(db, override_id)
        if not override or override.item_id != sku:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Không tìm thấy bản ghi điều chỉnh (override) với ID '{override_id}' cho SKU '{sku}'.",
            )

        orig_val = override.original_value
        forecast_repository.deactivate_override(db, override)

        # Ghi audit log
        audit_service.log(
            db,
            action="forecast.revert_override",
            actor_email=current_user.email,
            ip_address=ip_address,
            details=f"Hoàn tác can thiệp dự báo ID '{override_id}' cho SKU '{sku}'. Khôi phục giá trị gốc={orig_val}.",
        )
        db.commit()

        # Tự động đồng bộ và tính lại ROP sau khi hoàn tác can thiệp (B-01, N-20)
        try:
            from app.models.forecast_window_quantile import ForecastWindowQuantile
            from app.models.sim_clock import SimClock
            from app.services.optimization_service import optimization_service
            affected_origin = override.forecast_date - timedelta(days=override.h if override.h else 1)
            db.query(ForecastWindowQuantile).filter(
                ForecastWindowQuantile.store_id == override.store_id,
                ForecastWindowQuantile.item_id == sku,
                ForecastWindowQuantile.origin_date == affected_origin,
            ).delete()
            clock = db.query(SimClock).filter(SimClock.store_id == override.store_id).first()
            if clock and clock.current_date and clock.current_date != affected_origin:
                db.query(ForecastWindowQuantile).filter(
                    ForecastWindowQuantile.store_id == override.store_id,
                    ForecastWindowQuantile.item_id == sku,
                    ForecastWindowQuantile.origin_date == clock.current_date,
                ).delete()
            optimization_service.recompute_parameters(db, store_id=override.store_id, item_id=sku)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error recomputing quantiles/params on revert for {sku} in {override.store_id}: {e}",
                exc_info=True,
            )

        return ForecastOverrideRevertResponse(
            success=True,
            message="Đã hoàn tác điều chỉnh thủ công, khôi phục giá trị dự báo gốc thành công.",
            id=override_id,
            item_id=sku,
            original_value=orig_val,
        )

    def list_overrides(
        self,
        db: Session,
        sku: str,
        store_id: Optional[str] = None,
    ) -> List[ForecastOverrideResponse]:
        """
        Danh sách các lần can thiệp dự báo của một SKU.
        """
        overrides = forecast_repository.get_overrides_for_sku(db, item_id=sku, store_id=store_id)
        return [ForecastOverrideResponse.model_validate(o) for o in overrides]

    def bulk_override(
        self,
        db: Session,
        request: BulkOverrideRequest,
        current_user: User,
        ip_address: Optional[str] = None,
    ) -> BulkOverrideResponse:
        """
        Thực hiện can thiệp thủ công hàng loạt (Bulk Forecast Override).
        Kiểm tra reason: không được để trống hoặc chỉ chứa khoảng trắng (trả về 422).
        Đối với SKU/date không tồn tại, ghi nhận lỗi vào errors và tăng skipped_count.
        """
        validation_errors = []
        for idx, item in enumerate(request.items):
            if not item.reason or not item.reason.strip():
                validation_errors.append({
                    "type": "type_error.str.strip",
                    "loc": ["body", "items", idx, "reason"],
                    "msg": "Lý do điều chỉnh không được để trống hoặc chỉ chứa khoảng trắng",
                    "input": item.reason,
                })
                validation_errors.append({
                    "type": "value_error",
                    "loc": ["body", "items", idx, "reason"],
                    "msg": "Lý do điều chỉnh không hợp lệ",
                    "input": item.reason,
                })

        if validation_errors:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=validation_errors,
            )

        created_count = 0
        skipped_count = 0
        errors = []

        for item in request.items:
            product = product_repository.get_by_item_id(db, item.item_id)
            if not product:
                errors.append({
                    "item_id": item.item_id,
                    "date": str(item.date),
                    "error": f"Không tìm thấy sản phẩm với SKU '{item.item_id}'",
                })
                skipped_count += 1
                continue

            fc = forecast_repository.get_single_forecast(
                db,
                item_id=item.item_id,
                forecast_date=item.date,
                store_id=item.store_id,
                h=item.h,
            )
            if not fc:
                errors.append({
                    "item_id": item.item_id,
                    "date": str(item.date),
                    "error": f"Không tìm thấy bản ghi dự báo cho SKU '{item.item_id}' vào ngày {item.date}",
                })
                skipped_count += 1
                continue

            override = ForecastOverride(
                id=str(uuid.uuid4()),
                item_id=item.item_id,
                store_id=item.store_id,
                forecast_date=item.date,
                h=item.h or fc.h,
                original_value=fc.y_pred,
                override_value=item.value,
                reason=item.reason.strip(),
                created_by=current_user.email,
                is_active=True,
            )
            forecast_repository.create_override(db, override)
            created_count += 1

        if created_count > 0:
            audit_service.log(
                db,
                action="forecast.bulk_override",
                actor_email=current_user.email,
                ip_address=ip_address,
                details=f"Can thiệp dự báo hàng loạt: thành công={created_count}, bỏ qua={skipped_count}",
            )
            db.commit()

            # Tự động đồng bộ và tính lại ROP cho toàn bộ các SKU bị can thiệp (B-01, N-20)
            try:
                from app.models.forecast_window_quantile import ForecastWindowQuantile
                from app.models.sim_clock import SimClock
                from app.services.optimization_service import optimization_service
                for it in request.items:
                    fc_rec = forecast_repository.get_single_forecast(
                        db, item_id=it.item_id, forecast_date=it.date, store_id=it.store_id
                    )
                    h_val = fc_rec.h if fc_rec and fc_rec.h else 1
                    affected_origin = it.date - timedelta(days=h_val)
                    db.query(ForecastWindowQuantile).filter(
                        ForecastWindowQuantile.store_id == it.store_id,
                        ForecastWindowQuantile.item_id == it.item_id,
                        ForecastWindowQuantile.origin_date == affected_origin,
                    ).delete()
                affected_keys = {(it.item_id, it.store_id) for it in request.items}
                by_store: Dict[str, List[str]] = {}
                for affected_sku, affected_store in affected_keys:
                    clock = db.query(SimClock).filter(SimClock.store_id == affected_store).first()
                    if clock and clock.current_date:
                        db.query(ForecastWindowQuantile).filter(
                            ForecastWindowQuantile.store_id == affected_store,
                            ForecastWindowQuantile.item_id == affected_sku,
                            ForecastWindowQuantile.origin_date == clock.current_date,
                        ).delete()
                    by_store.setdefault(affected_store, []).append(affected_sku)
                # P-27: ONE bulk recompute per store, not one per SKU
                for affected_store, skus in by_store.items():
                    optimization_service.recompute_parameters(db, store_id=affected_store, item_ids=skus)
                db.commit()
            except Exception as e:
                db.rollback()
                logger.error(
                    f"Error recomputing quantiles/params on bulk_override: {e}",
                    exc_info=True,
                )

        return BulkOverrideResponse(
            success=True,
            created_count=created_count,
            skipped_count=skipped_count,
            errors=errors,
            message=f"Đã xử lý can thiệp hàng loạt: tạo mới {created_count}, bỏ qua {skipped_count}.",
        )


forecast_service = ForecastService()
