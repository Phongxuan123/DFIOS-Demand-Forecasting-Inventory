import logging
from datetime import date, timedelta, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.events import event_bus
from app.repositories import price_history_repository
from app.repositories.dashboard_repository import dashboard_repository
from app.models.alert import Alert
from app.schemas.dashboard import (
    AlertSummary,
    DashboardAlertsResponse,
    DashboardKPIs,
    DashboardOverviewResponse,
    DemandTrendPoint,
    DemandTrendResponse,
    InventoryAlertItem,
    RealtimeStockAlertTriggerResponse,
)
from app.schemas.event import create_stock_alert_event
from app.schemas.kpi_dashboard import CostCurvePoint, InsightDetail, SegmentAvailability, KPIDashboardResponse
from app.models.sim_clock import SimClock
from app.models.service_outcomes import ServiceOutcome
from app.models.classification import SKUClassification
from app.models.product import Product
from app.models.inventory_daily import InventoryDaily
from app.models.replenishment import ReplenishmentRecommendation
from app.services.calibrator_service import calibrator_service
from app.services.optimization_service import optimization_service
from app.services import policy_config as pc
from app.models.inventory import Inventory
from app.models.sim_state import SimShadowDaily

logger = logging.getLogger(__name__)

# Round 5 (U-06): every Vietnamese reason of the KPI dashboard / reports has a STABLE code (`*_reason_code`).
KPI_REASONS: Dict[str, str] = {
    "no_clock": "Không có sim_clock cho phạm vi yêu cầu.",
    "no_closed_cycle": "Chưa có chu kỳ review nào được đóng (service_outcomes); tua đồng hồ ít nhất 1 kỳ review (7 ngày).",
    "no_shadow": (
        "B0 shadow chưa được mô phỏng song song cho giai đoạn này (đồng hồ tua trước khi có shadow); "
        "reset đồng hồ và tua lại để có B0."
    ),
    "no_shadow_cost": "B0 shadow chưa có dữ liệu chi phí: reset đồng hồ và tua lại.",
    "no_simulated_days": "Chưa có inventory_daily trong cửa sổ mô phỏng (đồng hồ chưa tua): chưa tính được chi phí A3.",
}
_KPI_REASON_CODES = {v: k for k, v in KPI_REASONS.items()}


def kpi_reason_code(reason: Optional[str]) -> Optional[str]:
    """Stable code of a KPI reason text (None for no reason, 'other' for a text without a code)."""
    if not reason:
        return None
    return _KPI_REASON_CODES.get(reason, "other")


