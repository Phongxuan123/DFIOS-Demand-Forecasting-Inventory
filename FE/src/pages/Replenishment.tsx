import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, RefreshCw, X, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { api } from '../services/api.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import './Replenishment.css';

export const Replenishment: React.FC = () => {
  const { user } = useAuth();
  const canEdit = user?.role?.toUpperCase() !== 'VIEWER';
  const [inventory, setInventory] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Filters & Tabs
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'CRITICAL' | 'LOW' | 'OPTIMIZED'>('ALL');
  const [viewTab, setViewTab] = useState<'ACTIVE' | 'HISTORY'>('ACTIVE');
  const [adjustmentsHistory, setAdjustmentsHistory] = useState<any[]>([]);

  // Active Inventory Pagination
  const [activePage, setActivePage] = useState(1);
  const [activePageSize, setActivePageSize] = useState(10);

  // History Pagination
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);

  // Modal State for adjusting stock / order qty
  const [showModal, setShowModal] = useState(false);
  const [adjOnHand, setAdjOnHand] = useState('0');
  const [adjOnOrder, setAdjOnOrder] = useState('0');
  const [adjReason, setAdjReason] = useState('Reorder replenishment');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Recompute Parameters State
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState('');

  const mapInventoryWithParams = (invList: any[], paramList: any[]) => {
    const paramMap = new Map();
    (paramList || []).forEach((p: any) => {
      paramMap.set(`${p.item_id}_${p.store_id}`, p);
      if (!paramMap.has(p.item_id)) {
        paramMap.set(p.item_id, p);
      }
    });

    return (invList || []).map((item: any) => {
      const opt = paramMap.get(`${item.item_id}_${item.store_id}`) || paramMap.get(item.item_id) || {};
      return {
        ...item,
        safety_stock: opt.safety_stock != null ? Math.round(opt.safety_stock) : 15,
        reorder_point: opt.reorder_point != null ? Math.round(opt.reorder_point) : 45,
        eoq: opt.eoq != null ? Math.round(opt.eoq) : 50,
        source: opt.source || 'ml',
        annual_demand: opt.annual_demand,
        holding_cost: opt.holding_cost,
        order_cost: opt.order_cost,
        service_level: opt.service_level,
        lead_time_days: opt.lead_time_days,
      };
    });
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Phase 1: Fast initial batch for instant 0.5s visual render
      const [initialInvRes, histRes, initialParamsRes] = await Promise.all([
        api.inventory.getInventory({ limit: 50, store_id: 'CA_1' }).catch(() => ({ list: [], total: 0 })),
        api.inventory.getAdjustments({ limit: 50 }).catch(() => ({ list: [], total: 0 })),
        api.optimization.getParameters({ limit: 50, store_id: 'CA_1' }).catch(() => ({ items: [], total: 0 })),
      ]);

      const initialItems = mapInventoryWithParams(
        initialInvRes.list || [],
        initialParamsRes.items || []
      );

      if (initialItems.length > 0) {
        setInventory(initialItems);
        setAdjustmentsHistory(histRes.list || []);
        setSelectedItem(initialItems[0]);
        // Release UI immediately
        setIsLoading(false);
      }

      // Phase 2: Full background hydration for store CA_1 (3,049 SKUs)
      const [fullInvRes, fullParamsRes, fullHistRes] = await Promise.all([
        api.inventory.getAllInventory({ store_id: 'CA_1' }),
        api.optimization.getAllParameters({ store_id: 'CA_1' }).catch(() => ({ items: [], list: [], total: 0 })),
        api.inventory.getAllAdjustments().catch(() => ({ list: [], total: 0 })),
      ]);

      const fullItems = mapInventoryWithParams(
        fullInvRes.list || [],
        fullParamsRes.items || fullParamsRes.list || []
      );

      setInventory(fullItems);
      setAdjustmentsHistory(fullHistRes.list || histRes.list || []);

      if (fullItems.length > 0) {
        setSelectedItem((prev: any) => {
          if (!prev) return fullItems[0];
          const found = fullItems.find((it: any) => it.item_id === prev.item_id && it.store_id === prev.store_id);
          return found || fullItems[0];
        });
      }
    } catch (error) {
      console.error('Failed to load replenishment inventory', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openAdjustModal = (item: any) => {
    setSelectedItem(item);
    setAdjOnHand(String(item.on_hand ?? 0));
    setAdjOnOrder(String(item.on_order ?? 0));
    setAdjReason('Reorder replenishment');
    setShowModal(true);
  };

  const handleUpdateInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    setIsSubmitting(true);
    try {
      await api.inventory.updateInventory(selectedItem.item_id, selectedItem.store_id || 'CA_1', {
        on_hand: Number(adjOnHand),
        on_order: Number(adjOnOrder),
        reason: adjReason,
      });
      setShowModal(false);
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to adjust inventory');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickReorder = async (item: any, addQty: number) => {
    try {
      const newOrder = Number(item.on_order || 0) + addQty;
      await api.inventory.updateInventory(item.item_id, item.store_id || 'CA_1', {
        on_hand: Number(item.on_hand || 0),
        on_order: newOrder,
        reason: `PO reorder triggered (+${addQty} units)`,
      });
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to trigger reorder');
    }
  };

  const handleRecompute = async () => {
    setIsRecomputing(true);
    setRecomputeMsg('');
    try {
      const storeId = selectedItem?.store_id || 'CA_1';
      const res = await api.optimization.recompute({ store_id: storeId });
      setRecomputeMsg(res.message || 'Đã tính toán lại tham số tồn kho tối ưu thành công!');
      await loadData();
      setTimeout(() => setRecomputeMsg(''), 4500);
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Lỗi khi tính toán lại tham số tồn kho');
    } finally {
      setIsRecomputing(false);
    }
  };

  // KPIs derived directly from live BE inventory and ML parameters
  const criticalItems = inventory.filter((item) => (item.on_hand ?? 0) <= 0);
  const belowSsItems = inventory.filter((item) => {
    const stock = Number(item.on_hand ?? 0);
    const ss = Number(item.safety_stock ?? 15);
    return stock > 0 && stock <= ss;
  });
  const reorderItems = inventory.filter((item) => {
    const eff = Number(item.on_hand ?? 0) + Number(item.on_order ?? 0);
    const rop = Number(item.reorder_point ?? 45);
    const stock = Number(item.on_hand ?? 0);
    return stock > 0 && eff <= rop;
  });
  const pendingOrders = inventory.filter((item) => (item.on_order ?? 0) > 0);
  const totalStockUnits = inventory.reduce((sum, item) => sum + Number(item.on_hand || 0), 0);

  const filteredItems = inventory.filter((item) => {
    const stock = Number(item.on_hand ?? 0);
    const eff = stock + Number(item.on_order ?? 0);
    const ss = Number(item.safety_stock ?? 15);
    const rop = Number(item.reorder_point ?? 45);

    if (statusFilter === 'CRITICAL') return stock <= 0;
    if (statusFilter === 'LOW') return stock > 0 && (stock <= ss || eff <= rop);
    if (statusFilter === 'OPTIMIZED') return stock > ss && eff > rop;
    return true;
  });

  useEffect(() => {
    setActivePage(1);
  }, [statusFilter]);

  const paginatedActiveItems = useMemo(() => {
    const start = (activePage - 1) * activePageSize;
    return filteredItems.slice(start, start + activePageSize);
  }, [filteredItems, activePage, activePageSize]);

  const paginatedHistoryItems = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize;
    return adjustmentsHistory.slice(start, start + historyPageSize);
  }, [adjustmentsHistory, historyPage, historyPageSize]);

  return (
    <div className="animate-fade-in mb-6 rep-container relative">
      <div className="rep-header-section">
        <div>
          <h1 className="rep-page-title">Automated Replenishment Module</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time inventory levels integrated with Machine Learning Optimization Parameters (SS, ROP, EOQ)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              className="recompute-btn"
              onClick={handleRecompute}
              disabled={isRecomputing}
              title="Kích hoạt tính toán lại Safety Stock, ROP và EOQ theo mô hình ML"
            >
              <RefreshCw size={13} className={isRecomputing ? 'animate-spin' : ''} />
              <span>{isRecomputing ? 'Recomputing...' : 'Recompute Parameters'}</span>
            </button>
          )}
          <button
            className="prod-btn-outline flex items-center gap-2"
            onClick={loadData}
            style={{ height: '36px', padding: '0 12px' }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {recomputeMsg && (
        <div className="recompute-banner mb-4">
          <CheckCircle2 size={16} className="text-teal-600 shrink-0" />
          <span>{recomputeMsg}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
          Loading replenishment inventory...
        </div>
      ) : (
        <>
          <div className="rep-kpi-row">
            <div className="rep-kpi-card">
              <span className="rep-kpi-title">OUT OF STOCK (CRITICAL)</span>
              <div className="rep-kpi-content">
                <h2>{criticalItems.length}</h2>
                <span className="rep-badge red-light">Immediate Attention</span>
              </div>
            </div>

            <div className="rep-kpi-card">
              <span className="rep-kpi-title">BELOW SAFETY STOCK / LOW</span>
              <div className="rep-kpi-content">
                <h2>{belowSsItems.length + reorderItems.length}</h2>
                <span className="rep-badge yellow-light">Reorder Triggered</span>
              </div>
            </div>

            <div className="rep-kpi-card">
              <span className="rep-kpi-title">PENDING PURCHASE ORDERS</span>
              <div className="rep-kpi-content">
                <h2>{pendingOrders.length}</h2>
                <span className="rep-badge green-text">In Transit</span>
              </div>
            </div>

            <div className="rep-kpi-card">
              <span className="rep-kpi-title">TOTAL MONITORED UNITS</span>
              <div className="rep-kpi-content">
                <h2>{totalStockUnits.toLocaleString()}</h2>
                <span className="rep-badge green-text">Active Inventory</span>
              </div>
            </div>
          </div>

          <div className="rep-filter-bar">
            <span className="filter-label">FILTER REPLENISHMENT BY STATUS</span>
            <div className="filter-pills">
              <button
                className={`pill-btn ${statusFilter === 'ALL' ? 'active-green' : ''}`}
                onClick={() => setStatusFilter('ALL')}
              >
                All ({inventory.length})
              </button>
              <button
                className={`pill-btn ${statusFilter === 'CRITICAL' ? 'active-green' : ''}`}
                onClick={() => setStatusFilter('CRITICAL')}
              >
                Out of Stock ({criticalItems.length})
              </button>
              <button
                className={`pill-btn ${statusFilter === 'LOW' ? 'active-green' : ''}`}
                onClick={() => setStatusFilter('LOW')}
              >
                Below SS / Reorder ({belowSsItems.length + reorderItems.length})
              </button>
              <button
                className={`pill-btn ${statusFilter === 'OPTIMIZED' ? 'active-green' : ''}`}
                onClick={() => setStatusFilter('OPTIMIZED')}
              >
                In Stock / Healthy ({inventory.length - criticalItems.length - belowSsItems.length})
              </button>
            </div>
          </div>

          <div className="rep-main-grid">
            <div className="rep-table-panel">
              <div className="table-top-bar">
                <div className="tab-group">
                  <button
                    className={`tab-btn ${viewTab === 'ACTIVE' ? 'active' : ''}`}
                    onClick={() => setViewTab('ACTIVE')}
                  >
                    Inventory & Orders
                  </button>
                  <button
                    className={`tab-btn ${viewTab === 'HISTORY' ? 'active' : ''}`}
                    onClick={() => setViewTab('HISTORY')}
                  >
                    Adjustment History ({adjustmentsHistory.length})
                  </button>
                </div>
              </div>

              <div className="rep-table-wrap">
                {viewTab === 'ACTIVE' ? (
                  <>
                    <table className="rep-table new-rep-table">
                      <thead>
                        <tr>
                          <th>SKU ID</th>
                          <th>PRODUCT NAME</th>
                          <th>STORE</th>
                          <th>ON-HAND</th>
                          <th>ON-ORDER</th>
                          <th>SAFETY STOCK</th>
                          <th>ROP</th>
                          <th>EOQ</th>
                          <th>STATUS</th>
                          <th>ACTION</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.length === 0 ? (
                          <tr>
                            <td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                              No inventory records found for selected filter.
                            </td>
                          </tr>
                        ) : (
                          paginatedActiveItems.map((item, idx) => {
                            const stock = Number(item.on_hand ?? 0);
                            const eff = stock + Number(item.on_order ?? 0);
                            const ss = Number(item.safety_stock ?? 15);
                            const rop = Number(item.reorder_point ?? 45);
                            const isCritical = stock <= 0;
                            const isBelowSs = stock > 0 && stock <= ss;
                            const isReorder = stock > 0 && eff <= rop;
                            const isSelected = selectedItem?.item_id === item.item_id && selectedItem?.store_id === item.store_id;

                            return (
                              <tr
                                key={`${item.item_id}-${item.store_id}-${idx}`}
                                className={isSelected ? 'bg-teal-50/50' : ''}
                                onClick={() => setSelectedItem(item)}
                                style={{ cursor: 'pointer' }}
                              >
                                <td className="fw-700">{item.item_id}</td>
                                <td>{item.product_name || item.item_id}</td>
                                <td>{item.store_id || 'Warehouse'}</td>
                                <td className="fw-700">{item.on_hand}</td>
                                <td className="eoq-cell">
                                  {item.on_order ?? 0}{' '}
                                  {canEdit && (
                                    <Pencil
                                      size={12}
                                      className="edit-icon inline ml-1 text-slate-400 hover:text-teal-600"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openAdjustModal(item);
                                      }}
                                    />
                                  )}
                                </td>
                                <td>
                                  <div className="flex items-center gap-1 font-mono text-xs">
                                    <span>{item.safety_stock} u</span>
                                    <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${
                                      item.source === 'ml' ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-700'
                                    }`}>
                                      {item.source?.toUpperCase() || 'ML'}
                                    </span>
                                  </div>
                                </td>
                                <td className="font-mono text-xs">{item.reorder_point} u</td>
                                <td className="font-mono text-xs font-semibold text-slate-700">{item.eoq} u</td>
                                <td>
                                  {isCritical ? (
                                    <span className="status-badge red-bg">OUT OF STOCK</span>
                                  ) : isBelowSs ? (
                                    <span className="status-badge red-light" style={{ color: '#b91c1c' }}>BELOW SS</span>
                                  ) : isReorder ? (
                                    <span className="status-badge yellow-text">REORDER</span>
                                  ) : (
                                    <span className="status-badge green-text-badge">OPTIMIZED</span>
                                  )}
                                </td>
                                <td>
                                  {canEdit && (
                                    <button
                                      className={`action-btn ${isCritical || isBelowSs ? 'green-solid' : 'outline'}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleQuickReorder(item, item.eoq || 50);
                                      }}
                                      title={`Đặt hàng số lượng EOQ tối ưu (+${item.eoq || 50} units)`}
                                    >
                                      +{item.eoq || 50} Order
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                    {filteredItems.length > 0 && (
                      <Pagination
                        currentPage={activePage}
                        totalItems={filteredItems.length}
                        pageSize={activePageSize}
                        onPageChange={setActivePage}
                        onPageSizeChange={(newSize) => {
                          setActivePageSize(newSize);
                          setActivePage(1);
                        }}
                        pageSizeOptions={[10, 15, 25, 50]}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <table className="rep-table new-rep-table">
                      <thead>
                        <tr>
                          <th>DATE</th>
                          <th>SKU ID</th>
                          <th>STORE</th>
                          <th>PREV</th>
                          <th>NEW</th>
                          <th>REASON</th>
                          <th>OPERATOR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adjustmentsHistory.length === 0 ? (
                          <tr>
                            <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                              No adjustment history found.
                            </td>
                          </tr>
                        ) : (
                          paginatedHistoryItems.map((adj, i) => (
                            <tr key={adj.id || i}>
                              <td className="text-secondary" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                                {adj.created_at ? new Date(adj.created_at).toLocaleDateString() : 'N/A'}
                              </td>
                              <td className="fw-700">{adj.item_id}</td>
                              <td>{adj.store_id}</td>
                              <td>{adj.old_on_hand}</td>
                              <td className="fw-700">{adj.new_on_hand}</td>
                              <td>{adj.reason || 'Cycle count'}</td>
                              <td className="text-secondary">{adj.adjusted_by || 'Staff'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                    {adjustmentsHistory.length > 0 && (
                      <Pagination
                        currentPage={historyPage}
                        totalItems={adjustmentsHistory.length}
                        pageSize={historyPageSize}
                        onPageChange={setHistoryPage}
                        onPageSizeChange={(newSize) => {
                          setHistoryPageSize(newSize);
                          setHistoryPage(1);
                        }}
                        pageSizeOptions={[10, 15, 25, 50]}
                      />
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="rep-detail-panel">
              {!selectedItem ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  Select an item to inspect replenishment calculation.
                </div>
              ) : (
                <>
                  <div className="rep-detail-header">
                    <span className={`rep-detail-tag ${selectedItem.on_hand <= 0 ? 'red-tag' : 'green-tag'}`}>
                      {selectedItem.item_id} • {selectedItem.on_hand <= 0 ? 'CRITICAL' : 'OPTIMIZED'}
                    </span>
                    <h2 className="rep-detail-title">{selectedItem.product_name || selectedItem.item_id}</h2>
                    <p className="rep-detail-subtitle">Store: {selectedItem.store_id || 'CA_1'}</p>
                  </div>

                  <div className="calc-box">
                    <h4 className="calc-title">INVENTORY POSITION</h4>
                    <div className="calc-row">
                      <span>On-hand Stock</span>
                      <span className="fw-700">{selectedItem.on_hand} units</span>
                    </div>
                    <div className="calc-row">
                      <span>On-order (In transit)</span>
                      <span className="fw-700">{selectedItem.on_order ?? 0} units</span>
                    </div>
                    <div className="calc-row">
                      <span>Effective Stock Position</span>
                      <span className="fw-700 teal-text">
                        {Number(selectedItem.on_hand || 0) + Number(selectedItem.on_order || 0)} units
                      </span>
                    </div>
                  </div>

                  <div className="calc-box mt-3">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="calc-title" style={{ margin: 0 }}>OPTIMIZATION PARAMETERS (UC30)</h4>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        selectedItem.source === 'ml' ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {selectedItem.source === 'ml' ? 'ML CONFORMAL' : 'STATIC MOVING AVG'}
                      </span>
                    </div>
                    <div className="calc-row">
                      <span>Recommended Safety Stock</span>
                      <span className="fw-700 text-teal-700">{selectedItem.safety_stock} units</span>
                    </div>
                    <div className="calc-row">
                      <span>Reorder Point (ROP)</span>
                      <span className="fw-700">{selectedItem.reorder_point} units</span>
                    </div>
                    <div className="calc-row">
                      <span>Economic Order Quantity (EOQ)</span>
                      <span className="fw-700 font-mono text-slate-800">{selectedItem.eoq} units</span>
                    </div>
                    <div className="calc-divider"></div>
                    <div className="calc-row">
                      <span>Target Service Level</span>
                      <span className="text-slate-600 font-medium">
                        {((selectedItem.service_level || 0.95) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="calc-row">
                      <span>Supplier Lead Time</span>
                      <span className="text-slate-600 font-medium">
                        {selectedItem.lead_time_days || 7} days
                      </span>
                    </div>
                    {selectedItem.annual_demand != null && (
                      <div className="calc-row">
                        <span>Projected Annual Demand</span>
                        <span className="text-slate-600 font-medium">
                          {Math.round(selectedItem.annual_demand).toLocaleString()} units
                        </span>
                      </div>
                    )}
                  </div>

                  {canEdit && (
                    <div className="detail-actions" style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <button
                        className="btn-generate"
                        onClick={() => handleQuickReorder(selectedItem, selectedItem.eoq || 50)}
                      >
                        Trigger Optimal EOQ Order (+{selectedItem.eoq || 50} units)
                      </button>
                      <button
                        className="prod-btn-outline"
                        onClick={() => openAdjustModal(selectedItem)}
                        style={{ width: '100%', height: '38px' }}
                      >
                        Adjust Stock / Custom Quantity
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {showModal && selectedItem && createPortal(
            <div className="modal-overlay" onClick={() => setShowModal(false)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header flex justify-between items-start">
                  <div>
                    <h2>Adjust Stock & Order Quantity</h2>
                    <p>{selectedItem.item_id} • Store: {selectedItem.store_id}</p>
                  </div>
                  <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleUpdateInventory} className="modal-body">
                  <div className="input-group">
                    <label>On-hand Actual Stock</label>
                    <input
                      type="number"
                      min="0"
                      className="settings-input w-full"
                      value={adjOnHand}
                      onChange={(e) => setAdjOnHand(e.target.value)}
                      required
                    />
                  </div>

                  <div className="input-group" style={{ marginTop: '1rem' }}>
                    <label>On-order Quantity (Purchase Order)</label>
                    <input
                      type="number"
                      min="0"
                      className="settings-input w-full"
                      value={adjOnOrder}
                      onChange={(e) => setAdjOnOrder(e.target.value)}
                      required
                    />
                  </div>

                  <div className="input-group" style={{ marginTop: '1rem' }}>
                    <label>Adjustment Reason</label>
                    <input
                      type="text"
                      className="settings-input w-full"
                      value={adjReason}
                      onChange={(e) => setAdjReason(e.target.value)}
                      placeholder="e.g. Cycle count, Restock, Return"
                    />
                  </div>

                  <div className="modal-footer flex justify-end gap-3 mt-6">
                    <button
                      type="button"
                      className="btn-reject"
                      onClick={() => setShowModal(false)}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn-confirm"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Saving...' : 'Save Adjustment'}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
};
