import React, { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Alert, Badge, Button, Card, DataSourceNote, Input, Section, Select, Table, type Column } from '../../components/ui/index.ts';
import { useElapsed } from '../../hooks/useElapsed.ts';
import { useFormat, useT, type TKey } from '../../i18n/index.tsx';
import { BeText } from '../../i18n/BeText.tsx';
import { apiErrorMessage, toApiError, type ApiError } from '../../services/apiClient.ts';
import { isWhatIfResponse, postWhatIf, type WhatIfClassResult, type WhatIfPolicyResult, type WhatIfResponse } from '../../services/reportsApi.ts';
import {
  LEAD_TIMES,
  REVIEW_PERIODS,
  WHAT_IF_DEFAULTS,
  availabilityRatio,
  toWhatIfRequest,
  validateWhatIf,
  whatIfHighlights,
  type WhatIfField,
  type WhatIfForm,
} from '../../utils/whatIf.ts';

const KNOWN_POLICY_KEYS = ['current', 'raw_quantile'];

type RunState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: WhatIfResponse }
  | { kind: 'malformed' }
  | { kind: 'unsupported' }
  | { kind: 'error'; error: ApiError };

/**
 * FR10 what-if (Reports > Policies). Calls POST /simulation/what-if, a REAL replay of past reviews of the store
 * with the user's L, R, h, b, c. Honest states: not available on this backend (404/405), refused inputs (422 with
 * reason), insufficient data, malformed answer. Nothing is computed or estimated in the browser.
 */
