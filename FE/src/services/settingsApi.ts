/**
 * API functions for the Settings page (profile, system settings, ML schedules, users, audit log, import).
 * Shapes mirror BE/app/schemas/*. Everything goes through apiClient.
 */
import { apiClient, getJson } from './apiClient.ts';

/* ------------------------------- profile / auth ------------------------------ */
export interface UserRecord {
  id: string;
  email: string;
  role: string;
  display_name?: string | null;
  is_active: boolean;
  is_verified: boolean;
  created_at?: string | null;
}

export const updateProfile = (displayName: string) =>
  apiClient.put<UserRecord>('/auth/profile', { display_name: displayName }).then((r) => r.data);

export const changePassword = (oldPassword: string, newPassword: string) =>
  apiClient.post<{ message: string }>('/auth/change-password', { old_password: oldPassword, new_password: newPassword }).then((r) => r.data);

export const requestEmailChange = (newEmail: string, currentPassword: string) =>
  apiClient.post<{ message: string }>('/auth/me/email', { new_email: newEmail, current_password: currentPassword }).then((r) => r.data);

/* -------------------------------- system settings ---------------------------- */
export interface SettingItem {
  key: string;
  value: unknown;
  description?: string | null;
  updated_at?: string | null;
}
export interface SettingsList {
  settings: SettingItem[];
  settings_dict: Record<string, unknown>;
}
export interface AlertThresholds {
  critical_service_level?: number;
  lead_time_buffer_days?: number;
  stockout_warning_ratio?: number;
  [k: string]: unknown;
}
export interface ServiceLevelConfig {
  default_service_level: number;
  category_service_levels: Record<string, number>;
  item_service_levels: Record<string, number>;
}

export const getSettings = (signal?: AbortSignal) => getJson<SettingsList>('/settings', { signal });

/** PUT one key. Callers send ONLY the keys the user changed. */
export const putSetting = (key: string, value: unknown) =>
  apiClient.put<SettingItem>(`/settings/${encodeURIComponent(key)}`, { value }).then((r) => r.data);

export const getServiceLevel = (signal?: AbortSignal) => getJson<ServiceLevelConfig>('/optimization/service-level', { signal });

/** Only `default_service_level` is sent; category/item overrides are left untouched on the server. */
export const putDefaultServiceLevel = (value: number) =>
  apiClient.put<ServiceLevelConfig>('/optimization/service-level', { default_service_level: value }).then((r) => r.data);

/* ------------------------- simulation parameters (demo.md §1.3) ------------------------- */
export interface SimulationCosts {
  holding_rate: number;
  stockout_penalty_rate: number;
  order_cost: number;
}
export interface SimulationParameters extends SimulationCosts {
  lead_time_days: number;
  review_period_days: number;
  horizon_days: number;
  defaults: SimulationCosts;
  limits: Record<keyof SimulationCosts, [number, number]>;
  target_availability: number;
  selection_guard: number;
  c3out: { eta: number; setpoint: number; theta_min: number; theta_max: number; variant: string };
  /** false once a clock left its start date: one replay keeps one set of costs */
  costs_editable: boolean;
  costs_locked_stores: string[];
}

export const getSimulationParameters = (signal?: AbortSignal) =>
  getJson<SimulationParameters>('/settings/simulation-parameters', { signal });

export const putSimulationCosts = (body: Partial<SimulationCosts>) =>
  apiClient.put<SimulationParameters>('/settings/simulation-parameters', body).then((r) => r.data);

/* ------------------------------------ users ---------------------------------- */
export const USERS_LIMIT = 500;
/** `total` comes from the X-Total-Count header (the body is a plain list). */
export const listUsers = async (signal?: AbortSignal): Promise<{ items: UserRecord[]; total: number }> => {
  const res = await apiClient.get<UserRecord[]>('/users', { params: { skip: 0, limit: USERS_LIMIT }, signal });
  const header = Number(res.headers?.['x-total-count']);
  return { items: res.data, total: Number.isFinite(header) && header >= 0 ? header : res.data.length };
};
export const deleteUser = (id: string) => apiClient.delete<{ message?: string }>(`/users/${encodeURIComponent(id)}`).then((r) => r.data);
export const revokeUserTokens = (id: string) => apiClient.post<{ message?: string }>(`/users/${id}/revoke-tokens`).then((r) => r.data);

