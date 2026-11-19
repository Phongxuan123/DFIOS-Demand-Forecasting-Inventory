import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useStore } from '../context/StoreContext.tsx';
import { useClock } from '../context/ClockContext.tsx';
import { useApi } from '../hooks/useApi.ts';
import { useFormat, useT } from '../i18n/index.tsx';
import { getInventoryScreen, STOCK_STATUSES, type InventoryScreenRow, type StockStatus } from '../services/inventoryScreenApi.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataSourceNote,
  PageHeader,
  SearchInput,
  Select,
  Table,
  Unavailable,
  usePagination,
  type Column,
  type SortState,
} from '../components/ui/index.ts';
import { InventorySummaryTiles, StockStatusPill } from '../components/inventory/InventoryParts.tsx';
import '../components/inventory/inventory.css';

const SEGMENTS = ['AX', 'AY', 'AZ', 'BX', 'BY', 'BZ', 'CX', 'CY', 'CZ'];

/** The BE data notes (English, stable wording) in the active language; an unknown note is shown as given. */
function noteText(note: string, t: ReturnType<typeof useT>): string {
  if (note.startsWith('safety_stock')) return t('inventory.note_safety_stock');
  if (note.startsWith('stock value')) return t('inventory.note_stock_value');
  if (note.startsWith('orders_in_transit')) return t('inventory.note_in_transit');
  return note;
}

