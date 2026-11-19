import React, { useMemo, useState } from 'react';
import { Award, CheckCircle2, Download, Play, ShieldCheck, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChartFrame,
  ChartTooltip,
  DataSourceNote,
  EmptyState,
  ErrorState,
  HoldHeight,
  KpiTile,
  PageHeader,
  Section,
  Table,
  Tabs,
  useChartTheme,
  useConfirm,
  usePagination,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { useApi } from '../hooks/useApi.ts';
import { useClock } from '../context/ClockContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { GLOBAL_STORE, useStore } from '../context/StoreContext.tsx';
import { can } from '../auth/permissions.ts';
import { CoverageTiles } from '../components/common/CoverageTiles.tsx';
import { ReferenceE10b } from '../components/ReferenceE10b.tsx';
import { WhatIfPanel } from './reports/WhatIfPanel.tsx';
import { RefitPanel } from './reports/RefitPanel.tsx';
import { ForecastQualityPanel } from './reports/ForecastQualityPanel.tsx';
import { ControllerPanel } from './reports/ControllerPanel.tsx';
import { downloadCsv } from '../utils/csv.ts';
import { useFormat, useT } from '../i18n/index.tsx';
import { useBe } from '../i18n/useBe.ts';
import { policyDescription, policyLabel } from '../utils/policyText.ts';
import { apiErrorMessage, toApiError } from '../services/apiClient.ts';
import { getKpiShadowDashboard } from '../services/dashboardApi.ts';
import {
  getCostComparison,
  getForecastAccuracy,
  getInventoryPerformance,
  getPolicyBenchmark,
  getRegistryModels,
  postBacktest,
  postComparePolicies,
  type Backtest,
  type InventoryPerfItem,
  type PolicyRow,
  type RegistryModel,
  type SimPolicyMetric,
} from '../services/reportsApi.ts';
import './Reports.css';

type Objective = 'cost' | 'sla';
type SubTabId = 'breakdown' | 'policies' | 'accuracy' | 'inventory' | 'whatif';

function pickMetric(metrics: Record<string, unknown> | null | undefined, algo: string, key: string): number | null {
  if (!metrics) return null;
  const v = metrics[key] ?? metrics[`${algo}_${key}`];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const CostStack: React.FC<{ rows: PolicyRow[] }> = ({ rows }) => {
  const c = useChartTheme();
  const fmt = useFormat();
  const t = useT();
  const be = useBe();
  const data = rows.map((r) => ({
    name: policyLabel(t, be, r.policy_key, r.label) || r.policy,
    holding: r.holding_cost,
    shortage: r.shortage_cost,
    ordering: r.ordering_cost,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="name" {...c.axis} interval={0} tick={{ ...c.axis.tick, fontSize: 10 }} />
        <YAxis {...c.axis} width={56} tickFormatter={(v: number) => fmt.compact(v)} />
        <RTooltip content={<ChartTooltip format={(v) => fmt.number(v, { digits: 0 })} />} cursor={false} />
        <Bar dataKey="holding" name={t('reports.policy.col_holding')} stackId="a" fill={c.series[0]} />
        <Bar dataKey="shortage" name={t('reports.policy.col_shortage')} stackId="a" fill={c.series[1]} />
        <Bar dataKey="ordering" name={t('reports.policy.col_ordering')} stackId="a" fill={c.series[2]} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

const PoliciesTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const be = useBe();
  const { storeId } = useStore();
  const { user } = useAuth();
  const { version } = useClock();
  const isManager = can(user?.role, 'policy:manage');
  const [objective] = useState<Objective>('cost');

  const bench = useApi((s) => getPolicyBenchmark(s), [version]);
  const sim = useApi((s) => postComparePolicies(storeId ?? '', s), [storeId, version], { enabled: !!storeId && isManager });

  const rows = useMemo<PolicyRow[]>(() => Object.values(bench.data?.policies ?? {}), [bench.data]);
  const withCost = rows.filter((r) => r.total_cost_bikip != null);
  const withCsl = rows.filter((r) => r.csl != null);
  const cheapest = withCost.length ? withCost.reduce((a, b) => ((a.total_cost_bikip as number) <= (b.total_cost_bikip as number) ? a : b)) : null;
  const topCsl = withCsl.length ? withCsl.reduce((a, b) => ((a.csl as number) >= (b.csl as number) ? a : b)) : null;
  const best = objective === 'cost' ? cheapest : topCsl;
  const hasP6 = rows.some((r) => /p6/i.test(r.policy) || /p6/i.test(r.label));
  const name = (r: PolicyRow) => policyLabel(t, be, r.policy_key, r.label) || r.policy;

  const cols: Column<PolicyRow>[] = [
    {
      key: 'label',
      header: t('reports.policy.col_policy'),
      value: (r) => name(r),
      cell: (r) => (
        <span>
          {name(r)} {best && best.policy === r.policy && <Badge tone="success">{t('reports.policy.best_badge')}</Badge>}
        </span>
      ),
      sortable: true,
    },
    { key: 'tau', header: t('reports.policy.col_tau'), align: 'right', value: (r) => r.tau, cell: (r) => fmt.number(r.tau, { digits: 4 }) },
    { key: 'csl', header: t('reports.policy.col_csl'), align: 'right', value: (r) => r.csl, cell: (r) => fmt.percent(r.csl, { digits: 1 }), sortable: true },
    { key: 'fill', header: t('reports.policy.col_fill'), align: 'right', value: (r) => r.fill_rate, cell: (r) => fmt.percent(r.fill_rate, { digits: 1 }), sortable: true },
    { key: 'h', header: t('reports.policy.col_holding'), align: 'right', value: (r) => r.holding_cost, cell: (r) => fmt.number(r.holding_cost, { digits: 0 }), sortable: true },
    { key: 's', header: t('reports.policy.col_shortage'), align: 'right', value: (r) => r.shortage_cost, cell: (r) => fmt.number(r.shortage_cost, { digits: 0 }), sortable: true },
    { key: 'o', header: t('reports.policy.col_ordering'), align: 'right', value: (r) => r.ordering_cost, cell: (r) => fmt.number(r.ordering_cost, { digits: 0 }), sortable: true },
    { key: 'total', header: t('reports.policy.col_total'), align: 'right', value: (r) => r.total_cost_bikip, cell: (r) => fmt.number(r.total_cost_bikip, { digits: 0 }), sortable: true },
    {
      key: 'vs',
      header: t('reports.policy.col_vs_best'),
      align: 'right',
      value: (r) => (cheapest && r.total_cost_bikip != null && cheapest.total_cost_bikip ? r.total_cost_bikip / cheapest.total_cost_bikip - 1 : null),
      cell: (r) =>
        cheapest && r.total_cost_bikip != null && cheapest.total_cost_bikip
          ? fmt.percent(r.total_cost_bikip / cheapest.total_cost_bikip - 1, { digits: 1, signed: true })
          : '—',
    },
  ];

  const exportPolicies = () =>
    downloadCsv(
      'policy-comparison.csv',
      ['policy', 'label', 'tau', 'csl', 'fill_rate', 'holding_cost', 'shortage_cost', 'ordering_cost', 'total_cost_bikip'],
      rows.map((r) => [r.policy, name(r), r.tau, r.csl, r.fill_rate, r.holding_cost, r.shortage_cost, r.ordering_cost, r.total_cost_bikip]),
    );

  const b = bench.data;
  const missing = b?.status === 'artifact_missing';
  const simCols: Column<SimPolicyMetric>[] = [
    {
      key: 'name',
      header: t('reports.policy.col_policy'),
      value: (r) => policyLabel(t, be, r.policy_key, r.policy_name),
      cell: (r) => (
        <span title={policyDescription(t, be, r.policy_key, r.description)}>
          {policyLabel(t, be, r.policy_key, r.policy_name)} {sim.data?.recommended_policy === r.policy_id && <Badge tone="accent">{t('reports.sim.recommended_short')}</Badge>}
        </span>
      ),
    },
    { key: 'av', header: t('reports.sim.col_availability'), align: 'right', value: (r) => r.availability, cell: (r) => fmt.percent(r.availability, { scale: 'percent', digits: 1 }) },
    { key: 'cost', header: t('reports.policy.col_total'), align: 'right', value: (r) => r.total_cost, cell: (r) => fmt.number(r.total_cost, { digits: 0 }) },
    { key: 'orders', header: t('reports.sim.col_orders'), align: 'right', value: (r) => r.total_orders, cell: (r) => fmt.integer(r.total_orders) },
    { key: 'so', header: t('reports.sim.col_stockouts'), align: 'right', value: (r) => r.total_stockouts, cell: (r) => (r.total_stockouts == null ? <span title={r.stockouts_reason_code === 'artifact_no_units' ? t('reports.sim.stockouts_artifact') : be(r.stockouts_reason) || undefined}>—</span> : fmt.integer(r.total_stockouts)) },
    {
      key: 'f',
      header: <span className="ui-sr-only">{t('reports.sim.col_feasible')}</span>,
      value: (r) => (r.is_feasible == null ? -1 : r.is_feasible ? 1 : 0),
      cell: (r) =>
        r.is_feasible == null ? (
          <span>—</span>
        ) : (
          <Badge tone={r.is_feasible ? 'success' : 'warning'}>
            {r.is_feasible ? <CheckCircle2 size={12} aria-hidden="true" /> : <TriangleAlert size={12} aria-hidden="true" />} {r.is_feasible ? t('reports.sim.feasible') : t('reports.sim.infeasible')}
          </Badge>
        ),
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <Section
        title={t('reports.policy.title')}
        description={t('reports.policy.description')}
        actions={
          <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={exportPolicies} disabled={rows.length === 0}>
            {t('reports.common.export_csv')}
          </Button>
        }
      >
        {bench.error ? (
          <ErrorState error={bench.error} onRetry={bench.refetch} />
        ) : missing ? (
          <EmptyState title={t('reports.policy.missing')} description={b?.reason ?? undefined} />
        ) : (
          <>
            <p className="ui-muted" role="note">{t('reports.policy.note')}</p>
            <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginBottom: 'var(--space-4)' }}>
              <CoverageTiles
                loading={bench.loading && !b}
                artifact={b?.coverage_q95}
                artifactSource={b?.coverage_source}
                dbCausal={b?.coverage_q95_db_causal}
                dbCausalN={b?.coverage_q95_db_causal_n}
                missingReason={t('reports.policy.coverage_unavailable')}
              />
            </div>
            <Card flush>
              <Table columns={cols} rows={rows} rowKey={(r) => r.policy} loading={bench.loading && !b} />
            </Card>
            {hasP6 && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 'var(--space-3) 0 0' }}>{t('reports.policy.p6_note')}</p>}
            {withCost.length > 0 && (
              <ChartFrame title={t('reports.policy.title')} description={t('reports.policy.description')} height={240}>
                <CostStack rows={withCost} />
              </ChartFrame>
            )}
          </>
        )}
      </Section>

      <ReferenceE10b />

      {isManager && (
        <Section title={t('reports.sim.title')} description={t('reports.sim.description')}>
          {sim.error ? (
            <ErrorState error={sim.error} onRetry={sim.refetch} />
          ) : (
            <Card flush>
              <Table columns={simCols} rows={sim.data?.policies ?? []} rowKey={(r) => r.policy_id} loading={sim.loading && !sim.data} />
            </Card>
          )}
        </Section>
      )}
    </div>
  );
};

/** The A3 cost basis of the BE ("A3: h=0.002*price/day ...") in the active language; other texts as given. */
function costBasisText(basis: string | null | undefined, t: ReturnType<typeof useT>): string {
  if (!basis) return '—';
  const m = /h=([\d.]+)\*price\/day.*b=([\d.]+)\*price\/lost unit.*c=([\d.]+)\/placed order/.exec(basis);
  return m ? t('reports.exec.basis_a3', { h: m[1].replace('.', ','), b: m[2].replace('.', ','), c: m[3] }) : basis;
}

const AccuracyTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const { storeId } = useStore();
  const { user } = useAuth();
  const { version, clock } = useClock();
  const isAdmin = can(user?.role, 'view:models');
  const canQuality = can(user?.role, 'forecast_quality:view');
  const isManager = can(user?.role, 'policy:manage');
  const acc = useApi((s) => getForecastAccuracy(storeId ?? '', s), [storeId, version], { enabled: !!storeId });
  const reg = useApi((s) => getRegistryModels(s), [version], { enabled: isAdmin });
  const a = acc.data;
  // registry fallback: no daily forecast overlaps real sales (the production forecasts are the 28 days AFTER the M5
  // data), so the numbers are the registry's evaluation of the Production model, and the per-class table is empty
  const fromRegistry = a?.source === 'model_registry';

  const metric = (label: string, v: number | null | undefined, digits = 4) => (
    <KpiTile
      label={label}
      loading={acc.loading && !a}
      value={v != null ? fmt.number(v, { digits }) : null}
      unavailableReason={
        acc.error ? apiErrorMessage(acc.error, t) : v == null ? (fromRegistry ? t('reports.accuracy.registry_missing') : t('reports.reason.not_loaded')) : undefined
      }
      hint={
        a
          ? fromRegistry
            ? t('reports.accuracy.registry_hint', { model: a.model_name })
            : t('reports.accuracy.samples', { count: fmt.integer(a.overall_metrics.sample_count) })
          : undefined
      }
    />
  );

  const abcRows = Object.entries(a?.abc_breakdown ?? {}).map(([cls, m]) => ({ cls, ...m }));
  const abcCols: Column<(typeof abcRows)[number]>[] = [
    { key: 'cls', header: t('reports.accuracy.col_class'), value: (r) => r.cls },
    { key: 'mae', header: t('reports.accuracy.mae'), align: 'right', value: (r) => r.mae, cell: (r) => fmt.number(r.mae, { digits: 3 }) },
    { key: 'rmse', header: t('reports.accuracy.rmse'), align: 'right', value: (r) => r.rmse, cell: (r) => fmt.number(r.rmse, { digits: 3 }) },
    { key: 'mase', header: t('reports.accuracy.mase'), align: 'right', value: (r) => r.mase, cell: (r) => fmt.number(r.mase, { digits: 3 }) },
    { key: 'wrmsse', header: t('reports.accuracy.wrmsse'), align: 'right', value: (r) => r.wrmsse, cell: (r) => fmt.number(r.wrmsse, { digits: 4 }) },
    { key: 'n', header: t('reports.accuracy.col_samples'), align: 'right', value: (r) => r.sample_count, cell: (r) => fmt.integer(r.sample_count) },
  ];

  const regCols: Column<RegistryModel>[] = [
    { key: 'name', header: t('reports.accuracy.col_model'), value: (r) => r.name },
    { key: 'ver', header: t('reports.accuracy.col_version'), value: (r) => r.version },
    { key: 'alg', header: t('reports.accuracy.col_algorithm'), value: (r) => r.algorithm },
    { key: 'mase', header: t('reports.accuracy.mase'), align: 'right', value: (r) => pickMetric(r.metrics, r.algorithm, 'mase'), cell: (r) => fmt.number(pickMetric(r.metrics, r.algorithm, 'mase'), { digits: 3 }) },
    { key: 'wrmsse', header: t('reports.accuracy.wrmsse'), align: 'right', value: (r) => pickMetric(r.metrics, r.algorithm, 'wrmsse'), cell: (r) => fmt.number(pickMetric(r.metrics, r.algorithm, 'wrmsse'), { digits: 4 }), sortable: true },
    { key: 'prod', header: t('reports.accuracy.col_production'), value: (r) => (r.is_production ? 1 : 0), cell: (r) => <Badge tone={r.is_production ? 'success' : 'neutral'}>{r.is_production ? t('reports.accuracy.production_yes') : t('reports.accuracy.production_no')}</Badge> },
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <Section title={t('reports.accuracy.title')} description={t('reports.accuracy.description')}>
        <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {metric(t('reports.accuracy.wrmsse'), a?.overall_metrics.wrmsse)}
          {metric(t('reports.accuracy.mase'), a?.overall_metrics.mase, 3)}
          {metric(t('reports.accuracy.mae'), a?.overall_metrics.mae, 3)}
          {metric(t('reports.accuracy.rmse'), a?.overall_metrics.rmse, 3)}
          <CoverageTiles
            loading={acc.loading && !a}
            artifact={a?.overall_metrics.coverage_q95}
            artifactSource={a?.overall_metrics.coverage_source}
            dbCausal={a?.overall_metrics.coverage_q95_db_causal}
            dbCausalN={a?.overall_metrics.coverage_q95_db_causal_n}
          />
        </div>
        {a && <DataSourceNote source="/reports/forecast-accuracy" asOf={a.as_of ? fmt.date(a.as_of) : undefined} note={`${a.model_name}, ${a.evaluated_period}, ${a.source}`} />}
        {fromRegistry && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Alert tone="info">{t('reports.accuracy.registry_note')}</Alert>
          </div>
        )}
        {abcRows.length > 0 && !fromRegistry && (
          <Card flush style={{ marginTop: 'var(--space-4)' }}>
            <Table columns={abcCols} rows={abcRows} rowKey={(r) => r.cls} dense />
          </Card>
        )}
      </Section>

      {canQuality && <ForecastQualityPanel storeId={storeId === GLOBAL_STORE ? null : storeId} version={version} />}
      {isManager && <ControllerPanel storeId={storeId === GLOBAL_STORE ? null : storeId} clockDate={clock?.current_date} m5Day0={clock?.m5_day0} version={version} />}

      <Section title={t('reports.accuracy.registry_title')} description={t('reports.accuracy.registry_desc')}>
        {!isAdmin ? (
          <Alert tone="info">{t('reports.accuracy.registry_forbidden')}</Alert>
        ) : (
          <Card flush>
            <Table columns={regCols} rows={reg.data?.items ?? []} rowKey={(r) => r.id} loading={reg.loading && !reg.data} error={reg.error} onRetry={reg.refetch} dense />
          </Card>
        )}
      </Section>
    </div>
  );
};

const InventoryTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const { storeId } = useStore();
  const { version } = useClock();
  const pg = usePagination(25);
  const inv = useApi((s) => getInventoryPerformance(storeId ?? '', pg.pageSize, pg.offset, s), [storeId, version, pg.pageSize, pg.offset], { enabled: !!storeId });
  const i = inv.data;

  const cols: Column<InventoryPerfItem>[] = [
    { key: 'sku', header: t('reports.inventory.col_sku'), value: (r) => r.item_id },
    { key: 'name', header: t('reports.inventory.col_name'), value: (r) => r.product_name },
    { key: 'cat', header: t('reports.inventory.col_category'), value: (r) => r.category },
    { key: 'on_hand', header: t('reports.inventory.col_on_hand'), align: 'right', value: (r) => r.on_hand, cell: (r) => fmt.integer(r.on_hand) },
    { key: 'turnover', header: t('reports.inventory.col_turnover'), align: 'right', value: (r) => r.turnover_ratio, cell: (r) => (r.turnover_ratio != null ? fmt.number(r.turnover_ratio, { digits: 2 }) : '—') },
    { key: 'dos', header: t('reports.inventory.col_dos'), align: 'right', value: (r) => r.days_of_supply, cell: (r) => (r.days_of_supply != null ? fmt.number(r.days_of_supply, { digits: 1 }) : '—') },
    { key: 'val', header: t('reports.inventory.col_value'), align: 'right', value: (r) => r.inventory_value, cell: (r) => fmt.currency(r.inventory_value) },
  ];

  return (
    <Section title={t('reports.inventory.title')} description={t('reports.inventory.value')}>
      {inv.error ? (
        <ErrorState error={inv.error} onRetry={inv.refetch} />
      ) : (
        <>
          <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 'var(--space-4)' }}>
            <KpiTile label={t('reports.inventory.value')} value={i ? fmt.currency(i.total_inventory_value) : null} loading={inv.loading && !i} />
            <KpiTile label={t('reports.inventory.turnover')} value={i?.average_turnover_ratio != null ? fmt.number(i.average_turnover_ratio, { digits: 2 }) : null} loading={inv.loading && !i} />
            <KpiTile label={t('reports.inventory.dos')} value={i?.average_days_of_supply != null ? fmt.number(i.average_days_of_supply, { digits: 1 }) : null} loading={inv.loading && !i} />
            <KpiTile label={t('reports.inventory.stockout')} value={i?.stockout_skus_count != null ? fmt.integer(i.stockout_skus_count) : null} loading={inv.loading && !i} />
          </div>
          <Card flush>
            <Table
              columns={cols}
              rows={i?.items ?? []}
              rowKey={(r) => r.item_id}
              loading={inv.loading && !i}
              pagination={{
                page: pg.page,
                pageSize: pg.pageSize,
                total: i?.total ?? 0,
                onPageChange: pg.setPage,
                onPageSizeChange: pg.setPageSize,
              }}
            />
          </Card>
        </>
      )}
    </Section>
  );
};

