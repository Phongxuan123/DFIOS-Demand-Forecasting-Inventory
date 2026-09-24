import React from 'react';
import { Settings } from 'lucide-react';
import './AbcXyzAnalysis.css';

export const AbcXyzAnalysis: React.FC = () => {
  const [data, setData] = React.useState<any>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isConfigOpen, setIsConfigOpen] = React.useState(false);

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

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading matrix data...</div>
      ) : (
        <>
          {/* Top Section */}
          <div className="abc-matrix-panel">
            <div className="abc-matrix-header">
              <div>
                <h2 className="panel-title">ABC/XYZ Classification Matrix</h2>
                <p className="panel-subtitle">ABC determines revenue contribution (Value). XYZ determines forecast predictability (Volatility).</p>
              </div>
              <button className="configure-btn" onClick={() => setIsConfigOpen(true)}>
                <Settings size={14} style={{marginRight: '8px'}} /> Configure Thresholds
              </button>
            </div>
            
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
                      <span className={row.classX === 'X' ? 'text-class-a' : row.classX === 'Y' ? 'text-class-b' : 'text-class-c'}>{row.classX}</span>
                    </div>
                    <div className="log-col-5">{row.combined}</div>
                    <div className="log-col-6">{row.rev}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Modal Overlay */}
          {isConfigOpen && (
            <div className="config-modal-overlay" onClick={() => setIsConfigOpen(false)}>
              
              {/* Centered Modal */}
              <div className="config-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h3 className="modal-title">ABC/XYZ Threshold Configuration</h3>
                  <p className="modal-subtitle">Recalculation will update classification for all 3,049 SKUs</p>
                </div>
                
                <div className="modal-body">
                  <h4 className="threshold-section-title">ABC Thresholds</h4>
                  
                  <div className="slider-group">
                    <div className="slider-label-row">
                      <span className="slider-label">A (High Value)</span>
                      <span className="slider-value">Top 70%</span>
                    </div>
                    <div className="slider-track bg-teal-100">
                      <div className="slider-fill bg-teal-600" style={{width: '70%'}}></div>
                      <div className="slider-thumb" style={{left: '70%'}}></div>
                    </div>
                  </div>
                  
                  <div className="slider-group">
                    <div className="slider-label-row">
                      <span className="slider-label">B (Medium Value)</span>
                      <span className="slider-value">Next 20%</span>
                    </div>
                    <div className="slider-track bg-orange-100">
                      <div className="slider-fill bg-orange-500" style={{width: '20%'}}></div>
                      <div className="slider-thumb" style={{left: '20%'}}></div>
                    </div>
                  </div>
                  
                  <div className="slider-group">
                    <div className="slider-label-row">
                      <span className="slider-label">C (Low Value)</span>
                      <span className="slider-value">Remaining 10%</span>
                    </div>
                    <div className="slider-track bg-slate-200">
                      <div className="slider-fill bg-slate-500" style={{width: '10%'}}></div>
                      <div className="slider-thumb" style={{left: '10%'}}></div>
                    </div>
                  </div>
                  
                  <h4 className="threshold-section-title mt-8">XYZ Thresholds</h4>
                  
                  <div className="slider-group">
                    <div className="slider-label-row">
                      <span className="slider-label">X (Stable)</span>
                      <span className="slider-value">COV &lt; 10%</span>
                    </div>
                    <div className="slider-track bg-teal-100">
                      <div className="slider-fill bg-teal-600" style={{width: '10%'}}></div>
                      <div className="slider-thumb" style={{left: '10%'}}></div>
                    </div>
                  </div>
                  
                  <div className="slider-group">
                    <div className="slider-label-row">
                      <span className="slider-label">Y (Variable)</span>
                      <span className="slider-value">COV 10% - 25%</span>
                    </div>
                    <div className="slider-track bg-orange-100">
                      <div className="slider-fill bg-orange-500" style={{width: '15%'}}></div>
                      <div className="slider-thumb" style={{left: '15%'}}></div>
                    </div>
                  </div>
                  
                  <div className="slider-group">
                    <div className="slider-label-row">
                      <span className="slider-label">Z (Erratic)</span>
                      <span className="slider-value">COV &gt; 25%</span>
                    </div>
                    <div className="slider-track bg-slate-200">
                      <div className="slider-fill bg-slate-500" style={{width: '75%'}}></div>
                      <div className="slider-thumb" style={{left: '75%'}}></div>
                    </div>
                  </div>
                </div>
                
                <div className="modal-footer">
                  <div className="modal-actions">
                    <button className="reset-btn" onClick={() => setIsConfigOpen(false)}>Reset to Default</button>
                    <button className="apply-btn" onClick={() => setIsConfigOpen(false)}>Apply & Recalculate</button>
                  </div>
                  <p className="modal-footer-text">Recalculation will update classification for all 3,049 SKUs</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
