import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Play, RefreshCw, X } from 'lucide-react';
import { ScatterChart, Scatter, LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useAuth } from '../context/AuthContext.tsx';
import { api } from '../services/api.ts';
import './ModelPerformance.css';

export const ModelPerformance: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN';

  const [activeTab, setActiveTab] = useState('Performance Metrics');
  const [data, setData] = useState<any>(null);
  const [costData, setCostData] = useState<any>(null);
  const [trainingJobs, setTrainingJobs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Train Model Modal
  const [isTrainModalOpen, setIsTrainModalOpen] = useState(false);
  const [trainAlgorithm, setTrainAlgorithm] = useState('lightgbm');
  const [trainTestDays, setTrainTestDays] = useState(28);
  const [trainSkuList, setTrainSkuList] = useState('');
  const [isSubmittingTrain, setIsSubmittingTrain] = useState(false);
  const [trainMessage, setTrainMessage] = useState('');
  const [trainError, setTrainError] = useState('');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [perfResult, costResult, jobsResult] = await Promise.all([
        api.models.getPerformanceMetrics(),
        api.models.getCostSimulation(),
        api.ml.listTrainJobs().catch(() => ({ list: [], total: 0 })),
      ]);
      setData(perfResult);
      setCostData(costResult);
      setTrainingJobs(jobsResult.list || []);
    } catch (error) {
      console.error('Failed to load model data', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (user && !isAdmin) {
    return (
      <div className="p-8 text-center" style={{ marginTop: '20px' }}>
        <h2>Access Denied</h2>
        <p>You do not have permission to view Model Performance (Admin only).</p>
      </div>
    );
  }

  const handleStartTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingTrain(true);
    setTrainMessage('');
    setTrainError('');
    try {
      const skuArray = trainSkuList.trim()
        ? trainSkuList.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;

      const res = await api.ml.train({
        algorithm: trainAlgorithm,
        test_days: Number(trainTestDays),
        sku_list: skuArray,
      });

      setTrainMessage(`Training job created successfully! Job ID: ${res.job_id || res.id || 'OK'} (Status: ${res.status || 'Pending'})`);
      await loadData();
      setTimeout(() => {
        setIsTrainModalOpen(false);
        setTrainMessage('');
      }, 1500);
    } catch (err: any) {
      setTrainError(err.response?.data?.detail || 'Training failed to start.');
    } finally {
      setIsSubmittingTrain(false);
    }
  };

  const handlePromoteModel = async (modelId: string) => {
    if (!window.confirm('Are you sure you want to promote this model to Champion / Production status?')) return;
    try {
      await api.ml.promoteModel(modelId);
      alert('Model promoted to Production successfully!');
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to promote model');
    }
  };

  const renderPerformanceTab = () => (
    <>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Model Registry & Benchmarking</h2>
          <span className="text-xs text-slate-500">Compare active models against production benchmark</span>
        </div>
        <div className="flex gap-2">
          <button className="train-model-btn" onClick={() => setIsTrainModalOpen(true)}>
            <Play size={14} style={{ marginRight: '6px', fill: 'currentColor' }} /> Train New Model
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="mp-kpi-grid">
        {(data?.kpis || []).map((kpi: any, idx: number) => {
          const isProd = kpi.isProduction || kpi.type === 'best';
          return (
            <div className={`mp-kpi-card ${isProd ? 'active-model' : ''}`} key={idx}>
              <div className="mp-kpi-header">
                <div>
                  <h3 className="mp-kpi-title">{kpi.title}</h3>
                  {kpi.algorithm && <span className="text-xs text-slate-400 block mt-0.5">Algorithm: {kpi.algorithm}</span>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`mp-badge ${isProd ? 'best' : 'challenger'}`}>
                    {isProd ? 'PRODUCTION CHAMPION' : 'CHALLENGER'}
                  </span>
                  {!isProd && kpi.id && (
                    <button
                      className="text-xs text-teal-700 hover:text-teal-900 font-bold underline mt-1"
                      onClick={() => handlePromoteModel(kpi.id)}
                      title="Promote to Production"
                    >
                      Promote to Prod
                    </button>
                  )}
                </div>
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
          );
        })}
      </div>

      {/* Training History Panel */}
      {trainingJobs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-slate-800 text-sm">Recent ML Training Jobs</h3>
            <button className="text-xs text-teal-600 hover:text-teal-800 flex items-center gap-1" onClick={loadData}>
              <RefreshCw size={12} /> Refresh Status
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-left">
                  <th className="py-2">JOB ID</th>
                  <th className="py-2">ALGORITHM</th>
                  <th className="py-2">STATUS</th>
                  <th className="py-2">CREATED AT</th>
                  <th className="py-2 text-right">MAE</th>
                  <th className="py-2 text-right">RMSE</th>
                  <th className="py-2 text-right">WRMSSE</th>
                </tr>
              </thead>
              <tbody>
                {trainingJobs.slice(0, 5).map((job: any) => (
                  <tr key={job.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 font-mono">{job.id?.slice(0, 8)}...</td>
                    <td className="py-2 font-semibold uppercase">{job.algorithm}</td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        job.status === 'done' || job.status === 'completed' ? 'bg-teal-100 text-teal-800' :
                        job.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="py-2 text-slate-500">{job.created_at ? new Date(job.created_at).toLocaleString() : '-'}</td>
                    <td className="py-2 text-right">{job.metrics?.mae != null ? Number(job.metrics.mae).toFixed(2) : '-'}</td>
                    <td className="py-2 text-right">{job.metrics?.rmse != null ? Number(job.metrics.rmse).toFixed(2) : '-'}</td>
                    <td className="py-2 text-right">{job.metrics?.wrmsse != null ? Number(job.metrics.wrmsse).toFixed(2) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Middle Split */}
      <div className="mp-middle-split">
        {/* Left: Accuracy Comparison */}
        <div className="mp-acc-panel">
          <h2 className="mp-panel-title">Accuracy Metric Comparison</h2>
          <div style={{ height: '250px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="acc-metric-group">
              <div className="acc-metric-title">MASE (Lower is Better)</div>
              <div className="acc-bars">
                <div className="acc-bar-item">
                  <div className="acc-bar-bg" style={{ width: '180px' }}></div>
                  <span className="acc-bar-label">Baseline Naive (1.12)</span>
                </div>
                <div className="acc-bar-item">
                  <div className="acc-bar-bg" style={{ width: '130px' }}></div>
                  <span className="acc-bar-label">XGBoost Challenger (0.78)</span>
                </div>
                <div className="acc-bar-item">
                  <div className="acc-bar-bg" style={{ width: '100px', backgroundColor: '#0d9488' }}></div>
                  <span className="acc-bar-label font-bold text-teal">LightGBM Champion (0.64)</span>
                </div>
              </div>
            </div>

            <div className="acc-metric-group">
              <div className="acc-metric-title">MAE (Scaled Error)</div>
              <div className="acc-bars">
                <div className="acc-bar-item">
                  <div className="acc-bar-bg" style={{ width: '140px' }}></div>
                  <span className="acc-bar-label">Baseline (6.7)</span>
                </div>
                <div className="acc-bar-item">
                  <div className="acc-bar-bg" style={{ width: '100px' }}></div>
                  <span className="acc-bar-label">XGBoost (4.4)</span>
                </div>
                <div className="acc-bar-item">
                  <div className="acc-bar-bg" style={{ width: '85px', backgroundColor: '#0d9488' }}></div>
                  <span className="acc-bar-label font-bold text-teal">LightGBM (3.9)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Residual Scatter */}
        <div className="mp-resid-panel">
          <h2 className="mp-panel-title">Residual Diagnostic Scatter</h2>
          <div style={{ height: '250px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <XAxis type="number" dataKey="x" name="Actual Demand" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis type="number" dataKey="y" name="Predicted Demand" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <ReferenceLine stroke="#e2e8f0" strokeDasharray="3 3" />
                <Scatter name="Residuals" data={data?.scatterData || []} fill="#0d9488" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  );

  const renderCostSimulatorTab = () => (
    <div className="cost-sim-layout">
      {/* Left side: Inputs */}
      <div className="cost-sim-controls">
        <h2 className="mp-panel-title mb-4">Simulation Parameters</h2>
        <div className="sim-input-group">
          <label className="sim-label">Target Product Segment</label>
          <select className="sim-select">
            <option>All SKUs (Global)</option>
            <option>Segment AX (High Value Stable)</option>
            <option>Segment AY (High Value Variable)</option>
          </select>
        </div>

        <div className="sim-input-group">
          <div className="flex justify-between mb-2">
            <label className="sim-label">Service Level Target</label>
            <span className="sim-value-text text-teal">98.0%</span>
          </div>
          <div className="sim-slider-track">
            <div className="sim-slider-fill" style={{ width: '75%' }}></div>
          </div>
        </div>

        <div className="sim-input-group">
          <div className="flex justify-between mb-2">
            <label className="sim-label">Expected Lead Time</label>
            <span className="sim-value-text text-teal">7 Days</span>
          </div>
          <div className="sim-slider-track">
            <div className="sim-slider-fill" style={{ width: '40%' }}></div>
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
          <div style={{ height: '250px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={costData?.chartData || []} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <XAxis dataKey="sl" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} dy={10} />
                <Line type="monotone" dataKey="cost" stroke="#0d9488" strokeWidth={2} dot={{ r: 4, fill: '#0d9488' }} />
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
                <td className="text-right fw-500">{costData?.currentPolicy?.holding || '-'}</td>
                <td className="text-right fw-500">{costData?.simulatedPolicy?.holding || '-'}</td>
                <td className="text-right"><span className="text-red fw-600">{costData?.delta?.holding || '-'}</span></td>
              </tr>
              <tr>
                <td className="text-secondary">Stockout Cost (Expected)</td>
                <td className="text-right fw-500">{costData?.currentPolicy?.stockout || '-'}</td>
                <td className="text-right fw-500">{costData?.simulatedPolicy?.stockout || '-'}</td>
                <td className="text-right"><span className="text-green fw-600">{costData?.delta?.stockout || '-'}</span></td>
              </tr>
              <tr>
                <td className="fw-600">Total Annual Costs</td>
                <td className="text-right fw-700">{costData?.currentPolicy?.total || '-'}</td>
                <td className="text-right fw-700">{costData?.simulatedPolicy?.total || '-'}</td>
                <td className="text-right"><span className="text-green fw-600">{costData?.delta?.total || '-'}</span></td>
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
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading model metrics...</div>
      ) : (
        <>
          {activeTab === 'Performance Metrics' && renderPerformanceTab()}
          {activeTab === 'Cost Simulator' && renderCostSimulatorTab()}
        </>
      )}

      {/* Train New Model Modal */}
      {isTrainModalOpen && createPortal(
        <div className="modal-overlay" onClick={() => setIsTrainModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setIsTrainModalOpen(false)}><X size={16} /></button>
            <h2 className="modal-title">Train & Benchmark Model</h2>
            <p className="modal-subtitle">
              Configure and run asynchronous ML model training with Walmart M5 benchmark metrics (MAE, RMSE, WRMSSE).
            </p>

            {trainError && (
              <div className="p-3 my-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded">
                {trainError}
              </div>
            )}
            {trainMessage && (
              <div className="p-3 my-3 text-xs bg-teal-50 border border-teal-200 text-teal-800 rounded">
                {trainMessage}
              </div>
            )}

            <form onSubmit={handleStartTraining}>
              <div className="modal-form-group mt-4">
                <label>Forecasting Algorithm</label>
                <select
                  className="modal-select"
                  value={trainAlgorithm}
                  onChange={(e) => setTrainAlgorithm(e.target.value)}
                >
                  <option value="lightgbm">LightGBM (Gradient Boosting)</option>
                  <option value="xgboost">XGBoost (Extreme Gradient Boosting)</option>
                  <option value="baseline_naive">Baseline Naive (Statistical)</option>
                </select>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  LightGBM & XGBoost use calendar event covariates and temporal split.
                </span>
              </div>

              <div className="modal-form-group">
                <label>Test Horizon Evaluation Days</label>
                <select
                  className="modal-select"
                  value={trainTestDays}
                  onChange={(e) => setTrainTestDays(Number(e.target.value))}
                >
                  <option value={28}>28 Days (Default standard)</option>
                  <option value={14}>14 Days</option>
                  <option value={7}>7 Days</option>
                </select>
              </div>

              <div className="modal-form-group">
                <label>Specific SKU Filter (Optional)</label>
                <input
                  type="text"
                  className="modal-input"
                  placeholder="e.g. SKU-8921, SKU-1044 (leave blank for all)"
                  value={trainSkuList}
                  onChange={(e) => setTrainSkuList(e.target.value)}
                />
              </div>

              <div className="modal-info-banner">
                <div className="banner-dot"></div>
                <span>Job runs asynchronously in the background. Metrics will be logged to Model Registry upon completion.</span>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-btn-cancel"
                  onClick={() => setIsTrainModalOpen(false)}
                  disabled={isSubmittingTrain}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modal-btn-apply"
                  disabled={isSubmittingTrain}
                >
                  {isSubmittingTrain ? 'Starting Training Job...' : 'Start Training'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
