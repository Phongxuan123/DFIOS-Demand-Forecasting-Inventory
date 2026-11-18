import React from 'react';
import { AlertTriangle, Boxes, PackageCheck, Truck } from 'lucide-react';
import { useFormat, useT } from '../../i18n/index.tsx';
import { KpiTile, StatusPill, type Tone } from '../ui/index.ts';
import type { InventoryScreenSummary, StockStatus } from '../../services/inventoryScreenApi.ts';
import './inventory.css';

const STATUS_TONE: Record<StockStatus, Tone> = {
  below_s: 'danger',
  ok: 'success',
  above_S: 'warning',
  no_params: 'neutral',
};

export const StockStatusPill: React.FC<{ status: StockStatus }> = ({ status }) => {
  const t = useT();
  return <StatusPill tone={STATUS_TONE[status]}>{t(`inventory.status.${status}`)}</StatusPill>;
};

export const InventorySummaryTiles: React.FC<{ summary?: InventoryScreenSummary; loading?: boolean }> = ({ summary, loading }) => {
  const t = useT();
  const fmt = useFormat();
  return (
    <div className="inv-kpi-grid">
      <KpiTile
        label={t('inventory.summary.below_s')}
        icon={<AlertTriangle size={16} />}
        loading={loading}
        value={summary ? fmt.integer(summary.below_s_count) : undefined}
        hint={t('inventory.summary.below_s_hint')}
      />
      <KpiTile
        label={t('inventory.summary.stock_value')}
        icon={<PackageCheck size={16} />}
        loading={loading}
        value={summary ? fmt.currency(summary.total_stock_value) : undefined}
        hint={summary ? t('inventory.summary.stock_value_hint', { count: fmt.integer(summary.priced_sku_count) }) : undefined}
      />
      <KpiTile
        label={t('inventory.summary.in_transit')}
        icon={<Truck size={16} />}
        loading={loading}
        value={summary ? fmt.integer(summary.orders_in_transit) : undefined}
        hint={
          summary
            ? t('inventory.summary.in_transit_hint', { units: fmt.integer(summary.units_in_transit), skus: fmt.integer(summary.skus_in_transit) })
            : undefined
        }
      />
      <KpiTile
        label={t('inventory.summary.sku_count')}
        icon={<Boxes size={16} />}
        loading={loading}
        value={summary ? fmt.integer(summary.sku_count) : undefined}
        hint={
          summary
            ? `${t('inventory.summary.above_S')}: ${fmt.integer(summary.above_S_count)} · ${t('inventory.summary.no_params_hint', { count: fmt.integer(summary.no_params_count) })}`
            : undefined
        }
      />
    </div>
  );
};
