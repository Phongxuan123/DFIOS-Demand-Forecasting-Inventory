import { api, clearApiCache } from '../services/api.ts';

export const ALERTS_SYNC_EVENT = 'dfios:alerts-updated';
const STORAGE_PREFIX = 'dfios_alerts_tracker_v1';
const MAX_READ_HISTORY = 100;

export type AlertLifecycleState = 'unread' | 'read';
export type AlertResolvedReason = 'po_approved' | 'stock_restored';

export interface TrackedAlertItem {
  key: string;
  item_id: string;
  store_id: string;
  product_name: string;
  category?: string;
  on_hand: number;
  on_order: number;
  safety_stock: number;
  reorder_point: number;
  severity: 'CRITICAL' | 'WARNING' | 'HEALTHY';
  alertState: AlertLifecycleState;
  resolvedReason?: AlertResolvedReason;
  firstSeenAt: number;
  updatedAt: number;
  resolvedAt?: number;
}

export interface AlertsSyncDetail {
  action?:
    | 'po_approved'
    | 'po_bulk_approved'
    | 'po_cancelled'
    | 'po_rejected'
    | 'po_generated'
    | 'params_recomputed'
    | 'inventory_updated';
  itemId?: string;
  storeId?: string;
  items?: Array<{ itemId: string; storeId?: string }>;
}

export const makeAlertKey = (itemId?: string, storeId?: string): string => {
  const safeItem = (itemId || '').trim();
  const safeStore = (storeId || 'CA_1').trim() || 'CA_1';
  return `${safeItem}__${safeStore}`;
};

export const getAlertStorageKey = (user?: { id?: string; email?: string } | null): string => {
  const identity = (user?.email || user?.id || 'guest').trim().toLowerCase() || 'guest';
  return `${STORAGE_PREFIX}:${identity}`;
};

/**
 * Safely reads the per-account notification history from localStorage.
 */
export const loadTrackedAlerts = (storageKey: string): TrackedAlertItem[] => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Persists per-account alerts cleanly, capping resolved history so storage remains bounded.
 */
export const saveTrackedAlerts = (storageKey: string, items: TrackedAlertItem[]): void => {
  try {
    const unread = items.filter((item) => item.alertState === 'unread');
    const read = items
      .filter((item) => item.alertState === 'read')
      .sort((a, b) => (b.resolvedAt ?? b.updatedAt) - (a.resolvedAt ?? a.updatedAt))
      .slice(0, MAX_READ_HISTORY);

    localStorage.setItem(storageKey, JSON.stringify([...unread, ...read]));
  } catch {
    // Ignore quota/private-browsing storage errors cleanly
  }
};

/**
 * Clears alert/replenishment caches and notifies Topbar to re-sync live alert state.
 */
export const emitAlertsSyncEvent = (detail?: AlertsSyncDetail): void => {
  clearApiCache('/dashboard/alerts');
  clearApiCache('/replenishments');
  clearApiCache('/inventory');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<AlertsSyncDetail>(ALERTS_SYNC_EVENT, { detail }));
  }
};

interface RecStatusSummary {
  hasPending: boolean;
  isApprovedPo: boolean;
}

const buildRecommendationStatusMap = (
  pendingRecs: any[],
  approvedRecs: any[]
): Map<string, RecStatusSummary> => {
  const pendingKeys = new Set<string>();
  for (const rec of pendingRecs) {
    if (!rec?.item_id) continue;
    pendingKeys.add(makeAlertKey(rec.item_id, rec.store_id || 'CA_1'));
  }

  const approvedKeys = new Set<string>();
  for (const rec of approvedRecs) {
    if (!rec?.item_id) continue;
    approvedKeys.add(makeAlertKey(rec.item_id, rec.store_id || 'CA_1'));
  }

  const summary = new Map<string, RecStatusSummary>();
  const allKeys = new Set<string>([...pendingKeys, ...approvedKeys]);
  for (const key of allKeys) {
    const hasPending = pendingKeys.has(key);
    summary.set(key, {
      hasPending,
      isApprovedPo: !hasPending && approvedKeys.has(key),
    });
  }
  return summary;
};

const fetchPagedRecommendationsByStatus = async (status: string): Promise<any[]> => {
  const first = await api.replenishment.listRecommendations({
    status,
    skip: 0,
    limit: 200,
    auto_generate: false,
  });
  const items: any[] = [...(first?.items || [])];
  const total = Number(first?.total || items.length);

  if (total > 200) {
    const offsets: number[] = [];
    for (let skip = 200; skip < total; skip += 200) {
      offsets.push(skip);
    }
    for (let i = 0; i < offsets.length; i += 4) {
      const chunk = offsets.slice(i, i + 4);
      const batches = await Promise.all(
        chunk.map((skip) =>
          api.replenishment
            .listRecommendations({ status, skip, limit: 200, auto_generate: false })
            .catch(() => ({ items: [] }))
        )
      );
      for (const b of batches) {
        if (Array.isArray(b?.items)) {
          items.push(...b.items);
        }
      }
    }
  }
  return items;
};

