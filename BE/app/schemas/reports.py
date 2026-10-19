from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class AccuracyMetricItem(BaseModel):
    mae: float = Field(..., description="Mean Absolute Error")
    rmse: float = Field(..., description="Root Mean Squared Error")
    mase: float = Field(..., description="Mean Absolute Scaled Error")
    wrmsse: float = Field(..., description="Weighted Root Mean Squared Scaled Error")
    sample_count: int = Field(default=0)


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


class InventoryItemPerformance(BaseModel):
    item_id: str
    product_name: str
    category: str
    store_id: str
    on_hand: float
    daily_demand: float
    days_of_supply: float
    inventory_value: float
    turnover_ratio: float


class InventoryPerformanceReportResponse(BaseModel):
    """
    UC40: Báo cáo hiệu quả tồn kho (Vòng quay tồn kho & Days of Supply).
    """
    store_id: Optional[str] = None
    total_inventory_value: float
    average_turnover_ratio: float
    average_days_of_supply: float
    stockout_skus_count: int
    dead_stock_value: float
    items: List[InventoryItemPerformance] = []
    total: int


class BacktestRequest(BaseModel):
    """
    UC41: Tham số mô phỏng kiểm định hồi cứu trên dữ liệu lịch sử.
    """
    model_name: str = Field(default="lightgbm", description="Tên mô hình ML")
    backtest_days: int = Field(default=28, ge=7, le=90, description="Số ngày kiểm định")
    store_id: str = Field(default="CA_1", description="Mã cửa hàng")
    target_service_level: float = Field(default=0.95, ge=0.5, le=0.99)


class BacktestResponse(BaseModel):
    """
    UC41: Kết quả kiểm định hồi cứu Backtesting.
    """
    model_name: str
    store_id: str
    simulated_days: int
    baseline_stockouts: int
    ml_stockouts: int
    stockout_reduction_pct: float
    baseline_avg_inventory: float
    ml_avg_inventory: float
    holding_cost_savings: float
    service_level_achieved: float


class CostPolicyDetail(BaseModel):
    holding_cost: float
    order_cost: float
    stockout_penalty_cost: float
    total_cost: float


class CostComparisonReportResponse(BaseModel):
    """
    UC42: Báo cáo so sánh chi phí tồn kho (ML-driven vs Static Baseline).
    """
    store_id: Optional[str] = None
    total_skus: int
    baseline_policy: CostPolicyDetail
    ml_policy: CostPolicyDetail
    cost_savings_amount: float
    savings_percentage: float
    category_savings: Dict[str, float] = {}
