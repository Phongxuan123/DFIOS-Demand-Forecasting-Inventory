import { getJson } from './apiClient.ts';

export interface ForecastQuality {
  status: 'ok' | 'no_data' | 'no_complete_window' | 'no_levels' | string;
  detail?: string | null;
  store_id: string;
  model_run_id: string | null;
  horizon_days: number;
  levels?: number[];
  coverage?: Record<string, number | null>;
  spl?: number | null;
  mase_median?: number | null;
  median_bias_pct?: number | null;
  n_origins?: number;
  n_items_used?: number;
  n_windows?: number;
  first_origin_date?: string;
  last_origin_date?: string;
  notes?: string[] | string | null;
}

export type ControllerStatus = 'Warm-up' | 'Active' | 'Boundary';

export interface ControllerClass {
  status: ControllerStatus | string;
  theta: number | null;
  n_sku: number;
  availability?: number | null;
  rolling_violation?: number | null;
  violating_windows?: number | null;
  recovery_days?: number | null;
}

export interface ControllerOverall {
  n_windows: number;
  gap_mean: number | null;
  min_class_csl: number | null;
  feasible: boolean | null;
  rolling_violation: number | null;
  rolling_worst: number | null;
  recovery_days: number | null;
  recovery_censored: boolean;
  n_boundary_classes: number;
}

export interface ControllerMetrics {
  store_id: string;
  target: number;
  event_date: string | null;
  n_complete_cycles: number;
  overall: ControllerOverall | null;
  classes: Record<string, ControllerClass>;
}

export interface ForecastQualityParams {
  horizonDays?: number;
  modelRunId?: string;
}

export const getForecastQuality = (storeId: string, params: ForecastQualityParams = {}, signal?: AbortSignal) =>
  getJson<ForecastQuality>('/metrics/forecast-quality', {
    params: { store_id: storeId, horizon_days: params.horizonDays, model_run_id: params.modelRunId },
    signal,
    timeout: 120000, // first (cold) computation scans the stored quantiles against realised demand
  });

export const getControllerMetrics = (storeId: string, eventDate?: string | null, signal?: AbortSignal) =>
  getJson<ControllerMetrics>('/metrics/controller', {
    params: { store_id: storeId, event_date: eventDate || undefined },
    signal,
  });
