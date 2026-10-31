import { apiClient } from './apiClient.ts';

const unwrapItems = (data: any) => Array.isArray(data) ? data : data?.items || [];

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry<any>>();

const getSessionCache = <T>(key: string): CacheEntry<T> | null => {
  try {
    const raw = sessionStorage.getItem(`dfios_${key}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
};

const setSessionCache = <T>(key: string, entry: CacheEntry<T>) => {
  try {
    const json = JSON.stringify(entry);
    if (json.length < 1800000) {
      sessionStorage.setItem(`dfios_${key}`, json);
    }
  } catch {}
};

const inflightRequests = new Map<string, Promise<any>>();

export const clearApiCache = (pattern?: string) => {
  inflightRequests.clear();
  if (!pattern) {
    memoryCache.clear();
    try {
      Object.keys(sessionStorage).forEach(k => {
        if (k.startsWith('dfios_')) sessionStorage.removeItem(k);
      });
    } catch {}
  } else {
    for (const key of memoryCache.keys()) {
      if (key.includes(pattern)) {
        memoryCache.delete(key);
      }
    }
    try {
      Object.keys(sessionStorage).forEach(k => {
        if (k.startsWith('dfios_') && k.includes(pattern)) sessionStorage.removeItem(k);
      });
    } catch {}
  }
};

export const cachedGet = async <T = any>(
  url: string,
  params?: any,
  ttlMs: number = 300000 // 5 minutes default
): Promise<T> => {
  const cacheKey = `${url}:${JSON.stringify(params || {})}`;
  const now = Date.now();

  let entry = memoryCache.get(cacheKey) || getSessionCache<T>(cacheKey);

  if (entry) {
    memoryCache.set(cacheKey, entry);
    // Fresh cache hit -> instant 0ms return
    if (now - entry.timestamp < ttlMs) {
      return entry.data;
    }
    // Stale-While-Revalidate: return immediately so UI never blocks, then refresh in background
    if (!inflightRequests.has(cacheKey)) {
      const bgPromise = apiClient.get(url, { params }).then((res) => {
        const updated = { data: res.data, timestamp: Date.now() };
        memoryCache.set(cacheKey, updated);
        setSessionCache(cacheKey, updated);
        return res.data;
      }).catch(() => {}).finally(() => {
        inflightRequests.delete(cacheKey);
      });
      inflightRequests.set(cacheKey, bgPromise);
    }

    return entry.data;
  }

  // In-flight deduplication: return existing promise if another component already requested this URL
  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey)!;
  }

  const fetchPromise = (async () => {
    try {
      const res = await apiClient.get(url, { params });
      const newEntry = { data: res.data, timestamp: Date.now() };
      memoryCache.set(cacheKey, newEntry);
      setSessionCache(cacheKey, newEntry);
      return res.data;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  })();

  inflightRequests.set(cacheKey, fetchPromise);
  return fetchPromise;
};

export const prefetchRouteData = (route: string) => {
  try {
    switch (route) {
      case '/':
      case '/dashboard':
        cachedGet('/dashboard/overview', { store_id: 'CA_1' }, 120000).catch(() => {});
        cachedGet('/dashboard/alerts', { store_id: 'CA_1', limit: 10 }, 120000).catch(() => {});
        break;
      case '/forecast-explorer':
        cachedGet('/products/categories', null, 300000).catch(() => {});
        cachedGet('/inventory/stores', null, 600000).catch(() => {});
        cachedGet('/products', { limit: 50 }, 120000).catch(() => {});
        cachedGet('/forecasts', { item_id: 'FOODS_1_001', horizon: 28, store_id: 'CA_1' }, 180000).catch(() => {});
        break;
      case '/replenishment':
        cachedGet('/replenishments', { store_id: 'CA_1', skip: 0, limit: 10, auto_generate: false }, 30000).catch(() => {});
        break;
      case '/abc-xyz':
        cachedGet('/classification/matrix', null, 60000).catch(() => {});
        cachedGet('/classification/thresholds', null, 60000).catch(() => {});
        cachedGet('/classification/skus', { skip: 0, limit: 15 }, 30000).catch(() => {});
        break;
      case '/reports':
        cachedGet('/reports/forecast-accuracy', { store_id: 'CA_1' }, 60000).catch(() => {});
        break;
      case '/model-performance':
        cachedGet('/ml/models', null, 60000).catch(() => {});
        cachedGet('/ml/train', { limit: 20 }, 30000).catch(() => {});
        break;
      case '/products':
        cachedGet('/products', { limit: 50 }, 120000).catch(() => {});
        cachedGet('/suppliers', { limit: 50 }, 60000).catch(() => {});
        break;
      default:
        break;
    }
  } catch {}
};

export const fetchAllPages = async <T = any>(
  url: string,
  batchSize: number = 500,
  baseParams: Record<string, any> = {},
  ttlMs: number = 600000, // 10 minutes default
  onInitialBatch?: (initial: { list: T[]; total: number }) => void
): Promise<{ list: T[]; total: number; [key: string]: any }> => {
  const fullCacheKey = `fetchAll:${url}:${JSON.stringify(baseParams || {})}`;
  const now = Date.now();

  let cached = memoryCache.get(fullCacheKey) || getSessionCache<{ list: T[]; total: number }>(fullCacheKey);

  if (cached) {
    memoryCache.set(fullCacheKey, cached);
    if (onInitialBatch) {
      onInitialBatch(cached.data);
    }
    if (now - cached.timestamp < ttlMs) {
      return cached.data;
    }
    // Background revalidation
    setTimeout(() => {
      fetchAllPages(url, batchSize, baseParams, ttlMs).catch(() => {});
    }, 150);
    return cached.data;
  }

  // 1. Fetch initial chunk to discover total count and retrieve first batch
  const firstRes = await cachedGet(url, { ...baseParams, skip: 0, limit: batchSize }, ttlMs);
  const firstItems: T[] = Array.isArray(firstRes) ? firstRes : (firstRes?.items || firstRes?.list || firstRes?.logs || []);
  const total = typeof firstRes?.total === 'number' ? firstRes.total : firstItems.length;

  const initialResult = {
    ...firstRes,
    list: firstItems,
    total,
  };

  // Immediate notification so page can render Page 1 in ~500ms
  if (onInitialBatch) {
    onInitialBatch(initialResult);
  }

  if (total <= batchSize || firstItems.length >= total) {
    const entry = { data: initialResult, timestamp: now };
    memoryCache.set(fullCacheKey, entry);
    setSessionCache(fullCacheKey, entry);
    return initialResult;
  }

  // 2. Fetch all subsequent chunks simultaneously in parallel
  const totalBatches = Math.ceil(total / batchSize);
  const remainingPromises: Promise<any>[] = [];

  for (let b = 1; b < totalBatches; b++) {
    const skip = b * batchSize;
    remainingPromises.push(
      cachedGet(url, { ...baseParams, skip, limit: batchSize }, ttlMs).catch((err) => {
        console.warn(`[fetchAllPages] Error fetching batch skip=${skip} for ${url}:`, err);
        return { items: [], list: [], logs: [] };
      })
    );
  }

  const remainingResponses = await Promise.all(remainingPromises);
  const allItems: T[] = [...firstItems];

  for (const r of remainingResponses) {
    const items: T[] = Array.isArray(r) ? r : (r?.items || r?.list || r?.logs || []);
    allItems.push(...items);
  }

  const finalResult = {
    ...firstRes,
    list: allItems,
    total: Math.max(total, allItems.length),
  };

  const finalEntry = { data: finalResult, timestamp: now };
  memoryCache.set(fullCacheKey, finalEntry);
  setSessionCache(fullCacheKey, finalEntry);
  return finalResult;
};

export const api = {
  auth: {
    login: async (credentials: any) => {
      clearApiCache();
      const res = await apiClient.post('/auth/login', credentials);
      return res.data;
    },
    logout: async () => {
      clearApiCache();
      const res = await apiClient.post('/auth/logout');
      return res.data;
    },
    getMe: async () => {
      const res = await apiClient.get('/auth/me');
      return res.data;
    },
    updateProfile: async (data: { display_name?: string; email?: string }) => {
      const res = await apiClient.put('/auth/profile', data);
      return res.data;
    },
    changePassword: async (data: { old_password: string; new_password: string }) => {
      const res = await apiClient.post('/auth/change-password', data);
      return res.data;
    },
    requestChangeEmail: async (data: { new_email: string; current_password: string }) => {
      const res = await apiClient.post('/auth/me/email', data);
      return res.data;
    },
    confirmChangeEmail: async (data: { token: string }) => {
      const res = await apiClient.post('/auth/me/email/confirm', data);
      return res.data;
    },
    forgotPassword: async (data: { email: string }) => {
      const res = await apiClient.post('/auth/forgot-password', data);
      return res.data;
    },
    resetPassword: async (data: { token: string; new_password: string }) => {
      const res = await apiClient.post('/auth/reset-password', data);
      return res.data;
    },
    activate: async (data: { token: string; password: string }) => {
      const res = await apiClient.post('/auth/activate', data);
      return res.data;
    },
  },

  dashboard: {
    getOverview: async (storeId?: string) => {
      try {
        const res = await cachedGet('/dashboard/overview', storeId ? { store_id: storeId } : {}, 60000);
        if (res && res.kpis) {
          return res;
        }
      } catch (err) {
        console.warn('Native dashboard overview error, querying individual endpoints', err);
      }

      // Fallback query to individual BE endpoints - strictly real DB records without synthetic data
      const [kpisRes, trendRes, alertsRes] = await Promise.all([
        cachedGet('/dashboard/kpis', storeId ? { store_id: storeId } : {}, 60000).catch(() => null),
        cachedGet('/dashboard/demand-trend', { store_id: storeId, days: 30 }, 60000).catch(() => null),
        cachedGet('/dashboard/alerts', { store_id: storeId, limit: 10 }, 60000).catch(() => null),
      ]);

      return {
        kpis: {
          totalSkus: kpisRes?.total_skus ?? 0,
          totalSuppliers: kpisRes?.total_suppliers ?? 0,
          reorderAlerts: kpisRes?.reorder_alerts_count ?? 0,
          avgForecastAccuracy: kpisRes?.avg_forecast_accuracy ?? 'N/A',
          stockoutRate: kpisRes?.stockout_rate != null ? `${kpisRes.stockout_rate}%` : '0.0%',
          totalInventoryValue: kpisRes?.total_inventory_value ?? 0,
          pendingReplenishments: kpisRes?.pending_replenishments_count ?? 0,
        },
        charts: {
          forecastTrend: (trendRes?.data || []).map((p: any) => ({
            date: p.date,
            actual: p.actual ?? null,
            lightgbm: p.predicted != null ? p.predicted : p.actual,
          })),
          inventoryHealth: alertsRes?.summary ? [
            { name: 'Healthy In Stock', value: alertsRes.summary.healthy_count || 0, color: '#0d9488' },
            { name: 'Low Stock', value: alertsRes.summary.warning_count || 0, color: '#f59e0b' },
            { name: 'Critical / Out', value: alertsRes.summary.critical_count || 0, color: '#ef4444' },
          ].filter((x: any) => x.value > 0) : [],
          urgency: (alertsRes?.items || []).slice(0, 5).map((it: any) => ({
            sku: it.item_id,
            name: it.product_name,
            urgency: it.on_hand <= 0 ? 100 : Math.max(15, Math.min(95, Math.round(100 - (it.on_hand / Math.max(1, it.reorder_point) * 50)))),
            color: it.severity === 'CRITICAL' ? '#ef4444' : it.severity === 'WARNING' ? '#f59e0b' : '#0d9488',
          })),
        },
        recentAlerts: (alertsRes?.items || []).slice(0, 6).map((it: any) => ({
          status: it.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
          statusClass: it.severity === 'CRITICAL' ? 'danger' : 'warning',
          name: it.item_id,
          location: it.store_id || 'Warehouse',
          details: `${it.product_name} - On-Hand: ${it.on_hand} (ROP: ${it.reorder_point})`,
          actionText: 'Inspect',
        })),
      };
    },
    getKpis: async (storeId?: string) => {
      return cachedGet('/dashboard/kpis', storeId ? { store_id: storeId } : {}, 60000);
    },
    getDemandTrend: async (params?: { store_id?: string; category?: string; days?: number; granularity?: string }) => {
      return cachedGet('/dashboard/demand-trend', params, 60000);
    },
    getAlerts: async (params?: { store_id?: string; severity?: string; limit?: number; offset?: number }) => {
      return cachedGet('/dashboard/alerts', params, 30000);
    },
    triggerRealtimeAlerts: async (storeId?: string) => {
      clearApiCache('/dashboard');
      const res = await apiClient.post('/dashboard/check-alerts', null, { params: storeId ? { store_id: storeId } : {} });
      return res.data;
    },
  },

  forecasting: {
    getForecasts: async (params?: any) => {
      const res = await cachedGet('/forecasts', params, 30000);
      return {
        list: unwrapItems(res),
        total: res?.total || 0,
        model_version: res?.model_version,
      };
    },
    getHistory: async (sku: string, params?: { store_id?: string; start_date?: string; end_date?: string; granularity?: string }) => {
      return cachedGet(`/forecasts/${sku}/history`, params, 60000);
    },
    compare: async (sku: string, params?: { store_id?: string; start_date?: string; end_date?: string }) => {
      return cachedGet(`/forecasts/${sku}/compare`, params, 60000);
    },
    getUncertainty: async (sku: string, params?: { store_id?: string; horizon?: number }) => {
      return cachedGet(`/forecasts/${sku}/uncertainty`, params, 60000);
    },
    getExplanation: async (sku: string, params?: { store_id?: string; model_version?: string; model_name?: string }) => {
      return cachedGet(`/forecasts/${sku}/explanation`, params, 60000);
    },
    createOverride: async (sku: string, data: { forecast_date: string; override_value: number; reason: string; store_id?: string; horizon?: number }) => {
      clearApiCache('/forecasts');
      clearApiCache('dashboard');
      const res = await apiClient.post(`/forecasts/${sku}/override`, data);
      return res.data;
    },
    bulkOverride: async (items: Array<{ store_id?: string; item_id: string; date: string; value: number; reason: string }>) => {
      clearApiCache('/forecasts');
      clearApiCache('dashboard');
      const normalizedItems = items.map(it => ({
        store_id: it.store_id || 'CA_1',
        item_id: it.item_id,
        date: it.date,
        value: Number(it.value),
        reason: it.reason,
      }));
      const res = await apiClient.post('/forecasts/bulk-override', { items: normalizedItems });
      return res.data;
    },
    revertOverride: async (sku: string, overrideId: string) => {
      clearApiCache('/forecasts');
      clearApiCache('dashboard');
      const res = await apiClient.delete(`/forecasts/${sku}/override/${overrideId}`);
      return res.data;
    },
    getOverrides: async (sku: string, params?: { store_id?: string }) => {
      const res = await cachedGet(`/forecasts/${sku}/overrides`, params, 30000);
      return Array.isArray(res) ? res : [];
    },
    getExplorerData: async (skuParam?: string, horizon: number = 28, storeId?: string) => {
      try {
        let sku = skuParam;
        if (!sku) {
          const prodRes = await cachedGet('/products', { limit: 1 }, 300000);
          const items = unwrapItems(prodRes);
          sku = items[0]?.item_id || 'FOODS_1_001';
        }

        const [forecastsRes, compareRes, uncertaintyRes, historyRes] = await Promise.all([
          cachedGet('/forecasts', { item_id: sku, horizon, store_id: storeId, limit: horizon }, 60000).catch(() => ({ items: [] })),
          cachedGet(`/forecasts/${sku}/compare`, { store_id: storeId }, 60000).catch(() => null),
          cachedGet(`/forecasts/${sku}/uncertainty`, { store_id: storeId, horizon }, 60000).catch(() => null),
          cachedGet(`/forecasts/${sku}/history`, { store_id: storeId, granularity: 'daily' }, 60000).catch(() => null),
        ]);

        const forecastItems = unwrapItems(forecastsRes);
        const historyPoints = historyRes?.data_points || [];

        // Build uncertainty lookup map by forecast date
        const uncPoints = Array.isArray(uncertaintyRes?.points) ? uncertaintyRes.points : [];
        const uncMap = new Map<string, any>(uncPoints.map((u: any) => [u.forecast_date, u]));

        let chartData: any[] = [];
        if (forecastItems.length > 0 || historyPoints.length > 0) {
          const recentHistory = historyPoints.slice(-14);
          recentHistory.forEach((h: any) => {
            chartData.push({
              date: h.date,
              actual: h.quantity,
              forecast: null,
              lower: null,
              upper: null,
            });
          });

          forecastItems.forEach((f: any) => {
            const unc = uncMap.get(f.forecast_date);
            const lower = unc?.p10 != null ? Math.round(unc.p10) : (f.p10 != null ? Math.round(f.p10) : null);
            const upper = unc?.p90 != null ? Math.round(unc.p90) : (f.p90 != null ? Math.round(f.p90) : null);
            chartData.push({
              date: f.forecast_date,
              actual: f.y_actual ?? null,
              forecast: f.y_pred != null ? Math.round(f.y_pred) : null,
              lower,
              upper,
            });
          });
        }

        const totalPredicted = forecastItems.reduce((acc: number, f: any) => acc + (f.y_pred || 0), 0);
        const uncertainty = uncertaintyRes;

        let ciSpread = '-';
        if (uncertainty?.error_distribution?.mean && uncertainty?.error_distribution?.p90 != null && uncertainty?.error_distribution?.p10 != null) {
          const spreadPct = Math.round(((uncertainty.error_distribution.p90 - uncertainty.error_distribution.p10) / Math.max(1, uncertainty.error_distribution.mean)) * 50);
          ciSpread = `±${spreadPct}%`;
        }

        return {
          sku,
          chartData,
          stats: {
            predictedDemand: totalPredicted > 0 ? `${Math.round(totalPredicted).toLocaleString()} units` : '-',
            safetyStock: uncertainty?.sigma_h != null ? `${Math.round(uncertainty.sigma_h * 1.65)} units` : '-',
            reorderPoint: uncertainty?.sigma_h != null ? `${Math.round(uncertainty.sigma_h * 1.65 + (totalPredicted / (horizon || 28)) * 3)} units` : '-',
            mase: compareRes?.metrics?.mae != null ? (compareRes.metrics.mae).toFixed(2) : '-',
            ci: ciSpread,
          },
          scheduleMatrix: forecastItems.length > 0
            ? forecastItems.slice(0, 14).map((f: any) => {
                const unc = uncMap.get(f.forecast_date);
                const lower = unc?.p10 != null ? Math.round(unc.p10) : (f.p10 != null ? Math.round(f.p10) : null);
                const upper = unc?.p90 != null ? Math.round(unc.p90) : (f.p90 != null ? Math.round(f.p90) : null);
                return {
                  date: f.forecast_date,
                  demand: f.y_pred != null ? Math.round(f.y_pred) : 0,
                  lower,
                  upper,
                  spike: (f.y_pred > 60) ? 'Med' : 'Low',
                  spikeColor: (f.y_pred > 60) ? 'text-orange' : 'text-teal',
                };
              })
            : [],
        };
      } catch (err) {
        console.error('getExplorerData error', err);
        return {
          sku: skuParam || 'FOODS_1_001',
          chartData: [],
          stats: { predictedDemand: '-', safetyStock: '-', reorderPoint: '-', mase: '-', ci: '-' },
          scheduleMatrix: [],
        };
      }
    },
  },

  classification: {
    getThresholds: async () => {
      return cachedGet('/classification/thresholds', null, 60000);
    },
    updateThresholds: async (data: { a_cutoff?: number; b_cutoff?: number; c_cutoff?: number; cv_x?: number; cv_y?: number }) => {
      clearApiCache('/classification');
      const res = await apiClient.put('/classification/thresholds', data);
      return res.data;
    },
    recompute: async () => {
      clearApiCache('/classification');
      const res = await apiClient.post('/classification/recompute');
      return res.data;
    },
    getMatrix: async () => {
      return cachedGet('/classification/matrix', null, 60000);
    },
    getSkus: async (params?: { abc?: string; xyz?: string; segment?: string; search?: string; category?: string; skip?: number; limit?: number; sort_by?: string; order?: string }) => {
      const res = await cachedGet('/classification/skus', params, 30000);
      return {
        list: unwrapItems(res),
        total: res?.total || 0,
        summary: res?.summary,
      };
    },
    getAllSkus: async (params?: any) => {
      const res = await fetchAllPages('/classification/skus', 500, params, 30000);
      return {
        list: res.list || [],
        total: res.total || 0,
        summary: res.summary,
      };
    },
    getRecommendations: async () => {
      return cachedGet('/classification/recommendations', null, 120000);
    },
    getRecommendation: async (segment: string) => {
      return cachedGet(`/classification/recommendations/${segment}`, null, 120000);
    },
  },

  inventory: {
    getInventory: async (params?: any) => {
      const res = await cachedGet('/inventory', params, 15000);
      return { list: unwrapItems(res), total: res?.total || 0 };
    },
    getAllInventory: async (params?: any, onInitialBatch?: (res: any) => void) => {
      const mergedParams = { store_id: 'CA_1', ...params };
      const res = await fetchAllPages('/inventory', 500, mergedParams, 300000, onInitialBatch);
      return { list: res.list || [], total: res.total || 0 };
    },
    getStores: async () => {
      return cachedGet('/inventory/stores', null, 600000);
    },
    getItem: async (itemId: string, storeId: string) => {
      return cachedGet(`/inventory/${itemId}/${storeId}`, null, 120000);
    },
    updateInventory: async (itemId: string, storeId: string, data: { on_hand?: number; on_order?: number; reason?: string }) => {
      clearApiCache('/inventory');
      clearApiCache('dashboard');
      const res = await apiClient.put(`/inventory/${itemId}/${storeId}`, data);
      return res.data;
    },
    getAdjustments: async (params?: any) => {
      const res = await cachedGet('/inventory/history', params, 60000);
      return { list: unwrapItems(res), total: res?.total || 0 };
    },
    getAllAdjustments: async (params?: any) => {
      const res = await fetchAllPages('/inventory/history', 500, params, 120000);
      return { list: res.list || [], total: res.total || 0 };
    },
    getProducts: async (params?: any) => {
      const res = await cachedGet('/products', { limit: 100, ...params }, 120000);
      return { list: unwrapItems(res), total: res?.total || 0 };
    },
    getAllProducts: async (params?: any, onInitialBatch?: (res: any) => void) => {
      const res = await fetchAllPages('/products', 500, params, 600000, onInitialBatch);
      return { list: res.list || [], total: res.total || 0 };
    },
    getReplenishmentDashboard: async () => {
      const res = await cachedGet('/inventory', { limit: 100, store_id: 'CA_1' }, 120000);
      const items = unwrapItems(res);
      return { items, total: res.total || items.length };
    },
    getReplenishmentAlerts: async () => {
      const res = await cachedGet('/inventory', { limit: 25, store_id: 'CA_1' }, 180000);
      const items = unwrapItems(res);
      const lowItems = items.filter((x: any) => (x.on_hand ?? 0) <= 15);
      return {
        alerts: lowItems.map((x: any) => ({
          id: x.item_id,
          name: x.name || x.item_id,
          store: x.store_id || 'CA_1',
          stock: x.on_hand ?? 0,
          rop: x.reorder_point ?? 25,
          status: (x.on_hand ?? 0) <= 0 ? 'CRITICAL' : 'WARNING',
        })),
      };
    },
  },

  replenishment: {
    listRecommendations: async (params?: {
      skip?: number;
      limit?: number;
      store_id?: string;
      status?: string;
      priority?: string;
      search?: string;
      item_id?: string;
      auto_generate?: boolean;
    }) => {
      const res = await cachedGet('/replenishments', params, 15000);
      return {
        items: res?.items || [],
        total: res?.total || 0,
        skip: res?.skip || 0,
        limit: res?.limit || 50,
        pending_count: res?.pending_count || 0,
        approved_count: res?.approved_count || 0,
      };
    },
    generateRecommendations: async (storeId: string = 'CA_1') => {
      clearApiCache('/replenishments');
      clearApiCache('/dashboard');
      clearApiCache('/inventory');
      const res = await apiClient.post('/replenishments/generate', null, { params: { store_id: storeId } });
      return res.data;
    },
    listHistory: async (params?: {
      skip?: number;
      limit?: number;
      store_id?: string;
      item_id?: string;
      status?: string;
      start_date?: string;
      end_date?: string;
    }) => {
      const res = await cachedGet('/replenishments/history', params, 20000);
      return {
        items: res?.items || [],
        total: res?.total || 0,
        skip: res?.skip || 0,
        limit: res?.limit || 50,
        pending_count: res?.pending_count || 0,
        approved_count: res?.approved_count || 0,
      };
    },
    adjustQuantity: async (recId: string, data: { final_qty: number; reason: string }) => {
      clearApiCache('/replenishments');
      clearApiCache('/dashboard');
      const res = await apiClient.put(`/replenishments/${recId}/adjust`, data);
      return res.data;
    },
    approve: async (recId: string) => {
      clearApiCache('/replenishments');
      clearApiCache('/inventory');
      clearApiCache('/dashboard');
      const res = await apiClient.post(`/replenishments/${recId}/approve`);
      return res.data;
    },
    reject: async (recId: string, data?: { reason?: string }) => {
      clearApiCache('/replenishments');
      clearApiCache('/dashboard');
      const res = await apiClient.post(`/replenishments/${recId}/reject`, data || { reason: 'Rejected by manager' });
      return res.data;
    },
    cancel: async (recId: string, data: { reason: string }) => {
      clearApiCache('/replenishments');
      clearApiCache('/inventory');
      clearApiCache('/dashboard');
      const res = await apiClient.post(`/replenishments/${recId}/cancel`, data);
      return res.data;
    },
    downloadCsv: async (storeId?: string, status?: string) => {
      const res = await apiClient.get('/replenishments/export', {
        params: { store_id: storeId, status },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `replenishment_recommendations_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
  },

  products: {
    getProducts: async (params?: any) => {
      const res = await cachedGet('/products', params, 120000);
      return { list: unwrapItems(res), total: res?.total || 0 };
    },
    getAllProducts: async (params?: any, onInitialBatch?: (res: any) => void) => {
      const res = await fetchAllPages('/products', 500, params, 600000, onInitialBatch);
      return { list: res.list || [], total: res.total || 0 };
    },
    getProduct: async (id: string) => {
      return cachedGet(`/products/${id}`, null, 60000);
    },
    createProduct: async (data: { item_id: string; name: string; dept_id?: string; cat_id?: string }) => {
      clearApiCache('/products');
      clearApiCache('dashboard');
      const res = await apiClient.post('/products', data);
      return res.data;
    },
    updateProduct: async (id: string, data: { name?: string; dept_id?: string; cat_id?: string }) => {
      clearApiCache('/products');
      clearApiCache('dashboard');
      const res = await apiClient.put(`/products/${id}`, data);
      return res.data;
    },
    deleteProduct: async (id: string) => {
      clearApiCache('/products');
      clearApiCache('dashboard');
      const res = await apiClient.delete(`/products/${id}`);
      return res.data;
    },
    bulkCreate: async (items: Array<{ item_id: string; name: string; dept_id?: string; cat_id?: string }>) => {
      clearApiCache('/products');
      clearApiCache('dashboard');
      const res = await apiClient.post('/products/bulk', { items });
      return res.data;
    },
    getCategories: async () => {
      return cachedGet('/products/categories', null, 300000);
    },
    getDepartments: async () => {
      return cachedGet('/products/departments', null, 300000);
    },
    getSuppliers: async (params?: any) => {
      const res = await cachedGet('/suppliers', params, 30000);
      return { list: unwrapItems(res), total: res?.total || 0 };
    },
    getAllSuppliers: async (params?: any) => {
      const res = await fetchAllPages('/suppliers', 500, params, 30000);
      return { list: res.list || [], total: res.total || 0 };
    },
    getSupplier: async (id: string) => {
      return cachedGet(`/suppliers/${id}`, null, 60000);
    },
    createSupplier: async (data: { name: string; lead_time_days: number; id?: string; contact_name?: string | null; email?: string | null; phone?: string | null; address?: string | null }) => {
      clearApiCache('/suppliers');
      clearApiCache('dashboard');
      const res = await apiClient.post('/suppliers', data);
      return res.data;
    },
    updateSupplier: async (id: string, data: { name?: string; lead_time_days?: number; contact_name?: string | null; email?: string | null; phone?: string | null; address?: string | null }) => {
      clearApiCache('/suppliers');
      clearApiCache('dashboard');
      const res = await apiClient.put(`/suppliers/${id}`, data);
      return res.data;
    },
    deleteSupplier: async (id: string) => {
      clearApiCache('/suppliers');
      clearApiCache('dashboard');
      const res = await apiClient.delete(`/suppliers/${id}`);
      return res.data;
    },
    uploadDataFile: async (file: File) => {
      clearApiCache('/products');
      clearApiCache('dashboard');
      const text = await file.text();
      let items: any[] = [];
      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(text);
        items = Array.isArray(parsed) ? parsed : (parsed.items || []);
      } else {
        const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length > 1) {
          const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
          const itemIdIdx = headers.findIndex(h => h.includes('item') || h.includes('sku') || h.includes('id'));
          const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('title'));
          const deptIdx = headers.findIndex(h => h.includes('dept') || h.includes('department'));
          const catIdx = headers.findIndex(h => h.includes('cat') || h.includes('category'));

          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
            if (cols.length >= 2) {
              items.push({
                item_id: cols[itemIdIdx !== -1 ? itemIdIdx : 0] || `SKU-${Date.now()}-${i}`,
                name: cols[nameIdx !== -1 ? nameIdx : 1] || `Product ${i}`,
                dept_id: deptIdx !== -1 ? cols[deptIdx] : undefined,
                cat_id: catIdx !== -1 ? cols[catIdx] : undefined,
              });
            }
          }
        }
      }

      if (items.length === 0) {
        throw new Error('No valid records found in file. CSV header should contain item_id, name.');
      }

      const res = await apiClient.post('/products/bulk', { items });
      return res.data;
    },
    publishTestEvent: async (skuId: string) => {
      const res = await apiClient.post('/events/publish-test', null, { params: { sku_id: skuId } });
      return res.data;
    },
  },

  sales: {
    querySales: async (params?: { skip?: number; limit?: number; item_id?: string; store_id?: string; start_date?: string; end_date?: string }) => {
      const res = await cachedGet('/sales', params, 20000);
      return {
        list: unwrapItems(res),
        total: res?.total || 0,
        total_quantity: res?.total_quantity || 0,
        average_quantity: res?.average_quantity || 0,
      };
    },
    queryAllSales: async (params?: { item_id?: string; store_id?: string; start_date?: string; end_date?: string }) => {
      const res = await fetchAllPages('/sales', 500, params, 20000);
      return {
        list: res.list || [],
        total: res.total || 0,
        total_quantity: res.total_quantity || 0,
        average_quantity: res.average_quantity || 0,
      };
    },
    getSummary: async (params?: { item_id?: string; store_id?: string }) => {
      return cachedGet('/sales/summary', params, 30000);
    },
    createSale: async (data: { item_id: string; store_id: string; sale_date: string; quantity: number }) => {
      clearApiCache('/sales');
      clearApiCache('dashboard');
      const res = await apiClient.post('/sales', data);
      return res.data;
    },
    importCsv: async (file: File) => {
      clearApiCache('/sales');
      clearApiCache('dashboard');
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post('/sales/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
  },

  eventsCalendar: {
    listEvents: async (params?: { skip?: number; limit?: number; event_type?: string; start_date?: string; end_date?: string; search?: string }) => {
      const res = await cachedGet('/events-calendar', params, 30000);
      return { list: unwrapItems(res), total: res?.total || 0 };
    },
    listAllEvents: async (params?: { event_type?: string; start_date?: string; end_date?: string; search?: string }) => {
      const res = await fetchAllPages('/events-calendar', 500, params, 30000);
      return { list: res.list || [], total: res.total || 0 };
    },
    getTypes: async () => {
      return cachedGet('/events-calendar/types', null, 300000);
    },
    getEvent: async (id: string) => {
      return cachedGet(`/events-calendar/${id}`, null, 60000);
    },
    createEvent: async (data: { event_name: string; event_type?: string; event_date?: string; start_date?: string; end_date?: string; details?: string }) => {
      clearApiCache('/events-calendar');
      const payload = {
        event_name: data.event_name,
        event_date: data.event_date || data.start_date,
        event_type: data.event_type,
        end_date: data.end_date || data.event_date || data.start_date,
        details: data.details,
      };
      const res = await apiClient.post('/events-calendar', payload);
      return res.data;
    },
    updateEvent: async (id: string, data: { event_name?: string; event_type?: string; event_date?: string; start_date?: string; end_date?: string; details?: string }) => {
      clearApiCache('/events-calendar');
      const payload: any = { ...data };
      if (!payload.event_date && payload.start_date) {
        payload.event_date = payload.start_date;
      }
      const res = await apiClient.put(`/events-calendar/${id}`, payload);
      return res.data;
    },
    deleteEvent: async (id: string) => {
      clearApiCache('/events-calendar');
      const res = await apiClient.delete(`/events-calendar/${id}`);
      return res.data;
    },
    bulkCreate: async (items: Array<{ event_name: string; event_type?: string; event_date?: string; start_date?: string; end_date?: string; details?: string }>) => {
      clearApiCache('/events-calendar');
      const normalizedItems = items.map(item => ({
        ...item,
        event_date: item.event_date || item.start_date,
      }));
      const res = await apiClient.post('/events-calendar/bulk', { items: normalizedItems });
      return res.data;
    },
  },

  ml: {
    runDataQuality: async (data?: { cutoff_date?: string }) => {
      const res = await apiClient.post('/ml/data-quality/run', data || {});
      return res.data;
    },
    getDataQualityRun: async (runId: string) => {
      const res = await apiClient.get(`/ml/data-quality/${runId}`);
      return res.data;
    },
    listDataQualityRuns: async (params?: { skip?: number; limit?: number }) => {
      const res = await apiClient.get('/ml/data-quality', { params });
      return { list: unwrapItems(res.data), total: res.data?.total || 0 };
    },
    listAllDataQualityRuns: async (params?: any) => {
      const res = await fetchAllPages('/ml/data-quality', 100, params, 30000);
      return { list: res.list || [], total: res.total || 0 };
    },
    train: async (data: { algorithm: string; sku_list?: string[]; start_date?: string; end_date?: string; test_days?: number; hyperparameters?: any }) => {
      const res = await apiClient.post('/ml/train', data);
      return res.data;
    },
    getTrainJob: async (jobId: string) => {
      const res = await apiClient.get(`/ml/train/${jobId}`);
      return res.data;
    },
    listTrainJobs: async (params?: { skip?: number; limit?: number }) => {
      const res = await apiClient.get('/ml/train', { params });
      return { list: unwrapItems(res.data), total: res.data?.total || 0 };
    },
    listAllTrainJobs: async (params?: any) => {
      const res = await fetchAllPages('/ml/train', 100, params, 30000);
      return { list: res.list || [], total: res.total || 0 };
    },
    getModels: async (params?: { skip?: number; limit?: number; is_production?: boolean; algorithm?: string; scope?: string }) => {
      const res = await apiClient.get('/ml/models', { params });
      return { list: unwrapItems(res.data), total: res.data?.total || 0 };
    },
    getAllModels: async (params?: any) => {
      const res = await fetchAllPages('/ml/models', 100, params, 30000);
      return { list: res.list || [], total: res.total || 0 };
    },
    getModel: async (modelId: string) => {
      const res = await apiClient.get(`/ml/models/${modelId}`);
      return res.data;
    },
    promoteModel: async (modelId: string) => {
      const res = await apiClient.post(`/ml/models/${modelId}/promote`);
      return res.data;
    },
    registerModel: async (data: any) => {
      const res = await apiClient.post('/ml/models', data);
      return res.data;
    },
    createBatchSchedule: async (data: {
      name: string;
      cron_expression?: string;
      model_name?: string;
      horizon?: number;
      store_id?: string;
      auto_trigger_optimization?: boolean;
    }) => {
      const res = await apiClient.post('/ml/schedule', data);
      return res.data;
    },
    listBatchSchedules: async () => {
      const res = await apiClient.get('/ml/schedule');
      return res.data;
    },
    deleteBatchSchedule: async (scheduleId: string) => {
      const res = await apiClient.delete(`/ml/schedule/${scheduleId}`);
      return res.data;
    },
    triggerPipelineRun: async (data: {
      model_name?: string;
      horizon?: number;
      store_id: string;
    }) => {
      clearApiCache();
      const res = await apiClient.post('/ml/pipeline/trigger-run', data);
      return res.data;
    },
  },

  settings: {
    getUsers: async (params?: any) => {
      const res = await apiClient.get('/users', { params });
      return { list: unwrapItems(res.data), total: res.data?.total || 0 };
    },
    getAllUsers: async (params?: any) => {
      const res = await fetchAllPages('/users', 500, params, 20000);
      return { list: res.list || [], total: res.total || 0 };
    },
    getUser: async (id: string) => {
      const res = await apiClient.get(`/users/${id}`);
      return res.data;
    },
    createUser: async (userData: any) => {
      clearApiCache('/users');
      const res = await apiClient.post('/users', userData);
      return res.data;
    },
    updateUser: async (id: string, userData: any) => {
      clearApiCache('/users');
      const res = await apiClient.put(`/users/${id}`, userData);
      return res.data;
    },
    changeUserStatus: async (id: string, is_active: boolean) => {
      clearApiCache('/users');
      const res = await apiClient.patch(`/users/${id}/status`, { is_active });
      return res.data;
    },
    deleteUser: async (id: string) => {
      clearApiCache('/users');
      const res = await apiClient.delete(`/users/${id}`);
      return res.data;
    },
    resendActivation: async (id: string) => {
      const res = await apiClient.post(`/users/${id}/resend-activation`);
      return res.data;
    },
    getAuditActions: async () => {
      const res = await apiClient.get('/audit-logs/actions');
      return res.data || [];
    },
    getAuditLogs: async (params?: Record<string, string>) => {
      const res = await apiClient.get('/audit-logs', { params });
      return { logs: unwrapItems(res.data), total: res.data?.total || 0 };
    },
    getAllAuditLogs: async (params?: any) => {
      const res = await fetchAllPages('/audit-logs', 500, params, 20000);
      return { logs: res.list || [], total: res.total || 0 };
    },
    getSystemSettings: async () => {
      const res = await apiClient.get('/settings');
      return res.data;
    },
    getSystemSetting: async (key: string) => {
      const res = await apiClient.get(`/settings/${key}`);
      return res.data;
    },
    updateSystemSetting: async (key: string, value: any, description?: string) => {
      clearApiCache('/settings');
      const res = await apiClient.put(`/settings/${key}`, { value, description });
      return res.data;
    },
  },

  models: {
    getPerformanceMetrics: async () => {
      try {
        const [modelsRes, compareRes] = await Promise.all([
          apiClient.get('/ml/models').catch(() => ({ data: { items: [] } })),
          apiClient.get('/forecasts/FOODS_1_001/compare').catch(() => ({ data: { comparison: [] } })),
        ]);
        const items = unwrapItems(modelsRes.data);

        const kpis = items.map((m: any) => ({
          id: m.id,
          title: `${m.name || m.algorithm.toUpperCase()} (${m.version || 'v1'})`,
          type: m.is_production ? 'best' : 'challenger',
          isProduction: m.is_production,
          metrics: {
            mase: m.metrics?.mase != null ? Number(m.metrics.mase).toFixed(2) : (m.metrics?.wrmsse != null ? Number(m.metrics.wrmsse).toFixed(2) : '-'),
            rmse: m.metrics?.rmse != null ? Number(m.metrics.rmse).toFixed(1) : '-',
            mae: m.metrics?.mae != null ? Number(m.metrics.mae).toFixed(1) : '-',
            wrmsse: m.metrics?.wrmsse != null ? Number(m.metrics.wrmsse).toFixed(3) : '-',
          },
          algorithm: m.algorithm,
          createdAt: m.created_at,
        }));

        const comparePoints = compareRes.data?.comparison || [];
        const scatterData = comparePoints.map((c: any) => ({
          x: Number(c.actual),
          y: Number(c.predicted),
          fill: '#0d9488',
        }));

        return {
          kpis,
          scatterData,
        };
      } catch (err) {
        console.error('getPerformanceMetrics error', err);
        return {
          kpis: [],
          scatterData: [],
        };
      }
    },
  },

  optimization: {
    getServiceLevel: async () => {
      return cachedGet('/optimization/service-level', null, 60000);
    },
    updateServiceLevel: async (data: { default_service_level?: number; category_service_levels?: Record<string, number>; item_service_levels?: Record<string, number> }) => {
      clearApiCache('/optimization');
      const res = await apiClient.put('/optimization/service-level', data);
      return res.data;
    },
    getParameters: async (params?: { skip?: number; limit?: number; store_id?: string; item_id?: string; category?: string; source?: string }) => {
      const res = await cachedGet('/optimization/parameters', params, 30000);
      return {
        items: unwrapItems(res),
        total: res?.total || 0,
      };
    },
    getAllParameters: async (
      params?: { store_id?: string; item_id?: string; category?: string; source?: string },
      onInitialBatch?: (res: any) => void
    ) => {
      const mergedParams = { store_id: 'CA_1', ...params };
      const res = await fetchAllPages('/optimization/parameters', 200, mergedParams, 300000, onInitialBatch);
      const items = res.list || res.items || [];
      return {
        items,
        list: items,
        total: res.total || items.length,
      };
    },
    recompute: async (data: { store_id?: string; item_id?: string; force_static?: boolean }) => {
      clearApiCache('/optimization');
      clearApiCache('/inventory');
      const res = await apiClient.post('/optimization/recompute', data);
      return res.data;
    },
    compareStatic: async (storeId: string = 'CA_1') => {
      return cachedGet('/optimization/compare-static', { store_id: storeId }, 60000);
    },
    runSensitivityAnalysis: async (data: {
      item_id?: string;
      store_id?: string;
      lead_time_deltas?: number[];
      service_level_deltas?: number[];
      holding_cost_rate?: number;
      stockout_cost_per_unit?: number;
      order_cost?: number;
    }) => {
      const res = await apiClient.post('/optimization/sensitivity-analysis', data);
      return res.data;
    },
  },

  reports: {
    getRecentLogs: async () => {
      const auditRes = await cachedGet('/audit-logs', { limit: 25 }, 180000).catch(() => ({ items: [], list: [], total: 0 }));
      const logList = unwrapItems(auditRes);
      const logs = logList.map((l: any, idx: number) => ({
        name: `Audit_${l.action || 'Report'}_${idx + 1}.csv`,
        type: l.action?.split('.')[0]?.toUpperCase() || 'SYSTEM',
        date: l.created_at ? new Date(l.created_at).toLocaleDateString() : 'Today',
        format: 'CSV',
        formatClass: 'csv',
        size: '24 KB',
        status: 'READY',
        action: 'Download',
      }));

      return {
        templates: [
          { title: 'Forecast Accuracy Analysis (UC39)', desc: 'MAE, RMSE, MASE, WRMSSE split by ABC class & top deviating SKUs', icon: 'TrendingUp', id: 'forecast-accuracy' },
          { title: 'Inventory Turnover & DOS (UC40)', desc: 'Days of Supply, turnover ratios, dead stock, and active inventory valuation', icon: 'Activity', id: 'inventory-performance' },
          { title: 'Historical Backtesting Simulation (UC41)', desc: 'Simulate stockout reduction and service-level achievement over historical periods', icon: 'Settings', id: 'backtest' },
          { title: 'Cost Comparison: ML vs Baseline (UC42)', desc: 'Holding, ordering, and stockout penalty cost analysis across categories', icon: 'Grid', id: 'cost-comparison' },
        ],
        logs: logs,
      };
    },
    getForecastAccuracy: async (params?: {
      model_name?: string;
      start_date?: string;
      end_date?: string;
      store_id?: string;
      abc_class?: string;
    }) => {
      return cachedGet('/reports/forecast-accuracy', params, 60000);
    },
    getInventoryPerformance: async (params?: {
      store_id?: string;
      category?: string;
      limit?: number;
      offset?: number;
    }) => {
      return cachedGet('/reports/inventory-performance', params, 60000);
    },
    runBacktesting: async (data: {
      model_name?: string;
      backtest_days?: number;
      store_id?: string;
      target_service_level?: number;
    }) => {
      const res = await apiClient.post('/reports/backtesting', data);
      return res.data;
    },
    getCostComparison: async (params?: {
      store_id?: string;
      category?: string;
    }) => {
      return cachedGet('/reports/cost-comparison', params, 60000);
    },
    downloadReportCsv: async (reportType: string, storeId?: string) => {
      const res = await apiClient.get('/reports/export', {
        params: { report_type: reportType, store_id: storeId },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${reportType}_report_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
  },
};
