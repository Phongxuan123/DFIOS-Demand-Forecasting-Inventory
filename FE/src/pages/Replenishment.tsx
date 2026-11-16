import React, { useCallback, useMemo, useState } from 'react';
import { Check, Download, Pencil, RefreshCw, Sparkles, Ban, X, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useStore } from '../context/StoreContext.tsx';
import { useClock } from '../context/ClockContext.tsx';
import { useApi } from '../hooks/useApi.ts';
import { useFormat, useT } from '../i18n/index.tsx';
import { useBe, useBeCode } from '../i18n/useBe.ts';
import { prefixCode } from '../i18n/beText.ts';
import { can } from '../auth/permissions.ts';
import { apiErrorMessage } from '../services/apiClient.ts';
import {
  adjustReplenishment,
  approveReplenishment,
  cancelReplenishment,
  exportReplenishmentsCsv,
  generateReplenishments,
  getCalibrationStatus,
  getPolicyParam,
  listReplenishmentHistory,
  listReplenishments,
  rejectReplenishment,
  type ReplenishmentItem,
} from '../services/replenishmentApi.ts';
import { emitAlertsSyncEvent } from '../utils/alertTracker.ts';
import { inventoryPosition } from '../utils/policyMath.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataSourceNote,
  Drawer,
  EmptyState,
  HoldHeight,
  Input,
  IconButton,
  KpiTile,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Table,
  type SortState,
  Tabs,
  Unavailable,
  useConfirm,
  usePagination,
  useRowSelection,
  useToast,
  type Column,
  type Tone,
} from '../components/ui/index.ts';
import './Replenishment.css';

/** Sanity ceiling for a manual order quantity (the API only requires > 0). */
const MAX_ORDER_QTY = 1_000_000;

const STATUS_TONE: Record<string, Tone> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' };
const PRIORITY_TONE: Record<string, Tone> = { CRITICAL: 'danger', HIGH: 'warning', MEDIUM: 'info', LOW: 'neutral' };
const STATUS_KEYS = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
const PRIORITY_KEYS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

/** Table column key -> backend sort_by (only these are sortable server-side). */
const SORT_MAP: Record<string, string> = { sku: 'item_id', priority: 'priority', status: 'status', recommended: 'recommended_qty', final: 'final_qty', created: 'created_at' };

type DialogState = { kind: 'reject' | 'cancel' | 'adjust'; rec: ReplenishmentItem } | null;

