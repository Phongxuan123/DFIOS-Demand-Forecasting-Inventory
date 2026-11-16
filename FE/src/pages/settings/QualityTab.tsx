import React, { useState } from 'react';
import { CheckCircle2, ShieldCheck, TriangleAlert, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, DataSourceNote, Input, KpiTile, Select, Table, usePagination, useToast, type Column, type Tone } from '../../components/ui/index.ts';
import { useStore } from '../../context/StoreContext.tsx';
import { useApi } from '../../hooks/useApi.ts';
import { useElapsed } from '../../hooks/useElapsed.ts';
import { useFormat, useT, type TKey } from '../../i18n/index.tsx';
import { BeText } from '../../i18n/BeText.tsx';
import { apiErrorMessage } from '../../services/apiClient.ts';
import { listDataQualityRuns, runDataQuality, type DataQualityIssue, type DataQualityRun } from '../../services/settingsApi.ts';

const STATUS_TONE: Record<string, Tone> = { PASSED: 'success', WARNING: 'warning', FAILED: 'danger' };
const SEVERITY_TONE: Record<string, Tone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', CRITICAL: 'danger' };
const KNOWN_STATUS = ['PASSED', 'WARNING', 'FAILED'];
const KNOWN_CHECKS = ['MISSING_VALUES', 'NEGATIVE_VALUE', 'DUPLICATE_DATE', 'UNKNOWN_SKU', 'OUTLIER', 'DATA_LEAKAGE', 'EMPTY_DATA'];
const KNOWN_SEVERITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const t = useT();
  const icon = status === 'PASSED' ? <CheckCircle2 size={12} aria-hidden="true" /> : status === 'FAILED' ? <XCircle size={12} aria-hidden="true" /> : <TriangleAlert size={12} aria-hidden="true" />;
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
      {icon} {KNOWN_STATUS.includes(status) ? t(`settings.quality.status.${status}` as TKey) : status}
    </Badge>
  );
};

