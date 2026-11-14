import React, { useState } from 'react';
import { Play, Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, Checkbox, DataSourceNote, IconButton, Input, Modal, Select, Table, useConfirm, useToast, type Column } from '../../components/ui/index.ts';
import { useStore } from '../../context/StoreContext.tsx';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { apiErrorMessage } from '../../services/apiClient.ts';
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  runPipelineNow,
  type PipelineRun,
  type Schedule,
} from '../../services/settingsApi.ts';

const CRON_FIELDS = 5;

const ModeBadge: React.FC<{ mode?: string | null }> = ({ mode }) => {
  const t = useT();
  if (mode === 'scheduled') return <Badge tone="success">{t('settings.schedules.mode_scheduled')}</Badge>;
  if (mode === 'manual') return <Badge tone="warning">{t('settings.schedules.mode_manual')}</Badge>;
  return <Badge tone="neutral">{t('settings.schedules.mode_unknown')}</Badge>;
};

const CreateModal: React.FC<{ open: boolean; onClose: () => void; stores: string[]; defaultStore: string; onCreated: () => void }> = ({ open, onClose, stores, defaultStore, onCreated }) => {
  const t = useT();
  const toast = useToast();
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 2 * * *');
  const [model, setModel] = useState('lightgbm');
  const [horizon, setHorizon] = useState('28');
  const [store, setStore] = useState(defaultStore);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errs = {
    name: !name.trim() ? t('settings.schedules.name_required') : undefined,
    cron: cron.trim().split(/\s+/).length !== CRON_FIELDS ? t('settings.schedules.cron_invalid') : undefined,
    horizon: !(Number(horizon) >= 7 && Number(horizon) <= 28 && Number.isInteger(Number(horizon))) ? t('settings.schedules.horizon_invalid') : undefined,
  };
  const valid = !errs.name && !errs.cron && !errs.horizon && !!store && !!model.trim();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await createSchedule({ name: name.trim(), cron_expression: cron.trim(), model_name: model.trim(), horizon: Number(horizon), store_id: store, auto_trigger_optimization: auto });
      toast.success(t('settings.schedules.created', { name: created.name }));
      setName('');
      onCreated();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      dismissible={!busy}
      title={t('settings.schedules.create_title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.actions.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={submit}>
            {t('common.actions.create')}
          </Button>
        </>
      }
    >
      <div className="ui-stack">
        <Input label={t('settings.schedules.name')} value={name} onChange={(e) => setName(e.target.value)} error={name ? errs.name : undefined} />
        <Input label={t('settings.schedules.cron')} hint={t('settings.schedules.cron_hint')} value={cron} onChange={(e) => setCron(e.target.value)} error={errs.cron} />
        <Input label={t('settings.schedules.model')} value={model} onChange={(e) => setModel(e.target.value)} />
        <Input label={t('settings.schedules.horizon')} inputMode="numeric" value={horizon} onChange={(e) => setHorizon(e.target.value)} error={errs.horizon} />
        <Select label={t('settings.schedules.store')} value={store} onChange={setStore} options={stores.map((s) => ({ value: s, label: s }))} />
        <Checkbox checked={auto} onChange={setAuto} label={t('settings.schedules.auto_opt')} />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
};

export const SchedulesTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { storeId, stores } = useStore();
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [runStore, setRunStore] = useState<string>(storeId ?? '');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<PipelineRun | null>(null);
  const { data, loading, error, refetch } = useApi((s) => listSchedules(s), [version]);

  const items = data?.items ?? [];
  const modeOf = (s: Schedule) => s.mode ?? data?.mode ?? null;
  const anyScheduled = items.some((s) => modeOf(s) === 'scheduled');
  const anyManual = items.some((s) => modeOf(s) === 'manual');
  const anyUnknown = items.some((s) => !modeOf(s));
  const serverNote = data?.note ?? items.find((s) => s.note)?.note;
  const targetStore = runStore || storeId || '';

  const runNow = async () => {
    if (!targetStore) return;
    const ok = await confirm({
      title: t('settings.schedules.run_title', { store: targetStore }),
      description: t('settings.schedules.run_description'),
      confirmLabel: t('settings.schedules.run_confirm'),
    });
    if (!ok) return;
    setRunning(true);
    setRunError(null);
    try {
      const res = await runPipelineNow({ model_name: 'lightgbm', horizon: 28, store_id: targetStore });
      setLastRun(res);
      toast.success(t('settings.schedules.run_done', { seconds: fmt.number(res.duration_seconds, { digits: 1 }) }));
      setVersion((v) => v + 1);
    } catch (e) {
      setRunError(apiErrorMessage(e, t));
    } finally {
      setRunning(false);
    }
  };

  const remove = async (s: Schedule) => {
    const ok = await confirm({ title: t('settings.schedules.delete_title', { name: s.name }), description: t('settings.schedules.delete_description'), tone: 'danger', confirmLabel: t('settings.schedules.delete') });
    if (!ok) return;
    try {
      await deleteSchedule(s.id);
      toast.success(t('settings.schedules.deleted'));
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(t('common.errors.unknown'), apiErrorMessage(e, t));
    }
  };

  const columns: Column<Schedule>[] = [
    { key: 'name', header: t('settings.schedules.col_name'), value: (r) => r.name, sortable: true },
    { key: 'cron', header: t('settings.schedules.col_cron'), cell: (r) => <code>{r.cron_expression}</code> },
    { key: 'model', header: t('settings.schedules.col_model'), value: (r) => r.model_name },
    { key: 'store', header: t('settings.schedules.col_store'), value: (r) => r.store_id },
    { key: 'horizon', header: t('settings.schedules.col_horizon'), align: 'right', cell: (r) => fmt.integer(r.horizon) },
    { key: 'mode', header: t('settings.schedules.col_mode'), cell: (r) => <ModeBadge mode={modeOf(r)} /> },
    { key: 'last', header: t('settings.schedules.col_last'), cell: (r) => (r.last_run_at ? fmt.dateTime(r.last_run_at) : t('settings.common.never')) },
    { key: 'next', header: t('settings.schedules.col_next'), cell: (r) => (r.next_run_at ? fmt.dateTime(r.next_run_at) : '—') },
    { key: 'actions', header: t('settings.schedules.col_actions'), align: 'right', width: 72, cell: (r) => <IconButton label={t('settings.schedules.delete')} icon={<Trash2 size={16} />} onClick={() => remove(r)} /> },
  ];

  return (
    <div className="ui-stack">
      <Card title={t('settings.schedules.run_panel_title')} description={t('settings.schedules.run_panel_description')}>
        <div className="ui-stack">
          <div className="ui-row set-run-row">
            <Select label={t('settings.schedules.store')} value={targetStore} onChange={setRunStore} options={stores.map((s) => ({ value: s, label: s }))} disabled={running} />
            <Button variant="primary" leftIcon={<Play size={16} />} loading={running} disabled={!targetStore} onClick={runNow}>
              {t('settings.schedules.run_now')}
            </Button>
          </div>
          {running && <Alert tone="info">{t('settings.schedules.run_running', { store: targetStore })}</Alert>}
          {runError && (
            <Alert tone="danger" title={t('settings.schedules.run_failed')}>
              {runError}
            </Alert>
          )}
          {lastRun && (
            <Alert tone="success" title={t('settings.schedules.run_result_title', { id: lastRun.run_id })}>
              {t('settings.schedules.run_status')}: {lastRun.status} · {t('settings.schedules.run_forecasts')}: {fmt.integer(lastRun.forecasts_generated)} · {t('settings.schedules.run_params')}: {fmt.integer(lastRun.inventory_params_updated)} ·{' '}
              {t('settings.schedules.run_classes')}: {fmt.integer(lastRun.classifications_updated)} · {t('settings.schedules.run_replen')}: {fmt.integer(lastRun.replenishments_generated)}
            </Alert>
          )}
        </div>
      </Card>

      <Card
        title={t('settings.schedules.title')}
        description={t('settings.schedules.description')}
        flush
        actions={
          <Button variant="secondary" size="sm" leftIcon={<Plus size={16} />} onClick={() => setCreating(true)}>
            {t('settings.schedules.create')}
          </Button>
        }
      >
        <div className="set-pad">
          {items.length > 0 && anyUnknown && <Alert tone="warning">{t('settings.schedules.no_mode_note')}</Alert>}
          {items.length > 0 && anyManual && !anyUnknown && !anyScheduled && <Alert tone="info">{t('settings.schedules.manual_note')}</Alert>}
          {serverNote && <p className="set-note">{t('settings.schedules.server_note', { note: serverNote })}</p>}
        </div>
        <Table
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={refetch}
          emptyTitle={t('settings.schedules.empty_title')}
          emptyDescription={t('settings.schedules.empty_description')}
          dense
        />
        <div className="set-pad">
          <DataSourceNote source={t('settings.schedules.source')} />
        </div>
      </Card>
      <CreateModal open={creating} onClose={() => setCreating(false)} stores={stores} defaultStore={storeId ?? stores[0] ?? ''} onCreated={() => setVersion((v) => v + 1)} />
      {dialog}
    </div>
  );
};
