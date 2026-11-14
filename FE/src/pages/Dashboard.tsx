import React, { useMemo, useState } from 'react';
import { Activity, Boxes, CircleDollarSign, ClipboardList, PackageX, Target } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  DataSourceNote,
  EmptyState,
  KpiTile,
  PageHeader,
  Section,
  Select,
  Table,
  Tabs,
  useChartTheme,
  useConfirm,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { useApi } from '../hooks/useApi.ts';
import { useClock } from '../context/ClockContext.tsx';
import { useStore } from '../context/StoreContext.tsx';
import { useFormat, useT } from '../i18n/index.tsx';
import { apiErrorMessage } from '../services/apiClient.ts';
import {
  getAlerts,
  getCalibrationHistory,
  getDemandTrend,
  getKpiShadowDashboard,
  getKpis,
  type AlertItem,
  type CalibrationState,
  type CostCurvePoint,
  type SegmentAvailability,
} from '../services/dashboardApi.ts';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** "WRMSSE 0.4935" -> 0.4935; anything else (e.g. "N/A") -> null. */
function parseWrmsse(text: string | undefined): number | null {
  if (!text) return null;
  const m = /WRMSSE\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i.exec(text);
  return m ? Number(m[1]) : null;
}

/* ------------------------------- Clock panel ------------------------------ */
const ClockPanel: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { concreteStoreId: storeId } = useStore();
  const { clock, status, reason, canAdvance, advancing, advance } = useClock();
  const { confirm, dialog } = useConfirm();
  const [days, setDays] = useState<number>(7);
  const [last, setLast] = useState<{ from: string; to: string; reviews: number; stockouts: number; recs: number } | null>(null);

  const onAdvance = async () => {
    const ok = await confirm({
      title: t('shell.clock.advance_title', { days }),
      description: t('shell.clock.advance_body', { store: storeId ?? '—' }),
      confirmLabel: t('dashboard.clock.advance'),
    });
    if (!ok) return;
    try {
      const res = await advance(days);
      setLast({
        from: res.previous_date,
        to: res.current_date,
        reviews: res.reviews_executed,
        stockouts: res.stockouts_recorded,
        recs: res.recommendations_generated,
      });
      toast.success(
        t('shell.clock.advanced', {
          from: fmt.date(res.previous_date),
          to: fmt.date(res.current_date),
          reviews: res.reviews_executed,
          recommendations: res.recommendations_generated,
        }),
      );
    } catch (err) {
      toast.error(t('shell.clock.advance_failed'), apiErrorMessage(err, t));
    }
  };

  let body: React.ReactNode;
  if (status === 'loading') {
    body = <p className="ui-muted">{t('shell.clock.loading')}</p>;
  } else if (status === 'unavailable' || !clock) {
    const key = `shell.clock.unavailable_${reason ?? 'error'}` as const;
    body = (
      <Alert tone="info">
        {t('dashboard.clock.unavailable', { reason: t(key as 'shell.clock.unavailable_error') })}
      </Alert>
    );
  } else {
    body = (
      <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div>
          <div className="ui-muted">{t('dashboard.clock.current')}</div>
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)' }} className="ui-num">
            {fmt.date(clock.current_date, 'long')}
          </div>
          <div className="ui-muted">
            {t('dashboard.clock.start')}: {fmt.date(clock.start_date)}. {t('dashboard.clock.elapsed', { days: fmt.integer(clock.days_elapsed), reviews: fmt.integer(clock.reviews_elapsed) })}
          </div>
        </div>
        <div>
          <div className="ui-muted">{t('dashboard.clock.last_advance')}</div>
          <div>
            {last
              ? t('dashboard.clock.last_advance_value', {
                  from: fmt.date(last.from),
                  to: fmt.date(last.to),
                  reviews: last.reviews,
                  stockouts: last.stockouts,
                  recs: last.recs,
                })
              : t('dashboard.clock.last_advance_none')}
          </div>
        </div>
        <div>
          {canAdvance ? (
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Select<number>
                label={t('dashboard.clock.days')}
                value={days}
                onChange={setDays}
                options={[1, 7, 14, 28].map((d) => ({ value: d, label: String(d) }))}
                disabled={advancing}
              />
              <Button variant="primary" loading={advancing} onClick={onAdvance}>
                {advancing ? t('shell.clock.advancing') : t('dashboard.clock.advance')}
              </Button>
            </div>
          ) : (
            <p className="ui-muted">{t('dashboard.clock.admin_only')}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card title={t('dashboard.clock.title')}>
      {body}
      {dialog}
    </Card>
  );
};

/* --------------------------------- Charts --------------------------------- */
const CostChart: React.FC<{ rows: CostCurvePoint[] }> = ({ rows }) => {
  const c = useChartTheme();
  const t = useT();
  const fmt = useFormat();
  const hasB0 = rows.some((r) => r.b0_total_cost !== null);
  return (
    <>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="cycle_index" {...c.axis} tickFormatter={(v: number) => String(v)} />
          <YAxis {...c.axis} width={56} tickFormatter={(v: number) => fmt.compact(v)} />
          <RTooltip
            content={<ChartTooltip formatLabel={(l) => t('dashboard.charts.review', { n: String(l) })} format={(v) => fmt.currency(v, { compact: true })} />}
            cursor={c.cursor}
          />
          <Line type="monotone" dataKey="c3out_total_cost" name={t('dashboard.charts.cost_c3')} stroke={c.series[0]} strokeWidth={2} dot={false} />
          {hasB0 && <Line type="monotone" dataKey="b0_total_cost" name={t('dashboard.charts.cost_b0')} stroke={c.series[1]} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls={false} />}
        </LineChart>
      </ResponsiveContainer>
    </>
  );
};

const ThetaChart: React.FC<{ rows: Array<Record<string, number | string>>; classes: string[] }> = ({ rows, classes }) => {
  const c = useChartTheme();
  const t = useT();
  const fmt = useFormat();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="review_index" {...c.axis} />
        <YAxis {...c.axis} width={44} tickFormatter={(v: number) => fmt.number(v, { digits: 2 })} />
        <RTooltip
          content={<ChartTooltip formatLabel={(l) => t('dashboard.charts.review', { n: String(l) })} format={(v) => fmt.number(v, { digits: 3 })} />}
          cursor={c.cursor}
        />
        {classes.map((cls, i) => (
          <Line key={cls} type="stepAfter" dataKey={cls} name={cls} stroke={c.series[i % c.series.length]} strokeWidth={2} dot={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

const SegmentChart: React.FC<{ rows: SegmentAvailability[] }> = ({ rows }) => {
  const c = useChartTheme();
  const t = useT();
  const fmt = useFormat();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="class_id" {...c.axis} />
        <YAxis {...c.axis} width={44} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
        <RTooltip content={<ChartTooltip format={(v) => fmt.percent(v, { scale: 'percent', digits: 1 })} />} cursor={false} />
        <Bar dataKey="c3out_availability" name={t('dashboard.charts.cost_c3')} fill={c.series[0]} radius={[3, 3, 0, 0]} />
        <Bar dataKey="b0_availability" name="B0" fill={c.series[1]} radius={[3, 3, 0, 0]} />
        <Bar dataKey="target" name={t('dashboard.charts.target')} fill={c.reference} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

const TrendChart: React.FC<{ rows: Array<{ date: string; actual: number | null; predicted: number | null }> }> = ({ rows }) => {
  const c = useChartTheme();
  const fmt = useFormat();
  const t = useT();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="date" {...c.axis} tickFormatter={(v: string) => fmt.date(v, 'short')} minTickGap={24} />
        <YAxis {...c.axis} width={48} tickFormatter={(v: number) => fmt.compact(v)} />
        <RTooltip content={<ChartTooltip formatLabel={(l) => fmt.date(String(l))} format={(v) => fmt.number(v, { digits: 0 })} />} cursor={c.cursor} />
        <Line type="monotone" dataKey="actual" name={t('dashboard.charts.actual')} stroke={c.series[0]} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="predicted" name={t('dashboard.charts.predicted')} stroke={c.series[1]} strokeWidth={2} strokeDasharray="5 3" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
};

/* ---------------------------------- Page ---------------------------------- */
export const Dashboard: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const { storeId, concreteStoreId, isGlobal } = useStore();
  const clock = useClock();
  const enabled = !!storeId;
  /** Panels that only exist per store use the real store; cost/availability and calibration accept GLOBAL. */
  const sid = concreteStoreId ?? '';
  const scope = storeId ?? '';
  const version = clock.version;

  const kpis = useApi((s) => getKpis(sid, s), [sid, version], { enabled });
  const shadow = useApi((s) => getKpiShadowDashboard(scope, s), [scope, version], { enabled });
  const theta = useApi((s) => getCalibrationHistory(scope, s), [scope, version], { enabled });
  const trend = useApi((s) => getDemandTrend(sid, 30, s), [sid, version], { enabled });
  const [severity, setSeverity] = useState<string>('');
  const alerts = useApi((s) => getAlerts(sid, severity || undefined, 50, s), [sid, version, severity], { enabled });
  const [abc, setAbc] = useState<string>('A');

  const k = kpis.data;
  const sh = shadow.data;
  const wrmsse = k?.production_wrmsse ?? parseWrmsse(k?.avg_forecast_accuracy);

  const thetaView = useMemo(() => {
    const hist: CalibrationState[] = theta.data ?? [];
    const classes = [...new Set(hist.map((h) => h.class_id))].filter((cl) => cl.startsWith(abc)).sort();
    const byReview = new Map<number, Record<string, number | string>>();
    for (const h of hist) {
      if (!h.class_id.startsWith(abc)) continue;
      const row = byReview.get(h.review_index) ?? { review_index: h.review_index };
      row[h.class_id] = h.theta;
      byReview.set(h.review_index, row);
    }
    return { classes, rows: [...byReview.values()].sort((a, b) => Number(a.review_index) - Number(b.review_index)) };
  }, [theta.data, abc]);

  const sevTone = (s: string): Tone => (s === 'CRITICAL' ? 'danger' : s === 'WARNING' ? 'warning' : 'success');
  const sevLabel = (s: string) =>
    s === 'CRITICAL' ? t('dashboard.alerts.sev_critical') : s === 'WARNING' ? t('dashboard.alerts.sev_warning') : t('dashboard.alerts.sev_healthy');

  const alertCols: Column<AlertItem>[] = [
    { key: 'item_id', header: t('dashboard.alerts.col_sku'), value: (r) => r.item_id, sortable: true },
    { key: 'name', header: t('dashboard.alerts.col_name'), value: (r) => r.product_name, sortable: true },
    { key: 'on_hand', header: t('dashboard.alerts.col_on_hand'), align: 'right', value: (r) => r.on_hand, cell: (r) => fmt.number(r.on_hand, { digits: 0 }), sortable: true },
    { key: 'on_order', header: t('dashboard.alerts.col_on_order'), align: 'right', value: (r) => r.on_order, cell: (r) => fmt.number(r.on_order, { digits: 0 }), sortable: true },
    { key: 'ss', header: t('dashboard.alerts.col_ss'), align: 'right', value: (r) => r.safety_stock, cell: (r) => fmt.number(r.safety_stock, { digits: 1 }), sortable: true },
    { key: 'rop', header: t('dashboard.alerts.col_rop'), align: 'right', value: (r) => r.reorder_point, cell: (r) => fmt.number(r.reorder_point, { digits: 1 }), sortable: true },
    { key: 'sev', header: t('dashboard.alerts.col_severity'), value: (r) => r.severity, cell: (r) => <Badge tone={sevTone(r.severity)}>{sevLabel(r.severity)}</Badge>, sortable: true },
    { key: 'action', header: t('dashboard.alerts.col_action'), value: (r) => r.suggested_action },
  ];

  const segCols: Column<SegmentAvailability>[] = [
    { key: 'class', header: t('dashboard.seg.col_class'), value: (r) => r.class_id, sortable: true },
    { key: 'target', header: t('dashboard.seg.col_target'), align: 'right', value: (r) => r.target, cell: (r) => fmt.percent(r.target, { scale: 'percent', digits: 1 }) },
    { key: 'c3', header: t('dashboard.seg.col_c3'), align: 'right', value: (r) => r.c3out_availability, cell: (r) => fmt.percent(r.c3out_availability, { scale: 'percent', digits: 1 }), sortable: true },
    { key: 'b0', header: t('dashboard.seg.col_b0'), align: 'right', value: (r) => r.b0_availability, cell: (r) => fmt.percent(r.b0_availability, { scale: 'percent', digits: 1 }), sortable: true },
    { key: 'theta', header: t('dashboard.seg.col_theta'), align: 'right', value: (r) => r.theta, cell: (r) => fmt.number(r.theta, { digits: 3 }) },
    { key: 'sku', header: t('dashboard.seg.col_skus'), align: 'right', value: (r) => r.n_sku, cell: (r) => fmt.integer(r.n_sku) },
    {
      key: 'status',
      header: t('dashboard.seg.col_status'),
      value: (r) => r.status,
      cell: (r) => <Badge tone={r.status === 'COMPLIANT' ? 'success' : 'warning'}>{r.status === 'COMPLIANT' ? t('dashboard.seg.status_compliant') : t('dashboard.seg.status_warning')}</Badge>,
    },
  ];

  if (!storeId) {
    return (
      <>
        <PageHeader title={t('dashboard.title')} description={t('dashboard.description')} />
        <EmptyState title={t('shell.store.empty')} />
      </>
    );
  }

  const asOf = sh?.as_of ? fmt.date(sh.as_of) : undefined;
  const availabilityReason = sh ? sh.availability_reason ?? t('dashboard.reason.availability') : undefined;
  const costDelta = sh?.total_cost_savings;
  const tabs = ['A', 'B', 'C'].map((id) => ({ id, label: id }));
  const trendRows = trend.data?.data ?? [];
  const trendHasData = trendRows.some((r) => r.actual !== null || r.predicted !== null);

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        meta={
          <>
            <Badge tone="accent">{isGlobal ? t('shell.store.all') : t('dashboard.store_label', { store: storeId })}</Badge>
            <DataSourceNote source={t('dashboard.source_note')} asOf={asOf} note={sh ? `${sh.source}` : undefined} />
          </>
        }
      />

      {isGlobal && (
        <Section>
          <Alert tone="info" title={t('dashboard.global.title')}>
            {t('dashboard.global.body', { store: sid })}
          </Alert>
        </Section>
      )}

      <Section>
        <ClockPanel />
      </Section>

      <Section>
        <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <KpiTile
            icon={<Target size={14} />}
            label={t('dashboard.kpi.availability')}
            loading={shadow.loading && !sh}
            value={sh?.c3out_overall_availability != null ? fmt.percent(sh.c3out_overall_availability, { scale: 'percent', digits: 1 }) : null}
            unavailableReason={shadow.error ? apiErrorMessage(shadow.error, t) : sh?.c3out_overall_availability == null ? availabilityReason : undefined}
            hint={
              sh
                ? t('dashboard.kpi.availability_hint', {
                    target: sh.target_availability != null ? fmt.percent(sh.target_availability, { scale: 'percent', digits: 1 }) : t('dashboard.kpi.availability_target_missing'),
                    b0: fmt.percent(sh.b0_overall_availability, { scale: 'percent', digits: 1 }),
                  })
                : undefined
            }
          />
          <KpiTile
            icon={<PackageX size={14} />}
            label={t('dashboard.kpi.stockouts')}
            loading={kpis.loading && !k}
            value={k ? fmt.percent(k.stockout_rate, { scale: 'percent', digits: 1 }) : null}
            unavailableReason={kpis.error ? apiErrorMessage(kpis.error, t) : undefined}
            hint={k ? t('dashboard.kpi.stockouts_hint', { rate: fmt.percent(k.stockout_rate, { scale: 'percent', digits: 1 }), total: fmt.integer(k.total_skus) }) : undefined}
          />
          <KpiTile
            icon={<Boxes size={14} />}
            label={t('dashboard.kpi.inventory_value')}
            loading={kpis.loading && !k}
            value={k ? fmt.currency(k.total_inventory_value, { compact: true }) : null}
            unavailableReason={kpis.error ? apiErrorMessage(kpis.error, t) : undefined}
            hint={t('dashboard.kpi.inventory_hint')}
          />
          <KpiTile
            icon={<ClipboardList size={14} />}
            label={t('dashboard.kpi.orders')}
            loading={kpis.loading && !k}
            value={k ? fmt.integer(k.pending_replenishments_count) : null}
            unavailableReason={kpis.error ? apiErrorMessage(kpis.error, t) : undefined}
            hint={k ? t('dashboard.kpi.orders_hint', { count: fmt.integer(k.reorder_alerts_count) }) + ' · ' + (k.orders_placed_count != null ? t('dashboard.kpi.orders_placed', { count: fmt.integer(k.orders_placed_count) }) : t('dashboard.kpi.orders_placed_missing')) : undefined}
          />
          <KpiTile
            icon={<CircleDollarSign size={14} />}
            label={t('dashboard.kpi.cost')}
            loading={shadow.loading && !sh}
            value={sh?.c3out_total_cost != null ? fmt.currency(sh.c3out_total_cost, { compact: true }) : null}
            unavailableReason={shadow.error ? apiErrorMessage(shadow.error, t) : sh?.c3out_total_cost == null ? sh?.cost_reason ?? t('dashboard.reason.cost') : undefined}
            hint={
              sh
                ? t('dashboard.kpi.cost_hint', {
                    b0: sh.b0_total_cost != null ? fmt.currency(sh.b0_total_cost, { compact: true }) : (sh.b0_reason ?? '—'),
                    delta: costDelta != null ? fmt.currency(costDelta, { compact: true }) : '—',
                  })
                : undefined
            }
          />
          <KpiTile
            icon={<Activity size={14} />}
            label={t('dashboard.kpi.wrmsse')}
            loading={kpis.loading && !k}
            value={wrmsse != null ? fmt.number(wrmsse, { digits: 4 }) : null}
            unavailableReason={kpis.error ? apiErrorMessage(kpis.error, t) : wrmsse == null ? t('dashboard.kpi.wrmsse_unavailable') : undefined}
            hint={k?.production_model_id ? `${t('dashboard.kpi.wrmsse_hint')} ${t('dashboard.kpi.wrmsse_model', { id: k.production_model_id })}` : t('dashboard.kpi.wrmsse_hint')}
          />
        </div>
      </Section>

      <Section>
        <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
          <ChartFrame
            title={t('dashboard.charts.cost_title')}
            description={t('dashboard.charts.cost_desc')}
            loading={shadow.loading && !sh}
            error={shadow.error}
            onRetry={shadow.refetch}
            empty={!!sh && sh.cost_curves.length === 0}
            unavailableReason={sh && sh.cost_curves.length === 0 ? sh.cost_reason ?? undefined : undefined}
            source="/dashboard/kpi-dashboard"
            asOf={asOf}
            footer={<ChartLegend items={[{ label: t('dashboard.charts.cost_c3'), color: 'var(--chart-1)' }, { label: t('dashboard.charts.cost_b0'), color: 'var(--chart-2)' }]} />}
          >
            <CostChart rows={sh?.cost_curves ?? []} />
          </ChartFrame>

          <ChartFrame
            title={t('dashboard.charts.theta_title')}
            description={t('dashboard.charts.theta_desc')}
            actions={<Tabs items={tabs} value={abc} onChange={setAbc} />}
            loading={theta.loading && !theta.data}
            error={theta.error?.kind === 'forbidden' ? undefined : theta.error}
            onRetry={theta.refetch}
            unavailableReason={theta.error?.kind === 'forbidden' ? t('dashboard.charts.theta_unavailable_forbidden') : undefined}
            empty={!!theta.data && thetaView.rows.length === 0}
            source="/calibration/history"
          >
            <ThetaChart rows={thetaView.rows} classes={thetaView.classes} />
          </ChartFrame>

          <ChartFrame
            title={t('dashboard.charts.seg_title')}
            description={t('dashboard.charts.seg_desc')}
            loading={shadow.loading && !sh}
            error={shadow.error}
            onRetry={shadow.refetch}
            empty={!!sh && sh.segment_availabilities.length === 0}
            source="/dashboard/kpi-dashboard"
            asOf={asOf}
            footer={
              <ChartLegend
                items={[
                  { label: t('dashboard.charts.cost_c3'), color: 'var(--chart-1)' },
                  { label: 'B0', color: 'var(--chart-2)' },
                  { label: t('dashboard.charts.target'), color: 'var(--chart-reference)' },
                ]}
              />
            }
          >
            <SegmentChart rows={sh?.segment_availabilities ?? []} />
          </ChartFrame>

          <ChartFrame
            title={t('dashboard.charts.trend_title')}
            description={t('dashboard.charts.trend_desc')}
            loading={trend.loading && !trend.data}
            error={trend.error}
            onRetry={trend.refetch}
            empty={!!trend.data && !trendHasData}
            source="/dashboard/demand-trend"
            footer={<ChartLegend items={[{ label: t('dashboard.charts.actual'), color: 'var(--chart-1)' }, { label: t('dashboard.charts.predicted'), color: 'var(--chart-2)' }]} />}
          >
            <TrendChart rows={trendRows} />
          </ChartFrame>
        </div>
      </Section>

      <Section title={t('dashboard.seg.col_class')}>
        <Card flush>
          <Table
            columns={segCols}
            rows={sh?.segment_availabilities ?? []}
            rowKey={(r) => r.class_id}
            loading={shadow.loading && !sh}
            error={shadow.error}
            onRetry={shadow.refetch}
            dense
          />
        </Card>
      </Section>

      <Section
        title={t('dashboard.alerts.title')}
        description={
          alerts.data
            ? t('dashboard.alerts.summary', {
                critical: fmt.integer(alerts.data.summary.critical_count),
                warning: fmt.integer(alerts.data.summary.warning_count),
                healthy: fmt.integer(alerts.data.summary.healthy_count),
                total: fmt.integer(alerts.data.summary.total_monitored),
              })
            : t('dashboard.alerts.description')
        }
        actions={
          <Select
            aria-label={t('dashboard.alerts.col_severity')}
            value={severity}
            onChange={setSeverity}
            options={[
              { value: '', label: t('dashboard.alerts.filter_all') },
              { value: 'CRITICAL', label: t('dashboard.alerts.sev_critical') },
              { value: 'WARNING', label: t('dashboard.alerts.sev_warning') },
              { value: 'HEALTHY', label: t('dashboard.alerts.sev_healthy') },
            ]}
          />
        }
      >
        <Card flush>
          <Table
            columns={alertCols}
            rows={alerts.data?.items ?? []}
            rowKey={(r) => `${r.item_id}|${r.store_id}`}
            loading={alerts.loading && !alerts.data}
            error={alerts.error}
            onRetry={alerts.refetch}
            filtered={!!severity}
            maxHeight={420}
            dense
          />
        </Card>
        {alerts.data && <DataSourceNote source="/dashboard/alerts" note={t('dashboard.alerts.shown', { shown: fmt.integer(alerts.data.items.length), total: fmt.integer(alerts.data.total) })} />}
        <p className="ui-muted">{t('dashboard.realtime_note')}</p>
      </Section>
    </>
  );
};

export default Dashboard;
