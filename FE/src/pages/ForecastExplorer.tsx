import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Layers, Pencil, Sparkles } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChartFrame,
  ChartLegend,
  DataSourceNote,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KpiTile,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Skeleton,
  Table,
  Tabs,
  Unavailable,
  useChartTheme,
  useConfirm,
  usePagination,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { NoPermission } from '../auth/RequireRole.tsx';
import { can } from '../auth/permissions.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useClock } from '../context/ClockContext.tsx';
import { useStore } from '../context/StoreContext.tsx';
import { useApi } from '../hooks/useApi.ts';
import { useFormat, useT, type TKey } from '../i18n/index.tsx';
import { apiErrorMessage } from '../services/apiClient.ts';
import {
  bulkOverride,
  createOverride,
  getCompare,
  getExplanation,
  getForecasts,
  getHistory,
  getUncertainty,
  getWindowQuantiles,
  listCategories,
  listOverrides,
  listProducts,
  revertOverride,
  runFastInference,
  type ForecastRow,
  type OverrideRow,
  type ProductRow,
} from '../services/forecastApi.ts';

type PageTab = 'forecast' | 'route_c' | 'schedule';
type ScheduleFilter = 'all' | 'overridden' | 'dq';
type RowQuality = 'ok' | 'crossing' | 'missing';

const HORIZONS = [7, 14, 28] as const;
const EPS = 1e-9;
const DAY_MS = 86_400_000;
const GLOBAL_STORE = /^(GLOBAL|ALL)$/i;
const OVERRIDE_REASONS = ['promo', 'season', 'supply', 'other'] as const;
type OverrideReasonKey = (typeof OVERRIDE_REASONS)[number];

interface ProcessedRow extends ForecastRow {
  quality: RowQuality;
  /** Model value before any manual override. */
  modelValue: number;
}

interface ChartPoint {
  date: string;
  actual: number | null;
  forecast: number | null;
  band: [number, number] | null;
  adjusted: number | null;
  row: ProcessedRow | null;
}

