import asyncio
import logging
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.core.events import event_bus
from app.repositories.dashboard_repository import dashboard_repository
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

    async def trigger_realtime_stock_alerts(
        self,
        db: Session,
        store_id: Optional[str] = None,
    ) -> RealtimeStockAlertTriggerResponse:
        """
        UC10: Quét kho và phát sự kiện cảnh báo thời gian thực qua Server-Sent Events (SSE).
        Có cơ chế chống spam trùng lặp cho các cảnh báo chưa xử lý.
        """
        items, _, _ = dashboard_repository.get_stock_alerts(
            db,
            store_id=store_id,
            severity=None,
            limit=500,
            offset=0,
        )

        critical_or_warning = [
            it for it in items if it["severity"] in ("CRITICAL", "WARNING")
        ]

        alerts_generated = 0
        broadcast_count = 0

        for it in critical_or_warning:
            alert_type = f"STOCK_{it['severity']}"
            msg = (
                f"[{it['severity']}] SKU '{it['item_id']}' at store '{it['store_id']}': "
                f"On-hand {it['on_hand']} <= threshold (SS: {it['safety_stock']}, ROP: {it['reorder_point']})."
            )

            _, is_new = dashboard_repository.find_or_create_alert(
                db,
                item_id=it["item_id"],
                store_id=it["store_id"],
                alert_type=alert_type,
                message=msg,
            )

            if is_new:
                alerts_generated += 1
                event = create_stock_alert_event(
                    item_id=it["item_id"],
                    store_id=it["store_id"],
                    severity=it["severity"],
                    on_hand=it["on_hand"],
                    reorder_point=it["reorder_point"],
                    safety_stock=it["safety_stock"],
                    message=msg,
                )
                try:
                    await event_bus.publish(event)
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


dashboard_service = DashboardService()
