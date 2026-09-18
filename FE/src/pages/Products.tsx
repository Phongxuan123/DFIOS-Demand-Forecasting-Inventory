import React from 'react';
import { Search, Bell, Calendar } from 'lucide-react';
import { BarChart, Bar, Tooltip, ResponsiveContainer } from 'recharts';
import './Products.css';



export const Products: React.FC = () => {
  const [data, setData] = React.useState<any>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const { api } = await import('../services/api.ts');
        const result = await api.inventory.getProducts();
        setData(result);
      } catch (error) {
        console.error("Failed to load products data", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="animate-fade-in mb-6">

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading products data...</div>
      ) : (
        <>
          {/* Top Tabs */}
          <div className="prod-tabs-container">
            <button className="prod-tab-btn active">Products</button>
            <button className="prod-tab-btn">Suppliers</button>
            <button className="prod-tab-btn">Sales Data</button>
            <button className="prod-tab-btn">Events & Promotions</button>
          </div>

          {/* Filter Bar */}
          <div className="prod-filter-bar">
            <div className="prod-filter-group">
              <div className="prod-filter-item">
                <label className="prod-filter-label">Category</label>
                <select className="prod-filter-select">
                  <option>Footwear</option>
                </select>
              </div>
              <div className="prod-filter-item">
                <label className="prod-filter-label">Location</label>
                <select className="prod-filter-select">
                  <option>All Stores</option>
                </select>
              </div>
              <div className="prod-filter-item">
                <label className="prod-filter-label">ABC Class</label>
                <select className="prod-filter-select">
                  <option>Tier A</option>
                </select>
              </div>
              <div className="prod-filter-item" style={{ flex: 2 }}>
                <label className="prod-filter-label">Search Term</label>
                <input type="text" className="prod-filter-input" defaultValue="Adidas" style={{ width: '100%' }} />
              </div>
            </div>
            <div className="prod-filter-actions">
              <div className="prod-filter-item">
                <label className="prod-filter-label">Action</label>
                <div style={{display: 'flex', gap: '0.75rem'}}>
                  <button className="prod-btn-outline">Import</button>
                  <button className="prod-btn-primary">Export Catalog</button>
                </div>
              </div>
            </div>
          </div>
          
          {/* Helper Texts */}
          <div className="prod-helper-texts">
            <span className="prod-helper-text">Suppliers tab available</span>
            <span className="prod-helper-text">Sales Data supports CSV/Excel Import</span>
            <span className="prod-helper-text">Events & Promotions manages promotion calendars</span>
          </div>

          {/* Main Split */}
          <div className="prod-main-split">
            {/* Left Table Panel */}
            <div className="prod-table-area">
              <h2 className="prod-table-title">Monitored SKUs</h2>
              
              <div className="prod-list-header">
                <div className="prod-col-title prod-col-1">SKU ID</div>
                <div className="prod-col-title prod-col-2">P<br/>R<br/>O<br/>D<br/>U<br/>C<br/>T<br/>N<br/>A<br/>M<br/>E</div>
                <div className="prod-col-title prod-col-3">CATEGORY</div>
                <div className="prod-col-title prod-col-4">STORE</div>
                <div className="prod-col-title prod-col-5">STOCK</div>
                <div className="prod-col-title prod-col-6">DAILY DEMAND</div>
                <div className="prod-col-title prod-col-7">STAT...</div>
              </div>
              
              <div>
                {data.list.map((prod: any, idx: number) => (
                  <div className="prod-row" key={idx}>
                    <div className="prod-col-1">{prod.id}</div>
                    <div className="prod-col-2">...</div>
                    <div className="prod-col-3">{prod.category}</div>
                    <div className="prod-col-4">{prod.store}</div>
                    <div className="prod-col-5" style={{ color: prod.isLow ? '#dc2626' : '#0f172a' }}>{prod.stock}</div>
                    <div className="prod-col-6">{prod.demand}</div>
                    <div className="prod-col-7"></div>
                  </div>
                ))}
              </div>
              
              <div className="prod-table-footer">
                <div className="prod-showing-text">Showing {data.list.length} of 3,049 SKUs</div>
                <div className="prod-pagination">
                  <button className="page-btn">Previous</button>
                  <button className="page-btn active">1</button>
                  <button className="page-btn">2</button>
                  <button className="page-btn">Next</button>
                </div>
              </div>
            </div>

            {/* Right Detail Panel */}
            <div className="prod-detail-panel">
              <div className="prod-detail-tags">
                <span className="prod-tag">CRITICAL</span>
                <span className="prod-tag">ALERT</span>
                <span className="prod-tag">ACTIVE</span>
              </div>
              <h2 className="prod-detail-title">Nike Vapor Fly</h2>
              <p className="prod-detail-subtitle">SKU-4402-VAPOR-ATHLETIC</p>
              
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 className="prod-section-title" style={{ marginBottom: '1rem' }}>INVENTORY PARAMETERS</h4>
                <div className="prod-param-row">
                  <span className="prod-param-label">Safety Stock Level</span>
                  <span className="prod-param-value">45 units</span>
                </div>
                <div className="prod-param-row">
                  <span className="prod-param-label">Reorder Point (ROP)</span>
                  <span className="prod-param-value">60 units</span>
                </div>
                <div className="prod-param-row">
                  <span className="prod-param-label">Economic Order Qty (EOQ)</span>
                  <span className="prod-param-value">150 units</span>
                </div>
                <div className="prod-param-row">
                  <span className="prod-param-label">ABC / XYZ Class</span>
                  <span className="prod-param-value">
                    <span className="prod-badge-a">A</span>
                    <span className="prod-badge-x">X</span>
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <h4 className="prod-section-title" style={{ marginBottom: '1rem' }}>UPDATE INVENTORY</h4>
                <div className="prod-param-row">
                  <span className="prod-param-label">On-hand Stock</span>
                  <div className="prod-input-box">184</div>
                </div>
                <div className="prod-param-row">
                  <span className="prod-param-label">On-order Quantity</span>
                  <div className="prod-input-box">150</div>
                </div>
                <button className="prod-btn-primary" style={{marginTop: '0.75rem'}}>Update Stock</button>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <h4 className="prod-section-title" style={{ marginBottom: '1rem' }}>RECENT ADJUSTMENTS</h4>
                <div className="prod-adj-row">
                   <span className="prod-adj-text">Oct 22 — Stock adjusted: 190 &rarr; 184</span>
                   <span className="prod-adj-badge">Cycle count</span>
                </div>
                <div className="prod-adj-row">
                   <span className="prod-adj-text">Oct 18 — On-order updated: 0 &rarr; 150</span>
                   <span className="prod-adj-badge">PO #2847</span>
                </div>
              </div>
              
              <div>
                <div className="prod-section-header">
                  <h4 className="prod-section-title" style={{ marginBottom: 0 }}>DEMAND TREND (14D)</h4>
                  <span className="prod-trend-tag">+15% forecasted</span>
                </div>
                <div className="prod-chart-placeholder">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.trend}>
                      <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{ fontSize: '10px', padding: '4px' }} />
                      <Bar dataKey="val" fill="#0d9488" radius={[2, 2, 0, 0]} barSize={4} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              
              <button className="prod-reorder-btn">Trigger Manual Reorder</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
