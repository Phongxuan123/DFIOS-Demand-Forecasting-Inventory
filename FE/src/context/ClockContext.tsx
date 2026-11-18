/**
 * Simulation clock, 100% from the backend (F-04, P-33): there is no local offset and nothing
 * in sessionStorage. GET /clock?store_id (Manager/Admin) is the only source; `advance(days)`
 * calls POST /clock/advance (Admin only, runs the J1-J6 batch chain on the server) and then
 * re-reads the clock.
 *
 *   const { clock, status, reason, advance, refresh, version } = useClock();
 *   // `version` increases after every successful advance: add it to a page's useApi deps to refetch.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.tsx';
import { useStore } from './StoreContext.tsx';
import { can } from '../auth/permissions.ts';
import { apiClient, getJson, toApiError } from '../services/apiClient.ts';

/** R5F-11: the ONE list of clock-advance choices (days), used by the Dashboard card and the top-bar chip. */
export const CLOCK_ADVANCE_DAYS = [1, 7, 14, 28] as const;

export interface SimClock {
  store_id: string;
  current_date: string;
  start_date: string;
  mode: string;
  speed: number;
  updated_at: string;
  days_elapsed: number;
  /** Index k of the latest review (days_elapsed // R); excludes the day-0 review. */
  reviews_elapsed: number;
  /** Reviews run since start INCLUDING the day-0 review (same counting as ClockAdvanceResult.reviews_executed). */
  reviews_executed_total?: number | null;
}

export interface ClockAdvanceResult {
  success: boolean;
  store_id: string;
  previous_date: string;
  current_date: string;
  days_advanced: number;
  /** Includes the day-0 review when the advance started at start_date (see day0_review_executed). */
  reviews_executed: number;
  day0_review_executed?: boolean;
  stockouts_recorded: number;
  recommendations_generated: number;
  job_events: string[];
  message: string;
  /** Server processing time of the batch chain (BE field, may be absent on old backends). */
  duration_seconds?: number | null;
  approval_mode?: string;
  stopped_at_review?: boolean;
  pending_expired?: number;
  run_id?: string | null;
}

export interface AdvanceOptions {
  days?: number;
  reviews?: number;
  until?: string;
  approval_mode?: 'auto' | 'planner';
  expire_pending?: boolean;
  async_job?: boolean;
}

/** Measured duration of the last advance in this session: the only honest basis for a time hint. */
export interface AdvanceTiming {
  days: number;
  seconds: number;
}

export type ClockStatus = 'loading' | 'ready' | 'unavailable';
/** Why the clock is unavailable: maps to shell.clock.unavailable_<reason>. */
export type ClockReason = 'forbidden' | 'missing' | 'no_store' | 'error';

interface ClockContextValue {
  clock: SimClock | null;
  status: ClockStatus;
  reason: ClockReason | null;
  canAdvance: boolean;
  advancing: boolean;
  /** Wall-clock start of the running advance (ms), for the elapsed-time indicator. */
  advanceStartedAt: number | null;
  /** Last measured advance in this session (null before the first one). */
  lastTiming: AdvanceTiming | null;
  /** Increments after each successful advance. */
  version: number;
  /** Re-read the clock from the server. */
  refresh: () => void;
  /** Throws the ApiError-able error on failure; resolves with the batch summary. */
  advance: (arg: number | AdvanceOptions) => Promise<ClockAdvanceResult>;
}

const ClockContext = createContext<ClockContextValue | null>(null);