/**
 * Fetches all active CRITICAL dashboard stock alerts across all pages.
 * Returns fetchSuccess=false if /dashboard/alerts fails so active alerts are not falsely resolved.
 */
export const fetchCriticalDashboardAlerts = async (): Promise<{
  items: any[];
  totalCriticalInDb: number;
  fetchSuccess: boolean;
}> => {
  try {
    const first = await api.dashboard.getAlerts({ severity: 'CRITICAL', limit: 500, offset: 0 });
    const items: any[] = [...(first?.items || [])];
    const totalCriticalInDb = Number(first?.summary?.critical_count ?? first?.total ?? items.length);

    if (totalCriticalInDb > 500) {
      const offsets: number[] = [];
      for (let offset = 500; offset < totalCriticalInDb; offset += 500) {
        offsets.push(offset);
      }
      for (let i = 0; i < offsets.length; i += 4) {
        const chunk = offsets.slice(i, i + 4);
        const rest = await Promise.all(
          chunk.map((offset) =>
            api.dashboard
              .getAlerts({ severity: 'CRITICAL', limit: 500, offset })
              .catch(() => ({ items: [] }))
          )
        );
        for (const page of rest) {
          if (Array.isArray(page?.items)) {
            items.push(...page.items);
          }
        }
      }
    }

    return { items, totalCriticalInDb, fetchSuccess: true };
  } catch {
    return { items: [], totalCriticalInDb: 0, fetchSuccess: false };
  }
};

/**
 * Applies an instant optimistic transition for one or more SKU/store pairs before backend sync finishes.
 */
export const applyOptimisticAlertSync = (
  current: TrackedAlertItem[],
  detail?: AlertsSyncDetail,
  now: number = Date.now()
): TrackedAlertItem[] => {
  if (!detail) return current;

  const targetKeys = new Set<string>();
  if (detail.itemId) {
    targetKeys.add(makeAlertKey(detail.itemId, detail.storeId || 'CA_1'));
  }
  if (Array.isArray(detail.items)) {
    for (const entry of detail.items) {
      if (entry.itemId) {
        targetKeys.add(makeAlertKey(entry.itemId, entry.storeId || detail.storeId || 'CA_1'));
      }
    }
  }
  if (targetKeys.size === 0) return current;

  if (detail.action === 'po_approved' || detail.action === 'po_bulk_approved') {
    return current.map((item) =>
      targetKeys.has(item.key)
        ? {
            ...item,
            alertState: 'read',
            resolvedReason: 'po_approved',
            resolvedAt: item.resolvedAt || now,
            updatedAt: now,
          }
        : item
    );
  }

  if (detail.action === 'po_cancelled') {
    return current.map((item) =>
      targetKeys.has(item.key)
        ? {
            ...item,
            alertState: 'unread',
            resolvedReason: undefined,
            resolvedAt: undefined,
            updatedAt: now,
          }
        : item
    );
  }

  return current;
};

/**
 * Pre-warms store replenishment or inventory cache in the background so deep-link
 * jumps from the notification bell resolve near-instantly on click.
 */
export const prefetchReplenishmentTarget = (
  storeId: string | undefined,
  canViewReplenishments: boolean
): void => {
  const safeStore = storeId && storeId !== 'All' ? storeId : 'CA_1';
  if (canViewReplenishments) {
    void api.replenishment
      .listRecommendations({
        store_id: safeStore,
        skip: 0,
        limit: 200,
        auto_generate: false,
      })
      .catch(() => {});
  } else {
    void api.inventory
      .getInventory({
        limit: 500,
        store_id: safeStore,
      })
      .catch(() => {});
  }
};

/**
 * Fetches PENDING and APPROVED replenishment recommendation statuses across stores.
 * Fetching APPROVED separately prevents large PENDING tables from truncating approved resolutions.
 * Gracefully returns null for roles without access (e.g. VIEWER 403).
 */
export const fetchRecommendationsForAlerts = async (): Promise<{
  pending: any[];
  approved: any[];
} | null> => {
  try {
    const [approved, pending] = await Promise.all([
      fetchPagedRecommendationsByStatus('APPROVED'),
      fetchPagedRecommendationsByStatus('PENDING'),
    ]);
    return { pending, approved };
  } catch {
    return null;
  }
};

