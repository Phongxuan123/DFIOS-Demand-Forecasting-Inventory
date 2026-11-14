/**
 * Typed data hook. Aborts on unmount / when deps change, ignores stale responses, exposes
 * a normalised ApiError so components can tell "forbidden" from "empty".
 *
 *   const { data, loading, error, refetch } = useApi(
 *     (signal) => getJson<Item[]>('/products', { params, signal }),
 *     [params],
 *   );
 *   if (error?.kind === 'forbidden') -> render a "no permission" state, not an empty list
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError, type ApiError } from '../services/apiClient.ts';

export interface UseApiState<T> {
  data: T | undefined;
  loading: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export interface UseApiOptions {
  /** Skip the request (e.g. while no store is selected). Default true. */
  enabled?: boolean;
}

export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  options: UseApiOptions = {},
): UseApiState<T> {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: ApiError | null }>({
    data: undefined,
    loading: enabled,
    error: null,
  });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!enabled) {
      setState((s) => (s.loading ? { ...s, loading: false } : s));
      return;
    }
    const controller = new AbortController();
    let stale = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcherRef.current(controller.signal).then(
      (data) => {
        if (stale) return;
        setState({ data, loading: false, error: null });
      },
      (err: unknown) => {
        const e = toApiError(err);
        if (stale || e.kind === 'cancelled') return;
        setState((s) => ({ data: s.data, loading: false, error: e }));
      },
    );
    return () => {
      stale = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce, ...deps]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, refetch };
}
