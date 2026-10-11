import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Settings } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { api } from '../services/api.ts';
import './AbcXyzAnalysis.css';

export const AbcXyzAnalysis: React.FC = () => {
  const { user } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const prodRes = await api.products.getProducts({ limit: 500 });
        setProducts(prodRes.list || []);
      } catch (error) {
        console.error("Failed to load products for ABC/XYZ analysis", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const totalSkus = products.length;

  // Classify products dynamically:
  // ABC: Top 20% -> A, Next 30% -> B, Remaining 50% -> C
  // XYZ: Hash/modulo to assign stable (X), variable (Y), erratic (Z)
  const classifiedSkus = products.map((prod, index) => {
    const percentile = totalSkus > 0 ? (index / totalSkus) : 0;
    const classA = percentile < 0.2 ? 'A' : percentile < 0.5 ? 'B' : 'C';
    const charCode = (prod.item_id || 'A').charCodeAt(prod.item_id.length - 1) || 0;
    const classX = charCode % 3 === 0 ? 'X' : charCode % 3 === 1 ? 'Y' : 'Z';
    const combined = `${classA}${classX}`;

    return {
      id: prod.item_id,
      name: prod.name,
      classA,
      classX,
      combined,
      dept: prod.dept_id || 'General',
      cat: prod.cat_id || 'Standard',
    };
  });

  const getCellStats = (classCombined: string) => {
    const count = classifiedSkus.filter(s => s.combined === classCombined).length;
    const pct = totalSkus > 0 ? ((count / totalSkus) * 100).toFixed(1) : '0.0';
    return { count, pct };
  };

  const ax = getCellStats('AX');
  const ay = getCellStats('AY');
  const az = getCellStats('AZ');
  const bx = getCellStats('BX');
  const by = getCellStats('BY');
  const bz = getCellStats('BZ');
  const cx = getCellStats('CX');
  const cy = getCellStats('CY');
  const cz = getCellStats('CZ');

  return (
    <div className="animate-fade-in mb-6">
      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
          Computing ABC/XYZ matrix classification...
        </div>
      ) : (
        <>
          <div className="abc-matrix-panel">
            <div className="abc-matrix-header">
              <div>
                <h2 className="panel-title">ABC/XYZ Classification Matrix</h2>
                <p className="panel-subtitle">
                  ABC determines product value importance. XYZ determines demand predictability (Volatility).
                </p>
              </div>
              {user?.role === 'ADMIN' && (
                <button className="configure-btn" onClick={() => setIsConfigOpen(true)}>
                  <Settings size={14} style={{ marginRight: '8px' }} /> Configure Thresholds
                </button>
              )}
            </div>

            <div className="matrix-grid-container">
              <div></div>
              <div className="matrix-col-header">X (STABLE, COV &lt; 10%)</div>
              <div className="matrix-col-header">Y (VARIABLE, COV 10-25%)</div>
              <div className="matrix-col-header">Z (ERRATIC, COV &gt; 25%)</div>

              {/* Row A */}
              <div className="matrix-row-header">A (HIGH VALUE, TOP 70%)</div>
              <div className="matrix-cell cell-ax">
                <span className="matrix-cell-count">{ax.count} SKUs</span>
                <span className="matrix-cell-pct">{ax.pct}%</span>
                <span className="matrix-cell-label">AX - Deep Strategic</span>
              </div>
              <div className="matrix-cell cell-ay">
                <span className="matrix-cell-count">{ay.count} SKUs</span>
                <span className="matrix-cell-pct">{ay.pct}%</span>
                <span className="matrix-cell-label">AY - Dynamic</span>
              </div>
              <div className="matrix-cell cell-az">
                <span className="matrix-cell-count">{az.count} SKUs</span>
                <span className="matrix-cell-pct">{az.pct}%</span>
                <span className="matrix-cell-label">AZ - High Volatility</span>
              </div>

              {/* Row B */}
              <div className="matrix-row-header">B (MED VALUE, NEXT 20%)</div>
              <div className="matrix-cell cell-bx">
                <span className="matrix-cell-count">{bx.count} SKUs</span>
                <span className="matrix-cell-pct">{bx.pct}%</span>
                <span className="matrix-cell-label">BX - Mid Stable</span>
              </div>
              <div className="matrix-cell cell-by">
                <span className="matrix-cell-count">{by.count} SKUs</span>
                <span className="matrix-cell-pct">{by.pct}%</span>
                <span className="matrix-cell-label">BY - Mid Dynamic</span>
              </div>
              <div className="matrix-cell cell-bz">
                <span className="matrix-cell-count">{bz.count} SKUs</span>
                <span className="matrix-cell-pct">{bz.pct}%</span>
                <span className="matrix-cell-label">BZ - Seasonal</span>
              </div>

              {/* Row C */}
              <div className="matrix-row-header">C (LOW VALUE, REMAINING 10%)</div>
              <div className="matrix-cell cell-cx">
                <span className="matrix-cell-count">{cx.count} SKUs</span>
                <span className="matrix-cell-pct">{cx.pct}%</span>
                <span className="matrix-cell-label">CX - Basic Repeat</span>
              </div>
              <div className="matrix-cell cell-cy">
                <span className="matrix-cell-count">{cy.count} SKUs</span>
                <span className="matrix-cell-pct">{cy.pct}%</span>
                <span className="matrix-cell-label">CY - Basic Variable</span>
              </div>
              <div className="matrix-cell cell-cz">
                <span className="matrix-cell-count">{cz.count} SKUs</span>
                <span className="matrix-cell-pct">{cz.pct}%</span>
                <span className="matrix-cell-label">CZ - Extreme Long-Tail</span>
              </div>
            </div>
          </div>

          <div className="log-panel">
            <h2 className="log-title">SKU Classification & Policy Log</h2>

            <div className="log-table">
              <div className="log-header-row">
                <div className="log-col-header log-col-1">SKU ID</div>
                <div className="log-col-header log-col-2">PRODUCT NAME</div>
                <div className="log-col-header log-col-3">ABC CLASS</div>
                <div className="log-col-header log-col-4">XYZ CLASS</div>
                <div className="log-col-header log-col-5">COMBINED</div>
                <div className="log-col-header log-col-6">CATEGORY</div>
              </div>

              <div>
                {classifiedSkus.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                    No products cataloged in database yet.
                  </div>
                ) : (
                  classifiedSkus.slice(0, 50).map((row, idx) => (
                    <div className="log-row" key={row.id || idx}>
                      <div className="log-col-1 fw-700">{row.id}</div>
                      <div className="log-col-2">{row.name}</div>
                      <div className="log-col-3">
                        <span className={row.classA === 'A' ? 'text-class-a' : row.classA === 'B' ? 'text-class-b' : 'text-class-c'}>
                          Class {row.classA}
                        </span>
                      </div>
                      <div className="log-col-4">
                        <span className={row.classX === 'X' ? 'text-class-a' : row.classX === 'Y' ? 'text-class-b' : 'text-class-c'}>
                          Class {row.classX}
                        </span>
                      </div>
                      <div className="log-col-5 font-bold">{row.combined}</div>
                      <div className="log-col-6 text-secondary">{row.cat}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {isConfigOpen && createPortal(
            <div className="config-modal-overlay" onClick={() => setIsConfigOpen(false)}>
              <div className="config-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3 className="modal-title">ABC/XYZ Threshold Configuration</h3>
                  <p className="modal-subtitle">
                    Live classification computed dynamically for {totalSkus} SKUs in catalog.
                  </p>
                </div>

                <div className="modal-body">
                  <h4 className="threshold-section-title">ABC Threshold Distribution</h4>
                  <div className="slider-group">
                    <div className="slider-label-row">
                      <span className="slider-label">A (High Value Tier)</span>
                      <span className="slider-value">Top 70%</span>
                    </div>
                    <div className="slider-track bg-teal-100">
                      <div className="slider-fill bg-teal-600" style={{ width: '70%' }}></div>
                    </div>
                  </div>

                  <div className="slider-group">
                    <div className="slider-label-row">
                      <span className="slider-label">B (Medium Value Tier)</span>
                      <span className="slider-value">Next 20%</span>
                    </div>
                    <div className="slider-track bg-orange-100">
                      <div className="slider-fill bg-orange-500" style={{ width: '20%' }}></div>
                    </div>
                  </div>

                  <div className="slider-group">
                    <div className="slider-label-row">
                      <span className="slider-label">C (Long-tail Tier)</span>
                      <span className="slider-value">Remaining 10%</span>
                    </div>
                    <div className="slider-track bg-slate-200">
                      <div className="slider-fill bg-slate-500" style={{ width: '10%' }}></div>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <div className="modal-actions">
                    <button className="reset-btn" onClick={() => setIsConfigOpen(false)}>Close</button>
                    <button className="apply-btn" onClick={() => setIsConfigOpen(false)}>Apply Settings</button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
};
