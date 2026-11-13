import csv
from datetime import date
import io
from typing import Optional, Tuple, Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.repositories.reports_repository import reports_repository
from app.schemas.reports import (
    BacktestRequest,
    BacktestResponse,
    CostComparisonReportResponse,
    ForecastAccuracyReportResponse,
    InventoryPerformanceReportResponse,
)


def sanitize_csv_cell(val: Any) -> Any:
    """Chống CSV Formula Injection (CWE-1236, R-42)"""
    if isinstance(val, str) and val.startswith(("=", "+", "-", "@", "\t", "\r")):
        return f"'{val}"
    return val


class ReportsService:
    """
    Service nghiệp vụ cho Module H — Reports & Analytics (UC39 - UC43).
    """

    def get_forecast_accuracy(
        self,
        db: Session,
        model_name: str = "lightgbm",
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        store_id: Optional[str] = None,
        abc_class: Optional[str] = None,
    ) -> ForecastAccuracyReportResponse:
        """
        UC39: Báo cáo độ chính xác dự báo (MAE, RMSE, MASE, WRMSSE).
        """
        res = reports_repository.get_forecast_accuracy_report(
            db,
            model_name=model_name,
            start_date=start_date,
            end_date=end_date,
            store_id=store_id,
            abc_class=abc_class,
        )
        return ForecastAccuracyReportResponse(**res)

    def get_inventory_performance(
        self,
        db: Session,
        store_id: Optional[str] = None,
        category: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> InventoryPerformanceReportResponse:
        """
        UC40: Báo cáo hiệu quả tồn kho (Vòng quay tồn kho & Days of Supply).
        """
        res = reports_repository.get_inventory_performance_report(
            db,
            store_id=store_id,
            category=category,
            limit=limit,
            offset=offset,
        )
        return InventoryPerformanceReportResponse(**res)

    def run_backtesting(
        self,
        db: Session,
        request: BacktestRequest,
    ) -> BacktestResponse:
        """
        UC41: Kiểm định hồi cứu (Backtesting) trên dữ liệu lịch sử.
        """
        res = reports_repository.run_historical_backtest(
            db,
            model_name=request.model_name,
            backtest_days=request.backtest_days,
            store_id=request.store_id,
            target_service_level=request.target_service_level,
        )
        return BacktestResponse(**res)

    def get_cost_comparison(
        self,
        db: Session,
        store_id: Optional[str] = None,
        category: Optional[str] = None,
    ) -> CostComparisonReportResponse:
        """
        UC42: Báo cáo so sánh chi phí tồn kho (ML vs Baseline).
        """
        res = reports_repository.get_cost_comparison_report(
            db,
            store_id=store_id,
            category=category,
        )
        return CostComparisonReportResponse(**res)

    def export_report_csv(
        self,
        db: Session,
        report_type: str,
        store_id: Optional[str] = None,
    ) -> Tuple[str, str]:
        """
        UC43: Xuất báo cáo ra định dạng CSV (chuẩn UTF-8 BOM cho Excel).
        Trả về: (csv_string, filename)
        """
        rtype = report_type.lower().strip()
        timestamp = date.today().strftime("%Y%m%d")

        output = io.StringIO()
        # Thêm UTF-8 BOM để Excel hiển thị đúng font
        output.write("\ufeff")
        writer = csv.writer(output)

        def write_sanitized_row(row_cells: list):
            """Ghi một dòng CSV với tất cả ô được bảo vệ chống Formula Injection (CWE-1236, N-26)"""
            writer.writerow([sanitize_csv_cell(c) for c in row_cells])

        if rtype in ("forecast-accuracy", "accuracy"):
            rep = self.get_forecast_accuracy(db, store_id=store_id)
            filename = f"Forecast_Accuracy_Report_{timestamp}.csv"
            write_sanitized_row(["Metric", "Overall Value", "Unit / Notes"])
            write_sanitized_row(["Model Name", rep.model_name, "Evaluated Algorithm"])
            write_sanitized_row(["Evaluated Period", rep.evaluated_period, "Time Horizon"])
            write_sanitized_row(["MAE", rep.overall_metrics.mae, "Mean Absolute Error"])
            write_sanitized_row(["RMSE", rep.overall_metrics.rmse, "Root Mean Squared Error"])
            write_sanitized_row(["MASE", rep.overall_metrics.mase, "Mean Absolute Scaled Error (< 1 is good)"])
            write_sanitized_row(["WRMSSE", rep.overall_metrics.wrmsse, "Weighted RMSSE (M5 metric)"])
            write_sanitized_row([])
            write_sanitized_row(["ABC Segment", "MAE", "RMSE", "MASE", "WRMSSE", "Sample Points"])
            for grp, m in rep.abc_breakdown.items():
                write_sanitized_row([f"Class {grp}", m.mae, m.rmse, m.mase, m.wrmsse, m.sample_count])

        elif rtype in ("inventory", "inventory-performance"):
            rep = self.get_inventory_performance(db, store_id=store_id, limit=5000)
            filename = f"Inventory_Performance_Report_{timestamp}.csv"
            write_sanitized_row(["SKU_ID", "PRODUCT_NAME", "CATEGORY", "STORE", "ON_HAND", "DAILY_DEMAND", "DAYS_OF_SUPPLY", "INVENTORY_VALUE", "TURNOVER_RATIO"])
            for it in rep.items:
                write_sanitized_row([
                    it.item_id,
                    it.product_name,
                    it.category,
                    it.store_id,
                    it.on_hand,
                    it.daily_demand,
                    it.days_of_supply,
                    it.inventory_value,
                    it.turnover_ratio,
                ])

        elif rtype in ("cost", "cost-comparison"):
            rep = self.get_cost_comparison(db, store_id=store_id)
            filename = f"Cost_Comparison_Report_{timestamp}.csv"
            write_sanitized_row(["Cost Component", "Static Baseline ($)", "ML-driven Policy ($)", "Savings ($)"])
            write_sanitized_row(["Holding Cost", rep.baseline_policy.holding_cost, rep.ml_policy.holding_cost, round(rep.baseline_policy.holding_cost - rep.ml_policy.holding_cost, 2)])
            write_sanitized_row(["Ordering Cost", rep.baseline_policy.order_cost, rep.ml_policy.order_cost, round(rep.baseline_policy.order_cost - rep.ml_policy.order_cost, 2)])
            write_sanitized_row(["Stockout Penalty", rep.baseline_policy.stockout_penalty_cost, rep.ml_policy.stockout_penalty_cost, round(rep.baseline_policy.stockout_penalty_cost - rep.ml_policy.stockout_penalty_cost, 2)])
            write_sanitized_row(["Total Annual Cost", rep.baseline_policy.total_cost, rep.ml_policy.total_cost, rep.cost_savings_amount])
            write_sanitized_row([])
            write_sanitized_row(["Total Estimated Savings", f"{rep.savings_percentage}%", f"${rep.cost_savings_amount}"])

        elif rtype in ("backtest", "backtesting"):
            rep = self.run_backtesting(db, BacktestRequest(store_id=store_id or "CA_1"))
            filename = f"Historical_Backtest_Report_{timestamp}.csv"
            write_sanitized_row(["Metric", "Value", "Benchmark"])
            write_sanitized_row(["Model Name", rep.model_name, "Machine Learning Engine"])
            write_sanitized_row(["Store", rep.store_id, "Fulfillment Center"])
            write_sanitized_row(["Simulated Days", rep.simulated_days, "Days"])
            write_sanitized_row(["Baseline Stockouts", rep.baseline_stockouts, "Incidents"])
            write_sanitized_row(["ML Stockouts", rep.ml_stockouts, "Incidents"])
            write_sanitized_row(["Stockout Reduction", f"{rep.stockout_reduction_pct}%", "Improvement"])
            write_sanitized_row(["Baseline Avg Inventory", rep.baseline_avg_inventory, "Units"])
            write_sanitized_row(["ML Avg Inventory", rep.ml_avg_inventory, "Units"])
            write_sanitized_row(["Holding Cost Savings", f"${rep.holding_cost_savings}", "USD"])
            write_sanitized_row(["Achieved Service Level", f"{rep.service_level_achieved}%", "Target 95%"])

        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Loại báo cáo '{report_type}' không hợp lệ. Hỗ trợ: accuracy, inventory, cost, backtest.",
            )

        return output.getvalue(), filename


reports_service = ReportsService()
