import React from 'react';
import { Badge, Card, Table, type Column } from '../../components/ui/index.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { toApiError } from '../../services/apiClient.ts';
import type { ClassificationMatrix } from '../../services/abcxyzApi.ts';
import type { CurrentPolicy } from '../../services/abcxyzApi.ts';
import type { SegmentAvailability } from '../../services/dashboardApi.ts';

interface Props {
  policies: CurrentPolicy[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  matrix: ClassificationMatrix | undefined;
  service: SegmentAvailability[] | undefined;
  selected: string | null;
}

/**
 * Policy in force per ABC x XYZ class (demo.md §6.2 screen 5): (m_g, kappa_g) chosen by J5, the current C3-OUT theta_g,
 * the resulting multiplier e^(m_g + theta_g) on Q_hat, and the observed availability vs the commitment.
 * s = ceil(Q_hat · e^(m_g + theta_g)), S = s + ceil(kappa_g · EOQ).
 */
export const CurrentPolicyCard: React.FC<Props> = ({ policies, loading, error, onRetry, matrix, service, selected }) => {
  const t = useT();
  const fmt = useFormat();
  const num = (v: number | null | undefined, digits: number) => (v !== null && v !== undefined && Number.isFinite(v) ? fmt.number(v, { digits }) : '—');

  const columns: Column<CurrentPolicy>[] = [
    {
      key: 'class',
      header: t('abcxyz.current.col_class'),
      value: (r) => r.class_id,
      sortable: true,
      cell: (r) => <Badge tone={r.class_id === selected ? 'accent' : 'neutral'}>{r.class_id}</Badge>,
    },
    { key: 'skus', header: t('abcxyz.policy.skus'), align: 'right', value: (r) => matrix?.matrix?.[r.class_id]?.sku_count ?? null, cell: (r) => fmt.integer(matrix?.matrix?.[r.class_id]?.sku_count) },
    { key: 'm', header: 'm_g', align: 'right', value: (r) => r.m_g, cell: (r) => <span className="ui-num">{num(r.m_g, 2)}</span> },
    { key: 'kappa', header: 'κ_g', align: 'right', value: (r) => r.kappa_g, cell: (r) => <span className="ui-num">{num(r.kappa_g, 2)}</span> },
    { key: 'theta', header: 'θ_g', align: 'right', value: (r) => r.theta, cell: (r) => <span className="ui-num">{num(r.theta, 3)}</span> },
    {
      key: 'mult',
      header: t('abcxyz.current.col_multiplier'),
      align: 'right',
      value: (r) => Math.exp(r.m_g + (r.theta ?? 0)),
      cell: (r) => <span className="ui-num">×{num(Math.exp(r.m_g + (r.theta ?? 0)), 3)}</span>,
    },
    {
      key: 'avail',
      header: t('abcxyz.current.col_availability'),
      align: 'right',
      value: (r) => service?.find((s) => s.class_id === r.class_id)?.c3out_availability ?? null,
      cell: (r) => {
        const sv = service?.find((s) => s.class_id === r.class_id);
        if (!sv || sv.c3out_availability === null) return '—';
        const below = sv.c3out_availability < sv.target;
        return (
          <span style={{ color: below ? 'var(--color-warning-text)' : 'var(--color-success-text)', fontWeight: 'var(--weight-semibold)' }}>
            {fmt.percent(sv.c3out_availability, { scale: 'percent', digits: 1 })}
          </span>
        );
      },
    },
    {
      key: 'selection',
      header: t('abcxyz.current.col_selection'),
      cell: (r) => (
        <span style={{ fontSize: 'var(--text-xs)' }}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{r.selection_id}</span>{' '}
          <Badge tone={r.scope === 'store' ? 'success' : 'neutral'}>{t(r.scope === 'store' ? 'abcxyz.current.scope_store' : 'abcxyz.current.scope_global')}</Badge>
        </span>
      ),
    },
    { key: 'at', header: t('abcxyz.current.col_selected_at'), cell: (r) => (r.selected_at ? fmt.dateTime(r.selected_at) : '—') },
  ];

  return (
    <Card title={t('abcxyz.current.title')} description={t('abcxyz.current.description')} flush>
      <Table
        columns={columns}
        rows={policies ?? []}
        rowKey={(r) => r.class_id}
        loading={loading}
        error={error ? toApiError(error) : undefined}
        onRetry={onRetry}
        emptyTitle={t('abcxyz.current.empty')}
        dense
      />
    </Card>
  );
};
