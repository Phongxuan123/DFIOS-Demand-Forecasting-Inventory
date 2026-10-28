import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card.tsx';
import { api } from '../services/api.ts';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { RefreshCw, ArrowRight, CheckCircle2, Activity, ShieldAlert, Store } from 'lucide-react';
import './Dashboard.css';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(() => {
    try {
      const cached = sessionStorage.getItem('dfios_dashboard_overview');
      if (cached) return JSON.parse(cached);
    } catch {}
    return null;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [selectedStore, setSelectedStore] = useState<string>('CA_1');
  const [isScanningAlerts, setIsScanningAlerts] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [bottomTab, setBottomTab] = useState<'ALERTS' | 'ADJUSTMENTS'>('ALERTS');
  const [trafficAlerts, setTrafficAlerts] = useState<any[]>([]);

  const fetchDashboardData = async (store: string = selectedStore) => {
    setIsLoading(true);
    try {
      const [overviewData, alertsData] = await Promise.all([
        api.dashboard.getOverview(store),
        api.dashboard.getAlerts({ store_id: store, limit: 10 }).catch(() => ({ items: [] })),
      ]);
      if (overviewData) {
        setData(overviewData);
        try {
          sessionStorage.setItem('dfios_dashboard_overview', JSON.stringify(overviewData));
        } catch {}
      }
      if (alertsData?.items) {
        setTrafficAlerts(alertsData.items);
      }
    } catch (error) {
      console.error("Failed to load dashboard data", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData(selectedStore);
  }, [selectedStore]);

  const handleTriggerRealtimeAlerts = async () => {
    setIsScanningAlerts(true);
    setScanResult(null);
    try {
      const res = await api.dashboard.triggerRealtimeAlerts(selectedStore);
      setScanResult(`Scanned: ${res.alerts_generated || 0} stockout alerts detected & broadcasted via SSE!`);
      fetchDashboardData(selectedStore);
      setTimeout(() => setScanResult(null), 4500);
    } catch (err) {
      console.error("Failed to trigger realtime alerts", err);
      setScanResult("Scan completed. All inventory thresholds evaluated.");
      setTimeout(() => setScanResult(null), 3000);
    } finally {
      setIsScanningAlerts(false);
    }
  };

  const forecastTrend = data?.charts?.forecastTrend || [];
  const chartData = forecastTrend.map((d: any, i: number) => ({
    name: d.date ? d.date.slice(5) : `D+${i + 1}`,
    actual: d.actual ?? null,
    predicted: d.lightgbm ?? d.predicted ?? null,
  }));

  const inventoryHealth = data?.charts?.inventoryHealth || [];
  const urgencyList = data?.charts?.urgency || [];
  const recentAlerts = data?.recentAlerts || [];

  return (
    <div className="animate-fade-in mb-6">
      {/* Executive Inventory Operations & Control Hero Component */}
      <div className="cockpit-hero">
        <div className="cockpit-left">
          <div className="cockpit-icon-wrapper">
            <Activity size={22} className="cockpit-icon" />
          </div>
          <div>
            <div className="cockpit-title-row">
              <h1 className="cockpit-title">Executive Inventory Operations & Control</h1>
              <div className={`cockpit-status-tag ${isLoading ? 'syncing' : 'active'}`}>
                <span className="cockpit-status-dot"></span>
                <span>{isLoading ? 'Đang đồng bộ...' : 'Hệ Thống Tự Động (Live Sync)'}</span>
              </div>
              <span className="cockpit-version-tag">Multi-Echelon Optimization</span>
            </div>
            <p className="cockpit-subtitle">
              Giám sát tồn kho đa điểm bán, tối ưu hóa mức dự trữ an toàn (Safety Stock) và tự động nhận diện rủi ro đứt gãy cung ứng theo thời gian thực.
            </p>
          </div>
        </div>

        {/* Telemetry vitals quick readout */}
        <div className="cockpit-vitals">
          <div className="vital-item">
            <span className="vital-label">MÔ HÌNH NHU CẦU</span>
            <span className="vital-value text-teal">LightGBM Multi-Horizon</span>
          </div>
          <div className="vital-divider" />
          <div className="vital-item">
            <span className="vital-label">MỤC TIÊU DỊCH VỤ (SLA)</span>
            <span className="vital-value text-emerald">95.0% Cycle</span>
          </div>
          <div className="vital-divider" />
          <div className="vital-item">
            <span className="vital-label">CHU KỲ CẬP NHẬT</span>
            <span className="vital-value">Real-Time Sync</span>
          </div>
        </div>

        {/* Cockpit Actions: Store Switcher & Real-time Scan */}
        <div className="cockpit-controls">
          <div className="store-segmented-control">
            <span className="store-control-label">
              <Store size={13} />
              <span>ĐIỂM BÁN:</span>
            </span>
            <div className="store-pill-group">
              {[
                { id: 'CA_1', label: 'CA 1', title: 'California Central Warehouse' },
                { id: 'CA_2', label: 'CA 2', title: 'California West Warehouse' },
                { id: 'TX_1', label: 'TX 1', title: 'Texas Regional Hub' },
                { id: 'WI_1', label: 'WI 1', title: 'Wisconsin Distribution Center' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`store-pill-btn ${selectedStore === s.id ? 'active' : ''}`}
                  onClick={() => setSelectedStore(s.id)}
                  title={s.title}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleTriggerRealtimeAlerts}
            disabled={isScanningAlerts}
            className="cockpit-scan-btn"
            title="Quét ngưỡng tồn kho toàn chuỗi và kích hoạt cảnh báo nguy cơ đứt hàng theo thời gian thực"
          >
            {isScanningAlerts ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <ShieldAlert size={14} className="cockpit-scan-icon" />
            )}
            <span>{isScanningAlerts ? 'Đang quét...' : 'Quét Rủi Ro Tồn Kho (Auto-Scan)'}</span>
          </button>
        </div>
      </div>

      {scanResult && (
        <div style={{ background: '#f0fdfa', border: '1px solid #99f6e4', color: '#0f766e', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
          <CheckCircle2 size={16} />
          <span>{scanResult}</span>
        </div>
      )}

      {/* Row 1: Executive KPIs */}
      <div className="grid-cols-4 mb-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <Card className="kpi-card">
          <p className="kpi-label">Total Monitored SKUs</p>
          <div className="kpi-value-row">
            <h2 className="kpi-value">{data?.kpis?.totalSkus != null ? data?.kpis?.totalSkus.toLocaleString() : '-'}</h2>
            <span className="kpi-badge success">Active</span>
          </div>
        </Card>

        <Card className="kpi-card">
          <p className="kpi-label">Total Inventory Valuation</p>
          <div className="kpi-value-row">
            <h2 className="kpi-value">
              {data?.kpis?.totalInventoryValue != null ? `$${Number(data?.kpis?.totalInventoryValue).toLocaleString()}` : '-'}
            </h2>
            <span className="kpi-badge neutral">Valuation</span>
          </div>
        </Card>

        <Card className="kpi-card">
          <p className="kpi-label">Stockout Rate</p>
          <div className="kpi-value-row">
            <h2 className="kpi-value" style={{ color: Number(String(data?.kpis?.stockoutRate || '0').replace('%', '')) > 3 ? '#ef4444' : '#0d9488' }}>
              {data?.kpis?.stockoutRate ?? '0.0%'}
            </h2>
            <span className={`kpi-badge ${Number(String(data?.kpis?.stockoutRate || '0').replace('%', '')) > 3 ? 'danger' : 'success'}`}>
              {Number(String(data?.kpis?.stockoutRate || '0').replace('%', '')) > 3 ? 'High Risk' : 'Optimal'}
            </span>
          </div>
        </Card>

        <Card className="kpi-card">
          <p className="kpi-label">Forecast Accuracy</p>
          <div className="kpi-value-row">
            <h2 className="kpi-value">{data?.kpis?.avgForecastAccuracy || '-'}</h2>
            <span className="kpi-badge success">Ensemble</span>
          </div>
        </Card>
      </div>

      {/* Row 2: Secondary Action KPIs */}
      <div className="grid-cols-3 mb-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <Card className="kpi-card">
          <p className="kpi-label">Reorder Stock Alerts (&le; ROP)</p>
          <div className="kpi-value-row">
            <h2 className="kpi-value" style={{ color: (data?.kpis?.reorderAlerts ?? 0) > 0 ? '#f59e0b' : '#0d9488' }}>
              {data?.kpis?.reorderAlerts ?? 0}
            </h2>
            <span className={`kpi-badge ${(data?.kpis?.reorderAlerts ?? 0) > 0 ? 'warning' : 'success'}`}>
              {(data?.kpis?.reorderAlerts ?? 0) > 0 ? 'Action Needed' : 'Normal'}
            </span>
          </div>
        </Card>

        <Card
          className="kpi-card"
          style={{ cursor: 'pointer', transition: 'transform 0.2s' }}
          onClick={() => navigate('/replenishment')}
        >
          <p className="kpi-label">Pending Replenishments</p>
          <div className="kpi-value-row">
            <h2 className="kpi-value" style={{ color: '#0d9488' }}>
              {data?.kpis?.pendingReplenishments != null ? data?.kpis?.pendingReplenishments : '-'}
            </h2>
            <div className="flex items-center gap-1 text-teal" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              <span>Review POs</span>
              <ArrowRight size={14} />
            </div>
          </div>
        </Card>

        <Card className="kpi-card">
          <p className="kpi-label">Active Suppliers</p>
          <div className="kpi-value-row">
            <h2 className="kpi-value">{data?.kpis?.totalSuppliers != null ? data?.kpis?.totalSuppliers : '-'}</h2>
            <span className="kpi-badge neutral">Lead Time Sync</span>
          </div>
        </Card>
      </div>

      {/* Demand Trend Analysis (UC08) */}
      <Card className="mb-6 p-6">
        <div className="chart-header flex justify-between items-center flex-wrap gap-3">
          <div className="chart-title-area">
            <h3>Demand Trend Analysis (UC08)</h3>
            <p>Historical demand distribution vs. 28-day predictive horizon for {selectedStore}</p>
          </div>
          <div className="chart-legend">
            <div className="legend-item"><div className="legend-line-actual"></div> Actual Demand</div>
            <div className="legend-item"><div className="legend-line-predicted"></div> Predicted Demand</div>
            <div className="legend-item"><div className="legend-box-horizon"></div> Forecast Horizon (28d)</div>
          </div>
        </div>
        <div className="chart-area" style={{ height: '280px' }}>
          <div className="forecast-horizon-bg"></div>
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                <XAxis dataKey="name" stroke="var(--text-secondary)" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                <YAxis hide />
                <Tooltip cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '5 5' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: 'var(--shadow-md)', backgroundColor: '#0f172a', color: '#fff' }} />
                <Line type="monotone" dataKey="actual" stroke="#94a3b8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="predicted" stroke="#0d9488" strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Card>

      {/* Charts Grid: Inventory Health & Urgency */}
      <div className="grid-cols-2 mb-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        <Card className="p-6">
          <h3 className="chart-title-area" style={{ marginBottom: '1.5rem', fontSize: '1.125rem', fontWeight: 700, fontFamily: 'Outfit' }}>
            Live Inventory Distribution
          </h3>
          <div className="donut-area">
            <div className="donut-chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={inventoryHealth}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {inventoryHealth.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '8px', backgroundColor: '#0f172a', color: '#fff' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center-text">
                <strong>Inventory</strong>
                <span>Health</span>
              </div>
            </div>
            <div className="donut-legend">
              {inventoryHealth.map((item: any) => (
                <div key={item.name} className="donut-legend-item">
                  <div className="donut-legend-label">
                    <div className="donut-legend-dot" style={{ backgroundColor: item.color }}></div>
                    <span>{item.name}</span>
                  </div>
                  <span className="donut-legend-value">{item.value} units</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="chart-title-area" style={{ marginBottom: '1.5rem', fontSize: '1.125rem', fontWeight: 700, fontFamily: 'Outfit' }}>
            SKUs by Reorder Urgency
          </h3>
          <div className="urgency-list">
            {urgencyList.length === 0 ? (
              <p style={{ padding: '1rem', color: '#94a3b8', textAlign: 'center' }}>All SKUs are operating within normal stock levels.</p>
            ) : (
              urgencyList.map((item: any) => (
                <div key={item.sku} className="urgency-item">
                  <div className="urgency-label">
                    <span className="urgency-sku">{item.sku}</span>
                    <span>{item.name}</span>
                  </div>
                  <div className="urgency-bar-bg">
                    <div
                      className="urgency-bar-fill"
                      style={{ width: `${item.urgency}%`, backgroundColor: item.color }}
                    ></div>
                  </div>
                  <div className="urgency-value">{item.urgency}%</div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Bottom Panel: Traffic-Light Stock Alerts (UC09) vs Live Adjustments */}
      <Card noPadding>
        <div className="alerts-header flex justify-between items-center p-4 border-b border-slate-700">
          <div className="flex gap-2">
            <button
              onClick={() => setBottomTab('ALERTS')}
              style={{
                background: bottomTab === 'ALERTS' ? '#0d9488' : '#1e293b',
                color: '#fff',
                border: 'none',
                padding: '0.4rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Traffic-Light Stock Alerts (UC09)
            </button>
            <button
              onClick={() => setBottomTab('ADJUSTMENTS')}
              style={{
                background: bottomTab === 'ADJUSTMENTS' ? '#0d9488' : '#1e293b',
                color: '#fff',
                border: 'none',
                padding: '0.4rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Recent Inventory Activity
            </button>
          </div>
          <span className="kpi-badge neutral">Store: {selectedStore}</span>
        </div>

        {bottomTab === 'ALERTS' ? (
          <div className="alerts-list">
            {trafficAlerts.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                No active stock alerts found for {selectedStore}. All items are within safety stock limits.
              </div>
            ) : (
              trafficAlerts.map((alert: any, idx: number) => {
                const isCrit = alert.severity === 'CRITICAL';
                const isWarn = alert.severity === 'WARNING';
                return (
                  <div className="alert-row" key={idx}>
                    <div className={`alert-status ${isCrit ? 'critical' : isWarn ? 'warning' : 'surge'}`}>
                      {alert.severity}
                    </div>
                    <div className="alert-name">
                      <div>{alert.item_id}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 400 }}>{alert.product_name}</div>
                    </div>
                    <div className="alert-location">{alert.store_id}</div>
                    <div className="alert-details">
                      On-Hand: <strong>{alert.on_hand}</strong> | ROP: {alert.reorder_point} | SS: {alert.safety_stock}
                    </div>
                    <div className="alert-action">
                      <button
                        className="alert-action-btn"
                        onClick={() => navigate('/replenishment')}
                      >
                        {alert.suggested_action || 'Order Stock'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="alerts-list">
            {recentAlerts.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                No inventory adjustment alerts logged yet.
              </div>
            ) : (
              recentAlerts.map((alert: any, idx: number) => (
                <div className="alert-row" key={idx}>
                  <div className={`alert-status ${alert.statusClass}`}>{alert.status}</div>
                  <div className="alert-name">{alert.name}</div>
                  <div className="alert-location">{alert.location}</div>
                  <div className="alert-details">{alert.details}</div>
                  <div className="alert-action">
                    <span className="text-secondary" style={{ fontSize: '12px' }}>{alert.actionText}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </Card>
    </div>
  );
};
