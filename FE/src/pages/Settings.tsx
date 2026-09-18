import React, { useState } from 'react';
import { Search, Bell, Calendar } from 'lucide-react';
import './Settings.css';

// Simple Toggle Component
const Toggle = ({ initialChecked = false }: { initialChecked?: boolean }) => {
  const [checked, setChecked] = useState(initialChecked);
  return (
    <div className={`settings-toggle ${checked ? 'on' : 'off'}`} onClick={() => setChecked(!checked)}>
      <div className="settings-toggle-circle"></div>
    </div>
  );
};

export const Settings: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeModel, setActiveModel] = useState('tft');

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const { api } = await import('../services/api.ts');
        const result = await api.settings.getConfig();
        setData(result);
        if (result && result.general && result.general.defaultModel) {
          setActiveModel(result.general.defaultModel);
        }
      } catch (error) {
        console.error("Failed to load settings data", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="animate-fade-in mb-6">

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading settings data...</div>
      ) : (
        <>
          <div className="settings-tabs-container">
            <button className="settings-tab-btn active">General Settings</button>
            <button className="settings-tab-btn">User Management</button>
            <button className="settings-tab-btn">Audit Logs</button>
            <button className="settings-tab-btn">ML Pipeline</button>
            <button className="settings-tab-btn">Automation</button>
          </div>
          
          <div className="settings-main-split">
          {/* Left Panel */}
          <div className="settings-left-panel">
            <h2 className="settings-panel-title">Global Parameters</h2>
            
            {/* Section 1 */}
            <div className="settings-subtitle">GENERAL CONFIGURATIONS</div>
            <div className="settings-row">
              <div className="settings-group">
                <label className="settings-label">System Host Name</label>
                <input type="text" className="settings-input" defaultValue={data.general.hostName} />
              </div>
              <div className="settings-group">
                <label className="settings-label">Timezone</label>
                <input type="text" className="settings-input" defaultValue={data.general.timezone} />
              </div>
            </div>

            <div className="settings-divider"></div>

            {/* Section 2 */}
            <div className="settings-subtitle">FORECASTING ENGINE CONFIGURATION</div>
            <div className="settings-row">
              <div className="settings-group" style={{ flex: 2 }}>
                <label className="settings-label">Default ML Engine Model</label>
                <div className="settings-radio-group">
                  <div className={`settings-radio-label ${activeModel === 'arima' ? 'active' : ''}`} onClick={() => setActiveModel('arima')}>
                    <div className="radio-circle"><div className="radio-circle-inner"></div></div>
                    ARIMA
                  </div>
                  <div className={`settings-radio-label ${activeModel === 'lightgbm' ? 'active' : ''}`} onClick={() => setActiveModel('lightgbm')}>
                    <div className="radio-circle"><div className="radio-circle-inner"></div></div>
                    LightGBM
                  </div>
                  <div className={`settings-radio-label ${activeModel === 'tft' ? 'active' : ''}`} onClick={() => setActiveModel('tft')}>
                    <div className="radio-circle"><div className="radio-circle-inner"></div></div>
                    TFT (Neural)
                  </div>
                </div>
              </div>
              <div className="settings-group" style={{ flex: 1 }}>
                <label className="settings-label">Forecast Horizon</label>
                <input type="text" className="settings-input" defaultValue={data.general.horizon} />
              </div>
            </div>

            <div className="settings-row" style={{ marginTop: '2rem' }}>
              <div className="settings-group">
                <div className="settings-slider-header">
                  <label className="settings-label">Prediction Interval Confidence Level</label>
                  <span className="settings-slider-value">{data.general.confidence}</span>
                </div>
                <div className="settings-slider-track">
                  <div className="settings-slider-fill"></div>
                  <div className="settings-slider-thumb"></div>
                </div>
              </div>
            </div>

            <div className="settings-row" style={{ marginTop: '2rem', marginBottom: '1rem' }}>
              <div className="settings-group">
                <div className="settings-toggle-row">
                  <div className="settings-toggle-info">
                    <span className="settings-toggle-title">Automatic Retraining</span>
                    <span className="settings-toggle-desc">Retrain forecasting weights weekly on Sunday midnight</span>
                  </div>
                  <Toggle initialChecked={data.general.autoRetrain} />
                </div>
              </div>
            </div>

            <div className="settings-divider"></div>

            {/* Section 3 */}
            <div className="settings-subtitle">BATCH FORECAST SCHEDULE</div>
            <div className="settings-row">
              <div className="settings-group">
                <label className="settings-label">Cron Schedule</label>
                <input type="text" className="settings-input" defaultValue="Every Sunday at 02:00 AM" />
              </div>
              <div className="settings-group">
                <label className="settings-label">Next Run</label>
                <input type="text" className="settings-input" defaultValue="Oct 27, 2024" />
              </div>
              <div className="settings-group" style={{ flex: 0.5 }}>
                <label className="settings-label">Enabled</label>
                <div style={{marginTop: '0.25rem'}}><Toggle initialChecked={true} /></div>
              </div>
            </div>
            
            <div className="settings-checkbox-row">
              <div className="settings-checkbox checked">
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 4.5L3.5 7L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="settings-checkbox-info">
                <span className="settings-checkbox-title">Auto-compute SS/ROP/EOQ & ABC-XYZ after each forecast run</span>
                <span className="settings-checkbox-desc">Automatically recalculate Safety Stock, Reorder Points, EOQ and update ABC-XYZ classification when new forecasts complete.</span>
              </div>
            </div>

            <div className="settings-divider"></div>

            {/* Section 4 */}
            <div className="settings-subtitle">INVENTORY POLICIES</div>
            <div className="settings-row">
              <div className="settings-group">
                <label className="settings-label">Default Lead Time (Days)</label>
                <input type="text" className="settings-input" defaultValue={data.inventory.leadTime} />
              </div>
              <div className="settings-group">
                <label className="settings-label">Service Level Target</label>
                <input type="text" className="settings-input" defaultValue={data.inventory.serviceLevel} />
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-group">
                <label className="settings-label">Annual Holding Cost Rate</label>
                <input type="text" className="settings-input" defaultValue={data.inventory.holdingCost} />
              </div>
              <div className="settings-group">
                <label className="settings-label">Fixed Ordering Cost</label>
                <input type="text" className="settings-input" defaultValue={data.inventory.fixedOrdering} />
              </div>
            </div>

            <button className="settings-save-btn">Save Settings</button>
            <div style={{ clear: 'both' }}></div>
          </div>

          {/* Right Panel */}
          <div className="settings-right-panel">
            {/* Notifications Card */}
            <div className="settings-side-card">
              <h2 className="settings-side-title">Alert Notifications</h2>
              
              <div className="settings-side-toggles">
                <div className="settings-toggle-row">
                  <div className="settings-toggle-info">
                    <span className="settings-toggle-title">Reorder Notifications</span>
                    <span className="settings-toggle-desc">Alert when SKU drops below safety ROP</span>
                  </div>
                  <Toggle initialChecked={data.alerts.reorderNotifs} />
                </div>
                
                <div className="settings-toggle-row">
                  <div className="settings-toggle-info">
                    <span className="settings-toggle-title">Email Dispatch</span>
                    <span className="settings-toggle-desc">Send nightly inventory dispatch report</span>
                  </div>
                  <Toggle initialChecked={data.alerts.emailDispatch} />
                </div>
              </div>

              <div className="settings-group">
                <label className="settings-label">Dispatch Email Address</label>
                <input type="text" className="settings-input" defaultValue={data.alerts.email} />
              </div>
            </div>

            {/* Data Management Card */}
            <div className="settings-side-card">
              <h2 className="settings-side-title">Data Management</h2>
              
              <div className="dataset-box">
                <div className="dataset-label">CURRENT DATASET</div>
                <div className="dataset-name">M5 Walmart Dataset (Cleaned)</div>
                <div className="dataset-updated">Last updated: Today at 04:12 AM</div>
              </div>

              <div className="storage-info">
                <div className="storage-header">
                  <span className="storage-label">System Storage Allocated</span>
                  <span className="storage-pct">74%</span>
                </div>
                <div className="storage-track">
                  <div className="storage-fill"></div>
                </div>
                <span className="storage-desc">7.4 GB of 10 GB limit used</span>
              </div>

              <button className="sync-btn">Sync & Refresh Data</button>
              <button className="settings-btn-primary" style={{width: '100%', marginTop: '0.75rem'}}>Run Quality Check</button>
              
              <div className="settings-quality-status">
                <div className="dataset-label">DATA QUALITY STATUS</div>
                <div className="quality-text">Last check: Oct 22, 2024 | Missing: 0.3% | Anomalies: 2 detected | Leakage: None</div>
              </div>
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
};
