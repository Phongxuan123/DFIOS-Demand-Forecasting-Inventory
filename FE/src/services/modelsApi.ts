/**
 * Model Performance API (admin only). Every function is a thin wrapper over the real
 * endpoints; nothing here invents data. Paths are under /ml (see BE api_router.py).
 */
import { apiClient, getJson } from './apiClient.ts';

export type MetricMap = Record<string, unknown>;

export interface RegisteredModel {
  id: string;
  name: string;
  version: string;
  algorithm: string;
  scope: string;
  is_production: boolean;
  parameters: Record<string, unknown> | null;
  metrics: MetricMap | null;
  trained_by: string | null;
  job_id: string | null;
  created_at: string;
  promoted_at: string | null;
}

export interface ModelListResponse {
  items: RegisteredModel[];
  total: number;
}

export interface ValidationResult {
  success: boolean;
  model_id: string;
  model_name: string;
  version: string;
  algorithm: string;
  sample_skus_tested: number;
  validation_passed: boolean;
  artifact_integrity: {
    artifact_file: string | null;
    file_exists: boolean;
    file_size_bytes: number;
    sha256: string | null;
  };
  metrics: MetricMap | null;
  message: string;
}

export interface TrainJob {
  id: string;
  status: string;
  triggered_by: string | null;
  parameters: Record<string, unknown>;
  metrics: Record<string, MetricMap> | null;
  best_model: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface TrainJobListResponse {
  items: TrainJob[];
  total: number;
}

export interface TrainRequest {
  models: string[];
  horizon: number;
  item_ids?: string[];
  register_candidate: boolean;
}

export const listModels = (signal?: AbortSignal) =>
  getJson<ModelListResponse>('/ml/models', { params: { skip: 0, limit: 100 }, signal });

export const validateModel = async (id: string): Promise<ValidationResult> => {
  const res = await apiClient.post<ValidationResult>(`/ml/models/${encodeURIComponent(id)}/validate`, null, { timeout: 60000 });
  return res.data;
};

export const promoteModel = async (id: string): Promise<{ message: string }> => {
  const res = await apiClient.post<{ message: string }>(`/ml/models/${encodeURIComponent(id)}/promote`);
  return res.data;
};

export const listTrainJobs = (skip: number, limit: number, signal?: AbortSignal) =>
  getJson<TrainJobListResponse>('/ml/train', { params: { skip, limit }, signal });

export const startTraining = async (body: TrainRequest): Promise<{ job_id: string; status: string; message: string }> => {
  const res = await apiClient.post<{ job_id: string; status: string; message: string }>('/ml/train', body);
  return res.data;
};

/** Finite number from an unknown metric value, otherwise null (never 0). */
export function metricNumber(metrics: MetricMap | null | undefined, ...keys: string[]): number | null {
  if (!metrics) return null;
  for (const k of keys) {
    const v = metrics[k];
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
}
