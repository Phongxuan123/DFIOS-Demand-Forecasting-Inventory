/**
 * Forecast Explorer API. Thin typed wrappers over /forecasts/* and /forecast/fast-inference.
 * Nothing here substitutes or invents values: missing quantiles stay null.
 */
import { apiClient, getJson } from './apiClient.ts';

export interface ForecastRow {
  id: string;
  item_id: string;
  store_id: string;
  forecast_date: string;
  /** Real forecast step 1..28. Overrides must be keyed by this, never by a list index. */
  h: number;
  y_pred: number;
  original_value: number | null;
  is_overridden: boolean;
  override_reason: string | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  product_name: string | null;
  category: string | null;
  model_version: string;
  generated_at: string | null;
  /** forecast_date <= simulated clock date of the store. */
  backtest?: boolean;
  source?: 'production_artifact' | 'backtest' | 'forecast_table' | string;
}

export interface ForecastListResponse {
  items: ForecastRow[];
  total: number;
  horizon: number;
  model_version: string | null;
  skip: number;
  limit: number;
  /** Exactly one version is returned; the others are listed here. */
  available_versions?: string[];
  model_name?: string | null;
  store_id?: string | null;
  source?: string | null;
  backtest?: boolean | null;
}

export interface HistoryResponse {
  item_id: string;
  store_id: string | null;
  count: number;
  history: Array<{ date: string; quantity: number }>;
}

export interface CompareResponse {
  item_id: string;
  model_version: string | null;
  model_version_source?: 'requested' | 'resolved_ensemble' | 'resolved_other' | 'none' | string;
  /** Newer backends return null (not 0) when nothing overlaps; both shapes are handled. */
  metrics: { mae: number | null; rmse: number | null; mase?: number | null; mase_scale_n?: number | null; mape: number | null; total_actual: number | null; total_predicted: number | null; data_points: number | null; metrics_reason?: string | null; metrics_reason_code?: string | null };
}

export interface UncertaintyResponse {
  item_id: string;
  horizon: number;
  sigma_h: number | null;
  points: Array<{ forecast_date: string; h: number; y_pred: number; p10: number | null; p50: number | null; p90: number | null }>;
}

export interface ShapFeature {
  feature_name: string;
  importance_score: number;
  direction: string | null;
  description: string | null;
}

export interface ExplanationResponse {
  item_id: string;
  model_name: string;
  model_version: string;
  base_value: number;
  features: ShapFeature[];
  /** U-03: true only when the BE computed real per-SKU SHAP values. Absent/false = do not present as real. */
  available?: boolean;
  /** Where the values come from (e.g. 'shap_tree_explainer'). */
  source?: string | null;
  /** Why the explanation is unavailable (BE text, may be Vietnamese). */
  reason?: string | null;
  /** Stable code (e.g. "no_stored_shap"); when present the UI shows its own localized text. */
  reason_code?: string | null;
}

export interface WindowQuantileResponse {
  id: string;
  model_run_id: string;
  store_id: string;
  item_id: string;
  origin_date: string;
  horizon_days: number;
  point_window: number;
  q_levels: Record<string, number>;
  tau_95: number;
  route: string;
}

export interface OverrideRow {
  id: string;
  item_id: string;
  store_id: string;
  forecast_date: string;
  h: number | null;
  original_value: number;
  override_value: number;
  reason: string;
  created_by: string;
  created_at: string;
  is_active: boolean;
}

export interface ProductRow {
  item_id: string;
  name: string;
  dept_id: string | null;
  cat_id: string | null;
}

export interface ProductListResponse {
  items: ProductRow[];
  total: number;
}

export interface FastInferenceResponse {
  success: boolean;
  store_id: string;
  horizon: number;
  skus_forecasted: number;
  records_generated: number;
  duration_seconds: number;
  message: string;
  /** BE round 5: 'production_forecast' (nothing generated, the Ensemble run exists) | 'sba_fallback'. */
  source?: 'production_forecast' | 'sba_fallback' | string | null;
  model_version?: string | null;
  records_available?: number | null;
  note?: string | null;
}

