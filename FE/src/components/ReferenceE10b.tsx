import React from 'react';
import { Alert, Badge, Card, Section } from './ui/index.ts';
import { useApi } from '../hooks/useApi.ts';
import { useT } from '../i18n/index.tsx';
import { getE10bReference, type E10bReference } from '../services/reportsApi.ts';

const ROWS: Array<{ key: string; digits: number; check?: string }> = [
  { key: 'cost', digits: 1, check: 'cost' },
  { key: 'holding', digits: 1 },
  { key: 'lost', digits: 1 },
  { key: 'ordering', digits: 1 },
  { key: 'orders', digits: 0, check: 'orders' },
  { key: 'fill', digits: 5, check: 'fill' },
  { key: 'min_class_csl', digits: 5, check: 'min_class_csl' },
  { key: 'n_cycles', digits: 0 },
];

const f = (v: number | null | undefined, d: number) => (typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

export const ReferenceE10bView: React.FC<{ data: E10bReference }> = ({ data }) => {
  const t = useT();
  if (!data.available) {
    return (
      <Alert tone="info">
        {t('reports.e10b.unavailable')} <code>python scripts/replay_e10b.py --policy REFIT-RSS-EOQ-G --out MODEL/e10b_reference.json</code>
      </Alert>
    );
  }
  return (
    <>
      <p>
        <Badge tone={data.matches ? 'success' : 'danger'}>{data.matches ? t('reports.e10b.match') : t('reports.e10b.mismatch')}</Badge>
      </p>
      <Card flush>
        <table className="ui-table" data-testid="e10b-table">
          <thead>
            <tr>
              <th>{t('reports.e10b.metric')}</th>
              <th>{t('reports.e10b.replay')}</th>
              <th>{t('reports.e10b.teacher')}</th>
              <th>Δ</th>
              <th>✓/✗</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key}>
                <td>{t(`reports.e10b.m_${r.key}` as never)}</td>
                <td>{f(data.replay?.[r.key], r.digits)}</td>
                <td>{f(data.teacher?.[r.key], r.digits)}</td>
                <td>{f(data.delta?.[r.key], r.digits)}</td>
                <td>{r.check ? (data.checks?.[r.check] ? '✓' : '✗') : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="ui-muted">{t('reports.e10b.note')}</p>
    </>
  );
};

export const ReferenceE10b: React.FC = () => {
  const t = useT();
  const q = useApi((signal) => getE10bReference(signal), []);
  return (
    <Section title={t('reports.e10b.title')}>
      {q.loading && !q.data ? <p className="ui-muted">…</p> : q.error || !q.data ? <Alert tone="warning">{t('reports.e10b.unavailable')}</Alert> : <ReferenceE10bView data={q.data} />}
    </Section>
  );
};
