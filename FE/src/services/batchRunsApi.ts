import { getJson } from './apiClient.ts';

export type BatchJobType = 'ADVANCE' | 'J1' | 'J3' | 'J4' | 'J5' | 'J6' | string;
export type BatchStatus = 'queued' | 'running' | 'success' | 'failed' | string;

export interface BatchRunItem {
  id: string;
  run_id: string;
  job: BatchJobType;
  store_id: string;
  sim_date?: string | null;
  review_index?: number | null;
  status: BatchStatus;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  n_items?: number | null;
  triggered_by?: string | null;
  error?: string | null;
  details?: Record<string, unknown> | null;
}

export interface BatchRunsList {
  total: number;
  limit: number;
  offset: number;
  items: BatchRunItem[];
}

export interface BatchRunsQuery {
  store_id?: string;
  job?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface BatchJobSummary {
  count: number;
  duration_ms: number;
}

export interface BatchRunDetail extends BatchRunItem {
  jobs: BatchRunItem[];
  totals_by_job: Record<string, BatchJobSummary>;
}

export const listBatchRuns = (params: BatchRunsQuery, signal?: AbortSignal) =>
  getJson<BatchRunsList>('/batch-runs', { params, signal });

export const getBatchRunDetail = (runId: string, signal?: AbortSignal) =>
  getJson<BatchRunDetail>(`/batch-runs/${encodeURIComponent(runId)}`, { signal });
