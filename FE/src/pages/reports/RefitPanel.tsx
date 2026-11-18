import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCcw } from 'lucide-react';
import { Alert, Badge, Button, Card, Input, Select, Table, useConfirm, useToast, type Column } from '../../components/ui/index.ts';
import { useElapsed } from '../../hooks/useElapsed.ts';
import { useClock } from '../../context/ClockContext.tsx';
import { useFormat, useT } from '../../i18n/index.tsx';
import { apiErrorMessage } from '../../services/apiClient.ts';
import { postRefitPolicies, type PolicySelectionItem, type RefitPoliciesResponse } from '../../services/reportsApi.ts';

type SearchMode = 'auto' | 'kappa_only' | 'm_grid';

/**
 * Job J5 on demand (demo.md §6.2 screen 6, step 9): re-select (m_g, kappa_g) per ABC-XYZ class on the recent
 * reviews before the simulated clock. Manager and Admin only; the result is persisted by the server and the run is
 * recorded in /batch-runs.
 */
export const RefitPanel: React.FC<{ storeId: string }> = ({ storeId }) => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const { clock, refresh } = useClock();
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState<SearchMode>('auto');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RefitPoliciesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const elapsed = useElapsed(running);

  const targetNum = target.trim() === '' ? undefined : Number(target.replace(',', '.'));
  const targetValid = targetNum === undefined || (Number.isFinite(targetNum) && targetNum >= 0.85 && targetNum <= 0.999);

  const run = async () => {
    if (!targetValid) return;
    const ok = await confirm({
      title: t('reports.refit.confirm_title'),
      description: t('reports.refit.confirm_body', { store: storeId, date: clock?.current_date ? fmt.date(clock.current_date) : '—' }),
      confirmLabel: t('reports.refit.run'),
    });
    if (!ok) return;
    setRunning(true);
    setError(null);
    try {
      const res = await postRefitPolicies({ store_id: storeId, target_availability: targetNum, search_mode: mode });
      setResult(res);
      toast.success(t('reports.refit.done', { n: res.policies.length, id: res.selection_id }));
      refresh();
    } catch (err) {
      const msg = apiErrorMessage(err, t);
      setError(msg);
      toast.error(t('reports.refit.failed'), msg);
    } finally {
      setRunning(false);
    }
  };

  const num = (v: number | null | undefined, digits: number) => (v !== null && v !== undefined && Number.isFinite(v) ? fmt.number(v, { digits }) : '—');
  const columns: Column<PolicySelectionItem>[] = [
    { key: 'class', header: t('reports.refit.col_class'), cell: (r) => <strong>{r.class_id}</strong> },
    { key: 'm', header: 'm_g', align: 'right', value: (r) => r.m_g, cell: (r) => <span className="ui-num">{num(r.m_g, 2)}</span> },
    { key: 'k', header: 'κ_g', align: 'right', value: (r) => r.kappa_g, cell: (r) => <span className="ui-num">{num(r.kappa_g, 2)}</span> },
    { key: 'cost', header: t('reports.refit.col_cost'), align: 'right', value: (r) => r.val_cost, cell: (r) => (r.val_cost != null ? fmt.currency(r.val_cost) : '—') },
    {
      key: 'service',
      header: t('reports.refit.col_service'),
      align: 'right',
      value: (r) => r.val_service,
      cell: (r) => (r.val_service != null ? fmt.percent(r.val_service, { scale: 'ratio', digits: 1 }) : '—'),
    },
    {
      key: 'feasible',
      header: t('reports.refit.col_feasible'),
      cell: (r) =>
        r.is_feasible == null ? '—' : <Badge tone={r.is_feasible ? 'success' : 'warning'}>{t(r.is_feasible ? 'reports.refit.feasible' : 'reports.refit.infeasible')}</Badge>,
    },
    { key: 'n', header: t('reports.refit.col_items'), align: 'right', value: (r) => r.n_items, cell: (r) => (r.n_items != null ? fmt.integer(r.n_items) : '—') },
    { key: 'mode', header: t('reports.refit.col_mode'), cell: (r) => r.search_mode ?? '—' },
  ];

  return (
    <Card title={t('reports.refit.title')} description={t('reports.refit.description')}>
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 200 }}>
            <Input
              label={t('reports.refit.target')}
              placeholder={t('reports.refit.target_placeholder')}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              error={targetValid ? undefined : t('reports.refit.target_error')}
              disabled={running}
            />
          </div>
          <div style={{ width: 220 }}>
            <Select<SearchMode>
              aria-label={t('reports.refit.mode')}
              value={mode}
              onChange={setMode}
              disabled={running}
              options={[
                { value: 'auto', label: t('reports.refit.mode_auto') },
                { value: 'kappa_only', label: t('reports.refit.mode_kappa') },
                { value: 'm_grid', label: t('reports.refit.mode_grid') },
              ]}
            />
          </div>
          <Button variant="primary" leftIcon={<RefreshCcw size={14} />} loading={running} disabled={!targetValid} onClick={() => void run()}>
            {running ? t('reports.refit.running', { s: elapsed }) : t('reports.refit.run')}
          </Button>
        </div>

        {error && <Alert tone="danger">{error}</Alert>}

        {result && (
          <>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--text-xs)' }}>
              <Badge tone="success">{result.selection_id}</Badge>
              <span className="ui-muted">{result.message}</span>
              {result.run_id && (
                <Button size="sm" variant="ghost" onClick={() => navigate('/batch-runs')}>
                  {t('reports.refit.open_batch')}
                </Button>
              )}
            </div>
            <Table columns={columns} rows={result.policies} rowKey={(r) => r.class_id} dense />
          </>
        )}
      </div>
      {dialog}
    </Card>
  );
};
