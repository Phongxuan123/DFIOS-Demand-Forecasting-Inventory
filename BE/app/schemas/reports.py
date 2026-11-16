from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class AccuracyMetricItem(BaseModel):
    # None = not computable (see ``metrics_reason`` of the report); never a fabricated 0.0
    mae: Optional[float] = Field(None, description="Mean Absolute Error")
    rmse: Optional[float] = Field(None, description="Root Mean Squared Error")
    mase: Optional[float] = Field(None, description="MASE, scale = naive 1-step MAE of the TRAINING history")
    wrmsse: Optional[float] = Field(None, description="WRMSSE, RMSSE scale from the training history, weights = dollar sales of the last 28 training days")
    sample_count: int = Field(default=0)
    # Measured Q0.95 coverage of 10-day (L+R) windows (overall only). Same definition, two DIFFERENT measurements
    # (forecasts / calibration / sample), never merged (see coverage_service).
    coverage_q95: Optional[float] = Field(
        None,
        description="Share of SKU x origin 10-day (L+R) windows with actual total <= Q0.95; offline c3ok pipeline, "
                    "M5 test split (artifact forecasts)",
    )
    coverage_source: Optional[str] = Field(None, description="Source label of coverage_q95, e.g. artifact:c3ok")
    coverage_q95_db_causal: Optional[float] = Field(
        None,
        description="Same 10-day window definition, measured on this DB: route (c) causal Q0.95 of "
                    "forecast_window_quantile vs realised window totals",
    )
    coverage_q95_db_causal_n: Optional[int] = None


class ForecastAccuracyReportResponse(BaseModel):
    """
    UC39: Báo cáo độ chính xác dự báo (MAE, RMSE, MASE, WRMSSE).
    """
    model_name: str
    evaluated_period: str
    store_id: Optional[str] = None
    overall_metrics: AccuracyMetricItem
    abc_breakdown: Dict[str, AccuracyMetricItem] = {}
    top_accurate_skus: List[Dict[str, Any]] = []
    top_deviating_skus: List[Dict[str, Any]] = []
    # --- provenance (additive) ---
    source: str = "forecast_vs_sales_history"  # | "model_registry" | "none"
    as_of: Optional[str] = None
    n_skus: Optional[int] = None
    n_series_scaled: Optional[int] = None
    metrics_reason: Optional[str] = None


class InventoryItemPerformance(BaseModel):
    item_id: str
    product_name: str
    category: str
    store_id: str
    on_hand: float
    daily_demand: Optional[float] = None
    days_of_supply: Optional[float] = None
    inventory_value: float
    turnover_ratio: Optional[float] = None


class InventoryPerformanceReportResponse(BaseModel):
    """
    UC40: Báo cáo hiệu quả tồn kho (Vòng quay tồn kho & Days of Supply).
    """
    store_id: Optional[str] = None
    total_inventory_value: float
    average_turnover_ratio: Optional[float] = None
    average_days_of_supply: Optional[float] = None
    stockout_skus_count: int
    dead_stock_value: float
    items: List[InventoryItemPerformance] = []
    total: int
    # --- provenance (additive) ---
    source: str = "inventory+inventory_params"
    n_skus: Optional[int] = None
    n_skus_with_demand: Optional[int] = None
    reason: Optional[str] = None


class BacktestRequest(BaseModel):
    """
    UC41: Tham số mô phỏng kiểm định hồi cứu trên dữ liệu lịch sử.
    """
    model_name: str = Field(default="lightgbm", description="Tên mô hình ML")
    backtest_days: int = Field(default=28, ge=7, le=90, description="Số ngày kiểm định (không còn dùng: cửa sổ = giai đoạn đã mô phỏng)")
    store_id: str = Field(default="CA_1", description="Mã cửa hàng")
    target_service_level: float = Field(default=0.95, ge=0.5, le=0.99)


class BacktestResponse(BaseModel):
    """
    UC41: Kết quả kiểm định hồi cứu = kết quả ĐO được của bộ mô phỏng (C³-OUT) so với B0 shadow song song.
    """
    model_name: str
    store_id: str
    simulated_days: int
    baseline_stockouts: Optional[int] = None  # B0 stocked-out SKU-cycles (observed)
    ml_stockouts: Optional[int] = None
    stockout_reduction_pct: Optional[float] = None
    baseline_avg_inventory: Optional[float] = None
    ml_avg_inventory: Optional[float] = None
    holding_cost_savings: Optional[float] = None
    service_level_achieved: Optional[float] = None
    # --- provenance (additive) ---
    source: str = "simulator"
    as_of: Optional[str] = None
    n_skus: Optional[int] = None
    target_service_level: Optional[float] = None
    reason: Optional[str] = None


class CostPolicyDetail(BaseModel):
    holding_cost: float
    order_cost: float
    stockout_penalty_cost: float
    total_cost: float


class CostComparisonReportResponse(BaseModel):
    """
    UC42: Báo cáo so sánh chi phí (C³-OUT mô phỏng vs B0 shadow), theo A3, trên cửa sổ đã mô phỏng.
    """
    store_id: Optional[str] = None
    total_skus: int = 0
    baseline_policy: Optional[CostPolicyDetail] = None
    ml_policy: Optional[CostPolicyDetail] = None
    cost_savings_amount: Optional[float] = None  # baseline - ml, may be negative
    savings_percentage: Optional[float] = None
    category_savings: Dict[str, Optional[float]] = {}
    # --- provenance (additive) ---
    source: str = "simulator"
    as_of: Optional[str] = None
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    cost_basis: str = "A3: h=0.002*price/day, b=0.35*price/lost unit, c=2/placed order"
    reason: Optional[str] = None
