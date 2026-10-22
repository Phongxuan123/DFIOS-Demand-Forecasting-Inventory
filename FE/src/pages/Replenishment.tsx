import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  Store as StoreIcon
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { api } from '../services/api.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import './Replenishment.css';

// Helper formatters
const formatQty = (val: number | string | null | undefined): string => {
  if (val == null || isNaN(Number(val))) return '0';
  return Math.round(Number(val)).toLocaleString('vi-VN');
};

const formatDecimal = (val: number | string | null | undefined, digits: number = 1): string => {
  if (val == null || isNaN(Number(val))) return '0';
  return Number(val).toLocaleString('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
};

const PRIORITY_LABELS: Record<string, string> = {
  CRITICAL: 'Khẩn cấp',
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
};

export const Replenishment: React.FC = () => {
  const { user } = useAuth();
  const canEdit = user?.role?.toUpperCase() !== 'VIEWER';

  // Store selector
  const [selectedStore, setSelectedStore] = useState<string>('CA_1');

  // Main Tabs: Recommendations | Inventory Stock | Decision History
  const [viewTab, setViewTab] = useState<'RECOMMENDATIONS' | 'INVENTORY' | 'HISTORY'>('RECOMMENDATIONS');

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
  const [invPage, setInvPage] = useState(1);
  const [invPageSize, setInvPageSize] = useState(10);

  // History State
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('ALL');

  // UI state
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modals (Adjust, Reject, Cancel)
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [targetRec, setTargetRec] = useState<any>(null);
  const [adjustQtyInput, setAdjustQtyInput] = useState<number>(0);
  const [actionReasonInput, setActionReasonInput] = useState<string>('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Action status
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 4000);
  };

  // 1. Load Recommendations
  const loadRecommendations = async (store: string = selectedStore) => {
    try {
      const res = await api.replenishment.listRecommendations({
        store_id: store,
        status: recStatusFilter !== 'ALL' ? recStatusFilter : undefined,
        priority: recPriorityFilter !== 'ALL' ? recPriorityFilter : undefined,
        search: recSearch.trim() || undefined,
        skip: (recPage - 1) * recPageSize,
        limit: recPageSize,
        auto_generate: false,
      });
      setRecommendations(res.items || []);
      setRecTotal(res.total || 0);
      setPendingCount(res.pending_count || 0);
      setApprovedCount(res.approved_count || 0);
      if (res.items && res.items.length > 0 && !selectedItem) {
        setSelectedItem(res.items[0]);
      }
    } catch (err) {
      console.error("Failed to load replenishment recommendations", err);
    }
  };

  // 2. Load Inventory stock levels
  const loadInventory = async (store: string = selectedStore) => {
    try {
      const [invRes, paramsRes] = await Promise.all([
        api.inventory.getInventory({ limit: 100, store_id: store }).catch(() => ({ list: [], total: 0 })),
        api.optimization.getParameters({ limit: 100, store_id: store }).catch(() => ({ items: [], total: 0 })),
      ]);
      const paramMap = new Map();
      (paramsRes.items || []).forEach((p: any) => {
        paramMap.set(p.item_id, p);
      });
      const mapped = (invRes.list || []).map((item: any) => {
        const opt = paramMap.get(item.item_id) || {};
        return {
          ...item,
          safety_stock: opt.safety_stock != null ? Math.round(opt.safety_stock) : (item.safety_stock != null ? Math.round(item.safety_stock) : null),
          reorder_point: opt.reorder_point != null ? Math.round(opt.reorder_point) : (item.reorder_point != null ? Math.round(item.reorder_point) : null),
          eoq: opt.eoq != null ? Math.round(opt.eoq) : (item.eoq != null ? Math.round(item.eoq) : null),
        };
      });
      setInventory(mapped);
    } catch (err) {
      console.error("Failed to load inventory levels", err);
    }
  };

  // 3. Load Decision History
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
      console.error("Failed to load replenishment history", err);
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

  useEffect(() => {
    loadAll(selectedStore);
  }, [selectedStore]);

  useEffect(() => {
    if (viewTab === 'RECOMMENDATIONS') {
      loadRecommendations(selectedStore);
    } else if (viewTab === 'HISTORY') {
      loadHistory(selectedStore);
    } else {
      loadInventory(selectedStore);
    }
  }, [viewTab, recPage, recPageSize, recStatusFilter, recPriorityFilter, historyPage, historyPageSize, historyStatusFilter]);

  // Actions
  const handleAutoGenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await api.replenishment.generateRecommendations(selectedStore);
      showToast(res.message || `Đã quét và tạo danh sách đề xuất thành công.`);
      await loadRecommendations(selectedStore);
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Không thể tạo đề xuất tự động', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      await api.replenishment.downloadCsv(selectedStore, recStatusFilter !== 'ALL' ? recStatusFilter : undefined);
      showToast('Xuất tệp CSV đề xuất thành công.');
    } catch (err) {
      showToast('Lỗi khi xuất tệp CSV', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleApprove = async (rec: any) => {
    try {
      await api.replenishment.approve(rec.id);
      showToast(`Đã phê duyệt đơn đặt hàng cho ${rec.item_id}! Tồn kho vận chuyển đã cập nhật.`);
      await loadRecommendations(selectedStore);
      if (selectedItem?.id === rec.id) {
        setSelectedItem({ ...selectedItem, status: 'APPROVED' });
      }
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Phê duyệt thất bại', 'error');
    }
  };

  const handleOpenAdjust = (rec: any) => {
    setTargetRec(rec);
    setAdjustQtyInput(Math.round(rec.final_qty ?? rec.recommended_qty));
    setActionReasonInput(rec.reason || 'Điều chỉnh theo hạn mức vận chuyển và sức chứa kho');
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
      showToast(`Đã điều chỉnh số lượng đặt hàng cho ${targetRec.item_id}.`);
      setShowAdjustModal(false);
      await loadRecommendations(selectedStore);
      if (selectedItem?.id === targetRec.id) {
        setSelectedItem({ ...selectedItem, final_qty: Number(adjustQtyInput), reason: actionReasonInput.trim() });
      }
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Không thể điều chỉnh số lượng', 'error');
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
      await api.replenishment.reject(targetRec.id, { reason: actionReasonInput.trim() || 'Từ chối bởi Quản lý kho' });
      showToast(`Đã từ chối đề xuất đặt hàng cho ${targetRec.item_id}.`);
      setShowRejectModal(false);
      await loadRecommendations(selectedStore);
      if (selectedItem?.id === targetRec.id) {
        setSelectedItem({ ...selectedItem, status: 'REJECTED' });
      }
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Không thể từ chối đề xuất', 'error');
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
      await api.replenishment.cancel(targetRec.id, { reason: actionReasonInput.trim() || 'Hủy đơn theo yêu cầu nhà cung cấp / điều phối' });
      showToast(`Đã hủy đơn hàng cho ${targetRec.item_id} và hoàn lại tồn kho chờ về.`);
      setShowCancelModal(false);
      await loadRecommendations(selectedStore);
      if (selectedItem?.id === targetRec.id) {
        setSelectedItem({ ...selectedItem, status: 'CANCELLED' });
      }
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Không thể hủy đơn hàng', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleRecompute = async () => {
    setIsRecomputing(true);
    try {
      const res = await api.optimization.recompute({ store_id: selectedStore });
      showToast(res.message || 'Đã tính toán lại thông số tồn kho tối ưu thành công!');
      await loadAll(selectedStore);
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Không thể tính toán lại thông số', 'error');
    } finally {
      setIsRecomputing(false);
    }
  };

  return (
    <div className="rep-container">
      {/* Toast Notification */}
      {toastMsg && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          backgroundColor: toastMsg.type === 'error' ? '#ef4444' : '#0f172a',
          color: '#ffffff',
          padding: '0.75rem 1.25rem',
          borderRadius: '8px',
          boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '0.85rem',
          fontWeight: 600,
        }}>
          {toastMsg.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Header with Title & Action Controls */}
      <div className="rep-header-section">
        <div className="rep-header-left">
          <h1 className="rep-page-title">Replenishment & Order Management</h1>
          <p className="rep-page-desc">
            Quản lý đề xuất bổ sung hàng hóa, phê duyệt đơn đặt hàng tự động và kiểm soát tồn kho tối ưu
          </p>
        </div>

        <div className="rep-header-right">
          {/* Store Selector */}
          <div className="rep-store-select-group">
            <StoreIcon size={14} className="text-slate-400" />
            <span className="rep-store-label">ĐIỂM BÁN:</span>
            <select
              className="rep-store-select"
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
            >
              <option value="CA_1">CA_1 (California 1)</option>
              <option value="CA_2">CA_2 (California 2)</option>
              <option value="TX_1">TX_1 (Texas 1)</option>
              <option value="WI_1">WI_1 (Wisconsin 1)</option>
            </select>
          </div>

          {canEdit && (
            <>
              <button
                className="rep-btn rep-btn-primary"
                onClick={handleAutoGenerate}
                disabled={isGenerating}
                title="Quét mức tồn kho thực tế so với ROP để tạo các đề xuất tái bổ sung"
              >
                <RefreshCw size={13} className={isGenerating ? 'animate-spin' : ''} />
                <span>{isGenerating ? 'Đang tạo...' : 'Tạo đề xuất mới'}</span>
              </button>

              <button
                className="rep-btn rep-btn-outline"
                onClick={handleRecompute}
                disabled={isRecomputing}
                title="Tính toán lại Safety Stock, Reorder Point và EOQ qua động cơ tối ưu"
              >
                <Calculator size={13} className={isRecomputing ? 'animate-spin' : ''} />
                <span>{isRecomputing ? 'Đang tính...' : 'Tính lại ROP / SS'}</span>
              </button>

              <button
                className="rep-btn rep-btn-outline"
                onClick={handleExportCsv}
                disabled={isExporting}
                title="Xuất bảng dữ liệu đề xuất đặt hàng ra tệp CSV"
              >
                <Download size={13} />
                <span>{isExporting ? 'Đang xuất...' : 'Xuất CSV'}</span>
              </button>
            </>
          )}

          <button
            className="rep-btn rep-btn-outline"
            onClick={() => loadAll(selectedStore)}
            title="Tải lại toàn bộ dữ liệu"
          >
            <RefreshCw size={13} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="rep-kpi-row">
        <div className="rep-kpi-card">
          <div className="rep-kpi-header">
            <span className="rep-kpi-title">CHỜ PHÊ DUYỆT</span>
            <span className="rep-kpi-badge badge-warning">Cần xử lý</span>
          </div>
          <div className="rep-kpi-content">
            <span className="rep-kpi-num">{pendingCount}</span>
            <span className="rep-kpi-sub">Đề xuất bổ sung tồn kho</span>
          </div>
        </div>

        <div className="rep-kpi-card">
          <div className="rep-kpi-header">
            <span className="rep-kpi-title">ĐƠN ĐÃ DUYỆT</span>
            <span className="rep-kpi-badge badge-success">Đang vận chuyển</span>
          </div>
          <div className="rep-kpi-content">
            <span className="rep-kpi-num">{approvedCount}</span>
            <span className="rep-kpi-sub">Đã chuyển sang On-Order</span>
          </div>
        </div>

        <div className="rep-kpi-card">
          <div className="rep-kpi-header">
            <span className="rep-kpi-title">TỔNG ĐỀ XUẤT</span>
            <span className="rep-kpi-badge badge-neutral">Kho: {selectedStore}</span>
          </div>
          <div className="rep-kpi-content">
            <span className="rep-kpi-num">{recTotal}</span>
            <span className="rep-kpi-sub">Được hệ thống tính toán</span>
          </div>
        </div>

        <div className="rep-kpi-card">
          <div className="rep-kpi-header">
            <span className="rep-kpi-title">MẶT HÀNG THEO DÕI</span>
            <span className="rep-kpi-badge badge-teal">Đã chuẩn hóa</span>
          </div>
          <div className="rep-kpi-content">
            <span className="rep-kpi-num">{inventory.length.toLocaleString('vi-VN')}</span>
            <span className="rep-kpi-sub">SKU tại điểm bán {selectedStore}</span>
          </div>
        </div>
      </div>

      {/* View Tabs */}
      <div className="rep-tabs-bar">
        <button
          className={`rep-tab-btn ${viewTab === 'RECOMMENDATIONS' ? 'active' : ''}`}
          onClick={() => setViewTab('RECOMMENDATIONS')}
        >
          <PackageCheck size={16} />
          <span>Đề xuất đặt hàng</span>
        </button>

        <button
          className={`rep-tab-btn ${viewTab === 'INVENTORY' ? 'active' : ''}`}
          onClick={() => setViewTab('INVENTORY')}
        >
          <Layers size={16} />
          <span>Mức tồn kho kho bãi</span>
        </button>

        <button
          className={`rep-tab-btn ${viewTab === 'HISTORY' ? 'active' : ''}`}
          onClick={() => setViewTab('HISTORY')}
        >
          <HistoryIcon size={16} />
          <span>Lịch sử duyệt & Kiểm toán</span>
        </button>
      </div>

      {/* TAB 1: RECOMMENDATIONS */}
      {viewTab === 'RECOMMENDATIONS' && (
        <>
          {/* Filter Toolbar */}
          <div className="rep-filter-toolbar">
            <div className="rep-filter-left">
              <span className="rep-filter-lbl">TRẠNG THÁI:</span>
              <div className="rep-filter-pills">
                {[
                  { val: 'ALL', label: 'Tất cả' },
                  { val: 'PENDING', label: 'Chờ duyệt' },
                  { val: 'APPROVED', label: 'Đã duyệt' },
                  { val: 'REJECTED', label: 'Từ chối' },
                  { val: 'CANCELLED', label: 'Đã hủy' }
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

              <span className="rep-filter-lbl">MỨC ƯU TIÊN:</span>
              <div className="rep-filter-pills">
                {[
                  { val: 'ALL', label: 'Tất cả' },
                  { val: 'CRITICAL', label: 'Khẩn cấp' },
                  { val: 'HIGH', label: 'Cao' },
                  { val: 'MEDIUM', label: 'Trung bình' },
                  { val: 'LOW', label: 'Thấp' }
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

            <div className="rep-search-group">
              <Search size={14} className="rep-search-icon" />
              <input
                type="text"
                className="rep-search-input"
                placeholder="Tìm mã SKU, tên SP..."
                value={recSearch}
                onChange={(e) => {
                  setRecSearch(e.target.value);
                  setRecPage(1);
                }}
              />
              {recSearch && (
                <button
                  onClick={() => { setRecSearch(''); setRecPage(1); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}
                  title="Xóa tìm kiếm"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="rep-table-panel">
            <div className="rep-table-container">
              <table className="rep-table">
                <thead>
                  <tr>
                    <th style={{ width: '90px' }}>Ưu tiên</th>
                    <th>Mã SKU & Sản phẩm</th>
                    <th style={{ width: '80px' }}>Điểm bán</th>
                    <th className="text-right" style={{ width: '100px' }}>Tồn kho</th>
                    <th className="text-right" style={{ width: '100px' }}>Đang về</th>
                    <th className="text-right" style={{ width: '100px' }}>Điểm ROP</th>
                    <th className="text-right" style={{ width: '110px' }}>Gợi ý (EOQ)</th>
                    <th className="text-right" style={{ width: '120px' }}>SL đặt chốt</th>
                    <th style={{ width: '110px' }}>Trạng thái</th>
                    <th className="text-center" style={{ width: '110px' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '3rem', color: '#0f766e' }}>
                        <RefreshCw size={22} className="animate-spin" style={{ margin: '0 auto 10px', display: 'block' }} />
                        <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Đang tải danh sách đề xuất bổ sung...</span>
                      </td>
                    </tr>
                  ) : recommendations.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                        <p style={{ margin: 0, fontWeight: 500, fontSize: '0.875rem' }}>Không tìm thấy đề xuất nào phù hợp với bộ lọc.</p>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                          Nhấp vào nút "Tạo đề xuất mới" để quét lại mức tồn kho và tính toán nhu cầu đặt hàng.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    recommendations.map((rec) => {
                      const isPending = rec.status === 'PENDING';
                      const isApproved = rec.status === 'APPROVED';
                      const isSelected = selectedItem?.id === rec.id;
                      const priClass = (rec.priority || 'LOW').toLowerCase();
                      const statusClass = (rec.status || 'PENDING').toLowerCase();
                      const onHandNum = Number(rec.on_hand || 0);

                      return (
                        <tr
                          key={rec.id}
                          className={isSelected ? 'selected' : ''}
                          onClick={() => setSelectedItem(rec)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <span className={`rep-priority-badge pri-${priClass}`}>
                              <span className="rep-priority-dot" />
                              {PRIORITY_LABELS[rec.priority] || rec.priority}
                            </span>
                          </td>
                          <td>
                            <div className="rep-sku-code">{rec.item_id}</div>
                            <div className="rep-sku-name">{rec.product_name || rec.category || 'Mặt hàng bách hóa'}</div>
                          </td>
                          <td>
                            <span className="rep-store-tag">{rec.store_id}</span>
                          </td>
                          <td className={`text-right rep-mono-num ${onHandNum <= 0 ? 'num-danger' : 'num-default'}`}>
                            {formatQty(rec.on_hand)}
                          </td>
                          <td className="text-right rep-mono-num num-muted">
                            {formatQty(rec.on_order)}
                          </td>
                          <td className="text-right rep-mono-num num-muted">
                            {formatDecimal(rec.rop, 1)}
                          </td>
                          <td className="text-right rep-mono-num num-muted">
                            {formatQty(rec.recommended_qty)}
                          </td>
                          <td className="text-right rep-mono-num num-highlight">
                            {formatQty(rec.final_qty)}
                          </td>
                          <td>
                            <span className={`rep-status-pill status-${statusClass}`}>
                              <span className="rep-status-dot" />
                              {STATUS_LABELS[rec.status] || rec.status}
                            </span>
                          </td>
                          <td className="text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="rep-action-group">
                              {canEdit && isPending && (
                                <>
                                  <button
                                    className="rep-action-btn-icon btn-approve"
                                    onClick={() => handleApprove(rec)}
                                    title="Phê duyệt đơn hàng"
                                  >
                                    <Check size={14} />
                                  </button>
                                  <button
                                    className="rep-action-btn-icon btn-adjust"
                                    onClick={() => handleOpenAdjust(rec)}
                                    title="Điều chỉnh số lượng"
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    className="rep-action-btn-icon btn-reject"
                                    onClick={() => handleOpenReject(rec)}
                                    title="Từ chối đề xuất"
                                  >
                                    <Ban size={13} />
                                  </button>
                                </>
                              )}

                              {canEdit && isApproved && (
                                <button
                                  className="rep-action-btn-ghost btn-cancel"
                                  onClick={() => handleOpenCancel(rec)}
                                  title="Hủy đơn hàng đã duyệt"
                                >
                                  Hủy đơn
                                </button>
                              )}

                              {!isPending && !isApproved && (
                                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>-</span>
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
              <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #e2e8f0' }}>
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

      {/* TAB 2: INVENTORY STOCK OVERVIEW */}
      {viewTab === 'INVENTORY' && (
        <div className="rep-table-panel">
          <div className="rep-table-container">
            <table className="rep-table">
              <thead>
                <tr>
                  <th>Mã SKU & Tên sản phẩm</th>
                  <th style={{ width: '90px' }}>Điểm bán</th>
                  <th className="text-right" style={{ width: '120px' }}>Tồn kho thực tế</th>
                  <th className="text-right" style={{ width: '120px' }}>Đang vận chuyển</th>
                  <th className="text-right" style={{ width: '130px' }}>Tồn an toàn (SS)</th>
                  <th className="text-right" style={{ width: '130px' }}>Điểm đặt lại (ROP)</th>
                  <th className="text-right" style={{ width: '130px' }}>Lô kinh tế (EOQ)</th>
                  <th style={{ width: '120px' }}>Tình trạng</th>
                </tr>
              </thead>
              <tbody>
                {inventory.slice((invPage - 1) * invPageSize, invPage * invPageSize).map((item) => {
                  const onHand = Number(item.on_hand || 0);
                  const ss = item.safety_stock != null ? Number(item.safety_stock) : null;
                  const rop = item.reorder_point != null ? Number(item.reorder_point) : null;
                  const isCrit = ss != null ? onHand <= ss : false;
                  const isBelowRop = ss != null && rop != null ? (onHand > ss && onHand <= rop) : false;
                  const statusKey = isCrit ? 'critical' : isBelowRop ? 'warning' : (ss == null ? 'neutral' : 'healthy');
                  const statusText = isCrit ? 'Nguy cấp' : isBelowRop ? 'Dưới ROP' : (ss == null ? 'Chưa cấu hình' : 'An toàn');

                  return (
                    <tr key={item.item_id}>
                      <td>
                        <div className="rep-sku-code">{item.item_id}</div>
                        <div className="rep-sku-name">{item.name || item.item_id}</div>
                      </td>
                      <td>
                        <span className="rep-store-tag">{item.store_id || selectedStore}</span>
                      </td>
                      <td className={`text-right rep-mono-num ${isCrit ? 'num-danger' : 'num-default'}`}>
                        {formatQty(item.on_hand)}
                      </td>
                      <td className="text-right rep-mono-num num-muted">
                        {formatQty(item.on_order)}
                      </td>
                      <td className="text-right rep-mono-num num-muted">
                        {item.safety_stock != null ? formatDecimal(item.safety_stock, 1) : '-'}
                      </td>
                      <td className="text-right rep-mono-num num-muted">
                        {item.reorder_point != null ? formatDecimal(item.reorder_point, 1) : '-'}
                      </td>
                      <td className="text-right rep-mono-num num-highlight">
                        {item.eoq != null ? formatQty(item.eoq) : '-'}
                      </td>
                      <td>
                        <span className={`rep-status-pill status-${statusKey}`}>
                          <span className="rep-status-dot" />
                          {statusText}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #e2e8f0' }}>
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
          <div className="rep-filter-toolbar">
            <div className="rep-filter-left">
              <span className="rep-filter-lbl">LỌC TRẠNG THÁI:</span>
              <div className="rep-filter-pills">
                {[
                  { val: 'ALL', label: 'Tất cả' },
                  { val: 'APPROVED', label: 'Đã duyệt' },
                  { val: 'REJECTED', label: 'Từ chối' },
                  { val: 'CANCELLED', label: 'Đã hủy' }
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
              Nhật ký kiểm toán quyết định tại <strong>{selectedStore}</strong>
            </span>
          </div>

          <div className="rep-table-container">
            <table className="rep-table">
              <thead>
                <tr>
                  <th>Mã SKU</th>
                  <th style={{ width: '80px' }}>Điểm bán</th>
                  <th className="text-right" style={{ width: '120px' }}>Gợi ý ban đầu</th>
                  <th className="text-right" style={{ width: '120px' }}>SL duyệt chốt</th>
                  <th style={{ width: '110px' }}>Trạng thái</th>
                  <th>Lý do / Ghi chú</th>
                  <th style={{ width: '130px' }}>Người quyết định</th>
                  <th style={{ width: '160px' }}>Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {historyList.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                      Chưa có quyết định bổ sung nào được ghi nhận trong lịch sử.
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
                        <td className="text-right rep-mono-num num-muted">{formatQty(h.recommended_qty)}</td>
                        <td className="text-right rep-mono-num num-highlight">{formatQty(h.final_qty)}</td>
                        <td>
                          <span className={`rep-status-pill status-${statusClass}`}>
                            <span className="rep-status-dot" />
                            {STATUS_LABELS[h.status] || h.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8125rem', color: '#475569', maxWidth: '280px' }}>
                          {h.reason || '-'}
                        </td>
                        <td style={{ fontSize: '0.8125rem', color: '#334155', fontWeight: 500 }}>
                          {h.decided_by || 'Hệ thống'}
                        </td>
                        <td className="rep-mono-num num-muted" style={{ fontSize: '0.75rem' }}>
                          {h.decided_at 
                            ? new Date(h.decided_at).toLocaleString('vi-VN') 
                            : new Date(h.created_at).toLocaleString('vi-VN')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {historyTotal > 0 && (
            <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #e2e8f0' }}>
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

      {/* Slide-Over Detail Drawer (Fixed Right Panel with Portal) */}
      {selectedItem && createPortal(
        <div className="rep-drawer-overlay" onClick={() => setSelectedItem(null)}>
          <div className="rep-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <span className="drawer-badge">Chi tiết đề xuất đặt hàng</span>
                <h3 className="drawer-title">{selectedItem.item_id}</h3>
                <p className="drawer-sku-info">
                  {selectedItem.product_name || selectedItem.category || 'Mặt hàng bách hóa'} &bull; Cửa hàng: <strong>{selectedItem.store_id}</strong>
                </p>
              </div>
              <button className="drawer-close-btn" onClick={() => setSelectedItem(null)} title="Đóng bảng chi tiết">
                <X size={16} />
              </button>
            </div>

            <div className="drawer-body">
              {/* 2x2 KPIs Grid */}
              <div className="drawer-kpi-grid">
                <div className="drawer-kpi-card">
                  <span className="drawer-kpi-lbl">Tồn kho hiện có (On-Hand)</span>
                  <span className={`drawer-kpi-val ${Number(selectedItem.on_hand) <= 0 ? 'text-red' : 'text-slate'}`}>
                    {formatQty(selectedItem.on_hand)} <small>sp</small>
                  </span>
                </div>
                <div className="drawer-kpi-card">
                  <span className="drawer-kpi-lbl">Đang vận chuyển (On-Order)</span>
                  <span className="drawer-kpi-val text-slate">
                    {formatQty(selectedItem.on_order)} <small>sp</small>
                  </span>
                </div>
                <div className="drawer-kpi-card">
                  <span className="drawer-kpi-lbl">Điểm đặt hàng lại (ROP)</span>
                  <span className="drawer-kpi-val text-slate">
                    {formatDecimal(selectedItem.rop, 1)} <small>sp</small>
                  </span>
                </div>
                <div className="drawer-kpi-card">
                  <span className="drawer-kpi-lbl">Tồn kho an toàn (SS)</span>
                  <span className="drawer-kpi-val text-slate">
                    {formatDecimal(selectedItem.safety_stock, 1)} <small>sp</small>
                  </span>
                </div>
              </div>

              {/* Order Recommendation Box */}
              <div className="drawer-rec-box">
                <div className="drawer-rec-row-primary">
                  <span className="drawer-rec-label">Số lượng đặt hàng chính thức</span>
                  <span className="drawer-rec-value-highlight">
                    {formatQty(selectedItem.final_qty)} sp
                  </span>
                </div>
                <div className="drawer-rec-row-sub">
                  <span>Thuật toán đề xuất (EOQ):</span>
                  <span className="rep-mono-num">{formatQty(selectedItem.recommended_qty)} sp</span>
                </div>
                {Number(selectedItem.final_qty) !== Number(selectedItem.recommended_qty) && (
                  <div className="drawer-rec-row-delta">
                    <span>Chênh lệch điều chỉnh thủ công:</span>
                    <span>
                      {Number(selectedItem.final_qty) - Number(selectedItem.recommended_qty) > 0 ? '+' : ''}
                      {formatQty(Number(selectedItem.final_qty) - Number(selectedItem.recommended_qty))} sp
                    </span>
                  </div>
                )}
              </div>

              {/* Reason / Notes */}
              {selectedItem.reason && (
                <div className="drawer-section">
                  <span className="drawer-section-title">Lý do & Ghi chú nghiệp vụ</span>
                  <p className="drawer-reason-text">{selectedItem.reason}</p>
                </div>
              )}

              {/* Audit trail */}
              {selectedItem.decided_by && (
                <div className="drawer-audit-info">
                  Phê duyệt bởi: <strong>{selectedItem.decided_by}</strong>
                  {selectedItem.decided_at && ` vào lúc ${new Date(selectedItem.decided_at).toLocaleString('vi-VN')}`}
                </div>
              )}
            </div>

            {/* Drawer Footer Actions */}
            <div className="drawer-footer">
              {canEdit && selectedItem.status === 'PENDING' && (
                <>
                  <button
                    className="drawer-btn-approve"
                    onClick={() => handleApprove(selectedItem)}
                  >
                    <Check size={15} /> Phê duyệt đơn hàng
                  </button>
                  <button
                    className="drawer-btn-adjust"
                    onClick={() => handleOpenAdjust(selectedItem)}
                  >
                    <Pencil size={14} /> Điều chỉnh
                  </button>
                </>
              )}

              {canEdit && selectedItem.status === 'APPROVED' && (
                <button
                  className="rep-btn rep-btn-outline w-full justify-center"
                  style={{ color: '#dc2626', borderColor: '#fecaca', padding: '0.625rem' }}
                  onClick={() => handleOpenCancel(selectedItem)}
                >
                  <Ban size={15} /> Hủy đơn hàng đã duyệt
                </button>
              )}

              {(!canEdit || (selectedItem.status !== 'PENDING' && selectedItem.status !== 'APPROVED')) && (
                <button
                  className="drawer-btn-close"
                  onClick={() => setSelectedItem(null)}
                >
                  Đóng
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 1: Adjust Quantity */}
      {showAdjustModal && targetRec && createPortal(
        <div className="modal-overlay" onClick={() => setShowAdjustModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowAdjustModal(false)}><X size={16} /></button>
            <h2 className="modal-title">Điều chỉnh số lượng đặt hàng</h2>
            <p className="modal-subtitle">
              Ghi đè số lượng đề xuất cho mặt hàng <strong>{targetRec.item_id}</strong> tại kho <strong>{targetRec.store_id}</strong>.
            </p>

            <form onSubmit={handleSubmitAdjust}>
              <div className="modal-form-group">
                <label>Số lượng thuật toán gợi ý (EOQ)</label>
                <input
                  type="text"
                  disabled
                  value={`${formatQty(targetRec.recommended_qty)} sp (ROP: ${formatDecimal(targetRec.rop, 1)}, Tồn kho: ${formatQty(targetRec.on_hand)})`}
                  className="modal-input"
                  style={{ background: '#f1f5f9', color: '#64748b' }}
                />
              </div>

              <div className="modal-form-group">
                <label>Số lượng đặt hàng chính thức (Final Qty) *</label>
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
                <label>Lý do điều chỉnh (Bắt buộc theo chuẩn ERP) *</label>
                <textarea
                  required
                  rows={3}
                  value={actionReasonInput}
                  onChange={(e) => setActionReasonInput(e.target.value)}
                  placeholder="Ví dụ: Giới hạn dung tích xe vận chuyển, chính sách ưu đãi giá sỉ từ nhà cung cấp..."
                  className="modal-input"
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-btn-cancel"
                  onClick={() => setShowAdjustModal(false)}
                  disabled={isSubmittingAction}
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="modal-btn-apply"
                  disabled={isSubmittingAction || adjustQtyInput <= 0 || !actionReasonInput.trim()}
                >
                  {isSubmittingAction ? 'Đang lưu...' : 'Xác nhận điều chỉnh'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 2: Reject Recommendation */}
      {showRejectModal && targetRec && createPortal(
        <div className="modal-overlay" onClick={() => setShowRejectModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowRejectModal(false)}><X size={16} /></button>
            <h2 className="modal-title" style={{ color: '#dc2626' }}>Từ chối đề xuất đặt hàng</h2>
            <p className="modal-subtitle">
              Mặt hàng <strong>{targetRec.item_id}</strong> sẽ không được tạo đơn bổ sung trong chu kỳ này.
            </p>

            <form onSubmit={handleSubmitReject}>
              <div className="modal-form-group">
                <label>Lý do từ chối (Bắt buộc) *</label>
                <textarea
                  required
                  rows={3}
                  value={actionReasonInput}
                  onChange={(e) => setActionReasonInput(e.target.value)}
                  placeholder="Ví dụ: Sản phẩm sắp ngừng kinh doanh, đã có hàng điều chuyển từ chi nhánh lân cận..."
                  className="modal-input"
                  style={{ resize: 'vertical' }}
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
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  style={{ backgroundColor: '#dc2626', color: '#fff', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '0.375rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.8125rem' }}
                  disabled={isSubmittingAction || !actionReasonInput.trim()}
                >
                  {isSubmittingAction ? 'Đang từ chối...' : 'Xác nhận từ chối'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 3: Cancel Approved Order */}
      {showCancelModal && targetRec && createPortal(
        <div className="modal-overlay" onClick={() => setShowCancelModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCancelModal(false)}><X size={16} /></button>
            <h2 className="modal-title" style={{ color: '#dc2626' }}>Hủy đơn hàng đã duyệt</h2>
            <p className="modal-subtitle">
              Hủy đơn sẽ tự động hoàn trừ <strong>{formatQty(targetRec.final_qty)} sản phẩm</strong> khỏi lượng hàng On-Order đang vận chuyển.
            </p>

            <form onSubmit={handleSubmitCancel}>
              <div className="modal-form-group">
                <label>Lý do hủy đơn *</label>
                <textarea
                  required
                  rows={3}
                  value={actionReasonInput}
                  onChange={(e) => setActionReasonInput(e.target.value)}
                  placeholder="Ví dụ: Nhà cung cấp báo đứt hàng đột xuất, hủy bỏ chương trình khuyến mại..."
                  className="modal-input"
                  style={{ resize: 'vertical' }}
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
                  Đóng
                </button>
                <button
                  type="submit"
                  style={{ backgroundColor: '#dc2626', color: '#fff', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '0.375rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.8125rem' }}
                  disabled={isSubmittingAction || !actionReasonInput.trim()}
                >
                  {isSubmittingAction ? 'Đang xử lý...' : 'Xác nhận hủy đơn'}
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
