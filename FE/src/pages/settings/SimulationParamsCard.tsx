import React, { useState } from 'react';
import { Alert, Button, Card, ErrorState, Input, Skeleton, useToast } from '../../components/ui/index.ts';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { apiErrorMessage } from '../../services/apiClient.ts';
import { getSimulationParameters, putSimulationCosts, type SimulationCosts } from '../../services/settingsApi.ts';

type CostKey = keyof SimulationCosts;
const COST_KEYS: CostKey[] = ['holding_rate', 'stockout_penalty_rate', 'order_cost'];

const num = (s: string): number | null => {
  const v = s.trim().replace(',', '.');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** demo.md §1.3: L, R (read-only: they fix the window H = L + R of the stored quantiles), h, b, c (editable while
 *  every clock is on its start date), the service target and the C³-OUT constants. */
export const SimulationParamsCard: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const api = useApi((s) => getSimulationParameters(s), [version]);
  const [draft, setDraft] = useState<Partial<Record<CostKey, string>>>({});
  const [saving, setSaving] = useState(false);

  if (api.error) return <ErrorState error={api.error} onRetry={api.refetch} />;
  const p = api.data;
  if (!p) return <Skeleton height={240} />;

  const value = (k: CostKey) => draft[k] ?? String(p[k]);
  const changed = (k: CostKey) => draft[k] !== undefined && num(draft[k] as string) !== p[k];
  const dirty = COST_KEYS.some(changed);
  const errors: Partial<Record<CostKey, string>> = {};
  for (const k of COST_KEYS) {
    if (!changed(k)) continue;
    const v = num(value(k));
    const [lo, hi] = p.limits[k];
    if (v === null || v < lo || v > hi) errors[k] = t('settings.sim.out_of_range', { min: fmt.number(lo), max: fmt.number(hi) });
  }
  const invalid = Object.keys(errors).length > 0;
  const editable = canEdit && p.costs_editable;

  const save = async () => {
    setSaving(true);
    try {
      const body: Partial<SimulationCosts> = {};
      for (const k of COST_KEYS) if (changed(k)) body[k] = num(value(k)) as number;
      await putSimulationCosts(body);
      toast.success(t('settings.sim.saved'));
      setDraft({});
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(t('settings.sim.save_failed'), apiErrorMessage(e, t));
    } finally {
      setSaving(false);
    }
  };

  const ro = (label: string, val: string, hint?: string) => <Input label={label} value={val} hint={hint} disabled readOnly />;

  return (
    <Card title={t('settings.sim.title')} description={t('settings.sim.description')}>
      <form
        className="ui-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {canEdit && !p.costs_editable && (
          <Alert tone="info">{t('settings.sim.locked', { stores: p.costs_locked_stores.join(', ') })}</Alert>
        )}
        <div className="set-fields">
          {ro(t('settings.sim.lead_time'), t('settings.sim.days', { n: p.lead_time_days }), t('settings.sim.lr_hint'))}
          {ro(t('settings.sim.review_period'), t('settings.sim.days', { n: p.review_period_days }), t('settings.sim.window', { h: p.horizon_days }))}
          {COST_KEYS.map((k) => (
            <Input
              key={k}
              label={t(`settings.sim.${k}`)}
              hint={t(`settings.sim.${k}_hint`, { def: fmt.number(p.defaults[k], { maxDigits: 4 }) })}
              inputMode="decimal"
              value={value(k)}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
              disabled={!editable}
              error={errors[k]}
            />
          ))}
          {ro(t('settings.sim.target'), fmt.percent(p.target_availability * 100, { scale: 'percent', digits: 1 }), t('settings.sim.target_hint', { guard: fmt.percent(p.selection_guard * 100, { scale: 'percent', digits: 0 }) }))}
          {ro(t('settings.sim.c3out'), `η = ${fmt.number(p.c3out.eta)} · setpoint ${fmt.number(p.c3out.setpoint)} · θ ∈ [${fmt.number(p.c3out.theta_min)}; ${fmt.number(p.c3out.theta_max)}]`, t('settings.sim.c3out_hint'))}
        </div>
        {editable && (
          <div className="ui-row">
            <Button type="submit" variant="primary" loading={saving} disabled={!dirty || invalid}>
              {t('settings.sim.save')}
            </Button>
            <Button variant="ghost" onClick={() => setDraft({})} disabled={!dirty || saving}>
              {t('settings.system.discard')}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
};