export const ClockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { concreteStoreId: storeId } = useStore();
  const allowedView = can(user?.role, 'clock:view');
  const canAdvance = can(user?.role, 'clock:advance');

  // Server state only; everything else (loading / forbidden / no_store) is derived at render.
  const [loaded, setLoaded] = useState<{ storeId: string | null; clock: SimClock | null; failure: ClockReason | null }>({
    storeId: null,
    clock: null,
    failure: null,
  });
  const [advancing, setAdvancing] = useState(false);
  const [advanceStartedAt, setAdvanceStartedAt] = useState<number | null>(null);
  const [lastTiming, setLastTiming] = useState<AdvanceTiming | null>(null);
  const [version, setVersion] = useState(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!allowedView || !storeId) return;
    const controller = new AbortController();
    getJson<SimClock>('/clock', { params: { store_id: storeId }, signal: controller.signal, notifyForbidden: false }).then(
      (clock) => setLoaded({ storeId, clock, failure: null }),
      (err: unknown) => {
        const e = toApiError(err);
        if (e.kind === 'cancelled') return;
        setLoaded({ storeId, clock: null, failure: e.kind === 'forbidden' ? 'forbidden' : e.kind === 'not_found' ? 'missing' : 'error' });
      },
    );
    return () => controller.abort();
  }, [allowedView, storeId, nonce]);

  let status: ClockStatus;
  let reason: ClockReason | null = null;
  let clock: SimClock | null = null;
  if (!allowedView) {
    status = 'unavailable';
    reason = 'forbidden';
  } else if (!storeId) {
    status = 'unavailable';
    reason = 'no_store';
  } else if (loaded.storeId !== storeId) {
    status = 'loading';
  } else if (loaded.failure) {
    status = 'unavailable';
    reason = loaded.failure;
  } else {
    status = 'ready';
    clock = loaded.clock;
  }

  const refresh = useCallback(() => {
    setLoaded((l) => ({ ...l, storeId: null })); // back to "loading" until the new answer arrives
    setNonce((n) => n + 1);
  }, []);

  const advance = useCallback(
    async (arg: number | AdvanceOptions) => {
      if (!storeId) throw new Error('No store selected');
      const opts: AdvanceOptions = typeof arg === 'number' ? { days: arg } : arg;
      const days = opts.days ?? 7;
      setAdvancing(true);
      const started = Date.now();
      setAdvanceStartedAt(started);
      try {
        const body = {
          store_id: storeId,
          ...opts,
        };
        const res = await apiClient.post<ClockAdvanceResult | { run_id: string; poll_url: string; status: string }>(
          '/clock/advance',
          body,
          { timeout: 600000 }, // the batch chain can take minutes
        );

        // Handle async_job (HTTP 202)
        if (opts.async_job && res.data && 'run_id' in res.data && !('current_date' in res.data)) {
          const runId = (res.data as { run_id: string }).run_id;
          let completed = false;
          let latestDetail: any = null;
          while (!completed) {
            await new Promise((r) => setTimeout(r, 2000));
            const statusRes = await apiClient.get<any>(`/batch-runs/${encodeURIComponent(runId)}`);
            latestDetail = statusRes.data;
            if (latestDetail?.status === 'success') {
              completed = true;
            } else if (latestDetail?.status === 'failed') {
              throw new Error(latestDetail?.error || 'Batch advance job failed');
            }
          }
          const elapsed = (Date.now() - started) / 1000;
          setLastTiming({ days, seconds: elapsed });
          setVersion((v) => v + 1);
          refresh();
          return {
            success: true,
            store_id: storeId,
            previous_date: '',
            current_date: latestDetail?.sim_date || '',
            days_advanced: days,
            reviews_executed: 1,
            stockouts_recorded: 0,
            recommendations_generated: 0,
            job_events: [],
            message: 'Async batch advance completed successfully',
            duration_seconds: elapsed,
            approval_mode: opts.approval_mode || 'auto',
            run_id: runId,
          } as ClockAdvanceResult;
        }

        const syncResult = res.data as ClockAdvanceResult;
        const server = syncResult?.duration_seconds;
        setLastTiming({ days, seconds: typeof server === 'number' && Number.isFinite(server) ? server : (Date.now() - started) / 1000 });
        setVersion((v) => v + 1);
        refresh();
        return syncResult;
      } finally {
        setAdvancing(false);
        setAdvanceStartedAt(null);
      }
    },
    [storeId, refresh],
  );

  const value = useMemo(
    () => ({ clock, status, reason, canAdvance, advancing, advanceStartedAt, lastTiming, version, refresh, advance }),
    [clock, status, reason, canAdvance, advancing, advanceStartedAt, lastTiming, version, refresh, advance],
  );
  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
};

export function useClock(): ClockContextValue {
  const ctx = useContext(ClockContext);
  if (!ctx) throw new Error('useClock must be used inside <ClockProvider>');
  return ctx;
}
