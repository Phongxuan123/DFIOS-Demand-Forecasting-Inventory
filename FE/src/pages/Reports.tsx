import React from 'react';
import { TrendingUp, Activity, Grid, Settings } from 'lucide-react';
import './Reports.css';



export const Reports: React.FC = () => {
  const [data, setData] = React.useState<any>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const { api } = await import('../services/api.ts');
        const result = await api.reports.getRecentLogs();
        setData(result);
      } catch (error) {
        console.error("Failed to load reports data", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'TrendingUp': return <TrendingUp size={20} />;
      case 'Activity': return <Activity size={20} />;
      case 'Grid': return <Grid size={20} />;
      case 'Settings': return <Settings size={20} />;
      default: return <Grid size={20} />;
    }
  };

  return (
    <div className="animate-fade-in mb-6">
      <h2 className="section-title">Generate System Reports</h2>

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-32 text-[var(--text-secondary)]">Loading reports data...</div>
      ) : (
        <>
          <div className="report-grid">
            {data.templates.map((tpl: any, idx: number) => (
              <div className="report-card" key={idx}>
                <div className="rc-header">
                  <div className="rc-icon-wrapper">{getIcon(tpl.icon)}</div>
                  <span className="rc-title">{tpl.title}</span>
                </div>
                <p className="rc-desc">{tpl.desc}</p>
                <div className="rc-actions">
                  <div className="rc-selects">
                    <div className="rc-select"><div className="rc-select-icon"></div>Last 30 Days</div>
                    <div className="rc-select" style={{flex: '0 0 auto', width: 'auto'}}>PDF Format</div>
                  </div>
                  <button className="rc-generate-btn">{tpl.btnText || 'Generate Report'}</button>
                </div>
              </div>
            ))}
          </div>

          <div className="log-panel">
            <h2 className="section-title">Recent Reports Log</h2>
            <div className="log-table">
              <div className="log-header-row">
                <div className="log-col-header log-col-1">REPORT NAME</div>
                <div className="log-col-header log-col-2">TYPE</div>
                <div className="log-col-header log-col-3">DATE GENERATED</div>
                <div className="log-col-header log-col-4">FORMAT</div>
                <div className="log-col-header log-col-5">FILE SIZE</div>
                <div className="log-col-header log-col-6">STATUS</div>
                <div className="log-col-header log-col-7">ACTION</div>
              </div>
              
              <div>
                {data.logs.map((log: any, idx: number) => (
                  <div className="log-row" key={idx}>
                    <div className="log-col-1">{log.name}</div>
                    <div className="log-col-2">{log.type}</div>
                    <div className="log-col-3">{log.date}</div>
                    <div className="log-col-4">
                      <span className={`format-badge ${log.formatClass}`}>{log.format}</span>
                    </div>
                    <div className="log-col-5">{log.size}</div>
                    <div className="log-col-6">
                      <span className={`status-badge ${log.status === 'READY' ? 'ready' : 'processing'}`}>{log.status}</span>
                    </div>
                    <div className="log-col-7">
                      {log.action === 'Download' ? (
                        <button className="download-btn">Download</button>
                      ) : (
                        <span className="wait-text">Wait...</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
