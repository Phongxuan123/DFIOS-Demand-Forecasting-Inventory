import React from 'react';
import { Alert, Badge, Card, DataSourceNote, Table, type Column } from '../../components/ui/index.ts';
import { NoPermission } from '../../auth/RequireRole.tsx';
import { useFormat, useT } from '../../i18n/index.tsx';
import { useBe } from '../../i18n/useBe.ts';
import { toApiError, apiErrorMessage } from '../../services/apiClient.ts';
import type { ClassificationMatrix, Recommendation, ServiceLevelConfig } from '../../services/abcxyzApi.ts';

interface Props {
  allowed: boolean;
  recs: Recommendation[] | undefined;
  recsLoading: boolean;
  recsError: unknown;
  onRetry: () => void;
  matrix: ClassificationMatrix | undefined;
  serviceLevel: ServiceLevelConfig | undefined;
  serviceLevelError: unknown;
  selected: string | null;
}

export const PolicyCard: React.FC<Props> = ({ allowed, recs, recsLoading, recsError, onRetry, matrix, serviceLevel, serviceLevelError, selected }) => {
  const t = useT();
  const fmt = useFormat();
  const be = useBe();

  const columns: Column<Recommendation>[] = [
    { key: 'segment', header: t('abcxyz.policy.segment'), cell: (r) => <Badge tone={r.segment === selected ? 'accent' : 'neutral'}>{r.segment}</Badge>, value: (r) => r.segment, sortable: true, width: 96 },
    { key: 'skus', header: t('abcxyz.policy.skus'), align: 'right', value: (r) => matrix?.matrix?.[r.segment]?.sku_count ?? null, cell: (r) => fmt.integer(matrix?.matrix?.[r.segment]?.sku_count), sortable: true, width: 80 },
    { key: 'review', header: t('abcxyz.policy.review'), value: (r) => r.review_frequency, cell: (r) => <span className="abc-policy-text">{be(r.review_frequency)}</span> },
    { key: 'policy', header: t('abcxyz.policy.policy'), value: (r) => r.replenishment_policy, cell: (r) => <span className="abc-policy-text">{be(r.replenishment_policy)}</span> },
    { key: 'safety', header: t('abcxyz.policy.safety'), value: (r) => r.safety_stock_level, cell: (r) => <span className="abc-policy-text">{be(r.safety_stock_level)}</span> },
    { key: 'priority', header: t('abcxyz.policy.priority'), value: (r) => r.priority, cell: (r) => <span className="abc-policy-text">{be(r.priority)}</span> },
  ];

  let slNote: React.ReactNode = null;
  if (allowed) {
    if (serviceLevel) {
      const cats = Object.entries(serviceLevel.category_service_levels ?? {});
      slNote = (
        <Alert tone="info">
          {t('abcxyz.policy.service_level_note', { v: fmt.percent(serviceLevel.default_service_level, { digits: 1 }) })}
          {cats.length > 0 && (
            <>
              {' '}
              {t('abcxyz.policy.category_levels', { list: cats.map(([k, v]) => `${k} ${fmt.percent(v, { digits: 1 })}`).join(', ') })}
            </>
          )}
        </Alert>
      );
    } else if (serviceLevelError) {
      slNote = <Alert tone="warning">{t('abcxyz.policy.service_level_unavailable', { reason: apiErrorMessage(serviceLevelError, t) })}</Alert>;
    }
  }

  return (
    <Card title={t('abcxyz.policy.title')} description={t('abcxyz.policy.description')} flush={allowed}>
      {!allowed ? (
        <NoPermission compact />
      ) : (
        <>
          {slNote && <div style={{ padding: 'var(--space-3) var(--space-4)' }}>{slNote}</div>}
          <Table
            columns={columns}
            rows={recs ?? []}
            rowKey={(r) => r.segment}
            loading={recsLoading}
            error={recsError ? toApiError(recsError) : undefined}
            onRetry={onRetry}
            dense
            wrap
          />
          <div style={{ padding: 'var(--space-2) var(--space-4) var(--space-3)' }}>
            <DataSourceNote source={t('abcxyz.policy.source')} />
          </div>
        </>
      )}
    </Card>
  );
};
