import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  AlertOctagon,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DollarSign,
  Package,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Store,
  TrendingUp,
  Truck,
} from 'lucide-react';
import { Card } from '../components/ui/Card.tsx';
import { api } from '../services/api.ts';
import { useLanguage } from '../context/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import './Dashboard.css';

interface DashboardKPIsData {
  total_skus: number;
  total_inventory_value: number;
  stockout_rate: number;
  estimated_service_level: number;
  reorder_alerts_count: number;
  pending_replenishments_count: number;
  avg_forecast_accuracy: string;
  total_suppliers: number;
}

interface DemandTrendPointData {
  date: string;
  actual: number | null;
  predicted: number | null;
}

interface DemandTrendResponseData {
  granularity: string;
  store_id?: string | null;
  category?: string | null;
  data: DemandTrendPointData[];
}

interface InventoryAlertItemData {
  item_id: string;
  product_name: string;
  category?: string | null;
  store_id: string;
  on_hand: number;
  on_order: number;
  safety_stock: number;
  reorder_point: number;
  severity: 'CRITICAL' | 'WARNING' | 'HEALTHY' | string;
  suggested_action: string;
  updated_at?: string | null;
}

interface AlertSummaryData {
  critical_count: number;
  warning_count: number;
  healthy_count: number;
  total_monitored: number;
}

interface DashboardAlertsResponseData {
  summary: AlertSummaryData;
  items: InventoryAlertItemData[];
  total: number;
}

type DashboardTab = 'overview' | 'analytics' | 'alerts';

