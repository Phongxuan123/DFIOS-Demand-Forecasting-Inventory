import React from 'react';
import { Card, ErrorState, Skeleton } from '../../components/ui/index.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import type { ClassificationMatrix, ClassificationThresholds } from '../../services/abcxyzApi.ts';

const ABC = ['A', 'B', 'C'] as const;
const XYZ = ['X', 'Y', 'Z'] as const;

interface Props {
  matrix: ClassificationMatrix | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  selected: string | null;
  onSelect: (segment: string | null) => void;
}

export const MatrixCard: React.FC<Props> = ({ matrix, loading, error, onRetry, selected, onSelect }) => {
  const t = useT();
  const fmt = useFormat();
  const maxPct = Math.max(1, ...(matrix?.segments.map((s) => s.sku_percentage) ?? [0]));

  return (
    <Card title={t('abcxyz.matrix.title')} description={t('abcxyz.matrix.description')}>
      {error ? (
        <ErrorState error={error} onRetry={onRetry} compact />
      ) : loading && !matrix ? (
        <Skeleton height={300} />
      ) : (
        <>
          <div className="abc-matrix" role="group" aria-label={t('abcxyz.matrix.title')}>
            <div className="abc-matrix__corner">
              {t('abcxyz.matrix.abc_axis')} / {t('abcxyz.matrix.xyz_axis')}
            </div>
            {XYZ.map((x) => (
              <div key={x} className="abc-matrix__axis">
                {x}
              </div>
            ))}
            {ABC.map((a) => (
              <React.Fragment key={a}>
                <div className="abc-matrix__axis abc-matrix__axis--row">{a}</div>
                {XYZ.map((x) => {
                  const seg = `${a}${x}`;
                  const cell = matrix?.matrix?.[seg];
                  const n = cell?.sku_count ?? null;
                  const skuP = cell ? fmt.percent(cell.sku_percentage, { scale: 'percent', digits: 1 }) : '—';
                  const revP = cell ? fmt.percent(cell.revenue_percentage, { scale: 'percent', digits: 1 }) : '—';
                  const heat = cell ? Math.min(0.28, (cell.sku_percentage / maxPct) * 0.28) : 0;
                  return (
                    <button
                      type="button"
                      key={seg}
                      className="abc-cell"
                      aria-pressed={selected === seg}
                      aria-label={t('abcxyz.matrix.cell_label', { segment: seg, n: fmt.integer(n), sku: skuP, rev: revP })}
                      onClick={() => onSelect(selected === seg ? null : seg)}
                    >
                      <span className="abc-cell__heat" style={{ opacity: heat }} aria-hidden="true" />
                      <span className="abc-cell__seg">{seg}</span>
                      <span className="abc-cell__count">{fmt.integer(n)}</span>
                      <span className="abc-cell__meta">{t('abcxyz.matrix.sku_share', { p: skuP })}</span>
                      <span className="abc-cell__meta">{t('abcxyz.matrix.revenue_share', { p: revP })}</span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </>
      )}
    </Card>
  );
};

export const ThresholdsCard: React.FC<{ thresholds: ClassificationThresholds | undefined; loading: boolean }> = ({ thresholds, loading }) => {
  const t = useT();
  const fmt = useFormat();
  return (
    <Card title={t('abcxyz.thresholds.title')} description={t('abcxyz.thresholds.description')}>
      {loading && !thresholds ? (
        <Skeleton height={120} />
      ) : thresholds ? (
        <ul className="abc-thresholds">
          <li>{t('abcxyz.thresholds.a', { v: fmt.number(thresholds.a_cutoff) })}</li>
          <li>{t('abcxyz.thresholds.b', { v: fmt.number(thresholds.b_cutoff) })}</li>
          <li>{t('abcxyz.thresholds.c', { v: fmt.number(thresholds.c_cutoff) })}</li>
          <li>{t('abcxyz.thresholds.x', { v: fmt.number(thresholds.cv_x) })}</li>
          <li>{t('abcxyz.thresholds.y', { x: fmt.number(thresholds.cv_x), v: fmt.number(thresholds.cv_y) })}</li>
          <li>{t('abcxyz.thresholds.z', { v: fmt.number(thresholds.cv_y) })}</li>
        </ul>
      ) : (
        <p className="abc-note">—</p>
      )}
    </Card>
  );
};
