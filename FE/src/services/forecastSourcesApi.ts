import apiClient, { getJson } from './apiClient.ts';

export interface AvailableSourceModel {
  model: string;
  n_origins: number;
  first_origin: string;
  last_origin: string;
}

export interface ModelActivationLog {
  model: string;
  previous_model?: string | null;
  from_date: string;
  n_origins: number;
  n_rows: number;
  activated_by?: string | null;
  activated_at: string;
}

export interface ForecastSourcesOverview {
  store_id: string;
  horizon_days: number;
  clock_date: string | null;
  active_model: string | null;
  available_models: AvailableSourceModel[];
  activations: ModelActivationLog[];
}

export interface ActivateSourceRequest {
  store_id: string;
  model: string;
  horizon_days?: number;
}

export interface ActivateSourceResponse {
  store_id: string;
  model: string;
  previous_model?: string | null;
  from_date: string;
  to_date: string;
  n_origins: number;
  n_rows: number;
  clock_date: string;
  activation_id: string;
}

export const getForecastSources = (storeId: string = 'CA_1', signal?: AbortSignal) =>
  getJson<ForecastSourcesOverview>('/forecast-sources', { params: { store_id: storeId }, signal });

export const activateForecastSource = (body: ActivateSourceRequest) =>
  apiClient.post<ActivateSourceResponse>('/forecast-sources/activate', body).then((r) => r.data);