const ALERT_PAGE_SIZE = 12;

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { user } = useAuth();

  const canScanAlerts = user?.role === 'ADMIN' || user?.role === 'WAREHOUSE MANAGER';

  // Active sub-navigation view (modeled on executive segmented tab bar)
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');

  // Dynamic Backend filter metadata
  const [stores, setStores] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  // Backend query parameters
  const [selectedStore, setSelectedStore] = useState<string>('');
  const [trendCategory, setTrendCategory] = useState<string>('');
  const [trendDays, setTrendDays] = useState<number>(30);
  const [trendGranularity, setTrendGranularity] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  // Stock Alerts table query parameters (UC09)
  const [alertSeverity, setAlertSeverity] = useState<string>('');
  const [alertOffset, setAlertOffset] = useState<number>(0);

  // Pure Backend response states
  const [kpis, setKpis] = useState<DashboardKPIsData | null>(null);
  const [demandTrend, setDemandTrend] = useState<DemandTrendResponseData | null>(null);
  const [overviewAlerts, setOverviewAlerts] = useState<DashboardAlertsResponseData | null>(null);
  const [tableAlerts, setTableAlerts] = useState<DashboardAlertsResponseData | null>(null);

  // Loading & feedback states
  const [isLoadingCore, setIsLoadingCore] = useState<boolean>(false);
  const [isLoadingTrend, setIsLoadingTrend] = useState<boolean>(false);
  const [isLoadingTable, setIsLoadingTable] = useState<boolean>(false);
  const [isScanningAlerts, setIsScanningAlerts] = useState<boolean>(false);
  const [scanBanner, setScanBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Load dynamic stores & categories from Backend once
  useEffect(() => {
    let active = true;
    Promise.all([
      api.inventory.getStores().catch(() => []),
      api.products.getCategories().catch(() => []),
    ]).then(([storeList, categoryList]) => {
      if (!active) return;
      if (Array.isArray(storeList)) {
        setStores(storeList.filter(Boolean));
      }
      if (Array.isArray(categoryList)) {
        setCategories(categoryList.filter(Boolean));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Fetch UC07 KPIs & UC09 Overview Alerts when store changes
  const fetchCoreDashboard = useCallback(async (storeId: string) => {
    setIsLoadingCore(true);
    try {
      const storeParam = storeId || undefined;
      const [kpisRes, alertsRes] = await Promise.all([
        api.dashboard.getKpis(storeParam),
        api.dashboard.getAlerts({ store_id: storeParam, limit: 8, offset: 0 }),
      ]);
      if (kpisRes) setKpis(kpisRes);
      if (alertsRes) setOverviewAlerts(alertsRes);
    } catch (err) {
      console.error('Failed to load Dashboard KPIs & Alerts from Backend:', err);
    } finally {
      setIsLoadingCore(false);
    }
  }, []);

  // Fetch UC08 Demand Trend when store, category, days, or granularity changes
  const fetchDemandTrend = useCallback(
    async (storeId: string, category: string, days: number, granularity: string) => {
      setIsLoadingTrend(true);
      try {
        const res = await api.dashboard.getDemandTrend({
          store_id: storeId || undefined,
          category: category || undefined,
          days,
          granularity,
        });
        if (res) setDemandTrend(res);
      } catch (err) {
        console.error('Failed to load Demand Trend from Backend:', err);
      } finally {
        setIsLoadingTrend(false);
      }
    },
    []
  );

  // Fetch UC09 paginated Stock Alerts when store, severity, or offset changes
  const fetchAlertsTable = useCallback(
    async (storeId: string, severity: string, offset: number) => {
      setIsLoadingTable(true);
      try {
        const res = await api.dashboard.getAlerts({
          store_id: storeId || undefined,
          severity: severity || undefined,
          limit: ALERT_PAGE_SIZE,
          offset,
        });
        if (res) setTableAlerts(res);
      } catch (err) {
        console.error('Failed to load Stock Alerts table from Backend:', err);
      } finally {
        setIsLoadingTable(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchCoreDashboard(selectedStore);
  }, [selectedStore, fetchCoreDashboard]);

  useEffect(() => {
    fetchDemandTrend(selectedStore, trendCategory, trendDays, trendGranularity);
  }, [selectedStore, trendCategory, trendDays, trendGranularity, fetchDemandTrend]);

  useEffect(() => {
    fetchAlertsTable(selectedStore, alertSeverity, alertOffset);
  }, [selectedStore, alertSeverity, alertOffset, fetchAlertsTable]);

  // Reset pagination when store or severity filter changes
  const handleStoreChange = (nextStore: string) => {
    setSelectedStore(nextStore);
    setAlertOffset(0);
  };

  const handleSeverityChange = (nextSeverity: string) => {
    setAlertSeverity(nextSeverity);
    setAlertOffset(0);
  };

  const handleManualRefresh = () => {
    api.dashboard.clearCache();
    fetchCoreDashboard(selectedStore);
    fetchDemandTrend(selectedStore, trendCategory, trendDays, trendGranularity);
    fetchAlertsTable(selectedStore, alertSeverity, alertOffset);
  };

  // UC10: Trigger realtime threshold scan & SSE broadcast on Backend
  const handleTriggerRealtimeAlerts = async () => {
    if (!canScanAlerts) return;
    setIsScanningAlerts(true);
    setScanBanner(null);
    try {
      const res = await api.dashboard.triggerRealtimeAlerts(selectedStore || undefined);
      const generated = res?.alerts_generated ?? 0;
      const broadcasted = res?.broadcast_count ?? 0;
      const ts = res?.timestamp ? new Date(res.timestamp).toLocaleTimeString() : '';

      setScanBanner({
        type: 'success',
        message:
          language === 'vi'
            ? `Quét hoàn tất (${ts}): Hệ thống tạo mới ${generated} cảnh báo và phát ${broadcasted} sự kiện SSE thời gian thực.`
            : `Realtime scan completed (${ts}): ${generated} new alerts logged & ${broadcasted} SSE events broadcasted.`,
      });

      fetchCoreDashboard(selectedStore);
      fetchAlertsTable(selectedStore, alertSeverity, alertOffset);
      setTimeout(() => setScanBanner(null), 5000);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setScanBanner({
        type: 'error',
        message:
          typeof detail === 'string'
            ? detail
            : language === 'vi'
              ? 'Không thể kích hoạt quét cảnh báo thời gian thực. Vui lòng kiểm tra quyền truy cập hoặc kết nối Backend.'
              : 'Failed to trigger realtime alert scan. Please verify permissions or Backend connectivity.',
      });
      setTimeout(() => setScanBanner(null), 5000);
    } finally {
      setIsScanningAlerts(false);
    }
  };

  const isSyncing = isLoadingCore || isLoadingTrend;

  // Map Backend DemandTrendPoint[] directly for Recharts (no synthetic values)
  const trendChartData = (demandTrend?.data || []).map((pt) => ({
    date: pt.date,
    label: pt.date && pt.date.length >= 10 ? pt.date.slice(5) : pt.date,
    actual: pt.actual,
    predicted: pt.predicted,
  }));

  // Map Backend AlertSummary directly for Traffic-Light Donut Chart
  const alertSummary: AlertSummaryData = overviewAlerts?.summary || {
    critical_count: 0,
    warning_count: 0,
    healthy_count: 0,
    total_monitored: 0,
  };

  const healthDistributionData = [
    {
      key: 'HEALTHY',
      name: t('dashboard.healthy_stock', 'Healthy (> ROP)'),
      value: alertSummary.healthy_count,
      color: '#0d9488',
    },
    {
      key: 'WARNING',
      name: t('dashboard.warning_stock', 'Warning (≤ ROP)'),
      value: alertSummary.warning_count,
      color: '#f59e0b',
    },
    {
      key: 'CRITICAL',
      name: t('dashboard.critical_stock', 'Critical (≤ SS / Out)'),
      value: alertSummary.critical_count,
      color: '#ef4444',
    },
  ];

  const nonZeroHealthData = healthDistributionData.filter((seg) => seg.value > 0);

  // Priority items returned directly by Backend GET /dashboard/alerts (sorted CRITICAL -> WARNING -> HEALTHY by BE)
  const priorityAlertItems = overviewAlerts?.items || [];
  const thresholdChartData = priorityAlertItems.slice(0, 6).map((it) => ({
    ...it,
    axis_label: selectedStore ? it.item_id : `${it.item_id} (${it.store_id})`,
  }));

  const renderSeverityCode = (severity: string) => {
    if (severity === 'CRITICAL') return 'CR';
    if (severity === 'WARNING') return 'WN';
    return 'OK';
  };

  const renderSeverityTone = (severity: string) => {
    if (severity === 'CRITICAL') return 'critical';
    if (severity === 'WARNING') return 'warning';
    return 'healthy';
  };

  // Reusable Demand Trend Chart Block (UC08)
  const renderDemandTrendCard = (expanded: boolean = false) => (
    <Card noPadding className="dash-panel-card">
      <div className="dash-card-header dash-card-header-wrap">
        <div className="dash-card-heading">
          <h3 className="dash-card-title">{t('dashboard.demand_trend_title', 'Demand Trend Overview')}</h3>
          <p className="dash-card-subtitle">
            {t('dashboard.demand_trend_subtitle', 'Actual historical sales quantity vs. predicted demand from Backend')}
            {demandTrend?.store_id ? ` • ${demandTrend.store_id}` : ` • ${t('dashboard.all_stores', 'All Stores')}`}
            {demandTrend?.category ? ` • ${demandTrend.category}` : ''}
          </p>
        </div>

        <div className="dash-chart-controls">
          <select
            className="dash-select-sm"
            value={trendCategory}
            onChange={(e) => setTrendCategory(e.target.value)}
            aria-label="Category filter"
          >
            <option value="">{t('dashboard.all_categories', 'All Categories')}</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            className="dash-select-sm"
            value={trendDays}
            onChange={(e) => setTrendDays(Number(e.target.value))}
            aria-label="Analysis window days"
          >
            <option value={7}>{t('dashboard.days_7', '7 Days')}</option>
            <option value={14}>{t('dashboard.days_14', '14 Days')}</option>
            <option value={30}>{t('dashboard.days_30', '30 Days')}</option>
            <option value={60}>{t('dashboard.days_60', '60 Days')}</option>
            <option value={90}>{t('dashboard.days_90', '90 Days')}</option>
          </select>

          <select
            className="dash-select-sm"
            value={trendGranularity}
            onChange={(e) => setTrendGranularity(e.target.value as 'daily' | 'weekly' | 'monthly')}
            aria-label="Time granularity"
          >
            <option value="daily">{t('dashboard.granularity_daily', 'Daily')}</option>
            <option value="weekly">{t('dashboard.granularity_weekly', 'Weekly')}</option>
            <option value="monthly">{t('dashboard.granularity_monthly', 'Monthly')}</option>
          </select>
        </div>
      </div>

      <div className="dash-legend-bar">
        <div className="dash-legend-item">
          <span className="dash-legend-swatch bar-actual" />
          <span>{t('dashboard.actual_demand', 'Actual Sales')}</span>
        </div>
        <div className="dash-legend-item">
          <span className="dash-legend-swatch line-predicted" />
          <span>{t('dashboard.predicted_demand', 'Predicted Demand')}</span>
        </div>
      </div>

      <div className={`dash-chart-body ${expanded ? 'dash-chart-body-lg' : ''}`}>
        {trendChartData.length === 0 ? (
          <div className="dash-empty-state">
            {t('dashboard.no_trend_data', 'No demand trend records available for the selected filters.')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trendChartData} margin={{ top: 8, right: 14, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                stroke="#64748b"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#64748b' }}
                minTickGap={16}
              />
              <YAxis
                stroke="#64748b"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#64748b' }}
                width={46}
              />
              <Tooltip
                cursor={{ fill: 'rgba(226, 232, 240, 0.35)' }}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''}
                contentStyle={{
                  borderRadius: '4px',
                  border: '1px solid #1e293b',
                  boxShadow: 'var(--shadow-md)',
                  backgroundColor: '#0f172a',
                  color: '#f8fafc',
                  fontSize: '12px',
                }}
              />
              <Bar
                dataKey="actual"
                name={t('dashboard.actual_demand', 'Actual Sales')}
                fill="#0f766e"
                radius={[3, 3, 0, 0]}
                maxBarSize={26}
              />
              <Line
                type="monotone"
                dataKey="predicted"
                name={t('dashboard.predicted_demand', 'Predicted Demand')}
                stroke="#0ea5e9"
                strokeWidth={2.5}
                dot={{ r: 2.5, fill: '#0ea5e9', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );

  // Reusable Inventory Health Donut + Threshold Comparison Row (UC09)
  const renderHealthAndThresholdGrid = () => (
    <div className="dash-secondary-grid">
      {/* Left 5fr: Traffic-Light Inventory Health Donut (AlertSummary) */}
      <Card noPadding className="dash-panel-card">
        <div className="dash-card-header">
          <div className="dash-card-heading">
            <h3 className="dash-card-title">
              {t('dashboard.inventory_distribution', 'Inventory Health Distribution')}
            </h3>
            <p className="dash-card-subtitle">
              {t('dashboard.inventory_distribution_sub', 'Traffic-light classification across monitored SKUs')}
            </p>
          </div>
        </div>

        <div className="dash-donut-layout">
          <div className="dash-donut-box">
            {nonZeroHealthData.length === 0 ? (
              <div className="dash-empty-state">0 {t('dashboard.skus_unit', 'SKUs')}</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={nonZeroHealthData}
                      cx="50%"
                      cy="50%"
                      innerRadius={56}
                      outerRadius={82}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {nonZeroHealthData.map((entry) => (
                        <Cell key={entry.key} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: '4px',
                        border: '1px solid #1e293b',
                        backgroundColor: '#0f172a',
                        color: '#f8fafc',
                        fontSize: '12px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dash-donut-center">
                  <strong>{alertSummary.total_monitored.toLocaleString()}</strong>
                  <span>{t('dashboard.monitored_skus', 'Monitored SKUs')}</span>
                </div>
              </>
            )}
          </div>

          <div className="dash-donut-legend">
            {healthDistributionData.map((seg) => (
              <div key={seg.key} className="dash-donut-legend-row">
                <div className="dash-donut-legend-left">
                  <span className="dash-donut-dot" style={{ backgroundColor: seg.color }} />
                  <span>{seg.name}</span>
                </div>
                <span className="dash-donut-count">
                  {seg.value.toLocaleString()} {t('dashboard.skus_unit', 'SKUs')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Right 7fr: Physical On-Hand vs Safety Stock & ROP Thresholds (InventoryAlertItem) */}
      <Card noPadding className="dash-panel-card">
        <div className="dash-card-header">
          <div className="dash-card-heading">
            <h3 className="dash-card-title">
              {t('dashboard.threshold_chart_title', 'Stock vs. Safety Stock & ROP Thresholds')}
            </h3>
            <p className="dash-card-subtitle">
              {t('dashboard.threshold_chart_sub', 'Physical unit comparison for top priority SKUs from Backend alerts')}
            </p>
          </div>
        </div>

        <div className="dash-legend-bar">
          <div className="dash-legend-item">
            <span className="dash-legend-swatch" style={{ backgroundColor: '#0ea5e9' }} />
            <span>{t('dashboard.on_hand', 'On-Hand')}</span>
          </div>
          <div className="dash-legend-item">
            <span className="dash-legend-swatch" style={{ backgroundColor: '#ef4444' }} />
            <span>{t('dashboard.ss', 'SS')}</span>
          </div>
          <div className="dash-legend-item">
            <span className="dash-legend-swatch" style={{ backgroundColor: '#f59e0b' }} />
            <span>{t('dashboard.rop', 'ROP')}</span>
          </div>
        </div>

        <div className="dash-chart-body dash-chart-body-sm">
          {thresholdChartData.length === 0 ? (
            <div className="dash-empty-state">
              {t('dashboard.all_normal', 'All monitored SKUs are operating within optimal stock thresholds.')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={thresholdChartData} margin={{ top: 8, right: 14, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="axis_label"
                  stroke="#64748b"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: '#475569' }}
                  interval={0}
                />
                <YAxis
                  stroke="#64748b"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  width={44}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(226, 232, 240, 0.35)' }}
                  labelFormatter={(label, payload) => {
                    const row = payload?.[0]?.payload as InventoryAlertItemData | undefined;
                    return row ? `${row.item_id} — ${row.product_name} (${row.store_id})` : String(label);
                  }}
                  contentStyle={{
                    borderRadius: '4px',
                    border: '1px solid #1e293b',
                    boxShadow: 'var(--shadow-md)',
                    backgroundColor: '#0f172a',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
                <Bar
                  dataKey="on_hand"
                  name={t('dashboard.on_hand', 'On-Hand')}
                  fill="#0ea5e9"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={20}
                />
                <Bar
                  dataKey="safety_stock"
                  name={t('dashboard.col_ss', 'Safety Stock (SS)')}
                  fill="#ef4444"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={20}
                />
                <Bar
                  dataKey="reorder_point"
                  name={t('dashboard.col_rop', 'Reorder Point (ROP)')}
                  fill="#f59e0b"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={20}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );

  const totalTableItems = tableAlerts?.total || 0;
  const currentTableItems = tableAlerts?.items || [];

  return (
    <div className="dash-page animate-fade-in">
      {/* 1. Executive Header Row (Title left, Store selector + Scan Realtime Alerts right) */}
      <div className="dash-top-row">
        <div className="dash-title-group">
          <div className="dash-title-inline">
            <h1 className="dash-page-title">{t('dashboard.page_title', 'Dashboard')}</h1>
            <span className={`dash-live-pill ${isSyncing ? 'syncing' : ''}`}>
              <span className="dash-live-dot" />
              {isSyncing
                ? t('dashboard.syncing', 'Syncing...')
                : t('dashboard.live_sync', 'Live Sync')}
            </span>
          </div>
          <p className="dash-page-subtitle">
            {t(
              'dashboard.hero_subtitle',
              'Real-time executive KPIs, demand forecast trends, and inventory threshold alerts.'
            )}
          </p>
        </div>

        <div className="dash-actions-group">
          <div className="dash-store-control">
            <Store size={14} className="dash-store-icon" />
            <span className="dash-store-label">{t('dashboard.store_label', 'Store:')}</span>
            <select
              className="dash-store-select"
              value={selectedStore}
              onChange={(e) => handleStoreChange(e.target.value)}
              aria-label="Select store scope"
            >
              <option value="">{t('dashboard.all_stores', 'All Stores')}</option>
              {stores.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="dash-refresh-btn"
            onClick={handleManualRefresh}
            disabled={isSyncing}
            title={t('common.refresh', 'Refresh')}
          >
            <RefreshCw size={15} className={isSyncing ? 'dash-spin' : ''} />
          </button>

          <button
            type="button"
            className="dash-scan-btn"
            onClick={handleTriggerRealtimeAlerts}
            disabled={isScanningAlerts || !canScanAlerts}
            title={
              canScanAlerts
                ? t('dashboard.scan_alerts', 'Scan Realtime Alerts')
                : t('dashboard.scan_role_hint', 'Requires Warehouse Manager or Admin permission')
            }
          >
            {isScanningAlerts ? (
              <RefreshCw size={15} className="dash-spin" />
            ) : (
              <ShieldAlert size={15} />
            )}
            <span>
              {isScanningAlerts
                ? t('dashboard.scanning', 'Scanning...')
                : t('dashboard.scan_alerts', 'Scan Realtime Alerts')}
            </span>
          </button>
        </div>
      </div>

      {/* Realtime Alert Scan Feedback Banner (UC10) */}
      {scanBanner && (
        <div className={`dash-banner ${scanBanner.type}`}>
          {scanBanner.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{scanBanner.message}</span>
        </div>
      )}

      {/* 2. Segmented Sub-Navigation Bar (Overview | Analytics | Stock Alerts) */}
      <div className="dash-subnav-row">
        <div className="dash-tabs-bar" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            className={`dash-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            {t('dashboard.tab_overview', 'Overview')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'analytics'}
            className={`dash-tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            {t('dashboard.tab_analytics', 'Analytics')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'alerts'}
            className={`dash-tab-btn ${activeTab === 'alerts' ? 'active' : ''}`}
            onClick={() => setActiveTab('alerts')}
          >
            <span>{t('dashboard.tab_alerts', 'Stock Alerts')}</span>
            {kpis && kpis.reorder_alerts_count > 0 && (
              <span className="dash-tab-count">{kpis.reorder_alerts_count}</span>
            )}
          </button>
        </div>
      </div>

      {/* 3. Tab Views */}
      {activeTab === 'overview' && (
        <>
          {/* UC07: All 8 Backend Executive KPIs in Clean 4-Column Cards */}
          <div className="dash-kpi-grid">
            <Card noPadding className="dash-kpi-card">
              <div className="dash-kpi-top">
                <span className="dash-kpi-title">
                  {t('dashboard.kpi_inventory_value', 'Total Inventory Value')}
                </span>
                <DollarSign size={16} className="dash-kpi-icon teal" />
              </div>
              <div className="dash-kpi-value">
                {kpis != null
                  ? `$${kpis.total_inventory_value.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : '—'}
              </div>
              <p className="dash-kpi-meta">
                {t('dashboard.kpi_inventory_value_sub', 'Current on-hand valuation (USD)')}
              </p>
            </Card>

            <Card noPadding className="dash-kpi-card">
              <div className="dash-kpi-top">
                <span className="dash-kpi-title">
                  {t('dashboard.kpi_total_skus', 'Total Monitored SKUs')}
                </span>
                <Package size={16} className="dash-kpi-icon" />
              </div>
              <div className="dash-kpi-value">
                {kpis != null ? kpis.total_skus.toLocaleString() : '—'}
              </div>
              <p className="dash-kpi-meta">
                {t('dashboard.kpi_total_skus_sub', 'Master catalog items tracked')}
              </p>
            </Card>

            <Card noPadding className="dash-kpi-card">
              <div className="dash-kpi-top">
                <span className="dash-kpi-title">
                  {t('dashboard.kpi_service_level', 'Estimated Service Level')}
                </span>
                <ShieldCheck size={16} className="dash-kpi-icon emerald" />
              </div>
              <div className="dash-kpi-value">
                {kpis != null ? `${kpis.estimated_service_level}%` : '—'}
              </div>
              <p className="dash-kpi-meta">
                {t('dashboard.kpi_service_level_sub', 'Cycle stock availability rate')}
              </p>
            </Card>

            <Card noPadding className="dash-kpi-card">
              <div className="dash-kpi-top">
                <span className="dash-kpi-title">
                  {t('dashboard.kpi_stockout_rate', 'Stockout Rate')}
                </span>
                <AlertOctagon
                  size={16}
                  className={`dash-kpi-icon ${kpis && kpis.stockout_rate > 0 ? 'danger' : 'teal'}`}
                />
              </div>
              <div
                className={`dash-kpi-value ${
                  kpis && kpis.stockout_rate > 3 ? 'text-danger' : ''
                }`}
              >
                {kpis != null ? `${kpis.stockout_rate}%` : '—'}
              </div>
              <p className="dash-kpi-meta">
                {t('dashboard.kpi_stockout_rate_sub', 'Share of SKUs with On-Hand ≤ 0')}
              </p>
            </Card>

            <Card
              noPadding
              className="dash-kpi-card dash-kpi-clickable"
              onClick={() => setActiveTab('alerts')}
            >
              <div className="dash-kpi-top">
                <span className="dash-kpi-title">
                  {t('dashboard.kpi_reorder_alerts', 'Reorder Alerts (≤ ROP)')}
                </span>
                <BellRing
                  size={16}
                  className={`dash-kpi-icon ${
                    kpis && kpis.reorder_alerts_count > 0 ? 'warning' : 'teal'
                  }`}
                />
              </div>
              <div
                className={`dash-kpi-value ${
                  kpis && kpis.reorder_alerts_count > 0 ? 'text-warning' : ''
                }`}
              >
                {kpis != null ? kpis.reorder_alerts_count.toLocaleString() : '—'}
              </div>
              <p className="dash-kpi-meta">
                {t('dashboard.kpi_reorder_alerts_sub', 'SKUs at or below reorder point')}
              </p>
            </Card>

            <Card
              noPadding
              className="dash-kpi-card dash-kpi-clickable"
              onClick={() => navigate('/replenishment')}
            >
              <div className="dash-kpi-top">
                <span className="dash-kpi-title">
                  {t('dashboard.kpi_pending_replenishments', 'Pending Replenishments')}
                </span>
                <ClipboardList size={16} className="dash-kpi-icon teal" />
              </div>
              <div className="dash-kpi-value text-teal">
                {kpis != null ? kpis.pending_replenishments_count.toLocaleString() : '—'}
              </div>
              <p className="dash-kpi-meta dash-kpi-link">
                <span>
                  {t('dashboard.kpi_pending_replenishments_sub', 'PO recommendations awaiting review')}
                </span>
                <ArrowRight size={13} />
              </p>
            </Card>

            <Card noPadding className="dash-kpi-card">
              <div className="dash-kpi-top">
                <span className="dash-kpi-title">
                  {t('dashboard.kpi_forecast_accuracy', 'Forecast Accuracy')}
                </span>
                <TrendingUp size={16} className="dash-kpi-icon emerald" />
              </div>
              <div className="dash-kpi-value">
                {kpis?.avg_forecast_accuracy || '—'}
              </div>
              <p className="dash-kpi-meta">
                {t('dashboard.kpi_forecast_accuracy_sub', 'Average predictive accuracy')}
              </p>
            </Card>

            <Card noPadding className="dash-kpi-card">
              <div className="dash-kpi-top">
                <span className="dash-kpi-title">
                  {t('dashboard.kpi_active_suppliers', 'Active Suppliers')}
                </span>
                <Truck size={16} className="dash-kpi-icon" />
              </div>
              <div className="dash-kpi-value">
                {kpis != null ? kpis.total_suppliers.toLocaleString() : '—'}
              </div>
              <p className="dash-kpi-meta">
                {t('dashboard.kpi_active_suppliers_sub', 'Registered supply partners')}
              </p>
            </Card>
          </div>

          {/* Primary 7fr / 5fr Split Grid (Chart Overview Left + Priority Stock Alerts List Right) */}
          <div className="dash-main-grid">
            {renderDemandTrendCard(false)}

            <Card noPadding className="dash-panel-card">
              <div className="dash-card-header">
                <div className="dash-card-heading">
                  <h3 className="dash-card-title">
                    {t('dashboard.priority_alerts_title', 'Stock Alerts (SS & ROP)')}
                  </h3>
                  <p className="dash-card-subtitle">
                    {language === 'vi'
                      ? `${alertSummary.critical_count} nguy cấp · ${alertSummary.warning_count} cảnh báo trên ${alertSummary.total_monitored} SKU giám sát`
                      : `${alertSummary.critical_count} critical · ${alertSummary.warning_count} warning across ${alertSummary.total_monitored} monitored SKUs`}
                  </p>
                </div>

                <button
                  type="button"
                  className="dash-link-btn"
                  onClick={() => setActiveTab('alerts')}
                >
                  <span>{t('dashboard.view_all_alerts', 'View All')}</span>
                  <ArrowRight size={13} />
                </button>
              </div>

              <div className="dash-priority-list">
                {priorityAlertItems.length === 0 ? (
                  <div className="dash-empty-state">
                    {t('dashboard.all_normal', 'All monitored SKUs are operating within optimal stock thresholds.')}
                  </div>
                ) : (
                  priorityAlertItems.slice(0, 6).map((item) => {
                    const tone = renderSeverityTone(item.severity);
                    return (
                      <div
                        key={`${item.store_id}-${item.item_id}`}
                        className="dash-priority-row"
                        onClick={() => navigate('/replenishment')}
                      >
                        <div className={`dash-priority-avatar ${tone}`}>
                          {renderSeverityCode(item.severity)}
                        </div>

                        <div className="dash-priority-info">
                          <div className="dash-priority-name">{item.product_name}</div>
                          <div className="dash-priority-sub">
                            {item.item_id} • {item.store_id}
                            {item.category ? ` • ${item.category}` : ''}
                          </div>
                        </div>

                        <div className="dash-priority-metrics">
                          <div className={`dash-priority-onhand ${tone}`}>
                            {item.on_hand.toLocaleString()} {t('dashboard.on_hand', 'On-Hand')}
                          </div>
                          <div className="dash-priority-thresholds">
                            {t('dashboard.rop', 'ROP')}: {item.reorder_point} · {t('dashboard.ss', 'SS')}: {item.safety_stock}
                            {item.on_order > 0 ? ` · +${item.on_order}` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          </div>
        </>
      )}

      {activeTab === 'analytics' && (
        <div className="dash-analytics-stack">
          {renderDemandTrendCard(true)}
          {renderHealthAndThresholdGrid()}
        </div>
      )}

      {activeTab === 'alerts' && (
        <Card noPadding className="dash-panel-card">
          <div className="dash-card-header dash-card-header-wrap">
            <div className="dash-card-heading">
              <h3 className="dash-card-title">
                {t('dashboard.priority_alerts_title', 'Stock Alerts (SS & ROP)')}
              </h3>
              <p className="dash-card-subtitle">
                {language === 'vi'
                  ? `Tổng giám sát: ${alertSummary.total_monitored} SKU (${alertSummary.critical_count} Nguy cấp · ${alertSummary.warning_count} Cảnh báo · ${alertSummary.healthy_count} An toàn)`
                  : `Total monitored: ${alertSummary.total_monitored} SKUs (${alertSummary.critical_count} Critical · ${alertSummary.warning_count} Warning · ${alertSummary.healthy_count} Healthy)`}
              </p>
            </div>

            <div className="dash-severity-pills">
              {[
                { value: '', label: t('dashboard.filter_all_severities', 'All Severities') },
                { value: 'CRITICAL', label: t('dashboard.severity_critical', 'Critical') },
                { value: 'WARNING', label: t('dashboard.severity_warning', 'Warning') },
                { value: 'HEALTHY', label: t('dashboard.severity_healthy', 'Healthy') },
              ].map((opt) => (
                <button
                  key={opt.value || 'ALL'}
                  type="button"
                  className={`dash-filter-pill ${alertSeverity === opt.value ? 'active' : ''}`}
                  onClick={() => handleSeverityChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="table-responsive">
            <table className="dash-alerts-table">
              <thead>
                <tr>
                  <th>{t('dashboard.col_severity', 'Severity')}</th>
                  <th>{t('dashboard.col_sku_product', 'SKU / Product')}</th>
                  <th>{t('dashboard.col_category', 'Category')}</th>
                  <th>{t('dashboard.col_store', 'Store')}</th>
                  <th className="text-right">{t('dashboard.col_on_hand', 'On-Hand')}</th>
                  <th className="text-right">{t('dashboard.col_on_order', 'On-Order')}</th>
                  <th className="text-right">{t('dashboard.col_ss', 'Safety Stock (SS)')}</th>
                  <th className="text-right">{t('dashboard.col_rop', 'Reorder Point (ROP)')}</th>
                  <th>{t('dashboard.col_suggested_action', 'Backend Suggested Action')}</th>
                  <th>{t('dashboard.col_updated_at', 'Updated At')}</th>
                  <th className="text-right">{t('dashboard.col_action', 'Action')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingTable ? (
                  <tr>
                    <td colSpan={11} className="dash-table-empty">
                      {t('common.loading', 'Loading...')}
                    </td>
                  </tr>
                ) : currentTableItems.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="dash-table-empty">
                      {t(
                        'dashboard.no_traffic_alerts',
                        'No stock alert records match the selected store and severity filter.'
                      )}
                    </td>
                  </tr>
                ) : (
                  currentTableItems.map((row) => {
                    const tone = renderSeverityTone(row.severity);
                    return (
                      <tr key={`${row.store_id}-${row.item_id}`}>
                        <td>
                          <span className={`dash-sev-badge ${tone}`}>{row.severity}</span>
                        </td>
                        <td>
                          <div className="dash-sku-cell">
                            <span className="dash-sku-code">{row.item_id}</span>
                            <span className="dash-sku-name">{row.product_name}</span>
                          </div>
                        </td>
                        <td>{row.category || '—'}</td>
                        <td>
                          <span className="dash-store-chip">{row.store_id}</span>
                        </td>
                        <td className={`text-right font-semibold ${tone === 'critical' ? 'text-danger' : tone === 'warning' ? 'text-warning' : ''}`}>
                          {row.on_hand.toLocaleString()}
                        </td>
                        <td className="text-right">{row.on_order.toLocaleString()}</td>
                        <td className="text-right">{row.safety_stock.toLocaleString()}</td>
                        <td className="text-right">{row.reorder_point.toLocaleString()}</td>
                        <td className="dash-action-note">{row.suggested_action}</td>
                        <td className="dash-updated-cell">
                          {row.updated_at ? new Date(row.updated_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="dash-row-btn"
                            onClick={() => navigate('/replenishment')}
                          >
                            {t('dashboard.order_stock', 'Replenish')}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalTableItems > 0 && (
            <div className="dash-pagination-bar">
              <span className="dash-pagination-info">
                {t('dashboard.showing_records', 'Showing')} {alertOffset + 1}–
                {alertOffset + currentTableItems.length} {t('dashboard.of_records', 'of')}{' '}
                {totalTableItems.toLocaleString()}
              </span>

              <div className="dash-pagination-btns">
                <button
                  type="button"
                  className="dash-page-btn"
                  disabled={alertOffset <= 0 || isLoadingTable}
                  onClick={() => setAlertOffset(Math.max(0, alertOffset - ALERT_PAGE_SIZE))}
                >
                  <ChevronLeft size={14} />
                  <span>{t('dashboard.prev_page', 'Previous')}</span>
                </button>
                <button
                  type="button"
                  className="dash-page-btn"
                  disabled={alertOffset + ALERT_PAGE_SIZE >= totalTableItems || isLoadingTable}
                  onClick={() => setAlertOffset(alertOffset + ALERT_PAGE_SIZE)}
                >
                  <span>{t('dashboard.next_page', 'Next')}</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