export interface CreateUserBody {
  email: string;
  role: 'Admin' | 'Warehouse Manager' | 'Planner' | 'Viewer';
  display_name?: string;
  password?: string;
}
export const createUser = (body: CreateUserBody) => apiClient.post<UserRecord>('/users', body).then((r) => r.data);
export const setUserRole = (id: string, role: CreateUserBody['role']) => apiClient.put<UserRecord>(`/users/${id}`, { role }).then((r) => r.data);
export const setUserActive = (id: string, isActive: boolean) =>
  apiClient.patch<UserRecord>(`/users/${id}/status`, { is_active: isActive }).then((r) => r.data);
export const resendActivation = (id: string) => apiClient.post<{ message: string }>(`/users/${id}/resend-activation`).then((r) => r.data);

/* --------------------------------- data quality ------------------------------ */
export interface DataQualityIssue {
  check_type: string;
  item_id?: string | null;
  store_id?: string | null;
  severity: string;
  message: string;
  /** Present on newer backends: stable message code + params (preferred over `message`). */
  message_code?: string | null;
  message_params?: Record<string, string | number | null> | null;
  metric_value?: number | null;
}
export interface DataQualityRun {
  id: string;
  status: 'PASSED' | 'WARNING' | 'FAILED' | string;
  passed: boolean;
  triggered_by?: string | null;
  summary: {
    total_records: number;
    missing_rate: number;
    outliers_count: number;
    negative_values_count: number;
    duplicate_dates_count: number;
    invalid_sku_count: number;
    leakage_detected: boolean;
  };
  issues: DataQualityIssue[];
  created_at: string;
}
export interface DataQualityRequest {
  store_id?: string;
  cutoff_date?: string;
  max_missing_rate?: number;
  outlier_threshold_std?: number;
}
export const runDataQuality = (body: DataQualityRequest) =>
  apiClient.post<DataQualityRun>('/ml/data-quality/run', body, { timeout: 300000 }).then((r) => r.data);
export const listDataQualityRuns = (signal?: AbortSignal) =>
  getJson<{ items: DataQualityRun[]; total: number }>('/ml/data-quality', { params: { skip: 0, limit: 20 }, signal });

/* ----------------------------------- audit log ------------------------------- */
export interface AuditLog {
  id: string;
  actor_email?: string | null;
  action: string;
  ip_address?: string | null;
  details?: string | null;
  /** SUCCESS | FAILURE, derived by the BE from the action text (no status column). */
  result?: 'SUCCESS' | 'FAILURE' | string | null;
  result_source?: string | null;
  /** Newer backends: a real stored status (preferred over the derived `result`). */
  status?: 'SUCCESS' | 'FAILURE' | string | null;
  /** Newer backends: stable code + params for `details` (preferred over the Vietnamese free text). */
  details_code?: string | null;
  details_params?: Record<string, string | number | null> | null;
  created_at: string;
}
/** Stored status (newer BE) first, else the status the BE derives from the action text. */
export const auditOutcome = (r: Pick<AuditLog, 'status' | 'result'>): string | null => {
  const v = r.status || r.result || null;
  // Legacy rows of the BE round-5 schema carry result="unknown" (no recorded outcome): shown as "—", never as success.
  return v && v.toLowerCase() !== 'unknown' ? v : null;
};

