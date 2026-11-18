import React, { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Alert, Badge, Card, ChartFrame, ChartTooltip, EmptyState, ErrorState, Skeleton, Table, useChartTheme, type Column } from '../../components/ui/index.ts';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { getFutureForecast, type FutureForecastRow } from '../../services/forecastApi.ts';

/**
 * "Future forecast" tab (demo.md §6.2 screen 2): the 28-day forecast of the production bundle for one SKU. These days
 * are after the end of M5, so there is no actual demand to compare with; the source of every row is shown as served.
 */
export const FutureForecastPanel: React.FC<{ sku: string; store: string }> = ({ sku, store }) => {
  const t = useT();
  const fmt = useFormat();
  const c = useChartTheme();
  const q = useApi((signal) => getFutureForecast(sku, store, signal), [sku, store], { enabled: !!sku && !!store });
  const rows = useMemo(() => (q.data ?? []).filter((r) => r.available !== false), [q.data]);
  const source = q.data?.[0]?.source ?? null;
  const model = q.data?.[0]?.model_version ?? null;
  const data = useMemo(
    () =>
      rows.map((r) => ({
        h: r.h,
        y_pred: r.y_pred,
        p50: r.p50,
        band: r.p10 != null && r.p90 != null ? ([r.p10, r.p90] as [number, number]) : null,
      })),
    [rows],
  );
  const total = rows.reduce((s, r) => s + r.y_pred, 0);
  const num = (v: number | null | undefined) => (v !== null && v !== undefined && Number.isFinite(v) ? fmt.number(v, { digits: 2 }) : '—');
  const columns: Column<FutureForecastRow>[] = [
    { key: 'h', header: 'h', align: 'right', value: (r) => r.h, cell: (r) => <span className="ui-num">{r.h}</span> },
    { key: 'y', header: t('forecast.future.col_mean'), align: 'right', value: (r) => r.y_pred, cell: (r) => <span className="ui-num">{num(r.y_pred)}</span> },
    { key: 'p10', header: 'P10', align: 'right', value: (r) => r.p10, cell: (r) => <span className="ui-num">{num(r.p10)}</span> },
    { key: 'p50', header: 'P50', align: 'right', value: (r) => r.p50, cell: (r) => <span className="ui-num">{num(r.p50)}</span> },
    { key: 'p90', header: 'P90', align: 'right', value: (r) => r.p90, cell: (r) => <span className="ui-num">{num(r.p90)}</span> },
  ];

  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.loading && !q.data) return <Skeleton height={320} />;
  if (!rows.length) return <EmptyState title={t('forecast.future.empty')} description={t('forecast.future.empty_desc', { sku, store })} />;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <Alert tone="info">{t('forecast.future.no_actuals')}</Alert>
      {source && source !== 'production_artifact' && <Alert tone="warning">{t('forecast.future.fallback', { model: model ?? source })}</Alert>}
      <ChartFrame
        title={t('forecast.future.chart_title', { n: rows.length, sku })}
        source={model ?? undefined}
        height={300}
        actions={source ? <Badge tone={source === 'production_artifact' ? 'success' : 'warning'}>{source}</Badge> : undefined}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="h" {...c.axis} tickFormatter={(h: number) => `h${h}`} />
            <YAxis {...c.axis} width={44} domain={[0, 'auto']} />
            <Tooltip cursor={c.cursor} content={<ChartTooltip format={(v) => fmt.number(Number(v), { digits: 2 })} />} />
            <Area dataKey="band" name="P10 – P90" stroke="none" fill={c.series[0]} fillOpacity={0.14} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="y_pred" name={t('forecast.future.col_mean')} stroke={c.series[0]} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            <Line dataKey="p50" name="P50" stroke={c.series[1]} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
      <Card
        title={t('forecast.future.table_title')}
        description={t('forecast.future.table_desc', { total: fmt.number(total, { digits: 1 }), n: rows.length })}
        flush
      >
        <Table columns={columns} rows={rows} rowKey={(r) => String(r.h)} dense maxHeight={360} />
      </Card>
    </div>
  );
};