const sku = (s: string) => encodeURIComponent(s);

export const listProducts = (params: { page: number; page_size: number; q?: string; cat_id?: string; dept_id?: string }, signal?: AbortSignal) =>
  getJson<ProductListResponse>('/products', {
    params: { ...params, q: params.q || undefined, cat_id: params.cat_id || undefined, dept_id: params.dept_id || undefined },
    signal,
  });

export const listCategories = (signal?: AbortSignal) => getJson<string[]>('/products/categories', { signal });

export const getForecasts = (item: string, store: string, horizon: number, signal?: AbortSignal, modelVersion?: string) =>
  getJson<ForecastListResponse>('/forecasts', { params: { item_id: item, store_id: store, horizon, limit: 200, model_version: modelVersion || undefined }, signal });

export const getHistory = (item: string, store: string, startDate: string | undefined, signal?: AbortSignal) =>
  getJson<HistoryResponse>(`/forecasts/${sku(item)}/history`, {
    params: { store_id: store, granularity: 'daily', start_date: startDate },
    signal,
  });

export const getCompare = (item: string, store: string, signal?: AbortSignal) =>
  getJson<CompareResponse>(`/forecasts/${sku(item)}/compare`, { params: { store_id: store }, signal });

export const getUncertainty = (item: string, store: string, horizon: number, signal?: AbortSignal) =>
  getJson<UncertaintyResponse>(`/forecasts/${sku(item)}/uncertainty`, { params: { store_id: store, horizon }, signal });

export const getExplanation = (item: string, store: string, signal?: AbortSignal) =>
  getJson<ExplanationResponse>(`/forecasts/${sku(item)}/explanation`, { params: { store_id: store }, signal });

/** One day of GET /forecasts/{sku}/future: the production bundle (or its SBA fallback), after the end of M5. */
export interface FutureForecastRow {
  item_id: string;
  store_id: string;
  h: number;
  y_pred: number;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  available?: boolean;
  model_version: string;
  source: string;
}

export const getFutureForecast = (item: string, store: string, signal?: AbortSignal) =>
  getJson<FutureForecastRow[]>(`/forecasts/${sku(item)}/future`, { params: { store_id: store, horizon: 28 }, signal });

export const getWindowQuantiles = (item: string, store: string, signal?: AbortSignal) =>
  getJson<WindowQuantileResponse>(`/forecasts/${sku(item)}/window-quantiles`, {
    params: { store_id: store, horizon_days: 10 },
    signal,
  });

export const listOverrides = (item: string, store: string, signal?: AbortSignal) =>
  getJson<OverrideRow[]>(`/forecasts/${sku(item)}/overrides`, { params: { store_id: store }, signal });

export interface OverrideInput {
  forecast_date: string;
  override_value: number;
  reason: string;
  store_id: string;
  /** REAL horizon step from the API row. */
  h: number;
}

export const createOverride = async (item: string, body: OverrideInput): Promise<OverrideRow> => {
  const res = await apiClient.post<OverrideRow>(`/forecasts/${sku(item)}/override`, body);
  return res.data;
};

export const revertOverride = async (item: string, id: string) => {
  const res = await apiClient.delete(`/forecasts/${sku(item)}/override/${encodeURIComponent(id)}`);
  return res.data as { success: boolean; message: string };
};

export interface BulkOverrideItemInput {
  store_id: string;
  item_id: string;
  date: string;
  h: number;
  value: number;
  reason: string;
}

export const bulkOverride = async (items: BulkOverrideItemInput[]) => {
  const res = await apiClient.post<{ created_count: number; skipped_count: number; errors: unknown[] }>('/forecasts/bulk-override', { items });
  return res.data;
};

/** Store-wide SBA forecast (manager+). Whole store, so allow a longer timeout than the default 15 s. */
export const runFastInference = async (storeId: string, horizon = 28): Promise<FastInferenceResponse> => {
  const res = await apiClient.post<FastInferenceResponse>('/forecast/fast-inference', { store_id: storeId, horizon }, { timeout: 180000 });
  return res.data;
};
