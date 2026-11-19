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
import { getBatchRunDetail, type BatchRunDetail } from '../services/batchRunsApi.ts';

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
  /** Policy constants served with the clock (L and R, in days). */
  lead_time_days?: number | null;
  review_period_days?: number | null;
  next_review_date?: string | null;
  n_skus?: number | null;
  /** Date of M5 d_1 on this database's calendar (a replay DB shifted as a whole); absent = 2011-01-29. */
  m5_day0?: string | null;
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
  orders_received?: number;
  run_id?: string | null;
}

/** Poll cadence and give-up time of a background advance (async_job). */
const ASYNC_POLL_INTERVAL_MS = 2000;
const ASYNC_POLL_TIMEOUT_MS = 30 * 60 * 1000;

/** A background advance that ended badly: the job failed on the server, or it did not finish in time. */
export class AsyncAdvanceError extends Error {
  readonly kind: 'failed' | 'timeout';
  readonly runId: string;
  readonly serverError: string | null;
  constructor(kind: 'failed' | 'timeout', runId: string, serverError: string | null) {
    super(serverError ?? `background advance ${kind} (run ${runId})`);
    this.name = 'AsyncAdvanceError';
    this.kind = kind;
    this.runId = runId;
    this.serverError = serverError;
  }
}

function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Options of POST /clock/advance. `async_job` returns at once and is polled through /batch-runs; it applies to Auto
 * advances only (with approval_mode "planner" the call stays synchronous, see `advance`).
 */
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
        // Planner mode always runs synchronously: only a synchronous call reports the 409 and the stop at a review
        const body = {
          store_id: storeId,
          ...opts,
          async_job: opts.async_job === true && opts.approval_mode !== 'planner',
        };
        const res = await apiClient.post<ClockAdvanceResult | { run_id: string; poll_url: string; status: string }>(
          '/clock/advance',
          body,
          { timeout: 600000 }, // the batch chain can take minutes
        );

        // async_job: HTTP 202 + run_id; poll GET /batch-runs/{run_id} until the ADVANCE row is final
        if (res.status === 202) {
          const runId = (res.data as { run_id: string }).run_id;
          const deadline = Date.now() + ASYNC_POLL_TIMEOUT_MS;
          let run: BatchRunDetail;
          for (;;) {
            await new Promise((r) => setTimeout(r, ASYNC_POLL_INTERVAL_MS));
            run = await getBatchRunDetail(runId);
            if (run.status === 'success') break;
            if (run.status === 'failed') throw new AsyncAdvanceError('failed', runId, run.error ?? null);
            if (Date.now() > deadline) throw new AsyncAdvanceError('timeout', runId, null);
          }
          // The real numbers of this run: the ADVANCE row details + its J1 row, and the clock re-read from the server
          const after = await getJson<SimClock>('/clock', { params: { store_id: storeId }, notifyForbidden: false });
          const d = (run.details ?? {}) as Record<string, unknown>;
          const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
          const j1 = run.jobs.find((j) => j.job === 'J1');
          const stockouts = num((j1?.details as Record<string, unknown> | null | undefined)?.stockouts);
          const daysSimulated = num(d.days_simulated);
          const previous = shiftIsoDate(after.current_date, -daysSimulated);
          const seconds = typeof run.duration_ms === 'number' ? run.duration_ms / 1000 : (Date.now() - started) / 1000;
          setLastTiming({ days: daysSimulated || days, seconds });
          setVersion((v) => v + 1);
          refresh();
          return {
            success: true,
            store_id: storeId,
            previous_date: previous,
            current_date: after.current_date,
            days_advanced: daysSimulated,
            reviews_executed: num(d.reviews_executed),
            day0_review_executed: previous === after.start_date,
            stockouts_recorded: stockouts,
            recommendations_generated: num(d.orders),
            orders_received: num(d.orders_received),
            job_events: [],
            message: '',
            duration_seconds: seconds,
            approval_mode: typeof d.approval_mode === 'string' ? d.approval_mode : opts.approval_mode ?? 'auto',
            run_id: runId,
          };
        }

        const syncResult = res.data as ClockAdvanceResult;
        const server = syncResult?.duration_seconds;
        setLastTiming({
          days: typeof syncResult?.days_advanced === 'number' && syncResult.days_advanced > 0 ? syncResult.days_advanced : days,
          seconds: typeof server === 'number' && Number.isFinite(server) ? server : (Date.now() - started) / 1000,
        });
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
