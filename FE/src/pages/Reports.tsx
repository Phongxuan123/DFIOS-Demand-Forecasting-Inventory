import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
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
  ErrorState,
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
import { useStore } from '../context/StoreContext.tsx';
import { can } from '../auth/permissions.ts';
import { CoverageTiles } from '../components/common/CoverageTiles.tsx';
import { downloadCsv } from '../utils/csv.ts';
import { useFormat, useT } from '../i18n/index.tsx';
import { useBe } from '../i18n/useBe.ts';
import { insightTexts, policyDescription, policyLabel } from '../utils/policyText.ts';
import { apiErrorMessage, toApiError } from '../services/apiClient.ts';
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

type Objective = 'cost' | 'sla';

/* --------------------------------- Chart ----------------------------------- */
const CostStack: React.FC<{ rows: PolicyRow[] }> = ({ rows }) => {
  const c = useChartTheme();
  const fmt = useFormat();
  const t = useT();
  const be = useBe();
  const data = rows.map((r) => ({ name: policyLabel(t, be, r.policy_key, r.label) || r.policy, holding: r.holding_cost, shortage: r.shortage_cost, ordering: r.ordering_cost }));
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

/* ---------------------------- Tab: policy comparison ----------------------- */
const PoliciesTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const be = useBe();
  const { storeId } = useStore();
  const { user } = useAuth();
  const { version } = useClock();
  const isManager = can(user?.role, 'replenishment:write');
  const [objective, setObjective] = useState<Objective>('cost');

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
    { key: 'f', header: '', value: (r) => (r.is_feasible ? 1 : 0), cell: (r) => <Badge tone={r.is_feasible ? 'success' : 'warning'}>{r.is_feasible ? t('reports.sim.feasible') : t('reports.sim.infeasible')}</Badge> },
  ];

  return (
    <>
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
          <Alert tone="warning" title={t('reports.policy.missing')}>
            {b?.reason ? be(b.reason) : '—'}
          </Alert>
        ) : (
          <>
            {b && (
              <p className="ui-muted">
                <Badge tone={b.simulated ? 'info' : 'neutral'}>{b.source === 'artifact_extract' ? t('reports.policy.source_artifact') : t('reports.policy.source_other', { source: b.source })}</Badge>{' '}
                {b.n_skus != null && t('reports.policy.scale', { skus: fmt.integer(b.n_skus), days: fmt.integer(b.n_days), reviews: fmt.integer(b.n_reviews), lead: b.lead_time_days ?? '—', review: b.review_period_days ?? '—' })}
              </p>
            )}
            <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', margin: 'var(--space-4) 0' }}>
              <CoverageTiles
                loading={bench.loading && !b}
                artifact={b?.coverage_q95}
                artifactSource={b?.coverage_source}
                dbCausal={b?.coverage_q95_db_causal}
                dbCausalN={b?.coverage_q95_db_causal_n}
              />
              <KpiTile
                label={t('reports.policy.obj_cost')}
                loading={bench.loading && !b}
                value={cheapest ? name(cheapest) : null}
                unavailableReason={cheapest ? undefined : t('reports.reason.not_loaded')}
                hint={cheapest ? fmt.number(cheapest.total_cost_bikip, { digits: 0 }) : undefined}
              />
              <KpiTile
                label={t('reports.policy.obj_sla')}
                loading={bench.loading && !b}
                value={topCsl ? name(topCsl) : null}
                unavailableReason={topCsl ? undefined : t('reports.reason.not_loaded')}
                hint={topCsl ? fmt.percent(topCsl.csl, { digits: 1 }) : undefined}
              />
            </div>

            <Card
              title={t('reports.policy.conclusion_title')}
              actions={
                <Tabs
                  items={[
                    { id: 'cost', label: t('reports.policy.obj_cost') },
                    { id: 'sla', label: t('reports.policy.obj_sla') },
                  ]}
                  value={objective}
                  onChange={(v) => setObjective(v as Objective)}
                />
              }
            >
              {cheapest || topCsl ? (
                <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                  {cheapest && (
                    <p>
                      {t('reports.policy.conclusion_cost', {
                        policy: name(cheapest),
                        cost: fmt.number(cheapest.total_cost_bikip, { digits: 0 }),
                        others:
                          withCost
                            .filter((r) => r.policy !== cheapest.policy)
                            .map((r) => `${name(r)} ${fmt.percent((r.total_cost_bikip as number) / (cheapest.total_cost_bikip as number) - 1, { digits: 1, signed: true })}`)
                            .join(', ') || '—',
                      })}
                    </p>
                  )}
                  {topCsl && <p>{t('reports.policy.conclusion_sla', { policy: name(topCsl), csl: fmt.percent(topCsl.csl, { digits: 1 }) })}</p>}
                  {hasP6 && <Alert tone="info">{t('reports.policy.p6_note')}</Alert>}
                </div>
              ) : (
                <p className="ui-muted">{t('reports.policy.conclusion_none')}</p>
              )}
            </Card>

            <div style={{ height: 'var(--space-4)' }} />
            <Card flush>
              <Table columns={cols} rows={rows} rowKey={(r) => r.policy} loading={bench.loading && !b} dense wrap />
            </Card>
            <div style={{ height: 'var(--space-4)' }} />
            <ChartFrame
              title={t('reports.policy.col_total')}
              loading={bench.loading && !b}
              empty={rows.length === 0}
              source="/reports/policy-comparison"
              asOf={b?.as_of ? fmt.date(b.as_of) : undefined}
              height={260}
              footer={
                <ChartLegend
                  items={[
                    { label: t('reports.policy.col_holding'), color: 'var(--chart-1)' },
                    { label: t('reports.policy.col_shortage'), color: 'var(--chart-2)' },
                    { label: t('reports.policy.col_ordering'), color: 'var(--chart-3)' },
                  ]}
                />
              }
            >
              <CostStack rows={rows} />
            </ChartFrame>
            {b?.cost_basis && <DataSourceNote source="/reports/policy-comparison" asOf={b.as_of ? fmt.date(b.as_of) : undefined} note={t('reports.policy.cost_basis', { basis: b.cost_basis })} />}
          </>
        )}
      </Section>

      <Section title={t('reports.sim.title')} description={t('reports.sim.description')}>
        {!isManager ? (
          <Alert tone="info">{t('reports.common.manager_only')}</Alert>
        ) : !storeId ? (
          <EmptyState compact title={t('shell.store.empty')} />
        ) : sim.error ? (
          <ErrorState error={sim.error} onRetry={sim.refetch} compact />
        ) : (
          <>
            {sim.data && (
              <div style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                <p>
                  <Badge tone={sim.data.recommended_policy ? 'accent' : 'neutral'}>
                    {sim.data.recommended_policy
                      ? t('reports.sim.recommended', {
                          policy: policyLabel(t, be, sim.data.recommended_policy_key, sim.data.policies.find((x) => x.policy_id === sim.data?.recommended_policy)?.policy_name ?? sim.data.recommended_policy),
                        })
                      : t('reports.sim.recommended_none')}
                  </Badge>
                </p>
                <p className="ui-muted">
                  {sim.data.simulated ? t('reports.sim.origin_sim') : t('reports.sim.origin_artifact', { scale: fmt.number(sim.data.scale_factor, { digits: 3 }) })}
                </p>
                {sim.data.status !== 'ok' && <Alert tone="warning">{sim.data.reason ? be(sim.data.reason) : sim.data.status}</Alert>}
                {sim.data.insights.length > 0 && (
                  <ul style={{ paddingLeft: 'var(--space-5)' }}>
                    {insightTexts(t, fmt, be, sim.data.insights, sim.data.insight_details).map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <Card flush>
              <Table columns={simCols} rows={sim.data?.policies ?? []} rowKey={(r) => r.policy_id} loading={sim.loading && !sim.data} dense wrap />
            </Card>
            <DataSourceNote source="/simulation/compare-policies" asOf={sim.data?.as_of ? fmt.date(sim.data.as_of) : undefined} note={sim.data?.source} />
          </>
        )}
      </Section>
    </>
  );
};

/* ------------------------------- Tab: accuracy ----------------------------- */
function pickMetric(m: Record<string, unknown> | null, algorithm: string, key: string): number | null {
  if (!m) return null;
  const direct = m[key];
  if (typeof direct === 'number') return direct;
  const nested = m[algorithm] ?? Object.values(m).find((v) => v && typeof v === 'object');
  if (nested && typeof nested === 'object') {
    const v = (nested as Record<string, unknown>)[key];
    if (typeof v === 'number') return v;
  }
  return null;
}

const AccuracyTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const be = useBe();
  const { storeId } = useStore();
  const { user } = useAuth();
  const isAdmin = can(user?.role, 'view:models');
  const acc = useApi((s) => getForecastAccuracy(storeId ?? '', s), [storeId], { enabled: !!storeId });
  const reg = useApi((s) => getRegistryModels(s), [], { enabled: isAdmin });
  const a = acc.data;
  const reason = (a?.metrics_reason ? be(a.metrics_reason) : null) ?? t('reports.reason.not_loaded');
  const metric = (label: string, v: number | null | undefined, digits = 4) => (
    <KpiTile
      label={label}
      loading={acc.loading && !a}
      value={v != null ? fmt.number(v, { digits }) : null}
      unavailableReason={acc.error ? apiErrorMessage(acc.error, t) : v == null ? reason : undefined}
      hint={a ? t('reports.accuracy.samples', { count: fmt.integer(a.overall_metrics.sample_count) }) : undefined}
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
    <>
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
        {abcRows.length > 0 && (
          <>
            <h3 className="ui-section__title" style={{ marginTop: 'var(--space-4)' }}>{t('reports.accuracy.abc')}</h3>
            <Card flush>
              <Table columns={abcCols} rows={abcRows} rowKey={(r) => r.cls} dense />
            </Card>
          </>
        )}
      </Section>
      <Section title={t('reports.accuracy.registry_title')} description={t('reports.accuracy.registry_desc')}>
        {!isAdmin ? (
          <Alert tone="info">{t('reports.accuracy.registry_forbidden')}</Alert>
        ) : (
          <>
            <Card flush>
              <Table columns={regCols} rows={reg.data?.items ?? []} rowKey={(r) => r.id} loading={reg.loading && !reg.data} error={reg.error} onRetry={reg.refetch} dense />
            </Card>
            <DataSourceNote source="/ml/models" />
          </>
        )}
      </Section>
    </>
  );
};

/* ------------------------------ Tab: inventory ----------------------------- */
const InventoryTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const be = useBe();
  const { storeId } = useStore();
  const { version } = useClock();
  const p = usePagination(25);
  const inv = useApi((s) => getInventoryPerformance(storeId ?? '', p.pageSize, p.offset, s), [storeId, version, p.pageSize, p.offset], { enabled: !!storeId });
  const d = inv.data;
  const rowReason = (d?.reason ? be(d.reason) : null) ?? t('reports.reason.not_loaded');
  const tile = (label: string, v: string | null, unavailable?: string) => (
    <KpiTile label={label} loading={inv.loading && !d} value={v} unavailableReason={inv.error ? apiErrorMessage(inv.error, t) : v == null ? unavailable ?? rowReason : undefined} />
  );
  const cols: Column<InventoryPerfItem>[] = [
    { key: 'sku', header: t('reports.inventory.col_sku'), value: (r) => r.item_id, sortable: true },
    { key: 'name', header: t('reports.inventory.col_name'), value: (r) => r.product_name },
    { key: 'cat', header: t('reports.inventory.col_category'), value: (r) => r.category },
    { key: 'oh', header: t('reports.inventory.col_on_hand'), align: 'right', value: (r) => r.on_hand, cell: (r) => fmt.number(r.on_hand, { digits: 0 }) },
    { key: 'dd', header: t('reports.inventory.col_demand'), align: 'right', value: (r) => r.daily_demand, cell: (r) => fmt.number(r.daily_demand, { digits: 2 }) },
    { key: 'dos', header: t('reports.inventory.col_dos'), align: 'right', value: (r) => r.days_of_supply, cell: (r) => (r.days_of_supply == null ? <span title={t('reports.inventory.no_demand')}>—</span> : fmt.number(r.days_of_supply, { digits: 1 })) },
    { key: 'val', header: t('reports.inventory.col_value'), align: 'right', value: (r) => r.inventory_value, cell: (r) => fmt.currency(r.inventory_value) },
    { key: 'to', header: t('reports.inventory.col_turnover'), align: 'right', value: (r) => r.turnover_ratio, cell: (r) => fmt.number(r.turnover_ratio, { digits: 2 }) },
  ];
  const exportRows = () =>
    downloadCsv(
      `inventory-performance-${storeId ?? ''}.csv`,
      ['item_id', 'product_name', 'category', 'store_id', 'on_hand', 'daily_demand', 'days_of_supply', 'inventory_value', 'turnover_ratio'],
      (d?.items ?? []).map((r) => [r.item_id, r.product_name, r.category, r.store_id, r.on_hand, r.daily_demand, r.days_of_supply, r.inventory_value, r.turnover_ratio]),
    );
  return (
    <Section
      title={t('reports.inventory.title')}
      actions={
        <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={exportRows} disabled={!d || d.items.length === 0}>
          {t('reports.common.export_csv')}
        </Button>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 'var(--space-4)' }}>
        {tile(t('reports.inventory.value'), d ? fmt.currency(d.total_inventory_value, { compact: true }) : null)}
        {tile(t('reports.inventory.turnover'), d?.average_turnover_ratio != null ? fmt.number(d.average_turnover_ratio, { digits: 2 }) : null)}
        {tile(t('reports.inventory.dos'), d?.average_days_of_supply != null ? fmt.number(d.average_days_of_supply, { digits: 1 }) : null)}
        {tile(t('reports.inventory.stockout'), d ? fmt.integer(d.stockout_skus_count) : null)}
        {tile(t('reports.inventory.dead'), d ? fmt.currency(d.dead_stock_value, { compact: true }) : null)}
      </div>
      <Card flush>
        <Table
          columns={cols}
          rows={d?.items ?? []}
          rowKey={(r) => `${r.item_id}|${r.store_id}`}
          loading={inv.loading && !d}
          error={inv.error}
          onRetry={inv.refetch}
          dense
          pagination={{ page: p.page, pageSize: p.pageSize, onPageChange: p.setPage, onPageSizeChange: p.setPageSize, total: d?.total ?? 0 }}
        />
      </Card>
      <DataSourceNote source="/reports/inventory-performance" note={d ? `${d.source}, ${t('reports.common.store', { store: storeId ?? '—' })}` : undefined} />
    </Section>
  );
};

