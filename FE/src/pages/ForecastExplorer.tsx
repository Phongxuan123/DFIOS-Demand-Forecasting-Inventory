import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  Box,
  Cpu,
  Download,
  Pencil,
  ShieldCheck,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChartFrame,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Skeleton,
  Table,
  Tabs,
  useChartTheme,
  useConfirm,
  usePagination,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { can } from '../auth/permissions.ts';
import { ForecastWindowPanel } from '../components/inventory/ForecastWindowView.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useClock } from '../context/ClockContext.tsx';
import { useStore } from '../context/StoreContext.tsx';
import { useApi } from '../hooks/useApi.ts';
import { downloadCsv } from '../utils/csv.ts';
import { useFormat, useT, type TKey } from '../i18n/index.tsx';
import { apiErrorMessage } from '../services/apiClient.ts';
import {
  bulkOverride,
  createOverride,
  getExplanation,
  getForecasts,
  getHistory,
  getWindowQuantiles,
  listOverrides,
  listProducts,
  revertOverride,
  type ForecastRow,
  type OverrideRow,
  type ProductRow,
} from '../services/forecastApi.ts';
import { getDemandTrend } from '../services/dashboardApi.ts';
import { getForecastAccuracy, type AccuracyMetric } from '../services/reportsApi.ts';
import { FutureForecastPanel } from './forecast/FutureForecastPanel.tsx';
import './ForecastExplorer.css';

type MainTab = 'overview' | 'sku' | 'window' | 'schedule' | 'future';
type RowQuality = 'ok' | 'crossing' | 'missing';

const DEPARTMENTS = ['FOODS_1', 'FOODS_2', 'HOBBIES_1', 'HOUSEHOLD_1', 'HOUSEHOLD_2'] as const;
const CATEGORIES = ['FOODS', 'HOBBIES', 'HOUSEHOLD'] as const;
type OverviewScope = 'ALL' | (typeof CATEGORIES)[number];
const ABC_CLASSES = ['A', 'B', 'C'] as const;
const EPS = 1e-9;
const DAY_MS = 86_400_000;
const GLOBAL_STORE = /^(GLOBAL|ALL)$/i;
const OVERRIDE_REASONS = ['promo', 'season', 'supply', 'other'] as const;
type OverrideReasonKey = (typeof OVERRIDE_REASONS)[number];

interface ProcessedRow extends ForecastRow {
  quality: RowQuality;
  modelValue: number;
}

interface AccuracyRow {
  key: string;
  label: string;
  m: AccuracyMetric;
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
  if (r.p10 - EPS > r.p50 || r.p50 - EPS > r.p90) return 'crossing';
  return 'ok';
}

