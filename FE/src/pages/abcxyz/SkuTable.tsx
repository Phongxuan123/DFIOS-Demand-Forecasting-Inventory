import React, { useState } from 'react';
import { Badge, Button, Card, SearchInput, Select, Table, usePagination, type Column, type SortState } from '../../components/ui/index.ts';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { getCategories, getSkus, type SkuClassification } from '../../services/abcxyzApi.ts';

interface Props {
  storeId: string;
  segment: string | null;
  onClearSegment: () => void;
  version: number;
}

export const SkuTable: React.FC<Props> = ({ storeId, segment, onClearSegment, version }) => {
  const t = useT();
  const fmt = useFormat();
  const pg = usePagination(25);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<SortState | null>({ key: 'revenue', dir: 'desc' });

  const cats = useApi((s) => getCategories(s), []);
  const { data, loading, error, refetch } = useApi(
    (signal) =>
      getSkus(
        {
          store_id: storeId,
          segment: segment ?? undefined,
          category: category || undefined,
          search: search || undefined,
          skip: pg.offset,
          limit: pg.pageSize,
          sort_by: sort?.key ?? 'revenue',
          order: sort?.dir ?? 'desc',
        },
        signal,
      ),
    [storeId, segment, category, search, pg.offset, pg.pageSize, sort, version],
  );

  const columns: Column<SkuClassification>[] = [
    { key: 'item_id', header: t('abcxyz.skus.item'), value: (r) => r.item_id, sortable: true, width: 160 },
    { key: 'name', header: t('abcxyz.skus.name'), value: (r) => r.product_name },
    { key: 'cat', header: t('abcxyz.skus.cat'), value: (r) => r.category, width: 120 },
    { key: 'segment', header: t('abcxyz.skus.segment'), cell: (r) => <Badge tone="neutral">{r.segment}</Badge>, width: 90 },
    { key: 'revenue', header: t('abcxyz.skus.revenue'), align: 'right', sortable: true, cell: (r) => fmt.currency(r.revenue) },
    { key: 'revenue_share', header: t('abcxyz.skus.share'), align: 'right', sortable: true, cell: (r) => fmt.percent(r.revenue_share, { scale: 'percent', digits: 2 }) },
    { key: 'cumulative', header: t('abcxyz.skus.cumulative'), align: 'right', cell: (r) => fmt.percent(r.cumulative_share, { scale: 'percent', digits: 1 }) },
    { key: 'mean_demand', header: t('abcxyz.skus.mean'), align: 'right', sortable: true, cell: (r) => fmt.number(r.mean_demand, { digits: 2 }) },
    { key: 'cv', header: t('abcxyz.skus.cv'), align: 'right', sortable: true, cell: (r) => fmt.number(r.cv, { digits: 2 }) },
    { key: 'class_source', header: t('abcxyz.skus.label_source'), value: (r) => r.class_source, width: 120 },
  ];

  const filtered = !!(segment || category || search);
  return (
    <Card title={t('abcxyz.skus.title')} flush>
      <div className="abc-filters">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            pg.setPage(1);
          }}
          placeholder={t('abcxyz.skus.search')}
          aria-label={t('abcxyz.skus.search')}
        />
        <Select
          value={category}
          label={t('abcxyz.skus.category')}
          onChange={(v) => {
            setCategory(v);
            pg.setPage(1);
          }}
          options={[{ value: '', label: t('abcxyz.skus.all_categories') }, ...(cats.data ?? []).map((c) => ({ value: c, label: c }))]}
        />
        {segment && (
          <div className="ui-row">
            <Badge tone="accent">{t('abcxyz.matrix.selected', { segment })}</Badge>
            <Button size="sm" variant="ghost" onClick={onClearSegment}>
              {t('abcxyz.matrix.clear')}
            </Button>
          </div>
        )}
      </div>
      <Table
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        onRetry={refetch}
        filtered={filtered}
        sort={sort}
        onSortChange={(s) => {
          setSort(s);
          pg.setPage(1);
        }}
        pagination={{ page: pg.page, pageSize: pg.pageSize, total: data?.total, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize }}
        dense
      />
    </Card>
  );
};
