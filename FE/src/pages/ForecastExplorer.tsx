import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '../components/ui/Card.tsx';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, Line } from 'recharts';
import { X, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, SlidersHorizontal, Layers, Plus, Calendar, RotateCcw, TrendingUp, TrendingDown, ShieldCheck, BrainCircuit, ArrowUpRight, ArrowDownRight, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { api } from '../services/api.ts';
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

export const ForecastExplorer: React.FC = () => {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isVi = language === 'vi';
  const FEATURE_METADATA = isVi ? FEATURE_METADATA_VI : FEATURE_METADATA_EN;
  const canEdit = user?.role?.toUpperCase() !== 'VIEWER';

  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [skuSearch, setSkuSearch] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [stores, setStores] = useState<string[]>([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [horizon, setHorizon] = useState<number>(28);
  const [selectedEngine, setSelectedEngine] = useState('LightGBM');
  const [explanation, setExplanation] = useState<any>(null);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  // Schedule Matrix Pagination
  const [matrixPage, setMatrixPage] = useState(1);
  const [matrixPageSize, setMatrixPageSize] = useState(7);

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

  const paginatedScheduleMatrix = useMemo(() => {
    const matrix = data?.scheduleMatrix || [];
    const start = (matrixPage - 1) * matrixPageSize;
    return matrix.slice(start, start + matrixPageSize);
  }, [data?.scheduleMatrix, matrixPage, matrixPageSize]);

  const fetchForecast = async (sku?: string, h: number = horizon, store?: string) => {
    setIsLoading(true);
    try {
      const targetSku = sku || skuSearch || 'FOODS_1_001';
      const forecast = await api.forecasting.getExplorerData(targetSku, h, store || selectedStore);
      if (forecast?.sku && !skuSearch) {
        setSkuSearch(forecast.sku);
      }

      const transformedChartData = (forecast?.chartData || []).map((d: any, i: number) => ({
        name: d.date,
        actual: d.actual != null ? d.actual : null,
        predicted: d.forecast != null ? d.forecast : (d.actual != null && i === (forecast.chartData.length - 1) ? d.actual : null),
        ci_lower: d.lower != null ? d.lower : null,
        ci_upper: d.upper != null ? d.upper : null,
      }));

      setData({ ...forecast, chartData: transformedChartData });

      if (targetSku) {
        const [explRes, overRes] = await Promise.all([
          api.forecasting.getExplanation(targetSku, { store_id: store || selectedStore }).catch(() => null),
          api.forecasting.getOverrides(targetSku, { store_id: store || selectedStore }).catch(() => []),
        ]);
        setExplanation(explRes);
        setOverrides(overRes || []);
      }
    } catch (error) {
      console.error('Failed to load forecast explorer data', error);
      setToast({ type: 'error', message: isVi ? 'Không thể tải dữ liệu dự báo từ máy chủ. Vui lòng thử lại.' : 'Failed to load forecast data from server. Please retry.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // 1. Kick off forecast fetch immediately at t=0
    fetchForecast('FOODS_1_001', 28, 'CA_1');

    // 2. Load dropdown filters concurrently
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

  const handleHorizonChange = (newH: number) => {
    setHorizon(newH);
    fetchForecast(skuSearch, newH, selectedStore);
  };

  const handleStoreChange = (newStore: string) => {
    setSelectedStore(newStore);
    fetchForecast(skuSearch, horizon, newStore);
  };

  const handleCategoryChange = (newCat: string) => {
    setSelectedCategory(newCat);
    if (newCat !== 'All') {
      const match = products.find((p: any) => p.cat_id === newCat || p.category === newCat);
      if (match) {
        setSkuSearch(match.item_id);
        fetchForecast(match.item_id, horizon, selectedStore);
        return;
      }
    }
    fetchForecast(skuSearch, horizon, selectedStore);
  };

  const handleSkuSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchForecast(skuSearch, horizon, selectedStore);
  };

  const downloadCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const csvContent = [
      headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(','),
      ...rows.map(row => row.map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\r\n');

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
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
      setToast({ type: 'warning', message: isVi ? 'Không có dữ liệu dự báo để xuất CSV!' : 'No forecast data available to export!' });
      return;
    }
    const headers = ['SKU', 'Store', 'Date', 'Historical Sales', 'Point Forecast (p50)', 'CI Lower (p10)', 'CI Upper (p90)', 'Horizon', 'Engine'];
    const rows = data.chartData.map((d: any) => [
      skuSearch || data?.sku || 'FOODS_1_001',
      selectedStore || 'Global',
      d.name || d.date || '',
      d.actual != null ? d.actual : '',
      d.predicted != null ? d.predicted : (d.forecast != null ? d.forecast : ''),
      d.ci_lower != null ? d.ci_lower : (d.lower != null ? d.lower : ''),
      d.ci_upper != null ? d.ci_upper : (d.upper != null ? d.upper : ''),
      `${horizon}d`,
      selectedEngine,
    ]);
    const filename = `forecast_${skuSearch || 'all'}_${selectedStore || 'global'}_${horizon}d.csv`;
    downloadCsv(filename, headers, rows);
    setToast({ type: 'success', message: isVi ? `Đã xuất ${rows.length} dòng dự báo ra file ${filename} thành công!` : `Exported ${rows.length} forecast rows to ${filename} successfully!` });
  };

  const handleExportMatrixCsv = () => {
    if (!data?.scheduleMatrix || data.scheduleMatrix.length === 0) {
      setToast({ type: 'warning', message: isVi ? 'Không có dữ liệu ma trận lịch trình để xuất CSV!' : 'No schedule matrix data available to export!' });
      return;
    }
    const headers = ['Date', 'SKU', 'Store', 'Predicted Demand (Units)', 'Lower (p10)', 'Upper (p90)', 'Spike Risk'];
    const rows = data.scheduleMatrix.map((r: any) => [
      r.date || '',
      skuSearch || data?.sku || 'FOODS_1_001',
      selectedStore || 'Global',
      r.demand ?? '',
      r.lower ?? '',
      r.upper ?? '',
      r.spike ?? 'Low',
    ]);
    const filename = `matrix_schedule_${skuSearch || 'sku'}_${horizon}d.csv`;
    downloadCsv(filename, headers, rows);
    setToast({ type: 'success', message: isVi ? `Đã xuất ma trận dự báo ${rows.length} ngày ra file ${filename} thành công!` : `Exported ${rows.length}-day schedule matrix to ${filename} successfully!` });
  };

  const handleOpenOverride = () => {
    const matrixFirstDate = data?.scheduleMatrix?.[0]?.date;
    let defaultDate = '';
    if (matrixFirstDate && /^\d{4}-\d{2}-\d{2}$/.test(matrixFirstDate)) {
      defaultDate = matrixFirstDate;
    } else {
      defaultDate = new Date().toISOString().split('T')[0];
    }
    const defaultVal = data?.scheduleMatrix?.[0]?.demand || 60;
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
      await api.forecasting.createOverride(skuSearch, {
        forecast_date: overrideDate,
        override_value: Number(overrideValue),
        reason: fullReason,
        store_id: selectedStore || undefined,
        horizon,
      });
      setIsOverrideModalOpen(false);
      setOverrideNotes('');
      setToast({ type: 'success', message: isVi ? `Đã áp dụng điều chỉnh dự báo cho ngày ${overrideDate} thành công!` : `Applied forecast override for ${overrideDate} successfully!` });
      await fetchForecast(skuSearch, horizon, selectedStore);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      let errMsg = 'Failed to apply forecast override';
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
    if (!window.confirm(isVi ? 'Bạn có chắc chắn muốn hoàn tác điều chỉnh này và quay về baseline của mô hình ML không?' : 'Are you sure you want to revert this override back to the ML model baseline?')) return;
    try {
      await api.forecasting.revertOverride(skuSearch, overrideId);
      setToast({ type: 'success', message: isVi ? 'Đã hoàn tác điều chỉnh dự báo về ML baseline thành công!' : 'Reverted forecast override back to ML baseline successfully!' });
      await fetchForecast(skuSearch, horizon, selectedStore);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string'
        ? detail
        : (Array.isArray(detail) ? detail.map((x: any) => x.msg).join(', ') : err.message || (isVi ? 'Lỗi hoàn tác điều chỉnh' : 'Failed to revert override'));
      setToast({ type: 'error', message: msg });
    }
  };

  const handleOpenBulkOverride = () => {
    const matrix = data?.scheduleMatrix || [];
    if (matrix.length > 0) {
      setBulkStartDate(matrix[0].date);
      setBulkEndDate(matrix[matrix.length - 1].date);
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
    if (!isBulkOverrideOpen || !data?.scheduleMatrix) return [];
    return data.scheduleMatrix
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
  }, [isBulkOverrideOpen, data?.scheduleMatrix, bulkStartDate, bulkEndDate, bulkMode, bulkPercent, bulkFixedVal]);

  const handleApplyBulkOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!skuSearch || bulkPreviewRows.length === 0) {
      setBulkError(isVi ? 'Vui lòng chọn khoảng thời gian hợp lệ có chứa ngày dự báo.' : 'Please select a valid date range containing forecast dates.');
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
        reason: `${bulkReason}: ${bulkNotes || (bulkMode === 'percent' ? `Bulk adjusted ${bulkPercent}%` : `Bulk fixed ${bulkFixedVal} units`)}`,
      }));

      const res = await api.forecasting.bulkOverride(items);
      setIsBulkOverrideOpen(false);
      setToast({
        type: 'success',
        message: isVi ? `Đã áp dụng điều chỉnh hàng loạt thành công cho ${res.created_count ?? items.length} ngày!` : `Applied bulk override successfully for ${res.created_count ?? items.length} days!`, 
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
      const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
      const dayOfWeek = dayNames[d.getDay()] || '';
      return { formatted: dateStr, dayOfWeek };
    } catch {
      return { formatted: dateStr, dayOfWeek: '' };
    }
  };

  const parseOverrideReason = (reasonStr: string) => {
    if (!reasonStr) return { category: 'Manual Adjustment', detail: '', catClass: 'override-cat-default', dotColor: '#64748b' };
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
      const orig = typeof ov.original_value === 'number' ? Math.round(ov.original_value) : (Number(ov.original_value) || 0);
      const over = typeof ov.override_value === 'number' ? Math.round(ov.override_value) : (Number(ov.override_value) || 0);
      totalDelta += (over - orig);
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
          : (typeof f.importance === 'number' ? f.importance : 0)
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
              <label className="filter-label">Product Category</label>
              <select
                className="filter-select"
                value={selectedCategory}
                onChange={(e) => handleCategoryChange(e.target.value)}
              >
                <option value="All">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="filter-item">
              <label className="filter-label">Location / Store</label>
              <select
                className="filter-select"
                value={selectedStore}
                onChange={(e) => handleStoreChange(e.target.value)}
              >
                <option value="">All Warehouses</option>
                {stores.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="filter-item" style={{ minWidth: '220px' }}>
              <label className="filter-label">SKU Identifier</label>
              <div className="filter-input-wrapper">
                <input
                  type="text"
                  list="forecast-sku-options"
                  className="filter-input"
                  placeholder="Enter or select SKU..."
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
                    onClick={() => { setSkuSearch(''); }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="filter-item" style={{ alignSelf: 'flex-end' }}>
              <button
                type="submit"
                className="search-btn"
              >
                Search
              </button>
            </div>
          </form>

          <div className="filter-group" style={{ flex: 'none' }}>
            {/* Horizon Selector (7, 14, 28 days) */}
            <div className="filter-item">
              <label className="filter-label">Forecast Horizon</label>
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
              <label className="filter-label">ML Engine Selector</label>
              <select
                className="ml-engine-select"
                value={selectedEngine}
                onChange={(e) => {
                  setSelectedEngine(e.target.value);
                  setToast({ type: 'success', message: isVi ? `Đã chọn mô hình ${e.target.value}` : `Selected model ${e.target.value}` });
                }}
              >
                <option value="LightGBM">LightGBM (Champion)</option>
                <option value="XGBoost">XGBoost (Challenger)</option>
                <option value="Baseline">Statistical Baseline</option>
              </select>
            </div>

            {/* Export CSV Button */}
            <div className="filter-item" style={{ alignSelf: 'flex-end' }}>
              <button
                type="button"
                className="export-csv-btn"
                onClick={handleExportForecastCsv}
                title={isVi ? "Xuất file CSV dự báo thời gian thực" : "Export real-time forecast CSV"}
              >
                <FileSpreadsheet size={15} />
                <span>Export CSV</span>
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* Main Chart (Uncertainty band p10/p50/p90) */}
      <Card className="mb-6 p-6">
        <div className="chart-header">
          <div className="chart-title-area">
            <h3>Historical Sales & ML Demand Forecast</h3>
            <p>
              Light teal band indicates the 90% predictive uncertainty interval (p10 to p90) for SKU <strong>{skuSearch}</strong> over {horizon}-day horizon.
            </p>
          </div>
          <div className="chart-legend">
            <div className="legend-item"><div className="legend-line-actual"></div> Historical Sales</div>
            <div className="legend-item"><div className="legend-line-predicted"></div> Point Forecast (p50)</div>
            <div className="legend-item">
              <div className="legend-box-horizon" style={{ backgroundColor: '#e6f6f4', opacity: 1 }}></div>
              90% Confidence Interval (p10 - p90)
            </div>
          </div>
        </div>

        <div className="chart-area" style={{ height: '320px' }}>
          <div className="forecast-horizon-bg" style={{ width: '45%', backgroundColor: '#f0fdfa', opacity: 0.5 }}></div>
          {isLoading || !data ? (
            <div className="flex items-center justify-center h-full text-[var(--text-secondary)]">
              Loading forecast trajectory...
            </div>
          ) : (
            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data?.chartData || []} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                  <XAxis dataKey="name" stroke="var(--text-secondary)" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '5 5' }}
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', borderRadius: '6px', boxShadow: 'var(--shadow-md)' }}
                  />
                  <Area type="monotone" dataKey="ci_upper" fill="#e6f6f4" stroke="none" />
                  <Area type="monotone" dataKey="ci_lower" fill="#ffffff" stroke="none" />
                  <Line type="monotone" dataKey="actual" stroke="#475569" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="predicted" stroke="#0d9488" strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Manual Forecast Override & Governance Panel */}
        <div className="override-panel">
          <div className="override-panel-header">
            <div className="override-header-left">
              <div className="override-icon-wrapper">
                <SlidersHorizontal size={18} />
              </div>
              <div className="override-title-area">
                <div className="override-title-row">
                  <h4 className="override-main-title">Manual Forecast Override & Governance</h4>
                  {overrides.length > 0 ? (
                    <span className="override-status-badge active">
                      <span className="status-dot" />
                      {overrides.length} {isVi ? "Điều chỉnh đang kích hoạt" : "Active Overrides"}
                    </span>
                  ) : (
                    <span className="override-status-badge idle">
                      <ShieldCheck size={12} />
                      100% ML Baseline Active
                    </span>
                  )}
                </div>
                <p className="override-panel-desc">
                  {isVi ? 'Can thiệp thủ công chỉ số dự báo khi có biến động thị trường hoặc chương trình đột xuất. Mọi thay đổi đều được lưu vết kiểm toán tự động.' : 'Manually adjust forecast quantities for promotional spikes or market changes. All revisions are automatically logged for audit compliance.'}
                </p>
              </div>
            </div>

            <div className="override-header-right">
              {canEdit && (
                <>
                  <button
                    type="button"
                    className="override-btn-secondary"
                    onClick={handleOpenBulkOverride}
                    title={isVi ? "Điều chỉnh dự báo hàng loạt theo % hoặc số lượng cố định" : "Bulk adjust forecasts by percentage or fixed quantity"}
                  >
                    <Layers size={14} className="override-btn-icon" />
                    <span>Bulk Adjust</span>
                  </button>
                  <button
                    type="button"
                    className="override-btn-primary"
                    onClick={handleOpenOverride}
                    title={isVi ? "Thêm can thiệp dự báo cho một ngày cụ thể" : "Add manual override for a specific date"}
                  >
                    <Plus size={15} className="override-btn-icon" />
                    <span>Single Override</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Executive Governance Summary Bar (sleek, single-row, no bulky boxes) */}
          <div className="override-summary-bar">
            <div className="override-summary-item">
              <span className="override-summary-label">{isVi ? "Can thiệp kích hoạt" : "Active Overrides"}</span>
              <div className="override-summary-val">
                <span className="override-summary-val-main">{overrides.length}</span>
                <span className="override-summary-val-sub">{isVi ? `ngày / ${horizon}d` : `days / ${horizon}d`}</span>
              </div>
            </div>

            <div className="override-summary-divider" />

            <div className="override-summary-item">
              <span className="override-summary-label">{isVi ? "Tác động ròng (Net Δ)" : "Net Impact (Net Δ)"}</span>
              <div className="override-summary-val">
                <span
                  className={`override-summary-delta ${
                    overrideMetrics.totalDelta > 0
                      ? 'delta-pos'
                      : overrideMetrics.totalDelta < 0
                      ? 'delta-neg'
                      : 'delta-zero'
                  }`}
                >
                  {overrideMetrics.totalDelta > 0 ? (
                    <TrendingUp size={13} />
                  ) : overrideMetrics.totalDelta < 0 ? (
                    <TrendingDown size={13} />
                  ) : null}
                  <span>
                    {overrideMetrics.totalDelta > 0
                      ? `+${overrideMetrics.totalDelta.toLocaleString()}`
                      : overrideMetrics.totalDelta.toLocaleString()}{' '}
                    units
                  </span>
                  {overrideMetrics.totalOriginal > 0 && (
                    <span className="override-summary-delta-pct">
                      ({overrideMetrics.totalDelta > 0 ? '+' : ''}
                      {Math.round((overrideMetrics.totalDelta / overrideMetrics.totalOriginal) * 100)}%)
                    </span>
                  )}
                </span>
              </div>
            </div>

            <div className="override-summary-divider" />

            <div className="override-summary-item">
              <span className="override-summary-label">{isVi ? "Dự báo sau điều chỉnh" : "Adjusted Horizon"}</span>
              <div className="override-summary-val">
                <span className="override-summary-val-main">
                  {data?.stats?.predictedDemand != null
                    ? String(data.stats.predictedDemand).replace(/\s*units?/i, '')
                    : '111'}
                </span>
                <span className="override-summary-val-sub">units</span>
              </div>
            </div>

            <div className="override-summary-divider" />

            <div className="override-summary-item">
              <span className="override-summary-label">{isVi ? "Kiểm soát kiểm toán" : "Audit Compliance"}</span>
              <div className="override-summary-val">
                <span className="override-summary-audit-chip">
                  <ShieldCheck size={13} />
                  <span>{isVi ? "100% Ghi vết (Audit Logged)" : "100% Audit Logged"}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Active Overrides Table or Empty State */}
          {overrides.length > 0 ? (
            <div className="override-table-wrapper">
              <table className="override-table">
                <thead>
                  <tr>
                    <th>Target Date</th>
                    <th>Baseline (Units)</th>
                    <th>Override (Units)</th>
                    <th>Variance Impact (Δ)</th>
                    <th>Reason & Audit Notes</th>
                    <th>Authorized By</th>
                    {canEdit && <th style={{ textAlign: 'right' }}>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {overrides.map((ov: any) => {
                    const orig = typeof ov.original_value === 'number' ? Math.round(ov.original_value) : (Number(ov.original_value) || 0);
                    const over = typeof ov.override_value === 'number' ? Math.round(ov.override_value) : (Number(ov.override_value) || 0);
                    const diff = over - orig;
                    const pct = orig > 0 ? Math.round((diff / orig) * 100) : (diff > 0 ? 100 : 0);
                    const { formatted, dayOfWeek } = formatOverrideDate(ov.forecast_date);
                    const { category, detail, catClass, dotColor } = parseOverrideReason(ov.reason);

                    return (
                      <tr key={ov.id}>
                        <td>
                          <div className="override-date-cell">
                            <Calendar size={13} className="override-date-icon" />
                            <span className="override-date-text">{formatted}</span>
                            {dayOfWeek && <span className="override-day-tag">{dayOfWeek}</span>}
                          </div>
                        </td>
                        <td>
                          <span className="override-baseline-cell">
                            {orig.toLocaleString()}
                          </span>
                        </td>
                        <td>
                          <span className="override-val-cell">
                            {over.toLocaleString()}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`override-delta-tag ${
                              diff > 0 ? 'override-delta-pos' : diff < 0 ? 'override-delta-neg' : 'override-delta-zero'
                            }`}
                          >
                            {diff > 0 ? (
                              <>
                                <TrendingUp size={12} />
                                <span>+{diff.toLocaleString()}</span>
                                <span className="override-delta-pct">(+{pct}%)</span>
                              </>
                            ) : diff < 0 ? (
                              <>
                                <TrendingDown size={12} />
                                <span>{diff.toLocaleString()}</span>
                                <span className="override-delta-pct">({pct}%)</span>
                              </>
                            ) : (
                              <span>0 (0%)</span>
                            )}
                          </span>
                        </td>
                        <td>
                          <div className="override-reason-cell">
                            <span className={`override-cat-tag ${catClass}`}>
                              <span className="override-cat-dot" style={{ backgroundColor: dotColor }} />
                              {category}
                            </span>
                            {detail && <span className="override-note-text" title={detail}>{detail}</span>}
                          </div>
                        </td>
                        <td>
                          <div className="override-author-cell">
                            <div className="override-author-avatar">
                              {(ov.created_by || 'Staff').slice(0, 2).toUpperCase()}
                            </div>
                            <span className="override-author-name">{ov.created_by || 'Staff'}</span>
                          </div>
                        </td>
                        {canEdit && (
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="override-revert-btn"
                              onClick={() => handleRevertOverride(ov.id)}
                              title={isVi ? "Khôi phục về giá trị dự báo gốc của ML" : "Revert back to ML baseline"}
                            >
                              <RotateCcw size={12} />
                              <span>Revert</span>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="override-empty-box">
              <div className="override-empty-icon">
                <ShieldCheck size={26} />
              </div>
              <h5 className="override-empty-title">{isVi ? "Chưa Có Can Thiệp Thủ Công Cho SKU Này" : "No Manual Overrides for this SKU"}</h5>
              <p className="override-empty-desc">
                {isVi ? `Dự báo nhu cầu cho chu kỳ ${horizon} ngày đang tuân thủ 100% thuật toán Machine Learning (${selectedEngine}) mà không bị điều chỉnh. Bạn có thể can thiệp số lượng khi có chương trình khuyến mãi hoặc sự kiện đột xuất.` : `The ${horizon}-day demand forecast is 100% governed by the ${selectedEngine} Machine Learning algorithm without planner interventions. You can intervene when promotional campaigns or supply disruptions occur.`}
              </p>
              {canEdit && (
                <div style={{ display: 'flex', gap: '0.625rem' }}>
                  <button
                    type="button"
                    className="override-btn-primary"
                    onClick={handleOpenOverride}
                  >
                    <Plus size={15} />
                    <span>{isVi ? "Thêm Điều Chỉnh Đơn Lẻ" : "Add Single Override"}</span>
                  </button>
                  <button
                    type="button"
                    className="override-btn-secondary"
                    onClick={handleOpenBulkOverride}
                  >
                    <Layers size={14} />
                    <span>{isVi ? "Điều Chỉnh Hàng Loạt" : "Bulk Adjustment"}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {!isLoading && data && (
        <div className="grid-cols-2">
          {/* Stats Card */}
          <Card className="p-6">
            <div className="perf-card-header">
              <div>
                <h3 className="perf-card-title">
                  Forecast Performance & Uncertainty
                </h3>
                <p className="engine-desc" style={{ marginBottom: 0 }}>
                  Engine: LightGBM / XGBoost multi-step horizon optimization with conformal prediction bands.
                </p>
              </div>
              <span className="perf-engine-badge">
                {selectedEngine} • Conformal Bands
              </span>
            </div>

            <div className="perf-kpi-grid">
              <div className="perf-kpi-item">
                <div className="perf-kpi-label">Predicted {horizon}d Demand</div>
                <div className="perf-kpi-val">{data?.stats?.predictedDemand || '-'}</div>
                <div className="perf-kpi-sub">{isVi ? "Tổng nhu cầu dự báo chu kỳ" : "Total horizon predicted demand"}</div>
              </div>

              <div className="perf-kpi-item">
                <div className="perf-kpi-label">Uncertainty Spread</div>
                <div className="perf-kpi-val">{data?.stats?.ci || '-'}</div>
                <div className="perf-kpi-sub">{isVi ? "Dải khoảng tin cậy p10 - p90" : "p10 - p90 uncertainty spread"}</div>
              </div>

              <div className="perf-kpi-item">
                <div className="perf-kpi-label">Safety Stock Cushion</div>
                <div className="perf-kpi-val">{data?.stats?.safetyStock || '-'}</div>
                <div className="perf-kpi-sub">{isVi ? `Điểm tái đặt hàng ROP: ${data?.stats?.reorderPoint || '-'}` : `Reorder Point (ROP): ${data?.stats?.reorderPoint || '-'}`}</div>
              </div>

              <div className="perf-kpi-item">
                <div className="perf-kpi-label">Evaluated MASE</div>
                <div className="perf-kpi-val">
                  <span>{data?.stats?.mase || '-'}</span>
                  {data?.stats?.mase && data.stats.mase !== '-' && (
                    <span className="perf-badge-sota">Evaluated</span>
                  )}
                </div>
                <div className="perf-kpi-sub">Mean Absolute Scaled Error</div>
              </div>
            </div>

            {/* SHAP Feature Contribution (XAI Explainability) */}
            <div className="shap-section">
              <div className="shap-header">
                <div className="shap-title-wrapper">
                  <div className="shap-icon-box">
                    <BrainCircuit size={16} />
                  </div>
                  <div>
                    <div className="shap-title-row">
                      <h4 className="shap-title">Feature Contribution (SHAP Importance)</h4>
                      <span className="shap-tag-tech">TreeSHAP</span>
                    </div>
                    <p className="shap-desc">
                      {isVi ? "Mức độ tác động của từng đặc trưng lên sản lượng dự báo (SHAP Attribution)" : "Feature impact on predicted sales volume (SHAP Attribution)"}
                    </p>
                  </div>
                </div>
                {explanation?.base_value != null && (
                  <div className="shap-base-val-chip" title={isVi ? "Giá trị kỳ vọng cơ sở của mô hình khi chưa xét tác động đặc trưng" : "Baseline expected model output before feature contributions"}>
                    <span className="shap-base-label">Base E[f(x)]:</span>
                    <span className="shap-base-num">{explanation.base_value} units</span>
                  </div>
                )}
              </div>

              {explanation?.features && explanation.features.length > 0 ? (
                <div className="shap-compact-table">
                  {explanation.features.slice(0, 5).map((f: any, idx: number) => {
                    const rawScore = typeof f.importance_score === 'number'
                      ? f.importance_score
                      : (typeof f.importance === 'number' ? f.importance : 0);
                    const meta = FEATURE_METADATA[f.feature_name] || {
                      label: f.feature_name ? f.feature_name.replace(/_/g, ' ') : (isVi ? `Đặc trưng ${idx + 1}` : `Feature ${idx + 1}`),
                      desc: f.description || (isVi ? 'Đặc trưng hồi quy trong mô hình Machine Learning' : 'Regression feature in Machine Learning model'),
                      defaultDir: rawScore >= 0 ? 'positive' : 'negative',
                    };
                    const isNeg = f.direction === 'negative' || (f.direction == null && (rawScore < 0 || meta.defaultDir === 'negative'));
                    const absScore = Math.abs(rawScore);
                    const barWidth = maxShapScore > 0 ? Math.min(100, Math.round((absScore / maxShapScore) * 100)) : 20;
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
                  <span>{isVi ? "Chưa có dữ liệu phân tích SHAP giải thích cho mô hình hiện tại" : "No SHAP explainability data available for the current model"}</span>
                </div>
              )}

              {/* Footer explanation note */}
              <div className="shap-footer-legend">
                <div className="shap-legend-item">
                  <span className="shap-legend-dot pos" />
                  <span>{isVi ? "Dương (+): Kích thích tăng sản lượng" : "Positive (+): Stimulates demand"}</span>
                </div>
                <div className="shap-legend-item">
                  <span className="shap-legend-dot neg" />
                  <span>{isVi ? "Âm (-): Độ co giãn kìm hãm nhu cầu" : "Negative (-): Dampens demand"}</span>
                </div>
                <div className="shap-legend-item ml-auto">
                  <span className="shap-legend-text">{isVi ? `Mô hình ${selectedEngine} (TreeSHAP)` : `${selectedEngine} Model (TreeSHAP)`}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Matrix Schedule Table */}
          <Card className="p-6">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 className="chart-title-area" style={{ fontSize: '1.125rem', fontWeight: 700, fontFamily: 'Outfit' }}>
                  Daily Predictive Matrix
                </h3>
                <p className="engine-desc" style={{ marginBottom: 0 }}>
                  Upcoming demand schedule with risk band indicators
                </p>
              </div>
              <button
                type="button"
                className="export-matrix-btn"
                onClick={handleExportMatrixCsv}
                title={isVi ? "Xuất bảng ma trận lịch trình dự báo thành file CSV" : "Export schedule matrix to CSV"}
              >
                <Download size={14} />
                <span>Export Schedule CSV</span>
              </button>
            </div>

            <div className="matrix-table">
              <div className="matrix-header-row">
                <div className="matrix-col-header matrix-col-1">DATE</div>
                <div className="matrix-col-header matrix-col-2">PREDICTED</div>
                <div className="matrix-col-header matrix-col-3">LOWER (p10)</div>
                <div className="matrix-col-header matrix-col-4">UPPER (p90)</div>
                <div className="matrix-col-header matrix-col-5 text-right">SPIKE RISK</div>
              </div>

              {paginatedScheduleMatrix.map((row: any, idx: number) => (
                <div className="matrix-row" key={idx}>
                  <div className="matrix-cell matrix-col-1 font-bold">{row.date}</div>
                  <div className="matrix-cell matrix-col-2 text-teal">{row.demand} units</div>
                  <div className="matrix-cell matrix-col-3">{row.lower} units</div>
                  <div className="matrix-cell matrix-col-4">{row.upper} units</div>
                  <div className={`matrix-cell matrix-col-5 text-right ${row.spikeColor}`}>{row.spike}</div>
                </div>
              ))}
            </div>

            {(data?.scheduleMatrix?.length || 0) > matrixPageSize && (
              <Pagination
                currentPage={matrixPage}
                totalItems={data.scheduleMatrix.length}
                pageSize={matrixPageSize}
                onPageChange={setMatrixPage}
                onPageSizeChange={(newSize) => {
                  setMatrixPageSize(newSize);
                  setMatrixPage(1);
                }}
                pageSizeOptions={[7, 14, 28]}
              />
            )}
          </Card>
        </div>
      )}

      {/* Manual Override Modal */}
      {isOverrideModalOpen && createPortal(
        <div className="modal-overlay" onClick={() => setIsOverrideModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-info">
                <div className="modal-title-row">
                  <h2 className="modal-title">Manual Forecast Override</h2>
                </div>
                <div className="modal-badge-group">
                  <span className="modal-badge highlight">SKU: {skuSearch || 'FOODS_1_001'}</span>
                  <span className="modal-badge">Store: {selectedStore || 'CA_1'}</span>
                  <span className="modal-badge">{isVi ? `Chu kỳ: ${horizon}d` : `Horizon: ${horizon}d`}</span>
                </div>
              </div>
              <button className="modal-close" onClick={() => setIsOverrideModalOpen(false)} title={isVi ? "Đóng" : "Close"}>
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleApplyOverride} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body">
                {overrideError ? (
                  <div className="p-3 mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded" style={{ borderRadius: '6px' }}>
                    {String(overrideError)}
                  </div>
                ) : null}

                <div className="modal-form-group">
                  <label>{isVi ? "Ngày Can Thiệp (Target Forecast Date)" : "Target Forecast Date"}</label>
                  <input
                    type="date"
                    required
                    className="modal-input"
                    value={overrideDate}
                    onChange={(e) => setOverrideDate(e.target.value)}
                  />
                </div>

                <div className="modal-form-group">
                  <label>{isVi ? "Số Lượng Dự Báo Điều Chỉnh (Adjusted Quantity)" : "Adjusted Quantity"}</label>
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
                    <span className="modal-input-suffix">units</span>
                  </div>
                </div>

                <div className="modal-form-group">
                  <label>{isVi ? "Danh Mục Lý Do (Reason Category)" : "Reason Category"}</label>
                  <select
                    className="modal-select"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                  >
                    <option value="Promotional Spike Override">{isVi ? "Chiến Dịch Khuyến Mãi (Promotional Spike)" : "Promotional Spike Override"}</option>
                    <option value="Seasonal Demand Surge">{isVi ? "Biến Động Nhu Cầu Mùa Vụ (Seasonal Surge)" : "Seasonal Demand Surge"}</option>
                    <option value="Supply Chain Disruption">{isVi ? "Đứt Gãy Cung Ứng / Thiếu Hụt (Supply Shortage)" : "Supply Chain Disruption"}</option>
                    <option value="Market Competitor Action">{isVi ? "Biến Động Đối Thủ Cạnh Tranh (Market Action)" : "Market Competitor Action"}</option>
                    <option value="Unplanned Event">{isVi ? "Sự Kiện Đột Xuất (Unplanned Event)" : "Unplanned Event"}</option>
                  </select>
                </div>

                <div className="modal-form-group" style={{ marginBottom: 0 }}>
                  <label>{isVi ? "Giải Trình Nghiệp Vụ Chi Tiết (Bắt buộc cho kiểm toán)" : "Operational Justification (Audit Required)"}</label>
                  <textarea
                    required
                    className="modal-textarea"
                    placeholder={isVi ? "Nhập lý do chi tiết cho việc can thiệp thủ công (sẽ ghi nhận vào nhật ký kiểm toán)..." : "Enter detailed rationale for manual intervention (recorded in audit logs)..."}
                    value={overrideNotes}
                    onChange={(e) => setOverrideNotes(e.target.value)}
                    rows={3}
                  ></textarea>
                </div>
              </div>

              <div className="modal-footer">
                <div className="modal-footer-notice">
                  <ShieldCheck size={14} className="text-teal" />
                  <span>{isVi ? "Lưu vết kiểm toán tự động" : "Automatic audit logging active"}</span>
                </div>
                <div className="modal-footer-actions">
                  <button
                    type="button"
                    className="modal-btn-cancel"
                    onClick={() => setIsOverrideModalOpen(false)}
                    disabled={isSubmittingOverride}
                  >
                    {isVi ? "Hủy Bỏ" : "Cancel"}
                  </button>
                  <button
                    type="submit"
                    className="modal-btn-apply"
                    disabled={isSubmittingOverride}
                  >
                    {isVi ? (isSubmittingOverride ? 'Đang Lưu...' : 'Áp Dụng Điều Chỉnh') : (isSubmittingOverride ? 'Saving...' : 'Apply Override')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Bulk Override Modal - 2-Column Horizontal Architecture */}
      {isBulkOverrideOpen && createPortal(
        <div className="modal-overlay" onClick={() => setIsBulkOverrideOpen(false)}>
          <div className="modal-content bulk-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-info">
                <div className="modal-title-row">
                  <h2 className="modal-title">Bulk Forecast Horizon Override</h2>
                </div>
                <div className="modal-badge-group">
                  <span className="modal-badge highlight">SKU: {skuSearch || 'FOODS_1_001'}</span>
                  <span className="modal-badge">Store: {selectedStore || 'CA_1'}</span>
                  <span className="modal-badge">{isVi ? `${bulkPreviewRows.length} ngày dự báo trong khoảng` : `${bulkPreviewRows.length} forecast days in range`}</span>
                </div>
              </div>
              <button className="modal-close" onClick={() => setIsBulkOverrideOpen(false)} title={isVi ? "Đóng" : "Close"}>
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleApplyBulkOverride} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body">
                {bulkError ? (
                  <div className="p-3 mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded" style={{ borderRadius: '6px' }}>
                    {String(bulkError)}
                  </div>
                ) : null}

                <div className="bulk-modal-grid">
                  {/* Left Column: Adjustment Parameters */}
                  <div className="bulk-grid-col">
                    <div className="modal-form-group">
                      <label>{isVi ? "Chế Độ Điều Chỉnh (Adjustment Mode)" : "Adjustment Mode"}</label>
                      <div className="bulk-mode-toggle">
                        <button
                          type="button"
                          className={`bulk-mode-btn ${bulkMode === 'percent' ? 'active' : ''}`}
                          onClick={() => setBulkMode('percent')}
                        >
                          {isVi ? "Tỷ Lệ % (+/- %)" : "Percentage (+/- %)"}
                        </button>
                        <button
                          type="button"
                          className={`bulk-mode-btn ${bulkMode === 'fixed' ? 'active' : ''}`}
                          onClick={() => setBulkMode('fixed')}
                        >
                          {isVi ? "Số Lượng Cố Định" : "Fixed Quantity"}
                        </button>
                      </div>
                    </div>

                    <div className="bulk-date-row">
                      <div className="modal-form-group" style={{ flex: 1 }}>
                        <label>{isVi ? "Từ Ngày (Start Date)" : "Start Date"}</label>
                        <input
                          type="date"
                          required
                          className="modal-input"
                          value={bulkStartDate}
                          onChange={(e) => setBulkStartDate(e.target.value)}
                        />
                      </div>
                      <div className="modal-form-group" style={{ flex: 1 }}>
                        <label>{isVi ? "Đến Ngày (End Date)" : "End Date"}</label>
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
                          <label style={{ margin: 0 }}>{isVi ? "Tỷ Lệ Điều Chỉnh (%)" : "Adjustment Percentage (%)"}</label>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0f766e', fontFamily: 'monospace' }}>
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
                            placeholder={isVi ? "e.g. 15 cho +15%, -10 cho -10%" : "e.g. 15 for +15%, -10 for -10%"}
                          />
                          <span className="modal-input-suffix">%</span>
                        </div>
                        <span style={{ fontSize: '0.6875rem', color: '#64748b', marginTop: '0.35rem', display: 'block', lineHeight: 1.35 }}>
                          {isVi ? "Giá trị dương để tăng dự báo (chiến dịch khuyến mãi, sự kiện), giá trị âm để giảm bớt." : "Positive values increase forecast (promotions, events); negative values decrease it."}
                        </span>
                      </div>
                    ) : (
                      <div className="modal-form-group">
                        <label>{isVi ? "Số Lượng Cố Định Mỗi Ngày" : "Fixed Daily Quantity"}</label>
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
                          <span className="modal-input-suffix">{isVi ? "units / ngày" : "units / day"}</span>
                        </div>
                        <span style={{ fontSize: '0.6875rem', color: '#64748b', marginTop: '0.35rem', display: 'block', lineHeight: 1.35 }}>
                          {isVi ? "Áp dụng đồng đều cùng một mức sản lượng cho tất cả các ngày trong khoảng thời gian đã chọn." : "Applies the same fixed quantity across all days in the selected range."}
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
                            {isVi ? `Xem Trước: ${bulkPreviewRows.length} Ngày Bị Ảnh Hưởng` : `Preview: ${bulkPreviewRows.length} Affected Days`}
                          </span>
                          <span style={{ fontSize: '0.6875rem', color: '#64748b', fontFamily: 'monospace' }}>
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
                                  {r.original} → <strong style={{ color: '#0f766e' }}>{r.projected} u</strong>
                                  <span style={{ color: diff >= 0 ? '#059669' : '#e11d48', marginLeft: '0.35rem', fontWeight: 600 }}>
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
                      <label>{isVi ? "Danh Mục Lý Do (Reason Category)" : "Reason Category"}</label>
                      <select
                        className="modal-select"
                        value={bulkReason}
                        onChange={(e) => setBulkReason(e.target.value)}
                      >
                        <option value="Promotional Spike Override">{isVi ? "Chiến Dịch Khuyến Mãi (Promotional Campaign)" : "Promotional Campaign Override"}</option>
                        <option value="Seasonal Demand Surge">{isVi ? "Nhu Cầu Mùa Vụ Tăng Vọt (Seasonal Surge)" : "Seasonal Demand Surge"}</option>
                        <option value="Supply Chain Disruption">{isVi ? "Đứt Gãy Chuỗi Cung Ứng (Supply Disruption)" : "Supply Disruption"}</option>
                        <option value="Market Competitor Action">{isVi ? "Biến Động Thị Trường / Đối Thủ (Market Action)" : "Market Action / Competitor"}</option>
                        <option value="Unplanned Event">{isVi ? "Sự Kiện Đột Xuất (Unplanned Event)" : "Unplanned Event"}</option>
                      </select>
                    </div>

                    <div className="modal-form-group" style={{ marginBottom: 0 }}>
                      <label>{isVi ? "Giải Trình Nghiệp Vụ Bắt Buộc (Audit Trail)" : "Mandatory Operational Justification (Audit Trail)"}</label>
                      <textarea
                        required
                        className="modal-textarea"
                        placeholder={isVi ? "Nêu rõ lý do điều chỉnh hàng loạt (ví dụ: Khuyến mãi Black Friday 4 ngày tại chuỗi siêu thị CA)..." : "Specify reason for bulk override (e.g. Black Friday 4-day promotion across CA stores)..."}
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
                  <span>{isVi ? "Ghi vết kiểm toán tự động theo quy định quản trị SCM" : "Automated audit trail logged per SCM governance standards"}</span>
                </div>
                <div className="modal-footer-actions">
                  <button
                    type="button"
                    className="modal-btn-cancel"
                    onClick={() => setIsBulkOverrideOpen(false)}
                    disabled={isSubmittingBulk}
                  >
                    {isVi ? "Hủy Bỏ" : "Cancel"}
                  </button>
                  <button
                    type="submit"
                    className="modal-btn-apply"
                    disabled={isSubmittingBulk || bulkPreviewRows.length === 0}
                  >
                    {isVi ? (isSubmittingBulk ? 'Đang Lưu...' : `Áp Dụng Điều Chỉnh (${bulkPreviewRows.length} Ngày)`) : (isSubmittingBulk ? 'Saving...' : `Apply Bulk Override (${bulkPreviewRows.length} Days)`)}
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
