import React from 'react';
import { TrendingUp, Activity, Grid, Settings } from 'lucide-react';
import './Reports.css';



export const Reports: React.FC = () => {
  const [data, setData] = React.useState<any>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [filterType, setFilterType] = React.useState('All Reports');
  const [sortDesc, setSortDesc] = React.useState(false);

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
      <div className="reports-top-header">
        <h2 className="reports-main-title">Reports & Analytics</h2>
        <p className="reports-main-subtitle">Here's a list of your report templates for data analysis!</p>
      </div>

      <div className="reports-filter-row">
        <div className="reports-filter-left">
          <input 
            type="text" 
            className="reports-filter-input" 
            placeholder="Filter reports..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <div className="reports-select-wrapper">
            <select 
              className="reports-filter-select"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option>All Reports</option>
              <option>Generated</option>
              <option>Scheduled</option>
            </select>
          </div>
        </div>
        <div className="reports-filter-right">
          <button className="reports-sort-btn" onClick={() => setSortDesc(!sortDesc)}>
            <Settings size={14} />
          </button>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-32 text-[var(--text-secondary)]">Loading reports data...</div>
      ) : (
        <>
          <div className="report-grid-3col">
            {data.templates
              .map((tpl: any, idx: number) => ({ ...tpl, originalIdx: idx, isGenerated: idx % 2 === 1 }))
              .filter((tpl: any) => tpl.title.toLowerCase().includes(searchTerm.toLowerCase()) || tpl.desc.toLowerCase().includes(searchTerm.toLowerCase()))
              .filter((tpl: any) => {
                if (filterType === 'Generated') return tpl.isGenerated;
                if (filterType === 'Scheduled') return !tpl.isGenerated;
                return true;
              })
              .sort((a: any, b: any) => sortDesc ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title))
              .map((tpl: any) => {
                const isGenerated = tpl.isGenerated;
              return (
                <div className="report-card-new" key={tpl.originalIdx}>
                  <div className="rc-new-top">
                    <div className="rc-new-icon-box">{getIcon(tpl.icon)}</div>
                    <button className={`rc-new-action-btn ${isGenerated ? 'generated' : ''}`}>
                      {isGenerated ? 'Generated' : 'Generate'}
                    </button>
                  </div>
                  <h3 className="rc-new-title">{tpl.title}</h3>
                  <p className="rc-new-desc">{tpl.desc}</p>
                </div>
              );
            })}
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
