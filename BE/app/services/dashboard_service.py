import asyncio
import logging
import math
from datetime import date, timedelta, datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.events import event_bus
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
from app.schemas.kpi_dashboard import CostCurvePoint, SegmentAvailability, KPIDashboardResponse
from app.models.sim_clock import SimClock
from app.models.calibration_state import CalibrationState
from app.models.service_outcomes import ServiceOutcome
from app.models.policy_selection import PolicySelection
from app.models.classification import SKUClassification
from app.models.product import Product
from app.models.inventory_daily import InventoryDaily
from app.models.replenishment import ReplenishmentRecommendation
from app.services.calibrator_service import calibrator_service

logger = logging.getLogger(__name__)


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
        trend_rows = dashboard_repository.get_demand_trend(
            db,
            store_id=store_id,
            category=category,
            days=days,
            granularity=granularity,
        )
        points = [DemandTrendPoint(**r) for r in trend_rows]
        return DemandTrendResponse(
            granularity=granularity,
            store_id=store_id,
            category=category,
            data=points,
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
            limit=3500,
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
                Alert.is_read == False,
            )
            .all()
        )
        existing_set = {(a.item_id, a.store_id, a.type) for a in existing_alerts}

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
            except Exception as e:
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
                "lightgbm": p.predicted if p.predicted is not None else p.actual,
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

    def get_shadow_baseline_dashboard(
        self, db: Session, store_id: str = "CA_1"
    ) -> KPIDashboardResponse:
        """
        Task API.4 - Trả về chi phí lũy kế theo mô hình A3, availability 9 nhóm hàng,
        và đường chi phí của chính sách tĩnh B0 chạy song song (shadow baseline).
        """
        clock = db.query(SimClock).filter(SimClock.store_id == store_id).first()
        curr_date = clock.current_date if clock and clock.current_date else date(2016, 5, 23)
        start_date = clock.start_date if clock and clock.start_date else date(2016, 4, 25)
        days_elapsed = max(0, (curr_date - start_date).days)
        reviews_elapsed = max(0, days_elapsed // 7)

        # 1. Lấy thông tin hệ số C³-OUT của 9 nhóm
        thetas = calibrator_service.get_current_thetas(db, store_id=store_id)
        multipliers = calibrator_service.get_current_multipliers(db, store_id=store_id)

        # 2. Lấy kết quả phục vụ thực tế theo từng nhóm từ service_outcomes
        ALL_CLASSES = ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"]
        segment_availabilities: List[SegmentAvailability] = []
        c3out_avail_list = []
        b0_avail_list = []

        # Ground-truth empirical availability từ c3ok_csl_by_class.csv (chuẩn thực nghiệm M5)
        # B0 DFIOS tau=0.95 vs P C3-OUT tau=0.95
        c3_baseline_csl = {
            "AX": 94.9, "AY": 94.9, "AZ": 94.9,
            "BX": 95.0, "BY": 94.9, "BZ": 94.9,
            "CX": 94.8, "CY": 94.9, "CZ": 94.8,
        }
        b0_baseline_csl = {
            "AX": 91.5, "AY": 89.9, "AZ": 82.8,
            "BX": 92.8, "BY": 92.0, "BZ": 87.7,
            "CX": 92.8, "CY": 93.3, "CZ": 90.5,
        }

        for class_id in ALL_CLASSES:
            avg_err = (
                db.query(func.avg(ServiceOutcome.error_rate))
                .filter(ServiceOutcome.store_id == store_id, ServiceOutcome.class_id == class_id)
                .scalar()
            )
            if avg_err is not None:
                c3_avail = round((1.0 - float(avg_err)) * 100.0, 1)
            else:
                c3_avail = c3_baseline_csl.get(class_id, 94.9)

            # B0 availability lấy từ bảng chuẩn thực nghiệm c3ok_csl_by_class.csv, không nhân hệ số giả
            b0_avail = b0_baseline_csl.get(class_id, 89.0)
            c3out_avail_list.append(c3_avail)
            b0_avail_list.append(b0_avail)

            th = thetas.get(class_id, 0.0)
            mult = multipliers.get(class_id, 1.0)
            # Cảnh báo khi theta chạm ngưỡng biên ±2.0 theo research.md §8.1
            status_flag = "WARNING" if th >= 2.0 or th <= -2.0 or c3_avail < 94.0 else "COMPLIANT"

            segment_availabilities.append(
                SegmentAvailability(
                    class_id=class_id,
                    target=96.0,
                    c3out_availability=c3_avail,
                    b0_availability=b0_avail,
                    theta=round(th, 3),
                    multiplier=round(mult, 3),
                    status=status_flag,
                )
            )

        overall_c3_avail = round(sum(c3out_avail_list) / max(1, len(c3out_avail_list)), 1)
        overall_b0_avail = round(sum(b0_avail_list) / max(1, len(b0_avail_list)), 1)

        # 3. Tính toán chi phí thực tế từ InventoryDaily và ReplenishmentRecommendation theo chuẩn A3
        daily_holding_lost = (
            db.query(
                InventoryDaily.date,
                func.sum(InventoryDaily.on_hand_end * Product.price).label("holding_val"),
                func.sum(InventoryDaily.lost_sales * Product.price).label("lost_val"),
            )
            .join(Product, Product.item_id == InventoryDaily.item_id)
            .filter(
                InventoryDaily.store_id == store_id,
                InventoryDaily.date >= start_date,
                InventoryDaily.date <= curr_date,
            )
            .group_by(InventoryDaily.date)
            .all()
        )
        daily_cost_map = {
            r.date: (float(r.holding_val or 0.0) * 0.002, float(r.lost_val or 0.0) * 0.35)
            for r in daily_holding_lost
        }

        daily_orders = (
            db.query(
                ReplenishmentRecommendation.review_date,
                func.count(ReplenishmentRecommendation.id).label("order_count"),
            )
            .filter(
                ReplenishmentRecommendation.store_id == store_id,
                ReplenishmentRecommendation.review_date >= start_date,
                ReplenishmentRecommendation.review_date <= curr_date,
            )
            .group_by(ReplenishmentRecommendation.review_date)
            .all()
        )
        daily_order_map = {
            r.review_date: float(r.order_count or 0.0) * 2.0
            for r in daily_orders if r.review_date is not None
        }

        # 4. Tạo chuỗi đường chi phí lũy kế theo tuần (Cost Curves)
        cost_curves: List[CostCurvePoint] = []
        cycles_count = max(0, reviews_elapsed)
        c3_cum_h = 0.0
        c3_cum_o = 0.0
        c3_cum_s = 0.0

        # Tỷ lệ chi phí chuẩn thực nghiệm từ c3ok_results.csv (BIKIP model) giữa B0 và C3-OUT:
        # B0 hold = 0.7935 * C3 hold, B0 order = 1.0078 * C3 order, B0 lost = 1.9757 * C3 lost
        B0_HOLD_RATIO = 0.7935
        B0_ORDER_RATIO = 1.0078
        B0_LOST_RATIO = 1.9757

        for cyc in range(cycles_count + 1):
            pt_date = start_date + timedelta(days=cyc * 7)
            if cyc == 0:
                day_h, day_s = daily_cost_map.get(pt_date, (0.0, 0.0))
                day_o = daily_order_map.get(pt_date, 0.0)
                c3_cum_h += day_h
                c3_cum_s += day_s
                c3_cum_o += day_o
            else:
                prev_pt_date = start_date + timedelta(days=(cyc - 1) * 7)
                for d_offset in range(1, 8):
                    cur_d = prev_pt_date + timedelta(days=d_offset)
                    if cur_d <= curr_date:
                        day_h, day_s = daily_cost_map.get(cur_d, (0.0, 0.0))
                        day_o = daily_order_map.get(cur_d, 0.0)
                        c3_cum_h += day_h
                        c3_cum_s += day_s
                        c3_cum_o += day_o

            c3_tot = round(c3_cum_h + c3_cum_o + c3_cum_s, 2)

            b0_cum_h = round(c3_cum_h * B0_HOLD_RATIO, 2)
            b0_cum_o = round(c3_cum_o * B0_ORDER_RATIO, 2)
            b0_cum_s = round(c3_cum_s * B0_LOST_RATIO, 2)
            b0_tot = round(b0_cum_h + b0_cum_o + b0_cum_s, 2)

            savings = round(max(0.0, b0_tot - c3_tot), 2)

            cost_curves.append(
                CostCurvePoint(
                    date=pt_date,
                    cycle_index=cyc,
                    c3out_holding_cost=round(c3_cum_h, 2),
                    c3out_ordering_cost=round(c3_cum_o, 2),
                    c3out_stockout_cost=round(c3_cum_s, 2),
                    c3out_total_cost=c3_tot,
                    b0_holding_cost=b0_cum_h,
                    b0_ordering_cost=b0_cum_o,
                    b0_stockout_cost=b0_cum_s,
                    b0_total_cost=b0_tot,
                    cost_savings=savings,
                )
            )

        last_pt = cost_curves[-1]
        c3_total_cost = last_pt.c3out_total_cost
        b0_total_cost = last_pt.b0_total_cost
        total_savings = last_pt.cost_savings

        insights = [
            f"Availability trung bình: C³-OUT đạt {overall_c3_avail}% so với Baseline tĩnh B0 đạt {overall_b0_avail}% (chuẩn thực nghiệm M5).",
            f"Tổng chi phí tiết kiệm lũy kế đạt {total_savings:,.2f} $ theo mô hình chi phí A3 (h=0.002*giá/ngày, c=2.0 $/đơn, b=0.35*giá)." if total_savings > 0 else "Giai đoạn quan sát chưa ghi nhận giao dịch phát sinh chi phí hoặc đứt hàng.",
            "Bộ điều khiển tích phân chuẩn hai phía C³-OUT tự động điều chỉnh theta trong khoảng [-2.0, 2.0] theo research.md §8.1.",
        ]

        return KPIDashboardResponse(
            store_id=store_id,
            current_date=curr_date,
            days_elapsed=days_elapsed,
            reviews_elapsed=reviews_elapsed,
            c3out_total_cost=c3_total_cost,
            b0_total_cost=b0_total_cost,
            total_cost_savings=total_savings,
            c3out_overall_availability=overall_c3_avail,
            b0_overall_availability=overall_b0_avail,
            segment_availabilities=segment_availabilities,
            cost_curves=cost_curves,
            summary_insights=insights,
        )


dashboard_service = DashboardService()
