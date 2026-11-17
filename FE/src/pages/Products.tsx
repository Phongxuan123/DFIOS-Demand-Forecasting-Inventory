import React, { useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useStore } from '../context/StoreContext.tsx';
import { useT } from '../i18n/index.tsx';
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
  const { user } = useAuth();
  const { storeId } = useStore();
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
    const rows = [
      ['Metric', 'Value'],
      ['Store', storeId ?? 'CA_1'],
      ['Total Master SKUs', '3049'],
      ['Active SKUs Ratio', '100%'],
      ['Foods SKUs', '1437'],
      ['Hobbies SKUs', '565'],
      ['Household SKUs', '1047'],
      ['Below Reorder Point SKUs', '49'],
      ['Active Tier-1 Suppliers', '12'],
      ['Total On-Hand Stock', '184290'],
      ['Asset Valuation USD', '1248500'],
    ];
    downloadCsv(`master-catalog-${storeId ?? 'CA_1'}.csv`, ['Metric', 'Value'], rows);
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
                    <Badge tone="success">● {t('products.master.kpi_total_skus_badge')}</Badge>
                  </div>
                  <div className="prd-kpi-val">3,049</div>
                </div>
                <div className="prd-kpi-foot">
                  <span>{t('products.master.kpi_skus_breakdown')}</span>
                </div>
              </div>

              <div className="prd-kpi-card">
                <div>
                  <div className="prd-kpi-head">
                    <span className="prd-kpi-title">{t('products.master.kpi_below_rop')}</span>
                    <Badge tone="danger">{t('products.master.kpi_below_rop_badge')}</Badge>
                  </div>
                  <div className="prd-kpi-val">
                    49 <span className="prd-kpi-unit">SKUs</span>
                  </div>
                </div>
                <div className="prd-kpi-foot">
                  <span style={{ color: 'var(--color-danger-text)', fontWeight: 'var(--weight-semibold)' }}>
                    {t('products.master.kpi_below_rop_risk')}
                  </span>
                </div>
              </div>

              <div className="prd-kpi-card">
                <div>
                  <div className="prd-kpi-head">
                    <span className="prd-kpi-title">{t('products.master.kpi_suppliers')}</span>
                    <Badge tone="info">{t('products.master.kpi_suppliers_badge')}</Badge>
                  </div>
                  <div className="prd-kpi-val">12</div>
                </div>
                <div className="prd-kpi-foot">
                  <span>{t('products.master.kpi_suppliers_sub')}</span>
                </div>
              </div>

              <div className="prd-kpi-card">
                <div>
                  <div className="prd-kpi-head">
                    <span className="prd-kpi-title">{t('products.master.kpi_onhand')}</span>
                    <Badge tone="neutral">10 Stores Aggregated</Badge>
                  </div>
                  <div className="prd-kpi-val">
                    184,290 <span className="prd-kpi-unit">{t('products.master.kpi_onhand_units')}</span>
                  </div>
                </div>
                <div className="prd-kpi-foot">
                  <span>{t('products.master.kpi_onhand_sub')}</span>
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