import React, { useState, useEffect } from 'react';
import { Search, Upload, Download, Plus, Calendar as CalendarIcon, ChevronRight } from 'lucide-react';
import { BarChart, Bar, Tooltip, ResponsiveContainer } from 'recharts';
import './Products.css';

export const Products: React.FC = () => {
  const [activeTab, setActiveTab] = useState('Products');
  const [data, setData] = useState<any>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [imports, setImports] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { api } = await import('../services/api.ts');
        const [productsResult, suppliersResult, importsResult, adjustmentsResult] = await Promise.all([
          api.inventory.getProducts(),
          api.products.getSuppliers(),
          api.products.getDataImports(),
          api.products.getAdjustments()
        ]);
        setData(productsResult);
        setSuppliers(suppliersResult);
        setImports(importsResult);
        setAdjustments(adjustmentsResult);

      } catch (error) {
        console.error("Failed to load products data", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const renderProductsTab = () => (
    <>
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
      
      <div className="prod-main-split">
        <div className="prod-table-area">
          <h2 className="prod-table-title">Monitored SKUs</h2>
          
          <div className="prod-list-header">
            <div className="prod-col-title prod-col-1">SKU ID</div>
            <div className="prod-col-title prod-col-2">PRODUCT NAME</div>
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
                <div className="prod-col-2">{prod.name}</div>
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
            <button className="prod-btn-primary" style={{marginTop: '0.75rem', width: '100%'}}>Update Stock</button>
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
  );

  const renderSuppliersTab = () => (
    <div className="prod-main-split suppliers-view">
      <div className="prod-table-area">
        <div className="suppliers-header-bar">
          <h2 className="prod-table-title" style={{marginBottom: 0}}>Supplier Directory</h2>
          <div style={{display: 'flex', gap: '0.75rem'}}>
            <button className="prod-btn-outline"><Download size={14} style={{marginRight: '4px'}}/> Import CSV</button>
            <button className="prod-btn-primary"><Plus size={14} style={{marginRight: '4px'}}/> Add Supplier</button>
          </div>
        </div>
        
        <div className="suppliers-table">
          <div className="suppliers-thead">
            <div className="col-name">SUPPLIER NAME</div>
            <div className="col-skus">SKUS SUPPLIED</div>
            <div className="col-lead">AVG LEAD TIME</div>
            <div className="col-rel">RELIABILITY SCORE</div>
          </div>
          <div className="suppliers-tbody">
            {suppliers.map((s, i) => (
              <div className={`suppliers-row ${i===0 ? 'active' : ''}`} key={i}>
                <div className="col-name">
                  <div className="supplier-name">{s.name}</div>
                  <div className="supplier-email">{s.email}</div>
                </div>
                <div className="col-skus">{s.skus} active SKUs</div>
                <div className="col-lead">{s.leadTime} days</div>
                <div className="col-rel">
                  <div className="rel-bar-bg">
                    <div className={`rel-bar-fill ${s.reliability < 80 ? 'low' : ''}`} style={{width: `${s.reliability}%`}}></div>
                  </div>
                </div>
                <div className="col-action">
                  <ChevronRight size={18} color="#94a3b8" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="prod-detail-panel supplier-detail">
        <div className="supplier-detail-header">
          <h2 className="prod-detail-title" style={{marginBottom: '0.25rem'}}>Pacifica Footwear Co</h2>
          <span className="status-pill active">ACTIVE PARTNER</span>
        </div>
        
        <div className="supplier-config-section">
          <h4 className="prod-section-title">Contracted Lead Time (Days)</h4>
          <input type="text" className="supplier-input" defaultValue="5" />
          <span className="supplier-input-hint">Default delivery window for all SKUs supplied by Pacifica</span>
        </div>

        <div className="supplier-config-section">
          <h4 className="prod-section-title">Fulfillment Cadence</h4>
          <select className="supplier-select">
            <option>Weekly (Mondays)</option>
          </select>
          <span className="supplier-input-hint">Select the scheduled delivery cadence if applicable</span>
        </div>

        <div className="supplier-config-section">
          <h4 className="prod-section-title">Fulfillment Risk Penalty Factors</h4>
          <p className="supplier-desc">Adjust the penalty multiplier for late deliveries. This affects the safety stock calculation.</p>
          <div className="supplier-slider-container">
            <div className="supplier-slider-labels">
              <span>Low Sensitivity (x1.0)</span>
              <span className="active-val">x1.25</span>
              <span>High Sensitivity (x2.0)</span>
            </div>
            <div className="supplier-slider-track">
              <div className="supplier-slider-fill" style={{width: '25%'}}></div>
              <div className="supplier-slider-thumb" style={{left: '25%'}}></div>
            </div>
          </div>
        </div>

        <div className="supplier-actions">
          <button className="supplier-btn-danger">Remove Supplier</button>
          <button className="prod-btn-primary">Update Rules</button>
        </div>
      </div>
    </div>
  );

  const renderSalesDataTab = () => (
    <div className="sales-data-view">
      <div className="sales-upload-area">
        <div className="upload-box">
          <Upload size={32} color="#94a3b8" style={{marginBottom: '1rem'}} />
          <h3 className="upload-title">Drag & drop historical sales file</h3>
          <p className="upload-desc">Upload CSV or Excel files containing historical sales logs.<br/>Maximum file size: 50MB.</p>
          <button className="prod-btn-outline" style={{marginTop: '1.5rem'}}>Browse Files</button>
        </div>
        <div className="upload-status-card">
          <h4 className="upload-status-title">Active Ingestion Stream</h4>
          <div className="upload-file-name">Q4_2023_Retail_Sales.csv</div>
          <div className="upload-progress-info">
            <span>Uploading... 45%</span>
            <span>2.1 MB / 4.8 MB</span>
          </div>
          <div className="upload-progress-track">
            <div className="upload-progress-fill" style={{width: '45%'}}></div>
          </div>
          <button className="upload-cancel-btn">Cancel Upload</button>
        </div>
      </div>

      <div className="sales-ledger-area">
        <h2 className="prod-table-title" style={{marginBottom: '1.5rem'}}>Fulfillment Ledger & Load Records</h2>
        <table className="ledger-table">
          <thead>
            <tr>
              <th>FILE NAME</th>
              <th>UPLOAD DATE</th>
              <th>RECORDS LOGGED</th>
              <th>INGESTION STATUS</th>
              <th>OPERATOR</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((item, i) => (
              <tr key={i}>
                <td className="fw-600">{item.name}</td>
                <td className="text-secondary">{item.date}</td>
                <td>{item.records}</td>
                <td><span className={`status-pill ${item.status === 'VALIDATED' ? 'success' : 'error'}`}>{item.status}</span></td>
                <td className="text-secondary">{item.operator}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderEventsTab = () => (
    <div className="events-view">
      <div className="events-header">
        <h2 className="events-title">Promotion & Event Calendar</h2>
        <button className="prod-btn-primary"><Plus size={14} style={{marginRight: '4px'}}/> Add Event</button>
      </div>

      <div className="events-main-split">
        <div className="events-calendar-area">
          <div className="calendar-month-nav">
            <button className="cal-nav-btn">&lt;</button>
            <h3 className="cal-month-title">October 2024</h3>
            <button className="cal-nav-btn">&gt;</button>
          </div>
          
          <div className="calendar-grid">
            <div className="cal-day-header">SUN</div>
            <div className="cal-day-header">MON</div>
            <div className="cal-day-header">TUE</div>
            <div className="cal-day-header">WED</div>
            <div className="cal-day-header">THU</div>
            <div className="cal-day-header">FRI</div>
            <div className="cal-day-header">SAT</div>

            {/* Empty days for formatting */}
            <div className="cal-day empty"></div>
            <div className="cal-day empty"></div>
            <div className="cal-day">1</div>
            <div className="cal-day">2</div>
            <div className="cal-day">3</div>
            <div className="cal-day">4</div>
            <div className="cal-day">5</div>
            <div className="cal-day">6</div>
            <div className="cal-day">7</div>
            <div className="cal-day">8</div>
            <div className="cal-day">9</div>
            <div className="cal-day">10</div>
            <div className="cal-day">11</div>
            <div className="cal-day">12</div>
            <div className="cal-day">13</div>
            <div className="cal-day">14</div>
            <div className="cal-day">15</div>
            <div className="cal-day">16</div>
            <div className="cal-day">17</div>
            <div className="cal-day">18</div>
            <div className="cal-day">19</div>
            <div className="cal-day">20</div>
            <div className="cal-day">21</div>
            <div className="cal-day">22</div>
            <div className="cal-day">23</div>
            <div className="cal-day active">24
              <div className="cal-event red">Holiday Spike</div>
            </div>
            <div className="cal-day">25
              <div className="cal-event teal">Promo: Prime Day</div>
            </div>
            <div className="cal-day">26</div>
            <div className="cal-day">27
              <div className="cal-event orange">Special Event</div>
            </div>
            <div className="cal-day">28</div>
            <div className="cal-day">29</div>
            <div className="cal-day">30</div>
            <div className="cal-day">31</div>
          </div>
        </div>

        <div className="prod-detail-panel event-detail">
          <div className="event-detail-header">
            <CalendarIcon size={24} color="#0d9488" style={{marginBottom: '1rem'}} />
            <h2 className="prod-detail-title">Configure Demand Event</h2>
            <p className="prod-detail-subtitle">Add known future demand spikes so the forecasting model can adjust.</p>
          </div>

          <div className="event-form">
            <div className="event-group">
              <label className="event-label">Event Name</label>
              <input type="text" className="event-input" defaultValue="Autumn Flash Clearance" />
            </div>
            
            <div className="event-group">
              <label className="event-label">Classification Type</label>
              <select className="event-select">
                <option>Marketing Promotion</option>
              </select>
            </div>
            
            <div className="event-group">
              <label className="event-label">Expected Ingestion Lift (%)</label>
              <input type="text" className="event-input" defaultValue="+35%" />
            </div>
          </div>

          <div className="event-actions">
            <button className="prod-btn-outline" style={{flex: 1}}>Clear</button>
            <button className="prod-btn-primary" style={{flex: 2}}>Apply Event Lift</button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAdjustmentsTab = () => (
    <div className="adj-view">
      <div className="adj-header-stats">
        <div className="adj-stat-card">
          <span className="adj-stat-title">TOTAL ADJUSTMENTS (MONTH)</span>
          <div className="adj-stat-val-row">
            <h2>142 Runs</h2>
            <span className="adj-stat-badge neutral">Cycle Count Active</span>
          </div>
        </div>
        <div className="adj-stat-card">
          <span className="adj-stat-title">NET INVENTORY CHANGE</span>
          <div className="adj-stat-val-row">
            <h2>+1,420 units</h2>
            <span className="adj-stat-badge success">Healthy Inflow</span>
          </div>
        </div>
        <div className="adj-stat-card">
          <span className="adj-stat-title">MOST ADJUSTED SKU</span>
          <div className="adj-stat-val-row">
            <h2>SKU-8921</h2>
            <span className="adj-stat-badge danger">3 edits this week</span>
          </div>
        </div>
      </div>

      <div className="adj-filters">
        <div className="adj-search-box">
          <Search size={14} color="#94a3b8" />
          <input type="text" placeholder="Search SKU or Product..." />
        </div>
        <select className="adj-select">
          <option>Oct 01 - Oct 24, 2024</option>
        </select>
        <select className="adj-select">
          <option>Adjustment Type: All</option>
        </select>
      </div>

      <div className="adj-table-container">
        <table className="adj-table">
          <thead>
            <tr>
              <th>DATE & TIME</th>
              <th>SKU ID</th>
              <th>PRODUCT NAME</th>
              <th>TYPE</th>
              <th className="text-right">PREV ON-HAND</th>
              <th className="text-right">NEW ON-HAND</th>
              <th className="text-right">CHANGE</th>
              <th>ADJUSTED BY</th>
            </tr>
          </thead>
          <tbody>
            {adjustments.map((adj, i) => (
              <tr key={i}>
                <td className="text-secondary">{adj.date}</td>
                <td className="fw-600">{adj.sku}</td>
                <td>
                  <div className="adj-prod-name">{adj.name}</div>
                  <div className="adj-prod-desc">{adj.desc}</div>
                </td>
                <td>
                  <span className={`adj-type-badge ${adj.type === 'Cycle Count' ? 'blue' : adj.type === 'PO Receipt' ? 'green' : 'orange'}`}>
                    {adj.type}
                  </span>
                </td>
                <td className="text-right">{adj.prev}</td>
                <td className="text-right">{adj.new}</td>
                <td className="text-right">
                  <span className={`adj-change ${adj.change > 0 ? 'pos' : adj.change < 0 ? 'neg' : 'zero'}`}>
                    {adj.change > 0 ? `+${adj.change}` : adj.change}
                  </span>
                </td>
                <td className="text-secondary">{adj.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
        
        <div className="adj-footer">
          <span className="text-secondary">Showing 1 to 8 of 42 entries</span>
          <div className="prod-pagination">
            <button className="page-btn">Previous</button>
            <button className="page-btn active">1</button>
            <button className="page-btn">2</button>
            <button className="page-btn">Next</button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="animate-fade-in mb-6">
      {isLoading || !data ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading products data...</div>
      ) : (
        <>
          <div className="prod-tabs-container">
            {['Products', 'Suppliers', 'Adjustment History', 'Sales Data', 'Events & Promotions'].map(tab => (
              <button 
                key={tab}
                className={`prod-tab-btn ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === 'Products' && renderProductsTab()}
          {activeTab === 'Suppliers' && renderSuppliersTab()}
          {activeTab === 'Adjustment History' && renderAdjustmentsTab()}
          {activeTab === 'Sales Data' && renderSalesDataTab()}
          {activeTab === 'Events & Promotions' && renderEventsTab()}
        </>
      )}
    </div>
  );
};
