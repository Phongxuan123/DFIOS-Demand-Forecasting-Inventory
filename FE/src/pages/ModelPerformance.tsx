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
import { ScatterChart, Scatter, LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip } from 'recharts';
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
      const targetSl = sl / 100;
      const baseLt = 7;
      const slDeltas = Array.from(new Set([
        -0.10, -0.05, -0.02, 0.0, Number((targetSl - baselineSl).toFixed(4)), 0.02, 0.04
      ])).sort((a, b) => a - b);

      const ltDeltas = Array.from(new Set([
        -0.2, -0.1, 0.0, Number(((lt - baseLt) / baseLt).toFixed(4)), 0.1, 0.2
      ])).sort((a, b) => a - b);

      const res = await api.optimization.runSensitivityAnalysis({
        store_id: selectedStore || 'CA_1',
        service_level_deltas: slDeltas,
        lead_time_deltas: ltDeltas,
        holding_cost_rate: hr / 100,
        order_cost: oc,
      });
      setSensitivityData(res);
    } catch (e) {
      console.error(e);
    }
  };

  // Effective comparison items strictly from Backend (UC31)
  const effectiveCompareItems = useMemo(() => {
    if (compareStaticData?.items && Array.isArray(compareStaticData.items)) {
      return compareStaticData.items;
    }
    return [];
  }, [compareStaticData?.items]);

  // Aggregate portfolio summary stats strictly from Backend
  const portfolioStats = useMemo(() => {
    const totalStaticHolding = effectiveCompareItems.reduce(
      (acc: number, it: any) => acc + (it.static_annual_holding_cost || 0),
      0
    );
    const totalMlHolding = effectiveCompareItems.reduce(
      (acc: number, it: any) => acc + (it.ml_annual_holding_cost || 0),
      0
    );
    const totalSavings = compareStaticData?.total_holding_cost_savings != null
      ? compareStaticData.total_holding_cost_savings
      : effectiveCompareItems.reduce((acc: number, it: any) => acc + (it.holding_cost_savings || 0), 0);

    const avgReductionPct = compareStaticData?.avg_ss_reduction_percent != null
      ? compareStaticData.avg_ss_reduction_percent
      : totalStaticHolding > 0
        ? ((totalStaticHolding - totalMlHolding) / totalStaticHolding) * 100
        : 0;

    return {
      totalStaticHolding: Math.round(totalStaticHolding),
      totalMlHolding: Math.round(totalMlHolding),
      totalSavings: Math.round(totalSavings),
      avgReductionPct: Number(avgReductionPct.toFixed(1)),
      totalSkus: effectiveCompareItems.length,
    };
  }, [effectiveCompareItems, compareStaticData]);

  // Compare Table Filtering & Pagination
  const compareCategories = useMemo(() => {
    const cats = Array.from(new Set(effectiveCompareItems.map((it: any) => it.category).filter(Boolean))) as string[];
    return ['All', ...cats];
  }, [effectiveCompareItems]);

  const filteredCompareItems = useMemo(() => {
    let list = effectiveCompareItems;
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
  }, [effectiveCompareItems, compareCategory, compareSearch]);

  const paginatedCompareItems = useMemo(() => {
    const start = (comparePage - 1) * comparePageSize;
    return filteredCompareItems.slice(start, start + comparePageSize);
  }, [filteredCompareItems, comparePage, comparePageSize]);

  // Dynamic Simulation Calculations strictly bound to Backend Scenarios
  const simMetrics = useMemo(() => {
    const baseline = sensitivityData?.baseline_scenario;
    const baseHolding = baseline?.holding_cost != null ? Math.round(baseline.holding_cost) : 0;
    const baseStockout = baseline?.stockout_cost != null ? Math.round(baseline.stockout_cost) : 0;
    const baseTotal = baseline?.total_cost != null ? Math.round(baseline.total_cost) : (baseHolding + baseStockout);

    const scenarios: any[] = sensitivityData?.scenarios || [];
    const targetSl = simServiceLevel / 100;

    // Find the scenario from BE that best matches current simulated Service Level and Lead Time
    let chosenScenario: any = null;
    let minDistance = Number.MAX_VALUE;

    for (const scn of scenarios) {
      const slDist = Math.abs((scn.service_level ?? 0.95) - targetSl);
      const ltDist = Math.abs((scn.lead_time_days ?? 7) - simLeadTime) / 7;
      const totalDist = slDist * 2 + ltDist;
      if (totalDist < minDistance) {
        minDistance = totalDist;
        chosenScenario = scn;
      }
    }

    if (!chosenScenario || (Math.abs(targetSl - (baseline?.service_level ?? 0.95)) < 0.005 && simLeadTime === (baseline?.lead_time_days ?? 7))) {
      chosenScenario = baseline;
    }

    const simHolding = chosenScenario?.holding_cost != null ? Math.round(chosenScenario.holding_cost) : baseHolding;
    const simStockout = chosenScenario?.stockout_cost != null ? Math.round(chosenScenario.stockout_cost) : baseStockout;
    const simTotal = chosenScenario?.total_cost != null ? Math.round(chosenScenario.total_cost) : (simHolding + simStockout);

    const netVariance = chosenScenario?.cost_difference_vs_baseline != null
      ? Math.round(chosenScenario.cost_difference_vs_baseline)
      : (simTotal - baseTotal);
    const netVariancePct = baseTotal > 0 ? Number(((netVariance / baseTotal) * 100).toFixed(1)) : 0;

    const holdingDelta = simHolding - baseHolding;
    const holdingDeltaPct = baseHolding > 0 ? Number(((holdingDelta / baseHolding) * 100).toFixed(1)) : 0;

    const stockoutDelta = simStockout - baseStockout;
    const stockoutDeltaPct = baseStockout > 0 ? Number(((stockoutDelta / baseStockout) * 100).toFixed(1)) : 0;

    const holdingShare = simTotal > 0 ? Math.round((simHolding / simTotal) * 100) : 50;
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
  }, [simServiceLevel, simLeadTime, sensitivityData]);

  // Trade-off Frontier Curve mapped directly from BE Sensitivity Analysis Scenarios
  const sensitivityChartData = useMemo(() => {
    const scenarios: any[] = sensitivityData?.scenarios || [];
    if (scenarios.length === 0) {
      if (sensitivityData?.baseline_scenario) {
        const b = sensitivityData.baseline_scenario;
        const slPct = Math.round(b.service_level * 100);
        return [{
          sl: `${slPct}%`,
          rawSl: slPct,
          cost: Math.round(b.total_cost),
          holding: Math.round(b.holding_cost),
          stockout: Math.round(b.stockout_cost),
        }];
      }
      return [];
    }

    // Pick distinct lead time closest to user's selected simLeadTime
    const distinctLts = Array.from(new Set(scenarios.map((s: any) => s.lead_time_days))) as number[];
    const targetLt = distinctLts.reduce((prev, curr) =>
      Math.abs(curr - simLeadTime) < Math.abs(prev - simLeadTime) ? curr : prev, distinctLts[0] || simLeadTime
    );

    const ltScenarios = scenarios.filter((s: any) => s.lead_time_days === targetLt);
    const combined = [...ltScenarios];
    if (sensitivityData?.baseline_scenario && sensitivityData.baseline_scenario.lead_time_days === targetLt) {
      if (!combined.some((s: any) => Math.abs(s.service_level - sensitivityData.baseline_scenario.service_level) < 0.001)) {
        combined.push(sensitivityData.baseline_scenario);
      }
    }

    combined.sort((a: any, b: any) => a.service_level - b.service_level);

    const seen = new Set<number>();
    const result: any[] = [];
    for (const scn of combined) {
      const slPct = Math.round(scn.service_level * 100);
      if (seen.has(slPct)) continue;
      seen.add(slPct);
      result.push({
        sl: `${slPct}%`,
        rawSl: slPct,
        cost: Math.round(scn.total_cost),
        holding: Math.round(scn.holding_cost),
        stockout: Math.round(scn.stockout_cost),
      });
    }

    return result;
  }, [sensitivityData, simLeadTime]);

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
          <div style={{ minHeight: '250px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="acc-metric-group">
              <div className="acc-metric-title">MASE (Lower is Better)</div>
              <div className="acc-bars">
                {(data?.kpis || []).length > 0 ? (
                  data.kpis.map((kpi: any, idx: number) => {
                    const maseNum = parseFloat(kpi.metrics?.mase);
                    const widthPx = !isNaN(maseNum) && maseNum > 0 ? Math.min(200, Math.max(35, Math.round(maseNum * 120))) : 80;
                    const isProd = kpi.isProduction || kpi.type === 'best';
                    return (
                      <div className="acc-bar-item" key={kpi.id || idx}>
                        <div
                          className="acc-bar-bg"
                          style={{
                            width: `${widthPx}px`,
                            backgroundColor: isProd ? '#0d9488' : '#94a3b8',
                          }}
                        />
                        <span className={`acc-bar-label ${isProd ? 'font-bold text-teal' : ''}`}>
                          {kpi.title} ({kpi.metrics?.mase ?? '-'})
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-xs text-slate-400 py-3">Chưa có mô hình trong Model Registry</div>
                )}
              </div>
            </div>

            <div className="acc-metric-group">
              <div className="acc-metric-title">MAE (Scaled Error)</div>
              <div className="acc-bars">
                {(data?.kpis || []).length > 0 ? (
                  data.kpis.map((kpi: any, idx: number) => {
                    const maeNum = parseFloat(kpi.metrics?.mae);
                    const widthPx = !isNaN(maeNum) && maeNum > 0 ? Math.min(200, Math.max(35, Math.round(maeNum * 25))) : 80;
                    const isProd = kpi.isProduction || kpi.type === 'best';
                    return (
                      <div className="acc-bar-item" key={kpi.id || idx}>
                        <div
                          className="acc-bar-bg"
                          style={{
                            width: `${widthPx}px`,
                            backgroundColor: isProd ? '#0d9488' : '#94a3b8',
                          }}
                        />
                        <span className={`acc-bar-label ${isProd ? 'font-bold text-teal' : ''}`}>
                          {kpi.title} ({kpi.metrics?.mae ?? '-'})
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-xs text-slate-400 py-3">Chưa có mô hình trong Model Registry</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Residual Scatter */}
        <div className="mp-resid-panel">
          <h2 className="mp-panel-title">Residual Diagnostic Scatter</h2>
          <div style={{ height: '250px' }}>
            {data?.scatterData && data.scatterData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <XAxis type="number" dataKey="x" name="Actual Demand" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <YAxis type="number" dataKey="y" name="Predicted Demand" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <ReferenceLine stroke="#e2e8f0" strokeDasharray="3 3" />
                  <Scatter name="Residuals" data={data.scatterData} fill="#0d9488" />
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 text-xs">
                <span>Chưa có dữ liệu kiểm định phần dư (Residuals) từ các dự báo thực tế.</span>
              </div>
            )}
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
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">CỬA HÀNG / KHO MỤC TIÊU:</label>
          <select
            value={selectedStore}
            onChange={(e) => handleStoreChange(e.target.value)}
            className="sim-store-select"
          >
            {storesList.map((st) => (
              <option key={st} value={st}>Cửa hàng {st}</option>
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
            <span>{isRecomputing ? 'Đang tính toán lại tham số...' : 'Tính toán lại tối ưu ML'}</span>
          </button>
        </div>
      </div>

      {recomputeMsg && (
        <div className="recompute-banner">
          <CheckCircle2 size={16} className="text-slate-700 shrink-0" />
          <span>{recomputeMsg}</span>
        </div>
      )}

      {/* Top Executive KPI Summary Cards (4 Columns) */}
      <div className="policy-summary-cards mb-6">
        {/* Card 1: Static Policy */}
        <div className="policy-stat-card">
          <div className="policy-stat-header">
            <span className="policy-stat-title">CHÍNH SÁCH CƠ SỞ (STATIC)</span>
            <span className="policy-stat-badge">Moving Average</span>
          </div>
          <div className="policy-stat-main">
            <div className="policy-stat-val text-slate-900">
              ${portfolioStats.totalStaticHolding.toLocaleString()}
            </div>
            <div className="policy-stat-sub">Chi phí lưu kho hàng năm (Công thức thống kê truyền thống)</div>
          </div>
          <div className="policy-stat-grid">
            <div className="policy-stat-row">
              <span className="text-slate-500">Phương pháp luận:</span>
              <span className="font-semibold text-slate-700">Moving Avg Sigma</span>
            </div>
            <div className="policy-stat-row">
              <span className="text-slate-500">Cơ chế an toàn:</span>
              <span className="font-semibold text-slate-700">Static Buffer</span>
            </div>
          </div>
        </div>

        {/* Card 2: ML Optimal Policy */}
        <div className="policy-stat-card">
          <div className="policy-stat-header">
            <span className="policy-stat-title">CHÍNH SÁCH TỐI ƯU ML</span>
            <span className="policy-stat-badge highlight">PRODUCTION ML</span>
          </div>
          <div className="policy-stat-main">
            <div className="policy-stat-val text-slate-900">
              ${portfolioStats.totalMlHolding.toLocaleString()}
            </div>
            <div className="policy-stat-sub">Chi phí lưu kho hàng năm (Dự báo nhu cầu ML)</div>
          </div>
          <div className="policy-stat-grid">
            <div className="policy-stat-row">
              <span className="text-slate-500">Quy mô đánh giá:</span>
              <span className="font-semibold text-slate-700">{portfolioStats.totalSkus} SKUs</span>
            </div>
            <div className="policy-stat-row">
              <span className="text-slate-500">Độ lệch chuẩn LT:</span>
              <span className="font-semibold text-slate-700">Dynamic Conformal</span>
            </div>
          </div>
        </div>

        {/* Card 3: Net Annual Holding Savings */}
        <div className="policy-stat-card">
          <div className="policy-stat-header">
            <span className="policy-stat-title">TIẾT KIỆM LƯU KHO RÒNG</span>
            <span className="policy-stat-badge savings">PROVEN SAVINGS</span>
          </div>
          <div className="policy-stat-main">
            <div className="policy-stat-val text-emerald-700">
              +${portfolioStats.totalSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="policy-stat-sub">
              {portfolioStats.avgReductionPct.toFixed(1)}% Giảm tồn kho an toàn trung bình
            </div>
          </div>
          <div className="policy-stat-grid">
            <div className="policy-stat-row">
              <span className="text-slate-500">Giảm lượng đệm kho:</span>
              <span className="font-semibold text-emerald-700">-{portfolioStats.avgReductionPct.toFixed(1)}%</span>
            </div>
            <div className="policy-stat-row">
              <span className="text-slate-500">Vốn lưu động:</span>
              <span className="font-semibold text-emerald-700">Giải phóng cho kinh doanh</span>
            </div>
          </div>
        </div>

        {/* Card 4: Target Service Level */}
        <div className="policy-stat-card">
          <div className="policy-stat-header">
            <span className="policy-stat-title">MỨC PHỤC VỤ MỤC TIÊU</span>
            <span className="policy-stat-badge">TOÀN HỆ THỐNG</span>
          </div>
          <div className="policy-stat-main">
            <div className="policy-stat-val text-slate-900">
              {((serviceLevelConfig?.default_service_level ?? 0.95) * 100).toFixed(1)}%
            </div>
            <div className="policy-stat-sub">Hệ số đáp ứng đơn hàng toàn hệ thống (tau)</div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-center">
            <span className="text-xs text-slate-500">Cấu hình quản trị</span>
            <button
              type="button"
              className="text-xs text-slate-800 hover:text-slate-900 font-semibold px-2 py-0.5 rounded border border-slate-300 hover:bg-slate-50 transition-colors"
              onClick={() => {
                setTargetServiceLevelInput(Math.round((serviceLevelConfig?.default_service_level || 0.95) * 100));
                setIsServiceLevelModalOpen(true);
              }}
            >
              Thiết lập tham số
            </button>
          </div>
        </div>
      </div>

      {/* Main Simulator Grid */}
      <div className="cost-sim-layout-grid">
        {/* Left side: Inputs */}
        <div className="cost-sim-controls">
          <div className="flex items-center gap-2 mb-4">
            <Sliders size={16} className="text-slate-700" />
            <h3 className="mp-panel-title">Tham Số Phân Tích Độ Nhạy</h3>
          </div>

          <div className="sim-input-group">
            <label className="sim-label">Phân khúc sản phẩm mục tiêu</label>
            <select
              className="sim-input-field"
              value={simSegment}
              onChange={(e) => setSimSegment(e.target.value)}
            >
              <option value="All SKUs (Global)">Tất cả SKUs (Toàn bộ danh mục)</option>
              <option value="Segment AX (High Value Stable)">Nhóm AX (Giá trị cao, nhu cầu ổn định)</option>
              <option value="Segment AY (High Value Variable)">Nhóm AY (Giá trị cao, nhu cầu biến động)</option>
              <option value="Segment BX (Medium Value Stable)">Nhóm BX (Giá trị TB, nhu cầu ổn định)</option>
            </select>
          </div>

          <div className="sim-input-group">
            <div className="sim-input-row">
              <label className="sim-label">Mức phục vụ mục tiêu (Service Level)</label>
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
            <div className="sim-range-labels">
              <span>85.0% (Tiết kiệm vốn)</span>
              <span>95.0% (Chuẩn FMCG)</span>
              <span>99.0% (Hàng trọng yếu)</span>
            </div>
          </div>

          <div className="sim-input-group">
            <div className="sim-input-row">
              <label className="sim-label">Thời gian cung ứng kỳ vọng (Lead Time)</label>
              <span className="sim-value-badge">{simLeadTime} Ngày</span>
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
            <div className="sim-range-labels">
              <span>1d Giao nhanh</span>
              <span>7d Tiêu chuẩn</span>
              <span>28d Đường biển</span>
            </div>
          </div>

          <div className="sim-input-group">
            <label className="sim-label">Tỷ suất chi phí giữ hàng năm (%)</label>
            <input
              type="number"
              className="sim-input-field"
              value={simHoldingRate}
              onChange={(e) => {
                const val = Math.max(1, Number(e.target.value));
                setSimHoldingRate(val);
                handleSensitivityUpdate(simServiceLevel, simLeadTime, val, simOrderCost);
              }}
            />
            <span className="sim-input-desc">Bao gồm chi phí vốn, kho bãi, hao hụt & bảo hiểm</span>
          </div>

          <div className="sim-input-group">
            <label className="sim-label">Chi phí đặt hàng cố định ($/đơn)</label>
            <input
              type="number"
              className="sim-input-field"
              value={simOrderCost}
              onChange={(e) => {
                const val = Math.max(0, Number(e.target.value));
                setSimOrderCost(val);
                handleSensitivityUpdate(simServiceLevel, simLeadTime, simHoldingRate, val);
              }}
            />
            <span className="sim-input-desc">Chi phí xử lý chứng từ, tiếp nhận hàng & logistics</span>
          </div>

          <div className="sim-notice-card">
            <div className="sim-notice-title">
              <ShieldCheck size={14} className="text-slate-700" />
              <span>Mô Phỏng Tức Thời Trong Bộ Nhớ</span>
            </div>
            Tính toán trực tiếp theo mô hình đàn hồi tồn kho vi mô, không ghi đè dữ liệu cấu hình vận hành thực tế của cửa hàng.
          </div>
        </div>

        {/* Right side: Outputs & Curve */}
        <div className="cost-sim-outputs">
          {/* Visual Cost Composition Progress Bar */}
          <div className="cost-breakdown-section">
            <div className="cost-breakdown-header">
              <span>CƠ CẤU CHI PHÍ DỰ KIẾN KHI ĐIỀU CHỈNH THAM SỐ</span>
              <span>Lưu giữ kho: {simMetrics.holdingShare}% | Rủi ro thiếu hàng: {simMetrics.stockoutShare}%</span>
            </div>
            <div className="cost-breakdown-bar">
              <div
                className="cost-breakdown-segment holding"
                style={{ width: `${simMetrics.holdingShare}%` }}
                title={`Chi phí lưu kho: $${simMetrics.simHolding.toLocaleString()}`}
              />
              <div
                className="cost-breakdown-segment stockout"
                style={{ width: `${simMetrics.stockoutShare}%` }}
                title={`Rủi ro thiếu hàng: $${simMetrics.simStockout.toLocaleString()}`}
              />
            </div>
            <div className="cost-breakdown-legend">
              <div className="legend-item">
                <span className="legend-dot holding"></span>
                <span>Chi phí giữ hàng dự kiến (${simMetrics.simHolding.toLocaleString()})</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot stockout"></span>
                <span>Tổn thất thiếu hàng dự kiến (${simMetrics.simStockout.toLocaleString()})</span>
              </div>
            </div>
          </div>

          {/* Dynamic Frontier Curve Panel */}
          <div className="cost-sim-chart-panel">
            <div className="cost-chart-header">
              <div>
                <h3 className="cost-chart-title">Đường Biên Chi Phí Tổng Thể Kỳ Vọng Theo Mức Phục Vụ</h3>
                <span className="cost-chart-sub">Đồ thị tương quan Trade-off Frontier (Thời gian cung ứng: {simLeadTime} ngày, Tỷ suất giữ hàng: {simHoldingRate}%)</span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-slate-900 inline-block"></span>
                  <span className="font-semibold text-slate-700">Tổng chi phí</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 border-t border-dashed border-slate-500 inline-block"></span>
                  <span className="text-slate-500">Giữ hàng</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 border-t border-dashed border-amber-600 inline-block"></span>
                  <span className="text-amber-700">Thiếu hàng</span>
                </div>
              </div>
            </div>
            <div style={{ height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sensitivityChartData} margin={{ top: 15, right: 20, bottom: 15, left: 20 }}>
                  <XAxis dataKey="sl" axisLine={{ stroke: '#e2e8f0' }} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(val) => `$${(val / 1000).toFixed(1)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderRadius: '6px', border: 'none', color: '#fff', fontSize: '12px' }}
                    formatter={(val: any, name: any) => [
                      `$${Number(val).toLocaleString()}`,
                      name === 'cost' ? 'Tổng chi phí' : name === 'holding' ? 'Chi phí lưu kho' : 'Rủi ro thiếu hàng'
                    ]}
                  />
                  <ReferenceLine x={`${Math.round(simServiceLevel)}%`} stroke="#0f172a" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="holding" stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="stockout" stroke="#d97706" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="cost" stroke="#0f172a" strokeWidth={2.5} dot={{ r: 4, fill: '#0f172a' }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Strategic Insights Card */}
          <div className="sim-insights-card">
            <div className="sim-insights-header">
              <Lightbulb size={16} className="text-slate-700" />
              <h4 className="sim-insights-title">Thông Tin Tối Ưu Hóa Chiến Lược</h4>
            </div>
            <ul className="sim-insights-list">
              {sensitivityData?.insights && sensitivityData.insights.length > 0 ? (
                sensitivityData.insights.map((ins: string, idx: number) => (
                  <li key={idx} className="sim-insights-item">
                    <span className="sim-insights-bullet">•</span>
                    <span>{ins}</span>
                  </li>
                ))
              ) : (
                <li className="sim-insights-item text-slate-400 italic">
                  Đang tổng hợp thông tin tối ưu hóa chiến lược từ mô hình phân tích Backend...
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Detailed Policy Cost Comparison Summary Table */}
      <div className="cost-sim-table-panel mt-6">
        <div className="sim-table-header-row">
          <div>
            <h3 className="sim-table-title">Bảng Đối So Sánh Chi Tiết: Mô Hình ML vs. Thống Kê Truyền Thống</h3>
            <div className="sim-table-sub">
              So sánh chi tiết tồn kho an toàn, điểm đặt hàng và chi phí lưu kho theo từng mã sản phẩm tại Cửa hàng {selectedStore}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Tìm kiếm mã SKU, tên sản phẩm..."
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
                <option key={c} value={c}>Ngành hàng: {c === 'All' ? 'Tất cả' : c}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="sim-table-elevated">
            <thead>
              <tr>
                <th>MÃ SKU / TÊN SẢN PHẨM</th>
                <th>NGÀNH HÀNG</th>
                <th>MỨC PHỤC VỤ / LT</th>
                <th className="text-right">TỒN KHO AN TOÀN (ML vs STATIC)</th>
                <th className="text-right">ĐIỂM ĐẶT HÀNG (ROP)</th>
                <th className="text-right">EOQ</th>
                <th className="text-right">TIẾT KIỆM LƯU KHO/NĂM</th>
              </tr>
            </thead>
            <tbody>
              {effectiveCompareItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-400">
                    Chưa có dữ liệu so sánh chính sách ML vs Static cho cửa hàng này. Vui lòng bấm &quot;Tính toán lại tối ưu ML&quot; để hệ thống cập nhật.
                  </td>
                </tr>
              ) : filteredCompareItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-400">
                    Không tìm thấy sản phẩm phù hợp với bộ lọc tìm kiếm.
                  </td>
                </tr>
              ) : (
                paginatedCompareItems.map((item: any, idx: number) => {
                  const ssDiff = item.ss_difference != null ? item.ss_difference : (item.static_safety_stock - item.ml_safety_stock);
                  const isSaving = (item.holding_cost_savings ?? 0) >= 0;
                  return (
                    <tr key={item.item_id || idx}>
                      <td>
                        <div className="font-bold text-slate-900">{item.item_id}</div>
                        <div className="text-[11px] text-slate-500">{item.product_name || item.item_id}</div>
                      </td>
                      <td>
                        <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200">
                          {item.category || 'General'}
                        </span>
                      </td>
                      <td>
                        <div className="text-xs font-medium text-slate-800">
                          {((item.service_level || 0.95) * 100).toFixed(0)}% SL
                        </div>
                        <div className="text-[11px] text-slate-400">{item.lead_time_days || 7}d Lead Time</div>
                      </td>
                      <td className="text-right">
                        <div className="font-mono text-xs">
                          <strong className="text-slate-900">{item.ml_safety_stock?.toFixed(1) || '0.0'}</strong>{' '}
                          <span className="text-slate-400">vs</span>{' '}
                          <span className="text-slate-500 line-through">{item.static_safety_stock?.toFixed(1) || '0.0'}</span>
                        </div>
                        {ssDiff > 0 && (
                          <span className="mp-delta-pill success text-[10px] mt-0.5">
                            -{ssDiff.toFixed(1)} đệm kho
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        <div className="font-mono text-xs">
                          <strong className="text-slate-900">{item.ml_reorder_point?.toFixed(1) || '0.0'}</strong>{' '}
                          <span className="text-slate-400">vs</span>{' '}
                          <span className="text-slate-500">{item.static_reorder_point?.toFixed(1) || '0.0'}</span>
                        </div>
                      </td>
                      <td className="text-right font-mono text-xs font-semibold text-slate-800">
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
          <div className="mt-4">
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
          </div>
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
