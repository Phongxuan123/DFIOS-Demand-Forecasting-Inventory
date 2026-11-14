import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { useStore } from '../context/StoreContext.tsx';
import { useT } from '../i18n/index.tsx';
import { can } from '../auth/permissions.ts';
import { Alert, PageHeader, Tabs, type TabItem } from '../components/ui/index.ts';
import { ProductsTab } from './products/ProductsTab.tsx';
import { SuppliersTab } from './products/SuppliersTab.tsx';
import { AdjustmentsTab } from './products/AdjustmentsTab.tsx';
import { SalesTab } from './products/SalesTab.tsx';
import { EventsTab } from './products/EventsTab.tsx';
import './Products.css';

type TabId = 'products' | 'suppliers' | 'adjustments' | 'sales' | 'events';

export const Products: React.FC = () => {
  const t = useT();
  const { user } = useAuth();
  const { storeId } = useStore();
  const [tab, setTab] = useState<TabId>('products');
  const isManager = can(user?.role, 'inventory:adjust');

  const items: TabItem<TabId>[] = [
    { id: 'products', label: t('products.tabs.products') },
    { id: 'suppliers', label: t('products.tabs.suppliers') },
    ...(isManager ? [{ id: 'adjustments' as const, label: t('products.tabs.adjustments') }] : []),
    { id: 'sales', label: t('products.tabs.sales') },
    { id: 'events', label: t('products.tabs.events') },
  ];

  return (
    <div className="ui-stack">
      <PageHeader title={t('products.title')} description={t('products.description')} />
      {!storeId && <Alert tone="warning">{t('products.no_store')}</Alert>}
      <Tabs aria-label={t('products.title')} items={items} value={tab} onChange={setTab} />
      {tab === 'products' && <ProductsTab />}
      {tab === 'suppliers' && <SuppliersTab />}
      {tab === 'adjustments' && isManager && <AdjustmentsTab />}
      {tab === 'sales' && <SalesTab />}
      {tab === 'events' && <EventsTab />}
    </div>
  );
};
