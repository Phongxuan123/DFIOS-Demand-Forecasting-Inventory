import React, { useState } from 'react';
import { GitBranch, RefreshCw, Cpu, RotateCcw, Info } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  PageHeader,
  Select,
  Table,
  useConfirm,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { useApi } from '../hooks/useApi.ts';
import { useStore } from '../context/StoreContext.tsx';
import { useClock } from '../context/ClockContext.tsx';
import { useFormat, useT } from '../i18n/index.tsx';
import { apiErrorMessage } from '../services/apiClient.ts';
import {
  activateForecastSource,
  getForecastSources,
  type ModelActivationLog,
} from '../services/forecastSourcesApi.ts';

/** Admin "Model versions" (demo.md step 10, E9c): which model feeds the window quantiles of the next reviews. */
export const ModelVersions: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { concreteStoreId } = useStore();
  const storeId = concreteStoreId || 'CA_1';
  const clock = useClock();
  const { confirm, dialog } = useConfirm();

  const [selectedModel, setSelectedModel] = useState<string>('');
  const [activating, setActivating] = useState<boolean>(false);
  const [nonce, setNonce] = useState(0);

  const sourcesApi = useApi((signal) => getForecastSources(storeId, signal), [storeId, clock.version, nonce]);

  const activeModel = sourcesApi.data?.active_model ?? null;
  const availableModels = sourcesApi.data?.available_models ?? [];
  const activations = sourcesApi.data?.activations ?? [];
  const latestActivation = activations[0] ?? null;

  /** One confirmation, then POST /forecast-sources/activate. A rollback is the activation of the previous model. */
  const activate = async (model: string, rollback: boolean) => {
    if (!model) return;
    const ok = await confirm({
      title: t(rollback ? 'ops.sources.confirm_rollback_title' : 'ops.sources.confirm_title', { model }),
      description: t(rollback ? 'ops.sources.confirm_rollback_body' : 'ops.sources.confirm_body', { model, store: storeId }),
      confirmLabel: rollback ? t('ops.sources.rollback', { model }) : t('ops.sources.activate'),
    });
    if (!ok) return;
    setActivating(true);
    try {
      const res = await activateForecastSource({ store_id: storeId, model });
      toast.success(
        t('ops.sources.activated', { model: res.model }),
        t('ops.sources.activated_body', {
          from: fmt.date(res.from_date),
          origins: fmt.integer(res.n_origins),
          rows: fmt.integer(res.n_rows),
        }),
      );
      setSelectedModel('');
      setNonce((n) => n + 1);
    } catch (err) {
      toast.error(t('ops.sources.activate_failed'), apiErrorMessage(err, t));
    } finally {
      setActivating(false);
    }
  };

  const modelOptions = availableModels.map((m) => ({
    value: m.model,
    label: t('ops.sources.option_label', {
      model: m.model,
      count: fmt.integer(m.n_origins),
      from: fmt.date(m.first_origin),
      to: fmt.date(m.last_origin),
    }),
  }));

  const logColumns: Column<ModelActivationLog>[] = [
    {
      key: 'model',
      header: t('ops.sources.col_model'),
      cell: (r, idx) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 'var(--weight-semibold)', fontFamily: 'var(--font-mono)' }}>{r.model}</span>
          {idx === 0 && r.model === activeModel && <Badge tone="success">{t('ops.sources.current')}</Badge>}
        </div>
      ),
    },
    {
      key: 'previous_model',
      header: t('ops.sources.col_previous'),
      cell: (r) => (
        <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>{r.previous_model || '—'}</span>
      ),
    },
    { key: 'from_date', header: t('ops.sources.col_from'), cell: (r) => fmt.date(r.from_date) },
    { key: 'n_origins', header: t('ops.sources.col_origins'), align: 'right', cell: (r) => fmt.integer(r.n_origins) },
    { key: 'n_rows', header: t('ops.sources.col_rows'), align: 'right', cell: (r) => fmt.integer(r.n_rows) },
    { key: 'activated_by', header: t('ops.sources.col_by'), cell: (r) => r.activated_by || '—' },
    { key: 'activated_at', header: t('ops.sources.col_at'), cell: (r) => fmt.dateTime(r.activated_at) },
  ];

  return (
    <div className="ui-stack">
      <PageHeader
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <GitBranch size={22} />
            <span>{t('ops.sources.title')}</span>
          </div>
        }
        description={t('ops.sources.description')}
        actions={
          <Button variant="secondary" leftIcon={<RefreshCw size={15} />} onClick={() => setNonce((n) => n + 1)} loading={sourcesApi.loading}>
            {t('ops.sources.refresh')}
          </Button>
        }
      />

      {sourcesApi.error ? (
        <ErrorState error={sourcesApi.error} onRetry={sourcesApi.refetch} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
            <Card title={t('ops.sources.active_title')}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-accent-subtle)',
                      color: 'var(--color-accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Cpu size={24} />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', fontFamily: 'var(--font-mono)' }}>
                      {activeModel ?? '—'}
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{t('ops.sources.active_hint')}</div>
                  </div>
                </div>

                <div
                  style={{
                    borderTop: '1px solid var(--color-border-subtle)',
                    paddingTop: 'var(--space-3)',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 'var(--space-2)',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  <div>
                    <span className="ui-muted">{t('ops.sources.store')}: </span>
                    <strong>{storeId}</strong>
                  </div>
                  <div>
                    <span className="ui-muted">{t('ops.sources.window')}: </span>
                    <strong>{sourcesApi.data ? t('ops.sources.window_value', { days: sourcesApi.data.horizon_days }) : '—'}</strong>
                  </div>
                  <div>
                    <span className="ui-muted">{t('ops.sources.clock_date')}: </span>
                    <strong>{sourcesApi.data?.clock_date ? fmt.date(sourcesApi.data.clock_date) : '—'}</strong>
                  </div>
                  <div>
                    <span className="ui-muted">{t('ops.sources.available')}: </span>
                    <strong>{t('ops.sources.available_value', { count: availableModels.length })}</strong>
                  </div>
                </div>

                {latestActivation?.previous_model && latestActivation.model === activeModel && (
                  <div style={{ paddingTop: 'var(--space-2)' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<RotateCcw size={14} />}
                      onClick={() => void activate(latestActivation.previous_model as string, true)}
                      loading={activating}
                    >
                      {t('ops.sources.rollback', { model: latestActivation.previous_model })}
                    </Button>
                  </div>
                )}
              </div>
            </Card>

            <Card title={t('ops.sources.activate_title')}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <Select<string>
                      id="model-source-select"
                      size="sm"
                      value={selectedModel}
                      onChange={setSelectedModel}
                      options={[{ value: '', label: t('ops.sources.select_placeholder') }, ...modelOptions]}
                      disabled={activating || availableModels.length === 0}
                      aria-label={t('ops.sources.select_label')}
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void activate(selectedModel, false)}
                    disabled={!selectedModel || selectedModel === activeModel}
                    loading={activating}
                  >
                    {t('ops.sources.activate')}
                  </Button>
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-2)',
                    backgroundColor: 'var(--color-surface-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  <Info size={14} style={{ flex: '0 0 auto', marginTop: 1 }} />
                  <span>{t('ops.sources.activate_hint')}</span>
                </div>
              </div>
            </Card>
          </div>

          <Card title={t('ops.sources.log_title')}>
            {activations.length === 0 && !sourcesApi.loading ? (
              <div style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
                <p className="ui-muted">{t('ops.sources.log_empty')}</p>
              </div>
            ) : (
              <Table columns={logColumns} rows={activations} rowKey={(r) => `${r.model}_${r.activated_at}`} loading={sourcesApi.loading} />
            )}
          </Card>
        </>
      )}

      {dialog}
    </div>
  );
};
