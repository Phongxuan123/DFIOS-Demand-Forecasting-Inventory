import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { apiClient, apiErrorMessage, toApiError } from './apiClient.ts';
import { AUTH_FORBIDDEN_EVENT, AUTH_UNAUTHORIZED_EVENT, getToken } from './session.ts';

function failWith(status: number | null): AxiosAdapter {
  return (config: InternalAxiosRequestConfig) => {
    if (status === null) return Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config));
    const response = { status, statusText: '', data: { detail: 'x' }, headers: {}, config };
    return Promise.reject(new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', config, null, response));
  };
}

const original = apiClient.defaults.adapter;
let unauthorized: Mock<() => void>;
let forbidden: Mock<() => void>;

beforeEach(() => {
  localStorage.setItem('access_token', 'tok-current');
  localStorage.setItem('user', '{"email":"a@b.c"}');
  unauthorized = vi.fn();
  forbidden = vi.fn();
  window.addEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorized);
  window.addEventListener(AUTH_FORBIDDEN_EVENT, forbidden);
});

afterEach(() => {
  apiClient.defaults.adapter = original;
  window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, unauthorized);
  window.removeEventListener(AUTH_FORBIDDEN_EVENT, forbidden);
});

describe('apiClient session handling (R-22)', () => {
  it('a 401 for the current token clears the session and signals sign-out', async () => {
    apiClient.defaults.adapter = failWith(401);
    await expect(apiClient.get('/dashboard/kpis')).rejects.toBeTruthy();
    expect(getToken()).toBeNull();
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('a 5xx never touches the session', async () => {
    apiClient.defaults.adapter = failWith(503);
    await expect(apiClient.get('/dashboard/kpis')).rejects.toBeTruthy();
    expect(getToken()).toBe('tok-current');
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('a network error never touches the session', async () => {
    apiClient.defaults.adapter = failWith(null);
    await expect(apiClient.get('/x')).rejects.toBeTruthy();
    expect(getToken()).toBe('tok-current');
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('demo.md 6.3: a 401 with a refresh token refreshes once and replays the request', async () => {
    localStorage.setItem('refresh_token', 'rt-1');
    const globalAdapter = axios.defaults.adapter;
    axios.defaults.adapter = (config: InternalAxiosRequestConfig) =>
      Promise.resolve({ status: 200, statusText: 'OK', data: { access_token: 'tok-new', refresh_token: 'rt-2' }, headers: {}, config });
    apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) =>
      String(config.headers?.Authorization) === 'Bearer tok-new'
        ? Promise.resolve({ status: 200, statusText: 'OK', data: { ok: true }, headers: {}, config })
        : failWith(401)(config);
    try {
      const res = await apiClient.get('/dashboard/kpis');
      expect(res.data).toEqual({ ok: true });
      expect(getToken()).toBe('tok-new');
      expect(localStorage.getItem('refresh_token')).toBe('rt-2');
      expect(unauthorized).not.toHaveBeenCalled();
    } finally {
      axios.defaults.adapter = globalAdapter;
      localStorage.removeItem('refresh_token');
    }
  });

  it('demo.md 6.3: a refused refresh signs out', async () => {
    localStorage.setItem('refresh_token', 'rt-revoked');
    const globalAdapter = axios.defaults.adapter;
    axios.defaults.adapter = failWith(401);
    apiClient.defaults.adapter = failWith(401);
    try {
      await expect(apiClient.get('/dashboard/kpis')).rejects.toBeTruthy();
      expect(getToken()).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
      expect(unauthorized).toHaveBeenCalledTimes(1);
    } finally {
      axios.defaults.adapter = globalAdapter;
    }
  });

  it('a late 401 that carried an OLD token does not kill the new session', async () => {
    apiClient.defaults.adapter = failWith(401);
    await expect(apiClient.get('/x', { headers: { Authorization: 'Bearer tok-old' } })).rejects.toBeTruthy();
    expect(getToken()).toBe('tok-current');
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('a 401 on the login endpoint is "bad credentials", not an expired session', async () => {
    apiClient.defaults.adapter = failWith(401);
    await expect(apiClient.post('/auth/login', {})).rejects.toBeTruthy();
    expect(unauthorized).not.toHaveBeenCalled();
    expect(getToken()).toBe('tok-current');
  });

  it('403 toasts only for mutations, not for background GETs', async () => {
    apiClient.defaults.adapter = failWith(403);
    await expect(apiClient.get('/replenishments')).rejects.toBeTruthy();
    expect(forbidden).not.toHaveBeenCalled();
    await expect(apiClient.post('/replenishments/1/approve')).rejects.toBeTruthy();
    expect(forbidden).toHaveBeenCalledTimes(1);
  });
});

describe('toApiError / apiErrorMessage', () => {
  it('classifies HTTP statuses', async () => {
    const kinds: Array<[number, string]> = [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [422, 'validation'],
      [500, 'server'],
    ];
    for (const [status, kind] of kinds) {
      apiClient.defaults.adapter = failWith(status);
      const err = await apiClient.get('/x', { headers: { Authorization: 'Bearer other' } }).catch((e: unknown) => e);
      expect(toApiError(err).kind).toBe(kind);
    }
  });

  it('reads a structured 422 detail (reason_code + reason) and keeps its code', async () => {
    apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) =>
      Promise.reject(
        new AxiosError('HTTP 422', 'ERR_BAD_REQUEST', config, null, {
          status: 422,
          statusText: '',
          headers: {},
          config,
          data: { detail: { reason_code: 'unknown_code_for_test', reason: 'R = 1 is not supported', supported_review_period_days: [7] } },
        }),
      );
    const err = toApiError(await apiClient.post('/simulation/what-if', {}).catch((e: unknown) => e));
    expect(err.kind).toBe('validation');
    expect(err.code).toBe('unknown_code_for_test');
    expect(err.detail).toBe('R = 1 is not supported');
    expect(err.data?.supported_review_period_days).toEqual([7]);
    // unknown code -> the server sentence is shown, never an empty message
    expect(apiErrorMessage(err, ((k: string) => k) as never)).toBe('R = 1 is not supported');
  });

  it('uses the translated generic text for transport errors', () => {
    const t = (key: string) => `T:${key}`;
    expect(apiErrorMessage({ kind: 'network', message: 'x' }, t as never)).toBe('T:common.errors.network');
    expect(apiErrorMessage({ kind: 'timeout', message: 'x' }, t as never)).toBe('T:common.errors.timeout');
  });
});
