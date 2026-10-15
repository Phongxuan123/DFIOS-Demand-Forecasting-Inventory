import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '../components/ui/Card.tsx';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, Line } from 'recharts';
import { X, Download, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { api } from '../services/api.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import './ForecastExplorer.css';

export const ForecastExplorer: React.FC = () => {
  const { user } = useAuth();
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

      if (canEdit && targetSku) {
        const [explRes, overRes] = await Promise.all([
          api.forecasting.getExplanation(targetSku, { store_id: store || selectedStore }).catch(() => null),
          api.forecasting.getOverrides(targetSku, { store_id: store || selectedStore }).catch(() => []),
        ]);
        setExplanation(explRes);
        setOverrides(overRes || []);
      }
    } catch (error) {
      console.error('Failed to load forecast explorer data', error);
      setToast({ type: 'error', message: 'Không thể tải dữ liệu dự báo. Đang hiển thị dự báo mặc định.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const initFilters = async () => {
      try {
        const [catList, storeList, prodRes] = await Promise.all([
          api.products.getCategories().catch(() => []),
          api.inventory.getStores().catch(() => []),
          api.products.getAllProducts().catch(() => ({ list: [] })),
        ]);
        setCategories(catList || []);
        setStores(storeList || []);
        const pList = prodRes?.list || [];
        setProducts(pList);

        let initialStore = '';
        if (storeList && storeList.length > 0) {
          initialStore = storeList[0];
          setSelectedStore(initialStore);
        }

        const initialSku = pList.length > 0 ? pList[0].item_id : 'FOODS_1_001';
        setSkuSearch(initialSku);
        fetchForecast(initialSku, 28, initialStore);
      } catch (e) {
        console.error(e);
        fetchForecast('FOODS_1_001', 28, '');
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
      setToast({ type: 'warning', message: 'Không có dữ liệu dự báo để xuất CSV!' });
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
    setToast({ type: 'success', message: `Đã xuất ${rows.length} dòng dự báo ra file ${filename} thành công!` });
  };

  const handleExportMatrixCsv = () => {
    if (!data?.scheduleMatrix || data.scheduleMatrix.length === 0) {
      setToast({ type: 'warning', message: 'Không có dữ liệu ma trận lịch trình để xuất CSV!' });
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
    setToast({ type: 'success', message: `Đã xuất ma trận dự báo ${rows.length} ngày ra file ${filename} thành công!` });
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
      setToast({ type: 'success', message: `Đã áp dụng điều chỉnh dự báo cho ngày ${overrideDate} thành công!` });
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
    if (!window.confirm('Bạn có chắc chắn muốn hoàn tác điều chỉnh này và quay về baseline của mô hình ML không?')) return;
    try {
      await api.forecasting.revertOverride(skuSearch, overrideId);
      setToast({ type: 'success', message: 'Đã hoàn tác điều chỉnh dự báo về ML baseline thành công!' });
      await fetchForecast(skuSearch, horizon, selectedStore);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string'
        ? detail
        : (Array.isArray(detail) ? detail.map((x: any) => x.msg).join(', ') : err.message || 'Lỗi hoàn tác điều chỉnh');
      setToast({ type: 'error', message: msg });
    }
  };

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
                  setToast({ type: 'success', message: `Đã chọn mô hình ${e.target.value}` });
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
                title="Xuất file CSV dự báo thời gian thực"
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

        {/* Manual Forecast Override Bar */}
        <div className="override-section">
          <div className="override-info">
            <h4 className="override-title">Manual Forecast Override</h4>
            <p className="override-desc">
              Thủ kho và Quản lý có thể điều chỉnh thủ công dự báo kèm lý do bắt buộc khi có biến động thị trường hoặc chương trình đột xuất.
            </p>
            <div className="override-current">
              <span className="override-label">Active Forecast Demand</span>
              <span className="override-value">{data?.stats?.predictedDemand || 'N/A'}</span>
            </div>
          </div>
          <div className="override-action">
            {overrides.length > 0 && (
              <span className="override-status text-teal">
                {overrides.length} Manual Override(s) Active
              </span>
            )}
            {canEdit && (
              <button type="button" className="override-btn" onClick={handleOpenOverride}>
                Override Forecast
              </button>
            )}
          </div>
        </div>

        {/* Active Overrides List */}
        {overrides.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <h5 className="text-xs font-bold text-slate-700 uppercase mb-2">Active Override Entries</h5>
            <div className="space-y-2">
              {overrides.map((ov: any) => (
                <div key={ov.id} className="flex justify-between items-center text-xs p-2 bg-slate-50 rounded border border-slate-200">
                  <div>
                    <span className="font-semibold text-slate-800">Date: {ov.forecast_date}</span> •
                    <span className="text-slate-500 ml-1">
                      Original: {typeof ov.original_value === 'number' ? Math.round(ov.original_value) : ov.original_value} → Override: <strong>{ov.override_value} units</strong>
                    </span>
                    <span className="text-slate-500 block mt-0.5">
                      Reason: {ov.reason} <span className="text-slate-400">({ov.created_by || 'Staff'})</span>
                    </span>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      className="revert-btn"
                      onClick={() => handleRevertOverride(ov.id)}
                    >
                      Revert Baseline
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {!isLoading && data && (
        <div className="grid-cols-2">
          {/* Stats Card */}
          <Card className="p-6">
            <h3 className="chart-title-area" style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: 700, fontFamily: 'Outfit' }}>
              Forecast Performance & Uncertainty
            </h3>
            <p className="engine-desc">
              Engine: LightGBM / XGBoost multi-step horizon optimization with conformal prediction bands.
            </p>

            <div className="stats-list">
              <div className="stat-item">
                <span className="stat-label">Predicted {horizon}d Demand</span>
                <span className="stat-value">{data?.stats?.predictedDemand || '-'}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Safety Stock Cushion</span>
                <span className="stat-value">{data?.stats?.safetyStock || '-'}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Reorder Point (ROP)</span>
                <span className="stat-value">{data?.stats?.reorderPoint || '-'}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Evaluated MASE</span>
                <span className="stat-value" style={{ display: 'flex', gap: '0.25rem' }}>
                  <strong>{data?.stats?.mase || '-'}</strong>
                  <span className="text-teal">(Production Model)</span>
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Uncertainty Spread</span>
                <span className="stat-value">{data?.stats?.ci || '±12%'}</span>
              </div>
            </div>

            {/* SHAP Feature Importance */}
            {explanation?.features && explanation.features.length > 0 && (
              <div className="mt-6 pt-4 border-t border-slate-200">
                <h4 className="text-xs font-bold text-slate-700 uppercase mb-3">Feature Contribution (SHAP Importance)</h4>
                <div className="space-y-2">
                  {explanation.features.slice(0, 5).map((f: any, idx: number) => {
                    const score = typeof f.importance_score === 'number'
                      ? f.importance_score
                      : (typeof f.importance === 'number' ? f.importance : 0);
                    const isPositive = score >= 0;
                    return (
                      <div key={idx} className="flex justify-between items-center text-xs">
                        <span className="text-slate-600">{f.feature_name || f.feature || `Feature ${idx + 1}`}</span>
                        <span className={`font-semibold ${isPositive ? 'text-teal' : 'text-amber-600'}`}>
                          {isPositive ? `+${score.toFixed(2)}` : score.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
                title="Xuất bảng ma trận lịch trình dự báo thành file CSV"
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
            <button className="modal-close" onClick={() => setIsOverrideModalOpen(false)}><X size={16} /></button>
            <h2 className="modal-title">Manual Forecast Override</h2>
            <p className="modal-subtitle">
              SKU: <strong>{skuSearch}</strong> • Store: {selectedStore || 'Global'} • Horizon: {horizon}d
            </p>

            {overrideError ? (
              <div className="p-3 my-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded" style={{ borderRadius: '4px' }}>
                {String(overrideError)}
              </div>
            ) : null}

            <form onSubmit={handleApplyOverride}>
              <div className="modal-form-group mt-4">
                <label>Target Forecast Date (YYYY-MM-DD)</label>
                <input
                  type="date"
                  required
                  className="modal-input"
                  value={overrideDate}
                  onChange={(e) => setOverrideDate(e.target.value)}
                />
              </div>

              <div className="modal-form-group">
                <label>Adjusted Demand Quantity</label>
                <div className="modal-input-wrapper">
                  <input
                    type="number"
                    min="0"
                    required
                    value={overrideValue}
                    onChange={(e) => setOverrideValue(e.target.value)}
                    className="modal-input"
                  />
                  <span className="modal-input-suffix">units</span>
                </div>
              </div>

              <div className="modal-form-group">
                <label>Override Reason Category</label>
                <select
                  className="modal-select"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                >
                  <option value="Promotional Spike Override">Promotional Campaign Spike</option>
                  <option value="Seasonal Demand Surge">Seasonal Demand Surge</option>
                  <option value="Supply Chain Disruption">Supply Chain Disruption / Shortage</option>
                  <option value="Market Competitor Action">Market Competitor Action</option>
                  <option value="Unplanned Event">Unplanned Special Event</option>
                </select>
              </div>

              <div className="modal-form-group">
                <label>Detailed Business Justification (Mandatory)</label>
                <textarea
                  required
                  className="modal-textarea"
                  placeholder="Enter explicit reason for manual adjustment (recorded in audit logs)..."
                  value={overrideNotes}
                  onChange={(e) => setOverrideNotes(e.target.value)}
                ></textarea>
              </div>

              <div className="modal-info-banner">
                <div className="banner-dot"></div>
                <span>Override is recorded in system audit logs and can be reverted anytime.</span>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-btn-cancel"
                  onClick={() => setIsOverrideModalOpen(false)}
                  disabled={isSubmittingOverride}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modal-btn-apply"
                  disabled={isSubmittingOverride}
                >
                  {isSubmittingOverride ? 'Saving Override...' : 'Apply Override'}
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
