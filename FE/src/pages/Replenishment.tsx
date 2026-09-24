import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import './Replenishment.css';

export const Replenishment: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { api } = await import('../services/api.ts');
        const response = await api.inventory.getReplenishmentDashboard();
        setData(response);
      } catch (error) {
        console.error("Failed to load replenishment data", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="animate-fade-in mb-6 rep-container">
      <div className="rep-header-section">
        <h1 className="rep-page-title">Inventory Parameter Dashboard — Safety Stock, ROP & EOQ</h1>
        <div className="rep-search-box">
          <Search size={14} color="#94a3b8" />
          <input type="text" placeholder="Search products, audits, SKU..." />
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading dashboard data...</div>
      ) : (
        <>
          <div className="rep-kpi-row">
            <div className="rep-kpi-card">
              <span className="rep-kpi-title">AVERAGE SAFETY STOCK COVERAGE</span>
              <div className="rep-kpi-content">
                <h2>{data.kpis.avgSafetyStockDays}</h2>
                <span className="rep-badge green">Optimized</span>
              </div>
            </div>
            
            <div className="rep-kpi-card">
              <span className="rep-kpi-title">SYSTEM ROP COVERAGE</span>
              <div className="rep-kpi-content">
                <h2>{data.kpis.systemRopCoverage}</h2>
                <span className="rep-badge red">{data.kpis.systemRopAlerts} SKUs Alerting</span>
              </div>
            </div>

            <div className="rep-kpi-card">
              <span className="rep-kpi-title">TOTAL CURRENT EOQ VALUE</span>
              <div className="rep-kpi-content">
                <h2>{data.kpis.totalEoqValue}</h2>
                <span className="rep-badge green">Optimal Run</span>
              </div>
            </div>

            <div className="rep-kpi-card">
              <span className="rep-kpi-title">TARGET SERVICE LEVEL ACHIEVED</span>
              <div className="rep-kpi-content">
                <h2>{data.kpis.serviceLevel}</h2>
                <span className="rep-badge green-text">{data.kpis.serviceLevelMom} MoM</span>
              </div>
            </div>
          </div>

          <div className="rep-main-grid">
            <div className="rep-table-panel">
              <h3 className="rep-panel-title">SKU Inventory Parameters & Status</h3>
              
              <div className="rep-table-wrap">
                <table className="rep-table">
                  <thead>
                    <tr>
                      <th>SKU ID</th>
                      <th>PRODUCT</th>
                      <th>DAILY (μ)</th>
                      <th>S.D. (σ)</th>
                      <th>LT</th>
                      <th>SS</th>
                      <th>ROP</th>
                      <th>EOQ</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.skus.map((sku: any, i: number) => (
                      <tr key={i} className={i === 0 ? 'active' : ''}>
                        <td className="fw-700">{sku.id}</td>
                        <td>
                          <div className="rep-prod-name">{sku.name}</div>
                          <div className="rep-prod-cat">{sku.category}</div>
                        </td>
                        <td>{sku.daily}</td>
                        <td>{sku.sd}</td>
                        <td>{sku.lt}d</td>
                        <td className="fw-600">{sku.ss}</td>
                        <td className="fw-600">{sku.rop}</td>
                        <td className="fw-600">{sku.eoq}</td>
                        <td>
                          <span className={`rep-status ${sku.status === 'Critical' ? 'red' : sku.status === 'Below ROP' ? 'yellow' : 'green'}`}>
                            {sku.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rep-detail-panel">
              <div className="rep-detail-header">
                <span className="rep-detail-tag">SELECTED SKU PARAMETERS</span>
                <h2 className="rep-detail-title">Nike Ultra Boost</h2>
                <p className="rep-detail-subtitle">SKU-8921 • Footwear Tier A</p>
              </div>

              <div className="rep-formula-group">
                <div className="rep-formula-top">
                  <span className="rep-formula-name">Safety Stock (SS)</span>
                  <span className="rep-formula-result">20 units</span>
                </div>
                <div className="rep-formula-box">
                  SS = Z * σ * √L
                </div>
                <div className="rep-formula-desc">
                  Z (95% SL) = 1.65 | σ = 4.2 | L = 7 days<br/>
                  1.65 * 4.2 * 2.64 = 18.3 ≈ 20 units
                </div>
              </div>

              <div className="rep-formula-group">
                <div className="rep-formula-top">
                  <span className="rep-formula-name">Reorder Point (ROP)</span>
                  <span className="rep-formula-result">198 units</span>
                </div>
                <div className="rep-formula-box">
                  ROP = (μ * L) + SS
                </div>
                <div className="rep-formula-desc">
                  μ = 25.4 units/day | L = 7 days | SS = 20<br/>
                  (25.4 * 7) + 20 = 177.8 + 20 = 198 units
                </div>
              </div>

              <div className="rep-formula-group">
                <div className="rep-formula-top">
                  <span className="rep-formula-name">Economic Order Qty (EOQ)</span>
                  <span className="rep-formula-result">450 units</span>
                </div>
                <div className="rep-formula-box">
                  EOQ = √(2 * D * S / H)
                </div>
                <div className="rep-formula-desc">
                  D = 9,271/yr | S = $50.00 | H = $2.20/unit/yr<br/>
                  √(2 * 9271 * 50 / 2.2) = √421,409 ≈ 450 units
                </div>
              </div>

            </div>
          </div>
        </>
      )}
    </div>
  );
};