def valued_stock_sums(
    db: Session, model, stores: List[str], start: date, end: date, by: Optional[str] = "date",
) -> Dict[Any, Tuple[float, float]]:
    """{key: (sum on_hand_end * price, sum lost_sales * price)} of ``model`` (inventory_daily / sim_shadow_daily)
    rows of ``stores`` on [start, end] (inclusive), every row valued at the price of ITS date (G-37).

    ``by`` = "date" (key = date), "cat" (key = upper-cased category, "UNKNOWN" when none) or None (one key None).
    Stores without any price_history row keep the original single SQL aggregate over ``products.price`` (identical
    numbers); a store with daily prices reads its rows once and prices them with ONE ``price_matrix`` call (daily row,
    else products.price; a row without any price contributes 0, like the NULL price of the SQL join)."""
    sums: Dict[Any, List[float]] = {}
    priced = [s for s in stores if price_history_repository.has_prices(db, s)]
    plain = [s for s in stores if s not in set(priced)]

    if plain:
        cols = [func.sum(model.on_hand_end * Product.price), func.sum(model.lost_sales * Product.price)]
        if by == "date":
            key_col = model.date
        elif by == "cat":
            key_col = func.coalesce(Product.cat_id, "UNKNOWN")
        else:
            key_col = None
        q = db.query(*([key_col] if key_col is not None else []), *cols).join(
            Product, Product.item_id == model.item_id
        ).filter(model.store_id.in_(plain), model.date >= start, model.date <= end)
        if key_col is not None:
            for k, hv, lv in q.group_by(key_col).all():
                k = str(k).upper() if by == "cat" else k
                acc = sums.setdefault(k, [0.0, 0.0])
                acc[0] += float(hv or 0.0)
                acc[1] += float(lv or 0.0)
        else:
            hv, lv = q.one()
            if hv is not None or lv is not None:
                acc = sums.setdefault(None, [0.0, 0.0])
                acc[0] += float(hv or 0.0)
                acc[1] += float(lv or 0.0)

    # E7: one SQL aggregate per priced store (the database joins each row to its day's price) instead of reading
    # every row and every daily price into Python (~10 s on a full replay year, now well under a second).
    # Same rule as price_history_repository.price_matrix: the day's price_history row when > 0, else
    # products.price when > 0, else no price (the row contributes 0). A key exists when at least one of its rows is
    # priced or has a product (the SQL inner-join semantics of the plain branch).
    if priced and (end - start).days >= 0:
        from sqlalchemy import and_, case, or_

        from app.models.price_history import PriceHistory

        price = case((PriceHistory.price > 0, PriceHistory.price), (Product.price > 0, Product.price), else_=None)
        counted = func.sum(case((or_(price.is_not(None), Product.item_id.is_not(None)), 1), else_=0))
        if by == "date":
            key_col = model.date
        elif by == "cat":
            key_col = func.upper(func.coalesce(Product.cat_id, "UNKNOWN"))
        else:
            key_col = None
        cols = [func.sum(model.on_hand_end * price), func.sum(model.lost_sales * price), counted]
        q = (
            db.query(*([key_col] if key_col is not None else []), *cols)
            .select_from(model)
            .outerjoin(Product, Product.item_id == model.item_id)
            .outerjoin(PriceHistory, and_(PriceHistory.store_id == model.store_id,
                                          PriceHistory.item_id == model.item_id, PriceHistory.date == model.date,
                                          # same rows, but lets PostgreSQL read only the period's prices
                                          PriceHistory.date >= start, PriceHistory.date <= end))
            .filter(model.store_id.in_(priced), model.date >= start, model.date <= end)
        )
        rows = q.group_by(key_col).all() if key_col is not None else [(None, *q.one())]
        for k, hv, lv, n in rows:
            if not n:
                continue
            acc = sums.setdefault(k, [0.0, 0.0])
            acc[0] += float(hv or 0.0)
            acc[1] += float(lv or 0.0)
    return {k: (v[0], v[1]) for k, v in sums.items()}


