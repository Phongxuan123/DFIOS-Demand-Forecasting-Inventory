import React, { useState, useEffect } from 'react';
import { Play, Search } from 'lucide-react';
import { ScatterChart, Scatter, LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts';
import './ModelPerformance.css';

export const ModelPerformance: React.FC = () => {
  const [activeTab, setActiveTab] = useState('Performance Metrics');
  const [data, setData] = useState<any>(null);
  const [costData, setCostData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { api } = await import('../services/api.ts');
        const [perfResult, costResult] = await Promise.all([
          api.models.getPerformanceMetrics(),
          api.models.getCostSimulation()
        ]);
        setData(perfResult);
        setCostData(costResult);
      } catch (error) {
        console.error("Failed to load model data", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const renderPerformanceTab = () => (
    <>
      <div className="flex justify-end mb-4">
        <button className="train-model-btn">
          <Play size={14} style={{marginRight: '6px', fill: 'currentColor'}} /> Train New Model
        </button>
      </div>
      {/* KPI Cards */}
      <div className="mp-kpi-grid">
        {data.kpis.map((kpi: any, idx: number) => (
          <div className={`mp-kpi-card ${kpi.type === 'best' ? 'active-model' : ''}`} key={idx}>
            <div className="mp-kpi-header">
              <h3 className="mp-kpi-title">{kpi.title}</h3>
              <span className={`mp-badge ${kpi.type}`}>
                {kpi.type === 'baseline' ? 'BASELINE' : kpi.type === 'challenger' ? 'CHALLENGER' : 'BEST ACTIVE MODEL'}
              </span>
            </div>
            <div className="mp-metrics-row">
              <div className="mp-metric-item">
                <span className="mp-metric-label">MASE</span>
                <span className="mp-metric-value">{kpi.metrics.mase}</span>
              </div>
              <div className="mp-metric-item">
                <span className="mp-metric-label">RMSE</span>
                <span className="mp-metric-value">{kpi.metrics.rmse}</span>
              </div>
              <div className="mp-metric-item">
                <span className="mp-metric-label">MAE</span>
                <span className="mp-metric-value">{kpi.metrics.mae}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Middle Split */}
      <div className="mp-middle-split">
        {/* Left: Accuracy Comparison */}
        <div className="mp-acc-panel">
          <h2 className="mp-panel-title">Accuracy Metric Comparison</h2>
          <div style={{height: '250px', display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
            <div className="acc-metric-group">
              <div className="acc-metric-title">MASE (Lower is Better)</div>
              <div className="acc-bars">
                <div className="acc-bar-item">
                  <div className="acc-bar-bg"></div>
                  <span className="acc-bar-label">Baseline</span>
                </div>
                <div className="acc-bar-item">
                  <div className="acc-bar-bg"></div>
                  <span className="acc-bar-label">Challenger</span>
                </div>
                <div className="acc-bar-item">
                  <div className="acc-bar-bg"></div>
                  <span className="acc-bar-label">TFT Model</span>
                </div>
              </div>
            </div>
            
            <div className="acc-metric-group">
              <div className="acc-metric-title">MAE (Scaled Value)</div>
              <div className="acc-bars">
                <div className="acc-bar-item">
                  <div className="acc-bar-bg" style={{width: '120px'}}></div>
                  <span className="acc-bar-label">Baseline</span>
                </div>
                <div className="acc-bar-item">
                  <div className="acc-bar-bg" style={{width: '90px'}}></div>
                  <span className="acc-bar-label">Challenger</span>
                </div>
                <div className="acc-bar-item">
                  <div className="acc-bar-bg" style={{width: '60px'}}></div>
                  <span className="acc-bar-label">TFT Model</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Residual Distribution */}
        <div className="mp-resid-panel">
          <h2 className="mp-panel-title">TFT Predictions Residual Distribution</h2>
          <p className="mp-panel-subtitle">Target baseline 45-degree angle represents zero variance residual accuracy.</p>
          
          <div style={{ height: '220px', backgroundColor: '#f8fafc', borderRadius: '0.5rem', padding: '1rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <XAxis type="number" dataKey="x" hide domain={[0, 6]} />
                <YAxis type="number" dataKey="y" hide domain={[0, 6]} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 5, y: 5 }]} stroke="#94a3b8" strokeDasharray="3 3" />
                {data.scatterData.map((point: any, index: number) => (
                  <Scatter key={index} data={[point]} fill={point.fill} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom SHAP Values */}
      <div className="mp-shap-panel">
        <h2 className="mp-panel-title">TFT Global Feature Importance (SHAP Values)</h2>
        <p className="mp-panel-subtitle" style={{marginBottom: 0}}>Measures the positive or negative attribution impact of core features on 28-day predictive demand outputs.</p>
        
        <div className="shap-list">
          {data.shapValues.map((item: any, idx: number) => (
            <div className="shap-item" key={idx}>
              <div className="shap-label">{item.feature}</div>
              <div className="shap-bar-container">
                <div className="shap-bar" style={{ width: item.pct }}></div>
              </div>
              <div className="shap-value">{item.val} SHAP</div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Bottom Table: ML vs Static Comparison */}
      <div className="mp-comparison-panel">
        <h2 className="mp-panel-title">ML vs Static Formula Comparison</h2>
        <p className="mp-panel-subtitle">Compare the active TFT model against a static moving average baseline for downstream inventory planning outputs.</p>
        
        <div className="comp-table-container">
          <table className="comp-table">
            <thead>
              <tr>
                <th>INVENTORY METRIC</th>
                <th>STATIC (MOVING AVG)</th>
                <th>ML (TFT MODEL)</th>
                <th>DELTA / IMPACT</th>
              </tr>
            </thead>
            <tbody>
              {data.comparisonTable.map((row: any, i: number) => (
                <tr key={i}>
                  <td className="fw-500">{row.metric}</td>
                  <td>{row.static}</td>
                  <td className="fw-600">{row.ml}</td>
                  <td>
                    <span className={`comp-delta pos`}>{row.improvement}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  const renderCostSimulatorTab = () => (
    <div className="cost-sim-layout">
      {/* Left sidebar: Inputs */}
      <div className="cost-sim-inputs">
        <h2 className="mp-panel-title">Simulation Inputs</h2>
        
        <div className="sim-input-group mt-6">
          <label className="sim-label">Target SKU scope</label>
          <select className="sim-select">
            <option>All SKUs (Global)</option>
          </select>
        </div>
        
        <div className="sim-input-group">
          <div className="flex justify-between mb-2">
            <label className="sim-label">Service Level Target</label>
            <span className="sim-value-text text-teal">98.0%</span>
          </div>
          <div className="sim-slider-track">
            <div className="sim-slider-fill" style={{width: '75%'}}></div>
          </div>
        </div>

        <div className="sim-input-group">
          <div className="flex justify-between mb-2">
            <label className="sim-label">Expected Lead Time</label>
            <span className="sim-value-text text-teal">7 Days</span>
          </div>
          <div className="sim-slider-track">
            <div className="sim-slider-fill" style={{width: '40%'}}></div>
          </div>
        </div>

        <div className="sim-input-group">
          <label className="sim-label">Annual Holding Cost Rate</label>
          <input type="text" className="sim-input" defaultValue="22%" />
        </div>

        <div className="sim-input-group">
          <label className="sim-label">Fixed Ordering Cost ($)</label>
          <input type="text" className="sim-input" defaultValue="$50.00" />
        </div>

        <button className="sim-run-btn mt-4">Run Cost Simulation</button>
      </div>

      {/* Right side: Outputs */}
      <div className="cost-sim-outputs">
        <div className="cost-sim-chart-panel mb-6">
          <h2 className="mp-panel-title mb-4">Total Expected Annual Cost vs. Target Service Level</h2>
          <div style={{height: '250px'}}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={costData.chartData} margin={{top: 20, right: 20, bottom: 20, left: 20}}>
                <XAxis dataKey="sl" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} dy={10} />
                <Line type="monotone" dataKey="cost" stroke="#0d9488" strokeWidth={2} dot={{r: 4, fill: '#0d9488'}} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="cost-sim-table-panel">
          <h2 className="mp-panel-title mb-4">Policy Cost Comparison Summary</h2>
          <table className="sim-table">
            <thead>
              <tr>
                <th>Cost Category</th>
                <th className="text-right">Current Policy (95%)</th>
                <th className="text-right">Simulated Policy (98%)</th>
                <th className="text-right">Delta %</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-secondary">Annual Holding Cost</td>
                <td className="text-right fw-500">{costData.currentPolicy.holding}</td>
                <td className="text-right fw-500">{costData.simulatedPolicy.holding}</td>
                <td className="text-right"><span className="text-red fw-600">{costData.delta.holding}</span></td>
              </tr>
              <tr>
                <td className="text-secondary">Stockout Cost (Expected)</td>
                <td className="text-right fw-500">{costData.currentPolicy.stockout}</td>
                <td className="text-right fw-500">{costData.simulatedPolicy.stockout}</td>
                <td className="text-right"><span className="text-green fw-600">{costData.delta.stockout}</span></td>
              </tr>
              <tr>
                <td className="fw-600">Total Annual Costs</td>
                <td className="text-right fw-700">{costData.currentPolicy.total}</td>
                <td className="text-right fw-700">{costData.simulatedPolicy.total}</td>
                <td className="text-right"><span className="text-green fw-600">{costData.delta.total}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <div className="animate-fade-in mb-6">
      <div className="mp-header-area">
        <h1 className="mp-page-title">{activeTab === 'Cost Simulator' ? 'Cost Sensitivity Simulator' : 'Model Performance & Diagnostics'}</h1>
        {activeTab === 'Cost Simulator' && (
          <div className="rep-search-box">
            <Search size={14} color="#94a3b8" />
            <input type="text" placeholder="Search products, audits, SKU..." />
          </div>
        )}
      </div>

      <div className="mp-tabs">
        <button 
          className={`mp-tab-btn ${activeTab === 'Performance Metrics' ? 'active' : ''}`}
          onClick={() => setActiveTab('Performance Metrics')}
        >
          Performance Metrics
        </button>
        <button 
          className={`mp-tab-btn ${activeTab === 'Cost Simulator' ? 'active' : ''}`}
          onClick={() => setActiveTab('Cost Simulator')}
        >
          Cost Simulator
        </button>
      </div>

      {isLoading || !data || !costData ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading data...</div>
      ) : (
        <>
          {activeTab === 'Performance Metrics' && renderPerformanceTab()}
          {activeTab === 'Cost Simulator' && renderCostSimulatorTab()}
        </>
      )}
    </div>
  );
};
