import csv
from datetime import date
import io
from typing import Optional, Tuple
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

        if rtype in ("forecast-accuracy", "accuracy"):
            rep = self.get_forecast_accuracy(db, store_id=store_id)
            filename = f"Forecast_Accuracy_Report_{timestamp}.csv"
            writer.writerow(["Metric", "Overall Value", "Unit / Notes"])
            writer.writerow(["Model Name", rep.model_name, "Evaluated Algorithm"])
            writer.writerow(["Evaluated Period", rep.evaluated_period, "Time Horizon"])
            writer.writerow(["MAE", rep.overall_metrics.mae, "Mean Absolute Error"])
            writer.writerow(["RMSE", rep.overall_metrics.rmse, "Root Mean Squared Error"])
            writer.writerow(["MASE", rep.overall_metrics.mase, "Mean Absolute Scaled Error (< 1 is good)"])
            writer.writerow(["WRMSSE", rep.overall_metrics.wrmsse, "Weighted RMSSE (M5 metric)"])
            writer.writerow([])
            writer.writerow(["ABC Segment", "MAE", "RMSE", "MASE", "WRMSSE", "Sample Points"])
            for grp, m in rep.abc_breakdown.items():
                writer.writerow([f"Class {grp}", m.mae, m.rmse, m.mase, m.wrmsse, m.sample_count])

        elif rtype in ("inventory", "inventory-performance"):
            rep = self.get_inventory_performance(db, store_id=store_id, limit=500)
            filename = f"Inventory_Performance_Report_{timestamp}.csv"
            writer.writerow(["SKU_ID", "PRODUCT_NAME", "CATEGORY", "STORE", "ON_HAND", "DAILY_DEMAND", "DAYS_OF_SUPPLY", "INVENTORY_VALUE", "TURNOVER_RATIO"])
            for it in rep.items:
                writer.writerow([
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
            writer.writerow(["Cost Component", "Static Baseline ($)", "ML-driven Policy ($)", "Savings ($)"])
            writer.writerow(["Holding Cost", rep.baseline_policy.holding_cost, rep.ml_policy.holding_cost, round(rep.baseline_policy.holding_cost - rep.ml_policy.holding_cost, 2)])
            writer.writerow(["Ordering Cost", rep.baseline_policy.order_cost, rep.ml_policy.order_cost, round(rep.baseline_policy.order_cost - rep.ml_policy.order_cost, 2)])
            writer.writerow(["Stockout Penalty", rep.baseline_policy.stockout_penalty_cost, rep.ml_policy.stockout_penalty_cost, round(rep.baseline_policy.stockout_penalty_cost - rep.ml_policy.stockout_penalty_cost, 2)])
            writer.writerow(["Total Annual Cost", rep.baseline_policy.total_cost, rep.ml_policy.total_cost, rep.cost_savings_amount])
            writer.writerow([])
            writer.writerow(["Total Estimated Savings", f"{rep.savings_percentage}%", f"${rep.cost_savings_amount}"])

        elif rtype in ("backtest", "backtesting"):
            rep = self.run_backtesting(db, BacktestRequest(store_id=store_id or "CA_1"))
            filename = f"Historical_Backtest_Report_{timestamp}.csv"
            writer.writerow(["Metric", "Value", "Benchmark"])
            writer.writerow(["Model Name", rep.model_name, "Machine Learning Engine"])
            writer.writerow(["Store", rep.store_id, "Fulfillment Center"])
            writer.writerow(["Simulated Days", rep.simulated_days, "Days"])
            writer.writerow(["Baseline Stockouts", rep.baseline_stockouts, "Incidents"])
            writer.writerow(["ML Stockouts", rep.ml_stockouts, "Incidents"])
            writer.writerow(["Stockout Reduction", f"{rep.stockout_reduction_pct}%", "Improvement"])
            writer.writerow(["Baseline Avg Inventory", rep.baseline_avg_inventory, "Units"])
            writer.writerow(["ML Avg Inventory", rep.ml_avg_inventory, "Units"])
            writer.writerow(["Holding Cost Savings", f"${rep.holding_cost_savings}", "USD"])
            writer.writerow(["Achieved Service Level", f"{rep.service_level_achieved}%", "Target 95%"])

        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Loại báo cáo '{report_type}' không hợp lệ. Hỗ trợ: accuracy, inventory, cost, backtest.",
            )

        return output.getvalue(), filename


reports_service = ReportsService()
