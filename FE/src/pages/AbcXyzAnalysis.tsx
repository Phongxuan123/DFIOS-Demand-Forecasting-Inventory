import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Settings, RefreshCw, Info, X, AlertCircle, Check, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { api } from '../services/api.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import './AbcXyzAnalysis.css';

export const AbcXyzAnalysis: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN';
  const canManage = isAdmin || user?.role?.toUpperCase() === 'WAREHOUSE MANAGER';

  const [matrixData, setMatrixData] = useState<any>(null);
  const [thresholds, setThresholds] = useState<any>({ a_cutoff: 80, b_cutoff: 95, cv_x: 0.5, cv_y: 1.0 });
  const [skuList, setSkuList] = useState<any[]>([]);
  const [totalSkus, setTotalSkus] = useState(0);

  // Pagination for SKU table
  const [skuPage, setSkuPage] = useState(1);
  const [skuPageSize, setSkuPageSize] = useState(15);

  // Filters
  const [selectedSegment, setSelectedSegment] = useState<string>('All');
  const [selectedAbc, setSelectedAbc] = useState<string>('All');
  const [selectedXyz, setSelectedXyz] = useState<string>('All');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [categories, setCategories] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('revenue');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const [selectedRecommendation, setSelectedRecommendation] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSkus, setIsLoadingSkus] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isSavingThresholds, setIsSavingThresholds] = useState(false);
  const [saveStage, setSaveStage] = useState(0);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [configMessage, setConfigMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  // Global Toast
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const notifTimerRef = useRef<any>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    setNotification({ message, type });
    notifTimerRef.current = setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  // Threshold form inputs
  const [formThresholds, setFormThresholds] = useState({
    a_cutoff: 80,
    b_cutoff: 95,
    cv_x: 0.5,
    cv_y: 1.0,
  });

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [matrixRes, threshRes, skusRes, catList] = await Promise.all([
        api.classification.getMatrix().catch(() => null),
        api.classification.getThresholds().catch(() => null),
        api.classification.getSkus({ skip: 0, limit: skuPageSize, sort_by: sortBy, order: sortOrder }).catch(() => ({ list: [], total: 0 })),
        api.products.getCategories().catch(() => ['FOODS', 'HOBBIES', 'HOUSEHOLD']),
      ]);

      if (matrixRes) {
        setMatrixData(matrixRes);
      }
      if (threshRes) {
        setThresholds(threshRes);
        setFormThresholds({
          a_cutoff: threshRes.a_cutoff ?? 80,
          b_cutoff: threshRes.b_cutoff ?? 95,
          cv_x: threshRes.cv_x ?? 0.5,
          cv_y: threshRes.cv_y ?? 1.0,
        });
      }
      setCategories(catList || []);
      setSkuList(skusRes.list || []);
      setTotalSkus(skusRes.total || (skusRes.list || []).length);
    } catch (error) {
      console.error('Failed to load classification data', error);
      showNotification('Không thể tải ma trận phân loại ABC/XYZ.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    return () => {
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    };
  }, []);

  // Reset page when filters change
  useEffect(() => {
    setSkuPage(1);
  }, [searchTerm, selectedSegment, selectedAbc, selectedXyz, selectedCategory, sortBy, sortOrder]);

  // Debounced search and filter effect
  useEffect(() => {
    if (isLoading) return;

    const timer = setTimeout(async () => {
      setIsLoadingSkus(true);
      try {
        const skusRes = await api.classification.getSkus({
          segment: selectedSegment !== 'All' ? selectedSegment : undefined,
          abc: selectedAbc !== 'All' ? selectedAbc : undefined,
          xyz: selectedXyz !== 'All' ? selectedXyz : undefined,
          category: selectedCategory !== 'All' ? selectedCategory : undefined,
          search: searchTerm.trim() || undefined,
          sort_by: sortBy,
          order: sortOrder,
          skip: (skuPage - 1) * skuPageSize,
          limit: skuPageSize,
        });
        const totalCount = skusRes.total || (skusRes.list || []).length;
        setSkuList(skusRes.list || []);
        setTotalSkus(totalCount);

        // Prefetch next page in background for instant zero-latency pagination
        if (skuPage * skuPageSize < totalCount) {
          api.classification.getSkus({
            segment: selectedSegment !== 'All' ? selectedSegment : undefined,
            abc: selectedAbc !== 'All' ? selectedAbc : undefined,
            xyz: selectedXyz !== 'All' ? selectedXyz : undefined,
            category: selectedCategory !== 'All' ? selectedCategory : undefined,
            search: searchTerm.trim() || undefined,
            sort_by: sortBy,
            order: sortOrder,
            skip: skuPage * skuPageSize,
            limit: skuPageSize,
          }).catch(() => {});
        }
      } catch (e) {
        console.error('Failed to filter SKUs', e);
      } finally {
        setIsLoadingSkus(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [searchTerm, selectedSegment, selectedAbc, selectedXyz, selectedCategory, sortBy, sortOrder, skuPage, skuPageSize]);

  // Click cell on matrix
  const handleSelectSegment = async (segment: string) => {
    const next = selectedSegment === segment ? 'All' : segment;
    setSelectedSegment(next);
    if (next !== 'All') {
      setSelectedAbc(next[0]);
      setSelectedXyz(next[1]);
      try {
        const rec = await api.classification.getRecommendation(next).catch(() => null);
        setSelectedRecommendation(rec);
      } catch {
        setSelectedRecommendation(null);
      }
    } else {
      setSelectedAbc('All');
      setSelectedXyz('All');
      setSelectedRecommendation(null);
    }
  };

  const handleResetFilters = () => {
    setSelectedSegment('All');
    setSelectedAbc('All');
    setSelectedXyz('All');
    setSelectedCategory('All');
    setSearchTerm('');
    setSortBy('revenue');
    setSortOrder('desc');
    setSelectedRecommendation(null);
  };

  const handleRecompute = async () => {
    setIsRecomputing(true);
    showNotification('Đang quét lịch sử bán hàng và tính toán phân loại toàn bộ danh mục SKU...', 'success');
    try {
      const res = await api.classification.recompute();
      await loadData();
      const count = res.total_skus_classified ?? res.total ?? '';
      showNotification(res.message || `Đã phân loại lại thành công cho ${count} SKU sản phẩm!`, 'success');
    } catch (err: any) {
      const errMsg = err.response?.data?.detail || 'Lỗi khi tính toán lại phân loại. Vui lòng kiểm tra lại.';
      showNotification(errMsg, 'error');
    } finally {
      setIsRecomputing(false);
    }
  };

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      setConfigMessage({ text: 'Chỉ tài khoản Admin mới có quyền cập nhật cấu hình ngưỡng.', isError: true });
      return;
    }
    setConfigMessage(null);
    setIsSavingThresholds(true);
    setSaveStage(1);
    try {
      setSaveStage(2);
      const res = await api.classification.updateThresholds({
        a_cutoff: Number(formThresholds.a_cutoff),
        b_cutoff: Number(formThresholds.b_cutoff),
        cv_x: Number(formThresholds.cv_x),
        cv_y: Number(formThresholds.cv_y),
      });
      setThresholds(res);

      setSaveStage(3);
      await loadData();

      setConfigMessage({ text: 'Cập nhật cấu hình ngưỡng và phân loại lại danh mục thành công!', isError: false });
      showNotification('Cấu hình ngưỡng ABC/XYZ đã được lưu và cập nhật!', 'success');
      setTimeout(() => {
        setIsConfigOpen(false);
        setConfigMessage(null);
        setSaveStage(0);
      }, 1200);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d.msg).join(', ')
          : 'Không thể cập nhật cấu hình ngưỡng.';
      setConfigMessage({ text: msg, isError: true });
      setSaveStage(0);
    } finally {
      setIsSavingThresholds(false);
    }
  };

  const getCellData = (code: string) => {
    if (matrixData?.matrix && matrixData.matrix[code]) {
      const seg = matrixData.matrix[code];
      return {
        count: seg.sku_count,
        pct: (seg.sku_percentage ?? 0).toFixed(1),
        revenue: seg.revenue,
      };
    }
    return { count: 0, pct: '0.0', revenue: 0 };
  };

  const ax = getCellData('AX');
  const ay = getCellData('AY');
  const az = getCellData('AZ');
  const bx = getCellData('BX');
  const by = getCellData('BY');
  const bz = getCellData('BZ');
  const cx = getCellData('CX');
  const cy = getCellData('CY');
  const cz = getCellData('CZ');

  const hasActiveFilter = selectedSegment !== 'All' || selectedAbc !== 'All' || selectedXyz !== 'All' || selectedCategory !== 'All' || searchTerm.trim().length > 0;

  return (
    <div className="animate-fade-in mb-6">
      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
          <RefreshCw size={20} className="animate-spin inline mr-2 text-teal-600" />
          Đang tải ma trận phân loại ABC/XYZ...
        </div>
      ) : (
        <>
          <div className="abc-top-split">
            {/* 3x3 Matrix Panel */}
            <div className="abc-matrix-panel">
              <div className="abc-matrix-header">
                <div>
                  <h2 className="panel-title">ABC/XYZ Classification Matrix</h2>
                  <p className="panel-subtitle">
                    Pareto revenue cutoffs: A (top {thresholds.a_cutoff}%), B ({thresholds.a_cutoff}-{thresholds.b_cutoff}%), C (remaining).
                    Demand variability: X (CV ≤ {thresholds.cv_x}), Y ({thresholds.cv_x} &lt; CV ≤ {thresholds.cv_y}), Z (CV &gt; {thresholds.cv_y}). Nhấp vào từng ô để lọc chi tiết.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {canManage && (
                    <button
                      className="configure-btn"
                      onClick={handleRecompute}
                      disabled={isRecomputing}
                      title="Chạy lại thuật toán phân loại ABC & XYZ cho toàn bộ SKU"
                      style={{ borderRadius: '4px' }}
                    >
                      <RefreshCw size={13} className={isRecomputing ? 'animate-spin' : ''} style={{ marginRight: '6px' }} />
                      {isRecomputing ? 'Đang tính toán...' : 'Recompute Matrix'}
                    </button>
                  )}
                  <button
                    className="configure-btn"
                    onClick={() => {
                      setConfigMessage(null);
                      setSaveStage(0);
                      setIsConfigOpen(true);
                    }}
                    style={{ borderRadius: '4px' }}
                    title={isAdmin ? 'Cấu hình tham số ngưỡng phân loại' : 'Xem cấu hình ngưỡng phân loại'}
                  >
                    <Settings size={13} style={{ marginRight: '6px' }} /> Configure Thresholds
                  </button>
                </div>
              </div>

              <div className="matrix-grid-container">
                <div></div>
                <div className="matrix-col-header">X (STABLE, CV ≤ {thresholds.cv_x})</div>
                <div className="matrix-col-header">Y (VARIABLE, CV ≤ {thresholds.cv_y})</div>
                <div className="matrix-col-header">Z (ERRATIC, CV &gt; {thresholds.cv_y})</div>

                {/* Row A */}
                <div className="matrix-row-header">A (TOP {thresholds.a_cutoff}% REV)</div>
                <div
                  className={`matrix-cell cell-ax cursor-pointer ${selectedSegment === 'AX' ? 'active-cell' : ''}`}
                  onClick={() => handleSelectSegment('AX')}
                  title="Click to filter by AX"
                >
                  <span className="matrix-cell-count">{ax.count} SKUs</span>
                  <span className="matrix-cell-pct">{ax.pct}%</span>
                  <span className="matrix-cell-label">AX - Strategic</span>
                </div>
                <div
                  className={`matrix-cell cell-ay cursor-pointer ${selectedSegment === 'AY' ? 'active-cell' : ''}`}
                  onClick={() => handleSelectSegment('AY')}
                  title="Click to filter by AY"
                >
                  <span className="matrix-cell-count">{ay.count} SKUs</span>
                  <span className="matrix-cell-pct">{ay.pct}%</span>
                  <span className="matrix-cell-label">AY - Dynamic</span>
                </div>
                <div
                  className={`matrix-cell cell-az cursor-pointer ${selectedSegment === 'AZ' ? 'active-cell' : ''}`}
                  onClick={() => handleSelectSegment('AZ')}
                  title="Click to filter by AZ"
                >
                  <span className="matrix-cell-count">{az.count} SKUs</span>
                  <span className="matrix-cell-pct">{az.pct}%</span>
                  <span className="matrix-cell-label">AZ - Volatile</span>
                </div>

                {/* Row B */}
                <div className="matrix-row-header">B (NEXT {((thresholds.b_cutoff ?? 95) - (thresholds.a_cutoff ?? 80))}% REV)</div>
                <div
                  className={`matrix-cell cell-bx cursor-pointer ${selectedSegment === 'BX' ? 'active-cell' : ''}`}
                  onClick={() => handleSelectSegment('BX')}
                  title="Click to filter by BX"
                >
                  <span className="matrix-cell-count">{bx.count} SKUs</span>
                  <span className="matrix-cell-pct">{bx.pct}%</span>
                  <span className="matrix-cell-label">BX - Mid Stable</span>
                </div>
                <div
                  className={`matrix-cell cell-by cursor-pointer ${selectedSegment === 'BY' ? 'active-cell' : ''}`}
                  onClick={() => handleSelectSegment('BY')}
                  title="Click to filter by BY"
                >
                  <span className="matrix-cell-count">{by.count} SKUs</span>
                  <span className="matrix-cell-pct">{by.pct}%</span>
                  <span className="matrix-cell-label">BY - Mid Dynamic</span>
                </div>
                <div
                  className={`matrix-cell cell-bz cursor-pointer ${selectedSegment === 'BZ' ? 'active-cell' : ''}`}
                  onClick={() => handleSelectSegment('BZ')}
                  title="Click to filter by BZ"
                >
                  <span className="matrix-cell-count">{bz.count} SKUs</span>
                  <span className="matrix-cell-pct">{bz.pct}%</span>
                  <span className="matrix-cell-label">BZ - Seasonal</span>
                </div>

                {/* Row C */}
                <div className="matrix-row-header">C (REMAINING REV)</div>
                <div
                  className={`matrix-cell cell-cx cursor-pointer ${selectedSegment === 'CX' ? 'active-cell' : ''}`}
                  onClick={() => handleSelectSegment('CX')}
                  title="Click to filter by CX"
                >
                  <span className="matrix-cell-count">{cx.count} SKUs</span>
                  <span className="matrix-cell-pct">{cx.pct}%</span>
                  <span className="matrix-cell-label">CX - Low Value</span>
                </div>
                <div
                  className={`matrix-cell cell-cy cursor-pointer ${selectedSegment === 'CY' ? 'active-cell' : ''}`}
                  onClick={() => handleSelectSegment('CY')}
                  title="Click to filter by CY"
                >
                  <span className="matrix-cell-count">{cy.count} SKUs</span>
                  <span className="matrix-cell-pct">{cy.pct}%</span>
                  <span className="matrix-cell-label">CY - Variable</span>
                </div>
                <div
                  className={`matrix-cell cell-cz cursor-pointer ${selectedSegment === 'CZ' ? 'active-cell' : ''}`}
                  onClick={() => handleSelectSegment('CZ')}
                  title="Click to filter by CZ"
                >
                  <span className="matrix-cell-count">{cz.count} SKUs</span>
                  <span className="matrix-cell-pct">{cz.pct}%</span>
                  <span className="matrix-cell-label">CZ - Long Tail</span>
                </div>
              </div>
            </div>

            {/* Segment Policy Recommendation Panel */}
            <div className="abc-policy-panel">
              <h2 className="panel-title" style={{ fontSize: '1rem' }}>
                Segment Policy & Strategy
              </h2>
              {selectedRecommendation ? (
                <div style={{ marginTop: '0.75rem', fontSize: '12px', lineHeight: '1.6' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span className="font-bold text-base text-teal-700">Phân khúc {selectedRecommendation.segment}</span>
                    <span className="px-2 py-0.5 bg-teal-100 text-teal-800 text-xs font-semibold" style={{ borderRadius: '4px' }}>
                      Ưu tiên: {selectedRecommendation.priority}
                    </span>
                  </div>
                  <p className="text-secondary mb-3">{selectedRecommendation.description}</p>
                  <div className="policy-spec-box">
                    <div>
                      <span className="font-semibold text-slate-700 block">Chiến lược tồn kho:</span>
                      <span className="text-slate-600">{selectedRecommendation.strategy}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-700 block">Tần suất rà soát:</span>
                      <span className="text-slate-600">{selectedRecommendation.review_frequency}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-700 block">Chính sách đặt hàng:</span>
                      <span className="text-slate-600">{selectedRecommendation.replenishment_policy}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-700 block">Mức đệm an toàn:</span>
                      <span className="text-slate-600">{selectedRecommendation.safety_stock_level}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#94a3b8', padding: '1rem' }}>
                  <Info size={28} style={{ marginBottom: '0.5rem', opacity: 0.6 }} />
                  <p style={{ fontSize: '12px', margin: 0 }}>
                    Nhấp vào bất kỳ ô nào trong ma trận 3x3 để xem chiến lược tồn kho, chu kỳ kiểm kê và chính sách bổ hàng tương ứng.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom SKU Table with Interactive Filter Bar */}
          <div className="log-panel">
            <div className="log-header-bar">
              <div>
                <h2 className="log-title" style={{ marginBottom: '2px' }}>
                  SKU Classification Registry
                </h2>
                <span className="text-xs text-[var(--text-secondary)]">
                  Hiển thị {skuList.length} trên tổng số {totalSkus} SKUs
                  {selectedSegment !== 'All' && <span> • Phân khúc: <strong>{selectedSegment}</strong></span>}
                  {selectedCategory !== 'All' && <span> • Ngành hàng: <strong>{selectedCategory}</strong></span>}
                  {selectedAbc !== 'All' && <span> • ABC: <strong>Nhóm {selectedAbc}</strong></span>}
                  {selectedXyz !== 'All' && <span> • XYZ: <strong>Nhóm {selectedXyz}</strong></span>}
                </span>
              </div>

              {hasActiveFilter && (
                <button
                  className="configure-btn text-xs"
                  onClick={handleResetFilters}
                  style={{ borderRadius: '4px', padding: '0.35rem 0.75rem', color: '#0d9488' }}
                >
                  Xóa tất cả bộ lọc <X size={12} className="inline ml-1" />
                </button>
              )}
            </div>

            {/* Filter Dropdowns and Search Bar */}
            <div className="abc-filter-row" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
              <div className="abc-filter-item">
                <span className="abc-filter-label">PHÂN KHÚC</span>
                <select
                  className="abc-filter-select"
                  value={selectedSegment}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedSegment(val);
                    if (val !== 'All') {
                      setSelectedAbc(val[0]);
                      setSelectedXyz(val[1]);
                      api.classification.getRecommendation(val).then(setSelectedRecommendation).catch(() => null);
                    } else {
                      setSelectedRecommendation(null);
                    }
                  }}
                >
                  <option value="All">All Segments (9 ô)</option>
                  {['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ'].map((seg) => (
                    <option key={seg} value={seg}>{seg}</option>
                  ))}
                </select>
              </div>

              <div className="abc-filter-item">
                <span className="abc-filter-label">NGÀNH HÀNG (CATEGORY)</span>
                <select
                  className="abc-filter-select"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <option value="All">Tất cả ngành hàng</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="abc-filter-item">
                <span className="abc-filter-label">NHÓM ABC</span>
                <select
                  className="abc-filter-select"
                  value={selectedAbc}
                  onChange={(e) => {
                    setSelectedAbc(e.target.value);
                    if (e.target.value !== 'All' && selectedXyz !== 'All') {
                      setSelectedSegment(`${e.target.value}${selectedXyz}`);
                    } else {
                      setSelectedSegment('All');
                    }
                  }}
                >
                  <option value="All">Tất cả (A, B, C)</option>
                  <option value="A">Nhóm A (Top Doanh thu)</option>
                  <option value="B">Nhóm B (Doanh thu Trung bình)</option>
                  <option value="C">Nhóm C (Doanh thu Thấp)</option>
                </select>
              </div>

              <div className="abc-filter-item">
                <span className="abc-filter-label">NHÓM XYZ</span>
                <select
                  className="abc-filter-select"
                  value={selectedXyz}
                  onChange={(e) => {
                    setSelectedXyz(e.target.value);
                    if (selectedAbc !== 'All' && e.target.value !== 'All') {
                      setSelectedSegment(`${selectedAbc}${e.target.value}`);
                    } else {
                      setSelectedSegment('All');
                    }
                  }}
                >
                  <option value="All">Tất cả (X, Y, Z)</option>
                  <option value="X">Nhóm X (Nhu cầu ổn định)</option>
                  <option value="Y">Nhóm Y (Nhu cầu biến động vừa)</option>
                  <option value="Z">Nhóm Z (Nhu cầu thất thường)</option>
                </select>
              </div>

              <div className="abc-filter-item">
                <span className="abc-filter-label">SẮP XẾP THEO</span>
                <select
                  className="abc-filter-select"
                  value={`${sortBy}_${sortOrder}`}
                  onChange={(e) => {
                    const [col, ord] = e.target.value.split('_');
                    setSortBy(col);
                    setSortOrder(ord as any);
                  }}
                >
                  <option value="revenue_desc">Doanh thu cao nhất</option>
                  <option value="revenue_asc">Doanh thu thấp nhất</option>
                  <option value="revenue_share_desc">Tỷ trọng doanh thu (%)</option>
                  <option value="cv_asc">Độ ổn định cao (CV thấp)</option>
                  <option value="cv_desc">Độ biến động cao (CV cao)</option>
                  <option value="mean_demand_desc">Nhu cầu bình quân cao</option>
                  <option value="item_id_asc">Mã SKU (A-Z)</option>
                </select>
              </div>

              <div className="abc-filter-item" style={{ flex: 1, minWidth: '220px' }}>
                <span className="abc-filter-label">TÌM KIẾM SKU / SẢN PHẨM (TỨC THÌ)</span>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="text"
                    placeholder="Tìm theo mã SKU hoặc tên sản phẩm..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="abc-filter-input"
                    style={{ paddingLeft: '32px', width: '100%', height: '36px' }}
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* SKU Table */}
            <div className="log-table">
              <div className="log-header-row">
                <div className="log-col-header" style={{ width: '16%' }}>SKU ID</div>
                <div className="log-col-header" style={{ width: '28%' }}>TÊN SẢN PHẨM</div>
                <div className="log-col-header" style={{ width: '10%' }}>NHÓM ABC</div>
                <div className="log-col-header" style={{ width: '10%' }}>NHÓM XYZ</div>
                <div className="log-col-header" style={{ width: '12%' }}>PHÂN KHÚC</div>
                <div className="log-col-header" style={{ width: '12%' }}>DOANH THU</div>
                <div className="log-col-header" style={{ width: '12%' }}>HỆ SỐ CV</div>
              </div>

              <div>
                {isLoadingSkus ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                    <RefreshCw size={16} className="animate-spin inline mr-2 text-teal-600" />
                    Đang lọc danh sách SKU...
                  </div>
                ) : skuList.length === 0 ? (
                  <div style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8' }}>
                    {hasActiveFilter ? 'Không có SKU nào khớp với bộ lọc đã chọn.' : 'Chưa có bản ghi phân loại SKU. Nhấp "Recompute" ở trên để khởi chạy.'}
                  </div>
                ) : (
                  skuList.map((row: any, idx: number) => (
                    <div className="log-row" key={row.id || row.item_id || idx}>
                      <div className="fw-700" style={{ width: '16%', fontFamily: 'monospace', color: '#0f172a' }}>
                        {row.item_id}
                      </div>
                      <div className="text-secondary" style={{ width: '28%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.product_name || row.item_id}
                      </div>
                      <div style={{ width: '10%' }}>
                        <span className={row.abc === 'A' ? 'text-class-a font-bold' : row.abc === 'B' ? 'text-class-b font-bold' : 'text-class-c'}>
                          Class {row.abc}
                        </span>
                      </div>
                      <div style={{ width: '10%' }}>
                        <span className={row.xyz === 'X' ? 'text-class-a font-bold' : row.xyz === 'Y' ? 'text-class-b font-bold' : 'text-class-c'}>
                          Class {row.xyz}
                        </span>
                      </div>
                      <div style={{ width: '12%' }}>
                        <span
                          className={`segment-tag ${
                            row.segment?.startsWith('A') ? 'tag-a' :
                            row.segment?.startsWith('B') ? 'tag-b' :
                            'tag-c'
                          }`}
                        >
                          {row.segment}
                        </span>
                      </div>
                      <div style={{ width: '12%', fontWeight: 600, color: '#0f172a' }}>
                        ${typeof row.revenue === 'number' ? row.revenue.toLocaleString() : row.revenue}
                      </div>
                      <div style={{ width: '12%', color: '#64748b', fontFamily: 'monospace' }}>
                        {typeof row.cv === 'number' ? row.cv.toFixed(2) : row.cv}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {totalSkus > 0 && (
              <Pagination
                currentPage={skuPage}
                totalItems={totalSkus}
                pageSize={skuPageSize}
                onPageChange={setSkuPage}
                onPageSizeChange={(newSize) => {
                  setSkuPageSize(newSize);
                  setSkuPage(1);
                }}
                pageSizeOptions={[10, 15, 25, 50]}
              />
            )}
          </div>

          {/* Threshold Configuration Modal */}
          {isConfigOpen && createPortal(
            <div className="modal-overlay" onClick={() => !isSavingThresholds && setIsConfigOpen(false)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px', borderRadius: '6px' }}>
                <div className="modal-header">
                  <h3 className="modal-title" style={{ fontSize: '1.125rem', margin: 0 }}>Configure ABC/XYZ Thresholds</h3>
                  <button
                    className="modal-close"
                    onClick={() => !isSavingThresholds && setIsConfigOpen(false)}
                    disabled={isSavingThresholds}
                    style={{ borderRadius: '4px' }}
                  >
                    <X size={16} />
                  </button>
                </div>

                {!isAdmin && (
                  <div className="p-3 my-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded" style={{ borderRadius: '4px' }}>
                    Chế độ chỉ xem: Chỉ tài khoản Admin mới có quyền cập nhật ngưỡng phân loại hệ thống.
                  </div>
                )}

                {configMessage && (
                  <div
                    style={{
                      marginBottom: '1rem',
                      padding: '0.625rem 0.75rem',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '12px',
                      backgroundColor: configMessage.isError ? '#fef2f2' : '#ecfdf5',
                      color: configMessage.isError ? '#b91c1c' : '#047857',
                      border: `1px solid ${configMessage.isError ? '#fecaca' : '#a7f3d0'}`,
                    }}
                  >
                    {configMessage.isError ? <AlertCircle size={15} style={{ flexShrink: 0 }} /> : <Check size={15} style={{ flexShrink: 0 }} />}
                    <span>{configMessage.text}</span>
                  </div>
                )}

                {/* Multi-stage Progress Feedback */}
                {isSavingThresholds && (
                  <div style={{ marginBottom: '1.25rem', padding: '0.75rem', borderRadius: '4px', backgroundColor: '#f0fdfa', border: '1px solid #99f6e4', fontSize: '12px', color: '#0f766e' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, marginBottom: '6px' }}>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Tiến trình cập nhật ngưỡng & phân loại lại:</span>
                    </div>
                    <div style={{ paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <span style={{ color: saveStage >= 1 ? '#047857' : '#94a3b8', fontWeight: saveStage === 1 ? 600 : 400 }}>
                        {saveStage > 1 ? '✓' : '●'} Giai đoạn 1: Xác thực tham số Cutoff A/B và CV X/Y
                      </span>
                      <span style={{ color: saveStage >= 2 ? '#047857' : '#94a3b8', fontWeight: saveStage === 2 ? 600 : 400 }}>
                        {saveStage > 2 ? '✓' : '●'} Giai đoạn 2: BE đang phân loại Pareto doanh thu & CV toàn bộ SKU
                      </span>
                      <span style={{ color: saveStage >= 3 ? '#047857' : '#94a3b8', fontWeight: saveStage === 3 ? 600 : 400 }}>
                        {saveStage === 3 ? '●' : '○'} Giai đoạn 3: Đồng bộ ma trận 3x3 và danh mục SKU
                      </span>
                    </div>
                  </div>
                )}

                <form onSubmit={handleSaveThresholds}>
                  <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                    <h4 className="threshold-section-title" style={{ marginTop: 0 }}>Ngưỡng Pareto Doanh Thu (ABC Cutoffs)</h4>
                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Ngưỡng tích lũy nhóm A (Class A Cutoff %):
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        max="99"
                        required
                        disabled={!isAdmin || isSavingThresholds}
                        className="settings-input w-full"
                        style={{ borderRadius: '4px' }}
                        value={formThresholds.a_cutoff}
                        onChange={(e) => setFormThresholds({ ...formThresholds, a_cutoff: parseFloat(e.target.value) || 0 })}
                      />
                      <span className="text-[11px] text-slate-500 mt-1 block">
                        Chiếm tỷ trọng doanh thu cao nhất (Mặc định: 80%)
                      </span>
                    </div>

                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Ngưỡng tích lũy nhóm B (Class B Cutoff %):
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        max="99.9"
                        required
                        disabled={!isAdmin || isSavingThresholds}
                        className="settings-input w-full"
                        style={{ borderRadius: '4px' }}
                        value={formThresholds.b_cutoff}
                        onChange={(e) => setFormThresholds({ ...formThresholds, b_cutoff: parseFloat(e.target.value) || 0 })}
                      />
                      <span className="text-[11px] text-slate-500 mt-1 block">
                        Tầng doanh thu tiếp theo (Mặc định: 95%). Phần còn lại đến 100% là nhóm C.
                      </span>
                    </div>

                    <h4 className="threshold-section-title mt-6">Ngưỡng Biến Động Nhu Cầu (XYZ CV Cutoffs)</h4>
                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Ngưỡng hệ số biến động nhóm X (Max CV):
                      </label>
                      <input
                        type="number"
                        step="0.05"
                        min="0.01"
                        max="5"
                        required
                        disabled={!isAdmin || isSavingThresholds}
                        className="settings-input w-full"
                        style={{ borderRadius: '4px' }}
                        value={formThresholds.cv_x}
                        onChange={(e) => setFormThresholds({ ...formThresholds, cv_x: parseFloat(e.target.value) || 0 })}
                      />
                      <span className="text-[11px] text-slate-500 mt-1 block">
                        Nhu cầu ổn định, dễ dự báo: CV ≤ ngưỡng này (Mặc định: 0.5)
                      </span>
                    </div>

                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Ngưỡng hệ số biến động nhóm Y (Max CV):
                      </label>
                      <input
                        type="number"
                        step="0.05"
                        min="0.01"
                        max="10"
                        required
                        disabled={!isAdmin || isSavingThresholds}
                        className="settings-input w-full"
                        style={{ borderRadius: '4px' }}
                        value={formThresholds.cv_y}
                        onChange={(e) => setFormThresholds({ ...formThresholds, cv_y: parseFloat(e.target.value) || 0 })}
                      />
                      <span className="text-[11px] text-slate-500 mt-1 block">
                        Nhu cầu biến động vừa: cv_x &lt; CV ≤ cv_y (Mặc định: 1.0). Lớn hơn là nhóm Z.
                      </span>
                    </div>
                  </div>

                  <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                    <button
                      type="button"
                      className="reset-btn"
                      onClick={() => setIsConfigOpen(false)}
                      disabled={isSavingThresholds}
                      style={{ borderRadius: '4px', padding: '0.5rem 1rem' }}
                    >
                      Đóng
                    </button>
                    {isAdmin && (
                      <button
                        type="submit"
                        disabled={isSavingThresholds}
                        className="apply-btn"
                        style={{ borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px', padding: '0.5rem 1.25rem' }}
                      >
                        {isSavingThresholds && <RefreshCw size={13} className="animate-spin inline" />}
                        <span>{isSavingThresholds ? 'Đang lưu & tính toán...' : 'Lưu & Phân loại lại'}</span>
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </div>,
            document.body
          )}

          {/* Floating Toast Notification */}
          {notification && (
            <div
              style={{
                position: 'fixed',
                bottom: '24px',
                right: '24px',
                zIndex: 9999,
                backgroundColor: notification.type === 'error' ? '#ef4444' : '#0d9488',
                color: '#ffffff',
                padding: '12px 20px',
                borderRadius: '6px',
                boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '13px',
                fontWeight: 500,
                animation: 'fadeIn 0.2s ease-out',
              }}
            >
              {notification.type === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}
              <span>{notification.message}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};
