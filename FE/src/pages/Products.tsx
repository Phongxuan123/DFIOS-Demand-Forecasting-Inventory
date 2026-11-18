import React, { useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useStore } from '../context/StoreContext.tsx';
import { useFormat, useT } from '../i18n/index.tsx';
import { useApi } from '../hooks/useApi.ts';
import { useClock } from '../context/ClockContext.tsx';
import { getKpis } from '../services/dashboardApi.ts';
import { can, normalizeRole } from '../auth/permissions.ts';
import { Alert, Badge, Button, HoldHeight, PageHeader, Tabs, type TabItem } from '../components/ui/index.ts';
import { ProductsTab } from './products/ProductsTab.tsx';
import { SuppliersTab } from './products/SuppliersTab.tsx';
import { AdjustmentsTab } from './products/AdjustmentsTab.tsx';
import { SalesTab } from './products/SalesTab.tsx';
import { EventsTab } from './products/EventsTab.tsx';
import { downloadCsv } from '../utils/csv.ts';
import './Products.css';

type TabId = 'products' | 'suppliers' | 'adjustments' | 'sales' | 'events';

export const Products: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const { user } = useAuth();
  const { storeId } = useStore();
  const { version, clock } = useClock();
  // Catalogue KPIs of the store (every role): SKUs, SKUs at or below s, suppliers, valued stock
  const kpis = useApi((s) => getKpis(storeId as string, s), [storeId, version], { enabled: !!storeId });
  const k = kpis.data;
  const n = (v: number | null | undefined) => (v !== null && v !== undefined ? fmt.integer(v) : '—');
  const [tab, setTab] = useState<TabId>('products');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const isManager = can(user?.role, 'inventory:adjust');
  const isAdmin = normalizeRole(user?.role) === 'ADMIN';

  const items: TabItem<TabId>[] = [
    { id: 'products', label: t('products.tabs.products') },
    { id: 'suppliers', label: t('products.tabs.suppliers') },
    ...(isManager ? [{ id: 'adjustments' as const, label: t('products.tabs.adjustments') }] : []),
    { id: 'sales', label: t('products.tabs.sales') },
    { id: 'events', label: t('products.tabs.events') },
  ];

  const exportMasterCsv = () => {
    const rows: Array<[string, string | number | null]> = [
      ['Store', storeId ?? ''],
      ['As of', clock?.current_date ?? null],
      ['SKUs', k?.total_skus ?? null],
      ['SKUs at or below reorder point', k?.reorder_alerts_count ?? null],
      ['Pending replenishment proposals', k?.pending_replenishments_count ?? null],
      ['Suppliers', k?.total_suppliers ?? null],
      ['Inventory value', k?.total_inventory_value ?? null],
    ];
    downloadCsv(`master-catalog-${storeId ?? 'store'}.csv`, ['Metric', 'Value'], rows);
  };

  return (
    <div className="ui-stack prd-container">
      <div className="prd-breadcrumb">
        <span>{t('products.master.breadcrumb_store', { store: storeId ?? 'CA_1' })}</span>
        <span>/</span>
        <span>{t('products.master.breadcrumb_catalog')}</span>
        <span>/</span>
        <span className="prd-breadcrumb-tag">{t('products.master.breadcrumb_m5')}</span>
        <span>·</span>
        <span className="prd-breadcrumb-tag" style={{ color: 'var(--color-success-text)' }}>
          ● {t('products.master.sync_status')}
        </span>
        <span>|</span>
        <span className="prd-breadcrumb-tag">{t('products.master.engine_ver')}</span>
      </div>

      <PageHeader
        title={t('products.title')}
        description={t('products.description')}
        actions={
          <div className="prd-header-actions">
            <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={exportMasterCsv}>
              {t('products.master.export_csv')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus size={14} />}
              disabled={!isAdmin}
              title={!isAdmin ? t('products.admin_only') : undefined}
              onClick={() => setCreateModalOpen(true)}
            >
              {t('products.master.add_product')}
            </Button>
          </div>
        }
      />

      {!storeId && <Alert tone="warning">{t('products.no_store')}</Alert>}

      <Tabs aria-label={t('products.title')} items={items} value={tab} onChange={setTab} />

      <HoldHeight activeKey={tab} role="tabpanel" className="ui-stack">
        {tab === 'products' && (
          <div className="ui-stack" style={{ gap: 'var(--space-4)' }}>
            <div className="prd-kpi-grid">
              <div className="prd-kpi-card">
                <div>
                  <div className="prd-kpi-head">
                    <span className="prd-kpi-title">{t('products.master.kpi_total_skus')}</span>
                  </div>
                  <div className="prd-kpi-val">{n(k?.total_skus)}</div>
                </div>
                <div className="prd-kpi-foot">
                  <span>{t('products.master.kpi_skus_breakdown', { store: storeId ?? '—' })}</span>
                </div>
              </div>

              <div className="prd-kpi-card">
                <div>
                  <div className="prd-kpi-head">
                    <span className="prd-kpi-title">{t('products.master.kpi_below_rop')}</span>
                    {!!k?.reorder_alerts_count && <Badge tone="danger">{t('products.master.kpi_below_rop_badge')}</Badge>}
                  </div>
                  <div className="prd-kpi-val">
                    {n(k?.reorder_alerts_count)} <span className="prd-kpi-unit">SKU</span>
                  </div>
                </div>
                <div className="prd-kpi-foot">
                  <span>{k ? t('products.master.kpi_below_rop_risk', { count: n(k.pending_replenishments_count) }) : '—'}</span>
                </div>
              </div>

              <div className="prd-kpi-card">
                <div>
                  <div className="prd-kpi-head">
                    <span className="prd-kpi-title">{t('products.master.kpi_suppliers')}</span>
                  </div>
                  <div className="prd-kpi-val">{n(k?.total_suppliers)}</div>
                </div>
                <div className="prd-kpi-foot">
                  <span>{clock?.lead_time_days != null ? t('products.master.kpi_suppliers_sub', { l: clock.lead_time_days }) : '—'}</span>
                </div>
              </div>

              <div className="prd-kpi-card">
                <div>
                  <div className="prd-kpi-head">
                    <span className="prd-kpi-title">{t('products.master.kpi_onhand')}</span>
                  </div>
                  <div className="prd-kpi-val">{k ? fmt.currency(k.total_inventory_value) : '—'}</div>
                </div>
                <div className="prd-kpi-foot">
                  <span>{clock?.current_date ? t('products.master.kpi_onhand_sub', { date: fmt.date(clock.current_date) }) : '—'}</span>
                </div>
              </div>
            </div>

            <ProductsTab
              externalCreateTrigger={createModalOpen}
              onCloseCreateTrigger={() => setCreateModalOpen(false)}
            />
          </div>
        )}
        {tab === 'suppliers' && <SuppliersTab />}
        {tab === 'adjustments' && isManager && <AdjustmentsTab />}
        {tab === 'sales' && <SalesTab />}
        {tab === 'events' && <EventsTab />}
      </HoldHeight>
    </div>
  );
};