function shiftIso(dateIso: string, days: number): string {
  const d = new Date(dateIso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' };

const ForecastTooltip: React.FC<{ active?: boolean; payload?: ReadonlyArray<{ payload: ChartPoint }> }> = ({ active, payload }) => {
  const t = useT();
  const fmt = useFormat();
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  const r = p.row;
  const line = (label: string, v: number | null | undefined) => (
    <div className="ui-chart-tooltip__row" key={label}>
      <span>{label}</span>
      <span className="ui-chart-tooltip__value">{v !== null && v !== undefined && Number.isFinite(v) ? fmt.number(v, { digits: 0 }) : '—'}</span>
    </div>
  );
  return (
    <div className="ui-chart-tooltip">
      <div className="ui-chart-tooltip__title">{fmt.date(p.date, 'medium')}</div>
      {p.actual !== null && line(t('forecast.chart.actual'), p.actual)}
      {p.forecast !== null && line(t('forecast.chart.forecast'), p.forecast)}
      {p.band ? (
        <>
          {line(t('forecast.chart.tooltip_p10'), p.band[0])}
          {line(t('forecast.chart.tooltip_p90'), p.band[1])}
        </>
      ) : p.forecast !== null ? (
        <>
          {line(t('forecast.chart.tooltip_p10'), null)}
          {line(t('forecast.chart.tooltip_p90'), null)}
        </>
      ) : null}
      {p.adjusted !== null && line(t('forecast.chart.adjusted'), p.adjusted)}
      {r && line(t('forecast.chart.tooltip_step'), r.h)}
    </div>
  );
};

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
      <ChartFrame title={title} source={source} height={260} empty={data.length === 0}>
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
        <Table columns={columns} rows={data} rowKey={(d) => d.tau} dense maxHeight={260} />
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

  const canEdit = can(user?.role, 'forecast:write');
  const sku = searchParams.get('sku') ?? '';
  const isGlobal = !!storeId && GLOBAL_STORE.test(storeId);
  const store = storeId && !isGlobal ? storeId : 'CA_1';

  const [mainTab, setMainTab] = useState<MainTab>(() => {
    const p = searchParams.get('tab');
    return p === 'sku' || p === 'window' || p === 'schedule' || p === 'future' ? p : 'overview';
  });
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  /** Overview scope: whole store or one M5 category (the filter GET /dashboard/demand-trend supports). */
  const [overviewCat, setOverviewCat] = useState<OverviewScope>('ALL');
  const [rangeDays, setRangeDays] = useState<30 | 60 | 90>(30);
  const [showBand, setShowBand] = useState<boolean>(true);

  const [horizon] = useState<number>(28);
  const [query, setQuery] = useState('');
  const schedulePage = usePagination(14);

  const setSku = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('sku', id);
    setSearchParams(next, { replace: true });
  };

  const products = useApi(
    (signal) => listProducts({ page: 1, page_size: 100, q: query, dept_id: selectedDept !== 'ALL' ? selectedDept : undefined }, signal),
    [query, selectedDept],
  );

  const filteredProducts = useMemo(() => {
    const list = products.data?.items ?? [];
    if (selectedDept === 'ALL') return list;
    return list.filter((p) => p.dept_id === selectedDept || p.item_id.startsWith(selectedDept));
  }, [products.data, selectedDept]);

  useEffect(() => {
    if (filteredProducts.length > 0) {
      const exists = filteredProducts.some((p) => p.item_id === sku);
      if (!exists) {
        setSku(filteredProducts[0].item_id);
      }
    }
  }, [sku, filteredProducts]);

  const selectedProduct: ProductRow | undefined = (products.data?.items ?? []).find((p) => p.item_id === sku);

  const ready = !!sku && !!store;
  const forecasts = useApi((signal) => getForecasts(sku, store as string, horizon, signal), [sku, store, horizon, clock.version], { enabled: ready });

  const processed = useMemo(() => {
    const raw = forecasts.data?.items ?? [];
    const versions = forecasts.data?.available_versions?.length ? forecasts.data.available_versions : Array.from(new Set(raw.map((r) => r.model_version)));
    const chosen = forecasts.data?.model_version ?? versions[0];
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
  const historyStart = firstDate ? shiftIso(firstDate, -rangeDays) : undefined;
  const history = useApi((signal) => getHistory(sku, store as string, historyStart, signal), [sku, store, historyStart, clock.version], {
    enabled: ready && rows.length > 0,
  });
  const explanation = useApi((signal) => getExplanation(sku, store as string, signal), [sku, store, clock.version], { enabled: ready && canEdit && mainTab === 'sku' });
  const windowQ = useApi((signal) => getWindowQuantiles(sku, store as string, signal), [sku, store, clock.version], { enabled: ready && mainTab === 'sku' });
  const overrides = useApi((signal) => listOverrides(sku, store as string, signal), [sku, store, clock.version], { enabled: ready });

  const refreshAll = () => {
    forecasts.refetch();
    overrides.refetch();
  };

  const historyPoints = useMemo(() => history.data?.history ?? [], [history.data]);
  const actualByDate = useMemo(() => new Map(historyPoints.map((h) => [h.date, h.quantity])), [historyPoints]);

  const chartData = useMemo<ChartPoint[]>(() => {
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
    const sorted = Array.from(m.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (sorted.length < 2) return sorted;
    const t0 = Date.parse(`${sorted[0].date}T00:00:00Z`);
    const t1 = Date.parse(`${sorted[sorted.length - 1].date}T00:00:00Z`);
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || (t1 - t0) / DAY_MS > 800) return sorted;
    for (let t = t0; t <= t1; t += DAY_MS) get(new Date(t).toISOString().slice(0, 10));
    return Array.from(m.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [historyPoints, rows]);

  // Overview: store / category demand, actual vs forecast, bounded by the simulated clock (GET /dashboard/demand-trend)
  const trend = useApi(
    (signal) => getDemandTrend(store, rangeDays, signal, overviewCat === 'ALL' ? undefined : overviewCat),
    [store, rangeDays, overviewCat, clock.version],
    { enabled: mainTab === 'overview' && !isGlobal },
  );
  const trendChartData = useMemo<ChartPoint[]>(
    () => (trend.data?.data ?? []).map((p) => ({ date: p.date, actual: p.actual, forecast: p.predicted, band: null, adjusted: null, row: null })),
    [trend.data],
  );
  const trendActualTotal = useMemo(() => {
    const withActual = trendChartData.filter((p) => p.actual !== null && Number.isFinite(p.actual));
    if (!withActual.length) return null;
    const total = withActual.reduce((s, p) => s + (p.actual as number), 0);
    return { total, days: withActual.length, last: withActual[withActual.length - 1].date };
  }, [trendChartData]);

  // Store-level accuracy (MAE / RMSE / MASE / WRMSSE overall and per ABC class) from the reports API
  const accuracy = useApi((signal) => getForecastAccuracy(store, signal), [store, clock.version], { enabled: !isGlobal });

  const clockDate = clock.status === 'ready' && clock.clock ? clock.clock.current_date.slice(0, 10) : null;
  /** h = 1 of the SKU forecast shown (its first forecast date), not a fixed date. */
  const cutoverDate = firstDate ?? null;

  const hasAnyBand = useMemo(() => rows.some((r) => r.p10 !== null && r.p90 !== null), [rows]);
  /** Half-width of the P10-P90 band relative to P50 over the forecast days with a full band: Σ(P90 − P10) / 2 / ΣP50
   *  (a ratio of sums, so slow movers with a tiny P50 on some days do not blow it up). */
  const relativeBand = useMemo(() => {
    const ok = rows.filter((r) => r.quality === 'ok');
    const sumP50 = ok.reduce((s, r) => s + (r.p50 as number), 0);
    if (!ok.length || !(sumP50 > 0)) return null;
    const halfWidth = ok.reduce((s, r) => s + ((r.p90 as number) - (r.p10 as number)) / 2, 0);
    return { mean: halfWidth / sumP50, n: ok.length };
  }, [rows]);

  const totalDemand = rows.length ? rows.reduce((s, r) => s + r.y_pred, 0) : null;
  const isStatsModel = (v: string | undefined) => !!v && /sba/i.test(v);
  const modelLabel = (v: string | undefined) => (!v ? '' : isStatsModel(v) ? t('forecast.model.sba') : v);
  const overallWrmsse = accuracy.data?.overall_metrics?.wrmsse ?? null;

  const exportCsv = () => {
    if (!rows.length) {
      toast.warning(t('forecast.ctl.export_none'));
      return;
    }
    const filename = `forecast_${mainTab}_${selectedDept}_${store}_28d.csv`;
    downloadCsv(
      filename,
      ['SKU', 'Store', 'Date', 'h', 'P10', 'P50', 'P90', 'y_pred', 'original_value', 'is_overridden', 'actual', 'model_version'],
      rows.map((r) => [sku, store, r.forecast_date, r.h, r.p10, r.p50, r.p90, r.y_pred, r.original_value, r.is_overridden, actualByDate.get(r.forecast_date), r.model_version]),
    );
    toast.success(t('forecast.ctl.export_done', { n: rows.length, file: filename }));
  };

  const accuracyRows = useMemo<AccuracyRow[]>(() => {
    const a = accuracy.data;
    if (!a) return [];
    const out: AccuracyRow[] = [{ key: 'ALL', label: t('forecast.explorer.acc_overall'), m: a.overall_metrics }];
    for (const c of ABC_CLASSES) if (a.abc_breakdown?.[c]) out.push({ key: c, label: c, m: a.abc_breakdown[c] });
    return out;
  }, [accuracy.data, t]);

  const exportDiagnosticsCsv = () => {
    if (!accuracyRows.length) {
      toast.warning(t('forecast.ctl.export_none'));
      return;
    }
    const filename = `diagnostics_accuracy_${store}.csv`;
    downloadCsv(
      filename,
      ['Group', 'MAE', 'RMSE', 'MASE', 'WRMSSE', 'Samples', 'Model', 'Period'],
      accuracyRows.map((r) => [r.key, r.m.mae, r.m.rmse, r.m.mase, r.m.wrmsse, r.m.sample_count, accuracy.data?.model_name, accuracy.data?.evaluated_period]),
    );
    toast.success(t('forecast.ctl.export_done', { n: accuracyRows.length, file: filename }));
  };

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
      description: t('forecast.history.revert_description', { date: fmt.date(o.forecast_date), value: fmt.number(o.override_value, { digits: 2 }) }),
      confirmLabel: t('forecast.history.revert'),
      tone: 'danger',
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

  const qCell = (v: number | null) => (v === null ? '—' : <span className="ui-num">{fmt.number(v, { digits: 2 })}</span>);
  const scheduleColumns: Column<ProcessedRow>[] = [
    { key: 'h', header: t('forecast.schedule.col_h'), align: 'right', value: (r) => r.h },
    { key: 'date', header: t('forecast.schedule.col_date'), sortable: true, value: (r) => r.forecast_date, cell: (r) => fmt.date(r.forecast_date) },
    { key: 'actual', header: t('forecast.schedule.col_actual'), align: 'right', value: (r) => actualByDate.get(r.forecast_date) ?? null, cell: (r) => qCell(actualByDate.get(r.forecast_date) ?? null) },
    { key: 'p10', header: t('forecast.schedule.col_p10'), align: 'right', value: (r) => r.p10, cell: (r) => qCell(r.p10) },
    { key: 'p50', header: t('forecast.schedule.col_p50'), align: 'right', value: (r) => r.p50, cell: (r) => qCell(r.p50) },
    { key: 'p90', header: t('forecast.schedule.col_p90'), align: 'right', value: (r) => r.p90, cell: (r) => qCell(r.p90) },
    {
      key: 'yhat',
      header: t('forecast.schedule.col_pred'),
      align: 'right',
      value: (r) => r.y_pred,
      cell: (r) => (
        <span className="ui-num" style={{ fontWeight: r.is_overridden ? 'var(--weight-semibold)' : 'inherit', color: r.is_overridden ? 'var(--color-accent)' : 'inherit' }}>
          {fmt.number(r.y_pred, { digits: 2 })}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('forecast.schedule.col_status'),
      cell: (r) => (
        <div style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center' }}>
          {r.is_overridden && <Badge tone="accent">{t('forecast.schedule.status_overridden')}</Badge>}
          {r.quality === 'crossing' && <Badge tone="warning">{t('forecast.schedule.status_dq')}</Badge>}
          {r.quality === 'missing' && <Badge tone="neutral">{t('forecast.schedule.status_missing')}</Badge>}
          {!r.is_overridden && r.quality === 'ok' && <Badge tone="neutral">{t('forecast.schedule.status_ok')}</Badge>}
        </div>
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

  // Only the server's SHAP values: no invented fallback when the explanation is missing
  const activeFeatures = useMemo(() => explanation.data?.features ?? [], [explanation.data]);

  const maxShap = Math.max(...activeFeatures.map((f) => Math.abs(f.importance_score)), 0) || 1;

  if (isGlobal) return <EmptyState title={t('forecast.global.title')} description={t('forecast.global.description')} />;

  const metricCell = (v: number | null | undefined, digits: number) => (
    <span style={mono}>{v !== null && v !== undefined && Number.isFinite(v) ? fmt.number(v, { digits }) : '—'}</span>
  );
  const accuracyColumns: Column<AccuracyRow>[] = [
    {
      key: 'group',
      header: t('forecast.explorer.acc_col_group'),
      cell: (r) => <span style={{ fontWeight: r.key === 'ALL' ? 'var(--weight-semibold)' : 'var(--weight-medium)' }}>{r.label}</span>,
    },
    { key: 'mae', header: 'MAE', align: 'right', value: (r) => r.m.mae, cell: (r) => metricCell(r.m.mae, 3) },
    { key: 'rmse', header: 'RMSE', align: 'right', value: (r) => r.m.rmse, cell: (r) => metricCell(r.m.rmse, 3) },
    { key: 'mase', header: 'MASE', align: 'right', value: (r) => r.m.mase, cell: (r) => metricCell(r.m.mase, 3) },
    { key: 'wrmsse', header: t('forecast.explorer.acc_col_wrmsse'), align: 'right', value: (r) => r.m.wrmsse, cell: (r) => metricCell(r.m.wrmsse, 4) },
    { key: 'n', header: t('forecast.explorer.acc_col_n'), align: 'right', value: (r) => r.m.sample_count, cell: (r) => <span style={mono}>{fmt.integer(r.m.sample_count)}</span> },
  ];

  return (
    <div className="fe-container">
      <PageHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {t('forecast.explorer.title')}
            <Badge tone="success">{t('forecast.explorer.badge_validated')}</Badge>
          </span>
        }
        description={t('forecast.explorer.description')}
        actions={
          <Button size="sm" variant="secondary" leftIcon={<Download size={14} />} onClick={exportCsv}>
            {t('forecast.ctl.export')}
          </Button>
        }
      />

      <div className="fe-kpi-grid">
        <div className="fe-kpi-card">
          <div className="fe-kpi-head">
            <span className="fe-kpi-label">
              <span className="fe-kpi-icon-wrap fe-kpi-icon-wrap--indigo">
                <Box size={15} />
              </span>
              {mainTab === 'overview'
                ? t('forecast.explorer.kpi_actual_title', { days: rangeDays })
                : t('forecast.explorer.kpi_demand_title', { days: rows.length || horizon })}
            </span>
          </div>
          <div className="fe-kpi-body">
            <span className="fe-kpi-val">
              {mainTab === 'overview'
                ? trendActualTotal ? fmt.number(trendActualTotal.total, { digits: 0 }) : '—'
                : totalDemand !== null ? fmt.number(totalDemand, { digits: 0 }) : '—'}
            </span>
            <span className="fe-num-sub">{t('forecast.explorer.kpi_demand_unit')}</span>
          </div>
          <div className="fe-kpi-meta">
            <span>
              {mainTab === 'overview'
                ? trendActualTotal
                  ? t('forecast.explorer.kpi_actual_sub', {
                      avg: fmt.number(trendActualTotal.total / trendActualTotal.days, { digits: 1 }),
                      date: trendActualTotal.last ? fmt.date(trendActualTotal.last) : '—',
                    })
                  : '—'
                : totalDemand !== null && rows.length
                  ? t('forecast.explorer.kpi_demand_sub', { avg: fmt.number(totalDemand / rows.length, { digits: 1 }), sku })
                  : '—'}
            </span>
          </div>
        </div>

        <div className="fe-kpi-card">
          <div className="fe-kpi-head">
            <span className="fe-kpi-label">
              <span className="fe-kpi-icon-wrap fe-kpi-icon-wrap--sky">
                <Cpu size={15} />
              </span>
              {t('forecast.explorer.kpi_model_title')}
            </span>
          </div>
          <div className="fe-kpi-body">
            <span className="fe-kpi-val" style={{ fontSize: 'var(--text-lg)' }}>
              {mainTab === 'overview' ? accuracy.data?.model_name || '—' : modelLabel(processed.version) || '—'}
            </span>
          </div>
          <div className="fe-kpi-meta">
            <span>
              {mainTab === 'overview' ? t('forecast.explorer.kpi_model_sub_store', { store }) : t('forecast.explorer.kpi_model_sub_sku', { sku })}
            </span>
          </div>
        </div>

        <div className="fe-kpi-card">
          <div className="fe-kpi-head">
            <span className="fe-kpi-label">
              <span className="fe-kpi-icon-wrap fe-kpi-icon-wrap--emerald">
                <ShieldCheck size={15} />
              </span>
              {t('forecast.explorer.kpi_acc_title')}
            </span>
          </div>
          <div className="fe-kpi-body">
            <span className="fe-kpi-val fe-kpi-val--emerald">
              {accuracy.loading && !accuracy.data ? '…' : overallWrmsse !== null ? fmt.number(overallWrmsse, { digits: 4 }) : '—'}
            </span>
            <span className="fe-num-sub">WRMSSE</span>
          </div>
          <div className="fe-kpi-meta">
            <span>
              {accuracy.data
                ? t('forecast.explorer.kpi_acc_footer', { store, period: accuracy.data.evaluated_period || '—' })
                : accuracy.error
                  ? t('forecast.explorer.acc_unavailable')
                  : '—'}
            </span>
          </div>
        </div>

        <div className="fe-kpi-card">
          <div className="fe-kpi-head">
            <span className="fe-kpi-label">
              <span className="fe-kpi-icon-wrap fe-kpi-icon-wrap--rose">
                <Activity size={15} />
              </span>
              {t('forecast.explorer.kpi_unc_title')}
            </span>
          </div>
          <div className="fe-kpi-body">
            <span className="fe-kpi-val">{relativeBand ? `±${fmt.number(relativeBand.mean * 100, { digits: 1 })}%` : '—'}</span>
            <span className="fe-num-sub">P10 – P90</span>
          </div>
          <div className="fe-kpi-meta">
            <span>
              {relativeBand
                ? t('forecast.explorer.kpi_unc_sub', { sku, n: relativeBand.n })
                : t('forecast.explorer.kpi_unc_none', { sku: sku || '—' })}
            </span>
          </div>
        </div>
      </div>

      <div className="fe-main-card">
        <div style={{ padding: 'var(--space-3) var(--space-4) 0' }}>
          <Tabs
            aria-label={t('forecast.page.title')}
            value={mainTab}
            onChange={(id) => setMainTab(id as MainTab)}
            items={[
              { id: 'overview', label: t('forecast.explorer.tab_overview') },
              { id: 'sku', label: t('forecast.explorer.tab_sku') },
              { id: 'window', label: t('inventory.window.tab') },
              { id: 'schedule', label: t('forecast.explorer.tab_schedule'), count: overrides.data?.filter((o) => o.is_active).length },
              { id: 'future', label: t('forecast.future.tab') },
            ]}
          />
        </div>

        {mainTab === 'overview' && (
          <>
            <div className="fe-filters">
              <Select<OverviewScope>
                aria-label={t('forecast.explorer.scope_label')}
                value={overviewCat}
                onChange={setOverviewCat}
                options={[
                  { value: 'ALL', label: t('forecast.explorer.scope_all', { store }) },
                  ...CATEGORIES.map((c) => ({ value: c, label: t('forecast.explorer.scope_cat', { cat: c }) })),
                ]}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {([30, 60, 90] as const).map((d) => (
                  <Button key={d} size="sm" variant={rangeDays === d ? 'primary' : 'secondary'} onClick={() => setRangeDays(d)}>
                    {t(`forecast.explorer.chart_range_${d}d` as TKey)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="fe-chart-container">
              <div className="fe-chart-header">
                <div>
                  <div className="fe-chart-title">{t('forecast.explorer.chart_title_overview', { days: rangeDays })}</div>
                  <div className="fe-chart-subtitle">
                    {overviewCat === 'ALL'
                      ? t('forecast.explorer.chart_scope_store', { store })
                      : t('forecast.explorer.chart_scope_cat', { cat: overviewCat, store })}
                  </div>
                </div>
                <div className="fe-chart-legend">
                  <div className="fe-legend-item">
                    <span className="fe-legend-dot fe-legend-dot--actual" />
                    <span>{t('forecast.explorer.legend_actual')}</span>
                  </div>
                  <div className="fe-legend-item">
                    <span className="fe-legend-dot fe-legend-dot--forecast" />
                    <span>{t('forecast.explorer.legend_forecast')}</span>
                  </div>
                </div>
              </div>

              <div style={{ height: 380, width: '100%' }}>
                {trend.error ? (
                  <ErrorState error={trend.error} onRetry={trend.refetch} />
                ) : trend.loading && !trend.data ? (
                  <Skeleton height={360} />
                ) : trendChartData.length === 0 ? (
                  <EmptyState compact title={t('forecast.explorer.trend_empty')} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trendChartData} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
                      <CartesianGrid vertical={false} stroke={chart.grid} />
                      <XAxis dataKey="date" {...chart.axis} minTickGap={28} tickFormatter={(d: string) => fmt.date(d, 'axis')} />
                      <YAxis {...chart.axis} width={48} domain={[0, 'auto']} />
                      <Tooltip cursor={chart.cursor} content={<ForecastTooltip />} />
                      {clockDate && (
                        <ReferenceLine
                          x={clockDate}
                          stroke="var(--color-text)"
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                          label={{ value: t('forecast.explorer.clock_label', { date: fmt.date(clockDate) }), fill: 'var(--color-text)', fontSize: 11, position: 'insideTopLeft' }}
                        />
                      )}
                      <Line dataKey="actual" name={t('forecast.chart.actual')} stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
                      <Line
                        dataKey="forecast"
                        name={t('forecast.chart.forecast')}
                        stroke="#f59e0b"
                        strokeWidth={2.5}
                        strokeDasharray="5 3"
                        dot={{ r: 2 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                <span>{trend.data?.forecast_note || t('forecast.explorer.trend_footer')}</span>
              </div>
            </div>

            <Card
              title={t('forecast.explorer.acc_breakdown_title')}
              description={
                accuracy.data
                  ? t('forecast.explorer.acc_breakdown_desc', { store, model: accuracy.data.model_name, period: accuracy.data.evaluated_period || '—' })
                  : undefined
              }
              actions={
                <Button size="sm" variant="secondary" leftIcon={<Download size={14} />} onClick={exportDiagnosticsCsv} disabled={!accuracyRows.length}>
                  {t('forecast.explorer.download_diagnostics')}
                </Button>
              }
            >
              {accuracy.error ? (
                <ErrorState compact error={accuracy.error} onRetry={accuracy.refetch} />
              ) : (
                <Table
                  columns={accuracyColumns}
                  rows={accuracyRows}
                  rowKey={(r) => r.key}
                  dense
                  loading={accuracy.loading && !accuracy.data}
                  emptyTitle={t('forecast.explorer.acc_empty')}
                  emptyDescription={accuracy.data?.metrics_reason ?? undefined}
                />
              )}
            </Card>
          </>
        )}

        {mainTab === 'sku' && (
          <>
            <div className="fe-filters">
              <SearchInput value={query} onChange={setQuery} placeholder={t('forecast.sku.search_placeholder')} />

              <Select
                aria-label={t('forecast.explorer.dept_filter')}
                value={selectedDept === 'ALL' ? 'FOODS_1' : selectedDept}
                onChange={(v) => {
                  setSelectedDept(v);
                  setSku(`${v}_001`);
                }}
                options={DEPARTMENTS.map((d) => ({ value: d, label: t('forecast.explorer.dept_option', { dept: d }) }))}
              />

              <div className="fe-sku-select">
                <Select
                  aria-label={t('forecast.explorer.sku_select_label')}
                  value={sku}
                  onChange={(v) => setSku(v)}
                  options={filteredProducts.map((p) => ({
                    value: p.item_id,
                    label: p.name && p.name !== p.item_id ? `${p.item_id} — ${p.name.slice(0, 26)}` : p.item_id,
                  }))}
                />
              </div>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', cursor: 'pointer', marginLeft: 'auto' }}>
                <input type="checkbox" checked={showBand} onChange={(e) => setShowBand(e.target.checked)} />
                <span>{t('forecast.explorer.chart_show_band')}</span>
              </label>
            </div>

            <div className="fe-sku-banner">
              <div>
                <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                  {t('forecast.explorer.sku_deep_dive_title', {
                    name: selectedProduct?.name && selectedProduct.name !== selectedProduct.item_id ? `${selectedProduct.name} (${selectedProduct.item_id})` : sku,
                  })}
                </span>
                <span style={{ marginLeft: 12, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {t('forecast.explorer.sku_dept_cat', {
                    dept: selectedProduct?.dept_id || selectedDept,
                    cat: selectedProduct?.cat_id || (selectedDept !== 'ALL' ? selectedDept.split('_')[0] : 'FOODS'),
                  })}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Badge tone="neutral">{t('forecast.explorer.sku_badge', { sku })}</Badge>
                <Badge tone="accent">{t('forecast.explorer.store_badge', { store })}</Badge>
              </div>
            </div>

            <div className="fe-chart-container">
              <div className="fe-chart-header">
                <div>
                  <div className="fe-chart-title">{t('forecast.explorer.chart_title_sku', { days: rangeDays, h: rows.length || horizon })}</div>
                  <div className="fe-chart-subtitle">
                    {t('forecast.explorer.chart_scope_sku', {
                      sku: selectedProduct?.name && selectedProduct.name !== selectedProduct.item_id ? `${selectedProduct.name} (${sku})` : sku,
                      store,
                    })}
                  </div>
                </div>
                <div className="fe-chart-legend">
                  <div className="fe-legend-item">
                    <span className="fe-legend-dot fe-legend-dot--actual" />
                    <span>{t('forecast.explorer.legend_actual')}</span>
                  </div>
                  <div className="fe-legend-item">
                    <span className="fe-legend-dot fe-legend-dot--forecast" />
                    <span>{t('forecast.explorer.legend_forecast')}</span>
                  </div>
                  {showBand && (
                    <div className="fe-legend-item">
                      <span className="fe-legend-dot fe-legend-dot--band" />
                      <span>{t('forecast.explorer.legend_band')}</span>
                    </div>
                  )}
                  {!hasAnyBand && rows.length > 0 && (
                    <div className="fe-legend-item" style={{ fontStyle: 'italic', color: 'var(--color-text-muted)' }}>
                      <span>({t('forecast.explorer.no_band_for_sku')})</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ height: 340, width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid vertical={false} stroke={chart.grid} />
                    <XAxis dataKey="date" {...chart.axis} minTickGap={28} tickFormatter={(d: string) => fmt.date(d, 'axis')} />
                    <YAxis {...chart.axis} width={44} domain={[0, 'auto']} />
                    <Tooltip cursor={chart.cursor} content={<ForecastTooltip />} />

                    {cutoverDate && (
                      <ReferenceLine
                        x={cutoverDate}
                        stroke="var(--color-text)"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        label={{
                          value: t('forecast.explorer.cutover_label', { date: fmt.date(cutoverDate) }),
                          fill: 'var(--color-text)',
                          fontSize: 11,
                          position: 'insideTopLeft',
                        }}
                      />
                    )}

                    {showBand && (
                      <Area
                        dataKey="band"
                        name={t('forecast.chart.band')}
                        stroke="none"
                        fill="#6366f1"
                        fillOpacity={0.14}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                    )}
                    <Line
                      dataKey="actual"
                      name={t('forecast.chart.actual')}
                      stroke="#4f46e5"
                      strokeWidth={2.5}
                      dot={{ r: 2 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="forecast"
                      name={t('forecast.chart.forecast')}
                      stroke="#f59e0b"
                      strokeWidth={2.5}
                      strokeDasharray="5 3"
                      dot={{ r: 2 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="adjusted"
                      name={t('forecast.chart.adjusted')}
                      stroke="none"
                      dot={{ r: 5, fill: chart.series[2], stroke: chart.surface, strokeWidth: 1 }}
                      activeDot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="fe-sku-two-col">
              <Card
                title={t('forecast.shap.title')}
                description={t('forecast.shap.description')}
                actions={explanation.data?.model_name ? <Badge tone="neutral">{explanation.data.model_name}</Badge> : undefined}
              >
                {!canEdit ? (
                  <Alert tone="info">{t('forecast.shap.restricted')}</Alert>
                ) : explanation.loading && !explanation.data ? (
                  <Skeleton height={140} />
                ) : explanation.error ? (
                  <ErrorState compact error={explanation.error} onRetry={explanation.refetch} />
                ) : activeFeatures.length === 0 ? (
                  <EmptyState compact title={t('forecast.explorer.shap_empty')} />
                ) : (
                  <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                    <div style={muted}>
                      {t('forecast.shap.model', { name: explanation.data?.model_name || '—', version: explanation.data?.model_version || '—' })} · {t('forecast.shap.base')}:{' '}
                      <span className="ui-num">{typeof explanation.data?.base_value === 'number' ? fmt.number(explanation.data.base_value, { digits: 2 }) : '—'}</span>
                    </div>
                    {activeFeatures.slice(0, 6).map((f) => (
                      <div key={f.feature_name} style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', fontSize: 'var(--text-xs)' }}>
                          <span style={mono}>
                            {f.feature_name}{' '}
                            {f.direction && (
                              <Badge tone={/pos/i.test(f.direction) ? 'success' : 'warning'}>
                                {/pos/i.test(f.direction) ? t('forecast.shap.direction_positive') : t('forecast.shap.direction_negative')}
                              </Badge>
                            )}
                          </span>
                          <span className="ui-num">{fmt.number(f.importance_score, { digits: 3 })}</span>
                        </div>
                        <div className="fe-bar-wrap">
                          <div
                            className="fe-bar-fill"
                            style={{
                              width: `${Math.min(100, Math.round((Math.abs(f.importance_score) / maxShap) * 100))}%`,
                              background: f.importance_score >= 0 ? '#4f46e5' : '#f59e0b',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card title={t('forecast.route.title')} description={t('forecast.route.description')}>
                {windowQ.loading && !windowQ.data ? (
                  <Skeleton height={200} />
                ) : windowQ.error ? (
                  <ErrorState compact error={windowQ.error} onRetry={windowQ.refetch} />
                ) : !windowQ.data ? (
                  <EmptyState compact title={t('forecast.route.empty')} />
                ) : (
                  <QuantileChart
                    levels={windowQ.data.q_levels}
                    title={t('forecast.route.q_chart')}
                    source={t('forecast.route.source')}
                    xLabel={t('forecast.route.level')}
                    yLabel={t('forecast.route.value')}
                  />
                )}
              </Card>
            </div>
          </>
        )}

        {mainTab === 'future' && (
          <div style={{ padding: 'var(--space-4)' }}>
            <FutureForecastPanel sku={sku} store={store} />
          </div>
        )}

        {mainTab === 'window' && (
          <div style={{ padding: 'var(--space-4)' }}>
            <ForecastWindowPanel sku={sku} store={store} />
          </div>
        )}

        {mainTab === 'schedule' && (
          <div style={{ padding: 'var(--space-4)' }}>
            <Card
              title={t('forecast.schedule.title')}
              description={t('forecast.schedule.description')}
              actions={
                canEdit ? (
                  <Button size="sm" variant="secondary" onClick={openBulk}>
                    {t('forecast.schedule.bulk')}
                  </Button>
                ) : null
              }
            >
              <Table
                columns={scheduleColumns}
                rows={rows}
                rowKey={(r) => r.h}
                pagination={{
                  page: schedulePage.page,
                  pageSize: schedulePage.pageSize,
                  total: rows.length,
                  onPageChange: schedulePage.setPage,
                  onPageSizeChange: schedulePage.setPageSize,
                }}
              />

              {(overrides.data?.length ?? 0) > 0 && (
                <div style={{ marginTop: 'var(--space-5)' }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-2)' }}>
                    {t('forecast.history.title')}
                  </div>
                  <Table columns={overrideColumns} rows={overrides.data ?? []} rowKey={(o) => o.id} dense />
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {ovRow && (
        <Modal
          open={!!ovRow}
          onClose={() => setOvRow(null)}
          title={t('forecast.override.title', { h: ovRow.h, date: fmt.date(ovRow.forecast_date) })}
          description={t('forecast.override.description', { sku })}
          footer={
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setOvRow(null)}>
                {t('common.actions.cancel')}
              </Button>
              <Button loading={ovBusy} onClick={submitOverride}>
                {t('common.actions.save')}
              </Button>
            </div>
          }
        >
          <form onSubmit={submitOverride} style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {ovError && <Alert tone="danger">{ovError}</Alert>}
            <Field label={t('forecast.override.value')}>
              <Input type="number" step="any" min={0} value={ovValue} onChange={(e) => setOvValue(e.target.value)} required />
            </Field>
            <Field label={t('forecast.override.reason')}>
              <Select
                value={ovReason}
                onChange={(v) => setOvReason(v as OverrideReasonKey)}
                options={OVERRIDE_REASONS.map((k) => ({ value: k, label: t(`forecast.override.reason_${k}` as TKey) }))}
              />
            </Field>
            {ovReason === 'other' && (
              <Field label={t('forecast.override.notes')}>
                <Input value={ovNotes} onChange={(e) => setOvNotes(e.target.value)} placeholder={t('forecast.override.notes')} required />
              </Field>
            )}
          </form>
        </Modal>
      )}

      {bulkOpen && (
        <Modal
          open={bulkOpen}
          onClose={() => setBulkOpen(false)}
          title={t('forecast.bulk.title')}
          description={t('forecast.bulk.description', { sku })}
          footer={
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setBulkOpen(false)}>
                {t('common.actions.cancel')}
              </Button>
              <Button loading={bulkBusy} onClick={submitBulk} disabled={!bulkValid || bulkPreview.length === 0}>
                {t('forecast.bulk.submit', { n: bulkPreview.length })}
              </Button>
            </div>
          }
        >
          <form onSubmit={submitBulk} style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {bulkError && <Alert tone="danger">{bulkError}</Alert>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
              <Field label={t('forecast.bulk.mode')}>
                <Select
                  value={bulkMode}
                  onChange={(v) => setBulkMode(v as 'percent' | 'fixed')}
                  options={[
                    { value: 'percent', label: t('forecast.bulk.mode_percent') },
                    { value: 'fixed', label: t('forecast.bulk.mode_fixed') },
                  ]}
                />
              </Field>
              <Field label={bulkMode === 'percent' ? t('forecast.bulk.percent') : t('forecast.bulk.fixed')}>
                <Input
                  type="number"
                  step="any"
                  value={bulkValue}
                  onChange={(e) => setBulkValue(e.target.value)}
                  placeholder={bulkMode === 'percent' ? '+10, -5' : '100'}
                  required
                />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
              <Field label={t('forecast.bulk.from')}>
                <Input type="date" value={bulkFrom} onChange={(e) => setBulkFrom(e.target.value)} />
              </Field>
              <Field label={t('forecast.bulk.to')}>
                <Input type="date" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} />
              </Field>
            </div>
            <Field label={t('forecast.override.reason')}>
              <Select
                value={bulkReason}
                onChange={(v) => setBulkReason(v as OverrideReasonKey)}
                options={OVERRIDE_REASONS.map((k) => ({ value: k, label: t(`forecast.override.reason_${k}` as TKey) }))}
              />
            </Field>
            {bulkReason === 'other' && (
              <Field label={t('forecast.override.notes')}>
                <Input value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} placeholder={t('forecast.override.notes')} required />
              </Field>
            )}
            <div style={muted}>
              {t('forecast.bulk.preview', { n: bulkPreview.length })}
            </div>
          </form>
        </Modal>
      )}

      {dialog}
    </div>
  );
};
