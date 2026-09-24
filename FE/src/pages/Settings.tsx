import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import './Settings.css';


export const Settings: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [dataQuality, setDataQuality] = useState<any>(null);
  const [mlPipeline, setMlPipeline] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('General Settings');

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const { api } = await import('../services/api.ts');
        const [configResult, usersResult, auditResult, dqResult, mlResult] = await Promise.all([
          api.settings.getConfig(),
          api.settings.getUsers(),
          api.settings.getAuditLogs(),
          api.settings.getDataQuality(),
          api.settings.getMlPipeline()
        ]);
        setData(configResult);
        setUsers(usersResult);
        setAuditLogs(auditResult);
        setDataQuality(dqResult);
        setMlPipeline(mlResult);
      } catch (error) {
        console.error("Failed to load settings data", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const renderGeneralSettings = () => (
    <div className="settings-main-split">
      <div className="settings-left-panel">
        <div className="profile-header">
          <div className="profile-avatar-large">
            <img src="https://ui-avatars.com/api/?name=Sarah+Jenkins&background=0D8ABC&color=fff" alt="Profile" className="profile-img" />
          </div>
          <div className="profile-info">
            <h2 className="profile-name">Sarah Jenkins</h2>
            <div className="profile-badge">WAREHOUSE MANAGER</div>
            <div className="profile-since">Member since Jan 2022</div>
          </div>
        </div>

        <div className="settings-divider"></div>

        <div className="settings-group">
          <label className="settings-label">Display Name</label>
          <input type="text" className="settings-input" defaultValue="Sarah Jenkins" />
        </div>
        
        <div className="settings-group" style={{marginTop: '1.5rem'}}>
          <label className="settings-label">Contact Email</label>
          <input type="email" className="settings-input" defaultValue="s.jenkins@dfios-cockpit.com" />
        </div>

        <div className="settings-group" style={{marginTop: '1.5rem', marginBottom: '2rem'}}>
          <label className="settings-label">Phone Number</label>
          <input type="text" className="settings-input" defaultValue="+1 (555) 382-9901" />
        </div>

        <div style={{display: 'flex', justifyContent: 'flex-end'}}>
          <button className="settings-save-btn">Save Changes</button>
        </div>
      </div>

      <div className="settings-right-panel">
        <div className="settings-side-card">
          <h2 className="settings-side-title">Change Password</h2>
          
          <div className="settings-group" style={{marginBottom: '1rem'}}>
            <label className="settings-label">Current Password</label>
            <input type="password" className="settings-input" defaultValue="**********" />
          </div>
          
          <div className="settings-group" style={{marginBottom: '1rem'}}>
            <label className="settings-label">New Password</label>
            <input type="password" className="settings-input" defaultValue="**********" />
          </div>
          
          <div className="settings-group" style={{marginBottom: '1.5rem'}}>
            <label className="settings-label">Confirm New Password</label>
            <input type="password" className="settings-input" defaultValue="**********" />
          </div>

          <div style={{display: 'flex', justifyContent: 'flex-end'}}>
            <button className="settings-save-btn">Update Password</button>
          </div>
        </div>

        <div className="settings-side-card">
          <h2 className="settings-side-title">Recent Login Activity</h2>
          
          <div className="login-activity-item">
            <div className="login-activity-main">
              <span className="login-activity-loc">Phoenix, AZ (IP: 72.11.90.3)</span>
              <span className="login-activity-time">10 mins ago</span>
            </div>
            <div className="login-activity-desc success">Success - Chrome / macOS</div>
          </div>
          
          <div className="login-activity-item">
            <div className="login-activity-main">
              <span className="login-activity-loc">Phoenix, AZ (IP: 72.11.90.3)</span>
              <span className="login-activity-time">Yesterday, 09:24</span>
            </div>
            <div className="login-activity-desc success">Success - Chrome / macOS</div>
          </div>

          <div className="login-activity-item">
            <div className="login-activity-main">
              <span className="login-activity-loc">Dallas, TX (IP: 14.192.4.9)</span>
              <span className="login-activity-time">Oct 22, 14:11</span>
            </div>
            <div className="login-activity-desc failed">Failed attempt - Safari / iOS</div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderUserManagement = () => (
    <div className="user-management-panel">
      <div className="user-management-header">
        <div>
          <h2 className="settings-panel-title" style={{marginBottom: '0.25rem'}}>User Accounts</h2>
          <p className="settings-panel-subtitle">Manage identity profiles, role allocations, and security logs for 8 users.</p>
        </div>
        <button className="add-user-btn">
          <Plus size={16} style={{marginRight: '0.5rem'}} /> Add New User
        </button>
      </div>

      <div className="user-filter-bar">
        <div className="user-filter-group">
          <label className="user-filter-label">ROLE FILTER</label>
          <select className="user-filter-select">
            <option>All System Roles</option>
          </select>
        </div>
        <div className="user-filter-group">
          <label className="user-filter-label">STATUS</label>
          <select className="user-filter-select">
            <option>Active Members</option>
          </select>
        </div>
        <div className="user-filter-group search-group">
          <label className="user-filter-label">SEARCH MEMBER</label>
          <input type="text" className="user-filter-input" placeholder="Search names, emails, logins..." />
        </div>
      </div>

      <div className="user-table-container">
        <table className="user-table">
          <thead>
            <tr>
              <th>NAME</th>
              <th>EMAIL</th>
              <th>ROLE</th>
              <th>STATUS</th>
              <th>LAST LOGIN</th>
              <th className="text-right">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={i}>
                <td className="fw-700 text-dark">{u.name}</td>
                <td className="text-secondary">{u.email}</td>
                <td><span className={`role-badge ${u.role.toLowerCase()}`}>{u.role}</span></td>
                <td><span className={`status-badge ${u.status.toLowerCase()}`}>{u.status}</span></td>
                <td className="text-secondary">{u.lastLogin}</td>
                <td className="text-right user-actions">
                  <button className="action-edit">Edit</button>
                  <button className={`action-toggle ${u.status === 'ACTIVE' ? 'disable' : 'enable'}`}>
                    {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        <div className="user-pagination">
          <span className="pagination-info">Showing {users.length} of 8 active profiles</span>
          <div className="pagination-controls">
            <button className="pagination-btn">Previous</button>
            <button className="pagination-btn active">1</button>
            <button className="pagination-btn">Next</button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderMLPipeline = () => (
    <div className="ml-pipeline-panel">
      {/* KPIs */}
      <div className="ml-kpi-grid">
        <div className="ml-kpi-card">
          <span className="ml-kpi-label">LAST FORECAST RUN</span>
          <h2 className="ml-kpi-title">{mlPipeline.kpis.lastRun.time}</h2>
          <p className="ml-kpi-desc">{mlPipeline.kpis.lastRun.status}</p>
        </div>
        <div className="ml-kpi-card">
          <span className="ml-kpi-label">NEXT SCHEDULED RUN</span>
          <h2 className="ml-kpi-title text-teal">{mlPipeline.kpis.nextRun.time}</h2>
          <p className="ml-kpi-desc">{mlPipeline.kpis.nextRun.status}</p>
        </div>
        <div className="ml-kpi-card">
          <span className="ml-kpi-label">ACTIVE MODEL STACK</span>
          <h2 className="ml-kpi-title">{mlPipeline.kpis.activeModel.name}</h2>
          <p className="ml-kpi-desc">{mlPipeline.kpis.activeModel.desc}</p>
        </div>
        <div className="ml-kpi-card">
          <span className="ml-kpi-label">PIPELINE HEALTH</span>
          <h2 className="ml-kpi-title text-teal">{mlPipeline.kpis.pipelineHealth.status}</h2>
          <p className="ml-kpi-desc">{mlPipeline.kpis.pipelineHealth.desc}</p>
        </div>
      </div>

      {/* Cron Schedule Form */}
      <div className="ml-schedule-panel mt-6">
        <h3 className="mp-panel-title">Batch Forecast Cron Schedule</h3>
        
        <div className="ml-form-grid mt-4">
          <div className="ml-form-group">
            <label className="settings-label">Pipeline Frequency</label>
            <select className="settings-select w-full">
              <option>Weekly Run</option>
            </select>
          </div>
          <div className="ml-form-group">
            <label className="settings-label">Day of Week</label>
            <select className="settings-select w-full">
              <option>Sunday Night</option>
            </select>
          </div>
          <div className="ml-form-group">
            <label className="settings-label">Execution Time</label>
            <div className="time-input-wrap">
              <input type="text" className="settings-input w-full" defaultValue="00:00 (Midnight)" />
            </div>
          </div>
        </div>

        <div className="ml-checkbox-row mt-6">
          <div className="settings-checkbox checked ml-checkbox">
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 4.5L3.5 7L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="settings-checkbox-info">
            <span className="settings-checkbox-title text-dark fw-700">Auto-compute SS/ROP/EOQ & ABC-XYZ after forecast run</span>
            <span className="settings-checkbox-desc">Automatically re-trigger Safety Stock, ROP, EOQ and ABC/XYZ calculation matrices as soon as deep learning forecasts publish.</span>
          </div>
        </div>

        <div className="flex justify-end items-center gap-4 mt-6">
          <button className="settings-btn-outline" style={{padding: '0.625rem 1rem'}}>
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '6px', display: 'inline-block'}}><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
             Trigger Manual Run
          </button>
          <button className="settings-btn-primary" style={{padding: '0.625rem 1.25rem'}}>Enable Schedule Settings</button>
        </div>
      </div>

      {/* Executions Table */}
      <div className="settings-table-container mt-6">
        <h3 className="mp-panel-title mb-4" style={{fontSize: '1rem', color: '#1e293b'}}>Recent ML Pipeline Executions</h3>
        <table className="settings-table">
          <thead>
            <tr>
              <th>RUN ID</th>
              <th>TRIGGER</th>
              <th>START TIME</th>
              <th>DURATION</th>
              <th>MODEL USED</th>
              <th>SKU SCOPE</th>
              <th>STATUS</th>
              <th className="text-right">PARAMETERS</th>
            </tr>
          </thead>
          <tbody>
            {mlPipeline.executions.map((exec: any, i: number) => (
              <tr key={i}>
                <td className="fw-700 text-dark">{exec.id}</td>
                <td className="text-secondary">{exec.trigger}</td>
                <td className="text-secondary" style={{fontFamily: 'monospace', fontSize: '12px'}}>{exec.start}</td>
                <td className="text-secondary">{exec.duration}</td>
                <td className="fw-600">{exec.model}</td>
                <td className="text-secondary">{exec.scope}</td>
                <td>
                  <span className={`audit-badge ${exec.status === 'Completed' ? 'green' : 'red'}`}>
                    {exec.status}
                  </span>
                </td>
                <td className="text-right">
                  {exec.params.map((p: string, idx: number) => (
                    <span key={idx} className="ml-param-badge">{p}</span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderAuditLogs = () => (
    <div className="settings-audit-panel">
      <div className="settings-filters mb-6">
        <select className="settings-select has-icon-left">
          <option>Last 7 Days (Oct 18 - Oct 24)</option>
        </select>
        <select className="settings-select">
          <option>User: All</option>
        </select>
        <select className="settings-select">
          <option>Action: All</option>
        </select>
      </div>

      <div className="settings-table-container mt-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="mp-panel-title m-0" style={{fontSize: '1rem', color: '#1e293b'}}>System Audit Trail</h2>
          <button className="settings-btn-outline">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '8px'}}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            Export Audit Log
          </button>
        </div>
        <table className="settings-table">
          <thead>
            <tr>
              <th>TIMESTAMP</th>
              <th>USER</th>
              <th>ACTION TYPE</th>
              <th>RESOURCE / DETAILS</th>
              <th>IP ADDRESS</th>
              <th>SEVERITY</th>
            </tr>
          </thead>
          <tbody>
            {auditLogs.map((log: any, i: number) => (
              <tr key={i}>
                <td className="text-secondary" style={{fontFamily: 'monospace', fontSize: '11px'}}>{log.timestamp}</td>
                <td className="fw-600">{log.user}</td>
                <td className="fw-600">{log.action}</td>
                <td className="text-secondary">{log.details}</td>
                <td className="text-secondary" style={{fontFamily: 'monospace', fontSize: '11px'}}>{log.ip}</td>
                <td>
                  <span className={`audit-badge ${log.severity === 'Critical' ? 'red' : log.severity === 'Warning' ? 'yellow' : 'blue'}`}>
                    {log.severity}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        <div className="flex justify-between items-center mt-4">
          <span className="text-secondary" style={{fontSize: '12px'}}>Showing 1 to 10 of 214 logs</span>
          <div className="prod-pagination">
            <button className="page-btn">Previous</button>
            <button className="page-btn active">1</button>
            <button className="page-btn">2</button>
            <button className="page-btn">Next</button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderDataQuality = () => (
    <div className="settings-dq-panel">
      <div className="dq-top-row">
        <div className="dq-score-card">
          <div className="dq-score-circle">
            <span className="dq-score-value">{dataQuality.score}</span>
          </div>
          <div className="dq-score-info">
            <h3 className="dq-score-title">Overall Ingestion Score</h3>
            <p className="dq-score-desc">Ingested tables meet optimal parameters for neural network model training.</p>
            <div className="flex items-center gap-4 mt-2">
              <button className="settings-btn-primary" style={{padding: '0.375rem 0.75rem'}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '4px'}}><path d="M21.5 2v6h-6M2.13 15.57a9 9 0 1 0 3.87-11.45L2 8"></path></svg>
                Run Quality Check
              </button>
              <span className="text-secondary" style={{fontSize: '11px'}}>Last checked: Today at 04:12 AM</span>
            </div>
          </div>
        </div>

        <div className="dq-stats-col">
          <div className="dq-stat-box mb-4">
            <span className="dq-stat-label">MISSING DATA RATE</span>
            <div className="flex justify-between items-center">
              <h2>{dataQuality.missingRate}</h2>
              <span className="text-green fw-600" style={{fontSize: '11px'}}>Optimal (&lt; 1%)</span>
            </div>
          </div>
          <div className="dq-stat-box">
            <span className="dq-stat-label">OUTLIERS / ANOMALIES</span>
            <div className="flex justify-between items-center">
              <h2>{dataQuality.outliers} Found</h2>
              <span className="text-orange fw-600" style={{fontSize: '11px'}}>Review Recommended</span>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-table-container mt-6" style={{border: '1px solid var(--border-color)', padding: '1.5rem', borderRadius: 'var(--radius-lg)'}}>
        <h3 className="mp-panel-title mb-4">Active Data Pipeline Inspections</h3>
        <table className="settings-table">
          <thead>
            <tr>
              <th>INSPECTION TEST NAME</th>
              <th>CATEGORY</th>
              <th>STATUS</th>
              <th>DETAILED RESULTS / SUGGESTED ACTION</th>
              <th className="text-right">AFFECTED RECORDS</th>
            </tr>
          </thead>
          <tbody>
            {dataQuality.inspections.map((insp: any, i: number) => (
              <tr key={i}>
                <td className="fw-600">{insp.name}</td>
                <td className="text-secondary">{insp.category}</td>
                <td>
                  <span className={`audit-badge ${insp.status === 'Fail' ? 'red' : insp.status === 'Warning' ? 'yellow' : 'green'}`}>
                    {insp.status}
                  </span>
                </td>
                <td className="text-secondary">{insp.details}</td>
                <td className="text-right fw-600">{insp.affected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="animate-fade-in mb-6">
      {isLoading || !data || !auditLogs || !dataQuality || !mlPipeline ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">Loading settings data...</div>
      ) : (
        <>
          {activeTab !== 'Data Quality' && (
            <div className="settings-tabs-container">
              {['General Settings', 'User Management', 'Audit Logs', 'ML Pipeline', 'Automation'].map(tab => (
                <button 
                  key={tab}
                  className={`settings-tab-btn ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}
          
          {activeTab === 'Data Quality' && (
            <div className="mb-4">
              <button className="settings-btn-outline" onClick={() => setActiveTab('ML Pipeline')} style={{padding: '0.375rem 0.75rem'}}>
                &larr; Back to ML Pipeline
              </button>
            </div>
          )}

          {activeTab === 'General Settings' && renderGeneralSettings()}
          {activeTab === 'User Management' && renderUserManagement()}
          {activeTab === 'ML Pipeline' && renderMLPipeline()}
          {activeTab === 'Audit Logs' && renderAuditLogs()}
          {activeTab === 'Data Quality' && renderDataQuality()}
          
          {(activeTab === 'Automation') && (
            <div className="settings-main-split">
              <div className="settings-left-panel" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px'}}>
                <p style={{color: 'var(--text-secondary)'}}>This module is currently under development.</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