export const WhatIfPanel: React.FC<{ storeId: string | null; isGlobal: boolean }> = ({ storeId, isGlobal }) => {
  const t = useT();
  const fmt = useFormat();
  const [form, setForm] = useState<WhatIfForm>({ ...WHAT_IF_DEFAULTS });
  const [touched, setTouched] = useState(false);
  const [state, setState] = useState<RunState>({ kind: 'idle' });
  // R5F-07: a failed later run does not wipe the last successful result (it is labelled as previous)
  const [lastResult, setLastResult] = useState<WhatIfResponse | null>(null);
  // H1: R values the server can replay for this store and L (`r_options` of the last answer, success or 422);
  // unknown (null) until the first answer for the selected L, then every R is offered and the server decides
  const [rOptions, setROptions] = useState<{ store: string; L: string; r: number[] } | null>(null);
  const supportedR = rOptions && rOptions.store === storeId && rOptions.L === form.L ? rOptions.r : null;
  const [showClasses, setShowClasses] = useState<string | null>(null);
  const elapsed = useElapsed(state.kind === 'running');

  const errors = validateWhatIf(form);
  const invalid = Object.keys(errors).length > 0;
  const fieldError = (k: WhatIfField) => (touched && errors[k] ? t(errors[k] === 'required' ? 'reports.whatif.err_required' : (`reports.whatif.err_range_${k}` as TKey)) : undefined);
  const set = (k: WhatIfField) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const run = async () => {
    setTouched(true);
    if (invalid || !storeId) return;
    setState({ kind: 'running' });
    try {
      const res = await postWhatIf(toWhatIfRequest(storeId, form));
      if (isWhatIfResponse(res)) {
        setState({ kind: 'done', result: res });
        setLastResult(res);
        if (Array.isArray(res.r_options)) setROptions({ store: storeId, L: form.L, r: res.r_options.map(Number) });
      } else setState({ kind: 'malformed' });
      setShowClasses(null);
    } catch (err) {
      const e = toApiError(err);
      if (e.status === 404 || e.status === 405) setState({ kind: 'unsupported' });
      else {
        setState({ kind: 'error', error: e });
        const d = e.data as { r_options?: unknown; supported_review_period_days?: unknown } | undefined;
        const sup = d?.r_options ?? d?.supported_review_period_days;
        if (Array.isArray(sup)) setROptions({ store: storeId, L: form.L, r: sup.map(Number) });
      }
    }
  };

  const policyName = (p: WhatIfPolicyResult) => (KNOWN_POLICY_KEYS.includes(p.policy_key) ? t(`reports.whatif.policy_${p.policy_key}` as TKey) : p.label || p.policy_key);
  const result = state.kind === 'done' ? state.result : state.kind === 'error' ? lastResult : null;
  const showingPrevious = state.kind === 'error' && !!lastResult;
  const hl = result ? whatIfHighlights(result.policies) : { cheapest: null, bestService: null };

  const cols: Column<WhatIfPolicyResult>[] = [
    {
      key: 'policy',
      header: t('reports.whatif.col_policy'),
      value: (p) => policyName(p),
      cell: (p) => (
        <span>
          {policyName(p)} {hl.cheapest === p.policy_key && <Badge tone="success">{t('reports.whatif.cheapest')}</Badge>}{' '}
          {hl.bestService === p.policy_key && <Badge tone="info">{t('reports.whatif.best_service')}</Badge>}
        </span>
      ),
    },
    { key: 'av', header: t('reports.whatif.col_availability'), align: 'right', value: (p) => availabilityRatio(p.overall), cell: (p) => fmt.percent(availabilityRatio(p.overall), { digits: 1 }) },
    { key: 'fill', header: t('reports.whatif.col_fill'), align: 'right', value: (p) => p.overall.fill_rate ?? null, cell: (p) => fmt.percent(p.overall.fill_rate, { digits: 1 }) },
    { key: 'total', header: t('reports.whatif.col_total'), align: 'right', value: (p) => p.overall.total_cost, cell: (p) => fmt.currency(p.overall.total_cost, { digits: 0 }) },
    { key: 'h', header: t('reports.whatif.col_holding'), align: 'right', value: (p) => p.overall.holding_cost, cell: (p) => fmt.currency(p.overall.holding_cost, { digits: 0 }) },
    { key: 's', header: t('reports.whatif.col_shortage'), align: 'right', value: (p) => p.overall.shortage_cost, cell: (p) => fmt.currency(p.overall.shortage_cost, { digits: 0 }) },
    { key: 'o', header: t('reports.whatif.col_ordering'), align: 'right', value: (p) => p.overall.ordering_cost, cell: (p) => fmt.currency(p.overall.ordering_cost, { digits: 0 }) },
    { key: 'orders', header: t('reports.whatif.col_orders'), align: 'right', value: (p) => p.overall.orders, cell: (p) => fmt.integer(p.overall.orders) },
    {
      key: 'detail',
      header: <span className="ui-sr-only">{t('reports.whatif.by_class')}</span>,
      align: 'right',
      cell: (p) => (
        <Button size="sm" variant="ghost" aria-expanded={showClasses === p.policy_key} onClick={() => setShowClasses((s) => (s === p.policy_key ? null : p.policy_key))}>
          {t('reports.whatif.by_class')}
        </Button>
      ),
    },
  ];

  const classCols: Column<WhatIfClassResult>[] = [
    { key: 'cls', header: t('reports.whatif.col_class'), value: (r) => r.class_id, sortable: true },
    {
      key: 'm',
      header: 'm_g',
      align: 'right',
      value: (r) => r.m_g,
      cell: (r) =>
        r.params_source === 'default_no_stored_selection' ? (
          <span className="ui-row" style={{ justifyContent: 'flex-end' }} title={t('reports.whatif.params_default')}>
            <Badge tone="warning">{t('reports.whatif.params_default_short')}</Badge>
            {fmt.number(r.m_g, { digits: 2 })}
          </span>
        ) : (
          fmt.number(r.m_g, { digits: 2 })
        ),
    },
    { key: 'k', header: 'κ_g', align: 'right', value: (r) => r.kappa_g, cell: (r) => fmt.number(r.kappa_g, { digits: 2 }) },
    { key: 'th', header: 'θ_g', align: 'right', value: (r) => r.theta_g ?? null, cell: (r) => fmt.number(r.theta_g, { digits: 3 }) },
    { key: 'av', header: t('reports.whatif.col_availability'), align: 'right', value: (r) => availabilityRatio(r), cell: (r) => fmt.percent(availabilityRatio(r), { digits: 1 }) },
    { key: 'total', header: t('reports.whatif.col_total'), align: 'right', value: (r) => r.total_cost, cell: (r) => fmt.currency(r.total_cost, { digits: 0 }) },
    { key: 'n', header: t('reports.whatif.col_items'), align: 'right', value: (r) => r.n_items ?? null, cell: (r) => fmt.integer(r.n_items) },
  ];

  const selected = result?.policies.find((p) => p.policy_key === showClasses) ?? null;

  return (
    <Section title={t('reports.whatif.title')} description={t('reports.whatif.description')}>
      <Card>
        <form
          className="ui-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          {isGlobal && <Alert tone="info">{t('reports.whatif.global')}</Alert>}
          <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', alignItems: 'start' }}>
            <Select
              label={t('reports.whatif.L')}
              hint={t('reports.whatif.L_hint')}
              value={form.L}
              onChange={set('L')}
              options={LEAD_TIMES.map((d) => ({ value: String(d), label: t('reports.whatif.days', { n: d }) }))}
              disabled={state.kind === 'running'}
            />
            <Select
              label={t('reports.whatif.R')}
              hint={t('reports.whatif.R_hint')}
              value={form.R}
              onChange={set('R')}
              options={REVIEW_PERIODS.map((d) => {
                // H1: R = 1 is offered unless the server's r_options (for this store and L) exclude it; the selected
                // R is never disabled, so a refused choice stays visible next to the server's message
                const unavailable = !!supportedR && !supportedR.includes(d);
                return {
                  value: String(d),
                  label: unavailable ? t('reports.whatif.days_unavailable', { n: d }) : t('reports.whatif.days', { n: d }),
                  disabled: unavailable && String(d) !== form.R,
                };
              })}
              disabled={state.kind === 'running'}
            />
            <Input label={t('reports.whatif.h')} hint={t('reports.whatif.h_hint')} inputMode="decimal" value={form.h} onChange={(e) => set('h')(e.target.value)} error={fieldError('h')} disabled={state.kind === 'running'} />
            <Input label={t('reports.whatif.b')} hint={t('reports.whatif.b_hint')} inputMode="decimal" value={form.b} onChange={(e) => set('b')(e.target.value)} error={fieldError('b')} disabled={state.kind === 'running'} />
            <Input label={t('reports.whatif.c')} hint={t('reports.whatif.c_hint')} inputMode="decimal" value={form.c} onChange={(e) => set('c')(e.target.value)} error={fieldError('c')} disabled={state.kind === 'running'} />
          </div>
          <div className="ui-row" style={{ alignItems: 'center' }}>
            <Button type="submit" variant="primary" leftIcon={<FlaskConical size={16} />} loading={state.kind === 'running'} disabled={!storeId || isGlobal}>
              {t('reports.whatif.run')}
            </Button>
            <Button variant="ghost" onClick={() => setForm({ ...WHAT_IF_DEFAULTS })} disabled={state.kind === 'running'}>
              {t('reports.whatif.reset')}
            </Button>
            {state.kind === 'running' && (
              <span className="ui-muted" aria-hidden="true">
                {t('common.misc.elapsed', { seconds: elapsed })}
              </span>
            )}
          </div>
          <div aria-live="polite">
            {state.kind === 'running' && <span className="ui-sr-only">{t('reports.whatif.running')}</span>}
            {state.kind === 'unsupported' && <Alert tone="warning" title={t('reports.whatif.unsupported_title')}>{t('reports.whatif.unsupported')}</Alert>}
            {state.kind === 'malformed' && <Alert tone="warning">{t('reports.whatif.malformed')}</Alert>}
            {state.kind === 'error' && (
              <Alert tone={state.error.kind === 'validation' ? 'warning' : 'danger'} title={t(state.error.kind === 'validation' ? 'reports.whatif.refused' : 'reports.whatif.failed')}>
                {apiErrorMessage(state.error, t, 'whatif')}
                {showingPrevious && <div className="ui-muted" style={{ marginTop: 'var(--space-1)' }}>{t('reports.whatif.showing_previous')}</div>}
              </Alert>
            )}
          </div>
        </form>
      </Card>

      {result && (
        <div className="ui-stack" style={{ marginTop: 'var(--space-4)' }}>
          <p className="ui-muted" style={{ margin: 0 }}>
            <Badge tone={result.simulated ? 'success' : 'neutral'}>{result.simulated ? t('reports.whatif.badge_simulated') : result.source}</Badge>{' '}
            {t('reports.whatif.summary', {
              store: result.store_id,
              L: result.lead_time_days,
              R: result.review_period_days,
              n: fmt.integer(result.n_reviews),
              from: fmt.date(result.period_start),
              to: fmt.date(result.period_end),
              tau: fmt.number(result.tau, { digits: 3 }),
            })}
          </p>
          {result.policies.length === 0 ? (
            <Alert tone="warning">{t('reports.whatif.no_policies')}</Alert>
          ) : (
            <Card flush>
              <Table columns={cols} rows={result.policies} rowKey={(p) => p.policy_key} dense wrap />
            </Card>
          )}
          {selected && (
            <Card title={t('reports.whatif.by_class_title', { policy: policyName(selected) })} flush>
              <Table columns={classCols} rows={selected.by_class} rowKey={(r) => r.class_id} dense />
            </Card>
          )}
          {(result.skipped_classes ?? []).length > 0 && (
            <Alert tone="info" title={t('reports.whatif.skipped_title')}>
              <ul style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
                {(result.skipped_classes ?? []).map((s) => (
                  <li key={s.class_id}>
                    {s.class_id}: <BeText text={s.reason} code={`whatif_${s.reason_code}`} />
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {(result.notes ?? []).length > 0 && (
            <ul className="ui-muted" style={{ margin: 0, paddingLeft: 'var(--space-5)', fontSize: 'var(--text-xs)' }}>
              {(result.notes ?? []).map((n) => (
                <li key={n}>
                  <BeText text={n} />
                </li>
              ))}
            </ul>
          )}
          <DataSourceNote source="/simulation/what-if" asOf={result.as_of ? fmt.date(result.as_of) : undefined} note={t('reports.whatif.cost_basis', { h: fmt.number(result.holding_rate, { digits: 4 }), b: fmt.number(result.stockout_penalty_rate, { digits: 3 }), c: fmt.number(result.order_cost, { digits: 2 }) })} />
        </div>
      )}
    </Section>
  );
};