export const InventoryManagement: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const { concreteStoreId } = useStore();
  const clock = useClock();
  const store = concreteStoreId;
  const [search, setSearch] = useState('');
  const [cls, setCls] = useState('');
  const [status, setStatus] = useState<StockStatus | ''>('');
  const [sort, setSort] = useState<SortState | null>(null);
  const pg = usePagination(25);

  const res = useApi(
    (signal) =>
      getInventoryScreen(
        {
          store_id: store as string,
          skip: pg.offset,
          limit: pg.pageSize,
          search: search.trim() || undefined,
          cls,
          status,
          sort_by: sort?.key,
          sort_dir: sort?.dir,
        },
        signal,
      ),
    [store, pg.offset, pg.pageSize, search, cls, status, sort, clock.version],
    { enabled: !!store },
  );

  const data = res.data;
  const days = data?.demand_window_days ?? 28;
  const num = (v: number | null | undefined) => (v != null ? <span className="inv-num">{fmt.integer(v)}</span> : <Unavailable />);

  const columns: Column<InventoryScreenRow>[] = [
    {
      key: 'item_id',
      header: t('inventory.col.sku'),
      sortable: true,
      cell: (r) => (
        <div className="inv-sku">
          <Link className="inv-sku__id" to={`/forecast-explorer?sku=${encodeURIComponent(r.item_id)}&tab=window`}>
            {r.item_id}
          </Link>
          {r.name && <span className="inv-sku__name">{r.name}</span>}
        </div>
      ),
    },
    { key: 'segment', header: t('inventory.col.class'), sortable: true, cell: (r) => (r.segment ? <Badge tone="accent">{r.segment}</Badge> : <Unavailable />) },
    { key: 'on_hand', header: t('inventory.col.on_hand'), sortable: true, align: 'right', cell: (r) => num(r.on_hand) },
    { key: 'on_order', header: t('inventory.col.on_order'), sortable: true, align: 'right', cell: (r) => num(r.on_order) },
    { key: 'ip', header: <span title={t('inventory.col.ip_hint')}>{t('inventory.col.ip')}</span>, title: t('inventory.col.ip'), sortable: true, align: 'right', cell: (r) => num(r.ip) },
    { key: 's', header: <span title={t('inventory.col.s_hint')}>{t('inventory.col.s')}</span>, title: t('inventory.col.s'), sortable: true, align: 'right', cell: (r) => num(r.s) },
    { key: 'S', header: <span title={t('inventory.col.S_hint')}>{t('inventory.col.S')}</span>, title: t('inventory.col.S'), sortable: true, align: 'right', cell: (r) => num(r.S) },
    {
      key: 'safety_stock',
      header: <span title={t('inventory.col.ss_hint')}>{t('inventory.col.ss')}</span>,
      title: t('inventory.col.ss'),
      align: 'right',
      cell: (r) => (r.safety_stock != null ? <span className="inv-num">{fmt.number(r.safety_stock, { maxDigits: 1 })}</span> : <Unavailable />),
    },
    { key: 'eoq', header: t('inventory.col.eoq'), align: 'right', cell: (r) => (r.eoq != null ? <span className="inv-num">{fmt.number(r.eoq, { maxDigits: 1 })}</span> : <Unavailable />) },
    {
      key: 'days_of_cover',
      header: <span title={t('inventory.col.cover_hint', { days })}>{t('inventory.col.cover')}</span>,
      title: t('inventory.col.cover'),
      sortable: true,
      align: 'right',
      cell: (r) =>
        r.days_of_cover != null ? <span className="inv-num">{fmt.number(r.days_of_cover, { digits: 1 })}</span> : <Unavailable reason={t('inventory.cover_unknown')} />,
    },
    {
      key: 'status',
      header: t('inventory.col.status'),
      sortable: true,
      cell: (r) => (
        <div className="inv-badges">
          <StockStatusPill status={r.stock_status} />
          {r.cold_start && (
            <span title={t('inventory.col.cold_start_hint')}>
              <Badge tone="info">{t('inventory.col.cold_start')}</Badge>
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'recommendation',
      header: t('inventory.col.recommendation'),
      cell: (r) =>
        r.latest_recommendation ? (
          <div className="inv-sku">
            <span className="inv-num">
              {t('inventory.rec.line', { qty: fmt.integer(r.latest_recommendation.final_qty), status: r.latest_recommendation.status })}
            </span>
            {r.latest_recommendation.review_date && <span className="inv-muted">{fmt.date(r.latest_recommendation.review_date)}</span>}
          </div>
        ) : (
          <span className="inv-muted">{t('inventory.rec.none')}</span>
        ),
    },
  ];

  const filtered = !!(search.trim() || cls || status);
  const classOptions = [
    { value: '', label: t('inventory.filter.class_all') },
    ...['A', 'B', 'C'].map((c) => ({ value: c, label: t('inventory.filter.class_abc', { cls: c }) })),
    ...SEGMENTS.map((s) => ({ value: s, label: s })),
    { value: 'NONE', label: t('inventory.filter.class_none') },
  ];
  const statusOptions = [
    { value: '' as const, label: t('inventory.filter.status_all') },
    ...STOCK_STATUSES.map((s) => ({ value: s, label: t(`inventory.status.${s}`) })),
  ];

  return (
    <div className="ui-stack">
      <PageHeader
        title={t('inventory.title')}
        description={t('inventory.description')}
        meta={
          data ? (
            <Badge tone={data.as_of_source === 'sim_clock' ? 'accent' : 'warning'}>
              {data.as_of_source === 'sim_clock' ? t('inventory.as_of', { date: fmt.date(data.as_of) }) : t('inventory.as_of_demo', { date: fmt.date(data.as_of) })}
            </Badge>
          ) : undefined
        }
        actions={
          <Button variant="secondary" leftIcon={<RefreshCw size={15} />} onClick={res.refetch} disabled={!store} loading={res.loading && !!data}>
            {t('common.actions.refresh')}
          </Button>
        }
      />

      {!store && <Alert tone="warning">{t('inventory.no_store')}</Alert>}

      {store && (
        <>
          <InventorySummaryTiles summary={data?.summary} loading={res.loading && !data} />
          <Card flush>
            <div className="inv-filters">
              <SearchInput
                value={search}
                onChange={(v) => {
                  setSearch(v);
                  pg.setPage(1);
                }}
                placeholder={t('inventory.filter.search')}
              />
              <Select
                aria-label={t('inventory.filter.class_label')}
                value={cls}
                onChange={(v) => {
                  setCls(v);
                  pg.setPage(1);
                }}
                options={classOptions}
              />
              <Select<StockStatus | ''>
                aria-label={t('inventory.filter.status_label')}
                value={status}
                onChange={(v) => {
                  setStatus(v);
                  pg.setPage(1);
                }}
                options={statusOptions}
              />
            </div>
            <Table
              columns={columns}
              rows={data?.items ?? []}
              rowKey={(r) => r.item_id}
              loading={res.loading && !data}
              error={res.error}
              onRetry={res.refetch}
              filtered={filtered}
              emptyTitle={t('inventory.empty')}
              dense
              sort={sort}
              onSortChange={(s) => {
                setSort(s);
                pg.setPage(1);
              }}
              pagination={{ page: pg.page, pageSize: pg.pageSize, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize, total: data?.total ?? 0 }}
            />
            <div className="inv-pad">
              <DataSourceNote source={t('inventory.source', { store })} asOf={data ? fmt.date(data.as_of) : undefined} />
              {data && data.notes.length > 0 && (
                <ul className="inv-notes" aria-label={t('inventory.notes_title')}>
                  {data.notes.map((n) => (
                    <li key={n}>{noteText(n, t)}</li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
