import React from 'react';
import { Search, Bell, Calendar } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts';
import './ModelPerformance.css';



export const ModelPerformance: React.FC = () => {
  const [data, setData] = React.useState<any>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const { api } = await import('../services/api.ts');
        const result = await api.models.getPerformanceMetrics();
        setData(result);
      } catch (error) {
        console.error("Failed to load model performance data", error);
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
        <h1 className="dashboard-title">Forecast Machine Learning Model Performance</h1>
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
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading model performance data...</div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
};