class DashboardService:
    """
    Service nghiệp vụ cho Module B — Dashboard & Alerts (UC07 - UC10).
    """

    def get_kpis(self, db: Session, store_id: Optional[str] = None) -> DashboardKPIs:
        """
        UC07: Lấy các chỉ số KPI điều hành tổng thể.
        """
        raw_kpis = dashboard_repository.get_kpis(db, store_id=store_id)
        return DashboardKPIs(**raw_kpis)

    def get_demand_trend(
        self,
        db: Session,
        store_id: Optional[str] = None,
        category: Optional[str] = None,
        days: int = 30,
        granularity: str = "daily",
    ) -> DemandTrendResponse:
        """
        UC08: Lấy chuỗi xu hướng nhu cầu bán hàng và dự báo.
        """
        meta: Dict[str, Any] = {}
        trend_rows = dashboard_repository.get_demand_trend(
            db,
            store_id=store_id,
            category=category,
            days=days,
            granularity=granularity,
            meta=meta,
        )
        points = [DemandTrendPoint(**r) for r in trend_rows]
        return DemandTrendResponse(
            granularity=granularity,
            store_id=store_id,
            category=category,
            data=points,
            as_of=meta.get("as_of"),
            forecast_note=meta.get("forecast_note"),
            forecast_source=meta.get("forecast_source"),
            forecast_past_horizon=meta.get("forecast_past_horizon"),
            forecast_as_of=meta.get("forecast_as_of"),
        )

    def get_alerts(
        self,
        db: Session,
        store_id: Optional[str] = None,
        severity: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> DashboardAlertsResponse:
        """
        UC09: Lấy bảng cảnh báo tồn kho traffic-light so sánh với SS và ROP.
        """
        items, summary_counts, total = dashboard_repository.get_stock_alerts(
            db,
            store_id=store_id,
            severity=severity,
            limit=limit,
            offset=offset,
        )
        alert_items = [InventoryAlertItem(**it) for it in items]
        summary = AlertSummary(**summary_counts)
        return DashboardAlertsResponse(
            summary=summary,
            items=alert_items,
            total=total,
        )

    def trigger_realtime_stock_alerts(
        self,
        db: Session,
        store_id: Optional[str] = None,
    ) -> RealtimeStockAlertTriggerResponse:
        """
        UC10: Quét kho và phát sự kiện cảnh báo thời gian thực qua Server-Sent Events (SSE).
        Sử dụng cơ chế Bulk Query và Bulk Commit để xử lý nhanh dưới 2s thay vì N+1 queries.
        Có cơ chế chống spam trùng lặp cho các cảnh báo chưa xử lý.
        Thực thi đồng bộ an toàn qua threadpool tránh chặn event loop (B-10).
        """
        items, _, _ = dashboard_repository.get_stock_alerts(
            db,
            store_id=store_id,
            severity=None,
            limit=None,
            offset=0,
        )

        critical_or_warning = [
            it for it in items if it["severity"] in ("CRITICAL", "WARNING")
        ]

        if not critical_or_warning:
            return RealtimeStockAlertTriggerResponse(
                alerts_generated=0,
                broadcast_count=0,
            )

        # 1. Bulk query các alert chưa đọc để chống trùng lặp trong 1 lần truy vấn
        target_stores = list({it["store_id"] for it in critical_or_warning})
        target_items = list({it["item_id"] for it in critical_or_warning})
        existing_alerts = (
            db.query(Alert.item_id, Alert.store_id, Alert.type)
            .filter(
                Alert.store_id.in_(target_stores),
                Alert.item_id.in_(target_items),
                Alert.is_read.is_(False),
            )
            .all()
        )
        existing_set = set()
        for a in existing_alerts:
            existing_set.add((a.item_id, a.store_id, a.type))
            if a.type in ("CRITICAL_OUT_OF_STOCK", "STOCK_CRITICAL"):
                existing_set.add((a.item_id, a.store_id, "STOCK_CRITICAL"))
                existing_set.add((a.item_id, a.store_id, "CRITICAL_OUT_OF_STOCK"))
            elif a.type in ("WARNING_LOW_STOCK", "STOCK_WARNING"):
                existing_set.add((a.item_id, a.store_id, "STOCK_WARNING"))
                existing_set.add((a.item_id, a.store_id, "WARNING_LOW_STOCK"))

        # 2. Gom các alert mới và sự kiện broadcast
        new_alerts: List[Alert] = []
        events_to_broadcast = []
        now = datetime.now(timezone.utc)

        for it in critical_or_warning:
            alert_type = f"STOCK_{it['severity']}"
            key = (it["item_id"], it["store_id"], alert_type)

            if key not in existing_set:
                msg = (
                    f"[{it['severity']}] SKU '{it['item_id']}' at store '{it['store_id']}': "
                    f"On-hand {it['on_hand']} <= threshold (SS: {it['safety_stock']}, ROP: {it['reorder_point']})."
                )

                new_alerts.append(
                    Alert(
                        item_id=it["item_id"],
                        store_id=it["store_id"],
                        type=alert_type,
                        message=msg,
                        is_read=False,
                        created_at=now,
                    )
                )
                existing_set.add(key)

                event = create_stock_alert_event(
                    item_id=it["item_id"],
                    store_id=it["store_id"],
                    severity=it["severity"],
                    on_hand=it["on_hand"],
                    reorder_point=it["reorder_point"],
                    safety_stock=it["safety_stock"],
                    message=msg,
                )
                events_to_broadcast.append(event)

        # 3. Bulk commit vào database trong một transaction duy nhất
        alerts_generated = 0
        if new_alerts:
            db.add_all(new_alerts)
            db.commit()
            alerts_generated = len(new_alerts)

        # 4. Phát sự kiện realtime qua SSE bằng publish_nowait không khóa event loop
        broadcast_count = 0
        for event in events_to_broadcast:
            try:
                event_bus.publish_nowait(event)
                broadcast_count += 1
            except Exception as e:  # noqa: BLE001 - one bad SSE subscriber must not stop the others (logged)
                logger.warning(f"Error publishing stock alert event: {e}")

        return RealtimeStockAlertTriggerResponse(
            alerts_generated=alerts_generated,
            broadcast_count=broadcast_count,
        )

    def get_overview(
        self,
        db: Session,
        store_id: Optional[str] = None,
    ) -> DashboardOverviewResponse:
        """
        Tổng hợp toàn bộ chỉ số, biểu đồ và cảnh báo gần nhất để trả về cho Dashboard UI.
        """
        kpi_obj = self.get_kpis(db, store_id=store_id)
        trend_obj = self.get_demand_trend(db, store_id=store_id, days=30)
        alerts_obj = self.get_alerts(db, store_id=store_id, limit=10, offset=0)

        kpis_dict = {
            "totalSkus": kpi_obj.total_skus,
            "totalSuppliers": kpi_obj.total_suppliers,
            "reorderAlerts": kpi_obj.reorder_alerts_count,
            "avgForecastAccuracy": kpi_obj.avg_forecast_accuracy,
            "stockoutRate": f"{kpi_obj.stockout_rate}%",
            "totalInventoryValue": kpi_obj.total_inventory_value,
            "pendingReplenishments": kpi_obj.pending_replenishments_count,
        }

        # Định dạng trend data cho Recharts
        forecast_trend = [
            {
                "date": p.date,
                "actual": p.actual,
                "lightgbm": p.predicted,  # null when no forecast exists (never substituted by the actual)
            }
            for p in trend_obj.data
        ]

        inventory_health = [
            {
                "name": "Healthy In Stock",
                "value": alerts_obj.summary.healthy_count,
                "color": "#0d9488",
            },
            {
                "name": "Low Stock",
                "value": alerts_obj.summary.warning_count,
                "color": "#f59e0b",
            },
            {
                "name": "Critical / Out",
                "value": alerts_obj.summary.critical_count,
                "color": "#ef4444",
            },
        ]

        urgency_list = [
            {
                "sku": it.item_id,
                "name": it.product_name,
                "urgency": (
                    100
                    if it.on_hand <= 0
                    else max(
                        15,
                        min(
                            95,
                            int(100 - (it.on_hand / max(1.0, it.reorder_point) * 50)),
                        ),
                    )
                ),
                "color": (
                    "#ef4444"
                    if it.severity == "CRITICAL"
                    else ("#f59e0b" if it.severity == "WARNING" else "#0d9488")
                ),
            }
            for it in alerts_obj.items[:5]
        ]

        recent_alerts = [
            {
                "status": it.severity,
                "statusClass": (
                    "danger"
                    if it.severity == "CRITICAL"
                    else ("warning" if it.severity == "WARNING" else "success")
                ),
                "name": it.item_id,
                "location": it.store_id,
                "details": f"On-hand: {it.on_hand} | ROP: {it.reorder_point} | SS: {it.safety_stock}",
                "actionText": "Inspect",
            }
            for it in alerts_obj.items[:6]
        ]

        return DashboardOverviewResponse(
            kpis=kpis_dict,
            charts={
                "forecastTrend": forecast_trend,
                "inventoryHealth": inventory_health,
                "urgency": urgency_list,
            },
            recent_alerts=recent_alerts,
        )

    # --- Task API.4: Dashboard KPI & Shadow Baseline B0 ---

    @staticmethod
    def _daily_costs(db: Session, model, stores: List[str], start: date, end: date) -> Dict[date, Tuple[float, float]]:
        """{date: (holding, shortage)} in A3 money: h*price*on_hand_end, b*price*lost, summed over SKUs, each day
        valued at the price of that day (G-37: price_history, else products.price)."""
        sums = valued_stock_sums(db, model, stores, start, end, by="date")
        return {
            d: (hv * pc.HOLDING_RATE_DAILY, lv * pc.STOCKOUT_PENALTY_RATE)
            for d, (hv, lv) in sums.items()
        }

    def _availability_by_class(
        self, db: Session, stores: List[str], start: date, end: date, R: int
    ) -> Tuple[Dict[str, Dict[str, Any]], Optional[str], Optional[str]]:
        """
        Observed availability per ABC-XYZ class over the CLOSED cycles of service_outcomes (C3-OUT) and the same
        cycles of the shadow B0. Returns ({class: {...}}, c3_reason, b0_reason).
        """
        so = (
            db.query(
                ServiceOutcome.store_id, ServiceOutcome.class_id, ServiceOutcome.cycle_index,
                ServiceOutcome.n_sku, ServiceOutcome.n_stockout,
                ServiceOutcome.cycle_start, ServiceOutcome.cycle_end,
            )
            .filter(
                ServiceOutcome.store_id.in_(stores),
                ServiceOutcome.cycle_start >= start,
                ServiceOutcome.cycle_end <= end,
            )
            .all()
        )
        out: Dict[str, Dict[str, Any]] = {
            c: {"n_sku": 0, "n_periods": 0, "c3_stockout": 0, "b0_stockout": None} for c in pc.ALL_CLASSES
        }
        if not so:
            reason = KPI_REASONS["no_closed_cycle"]
            return out, reason, reason
        # G-01: a closed cycle is [cycle_start, cycle_end] as stored by J6 (days t_k + L .. t_k + L + R - 1); the
        # shadow B0 is scored on exactly the same days, so no review-period arithmetic is redone here.
        closed: Dict[Tuple[str, int], Tuple[date, date]] = {}
        for r in so:
            if r.cycle_start is not None and r.cycle_end is not None:
                closed[(r.store_id, int(r.cycle_index))] = (r.cycle_start, r.cycle_end)
        windows: Dict[str, List[Tuple[date, date, int]]] = {}
        for (st, k), (cs, ce) in closed.items():
            windows.setdefault(st, []).append((cs, ce, k))
        for r in so:
            if r.class_id in out:
                out[r.class_id]["n_periods"] += int(r.n_sku or 0)
                out[r.class_id]["c3_stockout"] += int(r.n_stockout or 0)
                out[r.class_id]["n_sku"] = max(out[r.class_id]["n_sku"], int(r.n_sku or 0))

        has_shadow = (
            db.query(func.count(SimShadowDaily.item_id))
            .filter(SimShadowDaily.store_id.in_(stores), SimShadowDaily.date >= start)
            .scalar()
        )
        if not has_shadow:
            return out, None, KPI_REASONS["no_shadow"]
        # B0: stocked-out SKU-cycles (on_hand_end <= 0 on at least one day of the cycle) of the same closed cycles
        sh_rows = (
            db.query(SimShadowDaily.store_id, SimShadowDaily.item_id, SimShadowDaily.date)
            .filter(SimShadowDaily.store_id.in_(stores), SimShadowDaily.date >= start, SimShadowDaily.date <= end,
                    SimShadowDaily.on_hand_end <= 0)
            .all()
        )
        seg_of: Dict[Tuple[str, str], str] = {}
        seg_any: Dict[str, str] = {}
        for item_id, seg, st in db.query(
            SKUClassification.item_id, SKUClassification.segment, SKUClassification.store_id
        ).all():
            seg_any.setdefault(item_id, seg)
            if st:
                seg_of[(st, item_id)] = seg
        seen = set()
        b0 = {c: 0 for c in pc.ALL_CLASSES}
        for st, item_id, d in sh_rows:
            for cs, ce, k in windows.get(st, ()):
                if not (cs <= d <= ce) or (st, item_id, k) in seen:
                    continue
                seen.add((st, item_id, k))
                seg = seg_of.get((st, item_id)) or seg_any.get(item_id)
                if seg in b0:
                    b0[seg] += 1
        for c in pc.ALL_CLASSES:
            out[c]["b0_stockout"] = b0[c]
        return out, None, None

    @staticmethod
    def _fill_rate(db: Session, model, stores: List[str], start: date, end: date) -> Optional[float]:
        """Fill rate in percent: Σ sold / Σ (sold + lost) over the simulated days; None without demand."""
        sold, lost = (
            db.query(func.sum(model.sales), func.sum(model.lost_sales))
            .filter(model.store_id.in_(stores), model.date >= start, model.date <= end)
            .one()
        )
        demand = float(sold or 0.0) + float(lost or 0.0)
        return round(float(sold or 0.0) / demand * 100.0, 1) if demand > 0 else None

    @staticmethod
    def _classes_below_recent(
        db: Session, stores: List[str], start: date, end: date, target_pct: float, n_cycles: int = 4
    ) -> Tuple[Optional[int], Optional[int], int]:
        """Classes whose availability over the last ``n_cycles`` CLOSED cycles (per store) is below the commitment.
        Returns (n_below, n_measured, cycles_used); (None, None, 0) before the first closed cycle."""
        rows = (
            db.query(ServiceOutcome.store_id, ServiceOutcome.class_id, ServiceOutcome.cycle_index,
                     ServiceOutcome.n_sku, ServiceOutcome.n_stockout)
            .filter(ServiceOutcome.store_id.in_(stores), ServiceOutcome.cycle_start >= start,
                    ServiceOutcome.cycle_end <= end)
            .all()
        )
        if not rows:
            return None, None, 0
        recent: Dict[str, set] = {}
        for st in {r.store_id for r in rows}:
            ks = sorted({int(r.cycle_index) for r in rows if r.store_id == st})
            recent[st] = set(ks[-n_cycles:])
        per: Dict[str, List[int]] = {}
        for r in rows:
            if int(r.cycle_index) in recent.get(r.store_id, ()):
                acc = per.setdefault(r.class_id, [0, 0])
                acc[0] += int(r.n_sku or 0)
                acc[1] += int(r.n_stockout or 0)
        measured = {c: (1.0 - so / n) * 100.0 for c, (n, so) in per.items() if n}
        below = sum(1 for v in measured.values() if v < target_pct)
        used = max((len(v) for v in recent.values()), default=0)
        return below, len(measured), used

    def get_shadow_baseline_dashboard(
        self, db: Session, store_id: str = "CA_1"
    ) -> KPIDashboardResponse:
        """
        Task API.4 - Cumulative A3 cost, availability of the 9 classes and the SHADOW baseline B0.
        N-03: B0 is simulated in parallel by ``/clock/advance`` (sim_shadow_daily), NOT derived from C3 x fixed
        ratios or tables. Every unavailable metric is null + reason. P-22: GLOBAL aggregates theta over stores,
        ordering cost counts only placed orders (APPROVED / COMPLETED), target comes from system settings.
        """
        is_global = not store_id or not store_id.strip() or store_id.strip().upper() in ("GLOBAL", "ALL")
        target_store = "GLOBAL" if is_global else store_id.strip()
        R = pc.REVIEW_PERIOD_DAYS
        pc.sync_costs(db)  # demo.md §1.3: A3 costs valued with the configured h, b, c

        clocks = db.query(SimClock).all() if is_global else db.query(SimClock).filter(SimClock.store_id == target_store).all()
        if not clocks:
            no_clock = KPI_REASONS["no_clock"]
            return KPIDashboardResponse(
                store_id=store_id, current_date=pc.DEMO_START_DATE, days_elapsed=0, reviews_elapsed=0,
                segment_availabilities=[
                    SegmentAvailability(
                        class_id=c, target=round(float(optimization_service.get_service_level_config(db).default_service_level) * 100.0, 1),
                        theta=0.0, multiplier=1.0, status="NOT_MEASURED",
                    )
                    for c in pc.ALL_CLASSES
                ],
                cost_curves=[],
                summary_insights=[f"Chưa có đồng hồ mô phỏng cho '{target_store}': không có số liệu KPI."],
                insight_details=[InsightDetail(code="no_clock", params={"store_id": target_store})],
                source="none", cost_reason=no_clock, availability_reason=no_clock, b0_reason=no_clock,
                cost_reason_code="no_clock", availability_reason_code="no_clock", b0_reason_code="no_clock",
            )
        stores = [c.store_id for c in clocks]
        curr_date = max(c.current_date for c in clocks)
        start_date = min(c.start_date for c in clocks)
        days_elapsed = max(0, (curr_date - start_date).days)
        reviews_elapsed = days_elapsed // R

        cfg = optimization_service.get_service_level_config(db)
        target_pct = round(float(cfg.default_service_level) * 100.0, 1)
        n_skus = db.query(func.count(Inventory.item_id)).filter(Inventory.store_id.in_(stores)).scalar() or None

        # theta / multiplier: per store; GLOBAL = mean over stores of each store's latest state (P-22)
        th_acc: Dict[str, List[float]] = {c: [] for c in pc.ALL_CLASSES}
        mu_acc: Dict[str, List[float]] = {c: [] for c in pc.ALL_CLASSES}
        for c in clocks:
            thetas = calibrator_service.get_current_thetas(db, store_id=c.store_id, as_of=c.current_date)
            mults = calibrator_service.get_current_multipliers(db, store_id=c.store_id)
            for cid in pc.ALL_CLASSES:
                th_acc[cid].append(thetas.get(cid, 0.0))
                mu_acc[cid].append(mults.get(cid, 1.0))

        def mean(xs: List[float]) -> float:
            return sum(xs) / len(xs) if xs else 0.0

        avail, c3_reason, b0_reason = self._availability_by_class(db, stores, start_date, curr_date, R)

        segs: List[SegmentAvailability] = []
        c3_so = c3_n = b0_so = b0_n = 0
        for cid in pc.ALL_CLASSES:
            a = avail[cid]
            n_per = a["n_periods"]
            c3_av = round((1.0 - a["c3_stockout"] / n_per) * 100.0, 1) if n_per and c3_reason is None else None
            b0_av = (
                round((1.0 - a["b0_stockout"] / n_per) * 100.0, 1)
                if n_per and a["b0_stockout"] is not None and b0_reason is None else None
            )
            if c3_av is not None:
                c3_so += a["c3_stockout"]
                c3_n += n_per
            if b0_av is not None:
                b0_so += a["b0_stockout"]
                b0_n += n_per
            th = mean(th_acc[cid])
            # R5F-03: no measured availability -> NOT_MEASURED (a pass is never shown without a measurement)
            if abs(th) >= pc.THETA_MAX or (c3_av is not None and c3_av < target_pct - 1.0):
                flag = "WARNING"
            elif c3_av is None:
                flag = "NOT_MEASURED"
            else:
                flag = "COMPLIANT"
            segs.append(SegmentAvailability(
                class_id=cid, target=target_pct, c3out_availability=c3_av, b0_availability=b0_av,
                n_sku=a["n_sku"] or None, n_periods=n_per or None,
                theta=round(th, 3), multiplier=round(mean(mu_acc[cid]), 3), status=flag,
            ))
        overall_c3 = round((1.0 - c3_so / c3_n) * 100.0, 1) if c3_n else None
        overall_b0 = round((1.0 - b0_so / b0_n) * 100.0, 1) if b0_n else None
        fill_c3 = self._fill_rate(db, InventoryDaily, stores, start_date, curr_date)
        fill_b0 = self._fill_rate(db, SimShadowDaily, stores, start_date, curr_date)
        below_recent, measured_recent, cycles_used = self._classes_below_recent(
            db, stores, start_date, curr_date, target_pct)

        # ---- costs (A3): daily aggregates, cumulative per review cycle
        cost_reason = None
        c3_daily = self._daily_costs(db, InventoryDaily, stores, start_date, curr_date)
        sh_daily = self._daily_costs(db, SimShadowDaily, stores, start_date, curr_date)
        have_c3 = bool(c3_daily)
        have_b0 = bool(sh_daily)

        placed = (
            db.query(ReplenishmentRecommendation.review_date, func.count(ReplenishmentRecommendation.id))
            .filter(
                ReplenishmentRecommendation.store_id.in_(stores),
                ReplenishmentRecommendation.review_date >= start_date,
                ReplenishmentRecommendation.review_date <= curr_date,
                ReplenishmentRecommendation.status.in_(("APPROVED", "COMPLETED")),
            )
            .group_by(ReplenishmentRecommendation.review_date)
            .all()
        )
        c3_orders = {d: float(n) * pc.ORDER_COST_C for d, n in placed if d is not None}
        sh_orders_rows = (
            db.query(SimShadowDaily.date, func.count(SimShadowDaily.item_id))
            .filter(SimShadowDaily.store_id.in_(stores), SimShadowDaily.date >= start_date,
                    SimShadowDaily.date <= curr_date, SimShadowDaily.order_qty > 0)
            .group_by(SimShadowDaily.date)
            .all()
        )
        b0_orders = {d: float(n) * pc.ORDER_COST_C for d, n in sh_orders_rows}
        c3_orders_count = int(sum(n for d, n in placed if d is not None))
        b0_orders_count = int(sum(n for _, n in sh_orders_rows)) if sh_orders_rows else None

        curves: List[CostCurvePoint] = []
        if not have_c3:
            cost_reason = KPI_REASONS["no_simulated_days"]
        else:
            ch = co = cs = bh = bo = bs = 0.0
            for cyc in range(reviews_elapsed + 1):
                lo = start_date + timedelta(days=(cyc - 1) * R) if cyc else start_date
                hi = min(start_date + timedelta(days=cyc * R), curr_date)
                d = lo if cyc == 0 else lo + timedelta(days=1)  # cycle 0 = the start date itself (day 0 is simulated)
                while d <= hi:
                    h_, s_ = c3_daily.get(d, (0.0, 0.0))
                    ch += h_
                    cs += s_
                    co += c3_orders.get(d, 0.0)
                    if have_b0:
                        bh_, bs_ = sh_daily.get(d, (0.0, 0.0))
                        bh += bh_
                        bs += bs_
                        bo += b0_orders.get(d, 0.0)
                    d += timedelta(days=1)
                c3_t = round(ch + co + cs, 2)
                b0_t = round(bh + bo + bs, 2) if have_b0 else None
                curves.append(CostCurvePoint(
                    date=start_date + timedelta(days=cyc * R), cycle_index=cyc,
                    c3out_holding_cost=round(ch, 2), c3out_ordering_cost=round(co, 2),
                    c3out_stockout_cost=round(cs, 2), c3out_total_cost=c3_t,
                    b0_holding_cost=round(bh, 2) if have_b0 else None,
                    b0_ordering_cost=round(bo, 2) if have_b0 else None,
                    b0_stockout_cost=round(bs, 2) if have_b0 else None,
                    b0_total_cost=b0_t,
                    cost_savings=round(b0_t - c3_t, 2) if b0_t is not None else None,
                ))
        last = curves[-1] if curves else None
        c3_total = last.c3out_total_cost if last else None
        b0_total = last.b0_total_cost if last else None
        savings = last.cost_savings if last else None
        if have_c3 and not have_b0:
            b0_reason = b0_reason or KPI_REASONS["no_shadow_cost"]

        insights: List[str] = []
        details: List[InsightDetail] = []  # same order as ``insights`` (stable codes for client-side i18n)
        if overall_c3 is not None:
            line = f"Availability quan sát (các chu kỳ đã đóng): C³-OUT {overall_c3}% (mục tiêu {target_pct}%)"
            line += f", B0-MA-OUT-0.95 (đúng B0 của thầy) {overall_b0}%." if overall_b0 is not None else f"; B0: {b0_reason}"
            insights.append(line)
            details.append(InsightDetail(code="availability_observed", params={
                "c3out_pct": overall_c3, "target_pct": target_pct, "b0_pct": overall_b0,
                "b0_reason_code": kpi_reason_code(b0_reason),
            }))
        else:
            insights.append(c3_reason or "Chưa có availability quan sát.")
            details.append(InsightDetail(code=kpi_reason_code(c3_reason) or "no_availability"))
        if savings is not None:
            word = "tiết kiệm" if savings >= 0 else "chi thêm"
            insights.append(
                f"So với B0 shadow, C³-OUT {word} {abs(savings):,.2f} $ lũy kế theo mô hình A3 "
                f"(B0 {b0_total:,.2f} $, C³-OUT {c3_total:,.2f} $). C³-OUT là bộ điều khiển mức phục vụ, "
                f"chênh lệch chi phí có thể âm."
            )
            details.append(InsightDetail(code="cost_vs_b0", params={
                "direction": "saves" if savings >= 0 else "costs_more", "difference": round(abs(savings), 2),
                "savings": savings, "b0_total": b0_total, "c3out_total": c3_total,
            }))
        elif cost_reason or b0_reason:
            insights.append(cost_reason or b0_reason)
            details.append(InsightDetail(code=kpi_reason_code(cost_reason or b0_reason) or "no_cost"))
        insights.append("B0-MA-OUT-0.95 được mô phỏng song song trên cùng nhu cầu và tồn kho ban đầu: S = ceil(mean56·(L+R) + z0.95·σ56·√(L+R)), đặt S − IP khi IP < S mỗi kỳ (không dùng tỷ lệ cố định).")
        details.append(InsightDetail(code="b0_shadow_definition"))

        return KPIDashboardResponse(
            store_id=store_id,
            current_date=curr_date,
            days_elapsed=days_elapsed,
            reviews_elapsed=reviews_elapsed,
            c3out_total_cost=c3_total,
            b0_total_cost=b0_total,
            total_cost_savings=savings,
            c3out_overall_availability=overall_c3,
            b0_overall_availability=overall_b0,
            c3out_fill_rate=fill_c3,
            b0_fill_rate=fill_b0,
            classes_below_recent=below_recent,
            classes_measured_recent=measured_recent,
            recent_cycles_used=cycles_used,
            c3out_orders_count=c3_orders_count if have_c3 else None,
            b0_orders_count=b0_orders_count,
            start_date=start_date,
            segment_availabilities=segs,
            cost_curves=curves,
            summary_insights=insights,
            source="simulator",
            as_of=curr_date,
            n_skus=n_skus,
            target_availability=target_pct,
            cost_reason=cost_reason,
            availability_reason=c3_reason,
            b0_reason=b0_reason,
            cost_reason_code=kpi_reason_code(cost_reason),
            availability_reason_code=kpi_reason_code(c3_reason),
            b0_reason_code=kpi_reason_code(b0_reason),
            insight_details=details,
        )


dashboard_service = DashboardService()
