/**
 * Selected store (kho), synced with the `?store=` query parameter (P-18) so a link or a
 * reload keeps the store. Stores come from GET /inventory/stores (a plain list of ids).
 *
 *   const { storeId, stores, setStoreId } = useStore();
 *   useApi((s) => getJson('/x', { params: { store_id: storeId }, signal: s }), [storeId], { enabled: !!storeId });
 *
 * Must be rendered inside the Router and only for authenticated users (Layout does this).
 * Internal links should keep the param: use `withStore(path)`.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { getJson, toApiError, type ApiError } from '../services/apiClient.ts';
import { registerCacheClearer } from '../services/session.ts';

export const STORE_PARAM = 'store';
const STORE_STORAGE_KEY = 'dfios_store';
const FALLBACK_STORE = 'CA_1';
/** Pseudo-store: every store together. The BE supports it for /calibration/*, /dashboard/kpi-dashboard (and answers 422 on forecasts). */
export const GLOBAL_STORE = 'GLOBAL';
/** Routes that can show the all-stores scope (elsewhere the selector offers real stores only). */
const GLOBAL_ROUTES = ['/', '/forecast-explorer'];

interface StoreContextValue {
  /**
   * Selected scope: a store id, or 'GLOBAL' on routes that support all stores (see `supportsGlobal`).
   * Pages that do not support GLOBAL must use `concreteStoreId`.
   */
  storeId: string | null;
  /** Always a real store (never GLOBAL). */
  concreteStoreId: string | null;
  isGlobal: boolean;
  supportsGlobal: boolean;
  stores: string[];
  loading: boolean;
  error: ApiError | null;
  setStoreId: (id: string) => void;
  reload: () => void;
  /** Append the current ?store= to an internal path. */
  withStore: (path: string) => string;
}

const StoreContext = createContext<StoreContextValue | null>(null);

// Short-lived cache so remounts do not refetch; wiped on login/logout (R-25).
let storesCache: string[] | null = null;
registerCacheClearer(() => {
  storesCache = null;
});

function readStoredStore(): string | null {
  try {
    return localStorage.getItem(STORE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [stores, setStores] = useState<string[]>(storesCache ?? []);
  const [loading, setLoading] = useState(storesCache === null);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (storesCache !== null && nonce === 0) return;
    const controller = new AbortController();
    getJson<string[]>('/inventory/stores', { signal: controller.signal, notifyForbidden: false }).then(
      (list) => {
        const clean = Array.isArray(list) ? [...list].sort() : [];
        storesCache = clean;
        setStores(clean);
        setLoading(false);
      },
      (err: unknown) => {
        const e = toApiError(err);
        if (e.kind === 'cancelled') return;
        setError(e);
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [nonce]);

  const param = searchParams.get(STORE_PARAM);
  const supportsGlobal = GLOBAL_ROUTES.includes(location.pathname.replace(/\/+$/, '') || '/');
  const concreteStoreId = useMemo<string | null>(() => {
    if (stores.length === 0) return null;
    if (param && stores.includes(param)) return param;
    const stored = readStoredStore();
    if (stored && stores.includes(stored)) return stored;
    return stores.includes(FALLBACK_STORE) ? FALLBACK_STORE : stores[0];
  }, [stores, param]);
  const wantGlobal = param === GLOBAL_STORE && supportsGlobal && stores.length > 0;
  const storeId = wantGlobal ? GLOBAL_STORE : concreteStoreId;

  // Keep the URL authoritative: add / repair ?store= (replace, no history entry).
  useEffect(() => {
    if (!storeId || param === storeId) return;
    const next = new URLSearchParams(searchParams);
    next.set(STORE_PARAM, storeId);
    setSearchParams(next, { replace: true });
  }, [storeId, param, searchParams, setSearchParams, location.pathname, supportsGlobal]);

  const setStoreId = useCallback(
    (id: string) => {
      try {
        if (id !== GLOBAL_STORE) localStorage.setItem(STORE_STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(STORE_PARAM, id);
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setNonce((n) => n + 1);
  }, []);
  const withStore = useCallback(
    (path: string) => {
      if (!storeId) return path;
      const [base, query = ''] = path.split('?');
      const q = new URLSearchParams(query);
      q.set(STORE_PARAM, storeId);
      return `${base}?${q.toString()}`;
    },
    [storeId],
  );

  const value = useMemo(
    () => ({ storeId, concreteStoreId, isGlobal: storeId === GLOBAL_STORE, supportsGlobal, stores, loading, error, setStoreId, reload, withStore }),
    [storeId, concreteStoreId, supportsGlobal, stores, loading, error, setStoreId, reload, withStore],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