export const Replenishment: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { user } = useAuth();
  const { storeId } = useStore();
  const { version } = useClock();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const canWrite = can(user?.role, 'replenishment:write');

  const [tab, setTab] = useState<'proposals' | 'history'>('proposals');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [search, setSearch] = useState('');
  const [nonce, setNonce] = useState(0);
  const [sort, setSort] = useState<SortState | null>(null);
  const pg = usePagination(25);
  const sel = useRowSelection();
  const [overrides, setOverrides] = useState<Record<string, Partial<ReplenishmentItem>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [detail, setDetail] = useState<ReplenishmentItem | null>(null);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const resetPage = () => pg.setPage(1);

  const list = useApi(
    (signal) =>
      listReplenishments(
        { skip: pg.offset, limit: pg.pageSize, store_id: storeId as string, status: status || undefined, priority: priority || undefined, search: search.trim() || undefined, sort_by: sort ? SORT_MAP[sort.key] : undefined, sort_dir: sort?.dir },
        signal,
      ),
    [storeId, pg.offset, pg.pageSize, status, priority, search, sort, version, nonce],
    { enabled: !!storeId && tab === 'proposals' },
  );
  const history = useApi(
    (signal) =>
      listReplenishmentHistory(
        { skip: pg.offset, limit: pg.pageSize, store_id: storeId as string, status: status || undefined },
        signal,
      ),
    [storeId, pg.offset, pg.pageSize, status, version, nonce],
    { enabled: !!storeId && tab === 'history' },
  );
  const active = tab === 'proposals' ? list : history;

  const rows = useMemo(
    () => (active.data?.items ?? []).map((r) => (overrides[r.id] ? { ...r, ...overrides[r.id] } : r)),
    [active.data, overrides],
  );

  const afterMutation = () => {
    emitAlertsSyncEvent();
    refresh();
  };

  /** Optimistic update with rollback (R-35 / F-19). */
  const mutate = async (rec: ReplenishmentItem, patch: Partial<ReplenishmentItem>, call: () => Promise<unknown>, okMsg: string) => {
    setBusy(rec.id);
    setOverrides((o) => ({ ...o, [rec.id]: patch }));
    try {
      await call();
      toast.success(okMsg);
      sel.set(new Set([...sel.selected].filter((k) => k !== rec.id)));
      afterMutation();
      return true;
    } catch (err) {
      toast.error(t('replenishment.toast.failed', { message: apiErrorMessage(err, t) }));
      return false;
    } finally {
      setOverrides((o) => {
        const next = { ...o };
        delete next[rec.id];
        return next;
      });
      setBusy(null);
    }
  };

  const onApprove = async (rec: ReplenishmentItem) => {
    const ok = await confirm({
      title: t('replenishment.confirm.approve_title', { sku: rec.item_id }),
      description: t('replenishment.confirm.approve_desc', { qty: fmt.integer(rec.final_qty), store: rec.store_id }),
      confirmLabel: t('replenishment.action.approve'),
    });
    if (!ok) return;
    await mutate(rec, { status: 'APPROVED' }, () => approveReplenishment(rec.id), t('replenishment.toast.approved', { sku: rec.item_id }));
  };

  const onBulkApprove = async () => {
    const ids = [...sel.selected].map(String);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: t('replenishment.confirm.bulk_title', { count: ids.length }),
      description: t('replenishment.confirm.bulk_desc'),
      confirmLabel: t('replenishment.action.approve'),
    });
    if (!ok) return;
    setOverrides((o) => ({ ...o, ...Object.fromEntries(ids.map((id) => [id, { status: 'APPROVED' } as Partial<ReplenishmentItem>])) }));
    let done = 0;
    const failedIds: string[] = [];
    for (const id of ids) {
      try {
        await approveReplenishment(id);
        done += 1;
      } catch {
        failedIds.push(id);
      }
    }
    setOverrides({});
    sel.set(new Set(failedIds));
    if (failedIds.length === 0) toast.success(t('replenishment.toast.bulk_done', { ok: done }));
    else toast.warning(t('replenishment.toast.bulk_partial', { ok: done, total: ids.length, failed: failedIds.length }));
    afterMutation();
  };

  const onGenerate = async () => {
    if (!storeId) return;
    const ok = await confirm({
      title: t('replenishment.confirm.generate_title', { store: storeId }),
      description: t('replenishment.confirm.generate_desc'),
      confirmLabel: t('replenishment.action.generate'),
    });
    if (!ok) return;
    try {
      const res = await generateReplenishments(storeId);
      toast.success(t('replenishment.toast.generated', { count: res.generated_count }));
      afterMutation();
    } catch (err) {
      toast.error(t('replenishment.toast.failed', { message: apiErrorMessage(err, t) }));
    }
  };

  const onExport = async () => {
    if (!storeId) return;
    try {
      await exportReplenishmentsCsv(storeId, status || undefined);
      toast.success(t('replenishment.toast.exported'));
    } catch (err) {
      toast.error(t('replenishment.toast.failed', { message: apiErrorMessage(err, t) }));
    }
  };

  const statusLabel = (s: string) => ((STATUS_KEYS as readonly string[]).includes(s) ? t(`replenishment.status.${s as (typeof STATUS_KEYS)[number]}`) : s);
  const priorityLabel = (p: string) => ((PRIORITY_KEYS as readonly string[]).includes(p) ? t(`replenishment.priority.${p as (typeof PRIORITY_KEYS)[number]}`) : p);

  const columns: Column<ReplenishmentItem>[] = [
    {
      key: 'sku',
      header: t('replenishment.col.sku'),
      sortable: tab === 'proposals',
      cell: (r) => (
        <div>
          <div className="rep-sku">{r.item_id}</div>
          <div className="rep-sub">{r.product_name && r.product_name !== r.item_id ? r.product_name : r.supplier_name ?? ''}</div>
        </div>
      ),
    },
    { key: 'priority', header: t('replenishment.col.priority'), sortable: tab === 'proposals', cell: (r) => <Badge tone={PRIORITY_TONE[r.priority] ?? 'neutral'}>{priorityLabel(r.priority)}</Badge> },
    { key: 'status', header: t('replenishment.col.status'), sortable: tab === 'proposals', cell: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'} dot>{statusLabel(r.status)}</Badge> },
    { key: 'on_hand', header: <span title={t('replenishment.col_hint.on_hand')}>{t('replenishment.col.on_hand')}</span>, align: 'right', cell: (r) => fmt.integer(r.on_hand) },
    { key: 'on_order', header: <span title={t('replenishment.col_hint.on_order')}>{t('replenishment.col.on_order')}</span>, align: 'right', cell: (r) => fmt.integer(r.on_order) },
    {
      key: 'ip',
      header: <span title={t('replenishment.col_hint.ip')}>{t('replenishment.col.ip')}</span>,
      align: 'right',
      cell: (r) => {
        // IP is the review-date snapshot; it is never recomputed from the CURRENT on hand / on order.
        const ip = r.inventory_position ?? inventoryPosition(r.on_hand_at_review, r.on_order_at_review);
        if (ip == null) return <Unavailable />;
        const date = r.review_date ? fmt.date(r.review_date, 'short') : '—';
        const split =
          r.on_hand_at_review != null && r.on_order_at_review != null
            ? t('replenishment.ip_split', { on_hand: fmt.integer(r.on_hand_at_review), on_order: fmt.integer(r.on_order_at_review), date })
            : t('replenishment.ip_split_unknown', { date });
        return (
          <div>
            <div>{fmt.integer(ip)}</div>
            <div className="rep-sub">{split}</div>
          </div>
        );
      },
    },
    { key: 's', header: t('replenishment.col.s'), align: 'right', cell: (r) => fmt.integer(r.reorder_point_s) },
    { key: 'S', header: t('replenishment.col.S'), align: 'right', cell: (r) => fmt.integer(r.order_up_to_S) },
    { key: 'eoq', header: t('replenishment.col.eoq'), align: 'right', cell: (r) => fmt.integer(r.eoq_quantity) },
    {
      key: 'kappa',
      header: <span title={t('replenishment.col_hint.kappa')}>{t('replenishment.col.kappa')}</span>,
      align: 'right',
      cell: (r) => (r.kappa_g != null ? fmt.number(r.kappa_g, { digits: 2 }) : <Unavailable />),
    },
    { key: 'abc', header: t('replenishment.col.abc_xyz'), cell: (r) => (r.abc_xyz_class ? <Badge tone="neutral">{r.abc_xyz_class}</Badge> : <Unavailable />) },
    { key: 'theta', header: <span title={t('replenishment.col_hint.theta')}>{t('replenishment.col.theta')}</span>, align: 'right', cell: (r) => (r.theta != null ? fmt.number(r.theta, { digits: 3 }) : <Unavailable />) },
    { key: 'm_g', header: <span title={t('replenishment.col_hint.m_g')}>{t('replenishment.col.m_g')}</span>, align: 'right', cell: (r) => (r.m_g != null ? fmt.number(r.m_g, { digits: 3 }) : <Unavailable />) },
    { key: 'q_hat', header: <span title={t('replenishment.col_hint.q_hat')}>{t('replenishment.col.q_hat')}</span>, align: 'right', cell: (r) => (r.q_hat != null ? fmt.number(r.q_hat, { digits: 1 }) : <Unavailable />) },
    { key: 'lt', header: t('replenishment.col.lead_time'), align: 'right', cell: (r) => (r.lead_time_days != null ? t('replenishment.days', { n: fmt.integer(r.lead_time_days) }) : <Unavailable />) },
    { key: 'recommended', header: t('replenishment.col.recommended'), sortable: tab === 'proposals', align: 'right', cell: (r) => fmt.integer(r.recommended_qty) },
    {
      key: 'final',
      header: t('replenishment.col.final'),
      sortable: tab === 'proposals',
      align: 'right',
      cell: (r) => <strong>{fmt.integer(r.final_qty)}</strong>,
    },
    { key: 'created', header: t('replenishment.col.created'), sortable: tab === 'proposals', cell: (r) => fmt.date(r.created_at, 'short') },
  ];
  if (tab === 'history') {
    columns.push(
      { key: 'decided', header: t('replenishment.col.decided'), cell: (r) => fmt.date(r.decided_at, 'short') },
      { key: 'decided_by', header: t('replenishment.col.decided_by'), cell: (r) => r.decided_by ?? <Unavailable /> },
    );
  }
  columns.push({
    key: 'actions',
    header: <span className="ui-sr-only">{t('replenishment.col.actions')}</span>,
    align: 'right',
    cell: (r) => {
      const disabled = !canWrite || busy === r.id;
      const noPerm = !canWrite ? t('replenishment.action.no_permission') : undefined;
      return (
        <div className="rep-actions" onClick={(e) => e.stopPropagation()}>
          {tab === 'proposals' && r.status === 'PENDING' && (
            <>
              <IconButton size="sm" label={noPerm ?? t('replenishment.action.approve')} icon={<Check size={15} />} disabled={disabled} onClick={() => void onApprove(r)} />
              <IconButton size="sm" label={noPerm ?? t('replenishment.action.adjust')} icon={<Pencil size={15} />} disabled={disabled} onClick={() => setDialog({ kind: 'adjust', rec: r })} />
              <IconButton size="sm" label={noPerm ?? t('replenishment.action.reject')} icon={<X size={15} />} disabled={disabled} onClick={() => setDialog({ kind: 'reject', rec: r })} />
            </>
          )}
          {tab === 'proposals' && r.status === 'APPROVED' && (
            <IconButton size="sm" label={noPerm ?? t('replenishment.action.cancel')} icon={<Ban size={15} />} disabled={disabled} onClick={() => setDialog({ kind: 'cancel', rec: r })} />
          )}
          <IconButton size="sm" label={t('replenishment.action.details')} icon={<Info size={15} />} onClick={() => setDetail(r)} />
        </div>
      );
    },
  });

  const filtered = !!(status || priority || search.trim());
  const total = active.data?.total;

  return (
    <div className="ui-stack">
      <PageHeader
        title={t('replenishment.title')}
        description={t('replenishment.description')}
        meta={storeId ? <DataSourceNote source={t('replenishment.source', { store: storeId })} /> : undefined}
        actions={
          <>
            <Button variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={refresh} loading={active.loading && !!active.data}>
              {t('common.actions.refresh')}
            </Button>
            <Button variant="secondary" leftIcon={<Download size={16} />} onClick={() => void onExport()} disabled={!storeId}>
              {t('replenishment.action.export')}
            </Button>
            <Button leftIcon={<Sparkles size={16} />} onClick={() => void onGenerate()} disabled={!canWrite || !storeId} title={!canWrite ? t('replenishment.action.no_permission') : undefined}>
              {t('replenishment.action.generate')}
            </Button>
          </>
        }
      />

      {!storeId && <Alert tone="warning">{t('replenishment.no_store')}</Alert>}
      {!canWrite && <Alert tone="info">{t('replenishment.action.no_permission')}</Alert>}

      {tab === 'proposals' && (
        <div className="ui-grid ui-grid--kpi">
          <KpiTile
            label={t('replenishment.kpi.pending')}
            value={list.data ? fmt.integer(list.data.pending_count) : null}
            loading={list.loading && !list.data}
            unavailableReason={list.error ? t('common.state.error_title') : undefined}
            hint={t('replenishment.kpi.pending_hint', { store: storeId ?? '' })}
          />
          <KpiTile
            label={t('replenishment.kpi.approved')}
            value={list.data ? fmt.integer(list.data.approved_count) : null}
            loading={list.loading && !list.data}
            unavailableReason={list.error ? t('common.state.error_title') : undefined}
          />
          <KpiTile
            label={t('replenishment.kpi.total')}
            value={list.data ? fmt.integer(list.data.total) : null}
            loading={list.loading && !list.data}
            unavailableReason={list.error ? t('common.state.error_title') : undefined}
          />
        </div>
      )}

      <Card flush>
        <div style={{ padding: 'var(--space-3) var(--space-4) 0' }}>
          <Tabs
            aria-label={t('replenishment.title')}
            value={tab}
            onChange={(id) => {
              setTab(id);
              setStatus('');
              resetPage();
            }}
            items={[
              { id: 'proposals', label: t('replenishment.tabs.proposals'), count: list.data?.total },
              { id: 'history', label: t('replenishment.tabs.history') },
            ]}
          />
        </div>
        <div className="rep-filters">
          {tab === 'proposals' && (
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v);
                resetPage();
              }}
              placeholder={t('replenishment.filter.search')}
            />
          )}
          <Select
            aria-label={t('replenishment.filter.status')}
            value={status}
            onChange={(v) => {
              setStatus(v);
              resetPage();
            }}
            options={[
              { value: '', label: t('replenishment.filter.all_status') },
              ...(tab === 'history' ? STATUS_KEYS.filter((k) => k !== 'PENDING') : STATUS_KEYS).map((k) => ({ value: k as string, label: t(`replenishment.status.${k}`) })),
            ]}
          />
          {tab === 'proposals' && (
            <Select
              aria-label={t('replenishment.filter.priority')}
              value={priority}
              onChange={(v) => {
                setPriority(v);
                resetPage();
              }}
              options={[{ value: '', label: t('replenishment.filter.all_priority') }, ...PRIORITY_KEYS.map((k) => ({ value: k as string, label: t(`replenishment.priority.${k}`) }))]}
            />
          )}
        </div>
        <HoldHeight activeKey={tab}>
        <Table
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={active.loading && !active.data}
          error={active.error}
          onRetry={active.refetch}
          filtered={filtered}
          emptyTitle={t('replenishment.empty.title')}
          emptyDescription={t('replenishment.empty.description')}
          dense
          sort={tab === 'proposals' ? sort : undefined}
          onSortChange={tab === 'proposals' ? (s) => { setSort(s); resetPage(); } : undefined}
          pagination={{ page: pg.page, pageSize: pg.pageSize, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize, total }}
          selection={
            tab === 'proposals' && canWrite
              ? {
                  selected: sel.selected,
                  onChange: sel.set,
                  isDisabled: (key) => rows.find((r) => r.id === key)?.status !== 'PENDING',
                  actions: (
                    <Button size="sm" leftIcon={<Check size={14} />} onClick={() => void onBulkApprove()}>
                      {t('replenishment.action.approve_selected', { count: sel.size })}
                    </Button>
                  ),
                }
              : undefined
          }
        />
        </HoldHeight>
        {tab === 'proposals' && canWrite && !active.error && rows.length > 0 && (
          <p className="rep-note" style={{ padding: 'var(--space-3) var(--space-4)' }}>
            {t('replenishment.action.select_hint')}
          </p>
        )}
      </Card>
      {!active.loading && !active.error && rows.length === 0 && !filtered && tab === 'history' && (
        <EmptyState compact title={t('replenishment.empty.title')} />
      )}

      <ActionDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onSubmit={async (state, reason, qty) => {
          const { rec, kind } = state;
          if (kind === 'reject') {
            return mutate(rec, { status: 'REJECTED' }, () => rejectReplenishment(rec.id, reason), t('replenishment.toast.rejected', { sku: rec.item_id }));
          }
          if (kind === 'cancel') {
            return mutate(rec, { status: 'CANCELLED' }, () => cancelReplenishment(rec.id, reason), t('replenishment.toast.cancelled', { sku: rec.item_id }));
          }
          return mutate(rec, { final_qty: qty as number }, () => adjustReplenishment(rec.id, qty as number, reason), t('replenishment.toast.adjusted', { sku: rec.item_id }));
        }}
      />
      <PolicyDrawer rec={detail} onClose={() => setDetail(null)} />
      {confirmDialog}
    </div>
  );
};

