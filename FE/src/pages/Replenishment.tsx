import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Check,
  Download,
  Pencil,
  RefreshCw,
  Sparkles,
  Ban,
  X,
  Info,
  Clock,
  AlertTriangle,
  TrendingUp,
  ShoppingBag,
  CheckCircle2,
} from 'lucide-react';
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
import { getKpiShadowDashboard } from '../services/dashboardApi.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  HoldHeight,
  Input,
  IconButton,
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

const MAX_ORDER_QTY = 1_000_000;

const STATUS_TONE: Record<string, Tone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

const PRIORITY_TONE: Record<string, Tone> = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'neutral',
};

const STATUS_KEYS = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
const PRIORITY_KEYS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

const SORT_MAP: Record<string, string> = {
  sku: 'item_id',
  priority: 'priority',
  status: 'status',
  recommended: 'recommended_qty',
  final: 'final_qty',
  created: 'created_at',
};

type DialogState = { kind: 'reject' | 'cancel' | 'adjust'; rec: ReplenishmentItem } | null;

const DepletionChart: React.FC<{
  onHand: number;
  qty: number;
  rop: number;
  ss: number;
  leadTime: number;
}> = ({ onHand, qty, rop, ss, leadTime }) => {
  const t = useT();
  const maxVal = Math.max(onHand + qty, rop * 1.35, 100);
  const h = 95;
  const w = 340;
  const pad = 24;
  const chartW = w - pad * 2;
  const chartH = h - pad;

  const getY = (val: number) => pad / 2 + chartH - (Math.max(0, val) / maxVal) * chartH;
  const getX = (dayIdx: number) => pad + (dayIdx / 6) * chartW;

  const dailyDemand = Math.max(1, (rop - ss) / Math.max(1, leadTime));
  const day3X = getX(Math.min(6, leadTime));
  const startY = getY(onHand);
  const arrPreY = getY(Math.max(0, onHand - dailyDemand * leadTime));
  const arrPostY = getY(Math.max(0, onHand - dailyDemand * leadTime + qty));
  const endSafeY = getY(Math.max(ss * 1.1, onHand - dailyDemand * leadTime + qty - dailyDemand * (6 - leadTime)));
  const endStockoutY = getY(0);

  const safePath = `M ${getX(0)} ${startY} L ${day3X} ${arrPreY} L ${day3X} ${arrPostY} L ${getX(6)} ${endSafeY}`;
  const stockoutPath = `M ${day3X} ${arrPreY} L ${getX(Math.min(6, leadTime + Math.ceil((onHand - dailyDemand * leadTime) / dailyDemand)))} ${endStockoutY} L ${getX(6)} ${endStockoutY}`;

  const ropY = getY(rop);
  const ssY = getY(ss);
  const isColliding = Math.abs(ropY - ssY) < 14;
  const ropTextY = isColliding ? Math.min(ropY, ssY) - 5 : ropY - 3;
  const ssTextY = isColliding ? Math.max(ropY, ssY) + 10 : ssY - 3;

  return (
    <div className="rep-horizon-box">
      <div className="rep-horizon-head">
        <span>{t('replenishment.chart.title')}</span>
        <span style={{ color: '#059669' }}>{t('replenishment.chart.arrival', { day: leadTime })}</span>
      </div>
      <svg className="rep-horizon-svg" viewBox={`0 0 ${w} ${h + 16}`}>
        <line x1={pad} y1={ropY} x2={w - pad} y2={ropY} stroke="#f59e0b" strokeWidth="1" strokeDasharray="3 3" />
        <text x={pad + 2} y={ropTextY} fill="#b45309" fontSize="9" fontWeight="600">
          {t('replenishment.chart.rop_label', { val: Math.round(rop) })}
        </text>

        <line x1={pad} y1={ssY} x2={w - pad} y2={ssY} stroke="#e11d48" strokeWidth="1" strokeDasharray="3 3" />
        <text x={pad + 2} y={ssTextY} fill="#be123c" fontSize="9" fontWeight="600">
          {t('replenishment.chart.ss_label', { val: Math.round(ss) })}
        </text>

        <path d={safePath} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round" />
        <path d={stockoutPath} fill="none" stroke="#e11d48" strokeWidth="1.8" strokeDasharray="4 3" strokeLinecap="round" />

        <circle cx={day3X} cy={arrPostY} r="3.5" fill="#4f46e5" />
        <circle cx={day3X} cy={arrPreY} r="3" fill="#e11d48" />

        <text x={getX(0)} y={h + 12} fill="#64748b" fontSize="9" textAnchor="start">
          {t('replenishment.chart.today')}
        </text>
        <text x={day3X} y={h + 12} fill="#4f46e5" fontSize="9" fontWeight="600" textAnchor="middle">
          {t('replenishment.chart.arrival_step', { lead: leadTime })}
        </text>
        <text x={getX(6)} y={h + 12} fill="#64748b" fontSize="9" textAnchor="end">
          {t('replenishment.chart.review_end')}
        </text>
      </svg>
      <div className="rep-horizon-legend">
        <span style={{ color: '#4f46e5', fontWeight: 600 }}>— {t('replenishment.chart.with_po', { qty })}</span>
        <span style={{ color: '#e11d48' }}>--- {t('replenishment.chart.stockout_risk')}</span>
      </div>
    </div>
  );
};