export interface ReconcileInput {
  previousTracked: TrackedAlertItem[];
  criticalAlerts: any[];
  totalCriticalInDb: number;
  recommendations: { pending: any[]; approved: any[] } | null;
  now?: number;
}

/**
 * Reconciles live backend critical alerts + replenishment approvals with persisted per-account history.
 * - Active alerts (not resolved by stock recovery or PO approval) remain 'unread'.
 * - Alerts that exited warning state stay in the feed as 'read' instead of disappearing.
 * - Previously resolved items that fall back into critical state automatically return to 'unread'.
 */
export const reconcileTrackedAlerts = ({
  previousTracked,
  criticalAlerts,
  totalCriticalInDb,
  recommendations,
  now = Date.now(),
}: ReconcileInput): TrackedAlertItem[] => {
  const prevMap = new Map<string, TrackedAlertItem>();
  for (const item of previousTracked) {
    prevMap.set(item.key, item);
  }

  const recMap = recommendations
    ? buildRecommendationStatusMap(recommendations.pending, recommendations.approved)
    : null;
  const freshCriticalKeys = new Set<string>();
  const result: TrackedAlertItem[] = [];

  for (const raw of criticalAlerts) {
    const itemId = raw?.item_id || raw?.id;
    const storeId = raw?.store_id || raw?.store || 'CA_1';
    if (!itemId) continue;

    const key = makeAlertKey(itemId, storeId);
    freshCriticalKeys.add(key);

    const prev = prevMap.get(key);
    const recSummary = recMap?.get(key);
    const isApprovedPo = Boolean(recSummary?.isApprovedPo);

    const onHand = Number(raw?.on_hand ?? raw?.stock ?? 0);
    const onOrder = Number(raw?.on_order ?? 0);
    const safetyStock = Number(raw?.safety_stock ?? 0);
    const reorderPoint = Number(raw?.reorder_point ?? raw?.rop ?? 0);

    if (isApprovedPo) {
      // Only include PO-approved items in the feed if they were previously tracked as alerts
      if (prev) {
        result.push({
          key,
          item_id: itemId,
          store_id: storeId,
          product_name: raw?.product_name || raw?.name || prev.product_name || itemId,
          category: raw?.category || prev.category,
          on_hand: onHand,
          on_order: onOrder,
          safety_stock: safetyStock,
          reorder_point: reorderPoint,
          severity: 'CRITICAL',
          alertState: 'read',
          resolvedReason: 'po_approved',
          firstSeenAt: prev.firstSeenAt,
          updatedAt: now,
          resolvedAt: prev.alertState === 'read' && prev.resolvedAt ? prev.resolvedAt : now,
        });
      }
      continue;
    }

    result.push({
      key,
      item_id: itemId,
      store_id: storeId,
      product_name: raw?.product_name || raw?.name || prev?.product_name || itemId,
      category: raw?.category || prev?.category,
      on_hand: onHand,
      on_order: onOrder,
      safety_stock: safetyStock,
      reorder_point: reorderPoint,
      severity: 'CRITICAL',
      alertState: 'unread',
      resolvedReason: undefined,
      firstSeenAt: prev?.firstSeenAt || now,
      updatedAt: now,
      resolvedAt: undefined,
    });
  }

  // Keep previously tracked items that are no longer CRITICAL in BE as resolved ('read')
  const isCompleteCriticalFetch = criticalAlerts.length >= totalCriticalInDb;
  for (const prev of previousTracked) {
    if (freshCriticalKeys.has(prev.key)) continue;

    const recSummary = recMap?.get(prev.key);
    const reason: AlertResolvedReason = recSummary?.isApprovedPo ? 'po_approved' : 'stock_restored';

    if (prev.alertState === 'read' || isCompleteCriticalFetch || recSummary?.isApprovedPo) {
      result.push({
        ...prev,
        severity: prev.alertState === 'read' ? prev.severity : 'HEALTHY',
        alertState: 'read',
        resolvedReason: prev.alertState === 'read' ? (prev.resolvedReason || reason) : reason,
        updatedAt: prev.alertState === 'read' ? prev.updatedAt : now,
        resolvedAt: prev.resolvedAt || now,
      });
    } else {
      result.push(prev);
    }
  }

  // Sort: Unread first (critical lowest stock first), then Read (most recently resolved first)
  const unreadItems = result
    .filter((item) => item.alertState === 'unread')
    .sort((a, b) => a.on_hand - b.on_hand || b.firstSeenAt - a.firstSeenAt);

  const readItems = result
    .filter((item) => item.alertState === 'read')
    .sort((a, b) => (b.resolvedAt ?? b.updatedAt) - (a.resolvedAt ?? a.updatedAt))
    .slice(0, MAX_READ_HISTORY);

  return [...unreadItems, ...readItems];
};
