import React, { useState } from 'react';
import { Badge, Card, DataSourceNote, Tooltip, Input, SearchInput, Select, Table, usePagination, type Column } from '../../components/ui/index.ts';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { listAuditActions, listAuditLogs, type AuditLog } from '../../services/settingsApi.ts';

export const AuditTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const pg = usePagination(25);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const actions = useApi((s) => listAuditActions(s), []);
  const { data, loading, error, refetch } = useApi(
    (signal) =>
      listAuditLogs(
        {
          skip: pg.offset,
          limit: pg.pageSize,
          action: action || undefined,
          actor_email: actor || undefined,
          start_time: from ? `${from}T00:00:00` : undefined,
          end_time: to ? `${to}T23:59:59` : undefined,
        },
        signal,
      ),
    [pg.offset, pg.pageSize, action, actor, from, to],
  );

  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    pg.setPage(1);
  };

  // Actor and details are shown exactly as the server returns them (P-40). A missing actor is "unknown",
  // never a default account; there is no status column because the API has no such field.
  const columns: Column<AuditLog>[] = [
    { key: 'time', header: t('settings.audit.col_time'), cell: (r) => fmt.dateTime(r.created_at), width: 170 },
    { key: 'actor', header: t('settings.audit.col_actor'), cell: (r) => r.actor_email || <span className="set-note">{t('settings.audit.actor_unknown')}</span> },
    { key: 'action', header: t('settings.audit.col_action'), value: (r) => r.action },
    {
      key: 'result',
      header: <Tooltip content={t('settings.audit.result_help')}><span>{t('settings.audit.col_result')}</span></Tooltip>,
      value: (r) => r.result ?? null,
      cell: (r) => (r.result ? <Badge tone={r.result === 'FAILURE' ? 'danger' : 'success'}>{r.result === 'FAILURE' ? t('settings.audit.result_failure') : t('settings.audit.result_success')}</Badge> : <span className="set-note">—</span>),
      width: 110,
    },
    { key: 'details', header: t('settings.audit.col_details'), value: (r) => r.details },
    { key: 'ip', header: t('settings.audit.col_ip'), value: (r) => r.ip_address, width: 130 },
  ];

  const filtered = !!(action || actor || from || to);
  return (
    <Card title={t('settings.audit.title')} description={t('settings.audit.description')} flush>
      <div className="set-filters">
        <Select
          label={t('settings.audit.action_filter')}
          value={action}
          onChange={reset(setAction)}
          options={[{ value: '', label: t('settings.audit.all_actions') }, ...(actions.data ?? []).map((a) => ({ value: a, label: a }))]}
        />
        <div>
          <div className="set-label">{t('settings.audit.actor_filter')}</div>
          <SearchInput value={actor} onChange={reset(setActor)} placeholder={t('settings.audit.actor_filter')} aria-label={t('settings.audit.actor_filter')} />
        </div>
        <Input label={t('settings.audit.from')} type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} />
        <Input label={t('settings.audit.to')} type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} />
      </div>
      <Table
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        onRetry={refetch}
        filtered={filtered}
        pagination={{ page: pg.page, pageSize: pg.pageSize, total: data?.total, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize }}
        dense
      />
      <div className="set-pad">
        <DataSourceNote source={t('settings.audit.source')} />
      </div>
    </Card>
  );
};
