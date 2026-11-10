import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import {
  Pencil,
  RefreshCw,
  X,
  CheckCircle2,
  Download,
  Check,
  Ban,
  AlertTriangle,
  PackageCheck,
  Layers,
  History as HistoryIcon,
  Search,
  Calculator,
  Store as StoreIcon,
  ShieldCheck,
  CheckSquare,
  Square,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { api } from '../services/api.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import { emitAlertsSyncEvent } from '../utils/alertTracker.ts';
import './Replenishment.css';

const formatQty = (val: number | string | null | undefined, locale: string = 'en-US'): string => {
  if (val == null || isNaN(Number(val))) return '0';
  return Math.round(Number(val)).toLocaleString(locale);
};

const formatDecimal = (val: number | string | null | undefined, digits: number = 1, locale: string = 'en-US'): string => {
  if (val == null || isNaN(Number(val))) return '0';
  return Number(val).toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
};

const PRIORITY_LABELS_EN: Record<string, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

const PRIORITY_LABELS_VI: Record<string, string> = {
  CRITICAL: 'Khẩn cấp',
  HIGH: 'Cao',
  MEDIUM: 'Vừa',
  LOW: 'Thấp',
};

const STATUS_LABELS_EN: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

const STATUS_LABELS_VI: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
};

const computeRssMetrics = (row: any) => {
  const onHand = Math.round(Number(row.on_hand ?? 0));
  const onOrder = Math.round(Number(row.on_order ?? 0));
  const ip = onHand + onOrder;
  const rop = Number(row.rop ?? row.reorder_point ?? 0);
  const s = Math.round(rop * 10) / 10;
  const rawRecQty = Math.round(Number(row.recommended_qty ?? 0));
  const rawEoq = Math.round(Number(row.eoq ?? (rawRecQty > 0 ? rawRecQty : Math.max(12, rop * 0.75))));
  const eoq = Math.max(1, rawEoq);
  const ss =
    row.safety_stock != null && !isNaN(Number(row.safety_stock))
      ? Math.round(Number(row.safety_stock) * 10) / 10
      : Math.round(Math.max(2, rop * 0.32) * 10) / 10;

  const bigS = Math.ceil(rop + Math.max(eoq, rawRecQty));
  const isTriggered = ip <= rop;
  const computedOrderQty = isTriggered ? Math.max(0, bigS - ip) : 0;
  const recommendedQty = rawRecQty > 0 ? rawRecQty : computedOrderQty;
  const finalQty = Math.round(Number(row.final_qty ?? recommendedQty));

  return {
    onHand,
    onOrder,
    ip,
    s,
    bigS,
    eoq,
    ss,
    isTriggered,
    recommendedQty,
    finalQty,
  };
};

