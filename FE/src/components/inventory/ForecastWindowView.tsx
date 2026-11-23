import React, { useState } from 'react';
import { useClock } from '../../context/ClockContext.tsx';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT, type TKey } from '../../i18n/index.tsx';
import { getForecastWindow, type ForecastWindowResponse, type MethodError } from '../../services/inventoryScreenApi.ts';
import { Alert, Badge, Button, Card, DataSourceNote, EmptyState, ErrorState, Input, KpiTile, Skeleton, Table, type Column } from '../ui/index.ts';
import './inventory.css';

const METHOD_KEY: Record<MethodError['method'], TKey> = {
  model: 'inventory.window.method_model',
  snaive: 'inventory.window.method_snaive',
  naive: 'inventory.window.method_naive',
  ma28: 'inventory.window.method_ma28',
  lgbm: 'inventory.window.method_lgbm',
  holt_winters: 'inventory.window.method_holt_winters',
};

interface BoxMark {
  key: string;
  label: string;
  value: number;
}

export const WindowBox: React.FC<{ data: ForecastWindowResponse }> = ({ data }) => {
  const t = useT();
  const fmt = useFormat();
  const d = data.distribution;
  const marks: BoxMark[] = [
    d.q_min != null ? { key: 'min', label: t('inventory.window.box_min', { level: fmt.number(d.min_level, { maxDigits: 3 }) }), value: d.q_min } : null,
    d.q50 != null ? { key: 'q50', label: 'Q50', value: d.q50 } : null,
    d.q80 != null ? { key: 'q80', label: 'Q80', value: d.q80 } : null,
    d.q90 != null ? { key: 'q90', label: 'Q90', value: d.q90 } : null,
    d.q95 != null ? { key: 'q95', label: 'Q95', value: d.q95 } : null,
    d.q99 != null ? { key: 'q99', label: 'Q99', value: d.q99 } : null,
  ].filter((m): m is BoxMark => m !== null);
  const values = [...marks.map((m) => m.value), d.point_window];
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 1);
  const span = hi - lo || 1;
  const x = (v: number) => 4 + ((v - lo) / span) * 92;
  const get = (k: string) => marks.find((m) => m.key === k)?.value;
  const q50 = get('q50');
  const q90 = get('q90');
  const qMin = get('min');
  const q99 = get('q99');
  const q95 = get('q95');

  return (
    <div className="inv-box">
      <svg className="inv-box__svg" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={t('inventory.window.title')}>
        {qMin != null && q99 != null && <line className="inv-box__whisker" x1={x(qMin)} x2={x(q99)} y1={15} y2={15} />}
        {q50 != null && q90 != null && <rect className="inv-box__body" x={x(q50)} y={6} width={Math.max(0.5, x(q90) - x(q50))} height={18} />}
        {q95 != null && <line className="inv-box__q95" x1={x(q95)} x2={x(q95)} y1={2} y2={28} />}
        <circle className="inv-box__point" cx={x(d.point_window)} cy={15} r={1.6} />
      </svg>
      <dl className="inv-box__legend">
        {marks.map((m) => (
          <div key={m.key} className={m.key === 'q95' ? 'inv-box__item inv-box__item--q95' : 'inv-box__item'}>
            <dt>{m.key === 'q95' ? t('inventory.window.q95_line') : m.label}</dt>
            <dd>{fmt.number(m.value, { maxDigits: 2 })}</dd>
          </div>
        ))}
        <div className="inv-box__item inv-box__item--point">
          <dt>{t('inventory.window.point')}</dt>
          <dd>{fmt.number(d.point_window, { maxDigits: 2 })}</dd>
        </div>
      </dl>
    </div>
  );
};

