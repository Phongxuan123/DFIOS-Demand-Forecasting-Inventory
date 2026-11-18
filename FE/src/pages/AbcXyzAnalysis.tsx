import React, { useRef, useState } from 'react';
import { Badge, EmptyState, PageHeader } from '../components/ui/index.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useStore } from '../context/StoreContext.tsx';
import { can } from '../auth/permissions.ts';
import { useApi } from '../hooks/useApi.ts';
import { useFormat, useT } from '../i18n/index.tsx';
import { getMatrix, getRecommendations, getServiceLevel, getSkus } from '../services/abcxyzApi.ts';
import { getCalibrationStatus } from '../services/replenishmentApi.ts';
import { getKpiShadowDashboard, type SegmentAvailability } from '../services/dashboardApi.ts';
import { MatrixCard } from './abcxyz/MatrixCard.tsx';
import { PolicyCard } from './abcxyz/PolicyCard.tsx';
import { RecomputeButton } from './abcxyz/RecomputeButton.tsx';
import { ScatterCard } from './abcxyz/ScatterCard.tsx';
import { SkuTable } from './abcxyz/SkuTable.tsx';
import './abcxyz/abcxyz.css';

const SCATTER_SAMPLE = 500;

type ClassService = { avail: number; target: number; below: number; n: number } | null;

const ClassBadge: React.FC<{ info: ClassService }> = ({ info }) => {
  const t = useT();
  if (!info) return <Badge tone="neutral">{t('abcxyz.kpi.no_service')}</Badge>;
  return info.below === 0 ? (
    <Badge tone="success">✓ {t('abcxyz.kpi.compliant')}</Badge>
  ) : (
    <Badge tone="warning">⚠ {t('abcxyz.kpi.below_target', { below: info.below, n: info.n })}</Badge>
  );
};

const ClassServiceLine: React.FC<{ info: ClassService }> = ({ info }) => {
  const t = useT();
  const fmt = useFormat();
  if (!info) return <span className="ui-muted">{t('abcxyz.kpi.no_service_hint')}</span>;
  const diff = info.avail - info.target;
  return (
    <span style={{ color: diff < 0 ? 'var(--color-warning-text)' : undefined }}>
      {t('abcxyz.kpi.sla_label', {
        sla: fmt.percent(info.avail, { scale: 'percent', digits: 1 }),
        diff: fmt.percent(diff, { scale: 'percent', digits: 1, signed: true }),
        target: fmt.percent(info.target, { scale: 'percent', digits: 1 }),
      })}
    </span>
  );
};

export const AbcXyzAnalysis: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const { user } = useAuth();
  const { storeId, loading: storeLoading } = useStore();
  const manager = can(user?.role, 'policy:manage');
  const [segment, setSegment] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const skuSectionRef = useRef<HTMLDivElement>(null);
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
  // Observed availability per ABC x XYZ class (simulator, closed cycles) and the commitment target
  const service = useApi((s) => getKpiShadowDashboard(storeId as string, s), [storeId, version], { enabled });

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

  const segService = service.data?.segment_availabilities ?? [];
  /** Availability of an ABC row: the class figures weighted by their observed SKU-periods. */
  const rowService = (abc: 'A' | 'B' | 'C'): ClassService => {
    const rows = segService.filter((sg: SegmentAvailability) => sg.class_id.startsWith(abc) && sg.c3out_availability !== null);
    const w = rows.reduce((n, sg) => n + (sg.n_periods ?? 0), 0);
    if (!rows.length || w <= 0) return null;
    const avail = rows.reduce((n, sg) => n + (sg.c3out_availability as number) * (sg.n_periods ?? 0), 0) / w;
    const below = rows.filter((sg) => (sg.c3out_availability as number) < sg.target).length;
    return { avail, target: rows[0].target, below, n: rows.length };
  };

  const onDone = () => {
    setSegment(null);
    setVersion((v) => v + 1);
  };

  const onSelectSegment = (seg: string | null) => {
    setSegment(seg);
    if (seg) {
      setTimeout(() => {
        skuSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  };

  const meta = m?.last_updated ? (
    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
      {t('abcxyz.updated', { date: fmt.dateTime(m.last_updated) })}
    </span>
  ) : undefined;

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
                <ClassBadge info={rowService('A')} />
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
                  <ClassServiceLine info={rowService('A')} />
                </div>
              </div>
            </div>

            <div className="abc-portfolio-card">
              <div className="abc-portfolio-card__head">
                <span className="abc-portfolio-card__title">
                  <span className="abc-dot abc-dot--sky" />
                  {t('abcxyz.kpi.class_b_title')}
                </span>
                <ClassBadge info={rowService('B')} />
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
                  <ClassServiceLine info={rowService('B')} />
                </div>
              </div>
            </div>

            <div className="abc-portfolio-card">
              <div className="abc-portfolio-card__head">
                <span className="abc-portfolio-card__title">
                  <span className="abc-dot abc-dot--amber" />
                  {t('abcxyz.kpi.class_c_title')}
                </span>
                <ClassBadge info={rowService('C')} />
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
                <div className="abc-portfolio-sla">
                  <ClassServiceLine info={rowService('C')} />
                </div>
              </div>
            </div>
          </div>

          <MatrixCard
            matrix={m}
            thetas={calib.data?.thetas}
            service={segService}
            serviceLoading={service.loading && !service.data}
            loading={matrix.loading}
            error={matrix.error}
            onRetry={matrix.refetch}
            selected={segment}
            onSelect={onSelectSegment}
          />

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

          <div ref={skuSectionRef}>
            <SkuTable storeId={storeId} segment={segment} onClearSegment={() => setSegment(null)} version={version} />
          </div>

          <ScatterCard
            items={sample.data?.items}
            total={sample.data?.total}
            loading={sample.loading}
            error={sample.error}
            onRetry={sample.refetch}
            storeId={storeId}
          />
        </>
      )}
    </div>
  );
};
