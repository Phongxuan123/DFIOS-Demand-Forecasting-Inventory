import React, { useState, useEffect } from 'react';
import { Search, Bell, Calendar } from 'lucide-react';
import { LineChart, Line, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import './Replenishment.css';

export const Replenishment: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { api } = await import('../services/api.ts');
        const response = await api.inventory.getReplenishmentAlerts();
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
    <div className="animate-fade-in mb-6">

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading replenishment data...</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="replenishment-kpi-grid">
            <div className="glass rep-kpi-card" style={{ borderRadius: '0.75rem' }}>
              <p className="rep-kpi-label">Items Below ROP</p>
              <div className="rep-kpi-value-row">
                <h2 className="rep-kpi-value">{data.kpis.itemsBelowRop}</h2>
                <span className="rep-kpi-badge danger">Needs Immediate Action</span>
              </div>
            </div>

            <div className="glass rep-kpi-card" style={{ borderRadius: '0.75rem' }}>
              <p className="rep-kpi-label">Pending Purchase Orders</p>
              <div className="rep-kpi-value-row">
                <h2 className="rep-kpi-value">{data.kpis.pendingOrders}</h2>
                <span className="rep-kpi-badge warning">3 ETA Today</span>
              </div>
            </div>

            <div className="glass rep-kpi-card" style={{ borderRadius: '0.75rem' }}>
              <p className="rep-kpi-label">Avg. Safety Stock Days</p>
              <div className="rep-kpi-value-row">
                <h2 className="rep-kpi-value">{data.kpis.avgSafetyStockDays} <span style={{fontSize: '1rem', fontWeight: 600}}>Days</span></h2>
                <span className="rep-kpi-badge success-text">Target Achieved (98%)</span>
              </div>
            </div>

            <div className="glass rep-kpi-card" style={{ borderRadius: '0.75rem' }}>
              <p className="rep-kpi-label">Total EOQ Value</p>
              <div className="rep-kpi-value-row">
                <h2 className="rep-kpi-value">{data.kpis.totalEoqValue}</h2>
                <span className="rep-kpi-badge success-text">+15% Capital Efficiency</span>
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="rep-filter-bar">
            <span className="rep-filter-label">Filter Replenishment By Status</span>
            <button className="rep-filter-btn neutral">All (140)</button>
            <button className="rep-filter-btn active">Below Safety Stock (14)</button>
            <button className="rep-filter-btn neutral">Triggered ROP (22)</button>
            <button className="rep-filter-btn neutral">Optimized (104)</button>
          </div>

          {/* Main Split Content */}
          <div className="rep-main-split">
            {/* Left Table */}
            <div className="rep-table-area">
              <div className="rep-table-header">
                <div className="rep-tabs">
                  <button className="rep-tab active">Active Orders</button>
                  <button className="rep-tab">History</button>
                </div>
                <div className="rep-table-actions">
                  <span className="rep-table-sort">Sorted by: Urgent Priority</span>
                  <button className="rep-export-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '6px'}}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    Export CSV
                  </button>
                </div>
              </div>
              
              <div className="rep-list-header">
                <div className="rep-col-title rep-col-1">SKU ID</div>
                <div className="rep-col-title rep-col-2">PRODUCT NAME</div>
                <div className="rep-col-title rep-col-3">STOCK</div>
                <div className="rep-col-title rep-col-4">SAFETY</div>
                <div className="rep-col-title rep-col-5">ROP</div>
                <div className="rep-col-title rep-col-6">EOQ</div>
                <div className="rep-col-title rep-col-7">STATUS</div>
                <div className="rep-col-title rep-col-8">ACTION</div>
              </div>
              
              <div>
                <div className="rep-group-header">MOQ: 50 | Pack: 10</div>
                {data.tableData.map((row: any, idx: number) => (
                  <div className="rep-row" key={idx}>
                    <div className="rep-col-1">{row.id}</div>
                    <div className="rep-col-2">
                      <span className="truncate" style={{ display: 'inline-block', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.name}
                      </span>
                    </div>
                    <div className="rep-col-3">{row.stock}</div>
                    <div className="rep-col-4">{row.safety}</div>
                    <div className="rep-col-5">{row.rop}</div>
                    <div className="rep-col-6" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      {row.eoq}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: '#94a3b8'}}><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                    </div>
                    <div className="rep-col-7">
                      <span className={`status-badge ${row.status === 'CRITICAL' ? 'critical' : row.status === 'LOW STOCK' ? 'low' : 'ok'}`}>
                        {row.status}
                      </span>
                    </div>
                    <div className="rep-col-8">
                      <button className={`action-btn ${row.actionPrimary ? 'primary' : ''}`} style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.action}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Detail Panel */}
            <div className="rep-detail-panel">
              <span className="detail-sku-tag">SKU-8921 CRITICAL</span>
              <h2 className="detail-title">Nike Ultra Boost</h2>
              <p className="detail-subtitle">E-Commerce Warehouse - Footwear</p>
              
              <h4 className="detail-section-title">Safety Stock Calculation</h4>
              <div style={{marginBottom: '2rem'}}>
                <div className="calc-row">
                  <span className="calc-label">Daily Demand (μ)</span>
                  <span className="calc-value">4.2 units/day</span>
                </div>
                <div className="calc-row">
                  <span className="calc-label">Supplier Lead Time (L)</span>
                  <span className="calc-value">5 Days</span>
                </div>
                <div className="calc-row">
                  <span className="calc-label">Z-Score (98% SL)</span>
                  <span className="calc-value">2.05</span>
                </div>
                <div className="calc-row" style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                  <span className="calc-label" style={{ color: '#0f172a', fontWeight: 600 }}>Calculated Safety Stock</span>
                  <span className="calc-value highlight">15 Units</span>
                </div>
              </div>
              
              <h4 className="detail-section-title">28-Day Demand Forecast Projection</h4>
              <div className="chart-placeholder">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.chartData} margin={{ top: 5, right: 0, bottom: 0, left: 0 }}>
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 8, fill: '#94a3b8'}} />
                    <Tooltip 
                      cursor={{stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '5 5'}}
                      contentStyle={{ backgroundColor: 'white', borderColor: '#e2e8f0', borderRadius: '4px', padding: '4px' }}
                    />
                    <Line type="monotone" dataKey="demand" stroke="#0d9488" strokeWidth={2} strokeDasharray="3 3" dot={{r: 2, fill: '#0d9488'}} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', bottom: '20px', left: '0', right: '0', textAlign: 'center', fontSize: '0.625rem', fontWeight: 700, color: '#0d9488' }}>
                  ROP Trigger
                </div>
              </div>
              
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <button className="po-btn">Generate Purchase Order (150 Units)</button>
                <button className="reject-btn">Reject Order</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
