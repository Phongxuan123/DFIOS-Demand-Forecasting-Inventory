import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, 
  Activity, 
  Grid, 
  Download, 
  Play, 
  RefreshCw, 
  ArrowLeft, 
  CheckCircle2, 
  ChevronRight 
} from 'lucide-react';
import { api } from '../services/api.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import './Reports.css';

export const Reports: React.FC = () => {
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const [selectedStore, setSelectedStore] = useState<string>('CA_1');

  // Logs state
  const [data, setData] = useState<any>(() => ({
    templates: [
      { title: 'Forecast Accuracy Analysis (UC39)', desc: 'MAE, RMSE, MASE, WRMSSE split by ABC class & top deviating SKUs', icon: 'TrendingUp', id: 'forecast-accuracy' },
      { title: 'Inventory Turnover & DOS (UC40)', desc: 'Days of Supply, turnover ratios, dead stock, and active inventory valuation', icon: 'Activity', id: 'inventory-performance' },
      { title: 'Historical Backtesting Simulation (UC41)', desc: 'Simulate stockout reduction and service-level achievement over historical periods', icon: 'Play', id: 'backtest' },
      { title: 'Cost Comparison: ML vs Baseline (UC42)', desc: 'Holding, ordering, and stockout penalty cost analysis across categories', icon: 'Grid', id: 'cost-comparison' },
    ],
    logs: [],
  }));
  const [isLoading, setIsLoading] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(5);

  // Active Report Details State
  const [accuracyReport, setAccuracyReport] = useState<any>(null);
  const [inventoryReport, setInventoryReport] = useState<any>(null);
  const [costReport, setCostReport] = useState<any>(null);
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // Backtest Simulation Params
  const [btModel, setBtModel] = useState('lightgbm');
  const [btDays, setBtDays] = useState(28);
  const [btServiceLevel, setBtServiceLevel] = useState(95);
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);

  // Load audit logs on mount
  const loadReportsData = async () => {
    try {
      const result = await api.reports.getRecentLogs();
      if (result) setData(result);
    } catch (error) {
      console.error('Failed to load reports data', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReportsData();
  }, []);

  const paginatedLogs = useMemo(() => {
    const logs = data?.logs || [];
    const start = (logPage - 1) * logPageSize;
    return logs.slice(start, start + logPageSize);
  }, [data?.logs, logPage, logPageSize]);

  // Load specific report data when activated
  const handleOpenReport = async (reportId: string) => {
    setActiveReport(reportId);
    setIsReportLoading(true);
    setFeedbackMsg('');

    try {
      if (reportId === 'forecast-accuracy') {
        const res = await api.reports.getForecastAccuracy({ store_id: selectedStore, model_name: 'lightgbm' });
        setAccuracyReport(res);
      } else if (reportId === 'inventory-performance') {
        const res = await api.reports.getInventoryPerformance({ store_id: selectedStore, limit: 50 });
        setInventoryReport(res);
      } else if (reportId === 'cost-comparison') {
        const res = await api.reports.getCostComparison({ store_id: selectedStore });
        setCostReport(res);
      } else if (reportId === 'backtest') {
        // Run initial default backtest
        const res = await api.reports.runBacktesting({
          model_name: btModel,
          backtest_days: btDays,
          store_id: selectedStore,
          target_service_level: btServiceLevel / 100,
        });
        setBacktestResult(res);
      }
    } catch (err) {
      console.error(`Failed to load report ${reportId}`, err);
    } finally {
      setIsReportLoading(false);
    }
  };

  const handleRunBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRunningBacktest(true);
    try {
      const res = await api.reports.runBacktesting({
        model_name: btModel,
        backtest_days: btDays,
        store_id: selectedStore,
        target_service_level: btServiceLevel / 100,
      });
      setBacktestResult(res);
      setFeedbackMsg('Simulation completed with latest historical parameters.');
      setTimeout(() => setFeedbackMsg(''), 4000);
    } catch (err: any) {
      setFeedbackMsg(err.response?.data?.detail || 'Failed to execute backtest');
    } finally {
      setIsRunningBacktest(false);
    }
  };

  const handleDownloadCsv = async (reportType: string) => {
    setIsExporting(true);
    try {
      await api.reports.downloadReportCsv(reportType, selectedStore);
      setFeedbackMsg(`Exported ${reportType} CSV successfully!`);
      setTimeout(() => setFeedbackMsg(''), 4000);
    } catch (err) {
      console.error('Export error', err);
      setFeedbackMsg('Export failed. Please check network.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="reports-container">
      {/* Executive Header Section */}
      <div className="reports-top-header">
        <div>
          <h1 className="reports-main-title">
            <span>Executive Reports & Supply Chain Intelligence</span>
          </h1>
          <p className="reports-main-subtitle">
            Strategic decision-making analytics: Forecast accuracy benchmarks, inventory velocity, multi-horizon simulation, and financial impact.
          </p>
        </div>

        <div className="reports-store-picker">
          <span className="reports-store-label">Location:</span>
          <select
            className="reports-store-select"
            value={selectedStore}
            onChange={(e) => {
              setSelectedStore(e.target.value);
              if (activeReport) handleOpenReport(activeReport);
            }}
          >
            <option value="CA_1">CA_1 (California 1)</option>
            <option value="CA_2">CA_2 (California 2)</option>
            <option value="TX_1">TX_1 (Texas 1)</option>
            <option value="WI_1">WI_1 (Wisconsin 1)</option>
          </select>
        </div>
      </div>

      {feedbackMsg && (
        <div className="reports-feedback-banner">
          <CheckCircle2 size={16} />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* 4 Primary Executive Report Cards */}
      {!activeReport && (
        <div className="reports-cards-grid">
          {/* Card 1: Forecast Accuracy */}
          <div className="executive-report-card" onClick={() => handleOpenReport('forecast-accuracy')}>
            <div>
              <div className="exec-card-header">
                <div className="exec-icon-box">
                  <TrendingUp size={20} />
                </div>
                <span className="exec-badge">
                  <span className="exec-badge-dot" />
                  Accuracy Benchmark
                </span>
              </div>
              <h3 className="exec-card-title">Forecast Accuracy & Error Analysis</h3>
              <p className="exec-card-desc">
                Evaluates MAE, RMSE, MASE, and WRMSSE across ABC classes to identify precision and top deviating SKUs against actual demand.
              </p>
              <div className="exec-card-meta-chips">
                <span className="exec-meta-chip">MASE & WRMSSE</span>
                <span className="exec-meta-chip">ABC Breakdown</span>
                <span className="exec-meta-chip">Variance Audit</span>
              </div>
            </div>
            <button className="exec-action-button">
              <span>View Accuracy Report</span>
              <ChevronRight size={15} className="exec-action-arrow" />
            </button>
          </div>

          {/* Card 2: Inventory Velocity */}
          <div className="executive-report-card" onClick={() => handleOpenReport('inventory-performance')}>
            <div>
              <div className="exec-card-header">
                <div className="exec-icon-box">
                  <Activity size={20} />
                </div>
                <span className="exec-badge">
                  <span className="exec-badge-dot" />
                  Inventory Velocity
                </span>
              </div>
              <h3 className="exec-card-title">Inventory Turnover & Days of Supply</h3>
              <p className="exec-card-desc">
                Capital efficiency metrics: inventory turnover ratio, Days of Supply (DOS), working capital valuation, and stockout vulnerability.
              </p>
              <div className="exec-card-meta-chips">
                <span className="exec-meta-chip">Days of Supply (DOS)</span>
                <span className="exec-meta-chip">Turnover Velocity</span>
                <span className="exec-meta-chip">Stockout Audit</span>
              </div>
            </div>
            <button className="exec-action-button">
              <span>View Turnover Report</span>
              <ChevronRight size={15} className="exec-action-arrow" />
            </button>
          </div>

          {/* Card 3: Historical Backtesting */}
          <div className="executive-report-card" onClick={() => handleOpenReport('backtest')}>
            <div>
              <div className="exec-card-header">
                <div className="exec-icon-box">
                  <Play size={20} />
                </div>
                <span className="exec-badge">
                  <span className="exec-badge-dot" style={{ background: '#f59e0b' }} />
                  Simulation Engine
                </span>
              </div>
              <h3 className="exec-card-title">Historical Backtesting Simulation</h3>
              <p className="exec-card-desc">
                Simulates real-world replenishment policy performance, stockout reduction percentage, and holding cost savings under true demand history.
              </p>
              <div className="exec-card-meta-chips">
                <span className="exec-meta-chip">Service Level Target</span>
                <span className="exec-meta-chip">Stockout Prevention</span>
                <span className="exec-meta-chip">Holding Savings</span>
              </div>
            </div>
            <button className="exec-action-button">
              <span>Run Backtest Simulation</span>
              <ChevronRight size={15} className="exec-action-arrow" />
            </button>
          </div>

          {/* Card 4: Cost Comparison */}
          <div className="executive-report-card" onClick={() => handleOpenReport('cost-comparison')}>
            <div>
              <div className="exec-card-header">
                <div className="exec-icon-box">
                  <Grid size={20} />
                </div>
                <span className="exec-badge">
                  <span className="exec-badge-dot" style={{ background: '#0d9488' }} />
                  Financial Impact
                </span>
              </div>
              <h3 className="exec-card-title">Cost Comparison: ML vs Static Policy</h3>
              <p className="exec-card-desc">
                Comprehensive financial impact model: holding expenses, order processing costs, and stockout penalty comparisons across categories.
              </p>
              <div className="exec-card-meta-chips">
                <span className="exec-meta-chip">Net Dollar Savings</span>
                <span className="exec-meta-chip">Holding vs Ordering</span>
                <span className="exec-meta-chip">Category Breakdown</span>
              </div>
            </div>
            <button className="exec-action-button">
              <span>View Cost Analysis</span>
              <ChevronRight size={15} className="exec-action-arrow" />
            </button>
          </div>
        </div>
      )}

      {/* ACTIVE REPORT DETAIL VIEW */}
      {activeReport && (
        <div className="report-detail-wrapper">
          <div className="detail-top-nav">
            <button
              onClick={() => setActiveReport(null)}
              className="detail-back-btn"
            >
              <ArrowLeft size={15} /> <span>Back to All Reports</span>
            </button>

            <button
              onClick={() => handleDownloadCsv(activeReport)}
              disabled={isExporting}
              className="detail-export-btn"
            >
              <Download size={14} />
              <span>{isExporting ? 'Exporting...' : 'Export Data (CSV)'}</span>
            </button>
          </div>

          {isReportLoading ? (
            <div style={{ textAlign: 'center', padding: '3.5rem', color: '#64748b' }}>
              <RefreshCw size={24} className="animate-spin mb-3" style={{ margin: '0 auto', color: '#0f172a' }} />
              <p style={{ margin: 0, fontWeight: 500, fontSize: '0.875rem' }}>Retrieving report intelligence from backend...</p>
            </div>
          ) : (
            <>
              {/* REPORT 1: FORECAST ACCURACY */}
              {activeReport === 'forecast-accuracy' && accuracyReport && (
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.35rem 0' }}>
                    Forecast Accuracy Evaluation — {accuracyReport.model_name?.toUpperCase() || 'CHAMPION'}
                  </h2>
                  <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1.5rem 0' }}>
                    Evaluated Period: <strong style={{ color: '#1e293b' }}>{accuracyReport.evaluated_period || 'Last 28 Days'}</strong> &bull; Location: <strong style={{ color: '#1e293b' }}>{accuracyReport.store_id || selectedStore}</strong>
                  </p>

                  <div className="detail-kpi-grid">
                    <div className="detail-kpi-tile">
                      <span className="detail-kpi-label">WRMSSE (COMPETITION METRIC)</span>
                      <h3 className="detail-kpi-value" style={{ color: '#0f172a' }}>
                        {accuracyReport.overall_metrics?.wrmsse != null ? accuracyReport.overall_metrics.wrmsse.toFixed(4) : '-'}
                      </h3>
                      <div className="detail-kpi-subtext">Weighted Root Mean Squared Scaled Error</div>
                    </div>
                    <div className="detail-kpi-tile">
                      <span className="detail-kpi-label">MASE (SCALED ERROR)</span>
                      <h3 className="detail-kpi-value" style={{ color: '#0f172a' }}>
                        {accuracyReport.overall_metrics?.mase != null ? accuracyReport.overall_metrics.mase.toFixed(3) : '-'}
                      </h3>
                      <div className="detail-kpi-subtext">Baseline Benchmark (&lt; 1.0 beats naive)</div>
                    </div>
                    <div className="detail-kpi-tile">
                      <span className="detail-kpi-label">MAE (MEAN ABS ERROR)</span>
                      <h3 className="detail-kpi-value" style={{ color: '#0f172a' }}>
                        {accuracyReport.overall_metrics?.mae != null ? accuracyReport.overall_metrics.mae.toFixed(2) : '-'}
                      </h3>
                      <div className="detail-kpi-subtext">Average unit deviation per SKU/day</div>
                    </div>
                    <div className="detail-kpi-tile">
                      <span className="detail-kpi-label">RMSE</span>
                      <h3 className="detail-kpi-value" style={{ color: '#0f172a' }}>
                        {accuracyReport.overall_metrics?.rmse != null ? accuracyReport.overall_metrics.rmse.toFixed(2) : '-'}
                      </h3>
                      <div className="detail-kpi-subtext">Residual variance magnitude</div>
                    </div>
                  </div>

                  <h3 className="rep-section-heading">ABC Segment Performance Breakdown</h3>
                  <div className="rep-table-wrapper">
                    <table className="rep-table">
                      <thead>
                        <tr>
                          <th>Segment Class</th>
                          <th style={{ textAlign: 'right' }}>WRMSSE</th>
                          <th style={{ textAlign: 'right' }}>MASE</th>
                          <th style={{ textAlign: 'right' }}>MAE</th>
                          <th style={{ textAlign: 'right' }}>Sample Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(accuracyReport.abc_breakdown || {}).map(([cls, met]: [string, any]) => (
                          <tr key={cls}>
                            <td style={{ fontWeight: 700, color: '#0f172a' }}>Class {cls}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#0f172a' }}>{met.wrmsse?.toFixed(4) || '-'}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{met.mase?.toFixed(3) || '-'}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{met.mae?.toFixed(2) || '-'}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#64748b' }}>{met.sample_count != null ? met.sample_count : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* REPORT 2: INVENTORY TURNOVER */}
              {activeReport === 'inventory-performance' && inventoryReport && (
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.35rem 0' }}>
                    Inventory Velocity & Turnover Report
                  </h2>
                  <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1.5rem 0' }}>
                    Location: <strong style={{ color: '#1e293b' }}>{inventoryReport.store_id || selectedStore}</strong> &bull; Total Tracked SKUs: <strong style={{ color: '#1e293b' }}>{inventoryReport.total?.toLocaleString() || '-'}</strong>
                  </p>

                  <div className="detail-kpi-grid">
                    <div className="detail-kpi-tile">
                      <span className="detail-kpi-label">TOTAL INVENTORY VALUATION</span>
                      <h3 className="detail-kpi-value">
                        ${Number(inventoryReport.total_inventory_value || 0).toLocaleString()}
                      </h3>
                      <div className="detail-kpi-subtext">Active capital tied in stock</div>
                    </div>
                    <div className="detail-kpi-tile">
                      <span className="detail-kpi-label">AVERAGE TURNOVER RATIO</span>
                      <h3 className="detail-kpi-value">
                        {inventoryReport.average_turnover_ratio != null ? `${inventoryReport.average_turnover_ratio.toFixed(1)}x` : '-'}
                      </h3>
                      <div className="detail-kpi-subtext">Annual inventory velocity cycles</div>
                    </div>
                    <div className="detail-kpi-tile">
                      <span className="detail-kpi-label">DAYS OF SUPPLY (DOS)</span>
                      <h3 className="detail-kpi-value">
                        {inventoryReport.average_days_of_supply != null ? `${inventoryReport.average_days_of_supply.toFixed(1)} d` : '-'}
                      </h3>
                      <div className="detail-kpi-subtext">Depletion timeline at current demand</div>
                    </div>
                    <div className="detail-kpi-tile">
                      <span className="detail-kpi-label">STOCKOUT SKUS (ZERO ON-HAND)</span>
                      <h3 className="detail-kpi-value" style={{ color: (inventoryReport.stockout_skus_count || 0) > 0 ? '#b91c1c' : '#0f172a' }}>
                        {inventoryReport.stockout_skus_count || 0}
                      </h3>
                      <div className="detail-kpi-subtext">Critical replenishment attention</div>
                    </div>
                  </div>

                  <h3 className="rep-section-heading">SKU Velocity & Valuation Details</h3>
                  <div className="rep-table-wrapper">
                    <table className="rep-table">
                      <thead>
                        <tr>
                          <th>SKU & Product Name</th>
                          <th>Category</th>
                          <th style={{ textAlign: 'right' }}>On Hand</th>
                          <th style={{ textAlign: 'right' }}>Daily Run Rate</th>
                          <th style={{ textAlign: 'right' }}>Days of Supply</th>
                          <th style={{ textAlign: 'right' }}>Turnover</th>
                          <th style={{ textAlign: 'right' }}>Valuation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(inventoryReport.items || []).slice(0, 15).map((it: any) => (
                          <tr key={it.item_id}>
                            <td>
                              <div style={{ fontWeight: 700, color: '#0f172a' }}>{it.item_id}</div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{it.product_name}</div>
                            </td>
                            <td><span className="category-tag">{it.category}</span></td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{it.on_hand}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{it.daily_demand != null ? it.daily_demand.toFixed(1) : '-'}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{it.days_of_supply != null ? `${it.days_of_supply.toFixed(1)}d` : '-'}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#0f172a' }}>{it.turnover_ratio != null ? `${it.turnover_ratio.toFixed(1)}x` : '-'}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>${it.inventory_value != null ? it.inventory_value.toFixed(2) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* REPORT 3: HISTORICAL BACKTESTING */}
              {activeReport === 'backtest' && (
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.35rem 0' }}>
                    Historical Backtesting Simulation
                  </h2>
                  <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1.5rem 0' }}>
                    Simulate replenishment policy effectiveness and stockout prevention under historical demand replay.
                  </p>

                  <form onSubmit={handleRunBacktest} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.5rem', padding: '1.25rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div>
                      <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Model</label>
                      <select value={btModel} onChange={(e) => setBtModel(e.target.value)} style={{ padding: '0.45rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8125rem', background: '#ffffff', color: '#0f172a' }}>
                        <option value="lightgbm">LightGBM Production</option>
                        <option value="tft">TFT Deep Learning</option>
                        <option value="arima">Seasonal ARIMA</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Backtest Horizon (Days)</label>
                      <input type="number" min="7" max="90" value={btDays} onChange={(e) => setBtDays(Number(e.target.value))} style={{ padding: '0.45rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8125rem', width: '110px', background: '#ffffff' }} />
                    </div>

                    <div>
                      <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Target Service Level (%)</label>
                      <input type="number" min="80" max="99" value={btServiceLevel} onChange={(e) => setBtServiceLevel(Number(e.target.value))} style={{ padding: '0.45rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8125rem', width: '110px', background: '#ffffff' }} />
                    </div>

                    <button
                      type="submit"
                      disabled={isRunningBacktest}
                      className="detail-export-btn"
                      style={{ height: '36px' }}
                    >
                      <Play size={13} />
                      <span>{isRunningBacktest ? 'Simulating...' : 'Run Simulation'}</span>
                    </button>
                  </form>

                  {backtestResult && (
                    <div className="detail-kpi-grid">
                      <div className="detail-kpi-tile">
                        <span className="detail-kpi-label">STOCKOUT REDUCTION</span>
                        <h3 className="detail-kpi-value" style={{ color: '#047857' }}>
                          {backtestResult.stockout_reduction_pct != null ? `-${backtestResult.stockout_reduction_pct.toFixed(1)}%` : '-'}
                        </h3>
                        <div className="detail-kpi-subtext">
                          Baseline: {backtestResult.baseline_stockouts ?? '-'} &rarr; ML: {backtestResult.ml_stockouts ?? '-'} events
                        </div>
                      </div>

                      <div className="detail-kpi-tile">
                        <span className="detail-kpi-label">HOLDING COST SAVINGS</span>
                        <h3 className="detail-kpi-value" style={{ color: '#0f172a' }}>
                          {backtestResult.holding_cost_savings != null ? `+$${Number(backtestResult.holding_cost_savings).toLocaleString()}` : '-'}
                        </h3>
                        <div className="detail-kpi-subtext">Safety stock buffer optimization</div>
                      </div>

                      <div className="detail-kpi-tile">
                        <span className="detail-kpi-label">SERVICE LEVEL ACHIEVED</span>
                        <h3 className="detail-kpi-value" style={{ color: '#0f172a' }}>
                          {backtestResult.service_level_achieved != null ? `${(backtestResult.service_level_achieved * 100).toFixed(1)}%` : '-'}
                        </h3>
                        <div className="detail-kpi-subtext">Target: {btServiceLevel}% SLA target</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* REPORT 4: COST COMPARISON */}
              {activeReport === 'cost-comparison' && costReport && (
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.35rem 0' }}>
                    Financial Impact & Cost Optimization: ML vs Static Policy
                  </h2>
                  <p style={{ fontSize: '0.8125rem', color: '#64748b', margin: '0 0 1.5rem 0' }}>
                    Location: <strong style={{ color: '#1e293b' }}>{costReport.store_id || selectedStore}</strong> &bull; Total Evaluated SKUs: <strong style={{ color: '#1e293b' }}>{costReport.total_skus || '-'}</strong>
                  </p>

                  <div className="detail-kpi-grid">
                    <div className="detail-kpi-tile">
                      <span className="detail-kpi-label">NET FINANCIAL SAVINGS</span>
                      <h3 className="detail-kpi-value" style={{ color: '#047857' }}>
                        +${Number(costReport.cost_savings_amount || 0).toLocaleString()}
                      </h3>
                      <div className="detail-kpi-subtext">
                        {costReport.savings_percentage != null ? `${costReport.savings_percentage.toFixed(1)}% net cost reduction` : 'Annualized net gain'}
                      </div>
                    </div>

                    <div className="detail-kpi-tile">
                      <span className="detail-kpi-label">ML TOTAL ANNUALIZED COST</span>
                      <h3 className="detail-kpi-value" style={{ color: '#0f172a' }}>
                        ${Number(costReport.ml_policy?.total_cost || 0).toLocaleString()}
                      </h3>
                      <div className="detail-kpi-subtext">
                        Holding: ${Number(costReport.ml_policy?.holding_cost || 0).toLocaleString()}
                      </div>
                    </div>

                    <div className="detail-kpi-tile">
                      <span className="detail-kpi-label">STATIC BASELINE COST</span>
                      <h3 className="detail-kpi-value" style={{ color: '#64748b' }}>
                        ${Number(costReport.baseline_policy?.total_cost || 0).toLocaleString()}
                      </h3>
                      <div className="detail-kpi-subtext">
                        Holding: ${Number(costReport.baseline_policy?.holding_cost || 0).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <h3 className="rep-section-heading">Category Cost Breakdown</h3>
                  <div className="rep-table-wrapper">
                    <table className="rep-table">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th style={{ textAlign: 'right' }}>Net Savings Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(costReport.category_savings || {}).map(([cat, sav]: [string, any]) => (
                          <tr key={cat}>
                            <td style={{ fontWeight: 700, color: '#0f172a' }}>{cat}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#047857' }}>
                              +${Number(sav || 0).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Generated Reports & Audit Logs Table */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)' }}>
        <h2 className="rep-section-heading">Export History & Generated Reports</h2>

        <div className="rep-table-wrapper">
          <table className="rep-table">
            <thead>
              <tr>
                <th>Report Artifact</th>
                <th>Category</th>
                <th>Generated Date</th>
                <th>Format</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                    Loading system reports...
                  </td>
                </tr>
              ) : paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                    No report exports recorded yet. Click "Export Data (CSV)" in any report to generate downloads.
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((log: any, idx: number) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 600, color: '#0f172a' }}>{log.name}</td>
                    <td>
                      <span className="category-tag">{log.type}</span>
                    </td>
                    <td style={{ color: '#64748b', fontFamily: 'monospace', fontSize: '0.75rem' }}>{log.date}</td>
                    <td style={{ color: '#475569', fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 600 }}>{log.format}</td>
                    <td>
                      <span className="status-pill-ready">
                        {log.status === 'READY' ? 'Ready' : log.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="download-link-btn"
                        onClick={() => handleDownloadCsv(log.type.toLowerCase().includes('accuracy') ? 'forecast-accuracy' : 'inventory')}
                      >
                        <Download size={14} />
                        <span>Download</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data?.logs?.length > 0 && (
          <Pagination
            currentPage={logPage}
            totalItems={data.logs.length}
            pageSize={logPageSize}
            onPageChange={setLogPage}
            onPageSizeChange={(sz) => {
              setLogPageSize(sz);
              setLogPage(1);
            }}
            pageSizeOptions={[5, 10, 20]}
          />
        )}
      </div>
    </div>
  );
};
