from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.forecast import Forecast
from app.models.inventory import Inventory
from app.models.inventory_param import InventoryParam
from app.models.product import Product
from app.models.replenishment import ReplenishmentRecommendation
from app.models.sales_history import SalesHistory
from app.models.supplier import Supplier
from app.models.sim_clock import SimClock
from app.services import policy_config as pc


class DashboardRepository:
    """
    Repository truy vấn và tổng hợp số liệu cho Module B — Dashboard & Alerts (UC07 - UC10).
    """

    def get_kpis(self, db: Session, store_id: Optional[str] = None) -> Dict[str, Any]:
        """
        UC07: Tính toán các KPI tổng quan điều hành (Executive KPIs).
        """
        total_skus = db.query(Product).count()
        total_suppliers = db.query(Supplier).count()

        # Truy vấn tồn kho kèm tham số tối ưu (unit_price, ROP, SS, service_level)
        inv_query = db.query(
            Inventory.item_id,
            Inventory.store_id,
            Inventory.on_hand,
            Inventory.on_order,
            InventoryParam.unit_price,
            InventoryParam.reorder_point,
            InventoryParam.safety_stock,
            InventoryParam.service_level,
        ).outerjoin(
            InventoryParam,
            (Inventory.item_id == InventoryParam.item_id)
            & (Inventory.store_id == InventoryParam.store_id),
        )

        is_global = not store_id or not store_id.strip() or store_id.strip().upper() in ("GLOBAL", "ALL")
        if not is_global:
            inv_query = inv_query.filter(Inventory.store_id == store_id.strip())

        rows = inv_query.all()
        total_monitored = len(rows)

        if total_monitored > 0:
            total_value = sum(
                max(0.0, float(r.on_hand or 0.0)) * float(r.unit_price if r.unit_price is not None else 0.0)
                for r in rows
            )
            stockout_count = sum(1 for r in rows if float(r.on_hand or 0.0) <= 0.0)
            stockout_rate = round((stockout_count / total_monitored) * 100.0, 2)
            # Theo nguyên tắc kiểm soát tồn kho (R, s, S), kiểm tra vị trí tồn kho IP = on_hand + on_order <= s (ROP)
            reorder_alerts_count = sum(
                1 for r in rows if (float(r.on_hand or 0.0) + float(r.on_order or 0.0)) <= float(r.reorder_point if r.reorder_point is not None else 0.0)
            )
            estimated_service_level = round(
                max(0.0, min(100.0, 100.0 - stockout_rate)), 1
            )
        else:
            total_value = 0.0
            stockout_rate = 0.0
            reorder_alerts_count = 0
            estimated_service_level = None  # no inventory rows -> unavailable (never a made-up 95)

        # Đếm số đề xuất đặt hàng đang chờ duyệt (PENDING)
        rep_query = db.query(ReplenishmentRecommendation).filter(
            ReplenishmentRecommendation.status == "PENDING"
        )
        if not is_global:
            rep_query = rep_query.filter(
                ReplenishmentRecommendation.store_id == store_id.strip()
            )
        pending_replenishments = rep_query.count()

        # Lấy chỉ số chính xác thực nghiệm từ Model Registry (BUG-14, N-16)
        from app.models.model_registry import ModelRegistry
        prod_model = (
            db.query(ModelRegistry)
            .filter(ModelRegistry.is_production.is_(True))
            .order_by(ModelRegistry.promoted_at.desc(), ModelRegistry.created_at.desc())
            .first()
        )
        if prod_model and prod_model.metrics:
            if "accuracy" in prod_model.metrics:
                accuracy_display = f"{float(prod_model.metrics['accuracy']) * 100:.1f}%"
            elif "wrmsse" in prod_model.metrics:
                accuracy_display = f"WRMSSE {float(prod_model.metrics['wrmsse']):.4f}"
            elif "mae" in prod_model.metrics:
                accuracy_display = f"MAE {float(prod_model.metrics['mae']):.4f}"
            else:
                accuracy_display = "N/A"
        else:
            accuracy_display = "N/A"

        production_wrmsse = None
        if prod_model and prod_model.metrics and prod_model.metrics.get("wrmsse") is not None:
            production_wrmsse = round(float(prod_model.metrics["wrmsse"]), 4)

        # Orders placed = APPROVED + COMPLETED recommendations whose review date falls in the simulated-clock window
        ord_q = db.query(func.count(ReplenishmentRecommendation.id)).filter(
            ReplenishmentRecommendation.status.in_(["APPROVED", "COMPLETED"])
        )
        clk_q = db.query(func.min(SimClock.start_date), func.max(SimClock.current_date))
        if not is_global:
            ord_q = ord_q.filter(ReplenishmentRecommendation.store_id == store_id.strip())
            clk_q = clk_q.filter(SimClock.store_id == store_id.strip())
        w_start, w_end = clk_q.one()
        if w_start is not None and w_end is not None:
            ord_q = ord_q.filter(
                ReplenishmentRecommendation.review_date > w_start,
                ReplenishmentRecommendation.review_date <= w_end,
            )
        orders_placed = int(ord_q.scalar() or 0)

        return {
            "total_skus": total_skus,
            "total_inventory_value": round(total_value, 2),
            "production_wrmsse": production_wrmsse,
            "production_model_id": prod_model.id if prod_model else None,
            "orders_placed_count": orders_placed,
            "stockout_rate": stockout_rate,
            "estimated_service_level": estimated_service_level,
            "reorder_alerts_count": reorder_alerts_count,
            "pending_replenishments_count": pending_replenishments,
            "avg_forecast_accuracy": accuracy_display,
            "total_suppliers": total_suppliers,
        }

    def get_demand_trend(
        self,
        db: Session,
        store_id: Optional[str] = None,
        category: Optional[str] = None,
        days: int = 30,
        granularity: str = "daily",
        meta: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        UC08: Tổng hợp chuỗi xu hướng nhu cầu thực tế và dự báo theo ngày/tuần/tháng.
        U-04: actuals <= clock date; forecasts only when their ORIGIN (day before the first forecast date)
        is <= clock date (a forecast run made after the clock is look-ahead and is not shown). ``meta`` (dict)
        receives ``as_of`` and ``forecast_note``.
        """
        is_global = not store_id or not store_id.strip() or store_id.strip().upper() in ("GLOBAL", "ALL")

        # Xác định mốc thời gian căn cứ theo sim_clock
        if not is_global:
            target_store = store_id.strip()
            clock = db.query(SimClock).filter(SimClock.store_id == target_store).first()
            clock_date = clock.current_date if clock and clock.current_date else None
            if not clock_date:
                max_sale = db.query(func.max(SalesHistory.sale_date)).filter(SalesHistory.store_id == target_store).scalar()
                clock_date = max_sale if max_sale else pc.DEMO_START_DATE  # one demo-date convention (P-35)
        else:
            clock_max = db.query(func.max(SimClock.current_date)).scalar()
            clock_date = clock_max if clock_max else None
            if not clock_date:
                max_sale = db.query(func.max(SalesHistory.sale_date)).scalar()
                clock_date = max_sale if max_sale else pc.DEMO_START_DATE

        # 1. Truy vấn lịch sử bán hàng thực tế gần nhất (đến mốc clock_date)
        sales_q = db.query(
            SalesHistory.sale_date,
            func.sum(SalesHistory.quantity).label("total_qty"),
        )
        if not is_global:
            sales_q = sales_q.filter(SalesHistory.store_id == target_store, SalesHistory.sale_date <= clock_date)
        else:
            sales_q = sales_q.filter(SalesHistory.sale_date <= clock_date)

        if category and category.strip() and category.strip().upper() != "ALL":
            sales_q = sales_q.join(Product, SalesHistory.item_id == Product.item_id).filter(
                or_(
                    Product.cat_id == category.strip(),
                    Product.dept_id == category.strip(),
                )
            )

        sales_rows = (
            sales_q.group_by(SalesHistory.sale_date)
            .order_by(SalesHistory.sale_date.desc())
            .limit(days)
            .all()
        )

        actual_map: Dict[str, float] = {
            str(r.sale_date): round(float(r.total_qty or 0.0), 1)
            for r in reversed(sales_rows)
        }

        # 2. Truy vấn dự báo nhu cầu tương lai (từ mốc clock_date)
        # R-20: Lọc theo model_version production để tránh cộng dồn nhiều mô hình làm vọt dữ liệu dự báo
        from app.models.model_registry import ModelRegistry
        prod_model = (
            db.query(ModelRegistry)
            .filter(ModelRegistry.is_production.is_(True))
            .order_by(ModelRegistry.promoted_at.desc(), ModelRegistry.created_at.desc())
            .first()
        )

        fc_q = db.query(
            Forecast.forecast_date,
            func.sum(Forecast.y_pred).label("total_pred"),
        )
        if prod_model and prod_model.algorithm:
            has_prod_fc = db.query(Forecast.id).filter(Forecast.model_version.ilike(f"%{prod_model.algorithm}%")).first()
            if has_prod_fc:
                fc_q = fc_q.filter(Forecast.model_version.ilike(f"%{prod_model.algorithm}%"))
            else:
                fc_q = fc_q.filter(~Forecast.model_version.ilike("%fast-inference%"))
        else:
            fc_q = fc_q.filter(~Forecast.model_version.ilike("%fast-inference%"))

        if not is_global:
            fc_q = fc_q.filter(Forecast.store_id == target_store, Forecast.forecast_date >= clock_date)
        else:
            fc_q = fc_q.filter(Forecast.forecast_date >= clock_date)
        # U-04: origin of the forecast run = the day before its first forecast date
        first_fc_date = fc_q.with_entities(func.min(Forecast.forecast_date)).scalar()
        has_clock = (
            db.query(SimClock.store_id).filter(SimClock.store_id == target_store).first() is not None
            if not is_global else db.query(SimClock.store_id).first() is not None
        )
        forecast_hidden = bool(
            has_clock and first_fc_date is not None and (first_fc_date - timedelta(days=1)) > clock_date
        )
        if meta is not None:
            meta["as_of"] = str(clock_date)
            meta["forecast_note"] = (
                f"Forecasts start on {first_fc_date} (origin {first_fc_date - timedelta(days=1)}), after the "
                f"simulated clock ({clock_date}): hidden until the clock reaches the forecast origin."
                if forecast_hidden else None
            )
        if forecast_hidden:
            fc_q = fc_q.filter(Forecast.forecast_date < date(1900, 1, 1))

        if category and category.strip() and category.strip().upper() != "ALL":
            fc_q = fc_q.join(Product, Forecast.item_id == Product.item_id).filter(
                or_(
                    Product.cat_id == category.strip(),
                    Product.dept_id == category.strip(),
                )
            )

        fc_rows = (
            fc_q.group_by(Forecast.forecast_date)
            .order_by(Forecast.forecast_date.asc())
            .limit(days)
            .all()
        )

        predicted_map: Dict[str, float] = {
            str(r.forecast_date): round(float(r.total_pred or 0.0), 1)
            for r in fc_rows
        }

        # 3. Tổng hợp thành danh sách các mốc thời gian liền mạch
        all_dates = sorted(set(list(actual_map.keys()) + list(predicted_map.keys())))

        if not all_dates:
            return []

        trend_data = []
        for d_str in all_dates:
            trend_data.append({
                "date": d_str,
                "actual": actual_map.get(d_str),
                "predicted": predicted_map.get(d_str),
            })

        return trend_data

    def get_stock_alerts(
        self,
        db: Session,
        store_id: Optional[str] = None,
        severity: Optional[str] = None,
        limit: Optional[int] = 50,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, int], int]:
        """
        UC09: Bảng cảnh báo tồn kho traffic-light so sánh với SS và ROP.

        Round 5 (U-01 request 3): the severity is computed IN SQL (CASE on on_hand / IP / SS / ROP), the summary is
        ONE aggregate query (GROUP BY severity) and only the requested page is fetched (ORDER BY severity rank,
        store, item + OFFSET/LIMIT). ``limit=5`` no longer materialises every inventory row in Python.
        Rules (B-08/B-09, unchanged): on_hand <= 0 -> CRITICAL; on_hand <= SS and IP <= ROP -> CRITICAL;
        IP <= ROP -> WARNING; else HEALTHY (missing SS/ROP count as 0).
        """
        oh = func.coalesce(Inventory.on_hand, 0.0)
        ip = oh + func.coalesce(Inventory.on_order, 0.0)
        ss = func.coalesce(InventoryParam.safety_stock, 0.0)
        rop = func.coalesce(InventoryParam.reorder_point, 0.0)
        sev_rank = case(
            (oh <= 0.0, 0),
            (and_(oh <= ss, ip <= rop), 1),
            (ip <= rop, 2),
            else_=3,
        ).label("sev_rank")  # 0/1 = CRITICAL (out of stock / below SS and ROP), 2 = WARNING, 3 = HEALTHY

        is_global = not store_id or not store_id.strip() or store_id.strip().upper() in ("GLOBAL", "ALL")

        def _scoped(q):
            q = q.outerjoin(
                InventoryParam,
                (Inventory.item_id == InventoryParam.item_id) & (Inventory.store_id == InventoryParam.store_id),
            )
            return q if is_global else q.filter(Inventory.store_id == store_id.strip())

        counts = {0: 0, 1: 0, 2: 0, 3: 0}
        for rank, n in _scoped(db.query(sev_rank, func.count()).select_from(Inventory)).group_by(sev_rank).all():
            counts[int(rank)] = int(n)
        summary_counts = {
            "critical_count": counts[0] + counts[1],
            "warning_count": counts[2],
            "healthy_count": counts[3],
            "total_monitored": sum(counts.values()),
        }

        target_sev = severity.strip().upper() if severity and severity.strip() else None
        ranks = {"CRITICAL": (0, 1), "WARNING": (2,), "HEALTHY": (3,)}.get(target_sev or "", (0, 1, 2, 3))
        total = sum(counts[r] for r in ranks)

        page_q = _scoped(
            db.query(
                Inventory.item_id,
                func.coalesce(Product.name, Inventory.item_id).label("product_name"),
                Product.cat_id.label("category"),
                Inventory.store_id,
                Inventory.on_hand,
                Inventory.on_order,
                InventoryParam.safety_stock,
                InventoryParam.reorder_point,
                Inventory.updated_at,
                sev_rank,
            ).outerjoin(Product, Inventory.item_id == Product.item_id)
        )
        if len(ranks) < 4:
            page_q = page_q.filter(sev_rank.in_(ranks))
        # CRITICAL first (both CRITICAL ranks together), then WARNING, then HEALTHY; deterministic tiebreak
        page_q = page_q.order_by(
            case((sev_rank <= 1, 0), (sev_rank == 2, 1), else_=2), Inventory.store_id, Inventory.item_id
        ).offset(offset)
        if limit is not None:
            page_q = page_q.limit(limit)

        items: List[Dict[str, Any]] = []
        for r in page_q.all():
            on_hand = float(r.on_hand or 0.0)
            on_order = float(r.on_order or 0.0)
            ss_v = float(r.safety_stock) if r.safety_stock is not None else 0.0
            rop_v = float(r.reorder_point) if r.reorder_point is not None else 0.0
            ip_v = on_hand + on_order
            rank = int(r.sev_rank)
            if rank == 0:
                sev, code = "CRITICAL", "out_of_stock"
                action = f"Rủi ro đứt hàng tức thì trên kệ (On-hand: {int(on_hand)}). Cần xử lý khẩn cấp."
            elif rank == 1:
                sev, code = "CRITICAL", "below_ss_and_rop"
                action = f"Nguy cơ đứt hàng (On-hand <= SS: {int(ss_v)}, IP <= ROP). Cần tạo PO khẩn."
            elif rank == 2:
                sev, code = "WARNING", "ip_below_rop"
                action = f"Vị trí tồn kho IP ({int(ip_v)}) <= ROP ({int(rop_v)}). Đề xuất đặt hàng bổ sung."
            else:
                sev, code = "HEALTHY", "healthy"
                action = "Tồn kho trong ngưỡng an toàn."
            items.append({
                "item_id": r.item_id,
                "product_name": r.product_name,
                "category": r.category or "General",
                "store_id": r.store_id,
                "on_hand": on_hand,
                "on_order": on_order,
                "safety_stock": ss_v,
                "reorder_point": rop_v,
                "severity": sev,
                "suggested_action": action,
                "suggested_action_code": code,
                "suggested_action_params": {
                    "on_hand": on_hand, "safety_stock": ss_v, "inventory_position": ip_v, "reorder_point": rop_v,
                },
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            })
        return items, summary_counts, total

    def find_or_create_alert(
        self,
        db: Session,
        item_id: str,
        store_id: str,
        alert_type: str,
        message: str,
    ) -> Tuple[Alert, bool]:
        """
        UC10: Tạo cảnh báo trong bảng alerts nếu chưa tồn tại cảnh báo chưa đọc (deduplication).
        B-21: Đồng bộ enum alert (STOCK_CRITICAL/STOCK_WARNING) và hỗ trợ alias cũ.
        """
        canonical_type = "STOCK_CRITICAL" if alert_type in ("CRITICAL_OUT_OF_STOCK", "STOCK_CRITICAL") else (
            "STOCK_WARNING" if alert_type in ("WARNING_LOW_STOCK", "STOCK_WARNING") else alert_type
        )
        alias_types = {alert_type, canonical_type}
        if canonical_type == "STOCK_CRITICAL":
            alias_types.add("CRITICAL_OUT_OF_STOCK")
        elif canonical_type == "STOCK_WARNING":
            alias_types.add("WARNING_LOW_STOCK")

        existing = (
            db.query(Alert)
            .filter(
                Alert.item_id == item_id,
                Alert.store_id == store_id,
                Alert.type.in_(list(alias_types)),
                Alert.is_read.is_(False),
            )
            .first()
        )
        if existing:
            return existing, False

        new_alert = Alert(
            item_id=item_id,
            store_id=store_id,
            type=canonical_type,
            message=message,
            is_read=False,
            created_at=datetime.now(timezone.utc),
        )
        db.add(new_alert)
        db.commit()
        db.refresh(new_alert)
        return new_alert, True


dashboard_repository = DashboardRepository()
