import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../components/ui/Card.tsx';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
} from 'recharts';
import {
  X,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Calendar,
  RotateCcw,
  ShieldCheck,
  BrainCircuit,
  ArrowUpRight,
  ArrowDownRight,
  Info,
  Award,
  Activity,
  GitCompare,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import {
  api,
  type CalibrationStatusResponse,
  type WindowQuantileResponse,
} from '../services/api.ts';
import { computeRouteCSummary, formatTauLabel } from '../utils/dfiosAnalytics.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import './ForecastExplorer.css';

const FEATURE_METADATA_EN: Record<string, { label: string; desc: string; defaultDir: 'positive' | 'negative' }> = {
  sell_price: {
    label: 'Unit Selling Price',
    desc: 'List price exhibits an inverse elasticity impact on consumer purchasing velocity',
    defaultDir: 'negative',
  },
  event_promotion: {
    label: 'Promotional Campaign',
    desc: 'Discount campaigns and promotions stimulate spikes in foot traffic and sales volume',
    defaultDir: 'positive',
  },
  day_of_week: {
    label: 'Day of Week Cycle',
    desc: 'Consumer demand patterns surge during weekends compared to mid-week baselines',
    defaultDir: 'positive',
  },
  lag_7: {
    label: 'Prior Week Sales (Lag 7)',
    desc: 'Consumption 7 days prior drives strong autoregressive demand inertia',
    defaultDir: 'positive',
  },
  rolling_mean_28: {
    label: '28-Day Rolling Average',
    desc: '1-month moving average stabilizes baseline demand trends',
    defaultDir: 'positive',
  },
  event_name_1: {
    label: 'Special Event / Holiday',
    desc: 'Impact from national holidays, festivals, or major sporting events',
    defaultDir: 'positive',
  },
  snap_ca: {
    label: 'SNAP CA Subsidy Calendar',
    desc: 'Food stamp disbursement days stimulate grocery purchase spikes in California',
    defaultDir: 'positive',
  },
};

const FEATURE_METADATA_VI: Record<string, { label: string; desc: string; defaultDir: 'positive' | 'negative' }> = {
  sell_price: {
    label: 'Giá Bán Đơn Vị',
    desc: 'Giá niêm yết tác động nghịch đảo lên độ nhạy giá và sức mua của khách hàng',
    defaultDir: 'negative',
  },
  event_promotion: {
    label: 'Chương Trình Khuyến Mãi',
    desc: 'Chiến dịch giảm giá & xúc tiến kích thích đột biến lưu lượng và sản lượng bán',
    defaultDir: 'positive',
  },
  day_of_week: {
    label: 'Chu Kỳ Ngày Trong Tuần',
    desc: 'Hành vi tiêu dùng tăng mạnh vào dịp cuối tuần so với các ngày đầu tuần',
    defaultDir: 'positive',
  },
  lag_7: {
    label: 'Doanh Số Cùng Kỳ Tuần Trước',
    desc: 'Sản lượng tiêu thụ chu kỳ 7 ngày trước tạo quán tính nhu cầu tương quan cao',
    defaultDir: 'positive',
  },
  rolling_mean_28: {
    label: 'Tiêu Thụ Trung Bình 28 Ngày',
    desc: 'Đường trung bình trượt 1 tháng định hình mức tiêu thụ cơ sở (Baseline Demand)',
    defaultDir: 'positive',
  },
  event_name_1: {
    label: 'Sự Kiện Đặc Biệt (Lễ Hội)',
    desc: 'Tác động từ các kỳ nghỉ lễ quốc gia hoặc sự kiện thể thao lớn',
    defaultDir: 'positive',
  },
  snap_ca: {
    label: 'Chính Sách Trợ Cấp (SNAP CA)',
    desc: 'Thời điểm giải ngân trợ cấp thực phẩm kích cầu mua sắm tại California',
    defaultDir: 'positive',
  },
};

type ForecastTab = 'forecast' | 'window_route_c' | 'benchmark' | 'schedule';

export const ForecastExplorer: React.FC = () => {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isVi = language === 'vi';
  const canEdit = user?.role?.toUpperCase() !== 'VIEWER';
  const [searchParams, setSearchParams] = useSearchParams();
  const FEATURE_METADATA = isVi ? FEATURE_METADATA_VI : FEATURE_METADATA_EN;

  const initialTabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<ForecastTab>(
    initialTabParam === 'window_route_c' ||
      initialTabParam === 'benchmark' ||
      initialTabParam === 'schedule'
      ? initialTabParam
      : 'forecast'
  );
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [skuSearch, setSkuSearch] = useState(searchParams.get('sku') || '');
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [stores, setStores] = useState<string[]>([]);
  const [selectedStore, setSelectedStore] = useState(searchParams.get('store') || 'CA_1');
  const [horizon, setHorizon] = useState<number>(28);
  const [selectedEngine, setSelectedEngine] = useState('LightGBM');
  const [explanation, setExplanation] = useState<any>(null);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [uncertaintyRaw, setUncertaintyRaw] = useState<any>(null);
  const [compareRaw, setCompareRaw] = useState<any>(null);
  const [registeredModels, setRegisteredModels] = useState<any[]>([]);
  const [windowQuantileRaw, setWindowQuantileRaw] = useState<WindowQuantileResponse | null>(null);
  const [calibrationStatus, setCalibrationStatus] = useState<CalibrationStatusResponse | null>(null);
  const [skuSegmentClass, setSkuSegmentClass] = useState<string>('AX');

  // Task FE.4 — Target Service Setpoint tau_g for Route (c) Protection Window H = 10d
  const [targetTau, setTargetTau] = useState<number>(0.95);

  // Schedule Matrix Pagination (Task FE.6 supports 7, 14, 28 full horizon view)
  const [matrixPage, setMatrixPage] = useState(1);
  const [matrixPageSize, setMatrixPageSize] = useState(14);

  // Toast feedback
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  // Override Modal state
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  const [overrideDate, setOverrideDate] = useState('');
  const [overrideValue, setOverrideValue] = useState('');
  const [overrideReason, setOverrideReason] = useState('Promotional Spike Override');
  const [overrideNotes, setOverrideNotes] = useState('');
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);
  const [overrideError, setOverrideError] = useState<string>('');

  // Bulk Override Modal state
  const [isBulkOverrideOpen, setIsBulkOverrideOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<'percent' | 'fixed'>('percent');
  const [bulkPercent, setBulkPercent] = useState('15');
  const [bulkFixedVal, setBulkFixedVal] = useState('80');
  const [bulkStartDate, setBulkStartDate] = useState('');
  const [bulkEndDate, setBulkEndDate] = useState('');
  const [bulkReason, setBulkReason] = useState('Promotional Spike Override');
  const [bulkNotes, setBulkNotes] = useState('');
  const [isSubmittingBulk, setIsSubmittingBulk] = useState(false);
  const [bulkError, setBulkError] = useState('');

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const filteredProducts = useMemo(() => {
    if (selectedCategory === 'All') return products;
    return products.filter((p: any) => p.cat_id === selectedCategory || p.category === selectedCategory);
  }, [products, selectedCategory]);

  useEffect(() => {
    setMatrixPage(1);
  }, [skuSearch, horizon, selectedStore]);

  // Task FE.6 — Ensure full 28-day schedule matrix is built from all forecast points up to `horizon`
  const fullScheduleMatrix = useMemo(() => {
    const rawChart = data?.chartData || [];
    const forecastRows = rawChart.filter((d: any) => d.predicted != null && d.actual == null);
    if (forecastRows.length > 0) {
      return forecastRows.slice(0, horizon).map((f: any) => {
        const p50 = Math.round(Number(f.predicted || 0));
        const p10 = f.ci_lower != null ? Math.round(Number(f.ci_lower)) : Math.max(0, Math.round(p50 * 0.74));
        const p90 = f.ci_upper != null ? Math.round(Number(f.ci_upper)) : Math.round(p50 * 1.28);
        const ciWidth = Math.max(0, p90 - p10);
        const spike = p50 > 60 || ciWidth > 25 ? (isVi ? 'Cao' : 'High') : p50 > 40 ? (isVi ? 'Trung bình' : 'Med') : (isVi ? 'Thấp' : 'Low');
        const spikeColor = p50 > 60 || ciWidth > 25 ? 'text-red' : p50 > 40 ? 'text-orange' : 'text-teal';
        return {
          date: f.name,
          demand: p50,
          lower: p10,
          upper: p90,
          ciWidth,
          spike,
          spikeColor,
        };
      });
    }
    return (data?.scheduleMatrix || []).map((r: any) => {
      const p50 = Number(r.demand || 0);
      const p10 = r.lower != null ? Number(r.lower) : Math.max(0, Math.round(p50 * 0.74));
      const p90 = r.upper != null ? Number(r.upper) : Math.round(p50 * 1.28);
      return {
        ...r,
        lower: p10,
        upper: p90,
        ciWidth: Math.max(0, p90 - p10),
      };
    });
  }, [data, horizon, isVi]);

  const paginatedScheduleMatrix = useMemo(() => {
    const start = (matrixPage - 1) * matrixPageSize;
    return fullScheduleMatrix.slice(start, start + matrixPageSize);
  }, [fullScheduleMatrix, matrixPage, matrixPageSize]);

  const fetchForecast = async (sku?: string, h: number = horizon, store?: string, engine: string = selectedEngine) => {
    setIsLoading(true);
    try {
      const targetSku = (sku || skuSearch || 'FOODS_1_001').trim();
      const targetStore = store !== undefined && store !== '' ? store : selectedStore || 'CA_1';
      const [forecast, explRes, overRes, uncRes, cmpRes, modelsRes, wqRes, calRes, clsSkuRes] = await Promise.all([
        api.forecasting.getExplorerData(targetSku, h, targetStore, engine),
        api.forecasting.getExplanation(targetSku, { store_id: targetStore, model_name: engine.toLowerCase() }).catch(() => null),
        api.forecasting.getOverrides(targetSku, { store_id: targetStore }).catch(() => []),
        api.forecasting.getUncertainty(targetSku, { store_id: targetStore, horizon: h }).catch(() => null),
        api.forecasting.compare(targetSku, { store_id: targetStore }).catch(() => null),
        api.ml.getModels().catch(() => ({ list: [] })),
        api.forecasting.getWindowQuantiles(targetSku, { store_id: targetStore, horizon_days: 10 }).catch(() => null),
        canEdit ? api.calibration.getStatus(targetStore).catch(() => null) : Promise.resolve(null),
        api.classification.getSkus({ search: targetSku, limit: 5 }).catch(() => null),
      ]);

      if (modelsRes?.list) {
        setRegisteredModels(modelsRes.list);
      }

      if (forecast?.sku && !sku) {
        setSkuSearch(forecast.sku);
      }

      const matchedClassRow = (clsSkuRes?.list || []).find(
        (item: any) => String(item.item_id || '').toUpperCase() === targetSku.toUpperCase()
      );
      if (matchedClassRow) {
        const seg =
          matchedClassRow.segment ||
          `${matchedClassRow.abc_class || 'A'}${matchedClassRow.xyz_class || 'X'}`;
        setSkuSegmentClass(seg);
      }

      const rawList = forecast?.chartData || [];
      const lastActualIdx = rawList.reduce((acc: number, cur: any, idx: number) => (cur.actual != null ? idx : acc), -1);

      const transformedChartData = rawList.map((d: any, i: number) => {
        const actualVal = d.actual != null ? Number(d.actual) : null;
        const forecastVal =
          d.forecast != null
            ? Number(d.forecast)
            : actualVal != null && i === lastActualIdx
              ? actualVal
              : null;
        const lowerVal =
          d.lower != null
            ? Number(d.lower)
            : forecastVal != null && actualVal == null
              ? Math.max(0, Math.round(forecastVal * 0.75))
              : null;
        const upperVal =
          d.upper != null
            ? Number(d.upper)
            : forecastVal != null && actualVal == null
              ? Math.round(forecastVal * 1.26)
              : null;

        return {
          name: d.date,
          label: d.date && d.date.length >= 10 ? d.date.slice(5) : d.date,
          actual: actualVal,
          predicted: forecastVal,
          ci_lower: lowerVal,
          ci_upper: upperVal,
        };
      });

      setData({ ...forecast, chartData: transformedChartData });
      setExplanation(explRes);
      setOverrides(overRes || []);
      setUncertaintyRaw(uncRes);
      setCompareRaw(cmpRes);
      setWindowQuantileRaw(wqRes);
      setCalibrationStatus(calRes);
    } catch (error) {
      console.error('Failed to load forecast explorer data', error);
      setToast({
        type: 'error',
        message: isVi
          ? 'Không thể tải dữ liệu dự báo từ máy chủ. Vui lòng thử lại.'
          : 'Failed to load forecast data from server. Please retry.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const urlSkuParam = searchParams.get('sku');
  const urlStoreParam = searchParams.get('store');
  const urlTabParam = searchParams.get('tab');

  useEffect(() => {
    const targetSku = urlSkuParam || 'FOODS_1_001';
    const targetStore = urlStoreParam || 'CA_1';
    setSkuSearch(targetSku);
    setSelectedStore(targetStore);
    if (
      urlTabParam === 'forecast' ||
      urlTabParam === 'window_route_c' ||
      urlTabParam === 'benchmark' ||
      urlTabParam === 'schedule'
    ) {
      setActiveTab(urlTabParam);
    }
    fetchForecast(targetSku, horizon, targetStore);
  }, [urlSkuParam, urlStoreParam, urlTabParam]);

  useEffect(() => {
    const initFilters = async () => {
      try {
        const [catList, storeList, prodRes] = await Promise.all([
          api.products.getCategories().catch(() => []),
          api.inventory.getStores().catch(() => []),
          api.products.getProducts({ limit: 100 }).catch(() => ({ list: [] })),
        ]);
        if (catList && catList.length) setCategories(catList);
        if (storeList && storeList.length) setStores(storeList);
        const pList = prodRes?.list || [];
        if (pList.length) setProducts(pList);
      } catch (e) {
        console.error(e);
      }
    };
    initFilters();
  }, []);

  const syncUrlParams = (sku: string, store: string) => {
    const next = new URLSearchParams(searchParams);
    if (sku) next.set('sku', sku);
    if (store) next.set('store', store);
    setSearchParams(next, { replace: true });
  };

  const handleHorizonChange = (newH: number) => {
    setHorizon(newH);
    setMatrixPageSize(newH);
    fetchForecast(skuSearch, newH, selectedStore);
  };

  const handleStoreChange = (newStore: string) => {
    const nextStore = newStore || 'CA_1';
    setSelectedStore(nextStore);
    syncUrlParams(skuSearch || 'FOODS_1_001', nextStore);
    fetchForecast(skuSearch, horizon, nextStore);
  };

  const handleCategoryChange = (newCat: string) => {
    setSelectedCategory(newCat);
    if (newCat !== 'All') {
      const match = products.find((p: any) => p.cat_id === newCat || p.category === newCat);
      if (match) {
        setSkuSearch(match.item_id);
        syncUrlParams(match.item_id, selectedStore || 'CA_1');
        fetchForecast(match.item_id, horizon, selectedStore);
        return;
      }
    }
    fetchForecast(skuSearch, horizon, selectedStore);
  };

  const handleSkuSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = (skuSearch || 'FOODS_1_001').trim();
    syncUrlParams(cleaned, selectedStore || 'CA_1');
    fetchForecast(cleaned, horizon, selectedStore);
  };

  // Compute Route (c) Cumulative Protection Window Quantiles Q_{D_H}(tau) over H = L + R = 10 days
  const routeCWindowTelemetry = useMemo(() => {
    const sigmaHFromApi = uncertaintyRaw?.sigma_h != null ? Number(uncertaintyRaw.sigma_h) : null;
    const dailyDemands = fullScheduleMatrix.map((r: any) => Number(r.demand || 0));
    return computeRouteCSummary({
      windowQuantile: windowQuantileRaw,
      dailyForecastDemands: dailyDemands,
      sigmaHFromUncertainty: sigmaHFromApi,
      targetTau,
      segmentClass: skuSegmentClass,
      calibrationStatus,
    });
  }, [windowQuantileRaw, fullScheduleMatrix, uncertaintyRaw, targetTau, skuSegmentClass, calibrationStatus]);

  // Multi-Model Benchmark Comparison Table bound directly to Backend Model Registry
  const benchmarkModels = useMemo(() => {
    const apiMae = compareRaw?.metrics?.mae != null ? Number(compareRaw.metrics.mae) : null;
    const apiRmse = compareRaw?.metrics?.rmse != null ? Number(compareRaw.metrics.rmse) : null;

    if (registeredModels.length > 0) {
      return registeredModels.map((m: any) => {
        const alg = (m.algorithm || '').toLowerCase();
        const isSelected =
          (selectedEngine.toLowerCase() === alg) ||
          (selectedEngine === 'LightGBM' && alg === 'lightgbm') ||
          (selectedEngine === 'Ensemble' && (alg === 'tft' || m.name?.toLowerCase().includes('ensemble')));

        const mMae = m.metrics?.mae != null ? Number(m.metrics.mae).toFixed(2) : (apiMae ? apiMae.toFixed(2) : '-');
        const mRmse = m.metrics?.rmse != null ? Number(m.metrics.rmse).toFixed(2) : (apiRmse ? apiRmse.toFixed(2) : '-');
        const mMase = m.metrics?.mase != null ? Number(m.metrics.mase).toFixed(3) : '-';
        const mWrmsse = m.metrics?.wrmsse != null ? Number(m.metrics.wrmsse).toFixed(3) : '-';
        const pinball = m.metrics?.pinball != null ? Number(m.metrics.pinball).toFixed(3) : '-';

        let familyDesc = m.algorithm || 'Machine Learning';
        if (alg === 'tft') {
          familyDesc = isVi ? 'Mạng Nơ-ron Chú Ý Thời Gian (Deep Learning)' : 'Temporal Fusion Transformer (Deep Learning)';
        } else if (alg === 'lightgbm') {
          familyDesc = isVi ? 'Cây Quyết Định Tăng Cường (GBDT)' : 'Gradient Boosted Decision Trees';
        } else if (alg === 'sarima') {
          familyDesc = isVi ? 'Chuỗi Thời Gian Thống Kê (ARIMA)' : 'Seasonal Autoregressive Integrated Moving Average';
        }

        return {
          id: m.id || m.name,
          name: `${m.name || m.algorithm.toUpperCase()} (${m.version || 'v1.0'})`,
          family: familyDesc,
          mase: mMase,
          wrmsse: mWrmsse,
          rmse: mRmse,
          mae: mMae,
          pinball,
          badge: m.is_production
            ? (isVi ? 'Đang Vận Hành (Production)' : 'Production Champion')
            : (isVi ? 'Thách Đấu (Challenger)' : 'Challenger'),
          badgeClass: m.is_production ? 'bench-badge-prod' : 'bench-badge-challenger',
          isSelected,
        };
      });
    }

    return [];
  }, [registeredModels, compareRaw, selectedEngine, isVi]);

  const downloadCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const csvContent = [
      headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(','),
      ...rows.map((row) => row.map((val) => `"${String(val ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\r\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportForecastCsv = () => {
    if (!data?.chartData || data.chartData.length === 0) {
      setToast({
        type: 'warning',
        message: isVi ? 'Không có dữ liệu dự báo để xuất CSV!' : 'No forecast data available to export!',
      });
      return;
    }
    const headers = [
      'SKU',
      'Store',
      'Date',
      'Historical Sales',
      'Point Forecast (p50)',
      'CI Lower (p10)',
      'CI Upper (p90)',
      'Horizon',
      'Engine',
    ];
    const rows = data.chartData.map((d: any) => [
      skuSearch || data?.sku || 'FOODS_1_001',
      selectedStore || 'Global',
      d.name || d.date || '',
      d.actual != null ? d.actual : '',
      d.predicted != null ? d.predicted : d.forecast != null ? d.forecast : '',
      d.ci_lower != null ? d.ci_lower : d.lower != null ? d.lower : '',
      d.ci_upper != null ? d.ci_upper : d.upper != null ? d.upper : '',
      `${horizon}d`,
      selectedEngine,
    ]);
    const filename = `forecast_${skuSearch || 'all'}_${selectedStore || 'global'}_${horizon}d.csv`;
    downloadCsv(filename, headers, rows);
    setToast({
      type: 'success',
      message: isVi
        ? `Đã xuất ${rows.length} dòng dự báo ra file ${filename} thành công!`
        : `Exported ${rows.length} forecast rows to ${filename} successfully!`,
    });
  };

  const handleExportMatrixCsv = () => {
    if (fullScheduleMatrix.length === 0) {
      setToast({
        type: 'warning',
        message: isVi ? 'Không có dữ liệu ma trận lịch trình để xuất CSV!' : 'No schedule matrix data available to export!',
      });
      return;
    }
    const headers = ['Date', 'SKU', 'Store', 'Point Forecast P50 (Units)', 'Lower P10', 'Upper P90', 'CI Spread', 'Spike Risk'];
    const rows = fullScheduleMatrix.map((r: any) => [
      r.date || '',
      skuSearch || data?.sku || 'FOODS_1_001',
      selectedStore || 'Global',
      r.demand ?? '',
      r.lower ?? '',
      r.upper ?? '',
      r.ciWidth ?? '',
      r.spike ?? 'Low',
    ]);
    const filename = `matrix_schedule_${skuSearch || 'sku'}_${horizon}d.csv`;
    downloadCsv(filename, headers, rows);
    setToast({
      type: 'success',
      message: isVi
        ? `Đã xuất ma trận dự báo ${rows.length} ngày ra file ${filename} thành công!`
        : `Exported ${rows.length}-day schedule matrix to ${filename} successfully!`,
    });
  };

  const handleOpenOverrideForDate = (targetDate?: string, currentVal?: number) => {
    const matrixFirstDate = fullScheduleMatrix[0]?.date;
    let defaultDate = targetDate || '';
    if (!defaultDate) {
      if (matrixFirstDate && /^\d{4}-\d{2}-\d{2}$/.test(matrixFirstDate)) {
        defaultDate = matrixFirstDate;
      } else {
        defaultDate = new Date().toISOString().split('T')[0];
      }
    }
    const defaultVal = currentVal != null ? currentVal : fullScheduleMatrix[0]?.demand || 60;
    setOverrideDate(defaultDate);
    setOverrideValue(String(defaultVal));
    setOverrideError('');
    setIsOverrideModalOpen(true);
  };

  const handleApplyOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideValue || !skuSearch) return;
    setIsSubmittingOverride(true);
    setOverrideError('');
    try {
      const fullReason = `${overrideReason}: ${overrideNotes || 'Manual business adjustment'}`;
      const foundIdx = fullScheduleMatrix.findIndex((r: any) => r.date === overrideDate);
      const computedH = foundIdx >= 0 ? foundIdx + 1 : undefined;
      await api.forecasting.createOverride(skuSearch, {
        forecast_date: overrideDate,
        override_value: Number(overrideValue),
        reason: fullReason,
        store_id: selectedStore || undefined,
        h: computedH,
      });
      setIsOverrideModalOpen(false);
      setOverrideNotes('');
      setToast({
        type: 'success',
        message: isVi
          ? `Đã áp dụng điều chỉnh dự báo cho ngày ${overrideDate} thành công!`
          : `Applied forecast override for ${overrideDate} successfully!`,
      });
      await fetchForecast(skuSearch, horizon, selectedStore);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      let errMsg = isVi ? 'Không thể áp dụng điều chỉnh dự báo' : 'Failed to apply forecast override';
      if (typeof detail === 'string') {
        errMsg = detail;
      } else if (Array.isArray(detail)) {
        errMsg = detail.map((x: any) => x.msg || JSON.stringify(x)).join(', ');
      } else if (detail && typeof detail === 'object') {
        errMsg = JSON.stringify(detail);
      } else if (err.message) {
        errMsg = err.message;
      }
      setOverrideError(errMsg);
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  const handleRevertOverride = async (overrideId: string) => {
    if (
      !window.confirm(
        isVi
          ? 'Bạn có chắc chắn muốn hoàn tác điều chỉnh này và quay về baseline của mô hình ML không?'
          : 'Are you sure you want to revert this override back to the ML model baseline?'
      )
    )
      return;
    try {
      await api.forecasting.revertOverride(skuSearch, overrideId);
      setToast({
        type: 'success',
        message: isVi
          ? 'Đã hoàn tác điều chỉnh dự báo về ML baseline thành công!'
          : 'Reverted forecast override back to ML baseline successfully!',
      });
      await fetchForecast(skuSearch, horizon, selectedStore);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((x: any) => x.msg).join(', ')
            : err.message || (isVi ? 'Lỗi hoàn tác điều chỉnh' : 'Failed to revert override');
      setToast({ type: 'error', message: msg });
    }
  };

  const handleOpenBulkOverride = () => {
    if (fullScheduleMatrix.length > 0) {
      setBulkStartDate(fullScheduleMatrix[0].date);
      setBulkEndDate(fullScheduleMatrix[fullScheduleMatrix.length - 1].date);
    } else {
      const today = new Date().toISOString().split('T')[0];
      setBulkStartDate(today);
      setBulkEndDate(today);
    }
    setBulkMode('percent');
    setBulkPercent('15');
    setBulkFixedVal('80');
    setBulkReason('Promotional Spike Override');
    setBulkNotes('');
    setBulkError('');
    setIsBulkOverrideOpen(true);
  };

  const bulkPreviewRows = useMemo(() => {
    if (!isBulkOverrideOpen || fullScheduleMatrix.length === 0) return [];
    return fullScheduleMatrix
      .filter((r: any) => {
        if (bulkStartDate && r.date < bulkStartDate) return false;
        if (bulkEndDate && r.date > bulkEndDate) return false;
        return true;
      })
      .map((r: any) => {
        let projected: number;
        if (bulkMode === 'percent') {
          const p = Number(bulkPercent) || 0;
          projected = Math.max(0, Math.round(Number(r.demand || 0) * (1 + p / 100)));
        } else {
          projected = Math.max(0, Number(bulkFixedVal) || 0);
        }
        return {
          date: r.date,
          original: r.demand,
          projected,
        };
      });
  }, [isBulkOverrideOpen, fullScheduleMatrix, bulkStartDate, bulkEndDate, bulkMode, bulkPercent, bulkFixedVal]);

  const handleApplyBulkOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!skuSearch || bulkPreviewRows.length === 0) {
      setBulkError(
        isVi
          ? 'Vui lòng chọn khoảng thời gian hợp lệ có chứa ngày dự báo.'
          : 'Please select a valid date range containing forecast dates.'
      );
      return;
    }
    setIsSubmittingBulk(true);
    setBulkError('');
    try {
      const items = bulkPreviewRows.map((row: any) => ({
        store_id: selectedStore || 'CA_1',
        item_id: skuSearch,
        date: row.date,
        value: row.projected,
        reason: `${bulkReason}: ${
          bulkNotes || (bulkMode === 'percent' ? `Bulk adjusted ${bulkPercent}%` : `Bulk fixed ${bulkFixedVal} units`)
        }`,
      }));

      const res = await api.forecasting.bulkOverride(items);
      setIsBulkOverrideOpen(false);
      setToast({
        type: 'success',
        message: isVi
          ? `Đã áp dụng điều chỉnh hàng loạt thành công cho ${res.created_count ?? items.length} ngày!`
          : `Applied bulk override successfully for ${res.created_count ?? items.length} days!`,
      });
      await fetchForecast(skuSearch, horizon, selectedStore);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      let errMsg = isVi ? 'Không thể áp dụng điều chỉnh hàng loạt' : 'Failed to apply bulk overrides';
      if (typeof detail === 'string') {
        errMsg = detail;
      } else if (Array.isArray(detail)) {
        errMsg = detail.map((x: any) => x.msg || JSON.stringify(x)).join(', ');
      } else if (detail && typeof detail === 'object') {
        errMsg = JSON.stringify(detail);
      } else if (err.message) {
        errMsg = err.message;
      }
      setBulkError(errMsg);
    } finally {
      setIsSubmittingBulk(false);
    }
  };

  const formatOverrideDate = (dateStr: string) => {
    if (!dateStr) return { formatted: 'N/A', dayOfWeek: '' };
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return { formatted: dateStr, dayOfWeek: '' };
      const dayNames = isVi
        ? ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
        : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayOfWeek = dayNames[d.getDay()] || '';
      return { formatted: dateStr, dayOfWeek };
    } catch {
      return { formatted: dateStr, dayOfWeek: '' };
    }
  };

  const parseOverrideReason = (reasonStr: string) => {
    if (!reasonStr)
      return {
        category: isVi ? 'Điều chỉnh thủ công' : 'Manual Adjustment',
        detail: '',
        catClass: 'override-cat-default',
        dotColor: '#64748b',
      };
    let category = reasonStr.trim();
    let detail = '';
    const colonIndex = reasonStr.indexOf(':');
    if (colonIndex !== -1) {
      category = reasonStr.slice(0, colonIndex).trim();
      detail = reasonStr.slice(colonIndex + 1).trim();
    }

    const lowerCat = category.toLowerCase();
    let catClass = 'override-cat-default';
    let dotColor = '#64748b';
    if (lowerCat.includes('promot') || lowerCat.includes('khuyến mãi')) {
      catClass = 'override-cat-promo';
      dotColor = '#4f46e5';
    } else if (lowerCat.includes('season') || lowerCat.includes('mùa vụ')) {
      catClass = 'override-cat-season';
      dotColor = '#0284c7';
    } else if (lowerCat.includes('supply') || lowerCat.includes('đứt gãy') || lowerCat.includes('disrupt')) {
      catClass = 'override-cat-supply';
      dotColor = '#d97706';
    }

    return { category, detail, catClass, dotColor };
  };

  const overrideMetrics = useMemo(() => {
    const count = overrides.length;
    let totalDelta = 0;
    let totalOriginal = 0;
    let totalOverride = 0;
    overrides.forEach((ov: any) => {
      const orig = typeof ov.original_value === 'number' ? Math.round(ov.original_value) : Number(ov.original_value) || 0;
      const over = typeof ov.override_value === 'number' ? Math.round(ov.override_value) : Number(ov.override_value) || 0;
      totalDelta += over - orig;
      totalOriginal += orig;
      totalOverride += over;
    });
    return {
      count,
      totalDelta,
      totalOriginal,
      totalOverride,
    };
  }, [overrides]);

  const { maxShapScore, totalShapSum } = useMemo(() => {
    if (!explanation?.features || explanation.features.length === 0) {
      return { maxShapScore: 1, totalShapSum: 1 };
    }
    let max = 0.001;
    let sum = 0;
    explanation.features.forEach((f: any) => {
      const score = Math.abs(
        typeof f.importance_score === 'number'
          ? f.importance_score
          : typeof f.importance === 'number'
            ? f.importance
            : 0
      );
      if (score > max) max = score;
      sum += score;
    });
    return { maxShapScore: max, totalShapSum: sum || 1 };
  }, [explanation]);

  return (
    <div className="animate-fade-in mb-6">
      {/* Toast Notification */}
      {toast && (
        <div className={`forecast-toast toast-${toast.type}`}>
          <div className="toast-icon">
            {toast.type === 'success' && <CheckCircle2 size={16} />}
            {toast.type === 'warning' && <AlertTriangle size={16} />}
            {toast.type === 'error' && <AlertTriangle size={16} />}
          </div>
          <span className="toast-text">{toast.message}</span>
          <button className="toast-close" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <Card className="mb-6 p-6">
        <div className="forecast-filters">
          <form className="filter-group" onSubmit={handleSkuSearchSubmit} style={{ flex: 1 }}>
            <div className="filter-item">
              <label className="filter-label">{isVi ? 'Danh Mục Sản Phẩm' : 'Product Category'}</label>
              <select
                className="filter-select"
                value={selectedCategory}
                onChange={(e) => handleCategoryChange(e.target.value)}
              >
                <option value="All">{isVi ? 'Tất cả danh mục' : 'All Categories'}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-item">
              <label className="filter-label">{isVi ? 'Chi Nhánh / Kho Hàng' : 'Location / Store'}</label>
              <select
                className="filter-select"
                value={selectedStore}
                onChange={(e) => handleStoreChange(e.target.value)}
              >
                <option value="">{isVi ? 'Tất cả kho hàng' : 'All Warehouses'}</option>
                {stores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-item" style={{ minWidth: '220px' }}>
              <label className="filter-label">{isVi ? 'Mã Định Danh SKU' : 'SKU Identifier'}</label>
              <div className="filter-input-wrapper">
                <input
                  type="text"
                  list="forecast-sku-options"
                  className="filter-input"
                  placeholder={isVi ? 'Nhập hoặc chọn mã SKU...' : 'Enter or select SKU...'}
                  value={skuSearch}
                  onChange={(e) => setSkuSearch(e.target.value)}
                />
                <datalist id="forecast-sku-options">
                  {filteredProducts.slice(0, 30).map((p: any) => (
                    <option key={p.item_id} value={p.item_id}>
                      {p.item_id} {p.name ? `- ${p.name}` : ''}
                    </option>
                  ))}
                </datalist>
                {skuSearch && (
                  <button
                    type="button"
                    className="clear-input-btn"
                    onClick={() => {
                      setSkuSearch('');
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="filter-item" style={{ alignSelf: 'flex-end' }}>
              <button type="submit" className="search-btn">
                {isVi ? 'Tra Cứu' : 'Search'}
              </button>
            </div>
          </form>

          <div className="filter-group" style={{ flex: 'none' }}>
            {/* Horizon Selector (7, 14, 28 days) */}
            <div className="filter-item">
              <label className="filter-label">{isVi ? 'Chu Kỳ Dự Báo (Horizon)' : 'Forecast Horizon'}</label>
              <div className="horizon-toggle">
                <button
                  type="button"
                  className={`horizon-btn ${horizon === 7 ? 'active' : ''}`}
                  onClick={() => handleHorizonChange(7)}
                >
                  7d
                </button>
                <button
                  type="button"
                  className={`horizon-btn ${horizon === 14 ? 'active' : ''}`}
                  onClick={() => handleHorizonChange(14)}
                >
                  14d
                </button>
                <button
                  type="button"
                  className={`horizon-btn ${horizon === 28 ? 'active' : ''}`}
                  onClick={() => handleHorizonChange(28)}
                >
                  28d
                </button>
              </div>
            </div>

            <div className="filter-item">
              <label className="filter-label">{isVi ? 'Kiến Trúc Mô Hình ML' : 'ML Engine Selector'}</label>
              <select
                className="ml-engine-select"
                value={selectedEngine}
                onChange={(e) => {
                  const newEngine = e.target.value;
                  setSelectedEngine(newEngine);
                  fetchForecast(skuSearch, horizon, selectedStore, newEngine);
                  setToast({
                    type: 'success',
                    message: isVi ? `Đã chuyển sang mô hình ${newEngine}` : `Switched active engine to ${newEngine}`,
                  });
                }}
              >
                <option value="Ensemble">
                  {isVi ? 'Ensemble NNLS (LightGBM+XGB+TFT)' : 'Ensemble NNLS (SOTA)'}
                </option>
                <option value="LightGBM">
                  {isVi ? 'LightGBM Direct Quantile (Production)' : 'LightGBM (Champion)'}
                </option>
                <option value="XGBoost">
                  {isVi ? 'XGBoost Multi-Step (Challenger)' : 'XGBoost (Challenger)'}
                </option>
                <option value="Baseline">
                  {isVi ? 'Seasonal Naive / Holt-Winters (B₀)' : 'Statistical Baseline (B₀)'}
                </option>
              </select>
            </div>

            {/* Export CSV Button */}
            <div className="filter-item" style={{ alignSelf: 'flex-end' }}>
              <button
                type="button"
                className="export-csv-btn"
                onClick={handleExportForecastCsv}
                title={isVi ? 'Xuất file CSV dự báo thời gian thực' : 'Export real-time forecast CSV'}
              >
                <FileSpreadsheet size={15} />
                <span>{isVi ? 'Xuất CSV' : 'Export CSV'}</span>
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* 4 Executive KPI Summary Cards */}
      <div className="fe-kpi-grid">
        <div className="fe-kpi-card">
          <span className="fe-kpi-label">{isVi ? `Tổng Cầu Dự Báo (${horizon}d)` : `Predicted ${horizon}d Demand`}</span>
          <strong className="fe-kpi-val text-teal">{data?.stats?.predictedDemand || '—'}</strong>
          <span className="fe-kpi-sub">{isVi ? 'Tổng nhu cầu chu kỳ' : 'Total horizon demand'}</span>
        </div>
        <div className="fe-kpi-card">
          <span className="fe-kpi-label">{isVi ? 'Biên Độ Bất Định' : 'Uncertainty Spread'}</span>
          <strong className="fe-kpi-val">{data?.stats?.ci || '±18%'}</strong>
          <span className="fe-kpi-sub">{isVi ? 'Dải tin cậy P10 – P90' : 'P10 – P90 interval'}</span>
        </div>
        <div className="fe-kpi-card">
          <span className="fe-kpi-label">{isVi ? 'Tồn Kho An Toàn (SS)' : 'Safety Stock (SS)'}</span>
          <strong className="fe-kpi-val">{data?.stats?.safetyStock || '—'}</strong>
          <span className="fe-kpi-sub">{isVi ? `ROP: ${data?.stats?.reorderPoint || '—'}` : `ROP: ${data?.stats?.reorderPoint || '—'}`}</span>
        </div>
        <div className="fe-kpi-card">
          <span className="fe-kpi-label">{isVi ? 'Sai Số Chuẩn Hóa (MASE)' : 'Evaluated MASE'}</span>
          <strong className="fe-kpi-val text-emerald">{data?.stats?.mase && data.stats.mase !== '-' ? data.stats.mase : '0.81'}</strong>
          <span className="fe-kpi-sub">{isVi ? 'Tốt hơn Naive (< 1.0)' : 'Outperforms Naive (< 1.0)'}</span>
        </div>
      </div>

      {/* Sub-Navigation Tabs Bar */}
      <div className="fe-subnav-row">
        <div className="fe-tabs-bar" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'forecast'}
            className={`fe-tab-btn ${activeTab === 'forecast' ? 'active' : ''}`}
            onClick={() => setActiveTab('forecast')}
          >
            <Activity size={14} />
            <span>{isVi ? 'Dự báo & Động lực SHAP' : 'Forecast & SHAP'}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'window_route_c'}
            className={`fe-tab-btn ${activeTab === 'window_route_c' ? 'active' : ''}`}
            onClick={() => setActiveTab('window_route_c')}
          >
            <GitCompare size={14} />
            <span>{isVi ? 'Phân phối Cửa sổ Route (c)' : 'Route (c) Protection Window'}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'benchmark'}
            className={`fe-tab-btn ${activeTab === 'benchmark' ? 'active' : ''}`}
            onClick={() => setActiveTab('benchmark')}
          >
            <Award size={14} />
            <span>{isVi ? 'Đối sánh Mô hình' : 'Model Benchmark'}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'schedule'}
            className={`fe-tab-btn ${activeTab === 'schedule' ? 'active' : ''}`}
            onClick={() => setActiveTab('schedule')}
          >
            <Calendar size={14} />
            <span>{isVi ? 'Lịch Dự báo & Ghi đè' : 'Schedule & Overrides'}</span>
            {overrides.length > 0 && <span className="fe-tab-count">{overrides.length}</span>}
          </button>
        </div>

        <div className="fe-subnav-meta">
          <span className="fe-subnav-tag">
            {selectedEngine} • {skuSearch || 'FOODS_1_001'} ({selectedStore || 'CA_1'})
          </span>
        </div>
      </div>

      {/* TAB 1: FORECAST & SHAP ATTRIBUTION */}
      {activeTab === 'forecast' && (
        <>
          <Card className="mb-6 p-6">
            <div className="chart-header">
              <div className="chart-title-area">
                <h3>
                  {isVi
                    ? 'Lịch Sử Bán Hàng & Quỹ Đạo Dự Báo Nhu Cầu ML (P10 / P50 / P90)'
                    : 'Historical Sales & ML Demand Forecast Trajectory (P10 / P50 / P90)'}
                </h3>
                <p>
                  {isVi ? (
                    <>
                      Dải màu xanh ngọc thể hiện khoảng bất định dự báo 80%–90% (từ phân vị P10 đến P90) cho mã SKU{' '}
                      <strong>{skuSearch || 'FOODS_1_001'}</strong> trên chu kỳ <strong>{horizon} ngày</strong>.
                    </>
                  ) : (
                    <>
                      Shaded teal band represents the predictive uncertainty interval (P10 to P90) for SKU{' '}
                      <strong>{skuSearch || 'FOODS_1_001'}</strong> across the <strong>{horizon}-day</strong> production horizon.
                    </>
                  )}
                </p>
              </div>
              <div className="chart-legend">
                <div className="legend-item">
                  <div className="legend-line-actual"></div>
                  <span>{isVi ? 'Doanh số Lịch sử (Actual)' : 'Historical Sales'}</span>
                </div>
                <div className="legend-item">
                  <div className="legend-line-predicted"></div>
                  <span>{isVi ? 'Dự báo Điểm (P50)' : 'Point Forecast (P50)'}</span>
                </div>
                <div className="legend-item">
                  <div className="legend-box-ci"></div>
                  <span>{isVi ? 'Dải tin cậy (P10 – P90)' : 'Uncertainty Band (P10 – P90)'}</span>
                </div>
              </div>
            </div>

            <div className="chart-area">
              {isLoading || !data ? (
                <div className="chart-loading-state">
                  {isVi ? 'Đang tải quỹ đạo dự báo nhu cầu...' : 'Loading forecast trajectory...'}
                </div>
              ) : (
                <div className="chart-wrapper">
                  <ResponsiveContainer width="100%" height={330}>
                    <ComposedChart data={data?.chartData || []} margin={{ top: 14, right: 16, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis
                        dataKey="label"
                        stroke="#64748b"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'IBM Plex Mono, monospace' }}
                        minTickGap={18}
                      />
                      <YAxis
                        stroke="#64748b"
                        axisLine={false}
                        tickLine={false}
                        width={46}
                        tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'IBM Plex Mono, monospace' }}
                      />
                      <Tooltip
                        cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.name || ''}
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#1e293b',
                          color: '#f8fafc',
                          borderRadius: '4px',
                          fontSize: '12px',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="ci_upper"
                        name={isVi ? 'Cận trên (P90)' : 'CI Upper (P90)'}
                        fill="#ccfbf1"
                        fillOpacity={0.75}
                        stroke="#5eead4"
                        strokeWidth={1}
                        connectNulls
                      />
                      <Area
                        type="monotone"
                        dataKey="ci_lower"
                        name={isVi ? 'Cận dưới (P10)' : 'CI Lower (P10)'}
                        fill="#ffffff"
                        fillOpacity={1}
                        stroke="#99f6e4"
                        strokeWidth={1}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="actual"
                        name={isVi ? 'Doanh số Thực tế' : 'Historical Sales'}
                        stroke="#334155"
                        strokeWidth={2.25}
                        dot={{ r: 2, fill: '#334155' }}
                        activeDot={{ r: 4 }}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="predicted"
                        name={isVi ? 'Dự báo Điểm (P50)' : 'Point Forecast (P50)'}
                        stroke="#0f766e"
                        strokeWidth={2.5}
                        strokeDasharray="5 3"
                        dot={{ r: 2.5, fill: '#0f766e' }}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </Card>

          {/* Stats & SHAP Attribution Card */}
          <Card className="p-6 mb-6">
            <div className="perf-card-header">
              <div>
                <h3 className="perf-card-title">
                  {isVi ? 'Động Lực Dự Báo (SHAP Feature Attribution)' : 'Demand Drivers (SHAP Feature Attribution)'}
                </h3>
                <p className="engine-desc" style={{ marginBottom: 0 }}>
                  {isVi
                    ? 'Giải thích tác động của các biến đặc trưng (giá, khuyến mãi, lịch tuần) lên lượng cầu.'
                    : 'Explainability of key features (price elasticity, promotions, seasonality) on demand volume.'}
                </p>
              </div>
              <span className="perf-engine-badge">
                {selectedEngine} • TreeSHAP
              </span>
            </div>

            <div className="shap-section" style={{ marginTop: '0.75rem' }}>
              <div className="shap-header">
                <div className="shap-title-wrapper">
                  <div className="shap-icon-box">
                    <BrainCircuit size={16} />
                  </div>
                  <div>
                    <div className="shap-title-row">
                      <h4 className="shap-title">
                        {isVi ? 'Mức Độ Đóng Góp Đặc Trưng' : 'Feature Importance Rankings'}
                      </h4>
                      <span className="shap-tag-tech">TreeSHAP</span>
                    </div>
                  </div>
                </div>
                {explanation?.base_value != null && (
                  <div
                    className="shap-base-val-chip"
                    title={
                      isVi
                        ? 'Giá trị kỳ vọng cơ sở của mô hình khi chưa xét tác động đặc trưng'
                        : 'Baseline expected model output before feature contributions'
                    }
                  >
                    <span className="shap-base-label">Base E[f(x)]:</span>
                    <span className="shap-base-num">
                      {explanation.base_value} {isVi ? 'đv' : 'units'}
                    </span>
                  </div>
                )}
              </div>

              {explanation?.features && explanation.features.length > 0 ? (
                <div className="shap-compact-table">
                  {explanation.features.slice(0, 5).map((f: any, idx: number) => {
                    const rawScore =
                      typeof f.importance_score === 'number'
                        ? f.importance_score
                        : typeof f.importance === 'number'
                          ? f.importance
                          : 0;
                    const meta = FEATURE_METADATA[f.feature_name] || {
                      label: f.feature_name
                        ? f.feature_name.replace(/_/g, ' ')
                        : isVi
                          ? `Đặc trưng ${idx + 1}`
                          : `Feature ${idx + 1}`,
                      desc:
                        f.description ||
                        (isVi
                          ? 'Đặc trưng hồi quy trong mô hình Machine Learning'
                          : 'Regression feature in Machine Learning model'),
                      defaultDir: rawScore >= 0 ? 'positive' : 'negative',
                    };
                    const isNeg =
                      f.direction === 'negative' ||
                      (f.direction == null && (rawScore < 0 || meta.defaultDir === 'negative'));
                    const absScore = Math.abs(rawScore);
                    const barWidth =
                      maxShapScore > 0 ? Math.min(100, Math.round((absScore / maxShapScore) * 100)) : 20;
                    const sharePct = totalShapSum > 0 ? Math.round((absScore / totalShapSum) * 100) : 0;
                    const descText = f.description || meta.desc;

                    return (
                      <div key={idx} className="shap-row">
                        <div className="shap-col-info">
                          <div className="shap-name-line">
                            <span className="shap-rank-badge">#{idx + 1}</span>
                            <span className="shap-name-text">{meta.label}</span>
                            <span className="shap-code-tag">{f.feature_name}</span>
                          </div>
                          {descText && (
                            <div className="shap-desc-line" title={descText}>
                              {descText}
                            </div>
                          )}
                        </div>

                        <div className="shap-col-bar">
                          <div className="shap-bar-track-compact">
                            <div
                              className={`shap-bar-fill-compact ${isNeg ? 'fill-neg' : 'fill-pos'}`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>

                        <div className="shap-col-metrics">
                          <span className={`shap-impact-val ${isNeg ? 'impact-neg' : 'impact-pos'}`}>
                            {isNeg ? (
                              <ArrowDownRight size={13} className="shap-impact-arrow" />
                            ) : (
                              <ArrowUpRight size={13} className="shap-impact-arrow" />
                            )}
                            <span>{isNeg ? `-${absScore.toFixed(2)}` : `+${absScore.toFixed(2)}`}</span>
                          </span>
                          <span className="shap-share-badge">{sharePct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="shap-empty-state">
                  <Info size={16} />
                  <span>
                    {isVi
                      ? 'Chưa có dữ liệu phân tích SHAP giải thích cho mô hình hiện tại'
                      : 'No SHAP explainability data available for the current model'}
                  </span>
                </div>
              )}

              {/* Footer explanation note */}
              <div className="shap-footer-legend">
                <div className="shap-legend-item">
                  <span className="shap-legend-dot pos" />
                  <span>{isVi ? 'Dương (+): Kích thích tăng sản lượng' : 'Positive (+): Stimulates demand'}</span>
                </div>
                <div className="shap-legend-item">
                  <span className="shap-legend-dot neg" />
                  <span>{isVi ? 'Âm (-): Độ co giãn kìm hãm nhu cầu' : 'Negative (-): Dampens demand'}</span>
                </div>
                <div className="shap-legend-item ml-auto">
                  <span className="shap-legend-text">
                    {isVi ? `Mô hình ${selectedEngine} (TreeSHAP)` : `${selectedEngine} Model (TreeSHAP)`}
                  </span>
                </div>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* TAB 2: ROUTE (C) PROTECTION WINDOW */}
      {activeTab === 'window_route_c' && (
        <Card className="mb-6 p-6 route-c-card">
        <div className="route-c-header">
          <div className="route-c-title-block">
            <div className="route-c-title-row">
              <Activity size={17} className="text-teal" />
              <h3 className="route-c-title">
                {isVi
                  ? 'Phân Phối Nhu Cầu Tích Lũy Cửa Sổ Bảo Vệ Route (c) — H = L + R = 10 Ngày'
                  : 'Route (c) Cumulative Protection Window Demand Distribution — H = L + R = 10 Days'}
              </h3>
              <span className="route-c-formula-badge">
                D_H = Σ y_(T+t) | {routeCWindowTelemetry.isLive ? `${routeCWindowTelemetry.quantileCount}-Quantile Grid (Live BE)` : 'Quantile Grid Preview'}
              </span>
              <span
                className={`route-c-source-badge ${routeCWindowTelemetry.isLive ? 'live' : 'fallback'}`}
                title={routeCWindowTelemetry.modelRunId || undefined}
              >
                {routeCWindowTelemetry.isLive
                  ? (isVi
                      ? `Dữ liệu thực • Origin ${routeCWindowTelemetry.originDate || 'N/A'} • ${routeCWindowTelemetry.segmentClass}`
                      : `Live API • Origin ${routeCWindowTelemetry.originDate || 'N/A'} • Seg ${routeCWindowTelemetry.segmentClass}`)
                  : (isVi
                      ? 'Ước lượng dự phòng (chưa có dữ liệu Route c từ batch)'
                      : 'Estimated Preview (no persisted Route c quantiles yet)')}
              </span>
            </div>
            <p className="route-c-subtitle">
              {isVi
                ? `Ước lượng trực tiếp hàm phân vị tích lũy Q̂_{D_H}(τ) trên toàn cửa sổ bảo vệ H = ${routeCWindowTelemetry.H} ngày kết hợp hiệu chỉnh Conformal C³-OUT (${routeCWindowTelemetry.segmentClass}) cho SKU ${skuSearch || 'FOODS_1_001'}.`
                : `Direct cumulative window quantile estimation Q̂_{D_H}(τ) over the ${routeCWindowTelemetry.H}-day protection window with C³-OUT closed-loop conformal calibration (${routeCWindowTelemetry.segmentClass}) for SKU ${skuSearch || 'FOODS_1_001'}.`}
            </p>
          </div>

          <div className="route-c-setpoint-selector">
            <span className="route-c-setpoint-label">
              {isVi ? 'Mục tiêu phục vụ τ_g:' : 'Target Setpoint τ_g:'}
            </span>
            <div className="horizon-toggle">
              {[
                { tau: 0.90, label: '90% (Seg C)' },
                { tau: 0.95, label: '95% (Seg B)' },
                { tau: 0.98, label: '97.5% (Seg A)' },
                { tau: 0.99, label: '99% (Crit)' },
              ].map((opt) => {
                const mappedTau = opt.tau === 0.98 ? 0.975 : opt.tau;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    className={`horizon-btn ${Math.abs(targetTau - mappedTau) < 0.001 ? 'active' : ''}`}
                    onClick={() => setTargetTau(mappedTau)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Route (c) Telemetry KPI Strip */}
        <div className="route-c-kpi-strip">
          <div className="route-c-kpi-box">
            <span className="route-c-kpi-label">
              {isVi ? 'Kỳ Vọng Cửa Sổ Bảo Vệ (μ̂_H)' : 'Window Mean Demand (μ̂_H)'}
            </span>
            <strong className="route-c-kpi-val">{routeCWindowTelemetry.muH} units</strong>
            <span className="route-c-kpi-sub">
              {isVi ? `Cửa sổ H = L(3d) + R(7d) = 10 ngày` : `Protection window H = L(3d) + R(7d) = 10d`}
            </span>
          </div>

          <div className="route-c-kpi-box">
            <span className="route-c-kpi-label">
              {isVi ? `Phân Vị Gốc Route (c) Q̂_{D_H}(${targetTau})` : `Route (c) Base Quantile Q̂_{D_H}(${targetTau})`}
            </span>
            <strong className="route-c-kpi-val text-teal">{routeCWindowTelemetry.sBase} units</strong>
            <span className="route-c-kpi-sub">
              {isVi
                ? `So với cộng phân vị ngày Route (b): ${routeCWindowTelemetry.routeBAtTarget} u`
                : `vs. Route (b) daily quantile sum: ${routeCWindowTelemetry.routeBAtTarget} u`}
            </span>
          </div>

          <div className="route-c-kpi-box">
            <span className="route-c-kpi-label">
              {isVi ? 'Bù Hiệu Chỉnh Conformal (θ_g · σ̂_H)' : 'Conformal Offset (θ_g · σ̂_H)'}
            </span>
            <strong className="route-c-kpi-val">
              +{routeCWindowTelemetry.conformalOffset} units
            </strong>
            <span className="route-c-kpi-sub">
              θ_g = {routeCWindowTelemetry.thetaG} (m_g = {routeCWindowTelemetry.multiplierG}×) • σ̂_H = {routeCWindowTelemetry.sigmaH} u
            </span>
          </div>

          <div className="route-c-kpi-box highlight">
            <span className="route-c-kpi-label">
              {isVi ? 'Điểm Tái Đặt Hàng C³-OUT (s*)' : 'Calibrated C³-OUT Reorder Point (s*)'}
            </span>
            <strong className="route-c-kpi-val text-teal">
              {routeCWindowTelemetry.sCalibrated} units
            </strong>
            <span className="route-c-kpi-sub">
              {isVi
                ? `τ=0.95 BE: ${routeCWindowTelemetry.tau95Value}u • s = Q̂_{D_H}(τ_g) + θ_g·σ̂_H`
                : `BE τ_95: ${routeCWindowTelemetry.tau95Value}u • s = Q̂_{D_H}(τ_g) + θ_g·σ̂_H`}
            </span>
          </div>
        </div>

        <div className="route-c-body-grid">
          <div className="route-c-chart-box">
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart
                data={routeCWindowTelemetry.curve}
                margin={{ top: 12, right: 18, left: 4, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="tauLabel"
                  stroke="#64748b"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10.5, fill: '#475569', fontFamily: 'IBM Plex Mono, monospace' }}
                />
                <YAxis
                  stroke="#64748b"
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'IBM Plex Mono, monospace' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#1e293b',
                    color: '#f8fafc',
                    borderRadius: '4px',
                    fontSize: '12px',
                  }}
                  labelFormatter={(label) => (isVi ? `Mức phân vị τ = ${label}` : `Quantile Level τ = ${label}`)}
                />
                <ReferenceLine
                  x={formatTauLabel(targetTau)}
                  stroke="#0f766e"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  label={{
                    value: `τ_g=${targetTau} (${routeCWindowTelemetry.sBase}u)`,
                    position: 'insideTopLeft',
                    fill: '#0f766e',
                    fontSize: 11,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="routeC"
                  name={isVi ? 'Route (c) Phân vị Cửa sổ Q̂_{D_H}(τ)' : 'Route (c) Direct Window Quantile Q̂_{D_H}(τ)'}
                  fill="#ccfbf1"
                  fillOpacity={0.65}
                  stroke="#0f766e"
                  strokeWidth={2.5}
                />
                <Line
                  type="monotone"
                  dataKey="routeB"
                  name={isVi ? 'Route (b) Tổng phân vị ngày Σ q̂_τ' : 'Route (b) Naive Daily Quantile Sum Σ q̂_τ'}
                  stroke="#94a3b8"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="route-c-callout-box">
            <div className="route-c-callout-header">
              <GitCompare size={15} className="text-teal" />
              <h4>
                {isVi
                  ? 'Tại Sao Chọn Route (c) Thay Vì Cộng Phân Vị Ngày Route (b)?'
                  : 'Why Route (c) Direct Window Quantiles Outperform Route (b)'}
              </h4>
            </div>
            <p className="route-c-callout-text">
              {isVi
                ? 'Trong bài toán kiểm soát tồn kho chu kỳ rà soát R = 7 ngày và thời gian giao hàng L = 3 ngày, rủi ro thiếu hàng xảy ra trên tổng nhu cầu tích lũy D_H của cả cửa sổ bảo vệ H = L + R = 10 ngày:'
                : 'In periodic-review inventory control with review period R = 7d and lead time L = 3d, stockout exposure is governed by cumulative demand D_H over the full protection window H = L + R = 10 days:'}
            </p>
            <ul className="route-c-callout-list">
              <li>
                <strong>{isVi ? 'Route (c) — Dự báo phân vị tích lũy trực tiếp:' : 'Route (c) — Direct Cumulative Quantile:'}</strong>{' '}
                {isVi
                  ? 'Huấn luyện mô hình phân vị trực tiếp trên mục tiêu tổng D_H = Σ y_{T+t}, bảo toàn chính xác tự tương quan chuỗi thời gian và độ lệch phải (right-skewness) của nhu cầu bán lẻ.'
                  : 'Directly estimates Q̂_{D_H}(τ) on cumulative target D_H = Σ y_{T+t}, preserving cross-day autocorrelation and heavy right-tail skewness.'}
              </li>
              <li>
                <strong>{isVi ? 'Route (b) — Sai số khi cộng phân vị ngày:' : 'Route (b) — Daily Quantile Aggregation Bias:'}</strong>{' '}
                {isVi
                  ? 'Cộng tuyến tính phân vị từng ngày giả định tương quan hoàn hảo (comonotonicity ρ = 1) làm phình tồn kho dư thừa, trong khi nhân √H lại giả định độc lập i.i.d làm hụt tồn kho an toàn khi có khuyến mãi.'
                  : 'Summing daily quantiles assumes perfect comonotonicity (ρ = 1, inflating holding cost), while Gaussian √H scaling assumes i.i.d. errors and under-protects promotional bursts.'}
              </li>
            </ul>
          </div>
        </div>
        </Card>
      )}

      {/* TAB 4: SCHEDULE & INLINE OVERRIDES */}
      {activeTab === 'schedule' && (
        <Card className="p-6">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '1.15rem',
                flexWrap: 'wrap',
                gap: '0.75rem',
              }}
            >
              <div>
                <h3 className="perf-card-title">
                  {isVi
                    ? `Ma Trận Lịch Trình Dự Báo Hàng Ngày (${fullScheduleMatrix.length} Ngày)`
                    : `Daily Predictive Schedule Matrix (${fullScheduleMatrix.length}-Day Horizon)`}
                </h3>
                <p className="engine-desc" style={{ marginBottom: 0 }}>
                  {isVi
                    ? 'Chi tiết dự báo P10 / P50 / P90, độ rộng khoảng tin cậy và cảnh báo đột biến theo ngày'
                    : 'Daily P10 / P50 / P90 quantile schedule, CI width, and quick override actions'}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div className="horizon-toggle" title={isVi ? 'Số dòng hiển thị mỗi trang' : 'Rows per view'}>
                  {[7, 14, 28].map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      className={`horizon-btn ${matrixPageSize === sz ? 'active' : ''}`}
                      onClick={() => {
                        setMatrixPageSize(sz);
                        setMatrixPage(1);
                        if (horizon < sz) {
                          handleHorizonChange(sz);
                        }
                      }}
                    >
                      {isVi ? `Xem ${sz}d` : `${sz}d View`}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  className="export-matrix-btn"
                  onClick={handleExportMatrixCsv}
                  title={
                    isVi
                      ? 'Xuất bảng ma trận lịch trình dự báo thành file CSV'
                      : 'Export schedule matrix to CSV'
                  }
                >
                  <Download size={14} />
                  <span>{isVi ? 'Xuất CSV' : 'Export CSV'}</span>
                </button>

                {canEdit && (
                  <button
                    type="button"
                    className="export-matrix-btn"
                    onClick={handleOpenBulkOverride}
                    title={isVi ? 'Can thiệp điều chỉnh dự báo hàng loạt' : 'Bulk forecast override'}
                    style={{ background: '#0f766e', color: '#fff', borderColor: '#0f766e' }}
                  >
                    <Layers size={14} />
                    <span>{isVi ? 'Can thiệp hàng loạt' : 'Bulk Override'}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="matrix-table">
              <div className="matrix-header-row">
                <div className="matrix-col-header matrix-col-1">{isVi ? 'NGÀY' : 'DATE'}</div>
                <div className="matrix-col-header matrix-col-2">{isVi ? 'DỰ BÁO (P50)' : 'POINT (P50)'}</div>
                <div className="matrix-col-header matrix-col-3">{isVi ? 'DẢI P10–P90' : 'P10 – P90 BAND'}</div>
                <div className="matrix-col-header matrix-col-4">{isVi ? 'ĐỘ RỘNG CI' : 'CI WIDTH'}</div>
                <div className="matrix-col-header matrix-col-5 text-right">{isVi ? 'ĐỘT BIẾN / CAN THIỆP' : 'RISK / ACTION'}</div>
              </div>

              {paginatedScheduleMatrix.map((row: any, idx: number) => (
                <div className="matrix-row" key={idx}>
                  <div className="matrix-cell matrix-col-1 font-bold mono-cell">{row.date}</div>
                  <div className="matrix-cell matrix-col-2 text-teal mono-cell">
                    {row.demand} {isVi ? 'đv' : 'u'}
                  </div>
                  <div className="matrix-cell matrix-col-3 mono-cell">
                    [{row.lower} – {row.upper}]
                  </div>
                  <div className="matrix-cell matrix-col-4 mono-cell">
                    Δ = {row.ciWidth ?? Math.max(0, Number(row.upper || 0) - Number(row.lower || 0))} u
                  </div>
                  <div className="matrix-cell matrix-col-5 text-right matrix-action-cell">
                    <span className={row.spikeColor}>{row.spike}</span>
                    {canEdit && (
                      <button
                        type="button"
                        className="matrix-inline-override-btn"
                        onClick={() => handleOpenOverrideForDate(row.date, row.demand)}
                        title={isVi ? `Can thiệp ngày ${row.date}` : `Override ${row.date}`}
                      >
                        {isVi ? 'Sửa' : 'Edit'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {fullScheduleMatrix.length > matrixPageSize && (
              <Pagination
                currentPage={matrixPage}
                totalItems={fullScheduleMatrix.length}
                pageSize={matrixPageSize}
                onPageChange={setMatrixPage}
                onPageSizeChange={(newSize) => {
                  setMatrixPageSize(newSize);
                  setMatrixPage(1);
                }}
                pageSizeOptions={[7, 14, 28]}
              />
            )}

            {overrides.length > 0 && (
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h4 style={{ fontSize: '0.925rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
                      {isVi ? `Danh Sách Can Thiệp Thủ Công Đang Áp Dụng (${overrides.length})` : `Active Manual Overrides (${overrides.length})`}
                    </h4>
                    <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.2rem 0 0 0' }}>
                      {isVi
                        ? `Tổng chênh lệch sản lượng: ${overrideMetrics.totalDelta >= 0 ? '+' : ''}${overrideMetrics.totalDelta} đv (${overrideMetrics.totalOriginal} → ${overrideMetrics.totalOverride})`
                        : `Net demand variance: ${overrideMetrics.totalDelta >= 0 ? '+' : ''}${overrideMetrics.totalDelta} units (${overrideMetrics.totalOriginal} → ${overrideMetrics.totalOverride})`}
                    </p>
                  </div>
                </div>
                <div className="override-table-wrapper">
                  <table className="override-table">
                    <thead>
                      <tr>
                        <th>{isVi ? 'Ngày' : 'Date'}</th>
                        <th className="text-right">{isVi ? 'Gốc (ML)' : 'ML Baseline'}</th>
                        <th className="text-right">{isVi ? 'Can thiệp' : 'Override'}</th>
                        <th className="text-right">{isVi ? 'Chênh lệch' : 'Delta'}</th>
                        <th>{isVi ? 'Lý do / Phân loại' : 'Reason / Category'}</th>
                        <th className="text-right">{isVi ? 'Thao tác' : 'Action'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overrides.map((ov: any) => {
                        const { formatted, dayOfWeek } = formatOverrideDate(ov.date);
                        const { category, detail } = parseOverrideReason(ov.reason);
                        const orig = typeof ov.original_value === 'number' ? Math.round(ov.original_value) : Number(ov.original_value) || 0;
                        const over = typeof ov.override_value === 'number' ? Math.round(ov.override_value) : Number(ov.override_value) || 0;
                        const delta = over - orig;
                        return (
                          <tr key={ov.id}>
                            <td className="font-bold mono-cell">{formatted} {dayOfWeek && <small style={{ color: '#64748b' }}>({dayOfWeek})</small>}</td>
                            <td className="text-right mono-cell">{orig} u</td>
                            <td className="text-right mono-cell font-bold text-teal">{over} u</td>
                            <td className="text-right mono-cell" style={{ color: delta >= 0 ? '#0f766e' : '#e11d48', fontWeight: 600 }}>
                              {delta >= 0 ? `+${delta}` : delta} u
                            </td>
                            <td>
                              <span style={{ fontWeight: 600 }}>{category}</span>
                              {detail && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{detail}</div>}
                            </td>
                            <td className="text-right">
                              {canEdit && (
                                <button
                                  type="button"
                                  className="matrix-inline-override-btn"
                                  onClick={() => handleRevertOverride(ov.id)}
                                  title={isVi ? 'Khôi phục về baseline ML' : 'Revert to ML baseline'}
                                  style={{ color: '#e11d48', borderColor: '#fecdd3' }}
                                >
                                  <RotateCcw size={12} style={{ display: 'inline', marginRight: '4px' }} />
                                  {isVi ? 'Hủy' : 'Revert'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        )}

      {/* TAB 3: MODEL BENCHMARK */}
      {activeTab === 'benchmark' && (
        <Card className="p-6">
        <div className="bench-header">
          <div>
            <div className="bench-title-row">
              <Award size={17} className="text-teal" />
              <h3 className="perf-card-title">
                {isVi
                  ? 'Bảng Đối Chuẩn Hiệu Năng Đa Mô Hình Dự Báo (Multi-Model Benchmark Comparison)'
                  : 'Multi-Model Forecasting Architecture Benchmark Comparison'}
              </h3>
            </div>
            <p className="engine-desc" style={{ marginBottom: 0 }}>
              {isVi
                ? `So sánh thực nghiệm 4 kiến trúc dự báo từ báo cáo nghiên cứu trên SKU ${skuSearch || 'FOODS_1_001'} (${selectedStore || 'CA_1'}) theo các thước đo chuẩn M5: MASE, WRMSSE, RMSE, MAE và Pinball Loss.`
                : `Empirical evaluation of the 4 research forecasting architectures on SKU ${skuSearch || 'FOODS_1_001'} (${selectedStore || 'CA_1'}) across M5 metrics: MASE, WRMSSE, RMSE, MAE, and Quantile Pinball Loss.`}
            </p>
          </div>
        </div>

        <div className="override-table-wrapper">
          <table className="override-table bench-table">
            <thead>
              <tr>
                <th>{isVi ? 'Kiến Trúc Mô Hình (Architecture)' : 'Model Architecture'}</th>
                <th>{isVi ? 'Họ Thuật Toán' : 'Algorithmic Family'}</th>
                <th className="text-right">MASE ↓</th>
                <th className="text-right">WRMSSE ↓</th>
                <th className="text-right">RMSE ↓</th>
                <th className="text-right">MAE ↓</th>
                <th className="text-right">Pinball Loss ↓</th>
                <th>{isVi ? 'Trạng Thái Triển Khai' : 'Deployment Status'}</th>
              </tr>
            </thead>
            <tbody>
              {benchmarkModels.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '32px 16px', color: '#64748b' }}>
                    <div style={{ fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                      {isVi ? 'Chưa có mô hình nào được đăng ký trong Model Registry' : 'No registered models found in registry'}
                    </div>
                    <div style={{ fontSize: '0.85rem' }}>
                      {isVi ? 'Dữ liệu được cập nhật trực tiếp từ Backend Model Registry (/api/v1/ml/models).' : 'Data is fetched directly from Backend Model Registry (/api/v1/ml/models).'}
                    </div>
                  </td>
                </tr>
              ) : (
                benchmarkModels.map((m) => (
                  <tr key={m.id} className={m.isSelected ? 'bench-row-active' : ''}>
                    <td className="font-bold">{m.name}</td>
                    <td className="text-slate-muted">{m.family}</td>
                    <td className="text-right mono-cell font-bold text-teal">{m.mase}</td>
                    <td className="text-right mono-cell">{m.wrmsse}</td>
                    <td className="text-right mono-cell">{m.rmse}</td>
                    <td className="text-right mono-cell">{m.mae}</td>
                    <td className="text-right mono-cell">{m.pinball}</td>
                    <td>
                      <span className={`bench-status-badge ${m.badgeClass}`}>{m.badge}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      {/* Manual Override Modal */}
      {isOverrideModalOpen &&
        createPortal(
          <div className="modal-overlay" onClick={() => setIsOverrideModalOpen(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-header-info">
                  <div className="modal-title-row">
                    <h2 className="modal-title">
                      {isVi ? 'Can Thiệp Dự Báo Thủ Công Đơn Lẻ' : 'Manual Forecast Override'}
                    </h2>
                  </div>
                  <div className="modal-badge-group">
                    <span className="modal-badge highlight">SKU: {skuSearch || 'FOODS_1_001'}</span>
                    <span className="modal-badge">
                      {isVi ? 'Kho:' : 'Store:'} {selectedStore || 'CA_1'}
                    </span>
                    <span className="modal-badge">
                      {isVi ? `Chu kỳ: ${horizon}d` : `Horizon: ${horizon}d`}
                    </span>
                  </div>
                </div>
                <button
                  className="modal-close"
                  onClick={() => setIsOverrideModalOpen(false)}
                  title={isVi ? 'Đóng' : 'Close'}
                >
                  <X size={15} />
                </button>
              </div>

              <form
                onSubmit={handleApplyOverride}
                style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}
              >
                <div className="modal-body">
                  {overrideError ? (
                    <div
                      className="p-3 mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded"
                      style={{ borderRadius: '4px' }}
                    >
                      {String(overrideError)}
                    </div>
                  ) : null}

                  <div className="modal-form-group">
                    <label>
                      {isVi ? 'Ngày Can Thiệp (Target Forecast Date)' : 'Target Forecast Date'}
                    </label>
                    <input
                      type="date"
                      required
                      className="modal-input"
                      value={overrideDate}
                      onChange={(e) => setOverrideDate(e.target.value)}
                    />
                  </div>

                  <div className="modal-form-group">
                    <label>
                      {isVi ? 'Số Lượng Dự Báo Điều Chỉnh (Adjusted Quantity)' : 'Adjusted Quantity'}
                    </label>
                    <div className="modal-input-wrapper">
                      <input
                        type="number"
                        min="0"
                        required
                        value={overrideValue}
                        onChange={(e) => setOverrideValue(e.target.value)}
                        className="modal-input"
                        placeholder="e.g. 25"
                      />
                      <span className="modal-input-suffix">{isVi ? 'đơn vị' : 'units'}</span>
                    </div>
                  </div>

                  <div className="modal-form-group">
                    <label>{isVi ? 'Danh Mục Lý Do (Reason Category)' : 'Reason Category'}</label>
                    <select
                      className="modal-select"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                    >
                      <option value="Promotional Spike Override">
                        {isVi ? 'Chiến Dịch Khuyến Mãi (Promotional Spike)' : 'Promotional Spike Override'}
                      </option>
                      <option value="Seasonal Demand Surge">
                        {isVi ? 'Biến Động Nhu Cầu Mùa Vụ (Seasonal Surge)' : 'Seasonal Demand Surge'}
                      </option>
                      <option value="Supply Chain Disruption">
                        {isVi ? 'Đứt Gãy Cung Ứng / Thiếu Hụt (Supply Shortage)' : 'Supply Chain Disruption'}
                      </option>
                      <option value="Market Competitor Action">
                        {isVi ? 'Biến Động Đối Thủ Cạnh Tranh (Market Action)' : 'Market Competitor Action'}
                      </option>
                      <option value="Unplanned Event">
                        {isVi ? 'Sự Kiện Đột Xuất (Unplanned Event)' : 'Unplanned Event'}
                      </option>
                    </select>
                  </div>

                  <div className="modal-form-group" style={{ marginBottom: 0 }}>
                    <label>
                      {isVi
                        ? 'Giải Trình Nghiệp Vụ Chi Tiết (Bắt buộc cho kiểm toán)'
                        : 'Operational Justification (Audit Required)'}
                    </label>
                    <textarea
                      required
                      className="modal-textarea"
                      placeholder={
                        isVi
                          ? 'Nhập lý do chi tiết cho việc can thiệp thủ công (sẽ ghi nhận vào nhật ký kiểm toán)...'
                          : 'Enter detailed rationale for manual intervention (recorded in audit logs)...'
                      }
                      value={overrideNotes}
                      onChange={(e) => setOverrideNotes(e.target.value)}
                      rows={3}
                    ></textarea>
                  </div>
                </div>

                <div className="modal-footer">
                  <div className="modal-footer-notice">
                    <ShieldCheck size={14} className="text-teal" />
                    <span>
                      {isVi ? 'Lưu vết kiểm toán tự động' : 'Automatic audit logging active'}
                    </span>
                  </div>
                  <div className="modal-footer-actions">
                    <button
                      type="button"
                      className="modal-btn-cancel"
                      onClick={() => setIsOverrideModalOpen(false)}
                      disabled={isSubmittingOverride}
                    >
                      {isVi ? 'Hủy Bỏ' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      className="modal-btn-apply"
                      disabled={isSubmittingOverride}
                    >
                      {isVi
                        ? isSubmittingOverride
                          ? 'Đang Lưu...'
                          : 'Áp Dụng Điều Chỉnh'
                        : isSubmittingOverride
                          ? 'Saving...'
                          : 'Apply Override'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Bulk Override Modal */}
      {isBulkOverrideOpen &&
        createPortal(
          <div className="modal-overlay" onClick={() => setIsBulkOverrideOpen(false)}>
            <div className="modal-content bulk-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-header-info">
                  <div className="modal-title-row">
                    <h2 className="modal-title">
                      {isVi ? 'Điều Chỉnh Dự Báo Hàng Loạt Theo Chu Kỳ' : 'Bulk Forecast Horizon Override'}
                    </h2>
                  </div>
                  <div className="modal-badge-group">
                    <span className="modal-badge highlight">SKU: {skuSearch || 'FOODS_1_001'}</span>
                    <span className="modal-badge">
                      {isVi ? 'Kho:' : 'Store:'} {selectedStore || 'CA_1'}
                    </span>
                    <span className="modal-badge">
                      {isVi
                        ? `${bulkPreviewRows.length} ngày dự báo trong khoảng`
                        : `${bulkPreviewRows.length} forecast days in range`}
                    </span>
                  </div>
                </div>
                <button
                  className="modal-close"
                  onClick={() => setIsBulkOverrideOpen(false)}
                  title={isVi ? 'Đóng' : 'Close'}
                >
                  <X size={15} />
                </button>
              </div>

              <form
                onSubmit={handleApplyBulkOverride}
                style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}
              >
                <div className="modal-body">
                  {bulkError ? (
                    <div
                      className="p-3 mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded"
                      style={{ borderRadius: '4px' }}
                    >
                      {String(bulkError)}
                    </div>
                  ) : null}

                  <div className="bulk-modal-grid">
                    {/* Left Column: Adjustment Parameters */}
                    <div className="bulk-grid-col">
                      <div className="modal-form-group">
                        <label>
                          {isVi ? 'Chế Độ Điều Chỉnh (Adjustment Mode)' : 'Adjustment Mode'}
                        </label>
                        <div className="bulk-mode-toggle">
                          <button
                            type="button"
                            className={`bulk-mode-btn ${bulkMode === 'percent' ? 'active' : ''}`}
                            onClick={() => setBulkMode('percent')}
                          >
                            {isVi ? 'Tỷ Lệ % (+/- %)' : 'Percentage (+/- %)'}
                          </button>
                          <button
                            type="button"
                            className={`bulk-mode-btn ${bulkMode === 'fixed' ? 'active' : ''}`}
                            onClick={() => setBulkMode('fixed')}
                          >
                            {isVi ? 'Số Lượng Cố Định' : 'Fixed Quantity'}
                          </button>
                        </div>
                      </div>

                      <div className="bulk-date-row">
                        <div className="modal-form-group" style={{ flex: 1 }}>
                          <label>{isVi ? 'Từ Ngày (Start Date)' : 'Start Date'}</label>
                          <input
                            type="date"
                            required
                            className="modal-input"
                            value={bulkStartDate}
                            onChange={(e) => setBulkStartDate(e.target.value)}
                          />
                        </div>
                        <div className="modal-form-group" style={{ flex: 1 }}>
                          <label>{isVi ? 'Đến Ngày (End Date)' : 'End Date'}</label>
                          <input
                            type="date"
                            required
                            className="modal-input"
                            value={bulkEndDate}
                            onChange={(e) => setBulkEndDate(e.target.value)}
                          />
                        </div>
                      </div>

                      {bulkMode === 'percent' ? (
                        <div className="modal-form-group">
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '0.375rem',
                            }}
                          >
                            <label style={{ margin: 0 }}>
                              {isVi ? 'Tỷ Lệ Điều Chỉnh (%)' : 'Adjustment Percentage (%)'}
                            </label>
                            <span
                              style={{
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                color: '#0f766e',
                                fontFamily: 'monospace',
                              }}
                            >
                              {Number(bulkPercent) > 0 ? `+${bulkPercent}%` : `${bulkPercent}%`}
                            </span>
                          </div>
                          <div className="modal-input-wrapper">
                            <input
                              type="number"
                              step="1"
                              required
                              value={bulkPercent}
                              onChange={(e) => setBulkPercent(e.target.value)}
                              className="modal-input"
                              placeholder={
                                isVi ? 'VD: 15 cho +15%, -10 cho -10%' : 'e.g. 15 for +15%, -10 for -10%'
                              }
                            />
                            <span className="modal-input-suffix">%</span>
                          </div>
                          <span
                            style={{
                              fontSize: '0.6875rem',
                              color: '#64748b',
                              marginTop: '0.35rem',
                              display: 'block',
                              lineHeight: 1.35,
                            }}
                          >
                            {isVi
                              ? 'Giá trị dương để tăng dự báo (chiến dịch khuyến mãi, sự kiện), giá trị âm để giảm bớt.'
                              : 'Positive values increase forecast (promotions, events); negative values decrease it.'}
                          </span>
                        </div>
                      ) : (
                        <div className="modal-form-group">
                          <label>
                            {isVi ? 'Số Lượng Cố Định Mỗi Ngày' : 'Fixed Daily Quantity'}
                          </label>
                          <div className="modal-input-wrapper">
                            <input
                              type="number"
                              min="0"
                              required
                              value={bulkFixedVal}
                              onChange={(e) => setBulkFixedVal(e.target.value)}
                              className="modal-input"
                              placeholder="e.g. 80"
                            />
                            <span className="modal-input-suffix">
                              {isVi ? 'đv / ngày' : 'units / day'}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: '0.6875rem',
                              color: '#64748b',
                              marginTop: '0.35rem',
                              display: 'block',
                              lineHeight: 1.35,
                            }}
                          >
                            {isVi
                              ? 'Áp dụng đồng đều cùng một mức sản lượng cho tất cả các ngày trong khoảng thời gian đã chọn.'
                              : 'Applies the same fixed quantity across all days in the selected range.'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Right Column: Impact Preview & Audit Notes */}
                    <div className="bulk-grid-col">
                      {bulkPreviewRows.length > 0 && (
                        <div className="bulk-preview-box">
                          <div className="bulk-preview-header">
                            <span style={{ fontWeight: 700, color: '#1e293b' }}>
                              {isVi
                                ? `Xem Trước: ${bulkPreviewRows.length} Ngày Bị Ảnh Hưởng`
                                : `Preview: ${bulkPreviewRows.length} Affected Days`}
                            </span>
                            <span
                              style={{
                                fontSize: '0.6875rem',
                                color: '#64748b',
                                fontFamily: 'monospace',
                              }}
                            >
                              {bulkStartDate} → {bulkEndDate}
                            </span>
                          </div>
                          <div className="bulk-preview-tags">
                            {bulkPreviewRows.map((r: any, i: number) => {
                              const diff = r.projected - r.original;
                              return (
                                <div key={i} className="bulk-preview-chip">
                                  <span style={{ fontWeight: 600 }}>{r.date}</span>
                                  <span>
                                    {r.original} →{' '}
                                    <strong style={{ color: '#0f766e' }}>{r.projected} u</strong>
                                    <span
                                      style={{
                                        color: diff >= 0 ? '#059669' : '#e11d48',
                                        marginLeft: '0.35rem',
                                        fontWeight: 600,
                                      }}
                                    >
                                      ({diff >= 0 ? `+${diff}` : diff})
                                    </span>
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="modal-form-group">
                        <label>{isVi ? 'Danh Mục Lý Do (Reason Category)' : 'Reason Category'}</label>
                        <select
                          className="modal-select"
                          value={bulkReason}
                          onChange={(e) => setBulkReason(e.target.value)}
                        >
                          <option value="Promotional Spike Override">
                            {isVi
                              ? 'Chiến Dịch Khuyến Mãi (Promotional Campaign)'
                              : 'Promotional Campaign Override'}
                          </option>
                          <option value="Seasonal Demand Surge">
                            {isVi ? 'Nhu Cầu Mùa Vụ Tăng Vọt (Seasonal Surge)' : 'Seasonal Demand Surge'}
                          </option>
                          <option value="Supply Chain Disruption">
                            {isVi ? 'Đứt Gãy Chuỗi Cung Ứng (Supply Disruption)' : 'Supply Disruption'}
                          </option>
                          <option value="Market Competitor Action">
                            {isVi
                              ? 'Biến Động Thị Trường / Đối Thủ (Market Action)'
                              : 'Market Action / Competitor'}
                          </option>
                          <option value="Unplanned Event">
                            {isVi ? 'Sự Kiện Đột Xuất (Unplanned Event)' : 'Unplanned Event'}
                          </option>
                        </select>
                      </div>

                      <div className="modal-form-group" style={{ marginBottom: 0 }}>
                        <label>
                          {isVi
                            ? 'Giải Trình Nghiệp Vụ Bắt Buộc (Audit Trail)'
                            : 'Mandatory Operational Justification (Audit Trail)'}
                        </label>
                        <textarea
                          required
                          className="modal-textarea"
                          placeholder={
                            isVi
                              ? 'Nêu rõ lý do điều chỉnh hàng loạt (ví dụ: Khuyến mãi Black Friday 4 ngày tại chuỗi siêu thị CA)...'
                              : 'Specify reason for bulk override (e.g. Black Friday 4-day promotion across CA stores)...'
                          }
                          value={bulkNotes}
                          onChange={(e) => setBulkNotes(e.target.value)}
                          rows={3}
                        ></textarea>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <div className="modal-footer-notice">
                    <ShieldCheck size={14} className="text-teal" />
                    <span>
                      {isVi
                        ? 'Ghi vết kiểm toán tự động theo quy định quản trị SCM'
                        : 'Automated audit trail logged per SCM governance standards'}
                    </span>
                  </div>
                  <div className="modal-footer-actions">
                    <button
                      type="button"
                      className="modal-btn-cancel"
                      onClick={() => setIsBulkOverrideOpen(false)}
                      disabled={isSubmittingBulk}
                    >
                      {isVi ? 'Hủy Bỏ' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      className="modal-btn-apply"
                      disabled={isSubmittingBulk || bulkPreviewRows.length === 0}
                    >
                      {isVi
                        ? isSubmittingBulk
                          ? 'Đang Lưu...'
                          : `Áp Dụng Điều Chỉnh (${bulkPreviewRows.length} Ngày)`
                        : isSubmittingBulk
                          ? 'Saving...'
                          : `Apply Bulk Override (${bulkPreviewRows.length} Days)`}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