/* ------------------------------ reject / cancel / adjust ------------------------------ */
const ActionDialog: React.FC<{
  state: DialogState;
  onClose: () => void;
  onSubmit: (state: NonNullable<DialogState>, reason: string, qty: number | null) => Promise<boolean>;
}> = ({ state, onClose, onSubmit }) => {
  const t = useT();
  const fmt = useFormat();
  const [reason, setReason] = useState('');
  const [qtyText, setQtyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const key = state ? `${state.kind}:${state.rec.id}` : '';
  const [lastKey, setLastKey] = useState('');
  if (key !== lastKey) {
    setLastKey(key);
    setReason('');
    setQtyText(state ? String(Math.round(state.rec.final_qty)) : '');
    setTouched(false);
  }
  if (!state) return <Modal open={false} onClose={onClose} title="" />;

  const reasonOk = reason.trim().length >= 3;
  const qtyNum = Number(qtyText);
  const qtyOk = /^\d+$/.test(qtyText.trim()) && qtyNum >= 1 && qtyNum <= MAX_ORDER_QTY;
  const valid = reasonOk && (state.kind !== 'adjust' || qtyOk);
  const titleKey = state.kind === 'reject' ? 'replenishment.dialog.reject_title' : state.kind === 'cancel' ? 'replenishment.dialog.cancel_title' : 'replenishment.dialog.adjust_title';
  const confirmKey = state.kind === 'reject' ? 'replenishment.dialog.confirm_reject' : state.kind === 'cancel' ? 'replenishment.dialog.confirm_cancel' : 'replenishment.dialog.confirm_adjust';

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    setSubmitting(true);
    const ok = await onSubmit(state, reason.trim(), state.kind === 'adjust' ? qtyNum : null);
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!submitting}
      size="sm"
      title={t(titleKey, { sku: state.rec.item_id })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common.actions.cancel')}
          </Button>
          <Button variant={state.kind === 'adjust' ? 'primary' : 'danger'} onClick={() => void submit()} loading={submitting}>
            {t(confirmKey)}
          </Button>
        </>
      }
    >
      <div className="ui-stack" style={{ gap: 'var(--space-3)' }}>
        {state.kind === 'adjust' && (
          <Input
            label={t('replenishment.dialog.qty')}
            inputMode="numeric"
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            error={touched && !qtyOk ? t('replenishment.dialog.qty_invalid', { max: fmt.integer(MAX_ORDER_QTY) }) : undefined}
            hint={t('replenishment.dialog.qty_hint', { max: fmt.integer(MAX_ORDER_QTY), recommended: fmt.integer(state.rec.recommended_qty) })}
          />
        )}
        <Input
          label={t('replenishment.dialog.reason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={touched && !reasonOk ? t('replenishment.dialog.reason_required') : undefined}
          hint={t('replenishment.dialog.reason_hint')}
        />
      </div>
    </Modal>
  );
};

/* ------------------------------ policy details drawer ------------------------------ */
const PolicyDrawer: React.FC<{ rec: ReplenishmentItem | null; onClose: () => void }> = ({ rec, onClose }) => {
  const t = useT();
  const be = useBe();
  const beCode = useBeCode();
  const fmt = useFormat();
  const param = useApi((signal) => getPolicyParam(rec!.item_id, rec!.store_id, signal), [rec?.item_id, rec?.store_id], { enabled: !!rec });
  const calib = useApi((signal) => getCalibrationStatus(rec!.store_id, signal), [rec?.store_id], { enabled: !!rec });
  const p = param.data?.items?.[0];
  const mismatch =
    !!rec && !!p && ((p.s != null && rec.reorder_point_s != null && Math.round(p.s) !== Math.round(rec.reorder_point_s)) || (p.S != null && rec.order_up_to_S != null && Math.round(p.S) !== Math.round(rec.order_up_to_S)));
  const thetas = calib.data?.thetas ?? {};

  return (
    <Drawer open={!!rec} onClose={onClose} title={rec ? t('replenishment.drawer.title', { sku: rec.item_id }) : ''} description={rec?.product_name ?? undefined}>
      {rec && (
        <div className="ui-stack" style={{ gap: 'var(--space-4)' }}>
          <dl className="rep-dl">
            <dt>{t('replenishment.drawer.policy')}</dt>
            <dd>{rec.policy_applied ?? <Unavailable />}</dd>
            <dt>{t('replenishment.drawer.review_date')}</dt>
            <dd>{fmt.date(rec.review_date, 'medium')}</dd>
            <dt>{t('replenishment.drawer.s')}</dt>
            <dd className="ui-num">{fmt.integer(rec.reorder_point_s)}</dd>
            <dt>{t('replenishment.drawer.S')}</dt>
            <dd className="ui-num">{fmt.integer(rec.order_up_to_S)}</dd>
            <dt>{t('replenishment.drawer.eoq')}</dt>
            <dd className="ui-num">{fmt.integer(rec.eoq_quantity)}</dd>
            <dt>{t('replenishment.drawer.kappa')}</dt>
            <dd className="ui-num">{rec.kappa_g != null ? fmt.number(rec.kappa_g, { digits: 3 }) : <Unavailable />}</dd>
            <dt>{t('replenishment.drawer.q_hat')}</dt>
            <dd className="ui-num">{rec.q_hat != null ? fmt.number(rec.q_hat, { digits: 1 }) : <Unavailable reason={t('replenishment.drawer.q_hat_unavailable')} />}</dd>
            <dt>{t('replenishment.col.abc_xyz')}</dt>
            <dd>{rec.abc_xyz_class ?? <Unavailable />}</dd>
            <dt>{t('replenishment.col.theta')} / {t('replenishment.col.m_g')}</dt>
            <dd className="ui-num">
              {rec.theta != null ? fmt.number(rec.theta, { digits: 3 }) : '—'} / {rec.m_g != null ? fmt.number(rec.m_g, { digits: 3 }) : '—'}
            </dd>
            <dt>{t('replenishment.col.lead_time')}</dt>
            <dd className="ui-num">{rec.lead_time_days != null ? t('replenishment.days', { n: fmt.integer(rec.lead_time_days) }) : <Unavailable />}</dd>
            <dt>{t('replenishment.drawer.supplier')}</dt>
            <dd>{rec.supplier_name ?? <Unavailable />}</dd>
          </dl>

          <Card title={t('replenishment.drawer.lead_time')} className="rep-card">
            {param.loading ? (
              <p className="rep-note">{t('common.state.loading')}</p>
            ) : param.error ? (
              <p className="rep-note">{apiErrorMessage(param.error, t)}</p>
            ) : p ? (
              <div className="ui-stack" style={{ gap: 'var(--space-3)' }}>
                <dl className="rep-dl">
                  <dt>{t('replenishment.drawer.lead_time')}</dt>
                  <dd className="ui-num">{t('replenishment.drawer.lead_time_value', { days: fmt.integer(p.lead_time_days) })}</dd>
                  <dt>{t('replenishment.drawer.service_level')}</dt>
                  <dd className="ui-num">{fmt.percent(p.service_level)}</dd>
                  <dt>{t('replenishment.drawer.safety_stock')}</dt>
                  <dd className="ui-num">{fmt.integer(p.safety_stock)}</dd>
                  <dt>{t('replenishment.drawer.rop')}</dt>
                  <dd className="ui-num">{fmt.integer(p.reorder_point)}</dd>
                  <dt>{t('replenishment.drawer.param_source')}</dt>
                  <dd>{p.source}</dd>
                  <dt>{t('replenishment.drawer.model_run')}</dt>
                  <dd className="rep-sku">{p.model_run_id ?? <Unavailable />}</dd>
                </dl>
                <p className="rep-note">{mismatch ? t('replenishment.drawer.mismatch') : t('replenishment.drawer.consistent')}</p>
              </div>
            ) : (
              <Unavailable reason={t('replenishment.drawer.unavailable_params')} />
            )}
          </Card>

          <Card title={t('replenishment.drawer.theta')}>
            {calib.loading ? (
              <p className="rep-note">{t('common.state.loading')}</p>
            ) : calib.error ? (
              <p className="rep-note">{apiErrorMessage(calib.error, t)}</p>
            ) : Object.keys(thetas).length === 0 ? (
              <Unavailable />
            ) : (
              <div className="ui-stack" style={{ gap: 'var(--space-3)' }}>
                <dl className="rep-dl">
                  {Object.entries(thetas)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([cls, th]) => (
                      <React.Fragment key={cls}>
                        <dt>{cls}</dt>
                        <dd className="ui-num">{fmt.number(th, { digits: 3 })}</dd>
                      </React.Fragment>
                    ))}
                </dl>
                <p className="rep-note">
                  {t('replenishment.drawer.theta_hint', { index: calib.data?.latest_review_index ?? 0, date: fmt.date(calib.data?.latest_review_date, 'medium') })}
                </p>
                <p className="rep-note">{t('replenishment.drawer.theta_unavailable')}</p>
              </div>
            )}
          </Card>

          {rec.reason && (
            <div>
              <div className="rep-note">{t('replenishment.drawer.reason')}</div>
              <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-sm)' }}>{rec.reason_code === 'ip_below_s' ? beCode(prefixCode('rep', rec.reason_code), rec.reason_params, rec.reason) : be(rec.reason)}</p>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
};
