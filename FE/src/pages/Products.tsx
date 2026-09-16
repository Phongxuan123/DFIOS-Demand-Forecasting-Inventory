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
      {/* Header */}
      <div className="dashboard-header">
        <h1 className="dashboard-title">Product Catalog</h1>
        <div className="dashboard-header-actions">
          <div className="search-wrapper">
            <Search size={14} className="search-icon" />
            <input type="text" placeholder="Search products, orders..." className="search-input" />
          </div>
          <button className="bell-btn">
            <Bell size={16} />
            <span className="bell-badge"></span>
          </button>
          <div className="date-display">
            <Calendar size={14} />
            October 24, 2024
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading products data...</div>
      ) : (
        <>
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
              <button className="prod-btn-outline">Import</button>
              <button className="prod-btn-primary">Export Catalog</button>
            </div>
          </div>

          {/* Main Split */}
          <div className="prod-main-split">
            {/* Left Table Panel */}
            <div className="prod-table-area">
              <h2 className="prod-table-title">Monitored SKUs</h2>
              
              <div className="prod-list-header">
                <div className="prod-col-title prod-col-1">SKU ID</div>
                <div className="prod-col-title prod-col-2">PRODUCT NAME</div>
                <div className="prod-col-title prod-col-3">CATEGORY</div>
                <div className="prod-col-title prod-col-4">STORE</div>
                <div className="prod-col-title prod-col-5">STOCK</div>
                <div className="prod-col-title prod-col-6">DAILY DEMAND</div>
              </div>
              
              <div>
                {data.list.map((prod: any, idx: number) => (
                  <div className="prod-row" key={idx}>
                    <div className="prod-col-1">{prod.id}</div>
                    <div className="prod-col-2">{prod.name}</div>
                    <div className="prod-col-3">{prod.category}</div>
                    <div className="prod-col-4">{prod.store}</div>
                    <div className="prod-col-5" style={{ color: prod.isLow ? '#dc2626' : '#0f172a' }}>{prod.stock}</div>
                    <div className="prod-col-6">{prod.demand}</div>
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
              
              <div style={{ marginBottom: '2rem' }}>
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