export const ForecastWindowView: React.FC<{ data: ForecastWindowResponse }> = ({ data }) => {
  const t = useT();
  /** BE notes are English sentences; the known ones are shown in the active language, others as sent. */
  const noteText = (n: string): string =>
    n.startsWith('Daily quantiles are not added up')
      ? t('inventory.window.note_daily')
      : n.startsWith('Baselines: SNaive, Naive, MA28')
        ? t('inventory.window.note_baselines')
        : n.startsWith('SKU has no ABC-XYZ class')
          ? t('inventory.window.note_no_class')
          : n.startsWith('No policy_selection row')
            ? t('inventory.window.note_no_policy')
            : n.startsWith('No sales in the 56 days')
              ? t('inventory.window.note_no_sales')
              : n;
  const fmt = useFormat();
  const d = data.distribution;
  const st = data.error_stats;
  const p = data.policy;
  const H = data.horizon_days;
  const reasonKey: Record<string, TKey> = {
    no_model_windows: 'inventory.window.no_model_windows',
    no_complete_windows: 'inventory.window.no_complete_windows',
    no_mase_scale: 'inventory.window.no_mase_scale',
  };
  const columns: Column<MethodError>[] = [
    { key: 'method', header: t('inventory.window.method'), cell: (r) => t(METHOD_KEY[r.method]) },
    { key: 'mase', header: t('inventory.window.mase'), align: 'right', cell: (r) => fmt.number(r.mase, { digits: 3 }) },
    { key: 'mae', header: t('inventory.window.mae'), align: 'right', cell: (r) => fmt.number(r.mae, { digits: 2 }) },
    { key: 'bias', header: t('inventory.window.bias'), align: 'right', cell: (r) => fmt.number(r.bias, { digits: 2 }) },
    { key: 'bias_pct', header: t('inventory.window.bias_pct'), align: 'right', cell: (r) => fmt.percent(r.bias_pct, { digits: 1, signed: true }) },
  ];

  return (
    <div className="ui-stack">
      <Card
        title={t('inventory.window.title')}
        description={t('inventory.window.description', { h: H, l: data.lead_time_days, r: data.review_period_days })}
        actions={
          <div className="inv-badges">
            <Badge tone={d.stored ? 'success' : 'info'}>{d.stored ? t('inventory.window.stored') : t('inventory.window.computed')}</Badge>
            <Badge>{t('inventory.window.route', { route: d.route })}</Badge>
            {d.n_residuals != null && <Badge>{t('inventory.window.residuals', { n: d.n_residuals })}</Badge>}
          </div>
        }
      >
        <WindowBox data={data} />
        <Alert tone="info" title={t('inventory.window.why_title')}>
          {t('inventory.window.why_body', { h: H })}
        </Alert>
      </Card>

      <Card title={t('inventory.window.errors_title')} description={t('inventory.window.errors_description', { h: H, n: st.n_windows, days: st.lookback_days })} flush>
        {st.reason_code && (
          <div className="inv-pad">
            <Alert tone="warning">{t(reasonKey[st.reason_code], { h: H })}</Alert>
          </div>
        )}
        <Table columns={columns} rows={st.methods} rowKey={(r) => r.method} dense />
        {st.model_source && (
          <div className="inv-pad">
            <DataSourceNote source={t('inventory.window.errors_source', { source: st.model_source })} />
          </div>
        )}
      </Card>

      <Card title={t('inventory.window.policy_title')} description={t('inventory.window.policy_description')}>
        <div className="inv-policy-grid">
          <KpiTile label={t('inventory.window.segment')} value={p.segment ?? t('inventory.window.no_segment')} />
          <KpiTile label={t('inventory.window.q_tau')} value={fmt.number(p.q_hat_tau, { maxDigits: 2 })} hint={`${t('inventory.window.tau')} = ${fmt.number(p.tau, { maxDigits: 4 })}`} />
          <KpiTile
            label={`${t('inventory.window.m_g')} · ${t('inventory.window.theta_g')} · ${t('inventory.window.kappa_g')}`}
            value={`${fmt.number(p.m_g, { maxDigits: 2 })} · ${fmt.number(p.theta_g, { maxDigits: 3 })} · ${fmt.number(p.kappa_g, { maxDigits: 2 })}`}
          />
          <KpiTile label={t('inventory.window.eoq')} value={fmt.number(p.eoq, { maxDigits: 2 })} hint={`${t('inventory.window.mu56')}: ${fmt.number(p.mean_daily_56, { maxDigits: 3 })}`} />
          <KpiTile
            label={`${t('inventory.window.s')} / ${t('inventory.window.S')}`}
            value={`${fmt.integer(p.s)} / ${fmt.integer(p.S)}`}
            hint={p.stored_s != null ? t('inventory.window.stored_sS', { s: fmt.integer(p.stored_s), S: fmt.integer(p.stored_S) }) : t('inventory.window.stored_none')}
          />
        </div>
        {data.notes.length > 0 && (
          <ul className="inv-notes">
            {data.notes.map((n) => (
              <li key={n}>{noteText(n)}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export const ForecastWindowPanel: React.FC<{ sku: string; store: string | null }> = ({ sku, store }) => {
  const t = useT();
  const fmt = useFormat();
  const clock = useClock();
  const [reviewDate, setReviewDate] = useState('');
  const ready = !!sku && !!store;
  const res = useApi((signal) => getForecastWindow(store as string, sku, reviewDate || undefined, signal), [sku, store, reviewDate, clock.version], {
    enabled: ready,
  });
  const maxDate = clock.status === 'ready' && clock.clock ? clock.clock.current_date.slice(0, 10) : undefined;

  if (!ready) return <EmptyState title={t('inventory.window.no_sku')} />;
  return (
    <div className="ui-stack inv-window">
      <div className="inv-window__bar">
        <Input
          type="date"
          label={t('inventory.window.review_date')}
          value={reviewDate || res.data?.review_date || ''}
          max={maxDate}
          onChange={(e) => setReviewDate(e.target.value)}
        />
        <Button variant="secondary" size="sm" onClick={() => setReviewDate('')} disabled={!reviewDate}>
          {t('inventory.window.use_clock')}
        </Button>
        {res.data && <DataSourceNote source={t('inventory.window.source', { store: res.data.store_id })} asOf={fmt.date(res.data.review_date)} />}
      </div>
      {res.loading && !res.data ? (
        <Skeleton height={220} />
      ) : res.error ? (
        <ErrorState error={res.error} onRetry={res.refetch} />
      ) : res.data ? (
        <ForecastWindowView data={res.data} />
      ) : null}
    </div>
  );
};