function rowQuality(r: ForecastRow): RowQuality {
  if (r.p10 === null || r.p50 === null || r.p90 === null) return 'missing';
  return r.p10 <= r.p50 + EPS && r.p50 <= r.p90 + EPS ? 'ok' : 'crossing';
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function csvCell(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' };

/** Tooltip for the main chart: shows every quantile and the real step h of the hovered day. */
const ForecastTooltip: React.FC<{ active?: boolean; payload?: ReadonlyArray<{ payload: ChartPoint }> }> = ({ active, payload }) => {
  const t = useT();
  const fmt = useFormat();
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  const r = p.row;
  const line = (label: string, v: number | null | undefined) => (
    <div className="ui-chart-tooltip__row" key={label}>
      <span>{label}</span>
      <span className="ui-chart-tooltip__value">{fmt.number(v, { digits: 2 })}</span>
    </div>
  );
  return (
    <div className="ui-chart-tooltip">
      <div className="ui-chart-tooltip__title">{fmt.date(p.date, 'medium')}</div>
      {p.actual !== null && line(t('forecast.chart.actual'), p.actual)}
      {r && (
        <>
          {line(t('forecast.chart.tooltip_p10'), r.p10)}
          {line(t('forecast.chart.tooltip_p50'), r.p50)}
          {line(t('forecast.chart.tooltip_p90'), r.p90)}
          {line(t('forecast.chart.tooltip_yhat'), r.y_pred)}
          {r.is_overridden && line(t('forecast.chart.tooltip_original'), r.original_value)}
          {line(t('forecast.chart.tooltip_step'), r.h)}
        </>
      )}
    </div>
  );
};

/** Q̂(τ) curve + table of the window distribution exactly as the backend returned it. */
const QuantileChart: React.FC<{ levels: Record<string, number>; title: string; source: string; xLabel: string; yLabel: string }> = ({ levels, title, source, xLabel, yLabel }) => {
  const c = useChartTheme();
  const fmt = useFormat();
  const data = useMemo(
    () =>
      Object.entries(levels)
        .map(([tau, value]) => ({ tau: Number(tau), value }))
        .filter((d) => Number.isFinite(d.tau) && Number.isFinite(d.value))
        .sort((a, b) => a.tau - b.tau),
    [levels],
  );
  const columns: Column<{ tau: number; value: number }>[] = [
    { key: 'tau', header: xLabel, align: 'right', value: (d) => d.tau, cell: (d) => <span className="ui-num">{fmt.number(d.tau, { digits: 2 })}</span> },
    { key: 'value', header: yLabel, align: 'right', value: (d) => d.value, cell: (d) => <span className="ui-num">{fmt.number(d.value, { digits: 2 })}</span> },
  ];
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <ChartFrame title={title} source={source} height={280} empty={data.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="tau" type="number" domain={[0, 1]} {...c.axis} tickFormatter={(v: number) => fmt.number(v, { digits: 2 })} />
            <YAxis {...c.axis} width={44} domain={[0, 'auto']} />
            <Tooltip cursor={c.cursor} formatter={(v) => (typeof v === 'number' ? fmt.number(v, { digits: 2 }) : '—')} labelFormatter={(l) => `τ = ${fmt.number(Number(l), { digits: 2 })}`} />
            <Line dataKey="value" name={yLabel} stroke={c.series[0]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
      <Card flush>
        <Table columns={columns} rows={data} rowKey={(d) => d.tau} dense maxHeight={320} />
      </Card>
    </div>
  );
};

export const ForecastExplorer: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const chart = useChartTheme();
  const { user } = useAuth();
  const { storeId } = useStore();
  const clock = useClock();
  const { confirm, dialog } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const canEdit = can(user?.role, 'replenishment:write'); // manager and admin
  const sku = searchParams.get('sku') ?? '';
  const isGlobal = !!storeId && GLOBAL_STORE.test(storeId);
  const store = storeId && !isGlobal ? storeId : null;

  const [tab, setTab] = useState<PageTab>(() => {
    const p = searchParams.get('tab');
    return p === 'route_c' || p === 'schedule' ? p : 'forecast';
  });
  const [horizon, setHorizon] = useState<number>(28);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const skuPage = usePagination(6);
  const schedulePage = usePagination(14);
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>('all');

  const setSku = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('sku', id);
    setSearchParams(next, { replace: true });
  };

  /* ------------------------------- SKU picker ------------------------------ */
  const products = useApi(
    (signal) => listProducts({ page: skuPage.page, page_size: skuPage.pageSize, q: query, cat_id: category }, signal),
    [skuPage.page, skuPage.pageSize, query, category],
  );
  const categories = useApi((signal) => listCategories(signal), []);

  // Pick the first SKU once, when none is chosen (no hard-coded default SKU).
  const firstSku = products.data?.items[0]?.item_id;
  useEffect(() => {
    if (!sku && firstSku && !query && !category) {
      const next = new URLSearchParams(searchParams);
      next.set('sku', firstSku);
      setSearchParams(next, { replace: true });
    }
  }, [sku, firstSku, query, category, searchParams, setSearchParams]);

  const selectedProduct: ProductRow | undefined = products.data?.items.find((p) => p.item_id === sku);

  /* -------------------------------- forecasts ------------------------------- */
  const ready = !!sku && !!store;
  // No "last fetched key" cache: every dependency change or retry refetches, so a failure never sticks (P-43).
  const forecasts = useApi((signal) => getForecasts(sku, store as string, horizon, signal), [sku, store, horizon, clock.version], { enabled: ready });

  const processed = useMemo(() => {
    const raw = forecasts.data?.items ?? [];
    const versions = Array.from(new Set(raw.map((r) => r.model_version)));
    const chosen = forecasts.data?.model_version && versions.includes(forecasts.data.model_version) ? forecasts.data.model_version : versions[0];
    const byH = new Map<number, ForecastRow>();
    for (const r of raw) {
      if (r.model_version !== chosen) continue;
      const prev = byH.get(r.h);
      if (!prev || (r.generated_at ?? '') > (prev.generated_at ?? '')) byH.set(r.h, r);
    }
    const rows: ProcessedRow[] = Array.from(byH.values())
      .sort((a, b) => a.h - b.h)
      .map((r) => ({ ...r, quality: rowQuality(r), modelValue: r.is_overridden && r.original_value !== null ? r.original_value : r.y_pred }));
    const generatedAt = rows.reduce<string | null>((acc, r) => (r.generated_at && (!acc || r.generated_at > acc) ? r.generated_at : acc), null);
    return { rows, versions, version: chosen as string | undefined, generatedAt };
  }, [forecasts.data]);

  const rows = processed.rows;
  const firstDate = rows.length ? rows.reduce((m, r) => (r.forecast_date < m ? r.forecast_date : m), rows[0].forecast_date) : undefined;
  const historyStart = firstDate ? shiftIso(firstDate, -56) : undefined;
  const history = useApi((signal) => getHistory(sku, store as string, historyStart, signal), [sku, store, historyStart, clock.version], {
    enabled: ready && rows.length > 0,
  });
  const compare = useApi((signal) => getCompare(sku, store as string, signal), [sku, store, clock.version], { enabled: ready });
  const uncertainty = useApi((signal) => getUncertainty(sku, store as string, horizon, signal), [sku, store, horizon, clock.version], { enabled: ready });
  const explanation = useApi((signal) => getExplanation(sku, store as string, signal), [sku, store, clock.version], { enabled: ready && canEdit && tab === 'forecast' });
  const windowQ = useApi((signal) => getWindowQuantiles(sku, store as string, signal), [sku, store, clock.version], { enabled: ready && tab === 'route_c' });
  const overrides = useApi((signal) => listOverrides(sku, store as string, signal), [sku, store, clock.version], { enabled: ready });

  const refreshAll = () => {
    forecasts.refetch();
    overrides.refetch();
    compare.refetch();
  };

  /* ------------------------------ derived values ---------------------------- */
  const historyPoints = useMemo(() => history.data?.history ?? [], [history.data]);
  const lastActualDate = historyPoints.length ? historyPoints[historyPoints.length - 1].date : null;
  const actualByDate = useMemo(() => new Map(historyPoints.map((h) => [h.date, h.quantity])), [historyPoints]);

  const chartData = useMemo<ChartPoint[]>(() => {
    // One map keyed by calendar date: history and forecast share a single sequential axis (P-34).
    const m = new Map<string, ChartPoint>();
    const get = (date: string): ChartPoint => {
      let p = m.get(date);
      if (!p) {
        p = { date, actual: null, forecast: null, band: null, adjusted: null, row: null };
        m.set(date, p);
      }
      return p;
    };
    for (const h of historyPoints) get(h.date).actual = h.quantity;
    for (const r of rows) {
      const p = get(r.forecast_date);
      p.row = r;
      p.forecast = r.p50 ?? r.y_pred;
      p.band = r.quality === 'ok' ? [r.p10 as number, r.p90 as number] : null;
      p.adjusted = r.is_overridden ? r.y_pred : null;
    }
    return Array.from(m.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [historyPoints, rows]);

  const crossing = rows.filter((r) => r.quality === 'crossing');
  const missingQ = rows.filter((r) => r.quality === 'missing');
  const missingP50 = rows.filter((r) => r.p50 === null);
  const backtestCount = lastActualDate ? rows.filter((r) => r.forecast_date <= lastActualDate).length : 0;
  const kind: 'backtest' | 'future' | 'mixed' | null = !rows.length || !history.data ? null : backtestCount === rows.length ? 'backtest' : backtestCount === 0 ? 'future' : 'mixed';

  const totalDemand = rows.length ? rows.reduce((s, r) => s + r.y_pred, 0) : null;
  const validBands = rows.filter((r) => r.quality === 'ok');
  const meanBand = validBands.length ? validBands.reduce((s, r) => s + ((r.p90 as number) - (r.p10 as number)), 0) / validBands.length : null;

  const isStatsModel = (v: string | undefined) => !!v && /sba/i.test(v);
  const modelLabel = (v: string | undefined) => (!v ? '' : isStatsModel(v) ? t('forecast.model.sba') : v);

  /* ------------------------------ fast inference ---------------------------- */
  const [fastBusy, setFastBusy] = useState(false);
  const generateFast = async () => {
    if (!store) return;
    const ok = await confirm({
      title: t('forecast.empty.fast_confirm_title'),
      description: t('forecast.empty.fast_confirm_desc', { store }),
      confirmLabel: t('forecast.empty.fast_action'),
    });
    if (!ok) return;
    setFastBusy(true);
    try {
      const res = await runFastInference(store, 28);
      toast.success(
        t('forecast.empty.fast_done', {
          records: fmt.integer(res.records_generated),
          skus: fmt.integer(res.skus_forecasted),
          seconds: fmt.number(res.duration_seconds, { digits: 1 }),
        }),
      );
      refreshAll();
    } catch (err) {
      toast.error(apiErrorMessage(err, t));
    } finally {
      setFastBusy(false);
    }
  };

  /* ------------------------------- CSV export ------------------------------- */
  const exportCsv = () => {
    if (!rows.length) {
      toast.warning(t('forecast.ctl.export_none'));
      return;
    }
    const filename = `forecast_${sku}_${store}_${horizon}d.csv`;
    downloadCsv(
      filename,
      ['SKU', 'Store', 'Date', 'h', 'P10', 'P50', 'P90', 'y_pred', 'original_value', 'is_overridden', 'actual', 'model_version'],
      rows.map((r) => [sku, store, r.forecast_date, r.h, r.p10, r.p50, r.p90, r.y_pred, r.original_value, r.is_overridden, actualByDate.get(r.forecast_date), r.model_version]),
    );
    toast.success(t('forecast.ctl.export_done', { n: rows.length, file: filename }));
  };

  /* ------------------------------ override dialogs -------------------------- */
  const [ovRow, setOvRow] = useState<ProcessedRow | null>(null);
  const [ovValue, setOvValue] = useState('');
  const [ovReason, setOvReason] = useState<OverrideReasonKey>('promo');
  const [ovNotes, setOvNotes] = useState('');
  const [ovBusy, setOvBusy] = useState(false);
  const [ovError, setOvError] = useState<string | null>(null);

  const reasonText = (key: OverrideReasonKey, notes: string) => {
    const label = t(`forecast.override.reason_${key}` as TKey);
    return notes.trim() ? `${label}: ${notes.trim()}` : label;
  };

  const openOverride = (r: ProcessedRow) => {
    setOvRow(r);
    setOvValue(String(r.y_pred));
    setOvReason('promo');
    setOvNotes('');
    setOvError(null);
  };

  const submitOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ovRow || !store) return;
    const value = Number(ovValue);
    if (ovValue.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100000) {
      setOvError(t('forecast.override.invalid_value'));
      return;
    }
    if (ovReason === 'other' && !ovNotes.trim()) {
      setOvError(t('forecast.override.notes_required'));
      return;
    }
    setOvBusy(true);
    setOvError(null);
    try {
      // `h` is the real step of the API row, not an index in a filtered list (P-32 / F-13).
      await createOverride(sku, { forecast_date: ovRow.forecast_date, override_value: value, reason: reasonText(ovReason, ovNotes), store_id: store, h: ovRow.h });
      toast.success(t('forecast.override.success', { h: ovRow.h, date: fmt.date(ovRow.forecast_date) }));
      setOvRow(null);
      refreshAll();
    } catch (err) {
      setOvError(apiErrorMessage(err, t));
    } finally {
      setOvBusy(false);
    }
  };

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<'percent' | 'fixed'>('percent');
  const [bulkValue, setBulkValue] = useState('10');
  const [bulkFrom, setBulkFrom] = useState('');
  const [bulkTo, setBulkTo] = useState('');
  const [bulkReason, setBulkReason] = useState<OverrideReasonKey>('promo');
  const [bulkNotes, setBulkNotes] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const openBulk = () => {
    setBulkFrom(rows[0]?.forecast_date ?? '');
    setBulkTo(rows[rows.length - 1]?.forecast_date ?? '');
    setBulkMode('percent');
    setBulkValue('10');
    setBulkReason('promo');
    setBulkNotes('');
    setBulkError(null);
    setBulkOpen(true);
  };

  const bulkNumber = Number(bulkValue);
  const bulkValid = bulkValue.trim() !== '' && Number.isFinite(bulkNumber) && (bulkMode === 'percent' ? bulkNumber > -100 : bulkNumber >= 0 && bulkNumber <= 100000);
  const bulkPreview = useMemo(() => {
    if (!bulkOpen || !bulkValid) return [];
    return rows
      .filter((r) => (!bulkFrom || r.forecast_date >= bulkFrom) && (!bulkTo || r.forecast_date <= bulkTo))
      .map((r) => ({ row: r, value: Math.min(100000, Math.max(0, bulkMode === 'percent' ? Math.round(r.y_pred * (1 + bulkNumber / 100) * 100) / 100 : bulkNumber)) }));
  }, [bulkOpen, bulkValid, rows, bulkFrom, bulkTo, bulkMode, bulkNumber]);

  const submitBulk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store) return;
    if (!bulkValid) {
      setBulkError(t('forecast.bulk.invalid_value'));
      return;
    }
    if (bulkReason === 'other' && !bulkNotes.trim()) {
      setBulkError(t('forecast.override.notes_required'));
      return;
    }
    if (!bulkPreview.length) {
      setBulkError(t('forecast.bulk.none_in_range'));
      return;
    }
    setBulkBusy(true);
    setBulkError(null);
    try {
      const reason = reasonText(bulkReason, bulkNotes);
      const res = await bulkOverride(bulkPreview.map((p) => ({ store_id: store, item_id: sku, date: p.row.forecast_date, h: p.row.h, value: p.value, reason })));
      if (res.skipped_count > 0) toast.warning(t('forecast.bulk.skipped', { created: res.created_count, skipped: res.skipped_count }));
      else toast.success(t('forecast.bulk.success', { created: res.created_count }));
      setBulkOpen(false);
      refreshAll();
    } catch (err) {
      setBulkError(apiErrorMessage(err, t));
    } finally {
      setBulkBusy(false);
    }
  };

  const doRevert = async (o: OverrideRow) => {
    const ok = await confirm({
      title: t('forecast.history.revert_title'),
      description: t('forecast.history.revert_description', { date: fmt.date(o.forecast_date), value: fmt.number(o.original_value, { digits: 2 }) }),
      tone: 'danger',
      confirmLabel: t('forecast.history.revert'),
    });
    if (!ok) return;
    try {
      await revertOverride(sku, o.id);
      toast.success(t('forecast.history.revert_done'));
      refreshAll();
    } catch (err) {
      toast.error(apiErrorMessage(err, t));
    }
  };

  /* --------------------------------- columns -------------------------------- */
  const qCell = (v: number | null) => (v === null ? <Unavailable /> : <span className="ui-num">{fmt.number(v, { digits: 2 })}</span>);

  const skuColumns: Column<ProductRow>[] = [
    { key: 'item_id', header: t('forecast.sku.col_sku'), cell: (p) => <span style={mono}>{p.item_id}</span> },
    { key: 'name', header: t('forecast.sku.col_name'), value: (p) => p.name },
    { key: 'cat', header: t('forecast.sku.col_category'), value: (p) => p.cat_id },
  ];

  const filteredRows = useMemo(
    () => rows.filter((r) => (scheduleFilter === 'overridden' ? r.is_overridden : scheduleFilter === 'dq' ? r.quality !== 'ok' : true)),
    [rows, scheduleFilter],
  );

  const scheduleColumns: Column<ProcessedRow>[] = [
    { key: 'h', header: t('forecast.schedule.col_h'), align: 'right', sortable: true, value: (r) => r.h },
    { key: 'date', header: t('forecast.schedule.col_date'), sortable: true, value: (r) => r.forecast_date, cell: (r) => fmt.date(r.forecast_date) },
    { key: 'p10', header: t('forecast.schedule.col_p10'), align: 'right', value: (r) => r.p10, cell: (r) => qCell(r.p10) },
    { key: 'p50', header: t('forecast.schedule.col_p50'), align: 'right', value: (r) => r.p50, cell: (r) => qCell(r.p50) },
    { key: 'p90', header: t('forecast.schedule.col_p90'), align: 'right', value: (r) => r.p90, cell: (r) => qCell(r.p90) },
    { key: 'pred', header: t('forecast.schedule.col_pred'), align: 'right', sortable: true, value: (r) => r.y_pred, cell: (r) => <strong className="ui-num">{fmt.number(r.y_pred, { digits: 2 })}</strong> },
    { key: 'actual', header: t('forecast.schedule.col_actual'), align: 'right', cell: (r) => qCell(actualByDate.get(r.forecast_date) ?? null) },
    {
      key: 'status',
      header: t('forecast.schedule.col_status'),
      cell: (r) =>
        r.is_overridden ? (
          <Badge tone="accent">{t('forecast.schedule.status_overridden')}</Badge>
        ) : r.quality === 'crossing' ? (
          <Badge tone="warning">{t('forecast.schedule.status_dq')}</Badge>
        ) : r.quality === 'missing' ? (
          <Badge tone="neutral">{t('forecast.schedule.status_missing')}</Badge>
        ) : (
          <Badge tone="success">{t('forecast.schedule.status_ok')}</Badge>
        ),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: t('forecast.schedule.col_actions'),
            align: 'right' as const,
            cell: (r: ProcessedRow) => (
              <Button size="sm" variant="secondary" leftIcon={<Pencil size={14} />} onClick={() => openOverride(r)}>
                {t('forecast.schedule.adjust')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const overrideColumns: Column<OverrideRow>[] = [
    { key: 'date', header: t('forecast.history.col_date'), sortable: true, value: (o) => o.forecast_date, cell: (o) => fmt.date(o.forecast_date) },
    { key: 'h', header: t('forecast.history.col_h'), align: 'right', value: (o) => o.h },
    { key: 'orig', header: t('forecast.history.col_original'), align: 'right', value: (o) => o.original_value, cell: (o) => qCell(o.original_value) },
    { key: 'new', header: t('forecast.history.col_new'), align: 'right', value: (o) => o.override_value, cell: (o) => qCell(o.override_value) },
    { key: 'reason', header: t('forecast.history.col_reason'), value: (o) => o.reason },
    { key: 'by', header: t('forecast.history.col_by'), value: (o) => o.created_by },
    { key: 'created', header: t('forecast.history.col_created'), value: (o) => o.created_at, cell: (o) => fmt.dateTime(o.created_at) },
    {
      key: 'status',
      header: t('forecast.history.col_status'),
      cell: (o) => <Badge tone={o.is_active ? 'accent' : 'neutral'}>{o.is_active ? t('forecast.history.active') : t('forecast.history.reverted')}</Badge>,
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            cell: (o: OverrideRow) =>
              o.is_active ? (
                <Button size="sm" variant="ghost" onClick={() => void doRevert(o)}>
                  {t('forecast.history.revert')}
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  /* ---------------------------------- render -------------------------------- */
  const compareErr = compare.error;
  const maeReason = compare.loading
    ? undefined
    : compareErr
      ? compareErr.kind === 'not_found' || compareErr.kind === 'validation'
        ? t('forecast.kpi.mae_missing')
        : apiErrorMessage(compareErr, t)
      : undefined;
  const maeValue = compare.data ? fmt.number(compare.data.metrics.mae, { digits: 3 }) : null;

  const sigmaValue = uncertainty.data?.sigma_h ?? null;
  const sigmaReason = uncertainty.loading ? undefined : uncertainty.error ? apiErrorMessage(uncertainty.error, t) : sigmaValue === null ? t('forecast.kpi.sigma_missing') : undefined;

  const maxShap = Math.max(...(explanation.data?.features ?? []).map((f) => Math.abs(f.importance_score)), 0) || 1;

  const dataQuality = (
    <>
      {crossing.length > 0 && (
        <Alert tone="warning" title={t('forecast.dq.title')}>
          {t('forecast.dq.crossing', { n: crossing.length, steps: crossing.slice(0, 8).map((r) => r.h).join(', ') + (crossing.length > 8 ? '…' : '') })}
        </Alert>
      )}
      {missingQ.length > 0 && <Alert tone="info">{t('forecast.dq.missing_q', { n: missingQ.length })}</Alert>}
      {missingP50.length > 0 && <Alert tone="info">{t('forecast.dq.missing_p50', { n: missingP50.length })}</Alert>}
      {processed.versions.length > 1 && <Alert tone="warning">{t('forecast.dq.mixed', { versions: processed.versions.join(', '), version: processed.version ?? '' })}</Alert>}
      {rows.length > 0 && rows.length < horizon && <Alert tone="info">{t('forecast.dq.partial', { n: rows.length, h: horizon })}</Alert>}
    </>
  );

  const body = (() => {
    if (isGlobal) return <EmptyState title={t('forecast.global.title')} description={t('forecast.global.description')} />;
    if (!sku) return <EmptyState title={t('forecast.sku.none_selected')} />;
    if (forecasts.error && !forecasts.data) return <ErrorState error={forecasts.error} onRetry={forecasts.refetch} />;
    if (!forecasts.loading && forecasts.data && rows.length === 0) {
      return (
        <Card>
          <EmptyState
            title={t('forecast.empty.title')}
            description={t('forecast.empty.description', { sku, store: store ?? '' })}
            action={
              canEdit ? (
                <div style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'center' }}>
                  <Button leftIcon={<Sparkles size={16} />} loading={fastBusy} onClick={() => void generateFast()}>
                    {t('forecast.empty.fast_action')}
                  </Button>
                  {fastBusy && <span style={muted}>{t('forecast.empty.fast_running')}</span>}
                </div>
              ) : (
                <span style={muted}>{t('forecast.empty.fast_note')}</span>
              )
            }
          />
        </Card>
      );
    }
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
          <KpiTile
            label={t('forecast.kpi.demand')}
            loading={forecasts.loading && !forecasts.data}
            value={totalDemand !== null ? fmt.number(totalDemand, { digits: 1 }) : null}
            unit={t('forecast.kpi.units')}
            unavailableReason={totalDemand === null && !forecasts.loading ? t('forecast.kpi.demand_none') : undefined}
            hint={t('forecast.kpi.demand_hint', { n: rows.length })}
          />
          <KpiTile
            label={t('forecast.kpi.band')}
            loading={forecasts.loading && !forecasts.data}
            value={meanBand !== null ? fmt.number(meanBand, { digits: 2 }) : null}
            unit={t('forecast.kpi.units')}
            unavailableReason={meanBand === null && !forecasts.loading ? t('forecast.kpi.band_missing') : undefined}
            hint={t('forecast.kpi.band_hint')}
          />
          <KpiTile
            label={t('forecast.kpi.sigma')}
            loading={uncertainty.loading && !uncertainty.data}
            value={sigmaValue !== null ? fmt.number(sigmaValue, { digits: 3 }) : null}
            unavailableReason={sigmaReason}
            hint={t('forecast.kpi.sigma_hint')}
          />
          <KpiTile
            label={t('forecast.kpi.mae')}
            loading={compare.loading && !compare.data}
            value={maeValue}
            unavailableReason={maeReason}
            hint={compare.data ? t('forecast.kpi.mae_hint', { rmse: fmt.number(compare.data.metrics.rmse, { digits: 3 }), n: compare.data.metrics.data_points }) : undefined}
          />
        </div>

        <Tabs
          aria-label={t('forecast.page.title')}
          value={tab}
          onChange={setTab}
          items={[
            { id: 'forecast', label: t('forecast.tabs.forecast') },
            { id: 'route_c', label: t('forecast.tabs.route_c') },
            { id: 'schedule', label: t('forecast.tabs.schedule'), count: overrides.data?.filter((o) => o.is_active).length },
          ]}
        />

        {tab === 'forecast' && (
          <>
            {kind === 'backtest' && (
              <Alert tone="info" title={t('forecast.kind.backtest')}>
                {t('forecast.kind.backtest_note')}
              </Alert>
            )}
            {dataQuality}
            <ChartFrame
              title={t('forecast.chart.title')}
              description={t('forecast.chart.description')}
              source={t('forecast.chart.source')}
              height={340}
              loading={(forecasts.loading && !forecasts.data) || (history.loading && !history.data)}
              error={history.error}
              onRetry={history.refetch}
              empty={chartData.length === 0}
              footer={
                <ChartLegend
                  items={[
                    { label: t('forecast.chart.actual'), color: chart.series[1] },
                    { label: t('forecast.chart.forecast'), color: chart.series[0] },
                    { label: t('forecast.chart.band'), color: chart.series[0] },
                    ...(rows.some((r) => r.is_overridden) ? [{ label: t('forecast.chart.adjusted'), color: chart.series[2] }] : []),
                  ]}
                />
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={chart.grid} />
                  <XAxis dataKey="date" {...chart.axis} minTickGap={28} tickFormatter={(d: string) => fmt.date(d, 'short')} />
                  <YAxis {...chart.axis} width={44} domain={[0, 'auto']} />
                  <Tooltip cursor={chart.cursor} content={<ForecastTooltip />} />
                  {lastActualDate && chartData.some((p) => p.date === lastActualDate) && (
                    <ReferenceLine
                      x={lastActualDate}
                      stroke={chart.reference}
                      strokeDasharray="4 4"
                      label={{ value: t('forecast.chart.last_actual', { date: fmt.date(lastActualDate, 'short') }), fill: chart.tick, fontSize: 11, position: 'insideTopLeft' }}
                    />
                  )}
                  <Area dataKey="band" name={t('forecast.chart.band')} stroke="none" fill={chart.series[0]} fillOpacity={chart.bandOpacity} isAnimationActive={false} connectNulls={false} />
                  <Line dataKey="actual" name={t('forecast.chart.actual')} stroke={chart.series[1]} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
                  <Line dataKey="forecast" name={t('forecast.chart.forecast')} stroke={chart.series[0]} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
                  <Line dataKey="adjusted" name={t('forecast.chart.adjusted')} stroke="none" dot={{ r: 5, fill: chart.series[2], stroke: chart.surface, strokeWidth: 1 }} activeDot={false} isAnimationActive={false} legendType="none" />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartFrame>

            <Card title={t('forecast.shap.title')} description={t('forecast.shap.description')}>
              {!canEdit ? (
                <Alert tone="info">{t('forecast.shap.restricted')}</Alert>
              ) : explanation.loading && !explanation.data ? (
                <Skeleton height={120} />
              ) : explanation.error ? (
                <ErrorState compact error={explanation.error} onRetry={explanation.refetch} />
              ) : !explanation.data || explanation.data.features.length === 0 ? (
                <EmptyState compact title={t('forecast.shap.empty_title')} />
              ) : (
                <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                  <div style={muted}>
                    {t('forecast.shap.model', { name: explanation.data.model_name, version: explanation.data.model_version })} · {t('forecast.shap.base')}:{' '}
                    <span className="ui-num">{fmt.number(explanation.data.base_value, { digits: 3 })}</span>
                  </div>
                  {explanation.data.features.slice(0, 8).map((f) => (
                    <div key={f.feature_name} style={{ display: 'grid', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
                        <span style={mono}>
                          {f.feature_name}{' '}
                          {f.direction && <Badge tone="neutral">{/pos/i.test(f.direction) ? t('forecast.shap.direction_positive') : /neg/i.test(f.direction) ? t('forecast.shap.direction_negative') : f.direction}</Badge>}
                        </span>
                        <span className="ui-num">{fmt.number(f.importance_score, { digits: 3 })}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 'var(--radius-full)', background: 'var(--color-surface-sunken)' }}>
                        <div style={{ height: '100%', width: `${(Math.abs(f.importance_score) / maxShap) * 100}%`, borderRadius: 'var(--radius-full)', background: chart.series[0] }} />
                      </div>
                      {f.description && <span style={muted}>{f.description}</span>}
                    </div>
                  ))}
                  <DataSourceNote source={t('forecast.shap.source')} />
                </div>
              )}
            </Card>
          </>
        )}

        {tab === 'route_c' &&
          (windowQ.loading && !windowQ.data ? (
            <Skeleton height={220} />
          ) : windowQ.error ? (
            <ErrorState error={windowQ.error} onRetry={windowQ.refetch} />
          ) : !windowQ.data ? (
            <EmptyState title={t('forecast.route.empty')} />
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
                <KpiTile label={t('forecast.route.point_window')} value={fmt.number(windowQ.data.point_window, { digits: 2 })} unit={t('forecast.kpi.units')} />
                <KpiTile label={t('forecast.route.tau95')} value={fmt.number(windowQ.data.tau_95, { digits: 2 })} unit={t('forecast.kpi.units')} />
                <KpiTile label={t('forecast.route.origin')} value={fmt.date(windowQ.data.origin_date)} />
                <KpiTile label={t('forecast.route.horizon_days')} value={t('forecast.route.days', { n: windowQ.data.horizon_days })} hint={`${t('forecast.route.route_label')}: ${windowQ.data.route}`} />
              </div>
              <Alert tone={windowQ.data.route === 'c' ? 'info' : 'warning'} title={t('forecast.route.note_title')}>
                {windowQ.data.route === 'c'
                  ? t('forecast.route.note_empirical')
                  : windowQ.data.route === 'c_fb'
                    ? t('forecast.route.note_fallback')
                    : t('forecast.route.note_unknown', { route: windowQ.data.route })}
              </Alert>
              <QuantileChart levels={windowQ.data.q_levels} title={t('forecast.route.q_chart')} source={t('forecast.route.source')} xLabel={t('forecast.route.level')} yLabel={t('forecast.route.value')} />
            </>
          ))}

        {tab === 'schedule' && (
          <>
            {dataQuality}
            <Card
              title={t('forecast.schedule.title')}
              description={t('forecast.schedule.description')}
              flush
              actions={
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Select<ScheduleFilter>
                    aria-label={t('forecast.schedule.filter')}
                    size="sm"
                    value={scheduleFilter}
                    onChange={(v) => {
                      setScheduleFilter(v);
                      schedulePage.setPage(1);
                    }}
                    options={[
                      { value: 'all', label: t('forecast.schedule.filter_all') },
                      { value: 'overridden', label: t('forecast.schedule.filter_overridden') },
                      { value: 'dq', label: t('forecast.schedule.filter_dq') },
                    ]}
                  />
                  {canEdit && (
                    <Button size="sm" variant="secondary" leftIcon={<Layers size={14} />} onClick={openBulk} disabled={rows.length === 0}>
                      {t('forecast.schedule.bulk')}
                    </Button>
                  )}
                </div>
              }
            >
              <Table
                columns={scheduleColumns}
                rows={filteredRows}
                rowKey={(r) => r.id}
                loading={forecasts.loading && !forecasts.data}
                error={forecasts.error}
                onRetry={forecasts.refetch}
                filtered={scheduleFilter !== 'all'}
                emptyTitle={scheduleFilter !== 'all' ? t('forecast.schedule.empty_filtered') : undefined}
                pagination={{ page: schedulePage.page, pageSize: schedulePage.pageSize, onPageChange: schedulePage.setPage, onPageSizeChange: schedulePage.setPageSize, pageSizeOptions: [7, 14, 28] }}
                dense
              />
            </Card>

            <Card title={t('forecast.history.title')} description={t('forecast.history.description')} flush>
              <Table
                columns={overrideColumns}
                rows={overrides.data ?? []}
                rowKey={(o) => o.id}
                loading={overrides.loading && !overrides.data}
                error={overrides.error}
                onRetry={overrides.refetch}
                emptyTitle={t('forecast.history.empty_title')}
                emptyDescription={t('forecast.history.empty_description')}
                dense
                wrap
              />
              <div style={{ padding: '0 var(--space-4) var(--space-3)' }}>
                <DataSourceNote source={t('forecast.history.source')} />
              </div>
            </Card>
          </>
        )}
      </>
    );
  })();

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <PageHeader
        title={t('forecast.page.title')}
        description={t('forecast.page.description')}
        actions={
          <Button variant="secondary" leftIcon={<Download size={16} />} onClick={exportCsv} disabled={rows.length === 0}>
            {t('forecast.ctl.export')}
          </Button>
        }
        meta={
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
            <DataSourceNote source={t('forecast.page.source')} />
            {store && (
              <Badge tone="neutral">
                {t('forecast.ctl.store')}: {store}
              </Badge>
            )}
            {processed.version && (
              <Badge tone={isStatsModel(processed.version) ? 'warning' : 'accent'}>
                {t('forecast.ctl.model')}: {modelLabel(processed.version)}
              </Badge>
            )}
            {processed.generatedAt && (
              <Badge tone="neutral">
                {t('forecast.ctl.generated')}: {fmt.dateTime(processed.generatedAt)}
              </Badge>
            )}
            {kind && <Badge tone={kind === 'future' ? 'success' : 'info'}>{t(`forecast.kind.${kind}` as TKey)}</Badge>}
          </div>
        }
      />

      <Card title={t('forecast.sku.title')}>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)', alignItems: 'end' }}>
            <Field label={t('forecast.sku.search_label')}>
              <SearchInput
                value={query}
                onChange={(v) => {
                  setQuery(v);
                  skuPage.setPage(1);
                }}
                placeholder={t('forecast.sku.search_placeholder')}
                aria-label={t('forecast.sku.search_label')}
              />
            </Field>
            <Select
              label={t('forecast.sku.category')}
              value={category}
              disabled={!!categories.error}
              onChange={(v) => {
                setCategory(v);
                skuPage.setPage(1);
              }}
              options={[{ value: '', label: t('forecast.sku.category_all') }, ...(categories.data ?? []).map((c) => ({ value: c, label: c }))]}
            />
            <Select<number>
              label={t('forecast.ctl.horizon')}
              value={horizon}
              onChange={(v) => {
                setHorizon(v);
                schedulePage.setPage(1);
              }}
              options={HORIZONS.map((d) => ({ value: d, label: t('forecast.ctl.horizon_option', { days: d }) }))}
            />
          </div>
          <div style={{ fontSize: 'var(--text-sm)' }}>
            <span style={muted}>{t('forecast.sku.selected')}: </span>
            {sku ? (
              <>
                <strong style={mono}>{sku}</strong>
                {selectedProduct && <span style={muted}> · {selectedProduct.name}</span>}
              </>
            ) : (
              <span style={muted}>{t('forecast.sku.none_selected')}</span>
            )}
          </div>
          <Table
            columns={skuColumns}
            rows={products.data?.items ?? []}
            rowKey={(p) => p.item_id}
            loading={products.loading && !products.data}
            error={products.error}
            onRetry={products.refetch}
            filtered={!!query || !!category}
            emptyTitle={t('forecast.sku.empty_title')}
            emptyDescription={t('forecast.sku.empty_description')}
            onRowClick={(p) => setSku(p.item_id)}
            pagination={{ page: skuPage.page, pageSize: skuPage.pageSize, onPageChange: skuPage.setPage, total: products.data?.total ?? 0 }}
            dense
          />
          <DataSourceNote source={t('forecast.sku.source')} />
        </div>
      </Card>

      {!user ? <NoPermission /> : body}

      <Modal
        open={ovRow !== null}
        onClose={() => setOvRow(null)}
        dismissible={!ovBusy}
        title={t('forecast.override.title')}
        description={ovRow ? t('forecast.override.description', { h: ovRow.h, date: fmt.date(ovRow.forecast_date), value: fmt.number(ovRow.modelValue, { digits: 2 }) }) : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOvRow(null)} disabled={ovBusy}>
              {t('forecast.override.cancel')}
            </Button>
            <Button type="submit" form="override-form" loading={ovBusy}>
              {t('forecast.override.submit')}
            </Button>
          </>
        }
      >
        <form id="override-form" onSubmit={submitOverride} style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {ovError && <Alert tone="danger">{ovError}</Alert>}
          <Input label={t('forecast.override.value')} type="number" min={0} max={100000} step="any" value={ovValue} onChange={(e) => setOvValue(e.target.value)} />
          <Select<OverrideReasonKey> label={t('forecast.override.reason')} value={ovReason} onChange={setOvReason} options={OVERRIDE_REASONS.map((k) => ({ value: k, label: t(`forecast.override.reason_${k}` as TKey) }))} />
          <Input label={t('forecast.override.notes')} value={ovNotes} maxLength={400} onChange={(e) => setOvNotes(e.target.value)} />
        </form>
      </Modal>

      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        dismissible={!bulkBusy}
        title={t('forecast.bulk.title')}
        description={t('forecast.bulk.description')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>
              {t('forecast.override.cancel')}
            </Button>
            <Button type="submit" form="bulk-form" loading={bulkBusy} disabled={bulkPreview.length === 0}>
              {t('forecast.bulk.submit', { n: bulkPreview.length })}
            </Button>
          </>
        }
      >
        <form id="bulk-form" onSubmit={submitBulk} style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {bulkError && <Alert tone="danger">{bulkError}</Alert>}
          <Select<'percent' | 'fixed'>
            label={t('forecast.bulk.mode')}
            value={bulkMode}
            onChange={setBulkMode}
            options={[
              { value: 'percent', label: t('forecast.bulk.mode_percent') },
              { value: 'fixed', label: t('forecast.bulk.mode_fixed') },
            ]}
          />
          <Input
            label={bulkMode === 'percent' ? t('forecast.bulk.percent') : t('forecast.bulk.fixed')}
            type="number"
            step="any"
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
            error={bulkValue !== '' && !bulkValid ? t('forecast.bulk.invalid_value') : undefined}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <Input label={t('forecast.bulk.from')} type="date" value={bulkFrom} min={rows[0]?.forecast_date} max={rows[rows.length - 1]?.forecast_date} onChange={(e) => setBulkFrom(e.target.value)} />
            <Input label={t('forecast.bulk.to')} type="date" value={bulkTo} min={rows[0]?.forecast_date} max={rows[rows.length - 1]?.forecast_date} onChange={(e) => setBulkTo(e.target.value)} />
          </div>
          <Select<OverrideReasonKey> label={t('forecast.override.reason')} value={bulkReason} onChange={setBulkReason} options={OVERRIDE_REASONS.map((k) => ({ value: k, label: t(`forecast.override.reason_${k}` as TKey) }))} />
          <Input label={t('forecast.override.notes')} value={bulkNotes} maxLength={400} onChange={(e) => setBulkNotes(e.target.value)} />
          <Alert tone={bulkPreview.length ? 'info' : 'warning'}>{bulkPreview.length ? t('forecast.bulk.preview', { n: bulkPreview.length }) : t('forecast.bulk.none_in_range')}</Alert>
        </form>
      </Modal>
      {dialog}
    </div>
  );
};
