/** API functions for the Replenishment page (own module, uses apiClient directly). */
import apiClient, { getJson } from './apiClient.ts';

export type RecStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | string;
export interface ReplenishmentItem {
  id: string;
  item_id: string;
  store_id: string;
  product_name?: string | null;
  category?: string | null;
  supplier_id?: string | null;
  supplier_name?: string | null;
  on_hand: number;
  on_order: number;
  rop: number;
  safety_stock: number;
  order_up_to_S?: number | null;
  reorder_point_s?: number | null;
  inventory_position?: number | null;
  eoq_quantity?: number | null;
  policy_applied?: string | null;
  review_date?: string | null;
  recommended_qty: number;
  final_qty: number;
  priority: string;
  status: RecStatus;
  reason?: string | null;
  decided_by?: string | null;
  created_at: string;
  decided_at?: string | null;
  /** Calibrated C3-OUT fields (null when the recommendation was not produced by C3-OUT). */
  abc_xyz_class?: string | null;
  theta?: number | null;
  m_g?: number | null;
  kappa_g?: number | null;
  q_hat?: number | null;
  lead_time_days?: number | null;
}
export interface ReplenishmentList {
  items: ReplenishmentItem[];
  total: number;
  skip: number;
  limit: number;
  pending_count: number;
  approved_count: number;
}
export interface RecParams {
  skip: number;
  limit: number;
  store_id: string;
  status?: string;
  priority?: string;
  search?: string;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
}

export const listReplenishments = (p: RecParams, signal?: AbortSignal) =>
  getJson<ReplenishmentList>('/replenishments', { params: p, signal });
export const listReplenishmentHistory = (
  p: { skip: number; limit: number; store_id: string; item_id?: string; status?: string },
  signal?: AbortSignal,
) => getJson<ReplenishmentList>('/replenishments/history', { params: p, signal });

export const approveReplenishment = (id: string) =>
  apiClient.post<ReplenishmentItem>(`/replenishments/${id}/approve`).then((r) => r.data);
export const rejectReplenishment = (id: string, reason: string) =>
  apiClient.post<ReplenishmentItem>(`/replenishments/${id}/reject`, { reason }).then((r) => r.data);
export const cancelReplenishment = (id: string, reason: string) =>
  apiClient.post<ReplenishmentItem>(`/replenishments/${id}/cancel`, { reason }).then((r) => r.data);
export const adjustReplenishment = (id: string, final_qty: number, reason: string) =>
  apiClient.put<ReplenishmentItem>(`/replenishments/${id}/adjust`, { final_qty, reason }).then((r) => r.data);
export const generateReplenishments = (storeId: string) =>
  apiClient
    .post<{ success: boolean; generated_count: number; message: string }>('/replenishments/generate', null, {
      params: { store_id: storeId },
    })
    .then((r) => r.data);

export async function exportReplenishmentsCsv(storeId: string, status?: string): Promise<void> {
  const res = await apiClient.get('/replenishments/export', {
    params: { store_id: storeId, status },
    responseType: 'blob',
    notifyForbidden: true,
  });
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `replenishment_${storeId}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export interface PolicyParam {
  item_id: string;
  store_id: string;
  lead_time_days: number;
  service_level: number;
  safety_stock: number;
  reorder_point: number;
  eoq: number;
  s?: number | null;
  S?: number | null;
  model_run_id?: string | null;
  source: string;
}
export const getPolicyParam = (itemId: string, storeId: string, signal?: AbortSignal) =>
  getJson<{ items: PolicyParam[] }>('/optimization/parameters', {
    params: { item_id: itemId, store_id: storeId, limit: 1 },
    signal,
  });

export interface CalibrationStatus {
  store_id: string;
  latest_review_index: number;
  latest_review_date?: string | null;
  thetas: Record<string, number>;
  multipliers: Record<string, number>;
  at_boundary_classes: string[];
  has_warning: boolean;
}
export const getCalibrationStatus = (storeId: string, signal?: AbortSignal) =>
  getJson<CalibrationStatus>('/calibration/status', { params: { store_id: storeId }, signal });
