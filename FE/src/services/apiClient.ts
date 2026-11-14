/**
 * Axios instance for the DFIOS backend.
 *
 * Behaviour (bug IDs from docs/PROJECT_REVIEW.md):
 *  - 401 on a request that carried the CURRENT token -> the session is cleared and
 *    `dfios:unauthorized` is dispatched (AuthContext listens and routes to /login).
 *    Network errors, timeouts and 5xx NEVER touch the session (R-22).
 *  - 403 raises a toast (`dfios:forbidden`) only for user-initiated mutations
 *    (POST/PUT/PATCH/DELETE). Background GETs stay silent (P-17, F-20).
 *    Per request override:  { notifyForbidden: true }   GET that the user explicitly triggered
 *                           { notifyForbidden: false }  background mutation
 *    The error is still rejected, so callers must render a "no permission" state
 *    (use `toApiError(err).kind === 'forbidden'`), never an empty list.
 */
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import {
  AUTH_FORBIDDEN_EVENT,
  AUTH_UNAUTHORIZED_EVENT,
  clearClientCaches,
  clearSession,
  getToken,
  type ForbiddenEventDetail,
} from './session.ts';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Force (true) or suppress (false) the global 403 toast. Default: mutations only. */
    notifyForbidden?: boolean;
  }
}

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token && config.headers && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const MUTATING = new Set(['post', 'put', 'patch', 'delete']);
/** Endpoints where 401 means "wrong credentials / bad token in the form", not "session expired". */
const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/activate', '/auth/forgot-password', '/auth/reset-password'];

function extractDetail(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return typeof data === 'string' && data.length < 300 ? data : undefined;
  const detail = (data as { detail?: unknown; message?: unknown }).detail ?? (data as { message?: unknown }).message;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => {
        if (typeof d === 'string') return d;
        if (d && typeof d === 'object') {
          const item = d as { msg?: unknown; message?: unknown; loc?: unknown };
          const msg = typeof item.msg === 'string' ? item.msg : typeof item.message === 'string' ? item.message : '';
          const loc = Array.isArray(item.loc) ? item.loc.filter((p) => p !== 'body').join('.') : '';
          return loc && msg ? `${loc}: ${msg}` : msg;
        }
        return '';
      })
      .filter(Boolean);
    return parts.length ? parts.join('; ') : undefined;
  }
  return undefined;
}

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status;
    const config = error.config;
    const url = config?.url ?? '';
    const method = (config?.method ?? 'get').toLowerCase();

    if (status === 401 && !PUBLIC_AUTH_PATHS.some((p) => url.includes(p))) {
      // Only sign out if the rejected request used the token we still hold. A late 401 from
      // a previous session must not kill a session the user has just started.
      const sent = String(config?.headers?.Authorization ?? '').replace(/^Bearer\s+/i, '');
      const current = getToken();
      if (current && sent === current) {
        clearSession();
        clearClientCaches();
        window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
      }
    }

    if (status === 403) {
      const notify = config?.notifyForbidden ?? MUTATING.has(method);
      if (notify) {
        const detail: ForbiddenEventDetail = {
          message: extractDetail(error.response?.data) ?? '',
          url,
          method,
        };
        window.dispatchEvent(new CustomEvent<ForbiddenEventDetail>(AUTH_FORBIDDEN_EVENT, { detail }));
      }
    }

    return Promise.reject(error);
  },
);

/* -------------------------------------------------------------------------- */
/* Normalised errors                                                          */
/* -------------------------------------------------------------------------- */

export type ApiErrorKind =
  | 'cancelled'
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'server'
  | 'unknown';

export interface ApiError {
  kind: ApiErrorKind;
  /** HTTP status, when the server answered. */
  status?: number;
  /** Server-provided detail (FastAPI `detail`), already flattened to text. May be in Vietnamese. */
  detail?: string;
  /** Technical message for logs. For UI text use `apiErrorMessage(err, t)`. */
  message: string;
}

export function isApiError(value: unknown): value is ApiError {
  return !!value && typeof value === 'object' && 'kind' in value && 'message' in value && !('isAxiosError' in value);
}

/** Converts anything thrown by apiClient (or anything else) into an ApiError. */
export function toApiError(err: unknown): ApiError {
  if (isApiError(err)) return err;
  if (axios.isCancel(err) || (err instanceof DOMException && err.name === 'AbortError')) {
    return { kind: 'cancelled', message: 'Request cancelled' };
  }
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const detail = extractDetail(err.response?.data);
    const message = detail ?? err.message;
    if (err.code === 'ERR_CANCELED') return { kind: 'cancelled', message };
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return { kind: 'timeout', message };
    if (!err.response) return { kind: 'network', message };
    if (status === 401) return { kind: 'unauthorized', status, detail, message };
    if (status === 403) return { kind: 'forbidden', status, detail, message };
    if (status === 404) return { kind: 'not_found', status, detail, message };
    if (status === 400 || status === 409 || status === 413 || status === 422) {
      return { kind: 'validation', status, detail, message };
    }
    if (status !== undefined && status >= 500) return { kind: 'server', status, detail, message };
    return { kind: 'unknown', status, detail, message };
  }
  if (err instanceof Error) return { kind: 'unknown', message: err.message };
  return { kind: 'unknown', message: String(err) };
}

type ErrorTranslator = (
  key:
    | 'common.errors.network'
    | 'common.errors.timeout'
    | 'common.errors.forbidden'
    | 'common.errors.unauthorized'
    | 'common.errors.not_found'
    | 'common.errors.server'
    | 'common.errors.validation'
    | 'common.errors.unknown',
) => string;

/**
 * User-facing text for an error. Validation / not-found errors show the server detail
 * (it is specific and actionable); transport errors use the translated generic text.
 */
export function apiErrorMessage(err: unknown, t: ErrorTranslator): string {
  const e = toApiError(err);
  switch (e.kind) {
    case 'network':
      return t('common.errors.network');
    case 'timeout':
      return t('common.errors.timeout');
    case 'unauthorized':
      return t('common.errors.unauthorized');
    case 'forbidden':
      return t('common.errors.forbidden');
    case 'not_found':
      return e.detail ?? t('common.errors.not_found');
    case 'validation':
      return e.detail ?? t('common.errors.validation');
    case 'server':
      return e.detail ? `${t('common.errors.server')} (${e.detail})` : t('common.errors.server');
    default:
      return e.detail ?? t('common.errors.unknown');
  }
}

/** `apiClient.get(url, config).then(r => r.data)` with a type parameter. */
export async function getJson<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await apiClient.get<T>(url, config);
  return res.data;
}

export default apiClient;
