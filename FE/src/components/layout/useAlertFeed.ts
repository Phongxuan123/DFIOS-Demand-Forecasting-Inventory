/**
 * Active critical stock alerts for the topbar bell.
 * Reuses utils/alertTracker (per-account persisted history + reconciliation) and refreshes on
 *  - `dfios:alerts-updated` (pages call emitAlertsSyncEvent after approving / adjusting),
 *  - the single backend SSE stream (/events), debounced leading + trailing (P-42),
 *  - the tab becoming visible again after 15 s.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearApiCache } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { can } from '../../auth/permissions.ts';
import { useSSE } from '../../hooks/useSSE.ts';
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback.ts';
import {
  ALERTS_SYNC_EVENT,
  applyOptimisticAlertSync,
  fetchCriticalDashboardAlerts,
  fetchRecommendationsForAlerts,
  getAlertStorageKey,
  loadTrackedAlerts,
  reconcileTrackedAlerts,
  saveTrackedAlerts,
  type AlertsSyncDetail,
  type TrackedAlertItem,
} from '../../utils/alertTracker.ts';

export function useAlertFeed() {
  const { user, isAuthenticated } = useAuth();
  const storageKey = getAlertStorageKey(user);
  const canSeeReplenishment = can(user?.role, 'view:replenishment');
  const [state, setState] = useState<{ key: string; items: TrackedAlertItem[] }>(() => ({ key: storageKey, items: loadTrackedAlerts(storageKey) }));
  // Account switch: fall back to that account's stored history until the first sync lands.
  const items = useMemo(() => (state.key === storageKey ? state.items : loadTrackedAlerts(storageKey)), [state, storageKey]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const busy = useRef(false);
  const again = useRef(false);
  const lastSync = useRef(0);

  const sync = useCallback(
    async (fresh: boolean) => {
      if (busy.current) {
        again.current = true;
        return;
      }
      busy.current = true;
      setLoading(true);
      try {
        if (fresh) {
          clearApiCache('/dashboard/alerts');
          if (canSeeReplenishment) clearApiCache('/replenishments');
        }
        const [crit, rec] = await Promise.all([
          fetchCriticalDashboardAlerts(),
          canSeeReplenishment ? fetchRecommendationsForAlerts() : Promise.resolve(null),
        ]);
        if (!crit.fetchSuccess) {
          setFailed(true);
          return;
        }
        const next = reconcileTrackedAlerts({
          previousTracked: itemsRef.current,
          criticalAlerts: crit.items,
          totalCriticalInDb: crit.totalCriticalInDb,
          recommendations: rec,
        });
        itemsRef.current = next;
        setState({ key: storageKey, items: next });
        setFailed(false);
        saveTrackedAlerts(storageKey, next);
        lastSync.current = Date.now();
      } finally {
        busy.current = false;
        setLoading(false);
        if (again.current) {
          again.current = false;
          void sync(true);
        }
      }
    },
    [storageKey, canSeeReplenishment],
  );

  // Initial load / account switch.
  useEffect(() => {
    if (!isAuthenticated) return;
    void sync(false);
  }, [isAuthenticated, storageKey, sync]);

  // Same-tab actions + tab focus.
  useEffect(() => {
    if (!isAuthenticated) return;
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<AlertsSyncDetail | undefined>).detail;
      if (detail) {
        const optimistic = applyOptimisticAlertSync(itemsRef.current, detail);
        itemsRef.current = optimistic;
        setState({ key: storageKey, items: optimistic });
        saveTrackedAlerts(storageKey, optimistic);
      }
      void sync(true);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSync.current > 15000) void sync(true);
    };
    window.addEventListener(ALERTS_SYNC_EVENT, onSync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(ALERTS_SYNC_EVENT, onSync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, storageKey, sync]);

  // One SSE connection for the whole shell.
  const onServerEvent = useDebouncedCallback(() => void sync(true), 500);
  useSSE('/events', { enabled: isAuthenticated, onEvent: onServerEvent });

  const active = useMemo(() => items.filter((i) => i.alertState === 'unread'), [items]);
  return { active, loading, failed };
}
