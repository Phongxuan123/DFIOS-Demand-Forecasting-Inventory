import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { api } from '../services/api.ts';
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

  // Modal State for adjusting stock / order qty
  const [showModal, setShowModal] = useState(false);
  const [adjOnHand, setAdjOnHand] = useState('0');
  const [adjOnOrder, setAdjOnOrder] = useState('0');
  const [adjReason, setAdjReason] = useState('Reorder replenishment');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [invRes, histRes] = await Promise.all([
        api.inventory.getInventory({ limit: 100 }),
        api.inventory.getAdjustments({ limit: 50 }),
      ]);
      const items = invRes.list || [];
      setInventory(items);
      setAdjustmentsHistory(histRes.list || []);

      if (items.length > 0) {
        setSelectedItem(items[0]);
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

  // KPIs derived directly from live BE inventory
  const criticalItems = inventory.filter((item) => (item.on_hand ?? 0) <= 0);
  const lowStockItems = inventory.filter((item) => (item.on_hand ?? 0) > 0 && (item.on_hand ?? 0) < 15);
  const pendingOrders = inventory.filter((item) => (item.on_order ?? 0) > 0);
  const totalStockUnits = inventory.reduce((sum, item) => sum + Number(item.on_hand || 0), 0);

  const filteredItems = inventory.filter((item) => {
    const stock = Number(item.on_hand ?? 0);
    if (statusFilter === 'CRITICAL') return stock <= 0;
    if (statusFilter === 'LOW') return stock > 0 && stock < 15;
    if (statusFilter === 'OPTIMIZED') return stock >= 15;
    return true;
  });

  return (
    <div className="animate-fade-in mb-6 rep-container relative">
      <div className="rep-header-section">
        <h1 className="rep-page-title">Automated Replenishment Module</h1>
        <button
          className="prod-btn-outline flex items-center gap-2"
          onClick={loadData}
          style={{ height: '36px', padding: '0 12px' }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

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
                <h2>{lowStockItems.length}</h2>
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
                Low Stock ({lowStockItems.length})
              </button>
              <button
                className={`pill-btn ${statusFilter === 'OPTIMIZED' ? 'active-green' : ''}`}
                onClick={() => setStatusFilter('OPTIMIZED')}
              >
                In Stock ({inventory.length - criticalItems.length - lowStockItems.length})
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
                  <table className="rep-table new-rep-table">
                    <thead>
                      <tr>
                        <th>SKU ID</th>
                        <th>PRODUCT NAME</th>
                        <th>STORE</th>
                        <th>ON-HAND</th>
                        <th>ON-ORDER</th>
                        <th>STATUS</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                            No inventory records found for selected filter.
                          </td>
                        </tr>
                      ) : (
                        filteredItems.map((item, idx) => {
                          const stock = Number(item.on_hand ?? 0);
                          const isCritical = stock <= 0;
                          const isLow = stock > 0 && stock < 15;
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
                                {isCritical ? (
                                  <span className="status-badge red-bg">CRITICAL</span>
                                ) : isLow ? (
                                  <span className="status-badge yellow-text">LOW STOCK</span>
                                ) : (
                                  <span className="status-badge green-text-badge">IN STOCK</span>
                                )}
                              </td>
                              <td>
                                {canEdit && (
                                  <button
                                    className={`action-btn ${isCritical ? 'green-solid' : 'outline'}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleQuickReorder(item, 50);
                                    }}
                                  >
                                    +50 Order
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                ) : (
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
                        adjustmentsHistory.map((adj, i) => (
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
                    <div className="calc-divider"></div>
                    <div className="calc-row">
                      <span>Recommended Safety Stock</span>
                      <span className="fw-700">15 Units</span>
                    </div>
                  </div>

                  {canEdit && (
                    <div className="detail-actions" style={{ marginTop: '1.5rem' }}>
                      <button
                        className="btn-generate"
                        onClick={() => openAdjustModal(selectedItem)}
                      >
                        Adjust / Reorder Quantity
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
