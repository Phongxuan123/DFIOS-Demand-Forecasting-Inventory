import React, { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Alert, ChartFrame, ChartTooltip, ErrorState, KpiTile, Section, useChartTheme } from '../../components/ui/index.ts';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT, type TKey } from '../../i18n/index.tsx';
import { getForecastQuality, type ForecastQuality } from '../../services/metricsApi.ts';

const COVERAGE_TARGET = 0.95;

const KNOWN_STATUS = new Set(['no_data', 'no_complete_window', 'no_levels']);

const CoverageChart: React.FC<{ data: { tau: number; actual: number | null }[] }> = ({ data }) => {
  const c = useChartTheme();
  const fmt = useFormat();
  const t = useT();
  const rows = data.map((d) => ({ tau: d.tau, actual: d.actual, nominal: d.tau }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="tau" {...c.axis} tickFormatter={(v: number) => fmt.number(v, { digits: 2 })} />
        <YAxis {...c.axis} width={48} domain={[0, 1]} tickFormatter={(v: number) => fmt.percent(v, { digits: 0 })} />
        <RTooltip content={<ChartTooltip format={(v) => fmt.percent(v, { digits: 1 })} formatLabel={(l) => `τ = ${fmt.number(Number(l), { digits: 2 })}`} />} cursor={false} />
        <Line type="monotone" dataKey="nominal" name={t('metrics.quality.series_nominal')} stroke={c.series[2]} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="actual" name={t('metrics.quality.series_actual')} stroke={c.series[0]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
};

export const ForecastQualityPanel: React.FC<{ storeId: string | null; version?: number }> = ({ storeId, version = 0 }) => {
  const t = useT();
  const fmt = useFormat();
  const q = useApi((s) => getForecastQuality(storeId ?? '', {}, s), [storeId, version], { enabled: !!storeId });
  const d: ForecastQuality | undefined = q.data;
  const ok = d?.status === 'ok';

  const points = useMemo(
    () =>
      Object.entries(d?.coverage ?? {})
        .map(([tau, v]) => ({ tau: Number(tau), actual: v }))
        .filter((p) => Number.isFinite(p.tau))
        .sort((a, b) => a.tau - b.tau),
    [d],
  );

  const cov95 = d?.coverage?.[String(COVERAGE_TARGET)] ?? null;
  const loading = q.loading && !d;
  const tile = (label: string, value: string | null, hint?: string) => (
    <KpiTile label={label} value={ok ? value : null} loading={loading} hint={ok ? hint : undefined} unavailableReason={!loading && (!ok || value == null) ? t('reports.reason.not_loaded') : undefined} />
  );

  const notOkMessage = d && !ok
    ? [d.detail || (KNOWN_STATUS.has(d.status) ? t(`metrics.quality.status_${d.status}` as TKey) : t('metrics.quality.status_other', { status: d.status }))]
    : [];
  const notes = Array.isArray(d?.notes) ? d?.notes : d?.notes ? [d.notes] : [];

  return (
    <Section
      title={t('metrics.quality.title')}
      description={d && ok ? `${t('metrics.quality.description')} ${t('metrics.quality.scope', { origins: fmt.integer(d.n_origins ?? 0), items: fmt.integer(d.n_items_used ?? 0), h: d.horizon_days })}` : t('metrics.quality.description')}
    >
      {!storeId ? (
        <Alert tone="info">{t('metrics.quality.no_store')}</Alert>
      ) : q.error && !d ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {notOkMessage.length > 0 && <Alert tone="warning">{notOkMessage[0]}</Alert>}
          <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            {tile(
              t('metrics.quality.coverage'),
              cov95 != null ? fmt.percent(cov95, { digits: 1 }) : null,
              t('metrics.quality.coverage_hint', { target: fmt.percent(COVERAGE_TARGET, { digits: 0 }), n: fmt.integer(d?.n_windows ?? 0) }),
            )}
            {tile(t('metrics.quality.spl'), d?.spl != null ? fmt.number(d.spl, { digits: 3 }) : null, t('metrics.quality.spl_hint'))}
            {tile(t('metrics.quality.mase'), d?.mase_median != null ? fmt.number(d.mase_median, { digits: 3 }) : null, t('metrics.quality.mase_hint'))}
            {tile(t('metrics.quality.bias'), d?.median_bias_pct != null ? fmt.percent(d.median_bias_pct, { scale: 'percent', digits: 1, signed: true }) : null, t('metrics.quality.bias_hint'))}
          </div>
          {ok && (
            <ChartFrame
              title={t('metrics.quality.chart_title')}
              description={t('metrics.quality.chart_desc')}
              height={240}
              empty={points.length === 0}
              source={t('metrics.quality.source', { store: storeId })}
            >
              <CoverageChart data={points} />
            </ChartFrame>
          )}
          {notes.map((n) => (
            <Alert key={n} tone="info">
              {n}
            </Alert>
          ))}
        </div>
      )}
    </Section>
  );
};
