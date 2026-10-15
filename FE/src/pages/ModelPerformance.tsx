import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  RefreshCw,
  X,
  DollarSign,
  Package,
  AlertTriangle,
  Sliders,
  ShieldCheck,
} from 'lucide-react';
import { ScatterChart, Scatter, LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useAuth } from '../context/AuthContext.tsx';
import { api } from '../services/api.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import './ModelPerformance.css';

export const ModelPerformance: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role?.toUpperCase() === 'ADMIN';

  const [activeTab, setActiveTab] = useState('Performance Metrics');
  const [data, setData] = useState<any>(null);
  const [costData, setCostData] = useState<any>(null);
  const [trainingJobs, setTrainingJobs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Simulation Interactive Parameters
  const [simSegment, setSimSegment] = useState('All SKUs (Global)');
  const [simServiceLevel, setSimServiceLevel] = useState(98);
  const [simLeadTime, setSimLeadTime] = useState(7);
  const [simHoldingRate, setSimHoldingRate] = useState(22);
  const [simOrderCost, setSimOrderCost] = useState(50);

  // Training Jobs Pagination
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsPerPage, setJobsPerPage] = useState(5);

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
        api.ml.listAllTrainJobs().catch(() => ({ list: [], total: 0 })),
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

  // Derived Paginated Jobs
  const paginatedJobs = useMemo(() => {
    const start = (jobsPage - 1) * jobsPerPage;
    return trainingJobs.slice(start, start + jobsPerPage);
  }, [trainingJobs, jobsPage, jobsPerPage]);

  // Derived Dynamic Simulation Calculations
  const simMetrics = useMemo(() => {
    const baseHolding = 3500;
    const baseStockout = 2500;
    const baseTotal = 6000;

    const zFactor = Math.pow(simServiceLevel / 95, 2.8);
    const ltFactor = Math.sqrt(simLeadTime / 7);
    const holdingRateFactor = simHoldingRate / 22;

    const simHolding = Math.round(baseHolding * zFactor * ltFactor * holdingRateFactor);
    const stockoutFactor = Math.max(0.04, Math.pow((100 - simServiceLevel) / 5, 1.4));
    const simStockout = Math.round(baseStockout * stockoutFactor * ltFactor);
    const simTotal = simHolding + simStockout;

    const netVariance = simTotal - baseTotal;
    const netVariancePct = Number(((netVariance / baseTotal) * 100).toFixed(1));

    const holdingDelta = simHolding - baseHolding;
    const holdingDeltaPct = Number(((holdingDelta / baseHolding) * 100).toFixed(1));

    const stockoutDelta = simStockout - baseStockout;
    const stockoutDeltaPct = Number(((stockoutDelta / baseStockout) * 100).toFixed(1));

    const holdingShare = Math.round((simHolding / simTotal) * 100);
    const stockoutShare = 100 - holdingShare;

    return {
      baseHolding,
      baseStockout,
      baseTotal,
      simHolding,
      simStockout,
      simTotal,
      netVariance,
      netVariancePct,
      holdingDelta,
      holdingDeltaPct,
      stockoutDelta,
      stockoutDeltaPct,
      holdingShare,
      stockoutShare,
      isSaving: netVariance <= 0,
    };
  }, [simServiceLevel, simLeadTime, simHoldingRate, simOrderCost]);

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
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Recent ML Training Jobs</h3>
              <span className="text-xs text-slate-500">Historical model training runs and evaluation scores</span>
            </div>
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
                {paginatedJobs.map((job: any) => (
                  <tr key={job.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 font-mono font-medium text-slate-800">{job.id?.slice(0, 8)}...</td>
                    <td className="py-2 font-semibold uppercase text-slate-700">{job.algorithm}</td>
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
                    <td className="py-2 text-right font-mono">{job.metrics?.mae != null ? Number(job.metrics.mae).toFixed(2) : '-'}</td>
                    <td className="py-2 text-right font-mono">{job.metrics?.rmse != null ? Number(job.metrics.rmse).toFixed(2) : '-'}</td>
                    <td className="py-2 text-right font-mono">{job.metrics?.wrmsse != null ? Number(job.metrics.wrmsse).toFixed(2) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={jobsPage}
            totalItems={trainingJobs.length}
            pageSize={jobsPerPage}
            onPageChange={setJobsPage}
            onPageSizeChange={(newSize) => {
              setJobsPerPage(newSize);
              setJobsPage(1);
            }}
            pageSizeOptions={[5, 10, 20]}
          />
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
        <div className="flex items-center gap-2 mb-4">
          <Sliders size={16} className="text-teal-600" />
          <h2 className="mp-panel-title">Simulation Parameters</h2>
        </div>

        <div className="sim-input-group">
          <label className="sim-label">Target Product Segment</label>
          <select
            className="sim-select"
            value={simSegment}
            onChange={(e) => setSimSegment(e.target.value)}
          >
            <option value="All SKUs (Global)">All SKUs (Global Portfolio)</option>
            <option value="Segment AX (High Value Stable)">Segment AX (High Value Stable)</option>
            <option value="Segment AY (High Value Variable)">Segment AY (High Value Variable)</option>
            <option value="Segment BX (Medium Value Stable)">Segment BX (Medium Value Stable)</option>
          </select>
        </div>

        <div className="sim-input-group">
          <div className="sim-input-row">
            <label className="sim-label">Service Level Target</label>
            <span className="sim-value-badge">{simServiceLevel.toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min="90"
            max="99.5"
            step="0.5"
            value={simServiceLevel}
            onChange={(e) => setSimServiceLevel(Number(e.target.value))}
            className="sim-range-input"
          />
          <div className="flex justify-between text-[11px] text-slate-400 mt-1">
            <span>90.0% (Lean)</span>
            <span>95.0% (Baseline)</span>
            <span>99.5% (Max)</span>
          </div>
        </div>

        <div className="sim-input-group">
          <div className="sim-input-row">
            <label className="sim-label">Expected Lead Time</label>
            <span className="sim-value-badge">{simLeadTime} Days</span>
          </div>
          <input
            type="range"
            min="1"
            max="28"
            step="1"
            value={simLeadTime}
            onChange={(e) => setSimLeadTime(Number(e.target.value))}
            className="sim-range-input"
          />
          <div className="flex justify-between text-[11px] text-slate-400 mt-1">
            <span>1d Express</span>
            <span>7d Standard</span>
            <span>28d Ocean</span>
          </div>
        </div>

        <div className="sim-input-group">
          <label className="sim-label">Annual Holding Cost Rate (%)</label>
          <input
            type="number"
            className="sim-input"
            value={simHoldingRate}
            onChange={(e) => setSimHoldingRate(Math.max(1, Number(e.target.value)))}
          />
          <span className="text-[11px] text-slate-400 mt-1 block">Cost of capital, warehousing & obsolescence</span>
        </div>

        <div className="sim-input-group">
          <label className="sim-label">Fixed Ordering Cost ($ per PO)</label>
          <input
            type="number"
            className="sim-input"
            value={simOrderCost}
            onChange={(e) => setSimOrderCost(Math.max(0, Number(e.target.value)))}
          />
          <span className="text-[11px] text-slate-400 mt-1 block">Administrative & inbound freight handling</span>
        </div>

        <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700 mb-1">
            <ShieldCheck size={14} className="text-teal-600" /> Real-time Optimization Engine
          </div>
          Adjusting parameters dynamically rebalances inventory safety stock and models lost-sale penalties.
        </div>
      </div>

      {/* Right side: Outputs */}
      <div className="cost-sim-outputs">
        {/* Executive KPI Summary Cards */}
        <div className="policy-summary-cards">
          {/* Card 1: Current Policy */}
          <div className="policy-stat-card">
            <div className="policy-stat-header">
              <span className="policy-stat-title">Baseline Policy</span>
              <span className="policy-stat-badge">95.0% SL</span>
            </div>
            <div className="policy-stat-main">
              <div className="policy-stat-val">${simMetrics.baseTotal.toLocaleString()}</div>
              <div className="policy-stat-sub">Annual Total Expected Cost</div>
            </div>
            <div className="policy-stat-grid">
              <div className="policy-stat-row">
                <span className="text-slate-500">Holding:</span>
                <span className="font-semibold text-slate-700">${simMetrics.baseHolding.toLocaleString()}</span>
              </div>
              <div className="policy-stat-row">
                <span className="text-slate-500">Stockout Risk:</span>
                <span className="font-semibold text-slate-700">${simMetrics.baseStockout.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Card 2: Simulated Target Policy */}
          <div className="policy-stat-card simulated">
            <div className="policy-stat-header">
              <span className="policy-stat-title">Simulated Policy</span>
              <span className="policy-stat-badge highlight">{simServiceLevel.toFixed(1)}% SL</span>
            </div>
            <div className="policy-stat-main">
              <div className="policy-stat-val text-teal-700">${simMetrics.simTotal.toLocaleString()}</div>
              <div className="policy-stat-sub">Target Annual Cost at {simLeadTime}d LT</div>
            </div>
            <div className="policy-stat-grid">
              <div className="policy-stat-row">
                <span className="text-slate-500">Holding:</span>
                <span className="font-semibold text-slate-700">${simMetrics.simHolding.toLocaleString()}</span>
              </div>
              <div className="policy-stat-row">
                <span className="text-slate-500">Stockout Risk:</span>
                <span className="font-semibold text-slate-700">${simMetrics.simStockout.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Card 3: Net Variance */}
          <div className={`policy-stat-card ${simMetrics.isSaving ? 'savings' : ''}`}>
            <div className="policy-stat-header">
              <span className="policy-stat-title">Net Annual Variance</span>
              <span className={`policy-stat-badge ${simMetrics.isSaving ? 'savings' : ''}`}>
                {simMetrics.isSaving ? 'NET SAVINGS' : 'COST INCREASE'}
              </span>
            </div>
            <div className="policy-stat-main">
              <div className={`policy-stat-val ${simMetrics.isSaving ? 'text-emerald-700' : 'text-amber-700'}`}>
                {simMetrics.isSaving ? '-' : '+'}${Math.abs(simMetrics.netVariance).toLocaleString()}
              </div>
              <div className="policy-stat-sub">
                {simMetrics.netVariancePct > 0 ? `+${simMetrics.netVariancePct}%` : `${simMetrics.netVariancePct}%`} vs. Current Policy
              </div>
            </div>
            <div className="policy-stat-grid">
              <div className="policy-stat-row">
                <span className="text-slate-500">Holding Impact:</span>
                <span className={`font-semibold ${simMetrics.holdingDelta > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {simMetrics.holdingDelta > 0 ? '+' : ''}${simMetrics.holdingDelta.toLocaleString()}
                </span>
              </div>
              <div className="policy-stat-row">
                <span className="text-slate-500">Stockout Mitigated:</span>
                <span className={`font-semibold ${simMetrics.stockoutDelta < 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {simMetrics.stockoutDelta < 0 ? '-' : '+'}${Math.abs(simMetrics.stockoutDelta).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Visual Cost Composition Progress Bar */}
        <div className="cost-breakdown-section">
          <div className="cost-breakdown-header">
            <span>Simulated Cost Composition Shift</span>
            <span>Holding: {simMetrics.holdingShare}% | Stockout: {simMetrics.stockoutShare}%</span>
          </div>
          <div className="cost-breakdown-bar">
            <div
              className="cost-breakdown-segment holding"
              style={{ width: `${simMetrics.holdingShare}%` }}
              title={`Holding Cost: $${simMetrics.simHolding.toLocaleString()}`}
            />
            <div
              className="cost-breakdown-segment stockout"
              style={{ width: `${simMetrics.stockoutShare}%` }}
              title={`Stockout Risk: $${simMetrics.simStockout.toLocaleString()}`}
            />
          </div>
          <div className="cost-breakdown-legend">
            <div className="legend-item">
              <span className="legend-dot holding"></span>
              <span>Inventory Holding Cost (${simMetrics.simHolding.toLocaleString()})</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot stockout"></span>
              <span>Unmet Demand / Stockout Penalty (${simMetrics.simStockout.toLocaleString()})</span>
            </div>
          </div>
        </div>

        {/* Chart Panel */}
        <div className="cost-sim-chart-panel mb-6">
          <div className="flex justify-between items-center mb-3">
            <h2 className="mp-panel-title">Total Expected Annual Cost vs. Target Service Level</h2>
            <span className="text-xs text-slate-500">Optimal Frontier Curve</span>
          </div>
          <div style={{ height: '220px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={costData?.chartData || []} margin={{ top: 15, right: 20, bottom: 15, left: 20 }}>
                <XAxis dataKey="sl" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} dy={10} />
                <Line type="monotone" dataKey="cost" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 4, fill: '#0d9488' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Elevated Policy Cost Comparison Table */}
        <div className="cost-sim-table-panel">
          <div className="flex justify-between items-center mb-3">
            <div>
              <h2 className="mp-panel-title">Detailed Policy Trade-off Analysis</h2>
              <span className="text-xs text-slate-500">
                Segment: {simSegment} • Lead Time: {simLeadTime} days • Target SL: {simServiceLevel.toFixed(1)}%
              </span>
            </div>
            <span className="text-xs font-semibold px-2 py-1 bg-slate-100 text-slate-700 rounded border border-slate-200">
              Annual Fiscal Modeling
            </span>
          </div>

          <table className="sim-table-elevated">
            <thead>
              <tr>
                <th>Cost Component</th>
                <th className="text-right">Current Policy (95.0%)</th>
                <th className="text-right">Simulated Policy ({simServiceLevel.toFixed(1)}%)</th>
                <th className="text-right">Variance ($)</th>
                <th className="text-right">Delta (%)</th>
                <th>Strategic Business Implication</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div className="cost-cat-cell">
                    <span className="cost-icon-badge holding"><Package size={14} /></span>
                    <div>
                      <div className="font-semibold text-slate-800">Annual Holding Cost</div>
                      <div className="text-[11px] text-slate-400">Working capital & carrying rate ({simHoldingRate}%)</div>
                    </div>
                  </div>
                </td>
                <td className="text-right font-mono text-slate-600">${simMetrics.baseHolding.toLocaleString()}</td>
                <td className="text-right font-mono font-semibold text-slate-800">${simMetrics.simHolding.toLocaleString()}</td>
                <td className="text-right font-mono text-slate-700">
                  {simMetrics.holdingDelta > 0 ? `+$${simMetrics.holdingDelta.toLocaleString()}` : `-$${Math.abs(simMetrics.holdingDelta).toLocaleString()}`}
                </td>
                <td className="text-right">
                  <span className={`mp-delta-pill ${simMetrics.holdingDelta <= 0 ? 'saving' : 'increase'}`}>
                    {simMetrics.holdingDeltaPct > 0 ? `+${simMetrics.holdingDeltaPct}%` : `${simMetrics.holdingDeltaPct}%`}
                  </span>
                </td>
                <td className="text-xs text-slate-500">
                  {simMetrics.holdingDelta > 0
                    ? 'Higher buffer stock required to protect service commitments'
                    : 'Reduced inventory footprint frees tied-up operational capital'}
                </td>
              </tr>

              <tr>
                <td>
                  <div className="cost-cat-cell">
                    <span className="cost-icon-badge stockout"><AlertTriangle size={14} /></span>
                    <div>
                      <div className="font-semibold text-slate-800">Expected Stockout Cost</div>
                      <div className="text-[11px] text-slate-400">Lost sales margin & expedited replenishment</div>
                    </div>
                  </div>
                </td>
                <td className="text-right font-mono text-slate-600">${simMetrics.baseStockout.toLocaleString()}</td>
                <td className="text-right font-mono font-semibold text-slate-800">${simMetrics.simStockout.toLocaleString()}</td>
                <td className="text-right font-mono text-slate-700">
                  {simMetrics.stockoutDelta < 0 ? `-$${Math.abs(simMetrics.stockoutDelta).toLocaleString()}` : `+$${simMetrics.stockoutDelta.toLocaleString()}`}
                </td>
                <td className="text-right">
                  <span className={`mp-delta-pill ${simMetrics.stockoutDelta <= 0 ? 'saving' : 'increase'}`}>
                    {simMetrics.stockoutDeltaPct > 0 ? `+${simMetrics.stockoutDeltaPct}%` : `${simMetrics.stockoutDeltaPct}%`}
                  </span>
                </td>
                <td className="text-xs text-slate-500">
                  {simMetrics.stockoutDelta < 0
                    ? 'Fewer lost sales and lower customer attrition risk'
                    : 'Increased likelihood of stockouts during demand spikes'}
                </td>
              </tr>

              <tr className="total-row">
                <td>
                  <div className="cost-cat-cell">
                    <span className="cost-icon-badge total"><DollarSign size={14} /></span>
                    <div>
                      <div className="font-bold text-slate-900">Total Annual Policy Cost</div>
                      <div className="text-[11px] text-slate-500">Holding + Stockout penalty combined</div>
                    </div>
                  </div>
                </td>
                <td className="text-right font-mono font-bold text-slate-700">${simMetrics.baseTotal.toLocaleString()}</td>
                <td className="text-right font-mono font-bold text-teal-800">${simMetrics.simTotal.toLocaleString()}</td>
                <td className="text-right font-mono font-bold text-slate-800">
                  {simMetrics.netVariance <= 0 ? `-$${Math.abs(simMetrics.netVariance).toLocaleString()}` : `+$${simMetrics.netVariance.toLocaleString()}`}
                </td>
                <td className="text-right">
                  <span className={`mp-delta-pill ${simMetrics.isSaving ? 'saving' : 'increase'}`}>
                    {simMetrics.netVariancePct > 0 ? `+${simMetrics.netVariancePct}%` : `${simMetrics.netVariancePct}%`}
                  </span>
                </td>
                <td className="text-xs font-semibold text-slate-700">
                  {simMetrics.isSaving
                    ? 'Recommended policy: Net reduction in total cost with improved fulfillment'
                    : 'Trade-off advisory: Higher service level costs exceed stockout mitigation'}
                </td>
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