export const Replenishment: React.FC = () => {
  const { user } = useAuth();
  const { language } = useLanguage();
  const canEdit = user?.role?.toUpperCase() !== 'VIEWER';

  const isVi = language === 'vi';
  const localeStr = isVi ? 'vi-VN' : 'en-US';
  const priorityLabels = isVi ? PRIORITY_LABELS_VI : PRIORITY_LABELS_EN;
  const statusLabels = isVi ? STATUS_LABELS_VI : STATUS_LABELS_EN;

  const [searchParams, setSearchParams] = useSearchParams();
  const focusSkuParam = searchParams.get('sku');
  const focusStoreParam = searchParams.get('store');
  const focusTokenParam = searchParams.get('focus');

  const [storeOptions, setStoreOptions] = useState<string[]>(['CA_1', 'CA_2', 'TX_1', 'WI_1']);
  const [selectedStore, setSelectedStore] = useState<string>(() =>
    focusStoreParam && focusStoreParam !== 'All' ? focusStoreParam : 'CA_1'
  );
  const [viewTab, setViewTab] = useState<'RECOMMENDATIONS' | 'INVENTORY' | 'HISTORY'>('RECOMMENDATIONS');

  const [pendingScrollTarget, setPendingScrollTarget] = useState<{
    sku: string;
    recId?: string;
    tab: 'RECOMMENDATIONS' | 'INVENTORY';
    token: string;
  } | null>(null);
  const [flashingRowKey, setFlashingRowKey] = useState<string | null>(null);

  const recRequestIdRef = useRef(0);
  const invRequestIdRef = useRef(0);
  const locateTokenRef = useRef<string | null>(null);
  const skipNextAutoLoadRef = useRef(false);
  const lastLoadedStoreRef = useRef<string>(selectedStore);
  const flashTimeoutRef = useRef<number | null>(null);

  // Recommendations State
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [recTotal, setRecTotal] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);
  const [recPage, setRecPage] = useState(1);
  const [recPageSize, setRecPageSize] = useState(10);
  const [recStatusFilter, setRecStatusFilter] = useState<string>('ALL');
  const [recPriorityFilter, setRecPriorityFilter] = useState<string>('ALL');
  const [recSearch, setRecSearch] = useState<string>('');

  // Inventory Levels State
  const [inventory, setInventory] = useState<any[]>([]);
  const [totalMonitoredSkus, setTotalMonitoredSkus] = useState<number>(0);
  const [invPage, setInvPage] = useState(1);
  const [invPageSize, setInvPageSize] = useState(10);

  // History State
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('ALL');

  // Bulk Selection State
  const [selectedRecIds, setSelectedRecIds] = useState<string[]>([]);
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  // UI state
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modals
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [targetRec, setTargetRec] = useState<any>(null);
  const [adjustQtyInput, setAdjustQtyInput] = useState<number>(0);
  const [actionReasonInput, setActionReasonInput] = useState<string>('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 4000);
  };

  const monitoredSkusCount = useMemo(() => {
    return Math.max(totalMonitoredSkus, recTotal, recommendations.length, inventory.length);
  }, [totalMonitoredSkus, recTotal, recommendations.length, inventory.length]);

  const pendingItemsOnPage = useMemo(() => {
    return recommendations.filter((r) => r.status === 'PENDING' && r.id);
  }, [recommendations]);

  const allPendingSelectedOnPage = useMemo(() => {
    if (pendingItemsOnPage.length === 0) return false;
    return pendingItemsOnPage.every((r) => selectedRecIds.includes(r.id));
  }, [pendingItemsOnPage, selectedRecIds]);

  const fetchInventoryWithParams = useCallback(async (store: string) => {
    const [firstInv, firstParams] = await Promise.all([
      api.inventory.getInventory({ limit: 500, store_id: store }).catch(() => ({ list: [], total: 0 })),
      api.optimization
        .getParameters({ limit: 200, skip: 0, store_id: store })
        .catch(() => ({ items: [], total: 0 })),
    ]);

    const invList: any[] = [...(firstInv.list || [])];
    const invTotal = Number(firstInv.total || invList.length);
    const paramItems: any[] = [...(firstParams.items || [])];
    const paramTotal = Number(firstParams.total || paramItems.length);

    // Fetch all remaining inventory and parameter pages in parallel without re-fetching offset 0
    const invOffsets: number[] = [];
    for (let skip = invList.length; skip < invTotal; skip += 500) {
      invOffsets.push(skip);
    }

    const paramOffsets: number[] = [];
    const paramCap = Math.min(paramTotal, 1400);
    for (let skip = 200; skip < paramCap; skip += 200) {
      paramOffsets.push(skip);
    }

    if (invOffsets.length > 0 || paramOffsets.length > 0) {
      const [extraInvPages, extraParamPages] = await Promise.all([
        Promise.all(
          invOffsets.map((skip) =>
            api.inventory
              .getInventory({ skip, limit: 500, store_id: store })
              .catch(() => ({ list: [] }))
          )
        ),
        Promise.all(
          paramOffsets.map((skip) =>
            api.optimization
              .getParameters({ limit: 200, skip, store_id: store })
              .catch(() => ({ items: [] }))
          )
        ),
      ]);

      extraInvPages.forEach((p) => {
        if (Array.isArray(p?.list)) invList.push(...p.list);
      });
      extraParamPages.forEach((p) => {
        if (Array.isArray(p?.items)) paramItems.push(...p.items);
      });
    }

    const paramMap = new Map();
    paramItems.forEach((p: any) => {
      paramMap.set(p.item_id, p);
    });

    const mapped = invList.map((item: any) => {
      const opt = paramMap.get(item.item_id) || {};
      return {
        ...item,
        safety_stock:
          opt.safety_stock != null
            ? Math.round(opt.safety_stock)
            : item.safety_stock != null
            ? Math.round(item.safety_stock)
            : null,
        reorder_point:
          opt.reorder_point != null
            ? Math.round(opt.reorder_point)
            : item.reorder_point != null
            ? Math.round(item.reorder_point)
            : null,
        eoq: opt.eoq != null ? Math.round(opt.eoq) : item.eoq != null ? Math.round(item.eoq) : null,
      };
    });

    return { mapped, invTotal };
  }, []);

  const loadRecommendations = async (store: string = selectedStore) => {
    const reqId = ++recRequestIdRef.current;
    try {
      const hasCustomFilters =
        recStatusFilter !== 'ALL' || recPriorityFilter !== 'ALL' || recSearch.trim().length > 0;
      const globalOffset = (recPage - 1) * recPageSize;
      // When unfiltered, fetch aligned 200-item blocks to share cache with notification deep-link jumps
      const blockSkip = hasCustomFilters ? globalOffset : Math.floor(globalOffset / 200) * 200;
      const blockLimit = hasCustomFilters ? recPageSize : 200;

      const [res, invMeta] = await Promise.all([
        api.replenishment.listRecommendations({
          store_id: store,
          status: recStatusFilter !== 'ALL' ? recStatusFilter : undefined,
          priority: recPriorityFilter !== 'ALL' ? recPriorityFilter : undefined,
          search: recSearch.trim() || undefined,
          skip: blockSkip,
          limit: blockLimit,
          auto_generate: false,
        }),
        api.inventory.getInventory({ limit: 1, store_id: store }).catch(() => ({ list: [], total: 0 })),
      ]);

      if (reqId !== recRequestIdRef.current) return;

      const rawItems = res.items || [];
      const recItems = hasCustomFilters
        ? rawItems
        : rawItems.slice(globalOffset - blockSkip, globalOffset - blockSkip + recPageSize);

      setRecommendations(recItems);
      setRecTotal(res.total || 0);
      setPendingCount(res.pending_count || 0);
      setApprovedCount(res.approved_count || 0);

      const invTotal = invMeta.total || res.total || recItems.length;
      setTotalMonitoredSkus(invTotal);

      setSelectedRecIds((prev) =>
        prev.filter((id) => recItems.some((item: any) => item.id === id && item.status === 'PENDING'))
      );
    } catch (err) {
      console.error('Failed to load replenishment recommendations', err);
    }
  };

  const loadInventory = async (store: string = selectedStore) => {
    const reqId = ++invRequestIdRef.current;
    try {
      const { mapped, invTotal } = await fetchInventoryWithParams(store);
      if (reqId !== invRequestIdRef.current) return;
      setInventory(mapped);
      setTotalMonitoredSkus((prevTotal) => Math.max(invTotal, mapped.length, recTotal, prevTotal));
    } catch (err) {
      console.error('Failed to load inventory levels', err);
    }
  };

  const loadHistory = async (store: string = selectedStore) => {
    try {
      const res = await api.replenishment.listHistory({
        store_id: store,
        status: historyStatusFilter !== 'ALL' ? historyStatusFilter : undefined,
        skip: (historyPage - 1) * historyPageSize,
        limit: historyPageSize,
      });
      setHistoryList(res.items || []);
      setHistoryTotal(res.total || 0);
    } catch (err) {
      console.error('Failed to load replenishment history', err);
    }
  };

  const loadAll = async (store: string = selectedStore) => {
    setIsLoading(true);
    try {
      if (viewTab === 'RECOMMENDATIONS') {
        await loadRecommendations(store);
      } else if (viewTab === 'INVENTORY') {
        await loadInventory(store);
      } else {
        await loadHistory(store);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Load store list dynamically so any alerted store is present in selector
  useEffect(() => {
    api.inventory
      .getStores()
      .then((stores: any) => {
        if (Array.isArray(stores) && stores.length > 0) {
          setStoreOptions((prev) => Array.from(new Set([...stores, ...prev])));
        }
      })
      .catch(() => {});
  }, []);

  // Ensure store from URL is included in store selector options cleanly
  const availableStoreOptions = useMemo(() => {
    if (focusStoreParam && focusStoreParam !== 'All' && !storeOptions.includes(focusStoreParam)) {
      return [...storeOptions, focusStoreParam];
    }
    return storeOptions;
  }, [storeOptions, focusStoreParam]);

  // Deep-link locator: jump straight to the exact SKU row across store, tab, and page
  useEffect(() => {
    if (!focusSkuParam) return;
    const token = focusTokenParam || `${focusSkuParam}:${focusStoreParam || ''}:${Date.now()}`;
    locateTokenRef.current = token;
    const targetStore = focusStoreParam && focusStoreParam !== 'All' ? focusStoreParam : selectedStore;

    // Delay showing skeleton by 60ms so warm-cache deep-link jumps never flash a loading frame
    let skeletonTimer: number | null = window.setTimeout(() => {
      if (locateTokenRef.current === token) {
        setIsLoading(true);
      }
    }, 60);

    const clearSkeleton = () => {
      if (skeletonTimer !== null) {
        window.clearTimeout(skeletonTimer);
        skeletonTimer = null;
      }
    };

    const pickMatchingIndex = (batch: any[]) => {
      const pendingIdx = batch.findIndex(
        (r: any) => r.item_id === focusSkuParam && (r.status === 'PENDING' || r.status === 'PROPOSED')
      );
      if (pendingIdx !== -1) return pendingIdx;
      return batch.findIndex((r: any) => r.item_id === focusSkuParam);
    };

    const locateTargetSku = async () => {
      try {
        if (targetStore !== selectedStore) {
          skipNextAutoLoadRef.current = true;
          lastLoadedStoreRef.current = targetStore;
          setSelectedStore(targetStore);
        }

        // Fire light total-SKU count non-blocking in the background
        void api.inventory
          .getInventory({ limit: 1, store_id: targetStore })
          .then((meta) => {
            if (locateTokenRef.current === token && meta?.total) {
              setTotalMonitoredSkus((prev) => Math.max(prev, Number(meta.total)));
            }
          })
          .catch(() => {});

        // 1. Search PO Recommendations table (batch 0 hits warm cache if hovered/opened in Topbar)
        if (canEdit) {
          try {
            const firstRes = await api.replenishment.listRecommendations({
              store_id: targetStore,
              skip: 0,
              limit: 200,
              auto_generate: false,
            });
            if (locateTokenRef.current !== token) return;

            const firstBatch = firstRes?.items || [];
            const totalRecs = Number(firstRes?.total || firstBatch.length);
            const summaryMeta = {
              total: totalRecs,
              pending_count: Number(firstRes?.pending_count || 0),
              approved_count: Number(firstRes?.approved_count || 0),
            };

            let matchedRec: any = null;
            let matchedIndex = -1;
            let matchedPageItems: any[] | null = null;

            const firstIdx = pickMatchingIndex(firstBatch);
            if (firstIdx !== -1) {
              matchedRec = firstBatch[firstIdx];
              matchedIndex = firstIdx;
              const pageInBatchStart = Math.floor((matchedIndex % 200) / recPageSize) * recPageSize;
              matchedPageItems = firstBatch.slice(pageInBatchStart, pageInBatchStart + recPageSize);
            } else if (totalRecs > 200 && firstBatch.length === 200) {
              // Scan remaining pages in parallel chunks of 4 (much faster than sequential awaits)
              const maxScan = Math.min(totalRecs, 1400);
              const offsets: number[] = [];
              for (let skip = 200; skip < maxScan; skip += 200) {
                offsets.push(skip);
              }

              for (let i = 0; i < offsets.length; i += 4) {
                const chunk = offsets.slice(i, i + 4);
                const chunkResults = await Promise.all(
                  chunk.map((skip) =>
                    api.replenishment
                      .listRecommendations({
                        store_id: targetStore,
                        skip,
                        limit: 200,
                        auto_generate: false,
                      })
                      .then((res) => ({ skip, batch: res?.items || [] }))
                      .catch(() => ({ skip, batch: [] }))
                  )
                );
                if (locateTokenRef.current !== token) return;

                for (const { skip, batch } of chunkResults) {
                  const localIdx = pickMatchingIndex(batch);
                  if (localIdx !== -1) {
                    matchedRec = batch[localIdx];
                    matchedIndex = skip + localIdx;
                    const pageInBatchStart = Math.floor((matchedIndex % 200) / recPageSize) * recPageSize;
                    matchedPageItems = batch.slice(pageInBatchStart, pageInBatchStart + recPageSize);
                    break;
                  }
                }
                if (matchedRec) break;
              }
            }

            if (matchedRec && matchedIndex !== -1) {
              const targetPage = Math.floor(matchedIndex / recPageSize) + 1;
              recRequestIdRef.current += 1;
              skipNextAutoLoadRef.current = true;
              clearSkeleton();

              setRecStatusFilter('ALL');
              setRecPriorityFilter('ALL');
              setRecSearch('');
              setViewTab('RECOMMENDATIONS');
              setRecPage(targetPage);
              if (matchedPageItems) {
                setRecommendations(matchedPageItems);
              }
              setRecTotal(summaryMeta.total);
              setPendingCount(summaryMeta.pending_count);
              setApprovedCount(summaryMeta.approved_count);
              setIsLoading(false);
              setPendingScrollTarget({
                sku: focusSkuParam,
                recId: matchedRec.id,
                tab: 'RECOMMENDATIONS',
                token,
              });
              setSearchParams({}, { replace: true });
              return;
            }

            // If store has > 1,400 recs, verify exact item_id query before falling back to Inventory
            if (totalRecs > 1400) {
              const directRes = await api.replenishment.listRecommendations({
                store_id: targetStore,
                item_id: focusSkuParam,
                auto_generate: false,
              });
              if (locateTokenRef.current !== token) return;
              const directItems = directRes?.items || [];
              if (directItems.length > 0) {
                const preferred =
                  directItems.find((r: any) => r.status === 'PENDING' || r.status === 'PROPOSED') ||
                  directItems[0];
                recRequestIdRef.current += 1;
                skipNextAutoLoadRef.current = true;
                clearSkeleton();
                setRecStatusFilter('ALL');
                setRecPriorityFilter('ALL');
                setRecSearch(focusSkuParam);
                setViewTab('RECOMMENDATIONS');
                setRecPage(1);
                setRecommendations(directItems.slice(0, recPageSize));
                setRecTotal(Number(directRes?.total || directItems.length));
                setIsLoading(false);
                setPendingScrollTarget({
                  sku: focusSkuParam,
                  recId: preferred.id,
                  tab: 'RECOMMENDATIONS',
                  token,
                });
                setSearchParams({}, { replace: true });
                return;
              }
            }
          } catch {
            // Fall through to Inventory levels table
          }
        }

        // 2. Fallback to Stock & Thresholds (INVENTORY) tab (always works for VIEWER or ungenerated PO SKUs)
        const { mapped, invTotal } = await fetchInventoryWithParams(targetStore);
        if (locateTokenRef.current !== token) return;

        const invIdx = mapped.findIndex((item: any) => item.item_id === focusSkuParam);
        if (invIdx !== -1) {
          const targetInvPage = Math.floor(invIdx / invPageSize) + 1;
          invRequestIdRef.current += 1;
          skipNextAutoLoadRef.current = true;
          clearSkeleton();
          setInventory(mapped);
          setTotalMonitoredSkus((prevTotal) => Math.max(invTotal, mapped.length, prevTotal));
          setViewTab('INVENTORY');
          setInvPage(targetInvPage);
          setIsLoading(false);
          setPendingScrollTarget({
            sku: focusSkuParam,
            tab: 'INVENTORY',
            token,
          });
          setSearchParams({}, { replace: true });
          return;
        }

        skipNextAutoLoadRef.current = false;
        setSearchParams({}, { replace: true });
        showToast(
          isVi
            ? `Không tìm thấy SKU ${focusSkuParam} tại kho ${targetStore}.`
            : `SKU ${focusSkuParam} not found in store ${targetStore}.`,
          'error'
        );
      } finally {
        clearSkeleton();
        if (locateTokenRef.current === token) {
          setIsLoading(false);
        }
      }
    };

    void locateTargetSku();
    return () => {
      clearSkeleton();
    };
  }, [focusSkuParam, focusStoreParam, focusTokenParam]);

  // Execute smooth scroll & brief highlight flash once the target row renders in DOM
  useEffect(() => {
    if (!pendingScrollTarget || isLoading) return;
    if (pendingScrollTarget.tab !== viewTab) return;

    let rowEl: HTMLElement | null = null;
    let flashKey: string | null = null;

    if (viewTab === 'RECOMMENDATIONS') {
      if (pendingScrollTarget.recId) {
        rowEl = document.querySelector(
          `tr[data-rep-rec-id="${CSS.escape(pendingScrollTarget.recId)}"]`
        );
        if (rowEl) {
          flashKey = `rec:${pendingScrollTarget.recId}`;
        }
      }
      if (!rowEl) {
        rowEl = document.querySelector(
          `tr[data-rep-sku="${CSS.escape(pendingScrollTarget.sku)}"]`
        );
        const recId = rowEl?.getAttribute('data-rep-rec-id');
        if (rowEl && recId) {
          flashKey = `rec:${recId}`;
        }
      }
    } else if (viewTab === 'INVENTORY') {
      rowEl = document.querySelector(
        `tr[data-rep-inv-sku="${CSS.escape(pendingScrollTarget.sku)}"]`
      );
      if (rowEl) {
        flashKey = `inv:${pendingScrollTarget.sku}`;
      }
    }

    if (!rowEl || !flashKey) return;

    setPendingScrollTarget(null);
    const targetElement = rowEl;
    const keyToFlash = flashKey;

    // Reset then re-apply on next frame so clicking the same item twice replays the brief flash
    setFlashingRowKey(null);
    if (flashTimeoutRef.current) {
      window.clearTimeout(flashTimeoutRef.current);
    }

    requestAnimationFrame(() => {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      requestAnimationFrame(() => {
        setFlashingRowKey(keyToFlash);
        flashTimeoutRef.current = window.setTimeout(() => {
          setFlashingRowKey((curr) => (curr === keyToFlash ? null : curr));
        }, 1850);
      });
    });
  }, [pendingScrollTarget, viewTab, recommendations, inventory, isLoading, recPage, invPage]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) {
        window.clearTimeout(flashTimeoutRef.current);
      }
    };
  }, []);

  // Single unified tab/store/filter loader (prevents duplicate mount requests)
  useEffect(() => {
    if (focusSkuParam) return;
    if (lastLoadedStoreRef.current !== selectedStore) {
      lastLoadedStoreRef.current = selectedStore;
      setSelectedRecIds([]);
    }
    if (skipNextAutoLoadRef.current) {
      skipNextAutoLoadRef.current = false;
      return;
    }
    void loadAll(selectedStore);
  }, [
    selectedStore,
    viewTab,
    recPage,
    recPageSize,
    recStatusFilter,
    recPriorityFilter,
    recSearch,
    historyPage,
    historyPageSize,
    historyStatusFilter,
    focusSkuParam,
  ]);

  const handleToggleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedRecIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleToggleSelectAllOnPage = () => {
    if (allPendingSelectedOnPage) {
      const pagePendingIds = new Set(pendingItemsOnPage.map((r) => r.id));
      setSelectedRecIds((prev) => prev.filter((id) => !pagePendingIds.has(id)));
    } else {
      const merged = new Set([...selectedRecIds, ...pendingItemsOnPage.map((r) => r.id)]);
      setSelectedRecIds(Array.from(merged));
    }
  };

  const handleBulkApprove = async () => {
    const targetRecs =
      selectedRecIds.length > 0
        ? recommendations.filter((r) => selectedRecIds.includes(r.id))
        : pendingItemsOnPage;
    const targetIds = targetRecs.map((r) => r.id).filter(Boolean);
    if (targetIds.length === 0) {
      showToast(isVi ? 'Chưa chọn đơn chờ duyệt nào.' : 'No pending orders selected.', 'error');
      return;
    }

    setIsBulkApproving(true);
    setBulkProgress({ done: 0, total: targetIds.length });
    let approvedOk = 0;
    let failedCount = 0;
    const approvedItems: Array<{ itemId: string; storeId?: string }> = [];

    try {
      for (let i = 0; i < targetIds.length; i++) {
        try {
          await api.replenishment.approve(targetIds[i]);
          approvedOk++;
          const recObj = targetRecs[i];
          if (recObj?.item_id) {
            approvedItems.push({ itemId: recObj.item_id, storeId: recObj.store_id || selectedStore });
          }
        } catch {
          failedCount++;
        }
        setBulkProgress({ done: i + 1, total: targetIds.length });
      }

      setSelectedRecIds([]);
      await loadRecommendations(selectedStore);
      if (approvedItems.length > 0) {
        emitAlertsSyncEvent({
          action: 'po_bulk_approved',
          storeId: selectedStore,
          items: approvedItems,
        });
      }

      if (failedCount === 0) {
        showToast(
          isVi
            ? `Đã duyệt hàng loạt ${approvedOk}/${targetIds.length} đơn PO!`
            : `Bulk-approved ${approvedOk}/${targetIds.length} POs!`,
          'success'
        );
      } else {
        showToast(
          isVi
            ? `Đã duyệt ${approvedOk}/${targetIds.length} đơn (${failedCount} lỗi).`
            : `Approved ${approvedOk}/${targetIds.length} orders (${failedCount} failed).`,
          approvedOk > 0 ? 'success' : 'error'
        );
      }
    } finally {
      setIsBulkApproving(false);
      setBulkProgress(null);
    }
  };

  const handleAutoGenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await api.replenishment.generateRecommendations(selectedStore);
      showToast(res.message || (isVi ? 'Đã tạo đề xuất PO mới.' : 'Generated PO recommendations.'));
      await loadRecommendations(selectedStore);
      emitAlertsSyncEvent({ action: 'po_generated', storeId: selectedStore });
    } catch (err: any) {
      showToast(
        err.response?.data?.detail || (isVi ? 'Không thể tạo đề xuất' : 'Failed to generate recommendations'),
        'error'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      await api.replenishment.downloadCsv(selectedStore, recStatusFilter !== 'ALL' ? recStatusFilter : undefined);
      showToast(isVi ? 'Đã xuất CSV thành công.' : 'Exported CSV successfully.');
    } catch {
      showToast(isVi ? 'Lỗi xuất CSV' : 'Failed to export CSV', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleApprove = async (rec: any) => {
    try {
      await api.replenishment.approve(rec.id);
      showToast(isVi ? `Đã duyệt PO ${rec.item_id}!` : `Approved PO for ${rec.item_id}!`);
      setSelectedRecIds((prev) => prev.filter((id) => id !== rec.id));
      await loadRecommendations(selectedStore);
      if (selectedItem?.id === rec.id) {
        setSelectedItem({ ...selectedItem, status: 'APPROVED' });
      }
      emitAlertsSyncEvent({
        action: 'po_approved',
        itemId: rec.item_id,
        storeId: rec.store_id || selectedStore,
      });
    } catch (err: any) {
      showToast(err.response?.data?.detail || (isVi ? 'Phê duyệt thất bại' : 'Approval failed'), 'error');
    }
  };

  const handleOpenAdjust = (rec: any) => {
    const metrics = computeRssMetrics(rec);
    setTargetRec(rec);
    setAdjustQtyInput(metrics.finalQty);
    setActionReasonInput(
      rec.reason || (isVi ? 'Làm tròn theo lô MOQ nhà cung cấp' : 'Rounded to supplier MOQ case pack')
    );
    setShowAdjustModal(true);
  };

  const handleSubmitAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetRec) return;
    setIsSubmittingAction(true);
    try {
      await api.replenishment.adjustQuantity(targetRec.id, {
        final_qty: Number(adjustQtyInput),
        reason: actionReasonInput.trim(),
      });
      showToast(isVi ? `Đã cập nhật SL cho ${targetRec.item_id}.` : `Updated quantity for ${targetRec.item_id}.`);
      setShowAdjustModal(false);
      await loadRecommendations(selectedStore);
      if (selectedItem?.id === targetRec.id) {
        setSelectedItem({ ...selectedItem, final_qty: Number(adjustQtyInput), reason: actionReasonInput.trim() });
      }
    } catch (err: any) {
      showToast(err.response?.data?.detail || (isVi ? 'Lỗi điều chỉnh' : 'Adjustment failed'), 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleOpenReject = (rec: any) => {
    setTargetRec(rec);
    setActionReasonInput('');
    setShowRejectModal(true);
  };

  const handleSubmitReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetRec) return;
    setIsSubmittingAction(true);
    try {
      await api.replenishment.reject(targetRec.id, {
        reason: actionReasonInput.trim() || (isVi ? 'Từ chối bởi Quản lý kho' : 'Rejected by Manager'),
      });
      showToast(isVi ? `Đã từ chối ${targetRec.item_id}.` : `Rejected ${targetRec.item_id}.`);
      setShowRejectModal(false);
      setSelectedRecIds((prev) => prev.filter((id) => id !== targetRec.id));
      await loadRecommendations(selectedStore);
      if (selectedItem?.id === targetRec.id) {
        setSelectedItem({ ...selectedItem, status: 'REJECTED' });
      }
      emitAlertsSyncEvent({
        action: 'po_rejected',
        itemId: targetRec.item_id,
        storeId: targetRec.store_id || selectedStore,
      });
    } catch (err: any) {
      showToast(err.response?.data?.detail || (isVi ? 'Lỗi từ chối' : 'Rejection failed'), 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleOpenCancel = (rec: any) => {
    setTargetRec(rec);
    setActionReasonInput('');
    setShowCancelModal(true);
  };

  const handleSubmitCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetRec) return;
    setIsSubmittingAction(true);
    try {
      await api.replenishment.cancel(targetRec.id, {
        reason: actionReasonInput.trim() || (isVi ? 'Hủy theo điều phối kho' : 'Cancelled per dispatch update'),
      });
      showToast(isVi ? `Đã hủy PO ${targetRec.item_id}.` : `Cancelled PO ${targetRec.item_id}.`);
      setShowCancelModal(false);
      await loadRecommendations(selectedStore);
      if (selectedItem?.id === targetRec.id) {
        setSelectedItem({ ...selectedItem, status: 'CANCELLED' });
      }
      emitAlertsSyncEvent({
        action: 'po_cancelled',
        itemId: targetRec.item_id,
        storeId: targetRec.store_id || selectedStore,
      });
    } catch (err: any) {
      showToast(err.response?.data?.detail || (isVi ? 'Lỗi hủy đơn' : 'Cancellation failed'), 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRecompute = async () => {
    setIsRecomputing(true);
    try {
      const res = await api.optimization.recompute({ store_id: selectedStore });
      showToast(res.message || (isVi ? 'Đã tính lại tham số (R, s, S)!' : 'Recomputed (R, s, S) parameters!'));
      await loadAll(selectedStore);
      emitAlertsSyncEvent({ action: 'params_recomputed', storeId: selectedStore });
    } catch (err: any) {
      showToast(err.response?.data?.detail || (isVi ? 'Lỗi tính lại tham số' : 'Recompute failed'), 'error');
    } finally {
      setIsRecomputing(false);
    }
  };

  const selectedDrawerMetrics = selectedItem ? computeRssMetrics(selectedItem) : null;

  return (
    <div className="rep-container">
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            backgroundColor: toastMsg.type === 'error' ? '#dc2626' : '#0f766e',
            color: '#ffffff',
            padding: '0.65rem 1.1rem',
            borderRadius: '6px',
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.8125rem',
            fontWeight: 600,
          }}
        >
          {toastMsg.type === 'error' ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Header & Controls */}
      <div className="rep-header-section">
        <div className="rep-header-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h1 className="rep-page-title">
              {isVi ? 'Bổ Sung Tồn Kho & Đơn Đặt Hàng' : 'Replenishment & PO Control'}
            </h1>
            <span className="rep-engine-tag">REFIT-RSS-EOQ-G + C³-OUT</span>
          </div>
          <p className="rep-page-desc">
            {isVi
              ? 'Kiểm soát tồn kho định kỳ (R, s, S) và phê duyệt đơn hàng tự động.'
              : 'Periodic review (R, s, S) inventory control and automated PO approvals.'}
          </p>
        </div>

        <div className="rep-header-right">
          <div className="rep-store-select-group">
            <StoreIcon size={14} className="text-slate-400" />
            <span className="rep-store-label">{isVi ? 'KHO:' : 'STORE:'}</span>
            <select
              className="rep-store-select"
              value={selectedStore}
              onChange={(e) => {
                setSelectedStore(e.target.value);
                setRecPage(1);
                setInvPage(1);
                setHistoryPage(1);
              }}
            >
              {availableStoreOptions.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          {canEdit && (
            <>
              {viewTab === 'RECOMMENDATIONS' && (selectedRecIds.length > 0 || pendingItemsOnPage.length > 0) && (
                <button
                  className="rep-btn rep-btn-teal"
                  onClick={handleBulkApprove}
                  disabled={isBulkApproving}
                  title={isVi ? 'Duyệt hàng loạt đề xuất chờ duyệt' : 'Bulk approve pending recommendations'}
                >
                  <CheckSquare size={13} className={isBulkApproving ? 'animate-spin' : ''} />
                  <span>
                    {isBulkApproving && bulkProgress
                      ? `${bulkProgress.done}/${bulkProgress.total}...`
                      : isVi
                      ? `Duyệt hàng loạt (${selectedRecIds.length > 0 ? selectedRecIds.length : pendingItemsOnPage.length})`
                      : `Bulk Approve (${selectedRecIds.length > 0 ? selectedRecIds.length : pendingItemsOnPage.length})`}
                  </span>
                </button>
              )}

              <button className="rep-btn rep-btn-primary" onClick={handleAutoGenerate} disabled={isGenerating}>
                <RefreshCw size={13} className={isGenerating ? 'animate-spin' : ''} />
                <span>{isGenerating ? '...' : isVi ? 'Tạo đề xuất PO' : 'Generate POs'}</span>
              </button>

              <button className="rep-btn rep-btn-outline" onClick={handleRecompute} disabled={isRecomputing}>
                <Calculator size={13} className={isRecomputing ? 'animate-spin' : ''} />
                <span>{isRecomputing ? '...' : isVi ? 'Tính lại (R,s,S)' : 'Recompute (R,s,S)'}</span>
              </button>

              <button className="rep-btn rep-btn-outline" onClick={handleExportCsv} disabled={isExporting}>
                <Download size={13} />
                <span>{isVi ? 'Xuất CSV' : 'Export CSV'}</span>
              </button>
            </>
          )}

          <button className="rep-btn rep-btn-outline" onClick={() => loadAll(selectedStore)}>
            <RefreshCw size={13} />
            <span>{isVi ? 'Làm mới' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* 4 Crisp KPI Cards */}
      <div className="rep-kpi-row">
        <div className="rep-kpi-card">
          <div className="rep-kpi-header">
            <span className="rep-kpi-title">{isVi ? 'CHỜ PHÊ DUYỆT' : 'PENDING POs'}</span>
            <span className="rep-kpi-badge badge-warning">IP ≤ s</span>
          </div>
          <div className="rep-kpi-content">
            <span className="rep-kpi-num">{pendingCount.toLocaleString(localeStr)}</span>
            <span className="rep-kpi-sub">{isVi ? 'Cần phê duyệt' : 'Awaiting approval'}</span>
          </div>
        </div>

        <div className="rep-kpi-card">
          <div className="rep-kpi-header">
            <span className="rep-kpi-title">{isVi ? 'ĐƠN ĐÃ DUYỆT' : 'APPROVED POs'}</span>
            <span className="rep-kpi-badge badge-success">L = 3d</span>
          </div>
          <div className="rep-kpi-content">
            <span className="rep-kpi-num">{approvedCount.toLocaleString(localeStr)}</span>
            <span className="rep-kpi-sub">{isVi ? 'Đang vận chuyển' : 'In transit (On-Order)'}</span>
          </div>
        </div>

        <div className="rep-kpi-card">
          <div className="rep-kpi-header">
            <span className="rep-kpi-title">{isVi ? 'TỔNG ĐỀ XUẤT' : 'TOTAL ORDERS'}</span>
            <span className="rep-kpi-badge badge-neutral">R = 7d</span>
          </div>
          <div className="rep-kpi-content">
            <span className="rep-kpi-num">{recTotal.toLocaleString(localeStr)}</span>
            <span className="rep-kpi-sub">{isVi ? `Chu kỳ kho ${selectedStore}` : `Cycle at ${selectedStore}`}</span>
          </div>
        </div>

        <div className="rep-kpi-card">
          <div className="rep-kpi-header">
            <span className="rep-kpi-title">{isVi ? 'MẶT HÀNG THEO DÕI' : 'MONITORED SKUS'}</span>
            <span className="rep-kpi-badge badge-teal">H = L + R = 10d</span>
          </div>
          <div className="rep-kpi-content">
            <span className="rep-kpi-num">{monitoredSkusCount.toLocaleString(localeStr)}</span>
            <span className="rep-kpi-sub">REFIT-RSS-EOQ-G + C³-OUT</span>
          </div>
        </div>
      </div>

      {/* Sub-Navigation Bar + Compact Single-Line Formula Strip */}
      <div className="rep-subnav-row">
        <div className="rep-tabs-bar" role="tablist">
          <button
            role="tab"
            aria-selected={viewTab === 'RECOMMENDATIONS'}
            className={`rep-tab-btn ${viewTab === 'RECOMMENDATIONS' ? 'active' : ''}`}
            onClick={() => setViewTab('RECOMMENDATIONS')}
          >
            <PackageCheck size={15} />
            <span>{isVi ? 'Đề xuất Đặt hàng (PO)' : 'PO Recommendations'}</span>
          </button>

          <button
            role="tab"
            aria-selected={viewTab === 'INVENTORY'}
            className={`rep-tab-btn ${viewTab === 'INVENTORY' ? 'active' : ''}`}
            onClick={() => setViewTab('INVENTORY')}
          >
            <Layers size={15} />
            <span>{isVi ? 'Tồn kho & Ngưỡng (IP vs s, S)' : 'Stock & Thresholds (IP vs s, S)'}</span>
          </button>

          <button
            role="tab"
            aria-selected={viewTab === 'HISTORY'}
            className={`rep-tab-btn ${viewTab === 'HISTORY' ? 'active' : ''}`}
            onClick={() => setViewTab('HISTORY')}
          >
            <HistoryIcon size={15} />
            <span>{isVi ? 'Lịch sử Phê duyệt' : 'Approval History'}</span>
          </button>
        </div>

        <div className="rep-inline-formula-strip">
          <ShieldCheck size={13} className="rep-policy-icon" />
          <span className="rep-formula-pill">IP = OH + OO</span>
          <span className="rep-formula-sep">·</span>
          <span className="rep-formula-pill">s = Q̂(τ) + θσ̂</span>
          <span className="rep-formula-sep">·</span>
          <span className="rep-formula-pill">S = s + ⌈κ·EOQ⌉</span>
          <span className="rep-formula-sep">·</span>
          <span className="rep-formula-pill pill-accent">IP ≤ s ⇒ q = S − IP</span>
        </div>
      </div>

      {/* TAB 1: PO RECOMMENDATIONS (Focused on Order Execution) */}
      {viewTab === 'RECOMMENDATIONS' && (
        <>
          <div className="rep-filter-toolbar">
            <div className="rep-filter-left">
              <span className="rep-filter-lbl">{isVi ? 'TRẠNG THÁI:' : 'STATUS:'}</span>
              <div className="rep-filter-pills">
                {[
                  { val: 'ALL', label: isVi ? 'Tất cả' : 'All' },
                  { val: 'PENDING', label: isVi ? 'Chờ duyệt' : 'Pending' },
                  { val: 'APPROVED', label: isVi ? 'Đã duyệt' : 'Approved' },
                  { val: 'REJECTED', label: isVi ? 'Từ chối' : 'Rejected' },
                  { val: 'CANCELLED', label: isVi ? 'Đã hủy' : 'Cancelled' },
                ].map(({ val, label }) => (
                  <button
                    key={val}
                    className={`rep-pill-btn ${recStatusFilter === val ? 'active' : ''}`}
                    onClick={() => {
                      setRecStatusFilter(val);
                      setRecPage(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="rep-filter-divider" />

              <span className="rep-filter-lbl">{isVi ? 'ƯU TIÊN:' : 'PRIORITY:'}</span>
              <div className="rep-filter-pills">
                {[
                  { val: 'ALL', label: isVi ? 'Tất cả' : 'All' },
                  { val: 'CRITICAL', label: isVi ? 'Khẩn cấp' : 'Critical' },
                  { val: 'HIGH', label: isVi ? 'Cao' : 'High' },
                  { val: 'MEDIUM', label: isVi ? 'Vừa' : 'Medium' },
                  { val: 'LOW', label: isVi ? 'Thấp' : 'Low' },
                ].map(({ val, label }) => (
                  <button
                    key={val}
                    className={`rep-pill-btn ${recPriorityFilter === val ? 'active' : ''}`}
                    onClick={() => {
                      setRecPriorityFilter(val);
                      setRecPage(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              {canEdit && selectedRecIds.length > 0 && (
                <div className="rep-bulk-selection-pill">
                  <span>
                    {isVi ? `Đã chọn ${selectedRecIds.length}` : `${selectedRecIds.length} selected`}
                  </span>
                  <button
                    type="button"
                    className="rep-bulk-inline-btn"
                    onClick={handleBulkApprove}
                    disabled={isBulkApproving}
                  >
                    <Check size={12} />
                    <span>{isVi ? 'Duyệt ngay' : 'Approve'}</span>
                  </button>
                  <button
                    type="button"
                    className="rep-bulk-clear-btn"
                    onClick={() => setSelectedRecIds([])}
                    title={isVi ? 'Bỏ chọn' : 'Clear'}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              <div className="rep-search-group">
                <Search size={14} className="rep-search-icon" />
                <input
                  type="text"
                  className="rep-search-input"
                  placeholder={isVi ? 'Tìm SKU, sản phẩm...' : 'Search SKU, item...'}
                  value={recSearch}
                  onChange={(e) => {
                    setRecSearch(e.target.value);
                    setRecPage(1);
                  }}
                />
                {recSearch && (
                  <button
                    onClick={() => {
                      setRecSearch('');
                      setRecPage(1);
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="rep-table-panel">
            <div className="rep-table-container">
              <table className="rep-table">
                <thead>
                  <tr>
                    {canEdit && (
                      <th style={{ width: '38px', textAlign: 'center', padding: '0.65rem 0.5rem' }}>
                        <button
                          type="button"
                          className="rep-checkbox-btn"
                          onClick={handleToggleSelectAllOnPage}
                          disabled={pendingItemsOnPage.length === 0}
                          title={isVi ? 'Chọn tất cả đơn chờ duyệt' : 'Select all pending on page'}
                        >
                          {allPendingSelectedOnPage ? (
                            <CheckSquare size={15} className="text-teal-700" />
                          ) : (
                            <Square size={15} className="text-slate-400" />
                          )}
                        </button>
                      </th>
                    )}
                    <th>{isVi ? 'Mã SKU / Sản phẩm' : 'SKU / Product'}</th>
                    <th style={{ width: '68px' }}>{isVi ? 'Kho' : 'Store'}</th>
                    <th className="text-right" style={{ width: '124px' }}>
                      IP (OH+OO)
                    </th>
                    <th className="text-right" style={{ width: '88px' }}>
                      s (ROP)
                    </th>
                    <th className="text-right" style={{ width: '90px' }}>
                      S (Up-To)
                    </th>
                    <th className="text-right" style={{ width: '84px' }}>
                      EOQ
                    </th>
                    <th className="text-right" style={{ width: '96px' }}>
                      {isVi ? 'Gợi ý (q)' : 'Rec Qty (q)'}
                    </th>
                    <th className="text-right" style={{ width: '96px' }}>
                      {isVi ? 'SL Chốt' : 'Final Qty'}
                    </th>
                    <th style={{ width: '88px' }}>{isVi ? 'Ưu tiên' : 'Priority'}</th>
                    <th style={{ width: '96px' }}>{isVi ? 'Trạng thái' : 'Status'}</th>
                    <th className="text-center" style={{ width: '96px' }}>
                      {isVi ? 'Thao tác' : 'Actions'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, idx) => (
                      <tr key={`skeleton-rec-${idx}`} className="rep-skeleton-row" aria-hidden="true">
                        {canEdit && (
                          <td style={{ textAlign: 'center' }}>
                            <span className="rep-skeleton-box" style={{ width: '14px', height: '14px', margin: '0 auto' }} />
                          </td>
                        )}
                        <td>
                          <span className="rep-skeleton-box" style={{ width: '112px', height: '12px', marginBottom: '6px' }} />
                          <span className="rep-skeleton-box" style={{ width: '76px', height: '10px', opacity: 0.65 }} />
                        </td>
                        <td><span className="rep-skeleton-box" style={{ width: '40px', height: '18px' }} /></td>
                        <td><span className="rep-skeleton-box" style={{ width: '74px', height: '14px', marginLeft: 'auto' }} /></td>
                        <td><span className="rep-skeleton-box" style={{ width: '42px', height: '14px', marginLeft: 'auto' }} /></td>
                        <td><span className="rep-skeleton-box" style={{ width: '42px', height: '14px', marginLeft: 'auto' }} /></td>
                        <td><span className="rep-skeleton-box" style={{ width: '38px', height: '14px', marginLeft: 'auto' }} /></td>
                        <td><span className="rep-skeleton-box" style={{ width: '44px', height: '14px', marginLeft: 'auto' }} /></td>
                        <td><span className="rep-skeleton-box" style={{ width: '44px', height: '14px', marginLeft: 'auto' }} /></td>
                        <td><span className="rep-skeleton-box" style={{ width: '62px', height: '20px' }} /></td>
                        <td><span className="rep-skeleton-box" style={{ width: '68px', height: '20px' }} /></td>
                        <td><span className="rep-skeleton-box" style={{ width: '64px', height: '20px', margin: '0 auto' }} /></td>
                      </tr>
                    ))
                  ) : recommendations.length === 0 ? (
                    <tr>
                      <td colSpan={canEdit ? 12 : 11} style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.8125rem', color: '#475569' }}>
                          {isVi ? 'Không có đề xuất đặt hàng nào khớp bộ lọc.' : 'No matching replenishment orders.'}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    recommendations.map((rec) => {
                      const isPending = rec.status === 'PENDING';
                      const isApproved = rec.status === 'APPROVED';
                      const isSelected = selectedItem?.id === rec.id;
                      const isChecked = selectedRecIds.includes(rec.id);
                      const isFlashing = flashingRowKey === `rec:${rec.id}`;
                      const priClass = (rec.priority || 'LOW').toLowerCase();
                      const statusClass = (rec.status || 'PENDING').toLowerCase();
                      const m = computeRssMetrics(rec);

                      return (
                        <tr
                          key={rec.id}
                          data-rep-rec-id={rec.id}
                          data-rep-sku={rec.item_id}
                          className={`${isSelected ? 'selected' : ''} ${isChecked ? 'row-checked' : ''} ${
                            isFlashing ? 'rep-row-flash' : ''
                          }`}
                          onClick={() => setSelectedItem(rec)}
                          style={{ cursor: 'pointer' }}
                        >
                          {canEdit && (
                            <td
                              style={{ textAlign: 'center', padding: '0.65rem 0.5rem' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {isPending ? (
                                <button
                                  type="button"
                                  className="rep-checkbox-btn"
                                  onClick={(e) => handleToggleSelectRow(rec.id, e)}
                                >
                                  {isChecked ? (
                                    <CheckSquare size={15} className="text-teal-700" />
                                  ) : (
                                    <Square size={15} className="text-slate-400" />
                                  )}
                                </button>
                              ) : (
                                <span style={{ color: '#cbd5e1', fontSize: '0.75rem' }}>—</span>
                              )}
                            </td>
                          )}
                          <td>
                            <div className="rep-sku-code">{rec.item_id}</div>
                            <div className="rep-sku-name">
                              {rec.product_name || rec.category || (isVi ? 'Hàng tiêu dùng' : 'Merchandise')}
                            </div>
                          </td>
                          <td>
                            <span className="rep-store-tag">{rec.store_id}</span>
                          </td>
                          <td
                            className="text-right"
                            title={`On-Hand: ${m.onHand} + On-Order: ${m.onOrder} = IP: ${m.ip}`}
                          >
                            <div className="rep-ip-cell">
                              <span className={`rep-mono-num ${m.isTriggered ? 'num-danger' : 'num-default'}`}>
                                {formatQty(m.ip, localeStr)}
                              </span>
                              <span className={`rep-trigger-badge ${m.isTriggered ? 'trig-yes' : 'trig-no'}`}>
                                {m.isTriggered
                                  ? isVi
                                    ? 'IP ≤ s · ĐẶT'
                                    : 'IP ≤ s · TRIGGER'
                                  : isVi
                                  ? 'IP > s · GIỮ'
                                  : 'IP > s · HOLD'}
                              </span>
                            </div>
                          </td>
                          <td className="text-right rep-mono-num num-default">{formatDecimal(m.s, 1, localeStr)}</td>
                          <td className="text-right rep-mono-num num-teal">{formatQty(m.bigS, localeStr)}</td>
                          <td className="text-right rep-mono-num num-muted" title={`SS: ${m.ss}`}>
                            {formatQty(m.eoq, localeStr)}
                          </td>
                          <td className="text-right rep-mono-num num-muted">
                            {formatQty(m.recommendedQty, localeStr)}
                          </td>
                          <td className="text-right rep-mono-num num-highlight">
                            {formatQty(m.finalQty, localeStr)}
                          </td>
                          <td>
                            <span className={`rep-priority-badge pri-${priClass}`}>
                              <span className="rep-priority-dot" />
                              {priorityLabels[rec.priority] || rec.priority}
                            </span>
                          </td>
                          <td>
                            <span className={`rep-status-pill status-${statusClass}`}>
                              <span className="rep-status-dot" />
                              {statusLabels[rec.status] || rec.status}
                            </span>
                          </td>
                          <td className="text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="rep-action-group">
                              {canEdit && isPending && (
                                <>
                                  <button
                                    className="rep-action-btn-icon btn-approve"
                                    onClick={() => handleApprove(rec)}
                                    title={isVi ? 'Duyệt' : 'Approve'}
                                  >
                                    <Check size={14} />
                                  </button>
                                  <button
                                    className="rep-action-btn-icon btn-adjust"
                                    onClick={() => handleOpenAdjust(rec)}
                                    title={isVi ? 'Sửa SL' : 'Adjust'}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    className="rep-action-btn-icon btn-reject"
                                    onClick={() => handleOpenReject(rec)}
                                    title={isVi ? 'Từ chối' : 'Reject'}
                                  >
                                    <Ban size={13} />
                                  </button>
                                </>
                              )}

                              {canEdit && isApproved && (
                                <button
                                  className="rep-action-btn-ghost btn-cancel"
                                  onClick={() => handleOpenCancel(rec)}
                                >
                                  {isVi ? 'Hủy' : 'Cancel'}
                                </button>
                              )}

                              {!isPending && !isApproved && (
                                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>—</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {recTotal > 0 && (
              <div style={{ padding: '0.65rem 1rem', borderTop: '1px solid #e2e8f0' }}>
                <Pagination
                  currentPage={recPage}
                  totalItems={recTotal}
                  pageSize={recPageSize}
                  onPageChange={setRecPage}
                  onPageSizeChange={(sz) => {
                    setRecPageSize(sz);
                    setRecPage(1);
                  }}
                  pageSizeOptions={[10, 20, 50]}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* TAB 2: WAREHOUSE STOCK & THRESHOLDS (On-Hand, On-Order, IP, s, S, Fill Bar) */}
      {viewTab === 'INVENTORY' && (
        <div className="rep-table-panel">
          <div className="rep-table-container">
            <table className="rep-table">
              <thead>
                <tr>
                  <th>{isVi ? 'Mã SKU / Sản phẩm' : 'SKU / Product'}</th>
                  <th style={{ width: '75px' }}>{isVi ? 'Kho' : 'Store'}</th>
                  <th className="text-right" style={{ width: '95px' }}>
                    On-Hand
                  </th>
                  <th className="text-right" style={{ width: '95px' }}>
                    On-Order
                  </th>
                  <th className="text-right" style={{ width: '95px' }}>
                    IP (OH+OO)
                  </th>
                  <th className="text-right" style={{ width: '95px' }}>
                    SS
                  </th>
                  <th className="text-right" style={{ width: '95px' }}>
                    s (ROP)
                  </th>
                  <th className="text-right" style={{ width: '95px' }}>
                    S (Up-To)
                  </th>
                  <th style={{ width: '150px' }}>{isVi ? 'Mức lấp đầy (IP / S)' : 'Fill Level (IP / S)'}</th>
                  <th style={{ width: '115px' }}>{isVi ? 'Trạng thái' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, idx) => (
                    <tr key={`skeleton-inv-${idx}`} className="rep-skeleton-row" aria-hidden="true">
                      <td>
                        <span className="rep-skeleton-box" style={{ width: '112px', height: '12px', marginBottom: '6px' }} />
                        <span className="rep-skeleton-box" style={{ width: '76px', height: '10px', opacity: 0.65 }} />
                      </td>
                      <td><span className="rep-skeleton-box" style={{ width: '40px', height: '18px' }} /></td>
                      <td><span className="rep-skeleton-box" style={{ width: '44px', height: '14px', marginLeft: 'auto' }} /></td>
                      <td><span className="rep-skeleton-box" style={{ width: '44px', height: '14px', marginLeft: 'auto' }} /></td>
                      <td><span className="rep-skeleton-box" style={{ width: '44px', height: '14px', marginLeft: 'auto' }} /></td>
                      <td><span className="rep-skeleton-box" style={{ width: '40px', height: '14px', marginLeft: 'auto' }} /></td>
                      <td><span className="rep-skeleton-box" style={{ width: '40px', height: '14px', marginLeft: 'auto' }} /></td>
                      <td><span className="rep-skeleton-box" style={{ width: '44px', height: '14px', marginLeft: 'auto' }} /></td>
                      <td><span className="rep-skeleton-box" style={{ width: '108px', height: '10px' }} /></td>
                      <td><span className="rep-skeleton-box" style={{ width: '72px', height: '20px' }} /></td>
                    </tr>
                  ))
                ) : (
                  inventory.slice((invPage - 1) * invPageSize, invPage * invPageSize).map((item) => {
                  const m = computeRssMetrics(item);
                  const ss = item.safety_stock != null ? Number(item.safety_stock) : null;
                  const rop = item.reorder_point != null ? Number(item.reorder_point) : null;
                  const isCrit = ss != null ? m.ip <= ss : false;
                  const isBelowRop = rop != null ? m.ip > (ss ?? 0) && m.ip <= rop : false;
                  const statusKey = isCrit ? 'critical' : isBelowRop ? 'warning' : ss == null ? 'neutral' : 'healthy';
                  const statusText = isCrit
                    ? isVi
                      ? 'Nguy cấp'
                      : 'Critical'
                    : isBelowRop
                    ? isVi
                      ? 'Cần đặt (IP ≤ s)'
                      : 'Trigger (IP ≤ s)'
                    : ss == null
                    ? isVi
                      ? 'Chưa gán'
                      : 'Unset'
                    : isVi
                    ? 'An toàn'
                    : 'Healthy';
                  const fillPct = m.bigS > 0 ? Math.min(100, Math.max(0, Math.round((m.ip / m.bigS) * 100))) : 0;
                  const isFlashing = flashingRowKey === `inv:${item.item_id}`;

                  return (
                    <tr
                      key={item.item_id}
                      data-rep-inv-sku={item.item_id}
                      className={isFlashing ? 'rep-row-flash' : ''}
                    >
                      <td>
                        <div className="rep-sku-code">{item.item_id}</div>
                        <div className="rep-sku-name">{item.name || item.item_id}</div>
                      </td>
                      <td>
                        <span className="rep-store-tag">{item.store_id || selectedStore}</span>
                      </td>
                      <td className={`text-right rep-mono-num ${m.onHand <= 0 ? 'num-danger' : 'num-default'}`}>
                        {formatQty(m.onHand, localeStr)}
                      </td>
                      <td className="text-right rep-mono-num num-muted">{formatQty(m.onOrder, localeStr)}</td>
                      <td className={`text-right rep-mono-num ${m.isTriggered ? 'num-danger' : 'num-default'}`}>
                        {formatQty(m.ip, localeStr)}
                      </td>
                      <td className="text-right rep-mono-num num-muted">
                        {ss != null ? formatDecimal(ss, 1, localeStr) : '—'}
                      </td>
                      <td className="text-right rep-mono-num num-default">
                        {rop != null ? formatDecimal(rop, 1, localeStr) : '—'}
                      </td>
                      <td className="text-right rep-mono-num num-teal">
                        {rop != null ? formatQty(m.bigS, localeStr) : '—'}
                      </td>
                      <td>
                        <div className="rep-fill-bar-wrap">
                          <div className="rep-fill-bar-track">
                            <div
                              className={`rep-fill-bar-fill ${
                                isCrit ? 'fill-crit' : isBelowRop ? 'fill-warn' : 'fill-ok'
                              }`}
                              style={{ width: `${fillPct}%` }}
                            />
                          </div>
                          <span className="rep-fill-pct">{fillPct}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={`rep-status-pill status-${statusKey}`}>
                          <span className="rep-status-dot" />
                          {statusText}
                        </span>
                      </td>
                    </tr>
                  );
                })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '0.65rem 1rem', borderTop: '1px solid #e2e8f0' }}>
            <Pagination
              currentPage={invPage}
              totalItems={inventory.length}
              pageSize={invPageSize}
              onPageChange={setInvPage}
              onPageSizeChange={(sz) => {
                setInvPageSize(sz);
                setInvPage(1);
              }}
              pageSizeOptions={[10, 20, 50]}
            />
          </div>
        </div>
      )}

      {/* TAB 3: DECISION HISTORY */}
      {viewTab === 'HISTORY' && (
        <div className="rep-table-panel">
          <div
            className="rep-filter-toolbar"
            style={{ border: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0, marginBottom: 0 }}
          >
            <div className="rep-filter-left">
              <span className="rep-filter-lbl">{isVi ? 'TRẠNG THÁI:' : 'STATUS:'}</span>
              <div className="rep-filter-pills">
                {[
                  { val: 'ALL', label: isVi ? 'Tất cả' : 'All' },
                  { val: 'APPROVED', label: isVi ? 'Đã duyệt' : 'Approved' },
                  { val: 'REJECTED', label: isVi ? 'Từ chối' : 'Rejected' },
                  { val: 'CANCELLED', label: isVi ? 'Đã hủy' : 'Cancelled' },
                ].map(({ val, label }) => (
                  <button
                    key={val}
                    className={`rep-pill-btn ${historyStatusFilter === val ? 'active' : ''}`}
                    onClick={() => {
                      setHistoryStatusFilter(val);
                      setHistoryPage(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              {isVi ? 'Nhật ký kho ' : 'Audit log: '}
              <strong>{selectedStore}</strong>
            </span>
          </div>

          <div className="rep-table-container">
            <table className="rep-table">
              <thead>
                <tr>
                  <th>{isVi ? 'Mã SKU' : 'SKU Code'}</th>
                  <th style={{ width: '75px' }}>{isVi ? 'Kho' : 'Store'}</th>
                  <th className="text-right" style={{ width: '115px' }}>
                    {isVi ? 'Đề xuất (q)' : 'Initial Qty'}
                  </th>
                  <th className="text-right" style={{ width: '115px' }}>
                    {isVi ? 'SL Chốt' : 'Final Qty'}
                  </th>
                  <th style={{ width: '110px' }}>{isVi ? 'Trạng thái' : 'Status'}</th>
                  <th>{isVi ? 'Lý do / Ghi chú' : 'Justification'}</th>
                  <th style={{ width: '130px' }}>{isVi ? 'Người duyệt' : 'Decided By'}</th>
                  <th style={{ width: '155px' }}>{isVi ? 'Thời gian' : 'Timestamp'}</th>
                </tr>
              </thead>
              <tbody>
                {historyList.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                      {isVi ? 'Chưa có lịch sử phê duyệt.' : 'No approval history recorded.'}
                    </td>
                  </tr>
                ) : (
                  historyList.map((h) => {
                    const statusClass = (h.status || '').toLowerCase();
                    return (
                      <tr key={h.id}>
                        <td>
                          <span className="rep-sku-code">{h.item_id}</span>
                        </td>
                        <td>
                          <span className="rep-store-tag">{h.store_id}</span>
                        </td>
                        <td className="text-right rep-mono-num num-muted">{formatQty(h.recommended_qty, localeStr)}</td>
                        <td className="text-right rep-mono-num num-highlight">{formatQty(h.final_qty, localeStr)}</td>
                        <td>
                          <span className={`rep-status-pill status-${statusClass}`}>
                            <span className="rep-status-dot" />
                            {statusLabels[h.status] || h.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8125rem', color: '#475569', maxWidth: '280px' }}>
                          {h.reason || '—'}
                        </td>
                        <td style={{ fontSize: '0.8125rem', color: '#334155', fontWeight: 500 }}>
                          {h.decided_by || (isVi ? 'Hệ thống' : 'System')}
                        </td>
                        <td className="rep-mono-num num-muted" style={{ fontSize: '0.75rem' }}>
                          {h.decided_at
                            ? new Date(h.decided_at).toLocaleString(localeStr)
                            : new Date(h.created_at).toLocaleString(localeStr)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {historyTotal > 0 && (
            <div style={{ padding: '0.65rem 1rem', borderTop: '1px solid #e2e8f0' }}>
              <Pagination
                currentPage={historyPage}
                totalItems={historyTotal}
                pageSize={historyPageSize}
                onPageChange={setHistoryPage}
                onPageSizeChange={(sz) => {
                  setHistoryPageSize(sz);
                  setHistoryPage(1);
                }}
                pageSizeOptions={[10, 20, 50]}
              />
            </div>
          )}
        </div>
      )}

      {/* Slide-Over Detail Drawer */}
      {selectedItem &&
        selectedDrawerMetrics &&
        createPortal(
          <div className="rep-drawer-overlay" onClick={() => setSelectedItem(null)}>
            <div className="rep-drawer" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-header">
                <div>
                  <span className="drawer-badge">
                    {isVi ? 'Chi tiết Chính sách (R, s, S)' : '(R, s, S) Order Inspector'}
                  </span>
                  <h3 className="drawer-title">{selectedItem.item_id}</h3>
                  <p className="drawer-sku-info">
                    {selectedItem.product_name || selectedItem.category || 'SKU'} &bull; {selectedItem.store_id}
                  </p>
                </div>
                <button className="drawer-close-btn" onClick={() => setSelectedItem(null)}>
                  <X size={16} />
                </button>
              </div>

              <div className="drawer-body">
                <div className="drawer-kpi-grid">
                  <div className="drawer-kpi-card">
                    <span className="drawer-kpi-lbl">On-Hand (OH)</span>
                    <span className={`drawer-kpi-val ${selectedDrawerMetrics.onHand <= 0 ? 'text-red' : 'text-slate'}`}>
                      {formatQty(selectedDrawerMetrics.onHand, localeStr)}
                    </span>
                  </div>
                  <div className="drawer-kpi-card">
                    <span className="drawer-kpi-lbl">On-Order (OO)</span>
                    <span className="drawer-kpi-val text-slate">
                      {formatQty(selectedDrawerMetrics.onOrder, localeStr)}
                    </span>
                  </div>
                  <div className="drawer-kpi-card">
                    <span className="drawer-kpi-lbl">IP = OH + OO</span>
                    <span
                      className={`drawer-kpi-val ${
                        selectedDrawerMetrics.isTriggered ? 'text-red' : 'text-slate'
                      }`}
                    >
                      {formatQty(selectedDrawerMetrics.ip, localeStr)}
                    </span>
                  </div>
                  <div className="drawer-kpi-card">
                    <span className="drawer-kpi-lbl">s (ROP)</span>
                    <span className="drawer-kpi-val text-slate">
                      {formatDecimal(selectedDrawerMetrics.s, 1, localeStr)}
                    </span>
                  </div>
                  <div className="drawer-kpi-card">
                    <span className="drawer-kpi-lbl">S (Order-Up-To)</span>
                    <span className="drawer-kpi-val" style={{ color: '#0f766e' }}>
                      {formatQty(selectedDrawerMetrics.bigS, localeStr)}
                    </span>
                  </div>
                  <div className="drawer-kpi-card">
                    <span className="drawer-kpi-lbl">EOQ / SS</span>
                    <span className="drawer-kpi-val text-slate">
                      {formatQty(selectedDrawerMetrics.eoq, localeStr)} /{' '}
                      {formatDecimal(selectedDrawerMetrics.ss, 1, localeStr)}
                    </span>
                  </div>
                </div>

                <div className="drawer-rec-box">
                  <div className="drawer-rec-row-primary">
                    <span className="drawer-rec-label">{isVi ? 'SL Đặt Chốt' : 'Final Order Qty'}</span>
                    <span className="drawer-rec-value-highlight">
                      {formatQty(selectedDrawerMetrics.finalQty, localeStr)}
                    </span>
                  </div>
                  <div className="drawer-rec-row-sub">
                    <span>{isVi ? 'Gợi ý q = S − IP:' : 'Recommended q = S − IP:'}</span>
                    <span className="rep-mono-num">{formatQty(selectedDrawerMetrics.recommendedQty, localeStr)}</span>
                  </div>
                  <div className="drawer-rec-row-sub">
                    <span>{isVi ? 'Cửa sổ bảo vệ:' : 'Protection Window:'}</span>
                    <span className="rep-mono-num">H = L + R = 10d</span>
                  </div>
                </div>

                {selectedItem.reason && (
                  <div className="drawer-section">
                    <span className="drawer-section-title">{isVi ? 'Ghi chú' : 'Notes'}</span>
                    <p className="drawer-reason-text">{selectedItem.reason}</p>
                  </div>
                )}
              </div>

              <div className="drawer-footer">
                {canEdit && selectedItem.status === 'PENDING' && (
                  <>
                    <button className="drawer-btn-approve" onClick={() => handleApprove(selectedItem)}>
                      <Check size={15} /> {isVi ? 'Duyệt đơn' : 'Approve'}
                    </button>
                    <button className="drawer-btn-adjust" onClick={() => handleOpenAdjust(selectedItem)}>
                      <Pencil size={14} /> {isVi ? 'Sửa SL' : 'Adjust'}
                    </button>
                  </>
                )}

                {canEdit && selectedItem.status === 'APPROVED' && (
                  <button
                    className="rep-btn rep-btn-outline w-full justify-center"
                    style={{ color: '#dc2626', borderColor: '#fecaca', padding: '0.625rem', width: '100%' }}
                    onClick={() => handleOpenCancel(selectedItem)}
                  >
                    <Ban size={15} /> {isVi ? 'Hủy đơn đã duyệt' : 'Cancel Order'}
                  </button>
                )}

                {(!canEdit || (selectedItem.status !== 'PENDING' && selectedItem.status !== 'APPROVED')) && (
                  <button className="drawer-btn-close" onClick={() => setSelectedItem(null)}>
                    {isVi ? 'Đóng' : 'Close'}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL 1: Adjust Quantity */}
      {showAdjustModal &&
        targetRec &&
        createPortal(
          <div className="modal-overlay" onClick={() => setShowAdjustModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowAdjustModal(false)}>
                <X size={16} />
              </button>
              <h2 className="modal-title">{isVi ? 'Điều chỉnh số lượng' : 'Adjust Order Quantity'}</h2>
              <p className="modal-subtitle">
                {targetRec.item_id} &bull; {targetRec.store_id}
              </p>

              <form onSubmit={handleSubmitAdjust}>
                <div className="modal-form-group">
                  <label>{isVi ? 'Thông số (R, s, S)' : '(R, s, S) Parameters'}</label>
                  <input
                    type="text"
                    disabled
                    value={(() => {
                      const m = computeRssMetrics(targetRec);
                      return `q = ${formatQty(m.recommendedQty, localeStr)} (IP: ${m.ip}, s: ${m.s}, S: ${m.bigS})`;
                    })()}
                    className="modal-input"
                    style={{ background: '#f1f5f9', color: '#475569', fontFamily: "'IBM Plex Mono', monospace" }}
                  />
                </div>

                <div className="modal-form-group">
                  <label>{isVi ? 'Số lượng chốt (Final Qty) *' : 'Final Quantity *'}</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={adjustQtyInput}
                    onChange={(e) => setAdjustQtyInput(Number(e.target.value))}
                    className="modal-input"
                    autoFocus
                  />
                </div>

                <div className="modal-form-group">
                  <label>{isVi ? 'Lý do điều chỉnh *' : 'Reason *'}</label>
                  <textarea
                    required
                    rows={2}
                    value={actionReasonInput}
                    onChange={(e) => setActionReasonInput(e.target.value)}
                    className="modal-input"
                  />
                </div>

                <div className="modal-actions">
                  <button
                    type="button"
                    className="modal-btn-cancel"
                    onClick={() => setShowAdjustModal(false)}
                    disabled={isSubmittingAction}
                  >
                    {isVi ? 'Hủy' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    className="modal-btn-apply"
                    disabled={isSubmittingAction || adjustQtyInput <= 0 || !actionReasonInput.trim()}
                  >
                    {isSubmittingAction ? '...' : isVi ? 'Lưu' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL 2: Reject */}
      {showRejectModal &&
        targetRec &&
        createPortal(
          <div className="modal-overlay" onClick={() => setShowRejectModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowRejectModal(false)}>
                <X size={16} />
              </button>
              <h2 className="modal-title" style={{ color: '#dc2626' }}>
                {isVi ? 'Từ chối đề xuất' : 'Reject Recommendation'}
              </h2>
              <p className="modal-subtitle">
                {targetRec.item_id} &bull; {targetRec.store_id}
              </p>

              <form onSubmit={handleSubmitReject}>
                <div className="modal-form-group">
                  <label>{isVi ? 'Lý do từ chối *' : 'Reason *'}</label>
                  <textarea
                    required
                    rows={2}
                    value={actionReasonInput}
                    onChange={(e) => setActionReasonInput(e.target.value)}
                    className="modal-input"
                    autoFocus
                  />
                </div>

                <div className="modal-actions">
                  <button
                    type="button"
                    className="modal-btn-cancel"
                    onClick={() => setShowRejectModal(false)}
                    disabled={isSubmittingAction}
                  >
                    {isVi ? 'Hủy' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    style={{
                      backgroundColor: '#dc2626',
                      color: '#fff',
                      border: 'none',
                      padding: '0.5rem 1.15rem',
                      borderRadius: '4px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: '0.8125rem',
                    }}
                    disabled={isSubmittingAction || !actionReasonInput.trim()}
                  >
                    {isSubmittingAction ? '...' : isVi ? 'Từ chối' : 'Reject'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL 3: Cancel */}
      {showCancelModal &&
        targetRec &&
        createPortal(
          <div className="modal-overlay" onClick={() => setShowCancelModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowCancelModal(false)}>
                <X size={16} />
              </button>
              <h2 className="modal-title" style={{ color: '#dc2626' }}>
                {isVi ? 'Hủy đơn đã duyệt' : 'Cancel Approved PO'}
              </h2>
              <p className="modal-subtitle">
                {targetRec.item_id} ({formatQty(targetRec.final_qty, localeStr)} {isVi ? 'đv' : 'units'})
              </p>

              <form onSubmit={handleSubmitCancel}>
                <div className="modal-form-group">
                  <label>{isVi ? 'Lý do hủy *' : 'Reason *'}</label>
                  <textarea
                    required
                    rows={2}
                    value={actionReasonInput}
                    onChange={(e) => setActionReasonInput(e.target.value)}
                    className="modal-input"
                    autoFocus
                  />
                </div>

                <div className="modal-actions">
                  <button
                    type="button"
                    className="modal-btn-cancel"
                    onClick={() => setShowCancelModal(false)}
                    disabled={isSubmittingAction}
                  >
                    {isVi ? 'Đóng' : 'Close'}
                  </button>
                  <button
                    type="submit"
                    style={{
                      backgroundColor: '#dc2626',
                      color: '#fff',
                      border: 'none',
                      padding: '0.5rem 1.15rem',
                      borderRadius: '4px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: '0.8125rem',
                    }}
                    disabled={isSubmittingAction || !actionReasonInput.trim()}
                  >
                    {isSubmittingAction ? '...' : isVi ? 'Xác nhận hủy' : 'Confirm Cancel'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