export const Replenishment: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { user } = useAuth();
  const { storeId } = useStore();
  const { version, clock } = useClock();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const canWrite = can(user?.role, 'replenishment:write');

  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<'proposals' | 'history'>('proposals');
  const statusFromUrl = () => {
    const s = (searchParams.get('status') ?? '').toUpperCase();
    return (STATUS_KEYS as readonly string[]).includes(s) ? s : null;
  };
  const [status, setStatus] = useState(() => statusFromUrl() ?? '');
  const [priority, setPriority] = useState('');
  const [department, setDepartment] = useState('');
  const [search, setSearch] = useState(() => searchParams.get('search') ?? searchParams.get('sku') ?? '');

  useEffect(() => {
    const q = searchParams.get('search') ?? searchParams.get('sku');
    if (q !== null) setSearch(q);
    // ?status=PENDING (Dashboard "open pending proposals" after a Planner-mode stop)
    const s = statusFromUrl();
    if (s !== null) {
      setTab('proposals');
      setStatus(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const [nonce, setNonce] = useState(0);
  const [sort, setSort] = useState<SortState | null>(null);
  const pg = usePagination(25);
  const sel = useRowSelection();
  const [overrides, setOverrides] = useState<Record<string, Partial<ReplenishmentItem>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [drawerDetail, setDrawerDetail] = useState<ReplenishmentItem | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const handleManualRefresh = async () => {
    setRefreshing(true);
    refresh();
    await new Promise((res) => setTimeout(res, 400));
    setRefreshing(false);
    toast.success(t('replenishment.toast.refreshed'));
  };
  const resetPage = () => pg.setPage(1);

  const list = useApi(
    (signal) =>
      listReplenishments(
        {
          skip: pg.offset,
          limit: pg.pageSize,
          store_id: storeId as string,
          status: status || undefined,
          priority: priority || undefined,
          search: search.trim() || undefined,
          sort_by: sort ? SORT_MAP[sort.key] : undefined,
          sort_dir: sort?.dir,
        },
        signal,
      ),
    [storeId, pg.offset, pg.pageSize, status, priority, search, sort, version, nonce],
    { enabled: !!storeId && tab === 'proposals' },
  );

  // KPI cards: CRITICAL pending proposals of the whole store (one-row query, the total is what counts)
  const critical = useApi(
    (signal) => listReplenishments({ skip: 0, limit: 1, store_id: storeId as string, status: 'PENDING', priority: 'CRITICAL' }, signal),
    [storeId, version, nonce],
    { enabled: !!storeId && tab === 'proposals' },
  );
  const criticalCount = critical.data?.total ?? null;
  // Observed availability of C3-OUT vs the target and vs the shadow B0 (simulator)
  const serviceKpi = useApi((signal) => getKpiShadowDashboard(storeId as string, signal), [storeId, version], {
    enabled: !!storeId && tab === 'proposals',
  });
  const svc = serviceKpi.data;
  const classesBelow = (svc?.segment_availabilities ?? []).filter((sg) => sg.c3out_availability !== null && sg.c3out_availability < sg.target).length;
  const classesObserved = (svc?.segment_availabilities ?? []).filter((sg) => sg.c3out_availability !== null).length;

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

  const rawRows = useMemo(
    () => (active.data?.items ?? []).map((r) => (overrides[r.id] ? { ...r, ...overrides[r.id] } : r)),
    [active.data, overrides],
  );

  const rows = useMemo(() => {
    if (!department) return rawRows;
    return rawRows.filter((r) => {
      const cat = (r.category || r.item_id).toUpperCase();
      return cat.startsWith(department.toUpperCase());
    });
  }, [rawRows, department]);

  const afterMutation = () => {
    emitAlertsSyncEvent();
    refresh();
  };

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
    const ids = sel.selected.size > 0
      ? [...sel.selected].map(String)
      : rows.filter((r) => r.status === 'PENDING').map((r) => r.id);

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

  const pendingCount = list.data?.pending_count ?? null;
  const approvedCount = list.data?.approved_count ?? null;

  const columns: Column<ReplenishmentItem>[] = [
    {
      key: 'sku',
      header: t('replenishment.col.sku_details'),
      sortable: tab === 'proposals',
      cell: (r) => {
        const cat = r.category || r.item_id.split('_').slice(0, 2).join('_');
        return (
          <div className="rep-sku-cell" onClick={() => setDrawerDetail(r)}>
            <div className="rep-sku-row">
              <span className="rep-sku">{r.item_id}</span>
              <span className="rep-cat-tag">{cat}</span>
            </div>
            <div className="rep-prod-name">
              {r.product_name && r.product_name !== r.item_id ? r.product_name : `Product Item (${r.item_id})`}
            </div>
          </div>
        );
      },
    },
    {
      key: 'abc_xyz',
      header: t('replenishment.col.abc_xyz'),
      cell: (r) => (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <Badge tone="info">{r.abc_xyz_class || '—'}</Badge>
          {r.theta != null && (
            <span
              className="rep-theta-badge"
              title={t('replenishment.col.theta_tooltip', {
                theta: `${r.theta >= 0 ? '+' : ''}${r.theta.toFixed(2)}`,
                cls: r.abc_xyz_class || '—',
              })}
            >
              θ{r.theta >= 0 ? '+' : ''}{r.theta.toFixed(2)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'ip',
      header: t('replenishment.col.ip_head'),
      align: 'right',
      cell: (r) => {
        const ipVal = r.on_hand + r.on_order;
        const sVal = r.reorder_point_s || r.rop || 0;
        const isBelow = ipVal <= sVal;
        return (
          <div className="rep-num-stack">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span className={isBelow ? 'rep-num-main rep-num-main--danger' : 'rep-num-main'}>
                {fmt.integer(ipVal)}
              </span>
              {isBelow && <Badge tone="danger">≤ s</Badge>}
            </div>
            <span className="rep-num-sub">Kho: {fmt.integer(r.on_hand)} · Về: {fmt.integer(r.on_order)}</span>
          </div>
        );
      },
    },
    {
      key: 's_S',
      header: t('replenishment.col.s_S_head'),
      align: 'right',
      cell: (r) => {
        const sVal = r.reorder_point_s || r.rop || 0;
        const SVal = r.order_up_to_S || (sVal + r.final_qty);
        return (
          <div className="rep-num-stack">
            <span className="rep-num-main">{fmt.integer(sVal)} / {fmt.integer(SVal)}</span>
          </div>
        );
      },
    },
    {
      key: 'dos',
      header: t('replenishment.col.dos_head'),
      align: 'right',
      cell: (r) => {
        const lead = r.lead_time_days || 3;
        const netRop = Math.max(1, (r.rop || r.reorder_point_s || 30) - r.safety_stock);
        const estDaily = netRop / lead;
        const dos = Math.max(0.1, Number((r.on_hand / estDaily).toFixed(1)));
        const dotTone = dos < 1.5 ? 'rep-dos-dot--rose' : dos < 3.0 ? 'rep-dos-dot--amber' : 'rep-dos-dot--emerald';
        return (
          <span className="rep-dos-badge">
            <span className={`rep-dos-dot ${dotTone}`} />
            {dos}d
          </span>
        );
      },
    },
    {
      key: 'recommended',
      header: t('replenishment.col.recommended_head'),
      align: 'right',
      sortable: tab === 'proposals',
      cell: (r) => (
        <span className="rep-order-qty">{fmt.integer(r.final_qty)}</span>
      ),
    },
    {
      key: 'status',
      header: t('replenishment.col.status'),
      sortable: tab === 'proposals',
      cell: (r) => {
        const isSimulatorRejected = r.status === 'REJECTED' && r.decided_by === 'simulator';
        const label = isSimulatorRejected ? t('replenishment.status.SIM_EXPIRED') : statusLabel(r.status);
        return (
          <Badge tone={isSimulatorRejected ? 'neutral' : (STATUS_TONE[r.status] ?? 'neutral')} dot>
            {label}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      header: <span className="ui-sr-only">Actions</span>,
      align: 'right',
      cell: (r) => {
        const disabled = !canWrite || busy === r.id;
        const noPerm = !canWrite ? t('replenishment.action.no_permission') : undefined;
        return (
          <div className="rep-actions" onClick={(e) => e.stopPropagation()}>
            {tab === 'proposals' && r.status === 'PENDING' && (
              <>
                <IconButton size="sm" label={noPerm ?? t('replenishment.action.approve')} icon={<Check size={14} />} disabled={disabled} onClick={() => void onApprove(r)} />
                <IconButton size="sm" label={noPerm ?? t('replenishment.action.adjust')} icon={<Pencil size={14} />} disabled={disabled} onClick={() => setDialog({ kind: 'adjust', rec: r })} />
                <IconButton size="sm" label={noPerm ?? t('replenishment.action.reject')} icon={<X size={14} />} disabled={disabled} onClick={() => setDialog({ kind: 'reject', rec: r })} />
              </>
            )}
            {tab === 'proposals' && r.status === 'APPROVED' && (
              <IconButton size="sm" label={noPerm ?? t('replenishment.action.cancel')} icon={<Ban size={14} />} disabled={disabled} onClick={() => setDialog({ kind: 'cancel', rec: r })} />
            )}
            <IconButton size="sm" label={t('replenishment.action.details')} icon={<Info size={14} />} onClick={() => setDrawerDetail(r)} />
          </div>
        );
      },
    },
  ];

  const filtered = !!(status || priority || department || search.trim());
  const total = active.data?.total;

  return (
    <div className="ui-stack">
      <PageHeader
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span>{t('replenishment.title')}</span>
            <span className="rep-header-pill">{t('replenishment.c3out_active')}</span>
          </div>
        }
        description={t('replenishment.header_desc')}
        actions={
          <>
            <Button variant="secondary" leftIcon={<RefreshCw size={15} />} onClick={() => void handleManualRefresh()} loading={refreshing}>
              {t('common.actions.refresh')}
            </Button>
            <Button variant="secondary" leftIcon={<Download size={15} />} onClick={() => void onExport()} disabled={!storeId}>
              {t('replenishment.action.export')}
            </Button>
            <Button
              variant="primary"
              leftIcon={<Check size={15} />}
              onClick={() => void onBulkApprove()}
              disabled={!canWrite || !storeId || !pendingCount}
            >
              {t('replenishment.batch_approve_btn', { count: pendingCount ?? 0 })}
            </Button>
            <Button variant="secondary" leftIcon={<Sparkles size={15} />} onClick={() => void onGenerate()} disabled={!canWrite || !storeId}>
              {t('replenishment.action.generate')}
            </Button>
          </>
        }
      />

      {!storeId && <Alert tone="warning">{t('replenishment.no_store')}</Alert>}
      {!canWrite && <Alert tone="info">{t('replenishment.action.no_permission')}</Alert>}

      {tab === 'proposals' && (
        <div className="rep-kpi-grid">
          <div className="rep-kpi-card">
            <div className="rep-kpi-head">
              <span className="rep-kpi-label">
                <span className="rep-kpi-icon-wrap rep-kpi-icon-wrap--indigo">
                  <ShoppingBag size={15} />
                </span>
                {t('replenishment.kpi.pending_pos')}
              </span>
            </div>
            <div className="rep-kpi-body">
              <span className="rep-kpi-val">{pendingCount !== null ? t('replenishment.kpi.pending_orders', { count: fmt.integer(pendingCount) }) : '—'}</span>
            </div>
            <div className="rep-kpi-meta">
              <span>{approvedCount !== null ? t('replenishment.kpi.approved_meta', { count: fmt.integer(approvedCount), store: storeId ?? '—' }) : '—'}</span>
            </div>
          </div>

          <div className="rep-kpi-card">
            <div className="rep-kpi-head">
              <span className="rep-kpi-label">
                <span className="rep-kpi-icon-wrap rep-kpi-icon-wrap--rose">
                  <AlertTriangle size={15} />
                </span>
                {t('replenishment.kpi.critical_stockout')}
              </span>
              {criticalCount !== null && criticalCount > 0 && <Badge tone="danger">{t('replenishment.kpi.urgent')}</Badge>}
            </div>
            <div className="rep-kpi-body">
              <span className="rep-kpi-val rep-kpi-val--rose">{criticalCount !== null ? t('replenishment.kpi.critical_skus', { count: fmt.integer(criticalCount) }) : '—'}</span>
            </div>
            <div className="rep-kpi-meta">
              <span className="rep-dos-dot rep-dos-dot--rose" />
              <span>{t('replenishment.kpi.critical_meta')}</span>
            </div>
          </div>

          <div className="rep-kpi-card">
            <div className="rep-kpi-head">
              <span className="rep-kpi-label">
                <span className="rep-kpi-icon-wrap rep-kpi-icon-wrap--sky">
                  <Clock size={15} />
                </span>
                {t('replenishment.kpi.avg_lead_time')}
              </span>
            </div>
            <div className="rep-kpi-body">
              <span className="rep-kpi-val">{clock?.lead_time_days != null ? t('replenishment.kpi.lead_time_days', { days: clock.lead_time_days }) : '—'}</span>
              <span className="rep-num-sub" style={{ alignSelf: 'center' }}>
                {clock?.review_period_days != null ? t('replenishment.kpi.review_every', { days: clock.review_period_days }) : ''}
              </span>
            </div>
            <div className="rep-kpi-meta">
              <CheckCircle2 size={12} color="#059669" />
              <span>{clock?.next_review_date ? t('replenishment.kpi.next_review', { date: fmt.date(clock.next_review_date) }) : '—'}</span>
            </div>
          </div>

          <div className="rep-kpi-card">
            <div className="rep-kpi-head">
              <span className="rep-kpi-label">
                <span className="rep-kpi-icon-wrap rep-kpi-icon-wrap--emerald">
                  <TrendingUp size={15} />
                </span>
                {t('replenishment.kpi.policy_compliance')}
              </span>
            </div>
            <div className="rep-kpi-body">
              <span className={`rep-kpi-val ${classesBelow > 0 ? 'rep-kpi-val--rose' : 'rep-kpi-val--emerald'}`}>
                {svc?.c3out_overall_availability != null ? fmt.percent(svc.c3out_overall_availability, { scale: 'percent', digits: 1 }) : '—'}
              </span>
              <span className="rep-num-sub" style={{ alignSelf: 'center' }}>
                {svc?.target_availability != null ? t('replenishment.kpi.compliance_target', { pct: fmt.number(svc.target_availability, { digits: 1 }) }) : ''}
              </span>
            </div>
            <div className="rep-kpi-meta">
              <span>
                {svc
                  ? t('replenishment.kpi.compliance_meta', {
                      below: classesBelow,
                      n: classesObserved,
                      b0: svc.b0_overall_availability != null ? fmt.percent(svc.b0_overall_availability, { scale: 'percent', digits: 1 }) : '—',
                    })
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      )}

      <Card flush className="rep-main-card">
          <div style={{ padding: 'var(--space-3) var(--space-4) 0' }}>
            <Tabs
              aria-label={t('replenishment.title')}
              value={tab}
              onChange={(id) => {
                setTab(id);
                setStatus('');
                setPriority('');
                setDepartment('');
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
              aria-label="Department"
              value={department}
              onChange={(v) => {
                setDepartment(v);
                resetPage();
              }}
              options={[
                { value: '', label: t('replenishment.filter.dept_all') },
                { value: 'FOODS', label: t('replenishment.filter.dept_foods') },
                { value: 'HOBBIES', label: t('replenishment.filter.dept_hobbies') },
                { value: 'HOUSEHOLD', label: t('replenishment.filter.dept_household') },
              ]}
            />
            <Select
              aria-label="Severity"
              value={priority}
              onChange={(v) => {
                setPriority(v);
                resetPage();
              }}
              options={[
                { value: '', label: t('replenishment.filter.severity_all') },
                ...PRIORITY_KEYS.map((k) => ({
                  value: k as string,
                  label: priorityLabel(k),
                })),
              ]}
            />
            <Select
              aria-label={t('replenishment.filter.status')}
              value={status}
              onChange={(v) => {
                setStatus(v);
                resetPage();
              }}
              options={[
                { value: '', label: t('replenishment.filter.all_status') },
                ...(tab === 'history' ? STATUS_KEYS.filter((k) => k !== 'PENDING') : STATUS_KEYS).map((k) => ({
                  value: k as string,
                  label: t(`replenishment.status.${k}`),
                })),
              ]}
            />
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
              onRowClick={(r) => setDrawerDetail(r)}
              pagination={{
                page: pg.page,
                pageSize: pg.pageSize,
                onPageChange: pg.setPage,
                onPageSizeChange: pg.setPageSize,
                total,
              }}
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
          <div className="rep-table-legend">
            {t('replenishment.col.table_legend')}
          </div>
        </Card>

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
      <PolicyDrawer
        rec={drawerDetail}
        onClose={() => setDrawerDetail(null)}
        onApprove={onApprove}
        onAdjust={(r) => setDialog({ kind: 'adjust', rec: r })}
        canWrite={canWrite}
      />
      {confirmDialog}
    </div>
  );
};

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

const PolicyDrawer: React.FC<{
  rec: ReplenishmentItem | null;
  onClose: () => void;
  onApprove?: (rec: ReplenishmentItem) => void;
  onAdjust?: (rec: ReplenishmentItem) => void;
  canWrite?: boolean;
}> = ({ rec, onClose, onApprove, onAdjust, canWrite }) => {
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

  const thetaVal = rec?.theta != null ? `${rec.theta >= 0 ? '+' : ''}${rec.theta.toFixed(2)}` : '—';
  const p50Val = rec?.q_hat != null ? (rec.q_hat / 10).toFixed(1) : '—';
  const histMean = p?.annual_demand ? (p.annual_demand / 365).toFixed(1) : '—';
  const holdingRate = p?.holding_cost ? fmt.currency(p.holding_cost) : '—';
  const orderSetupCost = p?.order_cost ? fmt.currency(p.order_cost) : '—';

  return (
    <Drawer
      open={!!rec}
      onClose={onClose}
      title={rec ? t('replenishment.drawer.title', { sku: rec.item_id }) : ''}
      description={rec?.product_name ?? undefined}
      size="lg"
    >
      {rec && (
        <div className="ui-stack" style={{ gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="rep-cat-tag">{t('replenishment.detail.category')}: {rec.category || rec.item_id.split('_')[0]}</span>
            <Badge tone={PRIORITY_TONE[rec.priority] ?? 'neutral'}>
              {(PRIORITY_KEYS as readonly string[]).includes(rec.priority)
                ? t(`replenishment.priority.${rec.priority as (typeof PRIORITY_KEYS)[number]}`)
                : rec.priority}
            </Badge>
          </div>

          <div className="rep-detail-sku-sub">
            {t('replenishment.detail.policy_sub', {
              s: fmt.integer(rec.reorder_point_s || rec.rop || 0),
              S: fmt.integer(rec.order_up_to_S || ((rec.reorder_point_s || rec.rop || 0) + rec.final_qty)),
              q: fmt.integer(rec.final_qty),
            })}
          </div>

          {(rec.reorder_point_s ?? rec.rop) != null && rec.safety_stock != null && rec.lead_time_days != null && (
            <DepletionChart
              onHand={rec.on_hand}
              qty={rec.final_qty}
              rop={(rec.reorder_point_s ?? rec.rop) as number}
              ss={rec.safety_stock}
              leadTime={rec.lead_time_days}
            />
          )}

          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 'var(--space-2)' }}>
              {t('replenishment.detail.formula_matrix')}
            </div>
            <div className="rep-matrix-grid">
              <div className="rep-matrix-item">
                <span className="rep-matrix-label">{t('replenishment.detail.buffer_theta')}</span>
                <span className="rep-matrix-val">{thetaVal} ({t('replenishment.detail.surge_comp')})</span>
              </div>
              <div className="rep-matrix-item">
                <span className="rep-matrix-label">{t('replenishment.detail.forecast_p50')}</span>
                <span className="rep-matrix-val">{p50Val} {t('replenishment.detail.units_per_day')}</span>
              </div>
              <div className="rep-matrix-item">
                <span className="rep-matrix-label">{t('replenishment.detail.historical_mean')}</span>
                <span className="rep-matrix-val">{histMean} {t('replenishment.detail.units_per_day')}</span>
              </div>
              <div className="rep-matrix-item">
                <span className="rep-matrix-label">{t('replenishment.detail.lead_time_l')}</span>
                <span className="rep-matrix-val">{rec.lead_time_days != null ? t('replenishment.detail.lead_time_fixed', { days: rec.lead_time_days }) : '—'}</span>
              </div>
              <div className="rep-matrix-item">
                <span className="rep-matrix-label">{t('replenishment.detail.holding_cost_h')}</span>
                <span className="rep-matrix-val">{holdingRate} {t('replenishment.detail.per_unit_week')}</span>
              </div>
              <div className="rep-matrix-item">
                <span className="rep-matrix-label">{t('replenishment.detail.order_cost_k')}</span>
                <span className="rep-matrix-val">{orderSetupCost} {t('replenishment.detail.per_order')}</span>
              </div>
            </div>
          </div>

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
            {rec.decided_by && (
              <>
                <dt>{t('replenishment.col.decided_by')}</dt>
                <dd>{rec.decided_by === 'simulator' ? t('replenishment.status.SIM_EXPIRED') : rec.decided_by}</dd>
              </>
            )}
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
              <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-sm)' }}>
                {rec.reason_code === 'ip_below_s' ? beCode(prefixCode('rep', rec.reason_code), rec.reason_params, rec.reason) : be(rec.reason)}
              </p>
            </div>
          )}

          {canWrite && rec.status === 'PENDING' && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <Button variant="secondary" onClick={() => { onClose(); onAdjust?.(rec); }}>
                {t('replenishment.detail.adjust')}
              </Button>
              <Button variant="primary" leftIcon={<Check size={14} />} onClick={() => { onClose(); void onApprove?.(rec); }}>
                {t('replenishment.detail.approve_po')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
};