/* -------------------------------- Tab: cost -------------------------------- */
const CostTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const be = useBe();
  const toast = useToast();
  const { storeId } = useStore();
  const { user } = useAuth();
  const { version } = useClock();
  const isAdmin = can(user?.role, 'models:manage');
  const { confirm, dialog } = useConfirm();
  const cost = useApi((s) => getCostComparison(storeId ?? '', s), [storeId, version], { enabled: !!storeId && isAdmin });
  const [bt, setBt] = useState<Backtest | null>(null);
  const [running, setRunning] = useState(false);
  const c = cost.data;

  const runBacktest = async () => {
    if (!storeId) return;
    if (!(await confirm({ title: t('reports.cost.backtest_confirm_title'), description: t('reports.cost.backtest_confirm_body', { store: storeId }) }))) return;
    setRunning(true);
    try {
      setBt(await postBacktest(storeId));
    } catch (err) {
      toast.error(t('reports.cost.bt_failed'), apiErrorMessage(toApiError(err), t));
    } finally {
      setRunning(false);
    }
  };

  if (!isAdmin) return <Alert tone="info">{t('reports.common.admin_only')}</Alert>;

  const items = c?.baseline_policy && c.ml_policy
    ? [
        { key: 'h', label: t('reports.cost.holding'), b0: c.baseline_policy.holding_cost, c3: c.ml_policy.holding_cost },
        { key: 'o', label: t('reports.cost.order'), b0: c.baseline_policy.order_cost, c3: c.ml_policy.order_cost },
        { key: 'p', label: t('reports.cost.penalty'), b0: c.baseline_policy.stockout_penalty_cost, c3: c.ml_policy.stockout_penalty_cost },
        { key: 't', label: t('reports.cost.total'), b0: c.baseline_policy.total_cost, c3: c.ml_policy.total_cost },
      ]
    : [];
  const costCols: Column<(typeof items)[number]>[] = [
    { key: 'label', header: t('reports.cost.col_item'), value: (r) => r.label },
    { key: 'b0', header: t('reports.cost.baseline'), align: 'right', value: (r) => r.b0, cell: (r) => fmt.number(r.b0, { digits: 0 }) },
    { key: 'c3', header: t('reports.cost.ml'), align: 'right', value: (r) => r.c3, cell: (r) => fmt.number(r.c3, { digits: 0 }) },
  ];
  const btTile = (label: string, v: string | null) => <KpiTile label={label} value={v} unavailableReason={(bt?.reason ? be(bt.reason) : null) ?? t('reports.reason.not_loaded')} />;

  return (
    <>
      <Section
        title={t('reports.cost.title')}
        description={t('reports.cost.description')}
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Download size={14} />}
            disabled={items.length === 0}
            onClick={() => downloadCsv(`cost-comparison-${storeId ?? ''}.csv`, ['item', 'b0', 'c3out'], items.map((r) => [r.label, r.b0, r.c3]))}
          >
            {t('reports.common.export_csv')}
          </Button>
        }
      >
        {cost.error ? (
          <ErrorState error={cost.error} onRetry={cost.refetch} />
        ) : (
          <>
            <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 'var(--space-4)' }}>
              <KpiTile
                label={t('reports.cost.savings')}
                loading={cost.loading && !c}
                value={c?.cost_savings_amount != null ? fmt.currency(c.cost_savings_amount, { compact: true }) : null}
                unavailableReason={(c?.reason ? be(c.reason) : null) ?? t('reports.reason.not_loaded')}
              />
              <KpiTile
                label={t('reports.cost.savings_pct')}
                loading={cost.loading && !c}
                value={c?.savings_percentage != null ? fmt.percent(c.savings_percentage, { scale: 'percent', digits: 1, signed: true }) : null}
                unavailableReason={(c?.reason ? be(c.reason) : null) ?? t('reports.reason.not_loaded')}
              />
            </div>
            <Card flush>
              <Table columns={costCols} rows={items} rowKey={(r) => r.key} loading={cost.loading && !c} unavailableReason={c && items.length === 0 ? (c.reason ? be(c.reason) : null) ?? t('reports.reason.not_loaded') : undefined} dense />
            </Card>
            {c && (
              <DataSourceNote
                source="/reports/cost-comparison"
                asOf={c.as_of ? fmt.date(c.as_of) : undefined}
                note={`${c.source}. ${c.period_start && c.period_end ? t('reports.cost.period', { from: fmt.date(c.period_start), to: fmt.date(c.period_end) }) + '. ' : ''}${t('reports.policy.cost_basis', { basis: c.cost_basis })}`}
              />
            )}
          </>
        )}
      </Section>

      <Section
        title={t('reports.cost.backtest_title')}
        description={t('reports.cost.backtest_desc')}
        actions={
          <Button variant="primary" size="sm" loading={running} onClick={runBacktest} disabled={!storeId}>
            {t('reports.cost.backtest_run')}
          </Button>
        }
      >
        {bt && (
          <>
            <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              {btTile(t('reports.cost.bt_days'), fmt.integer(bt.simulated_days))}
              {btTile(t('reports.cost.bt_b0_stockouts'), bt.baseline_stockouts != null ? fmt.integer(bt.baseline_stockouts) : null)}
              {btTile(t('reports.cost.bt_ml_stockouts'), bt.ml_stockouts != null ? fmt.integer(bt.ml_stockouts) : null)}
              {btTile(t('reports.cost.bt_reduction'), bt.stockout_reduction_pct != null ? fmt.percent(bt.stockout_reduction_pct, { scale: 'percent', digits: 1, signed: true }) : null)}
              {btTile(t('reports.cost.bt_holding_savings'), bt.holding_cost_savings != null ? fmt.currency(bt.holding_cost_savings, { compact: true }) : null)}
              {btTile(t('reports.cost.bt_service'), bt.service_level_achieved != null ? fmt.percent(bt.service_level_achieved, { scale: 'percent', digits: 1 }) : null)}
            </div>
            <DataSourceNote source="/reports/backtesting" asOf={bt.as_of ? fmt.date(bt.as_of) : undefined} note={bt.source} />
          </>
        )}
      </Section>
      {dialog}
    </>
  );
};

/* ---------------------------------- Page ---------------------------------- */
type TabId = 'policies' | 'accuracy' | 'inventory' | 'cost';

export const Reports: React.FC = () => {
  const t = useT();
  const { storeId } = useStore();
  const [tab, setTab] = useState<TabId>('policies');
  return (
    <>
      <PageHeader
        title={t('reports.title')}
        description={t('reports.description')}
        meta={storeId ? <Badge tone="accent">{t('reports.common.store', { store: storeId })}</Badge> : undefined}
      />
      <Tabs
        items={[
          { id: 'policies', label: t('reports.tabs.policies') },
          { id: 'accuracy', label: t('reports.tabs.accuracy') },
          { id: 'inventory', label: t('reports.tabs.inventory') },
          { id: 'cost', label: t('reports.tabs.cost') },
        ]}
        value={tab}
        onChange={(v) => setTab(v as TabId)}
      />
      <div style={{ height: 'var(--space-4)' }} />
      {tab === 'policies' && <PoliciesTab />}
      {tab === 'accuracy' && <AccuracyTab />}
      {tab === 'inventory' && <InventoryTab />}
      {tab === 'cost' && <CostTab />}
    </>
  );
};

export default Reports;
