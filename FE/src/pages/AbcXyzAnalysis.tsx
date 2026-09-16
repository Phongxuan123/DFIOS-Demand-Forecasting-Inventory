import React from 'react';
import { Search, Bell, Calendar } from 'lucide-react';
import './AbcXyzAnalysis.css';



export const AbcXyzAnalysis: React.FC = () => {
  const [data, setData] = React.useState<any>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const { api } = await import('../services/api.ts');
        const result = await api.inventory.getAbcXyzLogs();
        setData(result);
      } catch (error) {
        console.error("Failed to load ABC/XYZ data", error);
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
        <h1 className="dashboard-title">ABC/XYZ Inventory Analysis Matrix</h1>
        <div className="dashboard-header-actions">
          <div className="search-wrapper">
            <Search size={14} className="search-icon" />
            <input type="text" placeholder="Search products, locations..." className="search-input" />
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
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading matrix data...</div>
      ) : (
        <>
          {/* Top Split Section */}
          <div className="abc-top-split">
            {/* Left: Matrix Grid */}
            <div className="abc-matrix-panel">
              <h2 className="panel-title">ABC/XYZ Classification Matrix</h2>
              <p className="panel-subtitle">ABC determines revenue contribution (Value). XYZ determines forecast predictability (Volatility).</p>
              
              <div className="matrix-grid-container">
                {/* Top row headers */}
                <div></div>
                <div className="matrix-col-header">X (STABLE, COV &lt; 10%)</div>
                <div className="matrix-col-header">Y (VARIABLE, COV 10-25%)</div>
                <div className="matrix-col-header">Z (ERRATIC, COV &gt; 25%)</div>
                
                {/* Row A */}
                <div className="matrix-row-header">A (HIGH VALUE, 70%)</div>
                <div className="matrix-cell cell-ax">
                  <span className="matrix-cell-count">245 SKUs</span>
                  <span className="matrix-cell-pct">8.1%</span>
                  <span className="matrix-cell-label">AX - Deep Strategic</span>
                </div>
                <div className="matrix-cell cell-ay">
                  <span className="matrix-cell-count">124 SKUs</span>
                  <span className="matrix-cell-pct">4.1%</span>
                  <span className="matrix-cell-label">AY - Dynamic</span>
                </div>
                <div className="matrix-cell cell-az">
                  <span className="matrix-cell-count">56 SKUs</span>
                  <span className="matrix-cell-pct">1.8%</span>
                  <span className="matrix-cell-label">AZ - High Volatility</span>
                </div>
                
                {/* Row B */}
                <div className="matrix-row-header">B (MED VALUE, 20%)</div>
                <div className="matrix-cell cell-bx">
                  <span className="matrix-cell-count">480 SKUs</span>
                  <span className="matrix-cell-pct">15.7%</span>
                  <span className="matrix-cell-label">BX - Mid Stable</span>
                </div>
                <div className="matrix-cell cell-by">
                  <span className="matrix-cell-count">310 SKUs</span>
                  <span className="matrix-cell-pct">10.2%</span>
                  <span className="matrix-cell-label">BY - Mid Dynamic</span>
                </div>
                <div className="matrix-cell cell-bz">
                  <span className="matrix-cell-count">112 SKUs</span>
                  <span className="matrix-cell-pct">3.7%</span>
                  <span className="matrix-cell-label">BZ - Seasonal</span>
                </div>
                
                {/* Row C */}
                <div className="matrix-row-header">C (LOW VALUE, 10%)</div>
                <div className="matrix-cell cell-cx">
                  <span className="matrix-cell-count">980 SKUs</span>
                  <span className="matrix-cell-pct">32.1%</span>
                  <span className="matrix-cell-label">CX - Basic Repeat</span>
                </div>
                <div className="matrix-cell cell-cy">
                  <span className="matrix-cell-count">512 SKUs</span>
                  <span className="matrix-cell-pct">16.8%</span>
                  <span className="matrix-cell-label">CY - Basic Variable</span>
                </div>
                <div className="matrix-cell cell-cz">
                  <span className="matrix-cell-count">230 SKUs</span>
                  <span className="matrix-cell-pct">7.5%</span>
                  <span className="matrix-cell-label">CZ - Extreme Long-Tail</span>
                </div>
              </div>
            </div>
            
            {/* Right: Policy Allocation */}
            <div className="abc-policy-panel">
              <h2 className="panel-title" style={{marginBottom: '1.5rem'}}>Strategic Policy Allocation</h2>
              
              <div className="policy-card">
                <div className="policy-card-header">
                  <span className="policy-card-title">AX / AY Policies</span>
                  <span className="policy-badge badge-green">TOP STRATEGIC</span>
                </div>
                <p className="policy-desc">Keep tight safety stocks, run automated daily replenishment, perform high-frequency collaborative forecasting.</p>
              </div>
              
              <div className="policy-card">
                <div className="policy-card-header">
                  <span className="policy-card-title">AZ / BZ Policies</span>
                  <span className="policy-badge badge-orange">VOLATILE VALUE</span>
                </div>
                <p className="policy-desc">Employ dynamic buffer calculations, set up seasonal alerts, and secure lead-time speed SLAs with suppliers.</p>
              </div>
              
              <div className="policy-card">
                <div className="policy-card-header">
                  <span className="policy-card-title">CX / CY / CZ Policies</span>
                  <span className="policy-badge badge-grey">BULK AUTOMATION</span>
                </div>
                <p className="policy-desc">Establish simplified visual Kanban controls, run slow monthly batch reorders, maintain baseline safety stock.</p>
              </div>
            </div>
          </div>

          {/* Bottom Log Table */}
          <div className="log-panel">
            <h2 className="log-title">SKU Classification & Recommended Policy Log</h2>
            
            <div className="log-table">
              <div className="log-header-row">
                <div className="log-col-header log-col-1">SKU ID</div>
                <div className="log-col-header log-col-2">PRODUCT NAME</div>
                <div className="log-col-header log-col-3">ABC CLASS</div>
                <div className="log-col-header log-col-4">XYZ CLASS</div>
                <div className="log-col-header log-col-5">COMBINED CLASS</div>
                <div className="log-col-header log-col-6">ANNUAL REVENUE</div>
                <div className="log-col-header log-col-7">COV VOLATILITY</div>
                <div className="log-col-header log-col-8">RECOMMENDED POLICY</div>
              </div>
              
              <div>
                {data.logs.map((row: any, idx: number) => (
                  <div className="log-row" key={idx}>
                    <div className="log-col-1">{row.id}</div>
                    <div className="log-col-2">{row.name}</div>
                    <div className="log-col-3">
                      <span className={row.classA === 'A' ? 'text-class-a' : row.classA === 'B' ? 'text-class-b' : 'text-class-c'}>{row.classA}</span>
                    </div>
                    <div className="log-col-4">
                      <span className={row.classX === 'X' ? 'text-class-x' : row.classX === 'Y' ? 'text-class-y' : 'text-class-z'}>{row.classX}</span>
                    </div>
                    <div className="log-col-5">{row.combined}</div>
                    <div className="log-col-6">{row.rev}</div>
                    <div className="log-col-7">{row.cov}</div>
                    <div className="log-col-8">{row.policy}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
