import { getJson } from './apiClient.ts';

export type StockStatus = 'below_s' | 'ok' | 'above_S' | 'no_params';

export const STOCK_STATUSES: readonly StockStatus[] = ['below_s', 'ok', 'above_S', 'no_params'];

export interface LatestRecommendation {
  id: string;
  status: string;
  recommended_qty: number;
  final_qty: number;
  review_date?: string | null;
  policy_applied?: string | null;
}

export interface InventoryScreenRow {
  item_id: string;
  name?: string | null;
  cat_id?: string | null;
  price?: number | null;
  segment?: string | null;
  abc_class?: string | null;
  xyz_class?: string | null;
  on_hand: number;
  on_order: number;
  ip: number;
  s?: number | null;
  S?: number | null;
  safety_stock?: number | null;
  eoq?: number | null;
  params_source?: string | null;
  params_model_run_id?: string | null;
  mean_daily_demand?: number | null;
  days_of_cover?: number | null;
  stock_status: StockStatus;
  stock_value?: number | null;
  cold_start: boolean;
  latest_recommendation?: LatestRecommendation | null;
}

export interface InventoryScreenSummary {
  sku_count: number;
  below_s_count: number;
  above_S_count: number;
  no_params_count: number;
  total_stock_value: number;
  priced_sku_count: number;
  units_in_transit: number;
  skus_in_transit: number;
  orders_in_transit: number;
}

export interface InventoryScreenResponse {
  store_id: string;
  as_of: string;
  as_of_source: 'sim_clock' | 'demo_default';
  demand_window_days: number;
  demand_days_observed: number;
  items: InventoryScreenRow[];
  total: number;
  skip: number;
  limit: number;
  summary: InventoryScreenSummary;
  notes: string[];
}

export interface InventoryScreenQuery {
  store_id: string;
  skip: number;
  limit: number;
  search?: string;
  cls?: string;
  status?: StockStatus | '';
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
}

export const getInventoryScreen = (q: InventoryScreenQuery, signal?: AbortSignal) =>
  getJson<InventoryScreenResponse>('/inventory-screen', {
    params: {
      store_id: q.store_id,
      skip: q.skip,
      limit: q.limit,
      search: q.search || undefined,
      class: q.cls || undefined,
      status: q.status || undefined,
      sort_by: q.sort_by || undefined,
      sort_dir: q.sort_dir || undefined,
    },
    signal,
  });

export interface WindowDistribution {
  model_run_id: string;
  route: string;
  stored: boolean;
  point_source?: string | null;
  n_residuals?: number | null;
  point_window: number;
  min_level?: number | null;
  q_min?: number | null;
  q50?: number | null;
  q80?: number | null;
  q90?: number | null;
  q95?: number | null;
  q99?: number | null;
  q_levels: Record<string, number>;
}

export interface MethodError {
  method: 'model' | 'snaive' | 'naive' | 'ma28';
  n_windows: number;
  mae?: number | null;
  mase?: number | null;
  bias?: number | null;
  bias_pct?: number | null;
}

export interface WindowErrorStats {
  lookback_days: number;
  unit: string;
  model_source?: string | null;
  n_windows: number;
  first_origin?: string | null;
  last_origin?: string | null;
  scale?: number | null;
  scale_days: number;
  methods: MethodError[];
  reason_code?: 'no_model_windows' | 'no_complete_windows' | 'no_mase_scale' | null;
}

export interface ImpliedPolicy {
  segment?: string | null;
  class_source?: string | null;
  tau: number;
  q_hat_tau: number;
  m_g: number;
  kappa_g: number;
  theta_g: number;
  policy_selection_id?: string | null;
  policy_source?: string | null;
  mean_daily_56?: number | null;
  eoq: number;
  s: number;
  S: number;
  price: number;
  stored_s?: number | null;
  stored_S?: number | null;
  stored_model_run_id?: string | null;
}

export interface ForecastWindowResponse {
  store_id: string;
  item_id: string;
  review_date: string;
  review_date_source: 'request' | 'sim_clock' | 'demo_default';
  lead_time_days: number;
  review_period_days: number;
  horizon_days: number;
  distribution: WindowDistribution;
  error_stats: WindowErrorStats;
  policy: ImpliedPolicy;
  notes: string[];
}

export const getForecastWindow = (store: string, item: string, reviewDate: string | undefined, signal?: AbortSignal) =>
  getJson<ForecastWindowResponse>('/forecast-explorer/window', {
    params: { store_id: store, item_id: item, review_date: reviewDate || undefined },
    signal,
  });
