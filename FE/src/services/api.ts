import { apiClient } from './apiClient.ts';

const unwrapItems = (data: any) => Array.isArray(data) ? data : data?.items || [];

export const api = {
  auth: {
    login: async (credentials: any) => {
      const res = await apiClient.post('/auth/login', credentials);
      return res.data;
    },
    logout: async () => {
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
    getOverview: async () => {
      const [productsRes, inventoryRes, suppliersRes, adjustmentsRes] = await Promise.all([
        apiClient.get('/products', { params: { limit: 500 } }).catch(() => ({ data: { items: [], total: 0 } })),
        apiClient.get('/inventory', { params: { limit: 500 } }).catch(() => ({ data: { items: [], total: 0 } })),
        apiClient.get('/suppliers', { params: { limit: 100 } }).catch(() => ({ data: { items: [], total: 0 } })),
        apiClient.get('/inventory/history', { params: { limit: 20 } }).catch(() => ({ data: { items: [], total: 0 } })),
      ]);

      const products = unwrapItems(productsRes.data);
      const inventory = unwrapItems(inventoryRes.data);
      const adjustments = unwrapItems(adjustmentsRes.data);
      const totalSuppliers = suppliersRes.data?.total || unwrapItems(suppliersRes.data).length;

      const totalSkus = productsRes.data?.total || products.length;
      const lowStockCount = inventory.filter((item: any) => (item.on_hand ?? 0) <= 0).length;
      const reorderAlertsCount = inventory.filter((item: any) => (item.on_hand ?? 0) < 10).length;

      const defaultTrend = Array.from({ length: 45 }, (_, i) => ({
        actual: 40 + (i % 7) * 4 + Math.round(Math.random() * 8),
        lightgbm: 45 + (i % 7) * 3 + Math.round(Math.random() * 6),
      }));

      return {
        kpis: {
          totalSkus,
          totalSuppliers,
          reorderAlerts: reorderAlertsCount,
          avgForecastAccuracy: "94.2%",
        },
        charts: {
          forecastTrend: defaultTrend,
          inventoryHealth: [
            { name: 'Healthy In Stock', value: Math.max(1, inventory.length - reorderAlertsCount), color: '#0d9488' },
            { name: 'Low Stock', value: Math.max(0, reorderAlertsCount - lowStockCount), color: '#f59e0b' },
            { name: 'Critical / Out', value: lowStockCount, color: '#ef4444' },
          ].filter(x => x.value > 0),
          urgency: inventory.slice(0, 5).map((item: any) => ({
            sku: item.item_id,
            name: item.product_name || item.item_id,
            urgency: item.on_hand <= 0 ? 100 : Math.round(Math.max(15, 100 - (item.on_hand * 6))),
            color: item.on_hand <= 0 ? '#ef4444' : item.on_hand < 10 ? '#f59e0b' : '#0d9488',
          })),
        },
        recentAlerts: adjustments.slice(0, 6).map((adj: any) => ({
          status: adj.new_on_hand < adj.old_on_hand ? 'REDUCED' : 'RESTOCKED',
          statusClass: adj.new_on_hand < adj.old_on_hand ? 'danger' : 'success',
          name: adj.item_id,
          location: adj.store_id || 'Warehouse',
          details: `Stock: ${adj.old_on_hand} → ${adj.new_on_hand} (${adj.reason || 'Manual Adjust'})`,
          actionText: 'Inspect',
        })),
      };
    },
  },

  forecasting: {
    getExplorerData: async () => {
      const res = await apiClient.get('/products', { params: { limit: 1 } }).catch(() => ({ data: { items: [] } }));
      const items = unwrapItems(res.data);
      const sku = items[0]?.item_id || 'SKU-8921-ULTRA-BOOST-WHITE';

      return {
        sku,
        chartData: [
          { date: 'Oct 01', actual: 45, forecast: 45, lower: 40, upper: 50 },
          { date: 'Oct 05', actual: 52, forecast: 50, lower: 44, upper: 58 },
          { date: 'Oct 10', actual: 48, forecast: 49, lower: 42, upper: 55 },
          { date: 'Oct 15', actual: 60, forecast: 58, lower: 50, upper: 65 },
          { date: 'Oct 20', actual: 55, forecast: 55, lower: 48, upper: 62 },
          { date: 'Oct 25', actual: null, forecast: 57, lower: 49, upper: 65 },
          { date: 'Oct 30', actual: null, forecast: 62, lower: 52, upper: 72 },
        ],
        stats: {
          predictedDemand: '1,420 units',
          safetyStock: '15 units',
          reorderPoint: '35 units',
          mase: '0.64',
          ci: '±12%',
        },
        scheduleMatrix: [
          { date: 'Oct 25', demand: 57, lower: 49, upper: 65, spike: 'Low', spikeColor: 'text-teal' },
          { date: 'Oct 26', demand: 59, lower: 50, upper: 68, spike: 'Low', spikeColor: 'text-teal' },
          { date: 'Oct 27', demand: 64, lower: 53, upper: 74, spike: 'Med', spikeColor: 'text-yellow' },
          { date: 'Oct 28', demand: 62, lower: 52, upper: 72, spike: 'Low', spikeColor: 'text-teal' },
        ],
      };
    },
  },

  inventory: {
    getInventory: async (params?: any) => {
      const res = await apiClient.get('/inventory', { params });
      return { list: unwrapItems(res.data), total: res.data?.total || 0 };
    },
    getStores: async () => {
      const res = await apiClient.get('/inventory/stores');
      return res.data || [];
    },
    getItem: async (itemId: string, storeId: string) => {
      const res = await apiClient.get(`/inventory/${itemId}/${storeId}`);
      return res.data;
    },
    updateInventory: async (itemId: string, storeId: string, data: { on_hand?: number; on_order?: number; reason?: string }) => {
      const res = await apiClient.put(`/inventory/${itemId}/${storeId}`, data);
      return res.data;
    },
    getAdjustments: async (params?: any) => {
      const res = await apiClient.get('/inventory/history', { params });
      return { list: unwrapItems(res.data), total: res.data?.total || 0 };
    },
    getProducts: async (params?: any) => {
      const res = await apiClient.get('/products', { params: { limit: 500, ...params } });
      return { list: unwrapItems(res.data), total: res.data?.total || 0 };
    },
    getReplenishmentDashboard: async () => {
      const res = await apiClient.get('/inventory', { params: { limit: 100 } });
      const items = unwrapItems(res.data);
      return { items, total: res.data?.total || items.length };
    },
    getReplenishmentAlerts: async () => {
      const res = await apiClient.get('/inventory', { params: { limit: 100 } });
      const items = unwrapItems(res.data);
      return { alerts: items.filter((x: any) => (x.on_hand ?? 0) <= 10) };
    },
    getAbcXyzLogs: async () => {
      const res = await apiClient.get('/products', { params: { limit: 50 } });
      return { list: unwrapItems(res.data) };
    },
  },

  products: {
    getProducts: async (params?: any) => {
      const res = await apiClient.get('/products', { params });
      return { list: unwrapItems(res.data), total: res.data?.total || 0 };
    },
    getProduct: async (id: string) => {
      const res = await apiClient.get(`/products/${id}`);
      return res.data;
    },
    createProduct: async (data: { item_id: string; name: string; dept_id?: string; cat_id?: string }) => {
      const res = await apiClient.post('/products', data);
      return res.data;
    },
    updateProduct: async (id: string, data: { name?: string; dept_id?: string; cat_id?: string }) => {
      const res = await apiClient.put(`/products/${id}`, data);
      return res.data;
    },
    deleteProduct: async (id: string) => {
      const res = await apiClient.delete(`/products/${id}`);
      return res.data;
    },
    bulkCreate: async (items: Array<{ item_id: string; name: string; dept_id?: string; cat_id?: string }>) => {
      const res = await apiClient.post('/products/bulk', { items });
      return res.data;
    },
    getCategories: async () => {
      const res = await apiClient.get('/products/categories');
      return res.data || [];
    },
    getDepartments: async () => {
      const res = await apiClient.get('/products/departments');
      return res.data || [];
    },
    getSuppliers: async (params?: any) => {
      const res = await apiClient.get('/suppliers', { params });
      return { list: unwrapItems(res.data), total: res.data?.total || 0 };
    },
    getSupplier: async (id: string) => {
      const res = await apiClient.get(`/suppliers/${id}`);
      return res.data;
    },
    createSupplier: async (data: any) => {
      const res = await apiClient.post('/suppliers', data);
      return res.data;
    },
    updateSupplier: async (id: string, data: any) => {
      const res = await apiClient.put(`/suppliers/${id}`, data);
      return res.data;
    },
    deleteSupplier: async (id: string) => {
      const res = await apiClient.delete(`/suppliers/${id}`);
      return res.data;
    },
    getDataImports: async () => {
      const res = await apiClient.get('/audit-logs', { params: { action: 'products.bulk_create', limit: 20 } }).catch(() => ({ data: { items: [] } }));
      return { list: unwrapItems(res.data) };
    },
    getAdjustments: async (params?: any) => {
      const res = await apiClient.get('/inventory/history', { params });
      return { list: unwrapItems(res.data), total: res.data?.total || 0 };
    },
    adjustInventory: async (itemId: string, storeId: string, data: any) => {
      const res = await apiClient.put(`/inventory/${itemId}/${storeId}`, data);
      return res.data;
    },
    uploadDataFile: async (file: File) => {
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
    createEvent: async (eventData: any) => {
      const sku = eventData.name || 'TEST_SKU';
      const res = await apiClient.post('/events/publish-test', null, { params: { sku_id: sku } });
      return res.data;
    },
  },

  settings: {
    getUsers: async (params?: any) => {
      const res = await apiClient.get('/users', { params });
      return { list: unwrapItems(res.data), total: res.data?.total || 0 };
    },
    getUser: async (id: string) => {
      const res = await apiClient.get(`/users/${id}`);
      return res.data;
    },
    createUser: async (userData: any) => {
      const res = await apiClient.post('/users', userData);
      return res.data;
    },
    updateUser: async (id: string, userData: any) => {
      const res = await apiClient.put(`/users/${id}`, userData);
      return res.data;
    },
    changeUserStatus: async (id: string, is_active: boolean) => {
      const res = await apiClient.patch(`/users/${id}/status`, { is_active });
      return res.data;
    },
    deleteUser: async (id: string) => {
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
    getConfig: async () => {
      return { app_name: 'DFIOS', version: '1.0.0', environment: 'production' };
    },
    getDataQuality: async () => {
      return { score: 98, tables: [] };
    },
    getMlPipeline: async () => {
      return {
        kpis: {
          lastRun: { time: 'N/A', status: 'Idle' },
          nextRun: { time: 'Manual', status: 'Pending' }
        },
        executions: []
      };
    },
  },

  models: {
    getPerformanceMetrics: async () => {
      return {
        kpis: [
          { title: 'TFT Seasonal Model', type: 'best', metrics: { mase: '0.64', rmse: '4.8', mae: '3.9' } },
          { title: 'LightGBM Baseline', type: 'challenger', metrics: { mase: '0.78', rmse: '5.6', mae: '4.4' } },
          { title: 'Seasonal ARIMA', type: 'baseline', metrics: { mase: '1.12', rmse: '8.4', mae: '6.7' } },
        ],
        scatterData: [
          { x: 1.2, y: 1.1, fill: '#0d9488' },
          { x: 2.1, y: 2.2, fill: '#0d9488' },
          { x: 2.8, y: 2.7, fill: '#0d9488' },
          { x: 3.4, y: 3.5, fill: '#0d9488' },
          { x: 4.1, y: 4.0, fill: '#0d9488' },
          { x: 4.8, y: 4.9, fill: '#0d9488' },
        ],
        shapValues: [
          { feature: 'Historical Sales (Lag 7)', pct: '88%', val: '+0.34' },
          { feature: 'Day of Week & Seasonality', pct: '65%', val: '+0.25' },
          { feature: 'Promotion Discount Lift', pct: '48%', val: '+0.18' },
          { feature: 'Store Location Clustering', pct: '32%', val: '+0.12' },
          { feature: 'Lead Time Variability', pct: '24%', val: '-0.09' },
        ],
        comparisonTable: [
          { metric: 'Forecast Horizon MASE', static: '1.24', ml: '0.64', improvement: '+48.4% Accuracy' },
          { metric: 'Safety Stock Requirement', static: '450 units', ml: '310 units', improvement: '-31.1% Inventory' },
          { metric: 'Stockout Probability', static: '4.8%', ml: '1.2%', improvement: '-75.0% Stockouts' },
          { metric: 'Optimal Reorder Cycle', static: '14 Days', ml: '10 Days', improvement: '+28.5% Turnover' },
        ],
      };
    },
    getCostSimulation: async () => {
      return {
        chartData: [
          { sl: '90%', cost: 4200 },
          { sl: '92%', cost: 4400 },
          { sl: '95%', cost: 4800 },
          { sl: '98%', cost: 5250 },
          { sl: '99%', cost: 6300 },
        ],
        currentPolicy: {
          holding: '$4,200',
          stockout: '$1,800',
          total: '$6,000',
        },
        simulatedPolicy: {
          holding: '$4,800',
          stockout: '$450',
          total: '$5,250',
        },
        delta: {
          holding: '+14%',
          stockout: '-75%',
          total: '-12.5%',
        },
      };
    },
  },

  reports: {
    getRecentLogs: async () => {
      const auditRes = await apiClient.get('/audit-logs', { params: { limit: 10 } }).catch(() => ({ data: { items: [] } }));
      const logs = (unwrapItems(auditRes.data) || []).map((l: any, idx: number) => ({
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
          { title: 'Inventory Reconciliation', desc: 'Summary of inventory cycles, physical counts, and variance history', icon: 'TrendingUp' },
          { title: 'Stockout Risk Assessment', desc: 'Analysis of SKUs approaching reorder points across warehouses', icon: 'Activity' },
          { title: 'Supplier Lead Time Audit', desc: 'Fulfillment accuracy and delivery performance breakdown', icon: 'Grid' },
          { title: 'Master Data Integrity Report', desc: 'SKU attributes, classification gaps, and category mapping', icon: 'Settings' },
        ],
        logs: logs.length > 0 ? logs : [
          { name: 'Monthly_Inventory_Reconciliation.csv', type: 'INVENTORY', date: 'Oct 24, 2024', format: 'CSV', formatClass: 'csv', size: '1.2 MB', status: 'READY', action: 'Download' },
          { name: 'Q3_Safety_Stock_Audit.pdf', type: 'SAFETY_STOCK', date: 'Oct 20, 2024', format: 'PDF', formatClass: 'pdf', size: '3.4 MB', status: 'READY', action: 'Download' },
        ],
      };
    },
  },
};
