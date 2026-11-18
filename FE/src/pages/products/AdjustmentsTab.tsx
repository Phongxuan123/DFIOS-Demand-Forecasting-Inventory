import React, { useState } from 'react';
import { useStore } from '../../context/StoreContext.tsx';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { listAdjustments, type Adjustment } from '../../services/productsApi.ts';
import { Card, SearchInput, Table, Unavailable, usePagination, type Column } from '../../components/ui/index.ts';

export const AdjustmentsTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const { storeId } = useStore();
  const [sku, setSku] = useState('');
  const pg = usePagination(25);
  const list = useApi(
    (signal) => listAdjustments({ skip: pg.offset, limit: pg.pageSize, store_id: storeId ?? undefined, item_id: sku.trim() || undefined }, signal),
    [pg.offset, pg.pageSize, storeId, sku],
    { enabled: !!storeId },
  );

  const change = (a: number, b: number) => `${fmt.integer(a)} → ${fmt.integer(b)}`;
  const columns: Column<Adjustment>[] = [
    { key: 'time', header: t('products.col.time'), cell: (r) => fmt.dateTime(r.created_at) },
    { key: 'sku', header: t('products.col.sku'), cell: (r) => <span className="prd-sku">{r.item_id}</span> },
    { key: 'store', header: t('products.col.store'), cell: (r) => r.store_id },
    { key: 'on_hand', header: t('products.col.on_hand_change'), align: 'right', cell: (r) => change(r.old_on_hand, r.new_on_hand) },
    { key: 'on_order', header: t('products.col.on_order_change'), align: 'right', cell: (r) => change(r.old_on_order, r.new_on_order) },
    { key: 'reason', header: t('products.col.reason'), cell: (r) => r.reason ?? <Unavailable /> },
    { key: 'by', header: t('products.col.by'), cell: (r) => r.adjusted_by ?? <Unavailable /> },
  ];

  return (
    <Card flush>
      <div className="prd-pad">
        <SearchInput
          value={sku}
          onChange={(v) => {
            setSku(v);
            pg.setPage(1);
          }}
          placeholder={t('products.adjustments.filter_sku')}
        />
      </div>
      <Table
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={list.loading && !list.data}
        error={list.error}
        onRetry={list.refetch}
        filtered={!!sku.trim()}
        dense
        pagination={{ page: pg.page, pageSize: pg.pageSize, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize, total: list.data?.total ?? 0 }}
      />
    </Card>
  );
};
