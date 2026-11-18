import React, { useState } from 'react';
import { Alert, Badge, Button, Card, DataSourceNote, EmptyState, ErrorState, Input, KpiTile, Section, Table, type Column, type Tone } from '../../components/ui/index.ts';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT, type TKey } from '../../i18n/index.tsx';
import { defaultEventDate } from './metricsDefaults.ts';
import { getControllerMetrics, type ControllerClass } from '../../services/metricsApi.ts';

const STATUS_TONE: Record<string, Tone> = { 'Warm-up': 'neutral', Active: 'success', Boundary: 'warning' };
const STATUS_KEY: Record<string, string> = { 'Warm-up': 'warmup', Active: 'active', Boundary: 'boundary' };

interface Row extends ControllerClass {
  cls: string;
}

export const ControllerPanel: React.FC<{ storeId: string | null; clockDate?: string | null; version?: number }> = ({ storeId, clockDate, version = 0 }) => {
  const t = useT();
  const fmt = useFormat();
  const [picked, setPicked] = useState<string | null>(null);
  const eventDate = picked ?? defaultEventDate(clockDate);
  const m = useApi((s) => getControllerMetrics(storeId ?? '', eventDate || null, s), [storeId, eventDate, version], { enabled: !!storeId });
  const d = m.data;
  const o = d?.overall ?? null;
  const loading = m.loading && !d;

  const statusPill = (status: string) => (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot>
      {STATUS_KEY[status] ? t(`metrics.controller.status_${STATUS_KEY[status]}` as TKey) : status}
    </Badge>
  );

  const recoveryText = (days: number | null | undefined) => (days != null ? t('metrics.controller.recovery_days', { days: fmt.integer(days) }) : t('metrics.controller.not_recovered'));

  const rows: Row[] = Object.entries(d?.classes ?? {}).map(([cls, v]) => ({ cls, ...v }));
  const cols: Column<Row>[] = [
    { key: 'cls', header: t('metrics.controller.col_class'), value: (r) => r.cls, sortable: true },
    { key: 'status', header: t('metrics.controller.col_status'), value: (r) => r.status, cell: (r) => statusPill(r.status) },
    { key: 'theta', header: t('metrics.controller.col_theta'), align: 'right', value: (r) => r.theta, cell: (r) => fmt.number(r.theta, { digits: 3 }) },
    { key: 'avail', header: t('metrics.controller.col_availability'), align: 'right', value: (r) => r.availability ?? null, cell: (r) => fmt.percent(r.availability, { digits: 1 }) },
    { key: 'viol', header: t('metrics.controller.col_violation'), align: 'right', value: (r) => r.rolling_violation ?? null, cell: (r) => fmt.percent(r.rolling_violation, { digits: 1 }) },
    {
      key: 'rec',
      header: t('metrics.controller.col_recovery'),
      align: 'right',
      value: (r) => r.recovery_days ?? null,
      cell: (r) => (eventDate && (r.availability ?? null) != null ? recoveryText(r.recovery_days) : '—'),
    },
  ];

  const picker = (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
      <Input type="date" size="sm" label={t('metrics.controller.event_date')} value={eventDate} onChange={(e) => setPicked(e.target.value)} aria-label={t('metrics.controller.event_date')} />
      {eventDate && (
        <Button size="sm" variant="ghost" onClick={() => setPicked('')}>
          {t('metrics.controller.event_clear')}
        </Button>
      )}
    </div>
  );

  return (
    <Section title={t('metrics.controller.title')} description={t('metrics.controller.description')} actions={picker}>
      {!storeId ? (
        <Alert tone="info">{t('metrics.quality.no_store')}</Alert>
      ) : m.error && !d ? (
        <ErrorState error={m.error} onRetry={m.refetch} />
      ) : !loading && !o ? (
        <EmptyState title={t('metrics.controller.empty_title')} description={t('metrics.controller.empty_desc')} />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <KpiTile
              label={t('metrics.controller.rolling_violation')}
              loading={loading}
              value={o?.rolling_violation != null ? fmt.percent(o.rolling_violation, { digits: 1 }) : null}
              hint={o ? t('metrics.controller.rolling_violation_hint', { n: fmt.integer(o.n_windows) }) : undefined}
            />
            <KpiTile
              label={t('metrics.controller.min_csl')}
              loading={loading}
              value={o?.min_class_csl != null ? fmt.percent(o.min_class_csl, { digits: 1 }) : null}
              hint={t('metrics.controller.min_csl_hint', { target: fmt.percent(d?.target ?? 0.95, { digits: 0 }) })}
            />
            <KpiTile
              label={t('metrics.controller.recovery')}
              loading={loading}
              value={eventDate ? recoveryText(o?.recovery_days) : null}
              unavailableReason={eventDate ? undefined : t('metrics.controller.no_event')}
              hint={eventDate ? fmt.date(eventDate) : undefined}
            />
            <KpiTile label={t('metrics.controller.boundary')} loading={loading} value={o ? fmt.integer(o.n_boundary_classes) : null} />
          </div>
          <Card flush>
            <Table columns={cols} rows={rows} rowKey={(r) => r.cls} loading={loading} dense />
          </Card>
          <DataSourceNote source={t('metrics.controller.source', { store: storeId })} />
        </div>
      )}
    </Section>
  );
};
