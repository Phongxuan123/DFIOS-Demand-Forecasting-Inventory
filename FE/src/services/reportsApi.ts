/** Reports endpoints. Fields mirror BE/app/schemas/{reports,simulation}.py; nothing is defaulted here. */
import apiClient, { getJson } from './apiClient.ts';

export interface PolicyRow {
  policy: string;
  label: string;
  tau: number | null;
  csl: number | null;
  fill_rate: number | null;
  holding_cost: number | null;
  shortage_cost: number | null;
  ordering_cost: number | null;
  total_cost_bikip: number | null;
  total_cost_paper: number | null;
}

export interface PolicyBenchmark {
  status: 'ok' | 'artifact_missing' | string;
  source: string;
  simulated?: boolean;
  as_of?: string | null;
  n_skus?: number;
  n_days?: number;
  n_reviews?: number;
  lead_time_days?: number;
  review_period_days?: number;
  cost_basis?: string;
  reason?: string;
  /** coverage_q95: artifact c3ok. coverage_q95_db_causal: DB causal windows (different definition, never merge). */
  coverage_q95?: number | null;
  coverage_source?: string | null;
  coverage_q95_db_causal?: number | null;
  coverage_q95_db_causal_n?: number | null;
  policies: Record<string, PolicyRow>;
}

export interface SimPolicyMetric {
  policy_id: string;
  policy_name: string;
  description: string;
  total_cost: number;
  holding_cost: number;
  ordering_cost: number;
  stockout_cost: number;
  availability: number;
  total_orders: number;
  total_stockouts: number | null;
  stockouts_reason: string | null;
  is_feasible: boolean;
  tau: number | null;
  csl: number | null;
  fill_rate: number | null;
  artifact_row: string | null;
}

export interface PolicyComparison {
  store_id: string;
  simulation_horizon_days: number;
  sku_count: number;
  recommended_policy: string | null;
  policies: SimPolicyMetric[];
  insights: string[];
  source: string;
  simulated: boolean;
  as_of: string | null;
  scale_factor: number | null;
  scale_basis: string | null;
  cost_basis: string;
  what_if: Record<string, unknown> | null;
  what_if_reason: string | null;
  status: string;
  reason: string | null;
}

export interface AccuracyMetric {
  mae: number | null;
  rmse: number | null;
  mase: number | null;
  wrmsse: number | null;
  sample_count: number;
  coverage_q95?: number | null;
  coverage_source?: string | null;
  coverage_q95_db_causal?: number | null;
  coverage_q95_db_causal_n?: number | null;
}

export interface ForecastAccuracy {
  model_name: string;
  evaluated_period: string;
  store_id: string | null;
  overall_metrics: AccuracyMetric;
  abc_breakdown: Record<string, AccuracyMetric>;
  source: string;
  as_of: string | null;
  n_skus: number | null;
  metrics_reason: string | null;
}

export interface InventoryPerfItem {
  item_id: string;
  product_name: string;
  category: string;
  store_id: string;
  on_hand: number;
  daily_demand: number | null;
  days_of_supply: number | null;
  inventory_value: number;
  turnover_ratio: number | null;
}

export interface InventoryPerformance {
  store_id: string | null;
  total_inventory_value: number;
  average_turnover_ratio: number | null;
  average_days_of_supply: number | null;
  stockout_skus_count: number;
  dead_stock_value: number;
  items: InventoryPerfItem[];
  total: number;
  source: string;
  n_skus: number | null;
  reason: string | null;
}

export interface CostPolicyDetail {
  holding_cost: number;
  order_cost: number;
  stockout_penalty_cost: number;
  total_cost: number;
}

export interface CostComparison {
  store_id: string | null;
  total_skus: number;
  baseline_policy: CostPolicyDetail | null;
  ml_policy: CostPolicyDetail | null;
  cost_savings_amount: number | null;
  savings_percentage: number | null;
  source: string;
  as_of: string | null;
  period_start: string | null;
  period_end: string | null;
  cost_basis: string;
  reason: string | null;
}

export interface Backtest {
  model_name: string;
  store_id: string;
  simulated_days: number;
  baseline_stockouts: number | null;
  ml_stockouts: number | null;
  stockout_reduction_pct: number | null;
  baseline_avg_inventory: number | null;
  ml_avg_inventory: number | null;
  holding_cost_savings: number | null;
  service_level_achieved: number | null;
  source: string;
  as_of: string | null;
  reason: string | null;
}

export interface RegistryModel {
  id: string;
  name: string;
  version: string;
  algorithm: string;
  is_production: boolean;
  metrics: Record<string, unknown> | null;
  created_at: string;
}

export const getPolicyBenchmark = (signal?: AbortSignal) => getJson<PolicyBenchmark>('/reports/policy-comparison', { signal });

export const postComparePolicies = async (storeId: string, signal?: AbortSignal) =>
  (await apiClient.post<PolicyComparison>('/simulation/compare-policies', { store_id: storeId }, { signal })).data;

export const getForecastAccuracy = (storeId: string, signal?: AbortSignal) =>
  getJson<ForecastAccuracy>('/reports/forecast-accuracy', { params: { store_id: storeId }, signal });

export const getInventoryPerformance = (storeId: string, limit: number, offset: number, signal?: AbortSignal) =>
  getJson<InventoryPerformance>('/reports/inventory-performance', { params: { store_id: storeId, limit, offset }, signal });

export const getCostComparison = (storeId: string, signal?: AbortSignal) =>
  getJson<CostComparison>('/reports/cost-comparison', { params: { store_id: storeId }, signal });

export const postBacktest = async (storeId: string) =>
  (await apiClient.post<Backtest>('/reports/backtesting', { store_id: storeId }, { timeout: 120000, notifyForbidden: true })).data;

export const getRegistryModels = (signal?: AbortSignal) =>
  getJson<{ items: RegistryModel[]; total: number }>('/ml/models', { params: { limit: 100 }, signal });
