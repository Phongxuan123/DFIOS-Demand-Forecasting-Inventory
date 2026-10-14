import json
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import scipy.stats as stats
from sqlalchemy.orm import Session

from app.models.product import Product
from app.models.supplier import Supplier
from app.models.forecast import Forecast, ForecastSigma
from app.models.sales_history import SalesHistory
from app.models.inventory_param import InventoryParam
from app.models.user import User
from app.repositories.inventory_param_repository import inventory_param_repository
from app.repositories.system_setting_repository import system_setting_repository
from app.services.audit_service import audit_service
from app.schemas.optimization import (
    ServiceLevelConfig,
    ServiceLevelConfigUpdate,
    InventoryParamItem,
    InventoryParamsListResponse,
    RecomputeResponse,
    CompareParamItem,
    CompareStaticResponse,
    SensitivityScenario,
    SensitivityAnalysisRequest,
    SensitivityAnalysisResponse,
)


class OptimizationService:
    SETTINGS_KEY = "target_service_level_config"
    DEFAULT_HOLDING_COST = 2.0
    DEFAULT_ORDER_COST = 50.0
    DEFAULT_LEAD_TIME = 7

    # --- UC29: Target Service Level Configuration ---

    def get_service_level_config(self, db: Session) -> ServiceLevelConfig:
        """
        UC29 - Lấy cấu hình Service Level mục tiêu (tau) từ System Settings.
        """
        setting = system_setting_repository.get_by_key(db, self.SETTINGS_KEY)
        if setting and isinstance(setting.value, dict):
            val = setting.value
            return ServiceLevelConfig(
                default_service_level=float(val.get("default_service_level", 0.95)),
                category_service_levels={
                    k: float(v) for k, v in val.get("category_service_levels", {}).items()
                },
                item_service_levels={
                    k: float(v) for k, v in val.get("item_service_levels", {}).items()
                },
            )
        return ServiceLevelConfig()

    def update_service_level_config(
        self,
        db: Session,
        request: ServiceLevelConfigUpdate,
        current_user: User,
        ip_address: Optional[str] = None,
    ) -> ServiceLevelConfig:
        """
        UC29 - Cập nhật mức phục vụ mục tiêu (Admin only).
        Tự động tính lại tham số tồn kho SS/ROP cho các SKU liên quan và ghi audit log.
        """
        current_cfg = self.get_service_level_config(db)
        old_val_str = json.dumps(current_cfg.model_dump(), ensure_ascii=False)

        new_default = (
            request.default_service_level
            if request.default_service_level is not None
            else current_cfg.default_service_level
        )
        new_cat = (
            request.category_service_levels
            if request.category_service_levels is not None
            else current_cfg.category_service_levels
        )
        new_items = (
            request.item_service_levels
            if request.item_service_levels is not None
            else current_cfg.item_service_levels
        )

        new_data = {
            "default_service_level": new_default,
            "category_service_levels": new_cat,
            "item_service_levels": new_items,
        }
        new_val_str = json.dumps(new_data, ensure_ascii=False)

        system_setting_repository.upsert_setting(
            db,
            key=self.SETTINGS_KEY,
            value=new_data,
            description="Cấu hình mức phục vụ mục tiêu (Target Service Level tau)",
        )

        audit_service.log(
            db,
            action="optimization.update_service_level",
            actor_email=current_user.email,
            ip_address=ip_address,
            details=f"Cập nhật Service Level: cũ={old_val_str} -> mới={new_val_str}",
        )
        db.commit()

        # Tự động tính lại tham số tồn kho SS / ROP
        self.recompute_parameters(db)

        return ServiceLevelConfig(**new_data)

    def _resolve_service_level(
        self, config: ServiceLevelConfig, item_id: str, category: Optional[str]
    ) -> float:
        if item_id in config.item_service_levels:
            return config.item_service_levels[item_id]
        if category and category in config.category_service_levels:
            return config.category_service_levels[category]
        return config.default_service_level

    def _resolve_lead_time(self, db: Session, item_id: str) -> int:
        supplier = db.query(Supplier).first()
        if supplier and supplier.lead_time_days:
            return max(1, int(supplier.lead_time_days))
        return self.DEFAULT_LEAD_TIME

    # --- UC30: View & Recompute Safety Stock / ROP / EOQ ---

    def _calculate_ml_params(
        self,
        db: Session,
        item_id: str,
        store_id: str,
        lead_time_days: int,
        tau: float,
    ) -> Optional[Dict[str, Any]]:
        """
        Tính toán tham số tồn kho dựa trên dự báo ML.
        Trả về None nếu không có dữ liệu dự báo cho SKU.
        """
        forecasts = (
            db.query(Forecast)
            .filter(Forecast.item_id == item_id, Forecast.store_id == store_id)
            .order_by(Forecast.h.asc())
            .all()
        )
        if not forecasts:
            return None

        # Nhu cầu dự báo trong Lead time (d_L)
        lt_forecasts = [fc for fc in forecasts if fc.h <= lead_time_days]
        if lt_forecasts:
            d_l = sum(fc.y_pred for fc in lt_forecasts)
            if len(lt_forecasts) < lead_time_days:
                avg_daily = d_l / len(lt_forecasts)
                d_l = avg_daily * lead_time_days
        else:
            avg_daily = sum(fc.y_pred for fc in forecasts) / len(forecasts)
            d_l = avg_daily * lead_time_days

        # Độ lệch chuẩn sai số dự báo (sigma_d)
        sigma_record = (
            db.query(ForecastSigma).filter(ForecastSigma.id == item_id).first()
        )
        if sigma_record:
            if lead_time_days <= 7 and sigma_record.sigma_d_h7:
                sigma_d = sigma_record.sigma_d_h7 / math.sqrt(7)
            elif lead_time_days <= 14 and sigma_record.sigma_d_h14:
                sigma_d = sigma_record.sigma_d_h14 / math.sqrt(14)
            elif sigma_record.sigma_d_h28:
                sigma_d = sigma_record.sigma_d_h28 / math.sqrt(28)
            else:
                sigma_d = 1.5
        else:
            preds = [fc.y_pred for fc in forecasts]
            sigma_d = float(np.std(preds)) if len(preds) > 1 else 1.5

        sigma_d = max(0.1, sigma_d)
        sigma_l = sigma_d * math.sqrt(lead_time_days)

        # Z-score từ phân phối chuẩn
        z_tau = float(stats.norm.ppf(tau))

        # SS = Z_tau * sigma_L
        safety_stock = max(0.0, round(z_tau * sigma_l, 2))

        # ROP = d_L + SS
        reorder_point = max(0.0, round(d_l + safety_stock, 2))

        # Nhu cầu hàng năm D
        annual_demand = max(1.0, round((d_l / lead_time_days) * 365, 2))

        # EOQ = sqrt(2 * D * S / H)
        h_cost = self.DEFAULT_HOLDING_COST
        s_cost = self.DEFAULT_ORDER_COST
        eoq = max(1.0, round(math.sqrt((2 * annual_demand * s_cost) / h_cost), 2))

        return {
            "safety_stock": safety_stock,
            "reorder_point": reorder_point,
            "eoq": eoq,
            "annual_demand": annual_demand,
            "holding_cost": h_cost,
            "order_cost": s_cost,
            "unit_price": 10.0,
            "source": "ml",
            "d_l": d_l,
            "sigma_l": sigma_l,
            "sigma_d": sigma_d,
        }

    def _calculate_static_params(
        self,
        db: Session,
        item_id: str,
        store_id: str,
        lead_time_days: int,
        tau: float,
    ) -> Dict[str, Any]:
        """
        Tính toán tham số tồn kho theo công thức tĩnh truyền thống (Moving Average).
        """
        sales = (
            db.query(SalesHistory)
            .filter(SalesHistory.item_id == item_id, SalesHistory.store_id == store_id)
            .order_by(SalesHistory.sale_date.desc())
            .limit(90)
            .all()
        )

        if sales:
            quantities = [s.quantity for s in sales]
            avg_daily = float(np.mean(quantities))
            sigma_d = float(np.std(quantities)) if len(quantities) > 1 else 1.0
        else:
            avg_daily = 10.0
            sigma_d = 2.0

        avg_daily = max(0.1, avg_daily)
        sigma_d = max(0.2, sigma_d)

        d_l = avg_daily * lead_time_days
        sigma_l = sigma_d * math.sqrt(lead_time_days)

        z_tau = float(stats.norm.ppf(tau))
        safety_stock = max(0.0, round(z_tau * sigma_l, 2))
        reorder_point = max(0.0, round(d_l + safety_stock, 2))

        annual_demand = max(1.0, round(avg_daily * 365, 2))
        h_cost = self.DEFAULT_HOLDING_COST
        s_cost = self.DEFAULT_ORDER_COST
        eoq = max(1.0, round(math.sqrt((2 * annual_demand * s_cost) / h_cost), 2))

        return {
            "safety_stock": safety_stock,
            "reorder_point": reorder_point,
            "eoq": eoq,
            "annual_demand": annual_demand,
            "holding_cost": h_cost,
            "order_cost": s_cost,
            "unit_price": 10.0,
            "source": "static",
            "d_l": d_l,
            "sigma_l": sigma_l,
            "sigma_d": sigma_d,
        }

    def recompute_parameters(
        self,
        db: Session,
        store_id: str = "CA_1",
        item_id: Optional[str] = None,
        force_static: bool = False,
    ) -> int:
        """
        UC30 - Tính toán và lưu trữ các tham số SS, ROP, EOQ vào bảng inventory_params.
        Có cơ chế Fallback 'static' khi chưa có dự báo ML.
        """
        config = self.get_service_level_config(db)

        query = db.query(Product)
        if item_id:
            query = query.filter(Product.item_id == item_id)
        products = query.all()

        computed_count = 0
        now = datetime.now(timezone.utc)

        for p in products:
            tau = self._resolve_service_level(config, p.item_id, p.cat_id)
            lt_days = self._resolve_lead_time(db, p.item_id)

            params = None
            if not force_static:
                params = self._calculate_ml_params(
                    db, p.item_id, store_id, lt_days, tau
                )

            if not params:
                params = self._calculate_static_params(
                    db, p.item_id, store_id, lt_days, tau
                )

            param_id = f"{store_id}_{p.item_id}"
            inv_param = InventoryParam(
                id=param_id,
                item_id=p.item_id,
                store_id=store_id,
                service_level=tau,
                lead_time_days=lt_days,
                safety_stock=params["safety_stock"],
                reorder_point=params["reorder_point"],
                eoq=params["eoq"],
                annual_demand=params["annual_demand"],
                holding_cost=params["holding_cost"],
                order_cost=params["order_cost"],
                unit_price=params["unit_price"],
                source=params["source"],
                updated_at=now,
            )
            inventory_param_repository.upsert(db, inv_param)
            computed_count += 1

        return computed_count

    def get_parameters(
        self,
        db: Session,
        skip: int = 0,
        limit: int = 50,
        store_id: Optional[str] = None,
        item_id: Optional[str] = None,
        category: Optional[str] = None,
        source: Optional[str] = None,
    ) -> InventoryParamsListResponse:
        """
        UC30 - Lấy danh sách tham số tồn kho tối ưu đã tính toán.
        """
        # Nếu bảng chưa có bản ghi nào, tự động tính toán khởi tạo
        existing_count = db.query(InventoryParam).count()
        if existing_count == 0:
            self.recompute_parameters(db)

        items, total = inventory_param_repository.get_multi(
            db,
            skip=skip,
            limit=limit,
            store_id=store_id,
            item_id=item_id,
            category=category,
            source=source,
        )

        # Lấy thông tin bổ sung tên sản phẩm và category
        product_map = {p.item_id: p for p in db.query(Product).all()}

        response_items: List[InventoryParamItem] = []
        for it in items:
            prod = product_map.get(it.item_id)
            response_items.append(
                InventoryParamItem(
                    item_id=it.item_id,
                    store_id=it.store_id,
                    product_name=prod.name if prod else None,
                    category=prod.cat_id if prod else None,
                    service_level=it.service_level,
                    lead_time_days=it.lead_time_days,
                    safety_stock=it.safety_stock,
                    reorder_point=it.reorder_point,
                    eoq=it.eoq,
                    annual_demand=it.annual_demand,
                    holding_cost=it.holding_cost,
                    order_cost=it.order_cost,
                    unit_price=it.unit_price,
                    source=it.source,
                    updated_at=it.updated_at,
                )
            )

        return InventoryParamsListResponse(
            items=response_items,
            total=total,
            skip=skip,
            limit=limit,
        )

    # --- UC31: Compare ML vs Static Formula ---

    def compare_ml_vs_static(
        self, db: Session, store_id: str = "CA_1"
    ) -> CompareStaticResponse:
        """
        UC31 - So sánh tham số tồn kho ML-driven với công thức tĩnh Moving Average.
        """
        config = self.get_service_level_config(db)
        products = db.query(Product).all()

        items: List[CompareParamItem] = []
        total_savings = 0.0
        ss_reduction_percents: List[float] = []

        for p in products:
            tau = self._resolve_service_level(config, p.item_id, p.cat_id)
            lt_days = self._resolve_lead_time(db, p.item_id)

            ml_p = self._calculate_ml_params(db, p.item_id, store_id, lt_days, tau)
            static_p = self._calculate_static_params(
                db, p.item_id, store_id, lt_days, tau
            )

            # Nếu không có ML, dùng static_p cho cả 2 để không gây lỗi
            if not ml_p:
                ml_p = static_p

            ss_diff = round(static_p["safety_stock"] - ml_p["safety_stock"], 2)
            rop_diff = round(static_p["reorder_point"] - ml_p["reorder_point"], 2)
            eoq_diff = round(static_p["eoq"] - ml_p["eoq"], 2)

            ml_holding = round(
                (ml_p["safety_stock"] + ml_p["eoq"] / 2.0) * ml_p["holding_cost"], 2
            )
            static_holding = round(
                (static_p["safety_stock"] + static_p["eoq"] / 2.0)
                * static_p["holding_cost"],
                2,
            )
            savings = round(max(0.0, static_holding - ml_holding), 2)
            total_savings += savings

            if static_p["safety_stock"] > 0:
                reduct_pct = max(
                    0.0,
                    (static_p["safety_stock"] - ml_p["safety_stock"])
                    / static_p["safety_stock"]
                    * 100.0,
                )
                ss_reduction_percents.append(reduct_pct)

            items.append(
                CompareParamItem(
                    item_id=p.item_id,
                    product_name=p.name,
                    store_id=store_id,
                    category=p.cat_id,
                    lead_time_days=lt_days,
                    service_level=tau,
                    ml_safety_stock=ml_p["safety_stock"],
                    ml_reorder_point=ml_p["reorder_point"],
                    ml_eoq=ml_p["eoq"],
                    ml_annual_holding_cost=ml_holding,
                    static_safety_stock=static_p["safety_stock"],
                    static_reorder_point=static_p["reorder_point"],
                    static_eoq=static_p["eoq"],
                    static_annual_holding_cost=static_holding,
                    ss_difference=ss_diff,
                    rop_difference=rop_diff,
                    eoq_difference=eoq_diff,
                    holding_cost_savings=savings,
                )
            )

        avg_reduction = (
            round(float(np.mean(ss_reduction_percents)), 2)
            if ss_reduction_percents
            else 0.0
        )

        return CompareStaticResponse(
            items=items,
            total_items=len(items),
            total_holding_cost_savings=round(total_savings, 2),
            avg_ss_reduction_percent=avg_reduction,
        )

    # --- UC32: Cost Sensitivity Analysis ---

    def run_sensitivity_analysis(
        self, db: Session, request: SensitivityAnalysisRequest
    ) -> SensitivityAnalysisResponse:
        """
        UC32 - Mô phỏng phân tích độ nhạy chi phí khi Lead Time và Service Level thay đổi.
        Tuyệt đối chỉ tính toán mô phỏng trong bộ nhớ, KHÔNG ghi đè dữ liệu thật trong DB.
        """
        store_id = request.store_id or "CA_1"
        config = self.get_service_level_config(db)

        # Lấy SKU mục tiêu hoặc SKU đầu tiên trong hệ thống
        if request.item_id:
            product = (
                db.query(Product).filter(Product.item_id == request.item_id).first()
            )
        else:
            product = db.query(Product).first()

        if not product:
            item_id = "FOODS_1_001"
            base_tau = 0.95
            base_lt = 7
        else:
            item_id = product.item_id
            base_tau = self._resolve_service_level(config, product.item_id, product.cat_id)
            base_lt = self._resolve_lead_time(db, product.item_id)

        # Lấy tham số cơ sở
        params = self._calculate_ml_params(db, item_id, store_id, base_lt, base_tau)
        if not params:
            params = self._calculate_static_params(
                db, item_id, store_id, base_lt, base_tau
            )

        d_daily = params["d_l"] / base_lt
        sigma_d = params["sigma_d"]
        annual_demand = params["annual_demand"]
        h_unit = request.holding_cost_rate * params["unit_price"]
        s_order = request.order_cost
        c_stockout = request.stockout_cost_per_unit

        def _calc_scenario(lt_days: int, tau: float) -> Tuple[float, float, float, float, float, float, float]:
            z = float(stats.norm.ppf(tau))
            sig_l = sigma_d * math.sqrt(lt_days)
            ss = max(0.0, round(z * sig_l, 2))
            rop = max(0.0, round((d_daily * lt_days) + ss, 2))
            eoq = max(1.0, round(math.sqrt((2 * annual_demand * s_order) / h_unit), 2))

            h_cost = round((ss + eoq / 2.0) * h_unit, 2)
            o_cost = round((annual_demand / eoq) * s_order, 2)
            so_cost = round((1.0 - tau) * annual_demand * c_stockout, 2)
            tot = round(h_cost + o_cost + so_cost, 2)
            return ss, rop, eoq, h_cost, o_cost, so_cost, tot

        # Baseline
        b_ss, b_rop, b_eoq, b_h, b_o, b_so, b_tot = _calc_scenario(base_lt, base_tau)
        baseline = SensitivityScenario(
            scenario_id="baseline",
            lead_time_delta_percent=0.0,
            lead_time_days=base_lt,
            service_level_delta_percent=0.0,
            service_level=round(base_tau, 4),
            safety_stock=b_ss,
            reorder_point=b_rop,
            eoq=b_eoq,
            holding_cost=b_h,
            ordering_cost=b_o,
            stockout_cost=b_so,
            total_cost=b_tot,
            cost_difference_vs_baseline=0.0,
        )

        scenarios: List[SensitivityScenario] = []
        scenario_idx = 1

        for lt_delta in request.lead_time_deltas:
            for sl_delta in request.service_level_deltas:
                # Bỏ qua kịch bản 0,0 vì là baseline
                if lt_delta == 0.0 and sl_delta == 0.0:
                    continue

                sim_lt = max(1, int(round(base_lt * (1.0 + lt_delta))))
                sim_tau = min(0.999, max(0.80, round(base_tau + sl_delta, 4)))

                s_ss, s_rop, s_eoq, s_h, s_o, s_so, s_tot = _calc_scenario(
                    sim_lt, sim_tau
                )
                cost_diff = round(s_tot - b_tot, 2)

                scenarios.append(
                    SensitivityScenario(
                        scenario_id=f"scn_{scenario_idx}",
                        lead_time_delta_percent=round(lt_delta * 100.0, 1),
                        lead_time_days=sim_lt,
                        service_level_delta_percent=round(sl_delta * 100.0, 1),
                        service_level=round(sim_tau, 4),
                        safety_stock=s_ss,
                        reorder_point=s_rop,
                        eoq=s_eoq,
                        holding_cost=s_h,
                        ordering_cost=s_o,
                        stockout_cost=s_so,
                        total_cost=s_tot,
                        cost_difference_vs_baseline=cost_diff,
                    )
                )
                scenario_idx += 1

        insights = [
            f"Khi Lead Time tăng 20%, Safety Stock tăng tương ứng khoảng {(math.sqrt(1.2)-1)*100:.1f}%, kéo theo chi phí lưu kho tăng.",
            "Tăng Service Level từ 95% lên 99% giúp giảm mạnh rủi ro thiếu hàng nhưng làm tăng chi phí lưu trữ tồn kho an toàn theo hàm phi tuyến.",
            f"Kịch bản tối ưu chi phí tổng hợp đạt được tại điểm cân bằng giữa chi phí giữ hàng và chi phí rủi ro hết hàng ({c_stockout}$/đơn vị thiếu).",
        ]

        return SensitivityAnalysisResponse(
            item_id=item_id,
            store_id=store_id,
            baseline_scenario=baseline,
            scenarios=scenarios,
            insights=insights,
        )


optimization_service = OptimizationService()