export interface AuditList {
  items: AuditLog[];
  total: number;
  skip: number;
  limit: number;
}
export interface AuditQuery {
  skip: number;
  limit: number;
  action?: string;
  actor_email?: string;
  start_time?: string;
  end_time?: string;
}
export const listAuditLogs = (q: AuditQuery, signal?: AbortSignal) => getJson<AuditList>('/audit-logs', { params: q, signal });
export const listAuditActions = (signal?: AbortSignal) => getJson<string[]>('/audit-logs/actions', { signal });

/* ------------------------------------ schedules ------------------------------ */
export interface Schedule {
  id: string;
  name: string;
  cron_expression: string;
  model_name: string;
  horizon: number;
  store_id: string;
  auto_trigger_optimization: boolean;
  is_active: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  created_at: string;
  /** Added by the BE pipeline agent (R-19). Absent on older backends. */
  mode?: 'manual' | 'scheduled' | string | null;
  note?: string | null;
  last_run_status?: string | null;
}
export interface ScheduleList {
  total: number;
  items: Schedule[];
  mode?: string | null;
  note?: string | null;
}
export interface ScheduleCreate {
  name: string;
  cron_expression: string;
  model_name: string;
  horizon: number;
  store_id: string;
  auto_trigger_optimization: boolean;
}
export interface PipelineRun {
  run_id: string;
  status: string;
  model_name: string;
  store_id: string;
  forecasts_generated: number;
  inventory_params_updated: number;
  classifications_updated: number;
  replenishments_generated: number;
  started_at: string;
  completed_at: string;
  duration_seconds: number;
  /** Added by the BE (Q-01): which forecasts the run used. */
  forecast_source?: 'existing' | 'sba-croston-fallback' | 'none' | string | null;
  forecast_note?: string | null;
}
export const listSchedules = (signal?: AbortSignal) => getJson<ScheduleList>('/ml/schedule', { signal });
export const createSchedule = (body: ScheduleCreate) => apiClient.post<Schedule>('/ml/schedule', body).then((r) => r.data);
export const deleteSchedule = (id: string) => apiClient.delete(`/ml/schedule/${encodeURIComponent(id)}`).then(() => undefined);
export const runPipelineNow = (body: { model_name: string; horizon: number; store_id: string }) =>
  apiClient.post<PipelineRun>('/ml/pipeline/trigger-run', body, { timeout: 600000 }).then((r) => r.data);

/* ------------------------------------- import -------------------------------- */
export interface TemplateColumn {
  name: string;
  required: boolean;
  type: string;
  description: string;
  example: string;
}
export interface ImportTemplate {
  file_name: string;
  columns: TemplateColumn[];
  header: string[];
  required: string[];
  date_formats: string[];
  max_file_size_mb: number;
  notes?: string[];
}
export interface RejectedRow {
  row: number;
  item_id?: string | null;
  reason: string;
  /** Newer backends: stable code + params (preferred over the Vietnamese `reason`). */
  reason_code?: string | null;
  reason_params?: Record<string, string | number | null> | null;
}
export interface ImportResult {
  success?: boolean;
  import_id?: string;
  store_id?: string;
  file_name?: string;
  inserted?: number;
  updated?: number;
  rejected?: number;
  rejected_rows?: RejectedRow[];
  imported_count?: number;
  skipped_count?: number;
  message?: string;
  quality_report?: {
    date_format?: string;
    warnings?: string[];
    accepted_rows?: number;
    rejected_count?: number;
    [k: string]: unknown;
  };
}
export const getImportTemplate = (signal?: AbortSignal) => getJson<ImportTemplate>('/imports/template', { params: { format: 'json' }, signal });

/** CSV template as a Blob (download goes through apiClient so the bearer token is sent). */
export const downloadImportTemplate = () =>
  apiClient.get<Blob>('/imports/template', { params: { format: 'csv' }, responseType: 'blob', notifyForbidden: true }).then((r) => r.data);

export function uploadImport(storeId: string, file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  return apiClient
    .post<ImportResult>('/imports', form, {
      params: { store_id: storeId },
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000,
    })
    .then((r) => r.data);
}
