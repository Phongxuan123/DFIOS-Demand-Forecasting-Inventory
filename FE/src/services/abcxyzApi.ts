/**
 * API functions for the ABC/XYZ page. Every call is store scoped (P-10) and goes through apiClient.
 * Shapes mirror BE/app/schemas/classification.py and optimization.py.
 */
import { apiClient, getJson } from './apiClient.ts';

export interface ClassificationThresholds {
  a_cutoff: number;
  b_cutoff: number;
  c_cutoff: number;
  cv_x: number;
  cv_y: number;
}

export interface SegmentSummary {
  segment: string;
  abc: string;
  xyz: string;
  sku_count: number;
  sku_percentage: number;
  revenue: number;
  revenue_percentage: number;
}

export interface ClassificationMatrix {
  total_skus: number;
  total_revenue: number;
  segments: SegmentSummary[];
  matrix: Record<string, SegmentSummary>;
  thresholds: ClassificationThresholds;
  last_updated?: string | null;
  store_id?: string | null;
  class_sources?: Record<string, number>;
}

export interface SkuClassification {
  id: string;
  item_id: string;
  store_id?: string | null;
  class_source?: string | null;
  threshold_segment?: string | null;
  product_name?: string | null;
  category?: string | null;
  abc: string;
  xyz: string;
  segment: string;
  revenue: number;
  revenue_share: number;
  cumulative_share: number;
  mean_demand: number;
  std_demand: number;
  cv: number;
  updated_at: string;
}

export interface SkuListResponse {
  items: SkuClassification[];
  total: number;
  skip: number;
  limit: number;
}

export interface Recommendation {
  segment: string;
  description: string;
  strategy: string;
  review_frequency: string;
  replenishment_policy: string;
  safety_stock_level: string;
  priority: string;
}

export interface ServiceLevelConfig {
  default_service_level: number;
  category_service_levels: Record<string, number>;
  item_service_levels: Record<string, number>;
}

export interface RecomputeResult {
  success: boolean;
  message: string;
  total_skus_classified: number;
  thresholds: ClassificationThresholds;
  recomputed_at: string;
  store_id?: string | null;
  source: string;
  class_sources?: Record<string, number>;
}

export interface SkuQuery {
  store_id: string;
  segment?: string;
  category?: string;
  search?: string;
  skip?: number;
  limit?: number;
  sort_by?: string;
  order?: 'asc' | 'desc';
}

export const getMatrix = (storeId: string, signal?: AbortSignal) =>
  getJson<ClassificationMatrix>('/classification/matrix', { params: { store_id: storeId }, signal });

export const getSkus = (q: SkuQuery, signal?: AbortSignal) =>
  getJson<SkuListResponse>('/classification/skus', { params: q, signal });

/** Policy in force for one ABC x XYZ class (GET /optimization/policies/current). */
export interface CurrentPolicy {
  class_id: string;
  selection_id: string;
  scope: 'store' | 'global' | string;
  policy_type: string;
  m_g: number;
  kappa_g: number;
  setpoint: number | null;
  val_cost: number | null;
  val_service: number | null;
  is_feasible: boolean | null;
  source: string | null;
  selected_at: string | null;
  theta: number | null;
}

export const getCurrentPolicies = (storeId: string, signal?: AbortSignal) =>
  getJson<CurrentPolicy[]>('/optimization/policies/current', { params: { store_id: storeId }, signal });

export const getRecommendations = (signal?: AbortSignal) =>
  getJson<Recommendation[]>('/classification/recommendations', { signal });

export const getServiceLevel = (signal?: AbortSignal) =>
  getJson<ServiceLevelConfig>('/optimization/service-level', { signal });

export const getCategories = (signal?: AbortSignal) => getJson<string[]>('/products/categories', { signal });

export async function recompute(storeId: string, source: 'auto' | 'thresholds'): Promise<RecomputeResult> {
  // Recompute can take a while on a full store: allow 2 minutes.
  const res = await apiClient.post<RecomputeResult>('/classification/recompute', null, {
    params: { store_id: storeId, source },
    timeout: 120000,
  });
  return res.data;
}
