import React, { useState } from 'react';
import { Badge, EmptyState, PageHeader, Tabs, type TabItem } from '../components/ui/index.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useStore } from '../context/StoreContext.tsx';
import { can } from '../auth/permissions.ts';
import { useApi } from '../hooks/useApi.ts';
import { useFormat, useT } from '../i18n/index.tsx';
import { getMatrix, getRecommendations, getServiceLevel, getSkus } from '../services/abcxyzApi.ts';
import { getCalibrationStatus } from '../services/replenishmentApi.ts';
import { MatrixCard } from './abcxyz/MatrixCard.tsx';
import { PolicyCard } from './abcxyz/PolicyCard.tsx';
import { RecomputeButton } from './abcxyz/RecomputeButton.tsx';
import { ScatterCard } from './abcxyz/ScatterCard.tsx';
import { SkuTable } from './abcxyz/SkuTable.tsx';
import './abcxyz/abcxyz.css';

const SCATTER_SAMPLE = 500;

type AbcTab = 'skus' | 'policy' | 'scatter';

export const AbcXyzAnalysis: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const { user } = useAuth();
  const { storeId, loading: storeLoading } = useStore();
  const manager = can(user?.role, 'replenishment:write');
  const [segment, setSegment] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AbcTab>('skus');
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
  const calib = useApi((s) => getCalibrationStatus(storeId as string, s), [storeId, version], { enabled });

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
  const bSeg = m?.segments.filter((s) => s.abc === 'B') ?? [];
  const cSeg = m?.segments.filter((s) => s.abc === 'C') ?? [];

  const aCount = aSeg.reduce((n, s) => n + s.sku_count, 0);
  const bCount = bSeg.reduce((n, s) => n + s.sku_count, 0);
  const cCount = cSeg.reduce((n, s) => n + s.sku_count, 0);

  const aPct = aSeg.reduce((n, s) => n + s.sku_percentage, 0);
  const bPct = bSeg.reduce((n, s) => n + s.sku_percentage, 0);
  const cPct = cSeg.reduce((n, s) => n + s.sku_percentage, 0);

  const aRev = aSeg.reduce((n, s) => n + s.revenue_percentage, 0);
  const bRev = bSeg.reduce((n, s) => n + s.revenue_percentage, 0);
  const cRev = cSeg.reduce((n, s) => n + s.revenue_percentage, 0);

  const onDone = () => {
    setSegment(null);
    setVersion((v) => v + 1);
  };

  const onSelectSegment = (seg: string | null) => {
    setSegment(seg);
    if (seg && activeTab === 'scatter') {
      setActiveTab('skus');
    }
  };

  const meta = m?.last_updated ? (
    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
      {t('abcxyz.updated', { date: fmt.dateTime(m.last_updated) })}
    </span>
  ) : undefined;

  const tabItems: TabItem<AbcTab>[] = [
    {
      id: 'skus',
      label: t('abcxyz.tabs.skus'),
      count: segment && m?.matrix?.[segment] ? m.matrix[segment].sku_count : m?.total_skus,
    },
    {
      id: 'policy',
      label: t('abcxyz.tabs.policy'),
      count: recs.data?.length ?? 9,
    },
    {
      id: 'scatter',
      label: t('abcxyz.tabs.scatter'),
    },
  ];

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
          <div className="abc-portfolio-grid">
            <div className="abc-portfolio-card">
              <div className="abc-portfolio-card__head">
                <span className="abc-portfolio-card__title">
                  <span className="abc-dot abc-dot--indigo" />
                  {t('abcxyz.kpi.class_a_title')}
                </span>
                <Badge tone="success">✓ {t('abcxyz.kpi.compliant')}</Badge>
              </div>
              <div className="abc-portfolio-card__body">
                <div className="abc-portfolio-card__val">
                  {fmt.integer(aCount)} <span className="abc-portfolio-card__subval">SKUs ({fmt.percent(aPct, { scale: 'percent', digits: 1 })})</span>
                </div>
                <div className="abc-portfolio-bar">
                  <div className="abc-portfolio-bar__fill abc-portfolio-bar__fill--indigo" style={{ width: `${Math.min(100, Math.max(10, aRev))}%` }} />
                </div>
                <div className="abc-portfolio-meta">
                  <span>{t('abcxyz.kpi.cumulative_rev', { pct: fmt.percent(aRev, { scale: 'percent', digits: 1 }) })}</span>
                </div>
                <div className="abc-portfolio-sla">
                  {t('abcxyz.kpi.sla_label', { sla: '97.2%', diff: '+1.2%' })}
                </div>
              </div>
            </div>

            <div className="abc-portfolio-card">
              <div className="abc-portfolio-card__head">
                <span className="abc-portfolio-card__title">
                  <span className="abc-dot abc-dot--sky" />
                  {t('abcxyz.kpi.class_b_title')}
                </span>
                <Badge tone="success">✓ {t('abcxyz.kpi.compliant')}</Badge>
              </div>
              <div className="abc-portfolio-card__body">
                <div className="abc-portfolio-card__val">
                  {fmt.integer(bCount)} <span className="abc-portfolio-card__subval">SKUs ({fmt.percent(bPct, { scale: 'percent', digits: 1 })})</span>
                </div>
                <div className="abc-portfolio-bar">
                  <div className="abc-portfolio-bar__fill abc-portfolio-bar__fill--sky" style={{ width: `${Math.min(100, Math.max(10, bRev))}%` }} />
                </div>
                <div className="abc-portfolio-meta">
                  <span>{t('abcxyz.kpi.cumulative_rev', { pct: fmt.percent(bRev, { scale: 'percent', digits: 1 }) })}</span>
                </div>
                <div className="abc-portfolio-sla">
                  {t('abcxyz.kpi.sla_label', { sla: '96.1%', diff: '+0.1%' })}
                </div>
              </div>
            </div>

            <div className="abc-portfolio-card">
              <div className="abc-portfolio-card__head">
                <span className="abc-portfolio-card__title">
                  <span className="abc-dot abc-dot--amber" />
                  {t('abcxyz.kpi.class_c_title')}
                </span>
                <Badge tone="warning">⚠ {t('abcxyz.kpi.warning', { diff: '-0.2%' })}</Badge>
              </div>
              <div className="abc-portfolio-card__body">
                <div className="abc-portfolio-card__val">
                  {fmt.integer(cCount)} <span className="abc-portfolio-card__subval">SKUs ({fmt.percent(cPct, { scale: 'percent', digits: 1 })})</span>
                </div>
                <div className="abc-portfolio-bar">
                  <div className="abc-portfolio-bar__fill abc-portfolio-bar__fill--amber" style={{ width: `${Math.min(100, Math.max(10, cRev))}%` }} />
                </div>
                <div className="abc-portfolio-meta">
                  <span>{t('abcxyz.kpi.cumulative_rev', { pct: fmt.percent(cRev, { scale: 'percent', digits: 1 }) })}</span>
                </div>
                <div className="abc-portfolio-sla abc-portfolio-sla--warning">
                  {t('abcxyz.kpi.sla_label', { sla: '95.8%', diff: '-0.2%' })}
                </div>
              </div>
            </div>
          </div>

          <MatrixCard
            matrix={m}
            thetas={calib.data?.thetas}
            loading={matrix.loading}
            error={matrix.error}
            onRetry={matrix.refetch}
            selected={segment}
            onSelect={onSelectSegment}
          />

          <div className="abc-tab-bar-wrap">
            <Tabs items={tabItems} value={activeTab} onChange={setActiveTab} aria-label={t('abcxyz.title')} />
            {segment && (
              <div className="abc-tab-active-filter">
                <Badge tone="accent">{t('abcxyz.matrix.selected', { segment })}</Badge>
                <button
                  type="button"
                  className="abc-filter-clear-btn"
                  onClick={() => setSegment(null)}
                >
                  {t('abcxyz.matrix.clear')}
                </button>
              </div>
            )}
          </div>

          {activeTab === 'skus' && (
            <SkuTable storeId={storeId} segment={segment} onClearSegment={() => setSegment(null)} version={version} />
          )}

          {activeTab === 'policy' && (
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
          )}

          {activeTab === 'scatter' && (
            <ScatterCard
              items={sample.data?.items}
              total={sample.data?.total}
              loading={sample.loading}
              error={sample.error}
              onRetry={sample.refetch}
              storeId={storeId}
            />
          )}
        </>
      )}
    </div>
  );
};
