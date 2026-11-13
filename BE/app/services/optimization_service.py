import json
import math
from datetime import datetime, timezone, date, timedelta
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import scipy.stats as stats
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.product import Product
from app.models.supplier import Supplier
from app.models.forecast import Forecast, ForecastSigma
from app.models.sales_history import SalesHistory
from app.models.inventory_param import InventoryParam
from app.models.user import User
from app.models.policy_selection import PolicySelection
from app.models.calibration_state import CalibrationState
from app.models.classification import SKUClassification
from app.models.sim_clock import SimClock
from app.services.window_quantile_service import window_quantile_service
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
    # Giả định chi phí chuẩn A3 (research.md §3)
    ORDER_COST_C = 2.0  # c = 2 đơn vị tiền mỗi dòng đơn (A3)
    HOLDING_RATE_DAILY = 0.002  # h = 0.2% giá/đơn vị/ngày => h_annual = 0.73 * unit_price (A3)
    STOCKOUT_PENALTY_RATE = 0.35  # b = 35% giá/đơn vị (A3)
    DEFAULT_HOLDING_COST = 2.5  # Tham chiếu trung bình khi thiếu giá
    DEFAULT_ORDER_COST = 2.0  # c = 2.0 (A3)
    DEFAULT_LEAD_TIME = 3  # L = 3 ngày (research.md §3)
    DEFAULT_REVIEW_PERIOD = 7  # R = 7 ngày => H = L + R = 10 ngày (research.md §3)

    DEFAULT_OPTIMAL_POLICIES = {
        "AX": {"m_g": 0.0, "kappa_g": 1.0, "val_cost": 319489.84, "val_service": 0.9495},
        "AY": {"m_g": 0.0, "kappa_g": 1.0, "val_cost": 395968.80, "val_service": 0.9494},
        "AZ": {"m_g": 0.0, "kappa_g": 1.0, "val_cost": 66254.19,  "val_service": 0.9490},
        "BX": {"m_g": 0.0, "kappa_g": 1.0, "val_cost": 64478.95,  "val_service": 0.9499},
        "BY": {"m_g": 0.0, "kappa_g": 1.0, "val_cost": 421200.50, "val_service": 0.9491},
        "BZ": {"m_g": 0.0, "kappa_g": 1.0, "val_cost": 156711.20, "val_service": 0.9489},
        "CX": {"m_g": 0.0, "kappa_g": 1.0, "val_cost": 2907.45,   "val_service": 0.9483},
        "CY": {"m_g": 0.0, "kappa_g": 1.0, "val_cost": 176043.10, "val_service": 0.9492},
        "CZ": {"m_g": 0.0, "kappa_g": 1.0, "val_cost": 491428.00, "val_service": 0.9479},
    }

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
        """
        R-28: Xác định Lead Time (L) chuẩn cho SKU:
        Ưu tiên nhà cung cấp theo ngành hàng (FOODS/HOBBIES/HOUSEHOLD).
        Nếu không có, tuân thủ chuẩn nghiên cứu L = 3 ngày (research.md §3) để đảm bảo H = L + R = 10 ngày.
        """
        prod = db.query(Product).filter(Product.item_id == item_id).first()
        if prod and prod.cat_id:
            cat_keyword_map = {
                "FOODS": "Thực phẩm",
                "HOBBIES": "Sở thích",
                "HOUSEHOLD": "Gia dụng",
            }
            kw = cat_keyword_map.get(prod.cat_id.upper())
            if kw:
                supp = db.query(Supplier).filter(Supplier.name.ilike(f"%{kw}%")).first()
                if supp and supp.lead_time_days:
                    return max(1, int(supp.lead_time_days))

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
        Giai đoạn 4 (Task OPT.1) - Tính toán tham số tồn kho theo chính sách REFIT-RSS-EOQ-G:
        - Route (c) Window Quantile Q_hat(tau) trên cửa sổ bảo vệ H = L + R (mặc định L=3, R=7 -> H=10).
        - Reorder point: s_i = ceil( Q_hat(tau) * exp(m_g + theta_g) ).
        - EOQ_i = max(1.0, round( sqrt( (2 * c * mu_i * 365) / h ), 1 )).
        - Order-up-to level: S_i = s_i + ceil( kappa_g * EOQ_i ).
        - Safety stock: SS_i = max(0.0, s_i - d_L).
        """
        # Xác định ngày mô phỏng hiện tại từ sim_clock
        sim_clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
        if sim_clock and sim_clock.current_date:
            origin_date = sim_clock.current_date
        else:
            first_fc = (
                db.query(Forecast.forecast_date)
                .filter(Forecast.item_id == item_id, Forecast.store_id == store_id)
                .order_by(Forecast.forecast_date.asc())
                .first()
            )
            origin_date = first_fc[0] if first_fc else date.today()

        # Kiểm tra xem SKU có dữ liệu dự báo hoặc doanh số không
        has_forecast = (
            db.query(Forecast.id)
            .filter(Forecast.item_id == item_id, Forecast.store_id == store_id)
            .first()
        ) is not None
        has_sales = (
            db.query(SalesHistory.id)
            .filter(SalesHistory.item_id == item_id, SalesHistory.store_id == store_id)
            .first()
        ) is not None

        if not has_forecast:
            return None

        # 1. Xác định phân nhóm ABC-XYZ của SKU
        cls_record = (
            db.query(SKUClassification)
            .filter(SKUClassification.item_id == item_id)
            .first()
        )
        segment = cls_record.segment if cls_record and cls_record.segment else "AX"

        # 2. Lấy bộ tham số chính sách (m_g, kappa_g) cho phân nhóm
        policy = (
            db.query(PolicySelection)
            .filter(PolicySelection.class_id == segment)
            .order_by(PolicySelection.created_at.desc())
            .first()
        )
        if policy:
            m_g = policy.m_g
            kappa_g = policy.kappa_g
        else:
            def_policy = self.DEFAULT_OPTIMAL_POLICIES.get(segment, {"m_g": 0.0, "kappa_g": 1.0})
            m_g = def_policy["m_g"]
            kappa_g = def_policy["kappa_g"]

        # 3. Lấy hệ số vòng kín theta_g từ bảng calibration_state (mặc định 0.0)
        calib = (
            db.query(CalibrationState)
            .filter(CalibrationState.store_id == store_id, CalibrationState.class_id == segment)
            .order_by(CalibrationState.review_index.desc())
            .first()
        )
        theta_g = calib.theta if calib and calib.theta is not None else 0.0

        # 4. Tính / lấy Route (c) Window Quantile Q_hat(tau) trên cửa sổ H = L + R
        horizon_days = lead_time_days + self.DEFAULT_REVIEW_PERIOD
        q_hat = window_quantile_service.get_tau_quantile_value(
            db=db,
            store_id=store_id,
            item_id=item_id,
            origin_date=origin_date,
            tau=tau,
            horizon_days=horizon_days,
        )

        # 5. Mức sàn Reorder Point: s = ceil( Q_hat * exp(m_g + theta_g) )
        multiplier = math.exp(m_g + theta_g)
        s_val = float(math.ceil(q_hat * multiplier))

        # 6. Nhu cầu trung bình ngày mu_i trên 56 ngày gần nhất
        past_56_cutoff = origin_date - timedelta(days=56)
        avg_sales = (
            db.query(func.avg(SalesHistory.quantity))
            .filter(
                SalesHistory.item_id == item_id,
                SalesHistory.store_id == store_id,
                SalesHistory.sale_date <= origin_date,
                SalesHistory.sale_date >= past_56_cutoff,
            )
            .scalar()
        )
        if avg_sales is not None and avg_sales > 0:
            mean_demand = float(avg_sales)
        else:
            mean_demand = max(0.1, q_hat / max(1, horizon_days))

        # 7. Thông tin đơn giá và chi phí theo Giả định A3 (research.md §3)
        prod = db.query(Product).filter(Product.item_id == item_id).first()
        unit_price = float(prod.price) if prod and prod.price and prod.price > 0 else 10.0
        # Lưu kho năm h_annual = 0.2% * unit_price * 365 = 0.73 * unit_price
        h_cost = max(0.2, round(self.HOLDING_RATE_DAILY * 365.0 * unit_price, 3))
        s_cost = self.ORDER_COST_C  # c = 2.0 mỗi dòng đơn (A3)
        annual_demand = max(1.0, round(mean_demand * 365, 2))

        # 8. Lô kinh tế EOQ chuẩn tắc: sqrt( 2 * c * D / h )
        eoq = max(1.0, round(math.sqrt((2 * annual_demand * s_cost) / h_cost), 1))

        # 9. Mức trần Order-Up-To: S = s + ceil( kappa_g * EOQ )
        S_val = float(s_val + math.ceil(kappa_g * eoq))

        # 10. Dự báo nhu cầu Lead Time (d_L) và Tồn kho an toàn (SS)
        d_l = round(mean_demand * lead_time_days, 2)
        safety_stock = max(0.0, round(s_val - d_l, 2))
        reorder_point = s_val

        return {
            "safety_stock": safety_stock,
            "reorder_point": reorder_point,
            "eoq": eoq,
            "s": s_val,
            "S": S_val,
            "model_run_id": "REFIT-RSS-EOQ-G",
            "annual_demand": annual_demand,
            "holding_cost": h_cost,
            "order_cost": s_cost,
            "unit_price": unit_price,
            "source": "ml",
            "d_l": d_l,
            "sigma_l": round(math.sqrt(lead_time_days) * max(0.2, mean_demand * 0.3), 2),
            "sigma_d": round(max(0.2, mean_demand * 0.3), 2),
            "segment": segment,
            "m_g": m_g,
            "kappa_g": kappa_g,
            "theta_g": theta_g,
            "q_hat": q_hat,
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

        prod = db.query(Product).filter(Product.item_id == item_id).first()
        unit_price = float(prod.price) if prod and prod.price and prod.price > 0 else 10.0

        annual_demand = max(1.0, round(avg_daily * 365, 2))
        h_cost = max(0.2, round(self.HOLDING_RATE_DAILY * 365.0 * unit_price, 3))
        s_cost = self.ORDER_COST_C
        eoq = max(1.0, round(math.sqrt((2 * annual_demand * s_cost) / h_cost), 1))

        s_val = float(math.ceil(reorder_point))
        S_val = float(s_val + math.ceil(eoq))

        return {
            "safety_stock": safety_stock,
            "reorder_point": reorder_point,
            "eoq": eoq,
            "s": s_val,
            "S": S_val,
            "model_run_id": "static-moving-avg",
            "annual_demand": annual_demand,
            "holding_cost": h_cost,
            "order_cost": s_cost,
            "unit_price": unit_price,
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
                s=params.get("s", params["reorder_point"]),
                S=params.get("S", params["reorder_point"] + params["eoq"]),
                model_run_id=params.get("model_run_id", "REFIT-RSS-EOQ-G"),
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
                    s=it.s,
                    S=it.S,
                    model_run_id=it.model_run_id,
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
        # Tối ưu hóa hiệu năng: Bulk query tránh N+1 (giảm từ 297s xuống < 0.2s)
        params = db.query(InventoryParam).filter(InventoryParam.store_id == store_id).all()
        if not params:
            self.recompute_parameters(db, store_id=store_id)
            params = db.query(InventoryParam).filter(InventoryParam.store_id == store_id).all()
        products = db.query(Product).all()
        prod_map = {p.item_id: p for p in products}

        # Bulk query thống kê bán hàng theo SKU
        is_sqlite = db.bind.dialect.name == "sqlite" if db.bind else False
        if is_sqlite:
            from collections import defaultdict
            sales_rows = (
                db.query(SalesHistory.item_id, SalesHistory.quantity)
                .filter(SalesHistory.store_id == store_id)
                .all()
            )
            grouped = defaultdict(list)
            for item_id_val, qty_val in sales_rows:
                grouped[item_id_val].append(float(qty_val or 0.0))
            stats_map = {}
            for item_id_val, q_list in grouped.items():
                arr = np.array(q_list)
                stats_map[item_id_val] = (float(np.mean(arr)), float(np.std(arr)))
        else:
            sales_stats = (
                db.query(
                    SalesHistory.item_id,
                    func.avg(SalesHistory.quantity).label("avg_qty"),
                    func.stddev_pop(SalesHistory.quantity).label("std_qty"),
                )
                .filter(SalesHistory.store_id == store_id)
                .group_by(SalesHistory.item_id)
                .all()
            )
            stats_map = {r[0]: (float(r[1] or 5.0), float(r[2] or 1.0)) for r in sales_stats}

        items: List[CompareParamItem] = []
        total_savings = 0.0
        ss_reduction_percents: List[float] = []

        for p in params:
            prod = prod_map.get(p.item_id)
            prod_name = prod.name if prod else p.item_id
            cat_id = prod.cat_id if prod else "FOODS"

            ml_ss = float(p.safety_stock or 0.0)
            ml_rop = float(p.reorder_point or 0.0)
            ml_eoq = float(p.eoq or 1.0)
            h_cost = float(p.holding_cost or self.DEFAULT_HOLDING_COST)
            o_cost = float(p.order_cost or self.DEFAULT_ORDER_COST)
            lt_days = int(p.lead_time_days or self.DEFAULT_LEAD_TIME)
            tau = float(p.service_level or 0.95)

            # Tính toán tĩnh truyền thống (Moving Average + Phân phối chuẩn)
            avg_daily, sigma_d = stats_map.get(p.item_id, (5.0, 1.0))
            z_score = stats.norm.ppf(tau)
            static_ss = round(z_score * sigma_d * math.sqrt(lt_days), 2)
            static_rop = round(avg_daily * lt_days + static_ss, 2)
            annual_d = avg_daily * 365.0
            static_eoq = max(1.0, round(math.sqrt((2 * annual_d * o_cost) / h_cost), 2))

            ml_holding = round((ml_ss + ml_eoq / 2.0) * h_cost, 2)
            static_holding = round((static_ss + static_eoq / 2.0) * h_cost, 2)
            savings = round(max(0.0, static_holding - ml_holding), 2)
            total_savings += savings

            if static_ss > 0:
                reduct_pct = max(0.0, (static_ss - ml_ss) / static_ss * 100.0)
                ss_reduction_percents.append(reduct_pct)

            items.append(
                CompareParamItem(
                    item_id=p.item_id,
                    product_name=prod_name,
                    store_id=store_id,
                    category=cat_id,
                    lead_time_days=lt_days,
                    service_level=tau,
                    ml_safety_stock=ml_ss,
                    ml_reorder_point=ml_rop,
                    ml_eoq=ml_eoq,
                    ml_annual_holding_cost=ml_holding,
                    static_safety_stock=static_ss,
                    static_reorder_point=static_rop,
                    static_eoq=static_eoq,
                    static_annual_holding_cost=static_holding,
                    ss_difference=round(static_ss - ml_ss, 2),
                    rop_difference=round(static_rop - ml_rop, 2),
                    eoq_difference=round(static_eoq - ml_eoq, 2),
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

    # --- Job J5: Quarterly Policy Selection (Task OPT.2) ---

    def refit_quarterly_policies(
        self,
        db: Session,
        store_id: str = "CA_1",
        selection_id: Optional[str] = None,
        target_availability: float = 0.96,
    ) -> List[Dict[str, Any]]:
        """
        Job J5 - Tái chọn tham số chính sách (m_g, kappa_g) định kỳ theo Quý (Giai đoạn 4 / Task OPT.2):
        - Quét lưới candidate (m in [0.0..0.4], kappa in [0.0..2.0]).
        - Chọn cặp (m_g, kappa_g) có chi phí lưu kho + đặt hàng thấp nhất với Availability >= 0.96.
        - Lưu kết quả vào bảng policy_selection.
        """
        if not selection_id:
            clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
            curr_date = clock.current_date if clock and clock.current_date else date.today()
            q_num = (curr_date.month - 1) // 3 + 1
            selection_id = f"quarter_{curr_date.year}_Q{q_num}"

        # Lưới tham số ứng viên theo nghiên cứu §7.4
        M_GRID = [0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40]
        KAPPA_GRID = [0.5, 1.0, 1.5, 2.0]

        all_classes = ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"]
        results: List[Dict[str, Any]] = []
        now = datetime.now(timezone.utc)

        for class_id in all_classes:
            default_spec = self.DEFAULT_OPTIMAL_POLICIES.get(
                class_id,
                {"m_g": 0.0, "kappa_g": 1.0, "val_cost": 10000.0, "val_service": 0.949},
            )

            # Tìm các SKU thuộc phân nhóm này
            skus = (
                db.query(SKUClassification.item_id)
                .filter(SKUClassification.segment == class_id)
                .all()
            )
            item_ids = [s[0] for s in skus]

            best_m = default_spec["m_g"]
            best_kappa = default_spec["kappa_g"]
            best_cost = default_spec["val_cost"]
            best_service = default_spec["val_service"]
            is_class_feasible = True

            # Nếu có SKU trong nhóm, thực hiện tối ưu thực tế qua quét lưới (research.md §7.4)
            if item_ids:
                cls_stats = (
                    db.query(
                        func.avg(SKUClassification.cv),
                        func.avg(SKUClassification.mean_demand),
                    )
                    .filter(SKUClassification.segment == class_id)
                    .first()
                )
                avg_cv = float(cls_stats[0]) if cls_stats and cls_stats[0] else 0.5
                avg_demand = float(cls_stats[1]) if cls_stats and cls_stats[1] else 5.0

                avg_unit_price = float(
                    (
                        db.query(func.avg(Product.price))
                        .filter(Product.item_id.in_(item_ids))
                        .scalar()
                    )
                    or 3.5
                )

                # Giả định chi phí chuẩn A3 (§7.2)
                h_daily = self.HOLDING_RATE_DAILY * avg_unit_price
                h_annual = max(0.5, h_daily * 365.0)
                b_penalty = self.STOCKOUT_PENALTY_RATE * avg_unit_price
                c_order = self.ORDER_COST_C
                annual_d = max(1.0, avg_demand * 365.0)
                H_days = self.DEFAULT_LEAD_TIME + self.DEFAULT_REVIEW_PERIOD

                # Quét lưới tối ưu hóa tìm min Cost(m, kappa) thỏa mãn Availability >= target + guard
                target_with_guard = target_availability + 0.01  # Guard 1pp per §7.4
                candidates = []

                for m_cand in M_GRID:
                    for k_cand in KAPPA_GRID:
                        # 1. EOQ và kích thước lô đặt hàng
                        eoq_val = max(1.0, math.sqrt((2.0 * annual_d * c_order) / h_annual))
                        batch_size = max(1.0, k_cand * eoq_val)

                        # 2. Safety stock
                        sigma_h = max(0.1, avg_cv * avg_demand * math.sqrt(H_days))
                        z_tau = float(stats.norm.ppf(min(0.999, max(0.5, target_availability))))
                        ss_val = max(0.0, z_tau * sigma_h * math.exp(m_cand))
                        cycle_stock = batch_size / 2.0

                        # 3. Ước tính mức phục vụ thực tế (theo phân phối chuẩn)
                        z_eff = z_tau + (m_cand / max(0.1, avg_cv))
                        est_avail = float(stats.norm.cdf(z_eff))

                        # 4. Chi phí thường niên theo A3 (Holding + Ordering + Stockout)
                        n_orders = annual_d / batch_size
                        c_ordering = n_orders * c_order
                        c_holding = (ss_val + cycle_stock) * h_annual
                        shortage_prob = max(0.0, 1.0 - est_avail)
                        c_shortage = annual_d * shortage_prob * b_penalty

                        tot_cost = round((c_holding + c_ordering + c_shortage) * len(item_ids), 2)
                        is_feas = bool(est_avail >= target_with_guard)

                        candidates.append({
                            "m": m_cand,
                            "kappa": k_cand,
                            "cost": tot_cost,
                            "service": round(est_avail, 4),
                            "is_feasible": is_feas,
                        })

                # Lựa chọn ứng viên tối ưu (research.md §7.4):
                feasible_candidates = [c for c in candidates if c["is_feasible"]]
                if feasible_candidates:
                    best_cand = min(feasible_candidates, key=lambda x: x["cost"])
                    is_class_feasible = True
                else:
                    best_cand = max(candidates, key=lambda x: (x["service"], -x["cost"]))
                    is_class_feasible = False

                best_m = best_cand["m"]
                best_kappa = best_cand["kappa"]
                best_cost = best_cand["cost"]
                best_service = best_cand["service"]

            # Ghi/Cập nhật vào bảng policy_selection
            existing = (
                db.query(PolicySelection)
                .filter(
                    PolicySelection.selection_id == selection_id,
                    PolicySelection.class_id == class_id,
                )
                .first()
            )
            if existing:
                existing.m_g = best_m
                existing.kappa_g = best_kappa
                existing.val_cost = best_cost
                existing.val_service = best_service
                existing.is_feasible = is_class_feasible
                existing.setpoint = target_availability
                existing.created_at = now
            else:
                new_policy = PolicySelection(
                    selection_id=selection_id,
                    class_id=class_id,
                    policy_type="REFIT_RSS_EOQ_G",
                    m_g=best_m,
                    kappa_g=best_kappa,
                    tau=0.95,
                    setpoint=target_availability,
                    guard=0.01,
                    gain_eta=1.0,
                    val_cost=best_cost,
                    val_service=best_service,
                    is_feasible=is_class_feasible,
                    econ_service=0.95,
                    created_at=now,
                )
                db.add(new_policy)

            results.append({
                "selection_id": selection_id,
                "class_id": class_id,
                "policy_type": "REFIT_RSS_EOQ_G",
                "m_g": best_m,
                "kappa_g": best_kappa,
                "val_cost": best_cost,
                "val_service": best_service,
                "is_feasible": is_class_feasible,
                "setpoint": target_availability,
            })

        db.commit()
        return results


optimization_service = OptimizationService()
