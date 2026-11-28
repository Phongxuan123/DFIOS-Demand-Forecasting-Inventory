/** Dashboard endpoints. Every field mirrors the backend schema; nothing is derived or defaulted here. */
import { getJson } from './apiClient.ts';

export interface DashboardKpis {
  total_skus: number;
  total_inventory_value: number;
  stockout_rate: number;
  estimated_service_level: number | null;
  reorder_alerts_count: number;
  pending_replenishments_count: number;
  /** Free text from the BE, e.g. "WRMSSE 0.4935" or "N/A". */
  avg_forecast_accuracy: string;
  total_suppliers: number;
  /** Production model WRMSSE from the registry (null when absent). */
  production_wrmsse?: number | null;
  production_model_id?: string | null;
  /** WRMSSE of the backtest engine the replay runs on (registry scope 'replay'). */
  replay_wrmsse?: number | null;
  replay_model_id?: string | null;
  /** APPROVED + COMPLETED orders with review_date in (clock start, clock now]. */
  orders_placed_count?: number | null;
}

export interface SegmentAvailability {
  class_id: string;
  target: number;
  c3out_availability: number | null;
  b0_availability: number | null;
  n_sku: number | null;
  n_periods: number | null;
  theta: number;
  multiplier: number;
  status: string;
}

export interface CostCurvePoint {
  date: string;
  cycle_index: number;
  c3out_total_cost: number;
  b0_total_cost: number | null;
  cost_savings: number | null;
  /** Cumulative cost components (A3 basis) of each policy at this review. */
  c3out_holding_cost?: number | null;
  c3out_ordering_cost?: number | null;
  c3out_stockout_cost?: number | null;
  b0_holding_cost?: number | null;
  b0_ordering_cost?: number | null;
  b0_stockout_cost?: number | null;
}

export interface KpiShadowDashboard {
  store_id: string;
  current_date: string;
  days_elapsed: number;
  reviews_elapsed: number;
  c3out_total_cost: number | null;
  b0_total_cost: number | null;
  total_cost_savings: number | null;
  c3out_overall_availability: number | null;
  b0_overall_availability: number | null;
  /** demo.md §6.2: fill rate (sold / demanded units, percent) of DFIOS and of the shadow B0 */
  c3out_fill_rate?: number | null;
  b0_fill_rate?: number | null;
  /** classes below the commitment over the last ``recent_cycles_used`` (≤ 4) closed cycles */
  classes_below_recent?: number | null;
  classes_measured_recent?: number | null;
  recent_cycles?: number;
  recent_cycles_used?: number;
  /** demo.md §6.2 period report: orders placed (DFIOS approved/completed lines, B0 shadow orders) and period start */
  c3out_orders_count?: number | null;
  b0_orders_count?: number | null;
  start_date?: string | null;
  segment_availabilities: SegmentAvailability[];
  cost_curves: CostCurvePoint[];
  source: string;
  as_of: string | null;
  n_skus: number | null;
  target_availability: number | null;
  /** Cost model text from the BE, e.g. "A3: h=0.002*price/day ..., b=0.35*price/lost unit, c=2/placed order". */
  cost_basis?: string | null;
  cost_reason: string | null;
  availability_reason: string | null;
  b0_reason: string | null;
  /** Stable codes (BE round 5): preferred over the Vietnamese *_reason texts. */
  cost_reason_code?: string | null;
  availability_reason_code?: string | null;
  b0_reason_code?: string | null;
}

export interface AlertItem {
  item_id: string;
  product_name: string;
  category: string | null;
  store_id: string;
  on_hand: number;
  on_order: number;
  safety_stock: number;
  reorder_point: number;
  severity: 'CRITICAL' | 'WARNING' | 'HEALTHY' | string;
  suggested_action: string;
  suggested_action_code?: string | null;
  suggested_action_params?: Record<string, string | number | null> | null;
}

export interface AlertsResponse {
  summary: { critical_count: number; warning_count: number; healthy_count: number; total_monitored: number };
  items: AlertItem[];
  total: number;
}

export interface CalibrationState {
  class_id: string;
  review_index: number;
  review_date: string;
  theta: number;
  multiplier: number;
  error_rate: number | null;
  at_boundary: boolean;
  setpoint: number;
}

export interface DemandTrendPoint {
  date: string;
  actual: number | null;
  predicted: number | null;
}

export const getKpis = (storeId: string, signal?: AbortSignal) =>
  getJson<DashboardKpis>('/dashboard/kpis', { params: { store_id: storeId }, signal });

export const getKpiShadowDashboard = (storeId: string, signal?: AbortSignal) =>
  getJson<KpiShadowDashboard>('/dashboard/kpi-dashboard', { params: { store_id: storeId }, signal });

export const getAlerts = (storeId: string, severity: string | undefined, limit: number, signal?: AbortSignal) =>
  getJson<AlertsResponse>('/dashboard/alerts', { params: { store_id: storeId, severity, limit }, signal });

export const getCalibrationHistory = (storeId: string, signal?: AbortSignal) =>
  getJson<CalibrationState[]>('/calibration/history', { params: { store_id: storeId, limit: 500 }, signal });

export interface DemandTrendResponse {
  data: DemandTrendPoint[];
  as_of?: string | null;
  forecast_note?: string | null;
  /** In replay: the causal backtest run the forecast line comes from (e.g. "backtest-ensemble-v1"); null otherwise. */
  forecast_source?: string | null;
  /** Days up to the clock: the forecast made this many days before the day (1 = the evening before). */
  forecast_past_horizon?: number | null;
  /** Days after the clock: the forecast made at the end of this day (= the clock date); null = no future path. */
  forecast_as_of?: string | null;
}

export const getDemandTrend = (storeId: string, days: number, signal?: AbortSignal, category?: string) =>
  getJson<DemandTrendResponse>('/dashboard/demand-trend', {
    params: { store_id: storeId, days, category },
    signal,
  });
