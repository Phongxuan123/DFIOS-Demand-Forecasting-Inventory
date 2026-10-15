import React from 'react';
import { TrendingUp, Activity, Grid, Settings as SettingsIcon } from 'lucide-react';
import { api } from '../services/api.ts';
import './Reports.css';

export const Reports: React.FC = () => {
  const [data, setData] = React.useState<any>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [filterType, setFilterType] = React.useState('All Reports');
  const [sortDesc, setSortDesc] = React.useState(false);
  const [generatingReport, setGeneratingReport] = React.useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = React.useState('');

  const loadReportsData = async () => {
    try {
      const result = await api.reports.getRecentLogs();
      setData(result);
    } catch (error) {
      console.error('Failed to load reports data', error);
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    loadReportsData();
  }, []);

  const downloadCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [
        headers.join(','),
        ...rows.map((row) =>
          row.map((val) => `"${String(val ?? '').replace(/"/g, '""')}"`).join(',')
        ),
      ].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGenerateReport = async (title: string) => {
    setGeneratingReport(title);
    setFeedbackMsg('');
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      if (title.includes('Inventory Reconciliation')) {
        const inv = await api.inventory.getInventory({ limit: 100 });
        const headers = ['SKU_ID', 'STORE_ID', 'ON_HAND', 'ON_ORDER', 'SAFETY_STOCK', 'ROP'];
        const rows = (inv.list || []).map((item: any) => [
          item.item_id,
          item.store_id,
          item.on_hand ?? 0,
          item.on_order ?? 0,
          item.safety_stock ?? 0,
          item.reorder_point ?? 0,
        ]);
        downloadCsv(`Inventory_Reconciliation_${timestamp}.csv`, headers, rows);
        setFeedbackMsg(`Successfully exported Inventory Reconciliation report.`);
      } else if (title.includes('Stockout Risk')) {
        const skus = await api.classification.getSkus({ limit: 100 });
        const headers = ['SKU_ID', 'NAME', 'ABC', 'XYZ', 'SEGMENT', 'REVENUE_PCT', 'DEMAND_CV'];
        const rows = (skus.list || []).map((s: any) => [
          s.item_id,
          s.name,
          s.abc_class,
          s.xyz_class,
          `${s.abc_class}${s.xyz_class}`,
          s.revenue_percentage ? `${Number(s.revenue_percentage).toFixed(2)}%` : '-',
          s.coefficient_of_variation ? Number(s.coefficient_of_variation).toFixed(2) : '-',
        ]);
        downloadCsv(`Stockout_Risk_Classification_${timestamp}.csv`, headers, rows);
        setFeedbackMsg(`Successfully exported Stockout Risk Assessment.`);
      } else if (title.includes('Supplier Lead Time')) {
        const supp = await api.products.getSuppliers();
        const headers = ['SUPPLIER_NAME', 'LEAD_TIME_DAYS', 'EMAIL', 'PHONE'];
        const rows = (supp.list || []).map((s: any) => [
          s.name,
          s.lead_time_days ?? 5,
          s.email || '',
          s.phone || '',
        ]);
        downloadCsv(`Supplier_Lead_Time_Audit_${timestamp}.csv`, headers, rows);
        setFeedbackMsg(`Successfully exported Supplier Lead Time Audit.`);
      } else {
        // Master Data Integrity / Audit Trail
        const logs = await api.settings.getAuditLogs({ limit: '100' });
        const headers = ['TIMESTAMP', 'OPERATOR', 'ACTION', 'DETAILS', 'IP_ADDRESS'];
        const rows = (logs.logs || []).map((l: any) => [
          l.created_at || l.timestamp,
          l.actor_email || l.user,
          l.action,
          l.details,
          l.ip_address || '',
        ]);
        downloadCsv(`System_Audit_Report_${timestamp}.csv`, headers, rows);
        setFeedbackMsg(`Successfully exported System Audit Report.`);
      }
    } catch (e: any) {
      console.error(e);
      setFeedbackMsg(`Failed to generate report: ${e.message || 'Unknown error'}`);
    } finally {
      setGeneratingReport(null);
    }
  };

  const handleDownloadLog = async (log: any) => {
    try {
      const logs = await api.settings.getAuditLogs({ limit: '50' });
      const headers = ['TIMESTAMP', 'OPERATOR', 'ACTION', 'DETAILS', 'IP_ADDRESS'];
      const rows = (logs.logs || []).map((l: any) => [
        l.created_at || l.timestamp,
        l.actor_email || l.user,
        l.action,
        l.details,
        l.ip_address || '',
      ]);
      downloadCsv(log.name || 'Exported_Audit_Report.csv', headers, rows);
    } catch (e: any) {
      alert('Failed to download report log');
    }
  };

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'TrendingUp': return <TrendingUp size={20} />;
      case 'Activity': return <Activity size={20} />;
      case 'Grid': return <Grid size={20} />;
      case 'Settings': return <SettingsIcon size={20} />;
      default: return <Grid size={20} />;
    }
  };

  return (
    <div className="animate-fade-in mb-6">
      <div className="reports-top-header">
        <h2 className="reports-main-title">Reports & Analytics</h2>
        <p className="reports-main-subtitle">Generate and export master inventory, classification, and audit data reports.</p>
      </div>

      {feedbackMsg && (
        <div style={{ marginBottom: '1.25rem', padding: '0.75rem 1rem', borderRadius: '6px', backgroundColor: feedbackMsg.includes('Failed') ? '#fef2f2' : '#ecfdf5', color: feedbackMsg.includes('Failed') ? '#b91c1c' : '#047857', fontSize: '13px' }}>
          {feedbackMsg}
        </div>
      )}

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
            <SettingsIcon size={14} />
          </button>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-32 text-[var(--text-secondary)]">Loading reports data...</div>
      ) : (
        <>
          <div className="report-grid-3col">
            {(data.templates || [])
              .map((tpl: any, idx: number) => ({ ...tpl, originalIdx: idx, isGenerated: idx % 2 === 1 }))
              .filter((tpl: any) => tpl.title.toLowerCase().includes(searchTerm.toLowerCase()) || tpl.desc.toLowerCase().includes(searchTerm.toLowerCase()))
              .filter((tpl: any) => {
                if (filterType === 'Generated') return tpl.isGenerated;
                if (filterType === 'Scheduled') return !tpl.isGenerated;
                return true;
              })
              .sort((a: any, b: any) => sortDesc ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title))
              .map((tpl: any) => {
                const isBusy = generatingReport === tpl.title;
                return (
                  <div className="report-card-new" key={tpl.originalIdx}>
                    <div className="rc-new-top">
                      <div className="rc-new-icon-box">{getIcon(tpl.icon)}</div>
                      <button
                        className={`rc-new-action-btn ${isBusy ? 'generating' : ''}`}
                        onClick={() => handleGenerateReport(tpl.title)}
                        disabled={isBusy}
                      >
                        {isBusy ? 'Exporting...' : 'Generate CSV'}
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
                {(data.logs || []).length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                    No generated reports available yet.
                  </div>
                ) : (
                  (data.logs || []).map((log: any, idx: number) => (
                    <div className="log-row" key={idx}>
                      <div className="log-col-1">{log.name}</div>
                      <div className="log-col-2">{log.type}</div>
                      <div className="log-col-3">{log.date}</div>
                      <div className="log-col-4">
                        <span className={`format-badge ${log.formatClass || 'csv'}`}>{log.format || 'CSV'}</span>
                      </div>
                      <div className="log-col-5">{log.size || '20 KB'}</div>
                      <div className="log-col-6">
                        <span className={`status-badge ${log.status === 'READY' ? 'ready' : 'processing'}`}>{log.status || 'READY'}</span>
                      </div>
                      <div className="log-col-7">
                        <button className="download-btn" onClick={() => handleDownloadLog(log)}>
                          Download
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