export const Reports: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { storeId } = useStore();
  const { user } = useAuth();
  const { version, clock } = useClock();
  const { confirm, dialog } = useConfirm();
  const chart = useChartTheme();

  const isAdmin = can(user?.role, 'models:manage');
  const [subTab, setSubTab] = useState<SubTabId>('breakdown');
  const [runningBt, setRunningBt] = useState(false);
  const [btResult, setBtResult] = useState<Backtest | null>(null);

  const cost = useApi((s) => getCostComparison(storeId ?? '', s), [storeId, version], { enabled: !!storeId && isAdmin });
  const c = cost.data;
  // Simulator KPIs of C3-OUT and the shadow B0 (every role): totals, cost curve per review, availability
  const kpi = useApi((s) => getKpiShadowDashboard(storeId ?? '', s), [storeId, version], { enabled: !!storeId });
  const k = kpi.data;
  const curve = useMemo(() => k?.cost_curves ?? [], [k]);
  const lastPoint = curve.length ? curve[curve.length - 1] : null;

  const runBacktest = async () => {
    if (!storeId) return;
    const ok = await confirm({
      title: t('reports.cost.backtest_confirm_title'),
      description: t('reports.cost.backtest_confirm_body', { store: storeId }),
    });
    if (!ok) return;
    setRunningBt(true);
    try {
      const res = await postBacktest(storeId);
      setBtResult(res);
      toast.success(t('reports.cost.backtest_title'));
    } catch (err) {
      toast.error(t('reports.cost.bt_failed'), apiErrorMessage(toApiError(err), t));
    } finally {
      setRunningBt(false);
    }
  };

  // Totals: savings > 0 means C3-OUT is cheaper than B0 (BE convention: B0 - C3-OUT)
  const c3Total = k?.c3out_total_cost ?? null;
  const b0Total = k?.b0_total_cost ?? null;
  const savings = k?.total_cost_savings ?? null;
  const savingsPct = savings !== null && b0Total ? (savings / b0Total) * 100 : null;
  const cheaper = savings !== null && savings >= 0;
  const segments = (k?.segment_availabilities ?? []).filter((sg) => sg.c3out_availability !== null);
  const belowTarget = segments.filter((sg) => (sg.c3out_availability as number) < sg.target).length;
  const money = (v: number | null | undefined) => (v !== null && v !== undefined && Number.isFinite(v) ? fmt.currency(v) : '—');
  const pct = (v: number | null | undefined) =>
    v !== null && v !== undefined && Number.isFinite(v) ? fmt.percent(v, { scale: 'percent', digits: 1 }) : '—';
  const L = clock?.lead_time_days ?? null;
  const R = clock?.review_period_days ?? null;

  const exportFullCsv = () => {
    const rows: Array<[string, string | number | null]> = [
      ['Store', storeId ?? ''],
      ['As of', k?.as_of ?? clock?.current_date ?? null],
      ['SKUs', k?.n_skus ?? null],
      ['Reviews elapsed', k?.reviews_elapsed ?? null],
      ['Cost basis', k?.cost_basis ?? null],
      ['C3-OUT total cost', c3Total],
      ['B0 total cost', b0Total],
      ['Savings (B0 - C3-OUT)', savings],
      ['Savings % of B0', savingsPct !== null ? Number(savingsPct.toFixed(2)) : null],
      ['C3-OUT holding', lastPoint?.c3out_holding_cost ?? null],
      ['C3-OUT ordering', lastPoint?.c3out_ordering_cost ?? null],
      ['C3-OUT lost sales', lastPoint?.c3out_stockout_cost ?? null],
      ['B0 holding', lastPoint?.b0_holding_cost ?? null],
      ['B0 ordering', lastPoint?.b0_ordering_cost ?? null],
      ['B0 lost sales', lastPoint?.b0_stockout_cost ?? null],
      ['C3-OUT availability %', k?.c3out_overall_availability ?? null],
      ['B0 availability %', k?.b0_overall_availability ?? null],
      ['Target availability %', k?.target_availability ?? null],
      ['Classes below target', segments.length ? `${belowTarget}/${segments.length}` : null],
    ];
    downloadCsv(`audit-report-${storeId ?? 'store'}.csv`, ['Key', 'Value'], rows);
  };

  // Cost breakdown: the admin cost report when present, else the last point of the simulator cost curve
  const breakdownRows = useMemo(() => {
    const mk = (key: string, label: string, b0: number | null | undefined, c3: number | null | undefined) => ({
      key,
      label,
      b0: b0 ?? null,
      c3: c3 ?? null,
      diff: b0 !== null && b0 !== undefined && c3 !== null && c3 !== undefined ? c3 - b0 : null,
    });
    if (c?.baseline_policy && c.ml_policy) {
      return [
        mk('h', t('reports.cost.holding'), c.baseline_policy.holding_cost, c.ml_policy.holding_cost),
        mk('o', t('reports.cost.order'), c.baseline_policy.order_cost, c.ml_policy.order_cost),
        mk('p', t('reports.cost.penalty'), c.baseline_policy.stockout_penalty_cost, c.ml_policy.stockout_penalty_cost),
        mk('t', t('reports.cost.total'), c.baseline_policy.total_cost, c.ml_policy.total_cost),
      ];
    }
    if (!lastPoint) return [];
    return [
      mk('h', t('reports.cost.holding'), lastPoint.b0_holding_cost, lastPoint.c3out_holding_cost),
      mk('o', t('reports.cost.order'), lastPoint.b0_ordering_cost, lastPoint.c3out_ordering_cost),
      mk('p', t('reports.cost.penalty'), lastPoint.b0_stockout_cost, lastPoint.c3out_stockout_cost),
      mk('t', t('reports.cost.total'), lastPoint.b0_total_cost, lastPoint.c3out_total_cost),
    ];
  }, [c, lastPoint, t]);

  const breakdownCols: Column<(typeof breakdownRows)[number]>[] = [
    { key: 'label', header: t('reports.cost.col_item'), value: (r) => r.label },
    { key: 'b0', header: t('reports.cost.baseline'), align: 'right', value: (r) => r.b0, cell: (r) => money(r.b0) },
    { key: 'c3', header: t('reports.cost.ml'), align: 'right', value: (r) => r.c3, cell: (r) => money(r.c3) },
    {
      key: 'diff',
      header: t('reports.cost.diff_col'),
      align: 'right',
      value: (r) => r.diff,
      cell: (r) =>
        r.diff === null ? (
          '—'
        ) : (
          <span style={{ fontWeight: 'var(--weight-semibold)', color: r.diff <= 0 ? 'var(--color-success-text)' : 'var(--color-danger-text)' }}>
            {r.diff > 0 ? `+${fmt.currency(r.diff)}` : fmt.currency(r.diff)}
          </span>
        ),
    },
  ];

  const chartRows = useMemo(() => curve.map((pt) => ({ label: fmt.date(pt.date), c3: pt.c3out_total_cost, b0: pt.b0_total_cost })), [curve, fmt]);

  return (
    <div className="rpt-container">
      <PageHeader
        title={`${t('reports.exec.title')} · ${storeId ?? '—'}`}
        description={t('reports.exec.subtitle')}
        meta={
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            {t('reports.exec.meta', {
              store: storeId ?? '—',
              r: R ?? '—',
              from: clock?.start_date ? fmt.date(clock.start_date) : '—',
              to: k?.as_of ? fmt.date(k.as_of) : clock?.current_date ? fmt.date(clock.current_date) : '—',
            })}
          </span>
        }
        actions={
          <div style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
            <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={exportFullCsv} disabled={!k}>
              {t('reports.exec.export_full')}
            </Button>
            {isAdmin && (
              <Button variant="primary" size="sm" leftIcon={<Play size={14} />} loading={runningBt} onClick={runBacktest}>
                {t('reports.cost.backtest_run')}
              </Button>
            )}
          </div>
        }
      />

      <div className="rpt-formula-box">
        <div className="rpt-formula-title">
          <span>∑</span>
          <span>{t('reports.exec.formula_title')}</span>
        </div>
        <div className="rpt-formula-math">{t('reports.exec.formula_math')}</div>
        <div className="rpt-formula-meta">
          <span className="rpt-formula-tag">
            <strong>{t('reports.exec.basis_label')}</strong> {costBasisText(k?.cost_basis, t)}
          </span>
          <span>·</span>
          <span className="rpt-formula-tag">
            <strong>{t('reports.exec.sample_label')}</strong> {k?.n_skus != null ? t('reports.exec.sample_val', { n: fmt.integer(k.n_skus) }) : '—'}
          </span>
          <span>·</span>
          <span className="rpt-formula-tag">
            <strong>{t('reports.exec.interval_label')}</strong> {t('reports.exec.interval_val', { l: L ?? '—', r: R ?? '—' })}
          </span>
        </div>
      </div>

      {kpi.error ? (
        <ErrorState error={kpi.error} onRetry={kpi.refetch} />
      ) : (
        <>
          <div className="rpt-kpi-grid">
            <div className="rpt-kpi-card">
              <div>
                <div className="rpt-kpi-head">
                  <span className="rpt-kpi-title">{t('reports.exec.kpi_savings')}</span>
                  {savingsPct !== null && (
                    <Badge tone={cheaper ? 'success' : 'warning'}>
                      {cheaper ? <TrendingDown size={12} style={{ marginRight: 2 }} /> : <TrendingUp size={12} style={{ marginRight: 2 }} />}
                      {fmt.percent(Math.abs(savingsPct), { scale: 'percent', digits: 1 })} {t(cheaper ? 'reports.exec.cheaper' : 'reports.exec.costlier')}
                    </Badge>
                  )}
                </div>
                <div className="rpt-kpi-val">
                  {savings !== null ? fmt.currency(Math.abs(savings)) : '—'}{' '}
                  <span className="rpt-kpi-unit">{savings === null ? '' : t(cheaper ? 'reports.exec.kpi_saved' : 'reports.exec.kpi_extra')}</span>
                </div>
              </div>
              <div className="rpt-kpi-foot">
                <span>
                  B0: <span className="rpt-kpi-subval">{money(b0Total)}</span>
                </span>
                <span>
                  C³-OUT: <strong style={{ color: 'var(--color-accent)' }}>{money(c3Total)}</strong>
                </span>
              </div>
            </div>

            <div className="rpt-kpi-card">
              <div>
                <div className="rpt-kpi-head">
                  <span className="rpt-kpi-title">{t('reports.exec.kpi_holding')}</span>
                </div>
                <div className="rpt-kpi-val">{money(lastPoint?.c3out_holding_cost)}</div>
              </div>
              <div className="rpt-kpi-foot">
                <span>
                  B0: <span className="rpt-kpi-subval">{money(lastPoint?.b0_holding_cost)}</span>
                </span>
                <span>
                  {t('reports.exec.kpi_ordering', { c3: money(lastPoint?.c3out_ordering_cost), b0: money(lastPoint?.b0_ordering_cost) })}
                </span>
              </div>
            </div>

            <div className="rpt-kpi-card">
              <div>
                <div className="rpt-kpi-head">
                  <span className="rpt-kpi-title">{t('reports.exec.kpi_stockout')}</span>
                </div>
                <div className="rpt-kpi-val">{money(lastPoint?.c3out_stockout_cost)}</div>
              </div>
              <div className="rpt-kpi-foot">
                <span>
                  B0: <span className="rpt-kpi-subval">{money(lastPoint?.b0_stockout_cost)}</span>
                </span>
                <span>{t('reports.exec.kpi_availability', { c3: pct(k?.c3out_overall_availability), b0: pct(k?.b0_overall_availability) })}</span>
              </div>
            </div>
          </div>

          <div className="rpt-main-grid">
            <div className="rpt-chart-card">
              <div className="rpt-chart-head">
                <div>
                  <div className="rpt-chart-title">{t('reports.exec.chart_title')}</div>
                  <div className="rpt-chart-desc">{t('reports.exec.chart_desc', { n: curve.length })}</div>
                </div>
                {savings !== null && (
                  <div className="rpt-delta-callout" style={cheaper ? undefined : { color: 'var(--color-warning-text)' }}>
                    {cheaper ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
                    <span>{t(cheaper ? 'reports.exec.delta_cheaper' : 'reports.exec.delta_costlier', { amount: fmt.currency(Math.abs(savings)) })}</span>
                  </div>
                )}
              </div>
              <div style={{ width: '100%', height: 320 }}>
                {kpi.loading && !k ? null : chartRows.length === 0 ? (
                  <EmptyState compact title={t('reports.exec.chart_empty')} description={k?.cost_reason ?? undefined} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartRows} margin={{ top: 12, right: 24, left: 10, bottom: 8 }}>
                      <CartesianGrid stroke={chart.grid} vertical={false} />
                      <XAxis dataKey="label" {...chart.axis} tick={{ ...chart.axis.tick, fontSize: 11 }} />
                      <YAxis {...chart.axis} width={64} tickFormatter={(v: number) => fmt.compact(v)} />
                      <RTooltip content={<ChartTooltip format={(v) => fmt.currency(Number(v))} />} />
                      <Legend verticalAlign="top" align="left" height={36} iconType="plainline" wrapperStyle={{ paddingLeft: 56 }} />
                      <Line
                        type="monotone"
                        dataKey="c3"
                        name={t('reports.exec.chart_c3')}
                        stroke="#4f46e5"
                        strokeWidth={3}
                        dot={{ r: 4, fill: '#4f46e5', stroke: '#fff', strokeWidth: 2 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="b0"
                        name={t('reports.exec.chart_b0')}
                        stroke="#94a3b8"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={{ r: 3, fill: '#94a3b8' }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rpt-audit-card">
              <div>
                <div className="rpt-audit-head">
                  <div className="rpt-audit-title">{t('reports.exec.audit_title')}</div>
                  <Badge tone="accent">
                    <ShieldCheck size={12} style={{ marginRight: 3 }} /> {k?.source ?? '—'}
                  </Badge>
                </div>
                <ul className="rpt-audit-list">
                  <li className="rpt-audit-row">
                    <span className="rpt-audit-label">{t('reports.exec.algo_label')}</span>
                    <span className="rpt-audit-val">{t('reports.exec.algo_val')}</span>
                  </li>
                  <li className="rpt-audit-row">
                    <span className="rpt-audit-label">{t('reports.exec.bench_label')}</span>
                    <span className="rpt-audit-val">{t('reports.exec.bench_val')}</span>
                  </li>
                  <li className="rpt-audit-row">
                    <span className="rpt-audit-label">{t('reports.exec.facility_label')}</span>
                    <span className="rpt-audit-val">{storeId ?? '—'}</span>
                  </li>
                  <li className="rpt-audit-row">
                    <span className="rpt-audit-label">{t('reports.exec.scope_label')}</span>
                    <span className="rpt-audit-val">{k?.n_skus != null ? t('reports.exec.sample_val', { n: fmt.integer(k.n_skus) }) : '—'}</span>
                  </li>
                  <li className="rpt-audit-row">
                    <span className="rpt-audit-label">{t('reports.exec.reviews_label')}</span>
                    <span className="rpt-audit-val">{k ? fmt.integer(curve.length) : '—'}</span>
                  </li>
                  <li className="rpt-audit-row">
                    <span className="rpt-audit-label">{t('reports.exec.basis_label')}</span>
                    <span className="rpt-audit-val">{costBasisText(k?.cost_basis, t)}</span>
                  </li>
                </ul>
              </div>
              <div
                className="rpt-sla-banner"
                style={belowTarget > 0 ? { background: 'var(--color-warning-subtle)', color: 'var(--color-warning-text)' } : undefined}
              >
                <Award size={18} style={{ flexShrink: 0 }} />
                <div>
                  <strong>
                    {t('reports.exec.sla_box_title')} {pct(k?.c3out_overall_availability)}
                  </strong>
                  <div>
                    {t('reports.exec.sla_box_desc', {
                      target: pct(k?.target_availability),
                      below: belowTarget,
                      n: segments.length,
                      b0: pct(k?.b0_overall_availability),
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="rpt-deep-dive">
        <Section title={t('reports.exec.deep_dive_title')} description={t('reports.exec.deep_dive_desc')}>
          <Tabs
            items={[
              { id: 'breakdown', label: t('reports.exec.tab_breakdown') },
              { id: 'policies', label: t('reports.exec.tab_policies') },
              { id: 'accuracy', label: t('reports.exec.tab_accuracy') },
              { id: 'inventory', label: t('reports.exec.tab_inventory') },
              { id: 'whatif', label: t('reports.exec.tab_whatif') },
            ]}
            value={subTab}
            onChange={(v) => setSubTab(v as SubTabId)}
          />
          <div style={{ height: 'var(--space-3)' }} />
          <HoldHeight activeKey={subTab} role="tabpanel">
            {subTab === 'breakdown' && (
              <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
                <Card title={t('reports.cost.title')} description={t('reports.cost.description')} flush>
                  <Table columns={breakdownCols} rows={breakdownRows} rowKey={(r) => r.key} loading={(cost.loading && !c) || (kpi.loading && !k)} emptyTitle={t('reports.exec.chart_empty')} />
                </Card>
                {btResult && (
                  <Card title={t('reports.cost.backtest_title')} description={t('reports.cost.backtest_desc')}>
                    <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                      <KpiTile label={t('reports.cost.bt_days')} value={fmt.integer(btResult.simulated_days)} />
                      <KpiTile label={t('reports.cost.bt_b0_stockouts')} value={btResult.baseline_stockouts != null ? fmt.integer(btResult.baseline_stockouts) : '—'} />
                      <KpiTile label={t('reports.cost.bt_ml_stockouts')} value={btResult.ml_stockouts != null ? fmt.integer(btResult.ml_stockouts) : '—'} />
                      <KpiTile label={t('reports.cost.bt_reduction')} value={btResult.stockout_reduction_pct != null ? fmt.percent(btResult.stockout_reduction_pct, { scale: 'percent', digits: 1, signed: true }) : '—'} />
                      <KpiTile label={t('reports.cost.bt_holding_savings')} value={btResult.holding_cost_savings != null ? fmt.currency(btResult.holding_cost_savings) : '—'} />
                      <KpiTile label={t('reports.cost.bt_service')} value={btResult.service_level_achieved != null ? fmt.percent(btResult.service_level_achieved, { scale: 'percent', digits: 1 }) : '—'} />
                    </div>
                  </Card>
                )}
              </div>
            )}
            {subTab === 'policies' && <PoliciesTab />}
            {subTab === 'accuracy' && <AccuracyTab />}
            {subTab === 'inventory' && <InventoryTab />}
            {subTab === 'whatif' && (
              <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
                <WhatIfPanel storeId={storeId ?? 'CA_1'} isGlobal={!storeId} />
                {storeId && can(user?.role, 'policy:manage') && <RefitPanel storeId={storeId} />}
              </div>
            )}
          </HoldHeight>
        </Section>
      </div>

      {dialog}
    </div>
  );
};

export default Reports;
