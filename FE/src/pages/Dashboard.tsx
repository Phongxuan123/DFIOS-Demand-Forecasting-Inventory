import React, { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card.tsx';
import { api } from '../services/api.ts';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Search, Bell, Calendar } from 'lucide-react';
import './Dashboard.css';

export const Dashboard: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const dashboardData = await api.dashboard.getOverview();
        setData(dashboardData);
      } catch (error) {
        console.error("Failed to load dashboard data", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  if (isLoading || !data) {
    return <div className="p-12 text-center text-[var(--text-secondary)]">Loading dashboard data...</div>;
  }

  const chartData = data.charts.forecastTrend.map((d: any, i: number) => ({
    name: i === 0 ? 'Sep 01' : i === 7 ? 'Sep 07' : i === 14 ? 'Sep 14' : i === 21 ? 'Sep 21' : i === 28 ? 'Sep 28' : i === 35 ? 'Oct 05 (Forecast)' : i === 42 ? 'Oct 12' : '',
    actual: i < 30 ? d.actual : null,
    predicted: i >= 29 ? d.lightgbm : null,
  }));

  return (
    <div className="animate-fade-in mb-6">
      <div className="dashboard-header">
        <h1 className="dashboard-title">Inventory Optimization Cockpit</h1>
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

      <div className="grid-cols-4 mb-6">
        <Card className="kpi-card">
          <p className="kpi-label">Total Monitored SKUs</p>
          <div className="kpi-value-row">
            <h2 className="kpi-value">{data.kpis.totalSkus.toLocaleString()}</h2>
            <span className="kpi-badge success">+12 new SKUs</span>
          </div>
        </Card>

        <Card className="kpi-card">
          <p className="kpi-label">Reorder Alerts</p>
          <div className="kpi-value-row">
            <h2 className="kpi-value">{data.kpis.reorderAlerts}</h2>
            <span className="kpi-badge danger">4 critical</span>
          </div>
        </Card>

        <Card className="kpi-card">
          <p className="kpi-label">Forecast Accuracy (MASE)</p>
          <div className="kpi-value-row">
            <h2 className="kpi-value">{data.kpis.avgForecastAccuracy}</h2>
            <span className="kpi-badge success">+0.04 points improvement</span>
          </div>
        </Card>

        <Card className="kpi-card">
          <p className="kpi-label">Service Level Achieved</p>
          <div className="kpi-value-row">
            <h2 className="kpi-value">{data.kpis.serviceLevel}%</h2>
            <span className="kpi-badge success">+0.8% increase</span>
          </div>
        </Card>
      </div>

      <Card className="mb-6 p-6">
        <div className="chart-header">
          <div className="chart-title-area">
            <h3>Demand Trend Analysis</h3>
            <p>Historical actual demand vs. 28-day machine learning forecast</p>
          </div>
          <div className="chart-legend">
            <div className="legend-item"><div className="legend-line-actual"></div> Actual Demand</div>
            <div className="legend-item"><div className="legend-line-predicted"></div> Predicted Demand</div>
            <div className="legend-item"><div className="legend-box-horizon"></div> Forecast Horizon (28d)</div>
          </div>
        </div>
        <div className="chart-area">
          <div className="forecast-horizon-bg"></div>
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 0, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                <XAxis dataKey="name" stroke="var(--text-secondary)" axisLine={false} tickLine={false} tick={{fontSize: 10}} />
                <YAxis hide />
                <Tooltip cursor={{stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '5 5'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: 'var(--shadow-md)' }} />
                <Line type="monotone" dataKey="actual" stroke="#475569" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="predicted" stroke="#0d9488" strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Card>

      <div className="grid-cols-2 mb-6">
        <Card className="p-6">
          <h3 className="chart-title-area" style={{ marginBottom: '1.5rem', fontSize: '1.125rem', fontWeight: 700, fontFamily: 'Outfit' }}>ABC Inventory Distribution</h3>
          <div className="donut-area">
            <div className="donut-chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.charts.inventoryHealth}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {data.charts.inventoryHealth.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '8px' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center-text">
                <strong>A / B / C</strong>
                <span>Value Tiers</span>
              </div>
            </div>
            <div className="donut-legend">
              {data.charts.inventoryHealth.map((item: any) => (
                <div key={item.name} className="donut-legend-item">
                  <div className="donut-legend-label">
                    <div className="donut-legend-dot" style={{ backgroundColor: item.color }}></div>
                    <span>{item.name}</span>
                  </div>
                  <span className="donut-legend-value">{item.value.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="chart-title-area" style={{ marginBottom: '1.5rem', fontSize: '1.125rem', fontWeight: 700, fontFamily: 'Outfit' }}>SKUs by Reorder Urgency</h3>
          <div className="urgency-list">
            {data.charts.urgency.map((item: any) => (
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
            ))}
          </div>
        </Card>
      </div>

      <Card noPadding>
        <div className="alerts-header">
          <h3 className="alerts-title">Recent Replenishment & Stockout Alerts</h3>
          <span className="kpi-badge danger">Action Required</span>
        </div>
        
        <div className="alerts-list">
          {data.recentAlerts.map((alert: any, idx: number) => (
            <div className="alert-row" key={idx}>
              <div className={`alert-status ${alert.statusClass}`}>{alert.status}</div>
              <div className="alert-name">{alert.name}</div>
              <div className="alert-location">{alert.location}</div>
              <div className="alert-details">{alert.details}</div>
              <div className="alert-action">
                <button className="alert-action-btn">{alert.actionText}</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
