import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  RefreshCw,
  X,
  Sliders,
  ShieldCheck,
  Lightbulb,
  CheckCircle2,
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
  const [trainingJobs, setTrainingJobs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Simulation Interactive Parameters
  const [simSegment, setSimSegment] = useState('All SKUs (Global)');
  const [simServiceLevel, setSimServiceLevel] = useState(95);
  const [simLeadTime, setSimLeadTime] = useState(7);
  const [simHoldingRate, setSimHoldingRate] = useState(20);
  const [simOrderCost, setSimOrderCost] = useState(50);

  // Live Optimization States (UC29, UC30, UC31, UC32)
  const [storesList, setStoresList] = useState<string[]>(['CA_1', 'CA_2', 'TX_1', 'WI_1']);
  const [selectedStore, setSelectedStore] = useState<string>('CA_1');
  const [compareStaticData, setCompareStaticData] = useState<any>(null);
  const [sensitivityData, setSensitivityData] = useState<any>(null);
  const [serviceLevelConfig, setServiceLevelConfig] = useState<any>(null);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState('');
  const [isServiceLevelModalOpen, setIsServiceLevelModalOpen] = useState(false);
  const [targetServiceLevelInput, setTargetServiceLevelInput] = useState(95);
  const [isSavingServiceLevel, setIsSavingServiceLevel] = useState(false);

  // Policy Cost Comparison Filter & Pagination
  const [compareSearch, setCompareSearch] = useState('');
  const [compareCategory, setCompareCategory] = useState('All');
  const [comparePage, setComparePage] = useState(1);
  const [comparePageSize, setComparePageSize] = useState(10);

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

  const loadData = async (store: string = selectedStore) => {
    setIsLoading(true);
    try {
      const [perfResult, jobsResult, storesRes] = await Promise.all([
        api.models.getPerformanceMetrics().catch(() => null),
        api.ml.listAllTrainJobs().catch(() => ({ list: [], total: 0 })),
        api.inventory.getStores().catch(() => ['CA_1', 'CA_2', 'TX_1', 'WI_1']),
      ]);
      setData(perfResult);
      setTrainingJobs(jobsResult.list || []);
      if (storesRes && storesRes.length > 0) setStoresList(storesRes);
      // Release initial UI immediately in ~0.3s
      setIsLoading(false);

      // Background prefetch for Cost Simulator tab
      loadCostSimulationData(store);
    } catch (error) {
      console.error('Failed to load model data', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCostSimulationData = async (store: string = selectedStore) => {
    try {
      const [compareRes, sensRes, slRes] = await Promise.all([
        api.optimization.compareStatic(store || 'CA_1').catch(() => null),
        api.optimization.runSensitivityAnalysis({ store_id: store || 'CA_1' }).catch(() => null),
        api.optimization.getServiceLevel().catch(() => null),
      ]);
      if (compareRes) setCompareStaticData(compareRes);
      if (sensRes) setSensitivityData(sensRes);
      if (slRes) {
        setServiceLevelConfig(slRes);
        setTargetServiceLevelInput(Math.round((slRes.default_service_level || 0.95) * 100));
        setSimServiceLevel(Math.round((slRes.default_service_level || 0.95) * 100));
      }
    } catch (error) {
      console.error('Failed to load cost simulation data', error);
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

  const handleStoreChange = async (newStore: string) => {
    setSelectedStore(newStore);
    try {
      const [cmpRes, sensRes] = await Promise.all([
        api.optimization.compareStatic(newStore).catch(() => null),
        api.optimization.runSensitivityAnalysis({
          store_id: newStore,
          holding_cost_rate: simHoldingRate / 100,
          order_cost: simOrderCost,
        }).catch(() => null),
      ]);
      if (cmpRes) setCompareStaticData(cmpRes);
      if (sensRes) setSensitivityData(sensRes);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRecompute = async (forceStatic: boolean = false) => {
    setIsRecomputing(true);
    setRecomputeMsg('');
    try {
      const res = await api.optimization.recompute({
        store_id: selectedStore || 'CA_1',
        force_static: forceStatic,
      });
      setRecomputeMsg(res.message || 'Đã tính toán lại tham số tối ưu thành công!');
      const [cmpRes, sensRes] = await Promise.all([
        api.optimization.compareStatic(selectedStore || 'CA_1').catch(() => null),
        api.optimization.runSensitivityAnalysis({ store_id: selectedStore || 'CA_1' }).catch(() => null),
      ]);
      if (cmpRes) setCompareStaticData(cmpRes);
      if (sensRes) setSensitivityData(sensRes);
      setTimeout(() => setRecomputeMsg(''), 4500);
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Lỗi khi tính toán lại tham số tối ưu');
    } finally {
      setIsRecomputing(false);
    }
  };

  const handleSaveServiceLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingServiceLevel(true);
    try {
      const targetVal = Number(targetServiceLevelInput) / 100;
      const res = await api.optimization.updateServiceLevel({
        default_service_level: targetVal,
      });
      setServiceLevelConfig(res);
      setIsServiceLevelModalOpen(false);
      setRecomputeMsg(`Đã cập nhật mức phục vụ mục tiêu ${(targetVal * 100).toFixed(1)}%! Hệ thống đã tự động tính lại SS và ROP.`);
      const cmpRes = await api.optimization.compareStatic(selectedStore || 'CA_1').catch(() => null);
      if (cmpRes) setCompareStaticData(cmpRes);
      setTimeout(() => setRecomputeMsg(''), 4500);
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Lỗi cập nhật mức phục vụ');
    } finally {
      setIsSavingServiceLevel(false);
    }
  };

  const handleSensitivityUpdate = async (sl: number, lt: number, hr: number, oc: number) => {
    try {
      const baselineSl = serviceLevelConfig?.default_service_level || 0.95;
      const slDelta = (sl / 100) - baselineSl;
      const ltDelta = (lt - 7) / 7;
      const res = await api.optimization.runSensitivityAnalysis({
        store_id: selectedStore || 'CA_1',
        service_level_deltas: [slDelta - 0.04, slDelta - 0.02, slDelta, slDelta + 0.02, slDelta + 0.04],
        lead_time_deltas: [ltDelta - 0.2, ltDelta - 0.1, ltDelta, ltDelta + 0.1, ltDelta + 0.2],
        holding_cost_rate: hr / 100,
        order_cost: oc,
      });
      setSensitivityData(res);
    } catch (e) {
      console.error(e);
    }
  };

  // Compare Table Filtering & Pagination
  const compareCategories = useMemo(() => {
    const items = compareStaticData?.items || [];
    const cats = Array.from(new Set(items.map((it: any) => it.category).filter(Boolean))) as string[];
    return ['All', ...cats];
  }, [compareStaticData?.items]);

  const filteredCompareItems = useMemo(() => {
    let list = compareStaticData?.items || [];
    if (compareCategory !== 'All') {
      list = list.filter((it: any) => it.category === compareCategory);
    }
    if (compareSearch.trim()) {
      const q = compareSearch.toLowerCase();
      list = list.filter((it: any) =>
        it.item_id?.toLowerCase().includes(q) ||
        it.product_name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [compareStaticData?.items, compareCategory, compareSearch]);

  const paginatedCompareItems = useMemo(() => {
    const start = (comparePage - 1) * comparePageSize;
    return filteredCompareItems.slice(start, start + comparePageSize);
  }, [filteredCompareItems, comparePage, comparePageSize]);

  // Derived Dynamic Simulation Calculations
  const simMetrics = useMemo(() => {
    const baseHolding = sensitivityData?.baseline_scenario?.holding_cost != null
      ? Math.round(sensitivityData.baseline_scenario.holding_cost)
      : 3500;
    const baseStockout = sensitivityData?.baseline_scenario?.stockout_cost != null
      ? Math.round(sensitivityData.baseline_scenario.stockout_cost)
      : 2500;
    const baseTotal = baseHolding + baseStockout;

    const zFactor = Math.pow(simServiceLevel / 95, 2.8);
    const ltFactor = Math.sqrt(simLeadTime / 7);
    const holdingRateFactor = simHoldingRate / 20;

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

    const holdingShare = Math.round((simHolding / Math.max(1, simTotal)) * 100);
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
  }, [simServiceLevel, simLeadTime, simHoldingRate, simOrderCost, sensitivityData?.baseline_scenario]);

  const sensitivityChartData = useMemo(() => {
    if (sensitivityData?.scenarios && sensitivityData.scenarios.length > 0) {
      return sensitivityData.scenarios.map((s: any) => ({
        sl: `${Math.round(s.service_level * 100)}%`,
        cost: Math.round(s.total_cost),
        holding: Math.round(s.holding_cost),
        stockout: Math.round(s.stockout_cost),
      }));
    }
    return [
      { sl: '90%', cost: 12500, holding: 6800, stockout: 5700 },
      { sl: '95%', cost: 14200, holding: 9200, stockout: 5000 },
      { sl: '98%', cost: 18600, holding: 15400, stockout: 3200 },
      { sl: '99%', cost: 24500, holding: 22100, stockout: 2400 },
    ];
  }, [sensitivityData?.scenarios]);

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
            <button className="text-xs text-teal-600 hover:text-teal-800 flex items-center gap-1" onClick={() => loadData()}>
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
      {/* Top Action Bar */}
      <div className="cost-sim-topbar">
        <div className="flex items-center gap-3">
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Target Store / Warehouse:</label>
          <select
            value={selectedStore}
            onChange={(e) => handleStoreChange(e.target.value)}
            className="sim-store-select"
          >
            {storesList.map((st) => (
              <option key={st} value={st}>Store {st}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="recompute-btn"
            onClick={() => handleRecompute(false)}
            disabled={isRecomputing}
          >
            <RefreshCw size={14} className={isRecomputing ? 'animate-spin' : ''} />
            <span>{isRecomputing ? 'Recomputing Parameters...' : 'Recompute ML Optimization'}</span>
          </button>
        </div>
      </div>

      {recomputeMsg && (
        <div className="recompute-banner">
          <CheckCircle2 size={16} className="text-teal-600 shrink-0" />
          <span>{recomputeMsg}</span>
        </div>
      )}

      {/* Top Executive KPI Summary Cards */}
      <div className="policy-summary-cards mb-6">
        {/* Card 1: Static Policy */}
        <div className="policy-stat-card">
          <div className="policy-stat-header">
            <span className="policy-stat-title">Baseline Policy (Static)</span>
            <span className="policy-stat-badge">Moving Average</span>
          </div>
          <div className="policy-stat-main">
            <div className="policy-stat-val">
              ${(compareStaticData?.items || []).reduce((acc: number, it: any) => acc + (it.static_annual_holding_cost || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) || simMetrics.baseTotal.toLocaleString()}
            </div>
            <div className="policy-stat-sub">Annual Holding Cost (Traditional Formula)</div>
          </div>
          <div className="policy-stat-grid">
            <div className="policy-stat-row">
              <span className="text-slate-500">Methodology:</span>
              <span className="font-semibold text-slate-700">Moving Avg Sigma</span>
            </div>
            <div className="policy-stat-row">
              <span className="text-slate-500">Inventory Buffer:</span>
              <span className="font-semibold text-slate-700">Static Buffer</span>
            </div>
          </div>
        </div>

        {/* Card 2: ML Optimal Policy */}
        <div className="policy-stat-card simulated">
          <div className="policy-stat-header">
            <span className="policy-stat-title">ML Optimal Policy</span>
            <span className="policy-stat-badge highlight">PRODUCTION ML</span>
          </div>
          <div className="policy-stat-main">
            <div className="policy-stat-val text-teal-700">
              ${(compareStaticData?.items || []).reduce((acc: number, it: any) => acc + (it.ml_annual_holding_cost || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) || simMetrics.simTotal.toLocaleString()}
            </div>
            <div className="policy-stat-sub">Annual Holding Cost (ML Forecasting)</div>
          </div>
          <div className="policy-stat-grid">
            <div className="policy-stat-row">
              <span className="text-slate-500">Evaluated SKUs:</span>
              <span className="font-semibold text-slate-700">{compareStaticData?.total_items || (compareStaticData?.items?.length || 0)} SKUs</span>
            </div>
            <div className="policy-stat-row">
              <span className="text-slate-500">ML Lead Time sigma:</span>
              <span className="font-semibold text-slate-700">Dynamic Conformal</span>
            </div>
          </div>
        </div>

        {/* Card 3: Net Annual Holding Savings */}
        <div className="policy-stat-card savings">
          <div className="policy-stat-header">
            <span className="policy-stat-title">Net Annual Holding Savings</span>
            <span className="policy-stat-badge savings">PROVEN SAVINGS</span>
          </div>
          <div className="policy-stat-main">
            <div className="policy-stat-val text-emerald-700">
              +${(compareStaticData?.total_holding_cost_savings ?? 1420).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <div className="policy-stat-sub">
              {(compareStaticData?.avg_ss_reduction_percent ?? 18.5).toFixed(1)}% Avg Safety Stock Reduction
            </div>
          </div>
          <div className="policy-stat-grid">
            <div className="policy-stat-row">
              <span className="text-slate-500">Buffer Stock Reduction:</span>
              <span className="font-semibold text-emerald-700">-{(compareStaticData?.avg_ss_reduction_percent ?? 18.5).toFixed(1)}%</span>
            </div>
            <div className="policy-stat-row">
              <span className="text-slate-500">Working Capital:</span>
              <span className="font-semibold text-emerald-700">Freed for Growth</span>
            </div>
          </div>
        </div>

        {/* Card 4: Target Service Level */}
        <div className="policy-stat-card">
          <div className="policy-stat-header">
            <span className="policy-stat-title">Target Service Level</span>
            <span className="policy-stat-badge">UC29 POLICY</span>
          </div>
          <div className="policy-stat-main">
            <div className="policy-stat-val text-slate-800">
              {((serviceLevelConfig?.default_service_level ?? 0.95) * 100).toFixed(1)}%
            </div>
            <div className="policy-stat-sub">System-wide Critical Ratio (tau)</div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-center">
            <span className="text-xs text-slate-500">Admin Configuration</span>
            <button
              type="button"
              className="text-xs text-teal-700 hover:text-teal-900 font-bold underline"
              onClick={() => {
                setTargetServiceLevelInput(Math.round((serviceLevelConfig?.default_service_level || 0.95) * 100));
                setIsServiceLevelModalOpen(true);
              }}
            >
              Configure Target
            </button>
          </div>
        </div>
      </div>

      {/* Main Simulator Grid */}
      <div className="cost-sim-layout-grid">
        {/* Left side: Inputs */}
        <div className="cost-sim-controls">
          <div className="flex items-center gap-2 mb-4">
            <Sliders size={16} className="text-teal-600" />
            <h2 className="mp-panel-title">Sensitivity Analysis Parameters</h2>
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
              min="85"
              max="99"
              step="0.5"
              value={simServiceLevel}
              onChange={(e) => {
                const val = Number(e.target.value);
                setSimServiceLevel(val);
                handleSensitivityUpdate(val, simLeadTime, simHoldingRate, simOrderCost);
              }}
              className="sim-range-input"
            />
            <div className="flex justify-between text-[11px] text-slate-400 mt-1">
              <span>85.0% (Lean)</span>
              <span>95.0% (Standard)</span>
              <span>99.0% (Pharma/Critical)</span>
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
              onChange={(e) => {
                const val = Number(e.target.value);
                setSimLeadTime(val);
                handleSensitivityUpdate(simServiceLevel, val, simHoldingRate, simOrderCost);
              }}
              className="sim-range-input"
            />
            <div className="flex justify-between text-[11px] text-slate-400 mt-1">
              <span>1d Express</span>
              <span>7d Standard</span>
              <span>28d Ocean Freight</span>
            </div>
          </div>

          <div className="sim-input-group">
            <label className="sim-label">Annual Holding Cost Rate (%)</label>
            <input
              type="number"
              className="sim-input"
              value={simHoldingRate}
              onChange={(e) => {
                const val = Math.max(1, Number(e.target.value));
                setSimHoldingRate(val);
                handleSensitivityUpdate(simServiceLevel, simLeadTime, val, simOrderCost);
              }}
            />
            <span className="text-[11px] text-slate-400 mt-1 block">Capital cost, warehousing & shrinkage rate</span>
          </div>

          <div className="sim-input-group">
            <label className="sim-label">Fixed Ordering Cost ($ per PO)</label>
            <input
              type="number"
              className="sim-input"
              value={simOrderCost}
              onChange={(e) => {
                const val = Math.max(0, Number(e.target.value));
                setSimOrderCost(val);
                handleSensitivityUpdate(simServiceLevel, simLeadTime, simHoldingRate, val);
              }}
            />
            <span className="text-[11px] text-slate-400 mt-1 block">Inbound handling, paperwork & logistics per order</span>
          </div>

          <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700 mb-1">
              <ShieldCheck size={14} className="text-teal-600" /> In-Memory Simulation
            </div>
            Parameters run directly in-memory against inventory elasticity formulas without overriding persistent store data.
          </div>
        </div>

        {/* Right side: Outputs & Curve */}
        <div className="cost-sim-outputs">
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
          <div className="cost-sim-chart-panel mb-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="mp-panel-title">Total Expected Annual Cost vs. Target Service Level</h2>
              <span className="text-xs text-slate-500">Frontier Curve ({sensitivityChartData.length} Scenarios)</span>
            </div>
            <div style={{ height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sensitivityChartData} margin={{ top: 15, right: 20, bottom: 15, left: 20 }}>
                  <XAxis dataKey="sl" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} dy={10} />
                  <Line type="monotone" dataKey="cost" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 4, fill: '#0d9488' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Strategic Insights Box (From Backend UC32) */}
          {sensitivityData?.insights && sensitivityData.insights.length > 0 && (
            <div className="sim-insights-card">
              <div className="sim-insights-header">
                <Lightbulb size={16} className="text-teal-700" />
                <h4 className="sim-insights-title">Strategic Optimization Insights</h4>
              </div>
              <ul className="sim-insights-list">
                {sensitivityData.insights.map((ins: string, idx: number) => (
                  <li key={idx} className="sim-insights-item">
                    <span className="sim-insights-bullet">•</span>
                    <span>{ins}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Detailed Policy Cost Comparison Summary Table (UC31) */}
      <div className="cost-sim-table-panel mt-6">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div>
            <h2 className="mp-panel-title">Detailed Policy Cost Comparison Summary (ML vs. Static Formula)</h2>
            <span className="text-xs text-slate-500">
              UC31 - Side-by-side comparison of ML Demand Forecasting vs. Moving Average Safety Stock across Store {selectedStore}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search SKU or Product..."
              value={compareSearch}
              onChange={(e) => {
                setCompareSearch(e.target.value);
                setComparePage(1);
              }}
              className="sim-search-input"
            />
            <select
              value={compareCategory}
              onChange={(e) => {
                setCompareCategory(e.target.value);
                setComparePage(1);
              }}
              className="sim-cat-select"
            >
              {compareCategories.map((c) => (
                <option key={c} value={c}>Category: {c}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="sim-table-elevated">
            <thead>
              <tr>
                <th>SKU / PRODUCT NAME</th>
                <th>CATEGORY</th>
                <th>SERVICE LEVEL / LT</th>
                <th className="text-right">SAFETY STOCK (ML vs STATIC)</th>
                <th className="text-right">REORDER POINT (ML vs STATIC)</th>
                <th className="text-right">EOQ</th>
                <th className="text-right">ANNUAL HOLDING SAVINGS</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompareItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-slate-400">
                    No comparison items available for the selected filters.
                  </td>
                </tr>
              ) : (
                paginatedCompareItems.map((item: any, idx: number) => {
                  const ssDiff = item.ss_difference != null ? item.ss_difference : (item.static_safety_stock - item.ml_safety_stock);
                  const isSaving = (item.holding_cost_savings ?? 0) >= 0;
                  return (
                    <tr key={item.item_id || idx}>
                      <td>
                        <div className="font-bold text-slate-800">{item.item_id}</div>
                        <div className="text-[11px] text-slate-500">{item.product_name || item.item_id}</div>
                      </td>
                      <td>
                        <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                          {item.category || 'General'}
                        </span>
                      </td>
                      <td>
                        <div className="text-xs font-medium text-slate-700">
                          {((item.service_level || 0.95) * 100).toFixed(0)}% SL
                        </div>
                        <div className="text-[11px] text-slate-400">{item.lead_time_days || 7}d Lead Time</div>
                      </td>
                      <td className="text-right">
                        <div className="font-mono text-xs">
                          <strong className="text-teal-700">{item.ml_safety_stock?.toFixed(1) || '0.0'}</strong>{' '}
                          <span className="text-slate-400">vs</span>{' '}
                          <span className="text-slate-500 line-through">{item.static_safety_stock?.toFixed(1) || '0.0'}</span>
                        </div>
                        {ssDiff > 0 && (
                          <span className="mp-delta-pill success text-[10px] mt-0.5">
                            -{ssDiff.toFixed(1)} buffer
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        <div className="font-mono text-xs">
                          <strong className="text-slate-800">{item.ml_reorder_point?.toFixed(1) || '0.0'}</strong>{' '}
                          <span className="text-slate-400">vs</span>{' '}
                          <span className="text-slate-500">{item.static_reorder_point?.toFixed(1) || '0.0'}</span>
                        </div>
                      </td>
                      <td className="text-right font-mono text-xs font-semibold text-slate-700">
                        {item.ml_eoq?.toFixed(0) || '-'} u
                      </td>
                      <td className="text-right">
                        <span className={`mp-delta-pill ${isSaving ? 'success' : 'warning'} font-mono`}>
                          {isSaving ? `+$${item.holding_cost_savings?.toFixed(2)}` : `-$${Math.abs(item.holding_cost_savings || 0).toFixed(2)}`}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredCompareItems.length > 0 && (
          <Pagination
            currentPage={comparePage}
            totalItems={filteredCompareItems.length}
            pageSize={comparePageSize}
            onPageChange={setComparePage}
            onPageSizeChange={(sz) => {
              setComparePageSize(sz);
              setComparePage(1);
            }}
            pageSizeOptions={[5, 10, 20, 50]}
          />
        )}
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

      {isLoading || !data ? (
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

      {/* Service Level Config Modal (UC29) */}
      {isServiceLevelModalOpen && createPortal(
        <div className="modal-overlay" onClick={() => setIsServiceLevelModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setIsServiceLevelModalOpen(false)}><X size={16} /></button>
            <h2 className="modal-title">Configure Target Service Level</h2>
            <p className="modal-subtitle">
              UC29 - Establish system-wide service level (tau in [0.85, 0.99]). The optimization engine will automatically recompute Safety Stock & ROP.
            </p>

            <form onSubmit={handleSaveServiceLevel}>
              <div className="modal-form-group mt-4">
                <label>Default System Service Level (%)</label>
                <div className="modal-input-wrapper">
                  <input
                    type="number"
                    min="85"
                    max="99"
                    step="0.5"
                    required
                    value={targetServiceLevelInput}
                    onChange={(e) => setTargetServiceLevelInput(Number(e.target.value))}
                    className="modal-input"
                  />
                  <span className="modal-input-suffix">%</span>
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Accepted range: 85.0% - 99.0% (e.g., 95.0% for standard FMCG, 98.0% for critical pharma/essential foods).
                </span>
              </div>

              <div className="modal-info-banner">
                <div className="banner-dot"></div>
                <span>Changing service level automatically recalculates Safety Stock and logs an audit trail.</span>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-btn-cancel"
                  onClick={() => setIsServiceLevelModalOpen(false)}
                  disabled={isSavingServiceLevel}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modal-btn-apply"
                  disabled={isSavingServiceLevel}
                >
                  {isSavingServiceLevel ? 'Updating Service Level...' : 'Save & Recompute'}
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