const num = (s: string): number | null => {
  const v = s.trim().replace(',', '.');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** UC46 data quality check (Admin). Every value is what the server measured; nothing is computed here. */
export const QualityTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { stores, concreteStoreId } = useStore();
  const [store, setStore] = useState('');
  const [cutoff, setCutoff] = useState('');
  const [maxMissing, setMaxMissing] = useState('0.05');
  const [outlier, setOutlier] = useState('3');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<DataQualityRun | null>(null);
  const [version, setVersion] = useState(0);
  const elapsed = useElapsed(running);
  const ip = usePagination(25);
  const history = useApi((s) => listDataQualityRuns(s), [version]);
  const target = store || concreteStoreId || '';

  const mm = num(maxMissing);
  const oz = num(outlier);
  const mmErr = mm === null || mm < 0 || mm > 1 ? t('settings.quality.invalid') : undefined;
  const ozErr = oz === null || oz < 1 || oz > 10 ? t('settings.quality.invalid') : undefined;

  const submit = async () => {
    if (mmErr || ozErr) return;
    setRunning(true);
    setError(null);
    try {
      const res = await runDataQuality({ store_id: target || undefined, cutoff_date: cutoff || undefined, max_missing_rate: mm as number, outlier_threshold_std: oz as number });
      setRun(res);
      const label = KNOWN_STATUS.includes(res.status) ? t(`settings.quality.status.${res.status}` as TKey) : res.status;
      if (res.status === 'PASSED') toast.success(t('settings.quality.done', { status: label }));
      else toast.warning(t('settings.quality.done', { status: label }));
      setVersion((v) => v + 1);
    } catch (e) {
      setError(apiErrorMessage(e, t));
    } finally {
      setRunning(false);
    }
  };

  const issueCols: Column<DataQualityIssue>[] = [
    { key: 'type', header: t('settings.quality.col_type'), value: (i) => i.check_type, cell: (i) => (KNOWN_CHECKS.includes(i.check_type) ? t(`settings.quality.check.${i.check_type}` as TKey) : i.check_type), width: 140 },
    {
      key: 'severity',
      header: t('settings.quality.col_severity'),
      value: (i) => i.severity,
      cell: (i) => <Badge tone={SEVERITY_TONE[i.severity] ?? 'neutral'}>{KNOWN_SEVERITY.includes(i.severity) ? t(`settings.quality.severity.${i.severity}` as TKey) : i.severity}</Badge>,
      width: 120,
    },
    { key: 'sku', header: t('settings.quality.col_sku'), value: (i) => i.item_id ?? null, width: 160 },
    { key: 'message', header: t('settings.quality.col_message'), cell: (i) => <BeText className="set-wrap" text={i.message} code={i.message_code} params={i.message_params} /> },
  ];

  const historyCols: Column<DataQualityRun>[] = [
    { key: 'time', header: t('settings.quality.col_time'), value: (r) => r.created_at, cell: (r) => fmt.dateTime(r.created_at), sortable: true },
    { key: 'status', header: t('settings.quality.col_status'), value: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'by', header: t('settings.quality.col_by'), value: (r) => r.triggered_by ?? null },
    { key: 'issues', header: t('settings.quality.col_issues'), align: 'right', value: (r) => r.issues?.length ?? 0, cell: (r) => fmt.integer(r.issues?.length ?? 0) },
    {
      key: 'view',
      header: <span className="ui-sr-only">{t('settings.quality.view')}</span>,
      align: 'right',
      cell: (r) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setRun(r);
            ip.setPage(1);
          }} aria-label={`${t('settings.quality.view')}: ${fmt.dateTime(r.created_at)}`}>
          {t('settings.quality.view')}
        </Button>
      ),
    },
  ];

  const s = run?.summary;
  return (
    <div className="ui-stack">
      <Card title={t('settings.quality.title')} description={t('settings.quality.description')}>
        <form
          className="ui-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="set-fields">
            <Select label={t('settings.quality.store')} value={target} onChange={setStore} options={stores.map((x) => ({ value: x, label: x }))} disabled={running} />
            <Input label={t('settings.quality.cutoff')} hint={t('settings.quality.cutoff_hint')} type="date" value={cutoff} onChange={(e) => setCutoff(e.target.value)} disabled={running} />
            <Input label={t('settings.quality.max_missing')} hint={t('settings.quality.max_missing_hint')} inputMode="decimal" value={maxMissing} onChange={(e) => setMaxMissing(e.target.value)} error={mmErr} disabled={running} />
            <Input label={t('settings.quality.outlier')} hint={t('settings.quality.outlier_hint')} inputMode="decimal" value={outlier} onChange={(e) => setOutlier(e.target.value)} error={ozErr} disabled={running} />
          </div>
          <div className="ui-row">
            <Button type="submit" variant="primary" leftIcon={<ShieldCheck size={16} />} loading={running} disabled={!!mmErr || !!ozErr}>
              {t('settings.quality.run')}
            </Button>
            {running && <span className="set-note">{t('settings.quality.running', { seconds: elapsed })}</span>}
          </div>
          <div aria-live="polite">
            {error && (
              <Alert tone="danger" title={t('settings.quality.failed')}>
                {error}
              </Alert>
            )}
          </div>
        </form>
      </Card>

      {run && s && (
        <Card title={t('settings.quality.summary_title', { id: run.id.slice(0, 8) })} actions={<StatusBadge status={run.status} />}>
          <div className="ui-stack">
            <div className="ui-grid ui-grid--kpi">
              <KpiTile label={t('settings.quality.records')} value={fmt.integer(s.total_records)} />
              <KpiTile label={t('settings.quality.missing_rate')} value={fmt.percent(s.missing_rate, { digits: 1 })} />
              <KpiTile label={t('settings.quality.outliers')} value={fmt.integer(s.outliers_count)} />
              <KpiTile label={t('settings.quality.negatives')} value={fmt.integer(s.negative_values_count)} />
              <KpiTile label={t('settings.quality.duplicates')} value={fmt.integer(s.duplicate_dates_count)} />
              <KpiTile label={t('settings.quality.invalid_sku')} value={fmt.integer(s.invalid_sku_count)} />
              <KpiTile label={t('settings.quality.leakage')} value={s.leakage_detected ? t('settings.quality.leakage_yes') : t('settings.quality.leakage_no')} />
            </div>
            <div className="set-label">{t('settings.quality.issues', { n: fmt.integer(run.issues.length) })}</div>
            {run.issues.length === 0 ? (
              <Alert tone="success">{t('settings.quality.no_issues')}</Alert>
            ) : (
              <Table columns={issueCols} rows={run.issues} rowKey={(i) => `${i.check_type}|${i.item_id ?? ''}|${i.message}`} dense wrap maxHeight={360} pagination={{ page: ip.page, pageSize: ip.pageSize, onPageChange: ip.setPage, onPageSizeChange: ip.setPageSize }} />
            )}
          </div>
        </Card>
      )}

      <Card title={t('settings.quality.history_title')} flush>
        <Table columns={historyCols} rows={history.data?.items ?? []} rowKey={(r) => r.id} loading={history.loading && !history.data} error={history.error} onRetry={history.refetch} dense />
        <div className="set-pad">
          <DataSourceNote source={t('settings.quality.source')} note={history.data ? String(history.data.total) : undefined} />
        </div>
      </Card>
    </div>
  );
};
