import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, Pencil } from 'lucide-react';
import './Replenishment.css';

export const Replenishment: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [adjQty, setAdjQty] = useState('45');
  const [reason, setReason] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { api } = await import('../services/api.ts');
        const response = await api.inventory.getReplenishmentDashboard();
        setData(response);
      } catch (error) {
        console.error("Failed to load replenishment data", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="animate-fade-in mb-6 rep-container relative">
      <div className="rep-header-section">
        <h1 className="rep-page-title">Automated Replenishment Module</h1>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading dashboard data...</div>
      ) : (
        <>
          <div className="rep-kpi-row">
            <div className="rep-kpi-card">
              <span className="rep-kpi-title">ITEMS BELOW ROP</span>
              <div className="rep-kpi-content">
                <h2>14</h2>
                <span className="rep-badge red-light">Needs Immediate Action</span>
              </div>
            </div>
            
            <div className="rep-kpi-card">
              <span className="rep-kpi-title">PENDING PURCHASE ORDERS</span>
              <div className="rep-kpi-content">
                <h2>8</h2>
                <span className="rep-badge yellow-light">3 ETA Today</span>
              </div>
            </div>

            <div className="rep-kpi-card">
              <span className="rep-kpi-title">AVG. SAFETY STOCK DAYS</span>
              <div className="rep-kpi-content">
                <h2>12.3 Days</h2>
                <span className="rep-badge green-text">Target Achieved (98%)</span>
              </div>
            </div>

            <div className="rep-kpi-card">
              <span className="rep-kpi-title">TOTAL EOQ VALUE</span>
              <div className="rep-kpi-content">
                <h2>$24,580</h2>
                <span className="rep-badge green-text">+15% Capital Efficiency</span>
              </div>
            </div>
          </div>

          <div className="rep-filter-bar">
            <span className="filter-label">FILTER REPLENISHMENT BY STATUS</span>
            <div className="filter-pills">
              <button className="pill-btn">All (140)</button>
              <button className="pill-btn active-green">Below Safety Stock (14)</button>
              <button className="pill-btn">Triggered ROP (22)</button>
              <button className="pill-btn">Optimized (104)</button>
            </div>
          </div>

          <div className="rep-main-grid">
            <div className="rep-table-panel">
              <div className="table-top-bar">
                <div className="tab-group">
                  <button className="tab-btn active">Active Orders</button>
                  <button className="tab-btn">History</button>
                </div>
                <div className="action-group">
                  <span className="sort-text">Sorted by: Urgent Priority</span>
                  <button className="export-btn"><Download size={14} /> Export CSV</button>
                </div>
              </div>
              
              <div className="rep-table-wrap">
                <table className="rep-table new-rep-table">
                  <thead>
                    <tr>
                      <th>SKU ID</th>
                      <th className="vertical-th">
                        <div className="vert-text">PRODUCT<br/>NAME</div>
                        <div className="moq-pack">MOQ: 50 | Pack: 10</div>
                      </th>
                      <th>STOCK</th>
                      <th>SAFETY</th>
                      <th>ROP</th>
                      <th>EOQ</th>
                      <th>STATUS</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="fw-700">SKU-8921</td>
                      <td className="dots-td">..</td>
                      <td>8</td>
                      <td>15</td>
                      <td>20</td>
                      <td className="eoq-cell">150 <Pencil size={12} className="edit-icon" onClick={() => setShowModal(true)} /></td>
                      <td><span className="status-badge red-bg">CRITICAL</span></td>
                      <td><button className="action-btn green-solid">Reorder 150 Nov</button></td>
                    </tr>
                    <tr>
                      <td className="fw-700">SKU-4402</td>
                      <td className="dots-td">..</td>
                      <td>12</td>
                      <td>10</td>
                      <td>18</td>
                      <td className="eoq-cell">120 <Pencil size={12} className="edit-icon" onClick={() => setShowModal(true)} /></td>
                      <td><span className="status-badge yellow-text">LOW STOCK</span></td>
                      <td><button className="action-btn outline">Trigger Reorder</button></td>
                    </tr>
                    <tr>
                      <td className="fw-700">SKU-1024</td>
                      <td className="dots-td">..</td>
                      <td>45</td>
                      <td>12</td>
                      <td>22</td>
                      <td className="eoq-cell">80 <Pencil size={12} className="edit-icon" onClick={() => setShowModal(true)} /></td>
                      <td><span className="status-badge green-text-badge">IN STOCK</span></td>
                      <td><button className="action-btn outline">Monitor Demand</button></td>
                    </tr>
                    <tr>
                      <td className="fw-700">SKU-7721</td>
                      <td className="dots-td">..</td>
                      <td>68</td>
                      <td>25</td>
                      <td>40</td>
                      <td className="eoq-cell">200 <Pencil size={12} className="edit-icon" onClick={() => setShowModal(true)} /></td>
                      <td><span className="status-badge green-text-badge">IN STOCK</span></td>
                      <td><button className="action-btn outline">Optimized</button></td>
                    </tr>
                    <tr>
                      <td className="fw-700">SKU-5012</td>
                      <td className="dots-td">..</td>
                      <td>9</td>
                      <td>8</td>
                      <td>15</td>
                      <td className="eoq-cell">100 <Pencil size={12} className="edit-icon" onClick={() => setShowModal(true)} /></td>
                      <td><span className="status-badge yellow-text">LOW STOCK</span></td>
                      <td><button className="action-btn outline">Reorder Triggered</button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rep-detail-panel">
              <div className="rep-detail-header">
                <span className="rep-detail-tag red-tag">SKU-8921 CRITICAL</span>
                <h2 className="rep-detail-title">Nike Ultra Boost</h2>
                <p className="rep-detail-subtitle">E-Commerce Warehouse • Footwear</p>
              </div>

              <div className="calc-box">
                <h4 className="calc-title">SAFETY STOCK CALCULATION</h4>
                <div className="calc-row">
                  <span>Daily Demand (μ)</span>
                  <span className="fw-700">4.2 units/day</span>
                </div>
                <div className="calc-row">
                  <span>Supplier Lead Time (L)</span>
                  <span className="fw-700">5 Days</span>
                </div>
                <div className="calc-row">
                  <span>Z-Score (98% SL)</span>
                  <span className="fw-700">2.05</span>
                </div>
                <div className="calc-divider"></div>
                <div className="calc-row">
                  <span className="fw-700">Calculated Safety Stock</span>
                  <span className="fw-700 teal-text">15 Units</span>
                </div>
              </div>

              <div className="forecast-box">
                <h4 className="calc-title">28-DAY DEMAND FORECAST PROJECTION</h4>
                <div className="chart-placeholder">
                  <svg width="100%" height="60" viewBox="0 0 200 60" preserveAspectRatio="none">
                    <path d="M0,50 L30,20 L60,45 L110,10 L150,25 L200,35" fill="none" stroke="#0d9488" strokeWidth="2" strokeDasharray="4 4" />
                    <path d="M0,50 L30,20 L60,45" fill="none" stroke="#64748b" strokeWidth="2" />
                    <circle cx="60" cy="45" r="4" fill="#0d9488" />
                  </svg>
                  <div className="chart-labels">
                    <span>Oct 24</span>
                    <span className="teal-text fw-600" style={{ fontSize: '10px' }}>ROP Trigger</span>
                    <span>Nov 21</span>
                  </div>
                </div>
              </div>
              
              <div className="detail-actions">
                <button className="btn-generate">Generate Purchase Order (150 Units)</button>
                <button className="btn-reject">Reject Order</button>
              </div>
            </div>
          </div>
          
          {showModal && createPortal(
            <div className="modal-overlay" onClick={() => setShowModal(false)}>
              <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Adjust Recommended Order Quantity</h2>
                  <p>SKU-8921 - Nike Ultra Boost (White / Size 10)</p>
                </div>
                
                <div className="modal-body">
                  <div className="supplier-box">
                    <div className="supplier-title">SUPPLIER CONSTRAINTS</div>
                    <div className="supplier-rules">
                      MOQ <strong>50 units</strong> • Pack-size / Order Multiple <strong>10 units</strong>
                    </div>
                    <div className="supplier-hint">Hint: Enter a multiple of 10 (e.g., 50, 60, 70).</div>
                  </div>
                  
                  <div className="input-group">
                    <label>RECOMMENDED ORDER QUANTITY</label>
                    <div className="input-with-label">
                      <input type="text" value="150" readOnly className="disabled-input" />
                      <span className="inner-label">Current</span>
                    </div>
                  </div>
                  
                  <div className="input-group">
                    <label>ADJUSTED ORDER QUANTITY</label>
                    <div className="input-with-label error-state">
                      <input 
                        type="text" 
                        value={adjQty} 
                        onChange={e => setAdjQty(e.target.value)} 
                        className="error-input" 
                      />
                      <span className="inner-label red">Invalid</span>
                    </div>
                    <div className="error-text">
                      - Must be &ge; 50 (MOQ).<br/>- Must be a multiple of 10 (Pack-size).
                    </div>
                  </div>
                  
                  <div className="input-group mb-0">
                    <label>REASON FOR ADJUSTMENT</label>
                    <textarea 
                      placeholder="Enter reason..."
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                    ></textarea>
                    <div className="error-text mt-1">Reason is required for auditability.</div>
                  </div>
                </div>
                
                <div className="modal-footer">
                  <button className="btn-cancel" onClick={() => setShowModal(false)}>Cancel</button>
                  <button className="btn-save">Save / Apply Adjustment</button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
};
