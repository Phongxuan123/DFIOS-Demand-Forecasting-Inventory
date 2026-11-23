import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, DataSourceNote, ErrorState, Input, Skeleton, useToast } from '../../components/ui/index.ts';
import { useStore } from '../../context/StoreContext.tsx';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { apiErrorMessage } from '../../services/apiClient.ts';
import { getServiceLevel, getSettings, putDefaultServiceLevel, putSetting, type AlertThresholds } from '../../services/settingsApi.ts';

const HANDLED = new Set(['timezone', 'currency', 'forecast_horizons', 'default_alert_thresholds', 'simulation_costs']);

interface Form {
  serviceLevel: string;
  csl: string;
  buffer: string;
  ratio: string;
  timezone: string;
  currency: string;
  horizons: string;
}

const num = (s: string): number | null => {
  const v = s.trim().replace(',', '.');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function parseHorizons(s: string): number[] | null {
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 1 || n > 28) return null;
    out.push(n);
  }
  return out;
}

export const SystemTab: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { storeId } = useStore();
  const [version, setVersion] = useState(0);
  const sys = useApi((s) => getSettings(s), [version]);
  const lvl = useApi((s) => getServiceLevel(s), [version]);
  const [draft, setDraft] = useState<Partial<Form>>({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const dict = sys.data?.settings_dict;
  const thresholds = useMemo(() => (dict?.default_alert_thresholds ?? {}) as AlertThresholds, [dict]);
  const baseline = useMemo<Form | null>(() => {
    if (!dict) return null;
    const horizons = Array.isArray(dict.forecast_horizons) ? (dict.forecast_horizons as number[]).join(', ') : '';
    return {
      serviceLevel: lvl.data ? String(lvl.data.default_service_level) : '',
      csl: thresholds.critical_service_level !== undefined ? String(thresholds.critical_service_level) : '',
      buffer: thresholds.lead_time_buffer_days !== undefined ? String(thresholds.lead_time_buffer_days) : '',
      ratio: thresholds.stockout_warning_ratio !== undefined ? String(thresholds.stockout_warning_ratio) : '',
      timezone: typeof dict.timezone === 'string' ? dict.timezone : '',
      currency: typeof dict.currency === 'string' ? dict.currency : '',
      horizons,
    };
  }, [dict, thresholds, lvl.data]);

  // Edited fields live in `draft`; everything else is derived from the server values.
  const form: Form | null = baseline ? { ...baseline, ...draft } : null;

  if (sys.error) return <ErrorState error={sys.error} onRetry={sys.refetch} />;
  if (!form || !baseline) return <Skeleton height={320} />;

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [k]: e.target.value });
  const changed = (k: keyof Form) => form[k].trim() !== baseline[k].trim();
  const dirty = (Object.keys(form) as Array<keyof Form>).some(changed);

  const fieldErrors: Partial<Record<keyof Form, string>> = {};
  const bad = t('settings.system.invalid_number');
  if (changed('serviceLevel')) {
    const v = num(form.serviceLevel);
    if (v === null || v < 0.85 || v > 0.999) fieldErrors.serviceLevel = bad;
  }
  if (changed('csl')) {
    const v = num(form.csl);
    if (v === null || v < 0.5 || v > 1) fieldErrors.csl = bad;
  }
  if (changed('buffer')) {
    const v = num(form.buffer);
    if (v === null || v < 0) fieldErrors.buffer = bad;
  }
  if (changed('ratio')) {
    const v = num(form.ratio);
    if (v === null || v <= 0) fieldErrors.ratio = bad;
  }
  if (changed('timezone') && !form.timezone.trim()) fieldErrors.timezone = bad;
  if (changed('currency') && (form.currency.trim().length < 1 || form.currency.trim().length > 10)) fieldErrors.currency = bad;
  if (changed('horizons') && !parseHorizons(form.horizons)) fieldErrors.horizons = t('settings.system.horizons_invalid');
  const invalid = Object.keys(fieldErrors).length > 0;

  const save = async () => {
    setSaving(true);
    setErrors([]);
    const failures: string[] = [];
    let ok = 0;
    const run = async (key: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        ok += 1;
      } catch (e) {
        failures.push(t('settings.system.failed_item', { key, message: apiErrorMessage(e, t) }));
      }
    };
    // Only changed settings are sent (Settings must not overwrite unrelated configuration).
    if (changed('serviceLevel')) await run('default_service_level', () => putDefaultServiceLevel(num(form.serviceLevel) as number));
    if (changed('timezone')) await run('timezone', () => putSetting('timezone', form.timezone.trim()));
    if (changed('currency')) await run('currency', () => putSetting('currency', form.currency.trim()));
    if (changed('horizons')) await run('forecast_horizons', () => putSetting('forecast_horizons', parseHorizons(form.horizons)));
    if (changed('csl') || changed('buffer') || changed('ratio')) {
      // The server replaces the whole object, so start from the current one and touch only edited sub-fields.
      const next: AlertThresholds = { ...thresholds };
      if (changed('csl')) next.critical_service_level = num(form.csl) as number;
      if (changed('buffer')) next.lead_time_buffer_days = num(form.buffer) as number;
      if (changed('ratio')) next.stockout_warning_ratio = num(form.ratio) as number;
      await run('default_alert_thresholds', () => putSetting('default_alert_thresholds', next));
    }
    setSaving(false);
    setErrors(failures);
    if (failures.length === 0) setDraft({});
    if (ok > 0) toast.success(t('settings.system.saved', { n: ok }));
    if (failures.length > 0) toast.error(t('settings.system.partial'));
    setVersion((v) => v + 1);
  };

  const ro = !canEdit;
  const extra = (sys.data?.settings ?? []).map((s) => s.key).filter((k) => !HANDLED.has(k));
  const newest = (sys.data?.settings ?? []).map((s) => s.updated_at).filter(Boolean).sort().pop();

  return (
    <Card title={t('settings.system.title')} description={t('settings.system.description')}>
      <form
        className="ui-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {ro && <Alert tone="info">{t('settings.system.readonly')}</Alert>}
        <div className="set-fields">
          {lvl.data && (
            <Input
              label={t('settings.system.service_level')}
              hint={t('settings.system.service_level_hint')}
              inputMode="decimal"
              value={form.serviceLevel}
              onChange={set('serviceLevel')}
              disabled={ro}
              error={fieldErrors.serviceLevel}
            />
          )}
          <Input label={t('settings.system.critical_service_level')} hint={t('settings.system.critical_service_level_hint')} inputMode="decimal" value={form.csl} onChange={set('csl')} disabled={ro || thresholds.critical_service_level === undefined} error={fieldErrors.csl} />
          <Input label={t('settings.system.lead_time_buffer_days')} hint={t('settings.system.lead_time_buffer_days_hint')} inputMode="decimal" value={form.buffer} onChange={set('buffer')} disabled={ro || thresholds.lead_time_buffer_days === undefined} error={fieldErrors.buffer} />
          <Input label={t('settings.system.stockout_warning_ratio')} hint={t('settings.system.stockout_warning_ratio_hint')} inputMode="decimal" value={form.ratio} onChange={set('ratio')} disabled={ro || thresholds.stockout_warning_ratio === undefined} error={fieldErrors.ratio} />
          <Input label={t('settings.system.timezone')} hint={t('settings.system.timezone_hint')} value={form.timezone} onChange={set('timezone')} disabled={ro} error={fieldErrors.timezone} />
          <Input label={t('settings.system.currency')} hint={t('settings.system.currency_hint')} value={form.currency} onChange={set('currency')} disabled={ro} error={fieldErrors.currency} />
          <Input label={t('settings.system.horizons')} hint={t('settings.system.horizons_hint')} value={form.horizons} onChange={set('horizons')} disabled={ro} error={fieldErrors.horizons} />
        </div>
        {lvl.data && (Object.keys(lvl.data.category_service_levels).length > 0 || Object.keys(lvl.data.item_service_levels).length > 0) && (
          <Alert tone="info">
            {t('settings.system.service_level_overrides', {
              categories: Object.keys(lvl.data.category_service_levels).length,
              items: Object.keys(lvl.data.item_service_levels).length,
            })}
          </Alert>
        )}
        {errors.length > 0 && (
          <Alert tone="danger" title={t('settings.system.partial')}>
            <ul className="set-hints">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        )}
        <p className="set-note">
          {t('settings.system.abc_note')} <Link to={storeId ? `/abc-xyz?store=${encodeURIComponent(storeId)}` : '/abc-xyz'}>{t('nav.abc_xyz')}</Link>
        </p>
        {extra.length > 0 && <p className="set-note">{t('settings.system.extra_keys', { keys: extra.join(', ') })}</p>}
        {!ro && (
          <div className="ui-row">
            <Button type="submit" variant="primary" loading={saving} disabled={!dirty || invalid}>
              {t('settings.system.save')}
            </Button>
            <Button variant="ghost" onClick={() => setDraft({})} disabled={!dirty || saving}>
              {t('settings.system.discard')}
            </Button>
            {!dirty && <span className="set-note">{t('settings.common.no_changes')}</span>}
          </div>
        )}
        <DataSourceNote source={t('settings.system.source')} asOf={newest ? t('settings.system.updated', { date: fmt.dateTime(newest) }) : undefined} />
      </form>
    </Card>
  );
};
