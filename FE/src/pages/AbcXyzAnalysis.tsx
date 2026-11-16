import React, { useState } from 'react';
import { Boxes, DollarSign, Layers, Shuffle } from 'lucide-react';
import { EmptyState, KpiTile, PageHeader, DataSourceNote, Badge } from '../components/ui/index.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useStore } from '../context/StoreContext.tsx';
import { can } from '../auth/permissions.ts';
import { useApi } from '../hooks/useApi.ts';
import { useFormat, useT } from '../i18n/index.tsx';
import { getMatrix, getRecommendations, getServiceLevel, getSkus } from '../services/abcxyzApi.ts';
import { MatrixCard, ThresholdsCard } from './abcxyz/MatrixCard.tsx';
import { PolicyCard } from './abcxyz/PolicyCard.tsx';
import { RecomputeButton } from './abcxyz/RecomputeButton.tsx';
import { ScatterCard } from './abcxyz/ScatterCard.tsx';
import { SkuTable } from './abcxyz/SkuTable.tsx';
import './abcxyz/abcxyz.css';

const SCATTER_SAMPLE = 500; // BE max page size

export const AbcXyzAnalysis: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const { user } = useAuth();
  const { storeId, loading: storeLoading } = useStore();
  const manager = can(user?.role, 'replenishment:write');
  const [segment, setSegment] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const enabled = !!storeId;

  const matrix = useApi((s) => getMatrix(storeId as string, s), [storeId, version], { enabled });
  const sample = useApi(
    (s) => getSkus({ store_id: storeId as string, limit: SCATTER_SAMPLE, sort_by: 'revenue', order: 'desc' }, s),
    [storeId, version],
    { enabled },
  );
  const recs = useApi((s) => getRecommendations(s), [version], { enabled: manager });
  const level = useApi((s) => getServiceLevel(s), [version], { enabled: manager });

  if (!storeId) {
    return (
      <div className="ui-stack">
        <PageHeader title={t('abcxyz.title')} description={t('abcxyz.description')} />
        {storeLoading ? null : <EmptyState title={t('abcxyz.no_store')} description={t('abcxyz.no_store_description')} />}
      </div>
    );
  }

  const m = matrix.data;
  const empty = !!m && m.total_skus === 0;
  const aSeg = m?.segments.filter((s) => s.abc === 'A') ?? [];
  const aCount = aSeg.reduce((n, s) => n + s.sku_count, 0);
  const aRev = aSeg.reduce((n, s) => n + s.revenue_percentage, 0);
  const zCount = (m?.segments.filter((s) => s.xyz === 'Z') ?? []).reduce((n, s) => n + s.sku_count, 0);
  const src = m?.class_sources ?? {};

  const onDone = () => {
    setSegment(null);
    setVersion((v) => v + 1);
  };

  const meta = (
    <>
      <DataSourceNote source={t('abcxyz.source', { store: storeId })} asOf={m?.last_updated ? t('abcxyz.updated', { date: fmt.dateTime(m.last_updated) }) : undefined} />
      {(src.ground_truth ?? 0) > 0 && <Badge tone="info">{t('abcxyz.class_source.ground_truth', { n: fmt.integer(src.ground_truth) })}</Badge>}
      {(src.thresholds ?? 0) > 0 && <Badge tone="neutral">{t('abcxyz.class_source.thresholds', { n: fmt.integer(src.thresholds) })}</Badge>}
    </>
  );

  return (
    <div className="ui-stack">
      <PageHeader
        title={`${t('abcxyz.title')} · ${storeId}`}
        description={t('abcxyz.description')}
        meta={meta}
        actions={<RecomputeButton storeId={storeId} allowed={manager} onDone={onDone} />}
      />

      {empty ? (
        <EmptyState title={t('abcxyz.kpi.empty_title')} description={t('abcxyz.kpi.empty_description')} />
      ) : (
        <>
          <div className="ui-grid ui-grid--kpi">
            <KpiTile label={t('abcxyz.kpi.total_skus')} value={m ? fmt.integer(m.total_skus) : null} icon={<Boxes size={16} />} loading={matrix.loading && !m} unavailableReason={matrix.error ? t('common.state.error_title') : undefined} />
            <KpiTile label={t('abcxyz.kpi.total_revenue')} value={m ? fmt.currency(m.total_revenue, { compact: true }) : null} icon={<DollarSign size={16} />} loading={matrix.loading && !m} unavailableReason={matrix.error ? t('common.state.error_title') : undefined} />
            <KpiTile label={t('abcxyz.kpi.a_share')} value={m ? fmt.integer(aCount) : null} hint={m ? t('abcxyz.kpi.a_share_hint', { revenue: fmt.percent(aRev, { scale: 'percent', digits: 1 }) }) : undefined} icon={<Layers size={16} />} loading={matrix.loading && !m} unavailableReason={matrix.error ? t('common.state.error_title') : undefined} />
            <KpiTile label={t('abcxyz.kpi.z_share')} value={m ? fmt.integer(zCount) : null} hint={t('abcxyz.kpi.z_share_hint')} icon={<Shuffle size={16} />} loading={matrix.loading && !m} unavailableReason={matrix.error ? t('common.state.error_title') : undefined} />
          </div>

          <div className="ui-grid ui-grid--2">
            <MatrixCard matrix={m} loading={matrix.loading} error={matrix.error} onRetry={matrix.refetch} selected={segment} onSelect={setSegment} />
            <ThresholdsCard thresholds={m?.thresholds} loading={matrix.loading} />
          </div>

          <PolicyCard
            allowed={manager}
            recs={recs.data}
            recsLoading={recs.loading}
            recsError={recs.error}
            onRetry={recs.refetch}
            matrix={m}
            serviceLevel={level.data}
            serviceLevelError={level.error}
            selected={segment}
          />

          <ScatterCard items={sample.data?.items} total={sample.data?.total} loading={sample.loading} error={sample.error} onRetry={sample.refetch} storeId={storeId} />

          <SkuTable storeId={storeId} segment={segment} onClearSegment={() => setSegment(null)} version={version} />
        </>
      )}
    </div>
  );
};
