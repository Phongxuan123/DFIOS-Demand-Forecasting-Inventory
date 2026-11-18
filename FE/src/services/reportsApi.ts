/** Reports endpoints. Fields mirror BE/app/schemas/{reports,simulation}.py; nothing is defaulted here. */
import apiClient, { getJson } from './apiClient.ts';

export interface PolicyRow {
  policy: string;
  /** Stable artifact key (B0 | B2 | PCR | P6): the label is rendered from i18n, `label` is the fallback. */
  policy_key?: string | null;
  label: string;
  description?: string | null;
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
  /** 10-day window Q0.95 coverage. coverage_q95: offline artifact c3ok (M5 test). coverage_q95_db_causal: route (c) on this DB. Same definition, different sample: never merge. */
  coverage_q95?: number | null;
  coverage_source?: string | null;
  coverage_q95_db_causal?: number | null;
  coverage_q95_db_causal_n?: number | null;
  policies: Record<string, PolicyRow>;
}

export interface InsightDetail {
  code: string;
  params: Record<string, string | number | null>;
}

export interface SimPolicyMetric {
  policy_id: string;
  /** Stable artifact key (B0 | B2 | PCR | P6): the label is rendered from i18n, policy_name is the fallback. */
  policy_key?: string | null;
  policy_name: string;
  description: string;
  /** Nullable on newer backends when a figure is not in the source (rendered "—", never 0). */
  total_cost: number | null;
  holding_cost: number | null;
  ordering_cost: number | null;
  stockout_cost: number | null;
  availability: number | null;
  total_orders: number | null;
  total_stockouts: number | null;
  stockouts_reason: string | null;
  stockouts_reason_code?: string | null;
  /** null = feasibility unknown (no availability figure). */
  is_feasible: boolean | null;
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
  recommended_policy_key?: string | null;
  policies: SimPolicyMetric[];
  /** Human text (Vietnamese) kept for compatibility; insight_details carries the same insights as codes. */
  insights: string[];
  insight_details?: InsightDetail[];
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
  metrics_reason_code?: string | null;
  metrics_reason_params?: Record<string, string | number | null> | null;
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
  reason_code?: string | null;
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
  reason_code?: string | null;
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
  reason_code?: string | null;
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

/* --------------------------------- FR10 what-if ------------------------------ */
export interface WhatIfRequest {
  store_id: string;
  /** L (days). The BE accepts 1 | 3 | 7. */
  lead_time_days: number;
  /** R (days). Only the spacing of the stored review forecasts can be replayed (422 otherwise). */
  review_period_days: number;
  /** h: holding cost per unit per day, share of price. */
  holding_rate: number;
  /** b: penalty per lost unit, share of price. */
  stockout_penalty_rate: number;
  /** c: cost per order line. */
  order_cost: number;
  tau?: number;
  n_reviews?: number;
}
export interface WhatIfMetrics {
  total_cost: number;
  holding_cost: number;
  shortage_cost: number;
  ordering_cost: number;
  orders: number;
  availability?: number | null;
  availability_pct?: number | null;
  fill_rate?: number | null;
  lost_units?: number;
  demand_units?: number;
  n_items?: number;
  n_sku_periods?: number;
}
export interface WhatIfClassResult extends WhatIfMetrics {
  class_id: string;
  m_g: number;
  kappa_g: number;
  theta_g?: number;
  /** stored | default_no_stored_selection | request */
  params_source?: string | null;
}
export interface WhatIfPolicyResult {
  policy_key: string;
  label?: string | null;
  overall: WhatIfMetrics;
  by_class: WhatIfClassResult[];
}
export interface WhatIfResponse {
  source: string;
  simulated: boolean;
  store_id: string;
  as_of?: string | null;
  lead_time_days: number;
  review_period_days: number;
  horizon_days?: number;
  tau?: number;
  holding_rate?: number;
  stockout_penalty_rate?: number;
  order_cost?: number;
  n_reviews?: number;
  period_start?: string | null;
  period_end?: string | null;
  /** Review periods R (days) the server can replay for this store and L (also sent with a 422). */
  r_options?: number[];
  quantile_basis?: string;
  initial_stock_basis?: string;
  policies: WhatIfPolicyResult[];
  skipped_classes?: Array<{ class_id: string; reason_code: string; reason: string }>;
  notes?: string[];
}

/** Narrow an unknown payload to a usable what-if result (defensive: old or partial backends). */
export function isWhatIfResponse(v: unknown): v is WhatIfResponse {
  if (!v || typeof v !== 'object') return false;
  const p = (v as { policies?: unknown }).policies;
  return Array.isArray(p) && p.every((x) => !!x && typeof x === 'object' && 'overall' in (x as object) && 'policy_key' in (x as object));
}

/** POST /simulation/what-if (FR10). A REAL replay on the store history; long-running. */
export const postWhatIf = async (body: WhatIfRequest) =>
  (await apiClient.post<WhatIfResponse>('/simulation/what-if', body, { timeout: 300000, notifyForbidden: true })).data;

export const getPolicyBenchmark =(signal?: AbortSignal) => getJson<PolicyBenchmark>('/reports/policy-comparison', { signal });

export const postComparePolicies = async (storeId: string, signal?: AbortSignal) =>
  (await apiClient.post<PolicyComparison>('/simulation/compare-policies', { store_id: storeId }, { signal })).data;

export const getForecastAccuracy = (storeId: string, signal?: AbortSignal) =>
  getJson<ForecastAccuracy>('/reports/forecast-accuracy', { params: { store_id: storeId }, signal, timeout: 120000 }); // cold: db-causal coverage scan

export const getInventoryPerformance = (storeId: string, limit: number, offset: number, signal?: AbortSignal) =>
  getJson<InventoryPerformance>('/reports/inventory-performance', { params: { store_id: storeId, limit, offset }, signal });

export const getCostComparison = (storeId: string, signal?: AbortSignal) =>
  getJson<CostComparison>('/reports/cost-comparison', { params: { store_id: storeId }, signal });

export const postBacktest = async (storeId: string) =>
  (await apiClient.post<Backtest>('/reports/backtesting', { store_id: storeId }, { timeout: 120000, notifyForbidden: true })).data;

export const getRegistryModels = (signal?: AbortSignal) =>
  getJson<{ items: RegistryModel[]; total: number }>('/ml/models', { params: { limit: 100 }, signal });

export interface E10bReference {
  available: boolean;
  message?: string;
  matches?: boolean;
  replay?: Record<string, number | null>;
  teacher?: Record<string, number>;
  delta?: Record<string, number | null>;
  checks?: Record<string, boolean>;
  selection_schedule?: Array<{ start: number | string | null; m: unknown; kappa: unknown }>;
}

export const getE10bReference = (signal?: AbortSignal) => getJson<E10bReference>('/reference/e10b', { signal });
