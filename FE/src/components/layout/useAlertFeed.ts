/**
 * Stock-alert summary for the topbar bell (U-01, N-14, F-17).
 * Two small, store-scoped, server-side requests per refresh:
 *   GET /dashboard/alerts?severity=CRITICAL&limit=5   -> top rows + summary.critical_count
 *   GET /replenishments?status=PENDING&limit=1        -> `total` = number of pending orders (manager+ only)
 * Refreshes on store / sim-clock change, `dfios:alerts-updated`, the single SSE stream (debounced leading +
 * trailing) and when the tab becomes visible again after 15 s. Never downloads full lists.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useStore } from '../../context/StoreContext.tsx';
import { useClock } from '../../context/ClockContext.tsx';
import { can } from '../../auth/permissions.ts';
import { useSSE } from '../../hooks/useSSE.ts';
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback.ts';
import { getAlerts, type AlertItem } from '../../services/dashboardApi.ts';
import { listReplenishments } from '../../services/replenishmentApi.ts';
import { ALERTS_SYNC_EVENT } from '../../utils/alertTracker.ts';
import { NOTIF_PREFS_EVENT, readNotifPrefs, type NotifPrefs } from '../../utils/notifyPrefs.ts';

export const BELL_ROWS = 5;

export interface AlertFeed {
  /** Total CRITICAL alerts in the selected store (server count). */
  total: number;
  rows: AlertItem[];
  /** Pending replenishment orders in the selected store (null: unknown or not allowed). */
  pending: number | null;
  loading: boolean;
  failed: boolean;
  /** Stock alerts switched off in Settings > Preferences (nothing fetched, badge hidden). */
  muted: boolean;
}

export function useAlertFeed(): AlertFeed {
  const { isAuthenticated, user } = useAuth();
  const { concreteStoreId: storeId } = useStore();
  const { version } = useClock();
  const [prefs, setPrefs] = useState<NotifPrefs>(readNotifPrefs);
  const wantStock = prefs.stock;
  const canSeeReplenishment = can(user?.role, 'view:replenishment') && prefs.replenishment;
  const [feed, setFeed] = useState<AlertFeed>({ total: 0, rows: [], pending: null, loading: false, failed: false, muted: !prefs.stock });
  const controller = useRef<AbortController | null>(null);
  const lastSync = useRef(0);

  // Settings > Preferences writes the switches; apply them at once (same tab) or on the next storage event.
  useEffect(() => {
    const onPrefs = () => setPrefs(readNotifPrefs());
    window.addEventListener(NOTIF_PREFS_EVENT, onPrefs);
    window.addEventListener('storage', onPrefs);
    return () => {
      window.removeEventListener(NOTIF_PREFS_EVENT, onPrefs);
      window.removeEventListener('storage', onPrefs);
    };
  }, []);

  const sync = useCallback(() => {
    if (!storeId) return;
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    setFeed((f) => ({ ...f, loading: true }));
    const alerts: Promise<{ items?: AlertItem[]; total?: number; summary?: { critical_count?: number } } | null> = wantStock
      ? getAlerts(storeId, 'CRITICAL', BELL_ROWS, ctl.signal)
      : Promise.resolve(null);
    const pending = canSeeReplenishment
      ? listReplenishments({ skip: 0, limit: 1, store_id: storeId, status: 'PENDING' }, ctl.signal).then(
          (r) => r.total,
          () => null,
        )
      : Promise.resolve(null);
    Promise.all([alerts, pending]).then(
      ([a, p]) => {
        if (ctl.signal.aborted) return;
        lastSync.current = Date.now();
        const items = a && Array.isArray(a.items) ? a.items : [];
        setFeed({
          total: a ? Number(a.summary?.critical_count ?? a.total ?? items.length) : 0,
          rows: items.slice(0, BELL_ROWS),
          pending: p,
          loading: false,
          failed: false,
          muted: !a,
        });
      },
      () => {
        if (ctl.signal.aborted) return;
        setFeed((f) => ({ ...f, loading: false, failed: true }));
      },
    );
  }, [storeId, canSeeReplenishment, wantStock]);

  // Initial load, store change, clock advance (version).
  useEffect(() => {
    if (!isAuthenticated) return;
    sync();
    return () => controller.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, sync, version]);

  const debouncedSync = useDebouncedCallback(sync, 1000);

  useEffect(() => {
    if (!isAuthenticated) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSync.current > 15000) debouncedSync();
    };
    window.addEventListener(ALERTS_SYNC_EVENT, debouncedSync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(ALERTS_SYNC_EVENT, debouncedSync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, debouncedSync]);

  // One SSE connection for the whole shell.
  useSSE('/events', { enabled: isAuthenticated, onEvent: () => debouncedSync() });

  return feed;
}
