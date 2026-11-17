import React from 'react';
import { Layers } from 'lucide-react';
import { Badge, Card, ErrorState, Skeleton } from '../../components/ui/index.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import type { ClassificationMatrix, ClassificationThresholds } from '../../services/abcxyzApi.ts';

const ABC = ['A', 'B', 'C'] as const;
const XYZ = ['X', 'Y', 'Z'] as const;

const SEGMENT_SLA: Record<string, { sla: number; warning: boolean; diff: string }> = {
  AX: { sla: 97.8, warning: false, diff: '+1.8%' },
  AY: { sla: 96.9, warning: false, diff: '+0.9%' },
  AZ: { sla: 95.1, warning: true, diff: '-0.9%' },
  BX: { sla: 96.7, warning: false, diff: '+0.7%' },
  BY: { sla: 96.2, warning: false, diff: '+0.2%' },
  BZ: { sla: 95.4, warning: true, diff: '-0.6%' },
  CX: { sla: 98.1, warning: false, diff: '+2.1%' },
  CY: { sla: 95.9, warning: true, diff: '-0.1%' },
  CZ: { sla: 95.2, warning: true, diff: '-0.8%' },
};

const DEFAULT_THETAS: Record<string, number> = {
  AX: 0.09,
  AY: 0.18,
  AZ: 0.39,
  BX: 0.09,
  BY: 0.16,
  BZ: 0.38,
  CX: 0.14,
  CY: 0.12,
  CZ: 0.33,
};

interface Props {
  matrix: ClassificationMatrix | undefined;
  thetas?: Record<string, number>;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  selected: string | null;
  onSelect: (segment: string | null) => void;
}

export const MatrixCard: React.FC<Props> = ({ matrix, thetas, loading, error, onRetry, selected, onSelect }) => {
  const t = useT();
  const fmt = useFormat();

  const getRowMeta = (a: 'A' | 'B' | 'C') => {
    const segs = matrix?.segments.filter((s) => s.abc === a) ?? [];
    const count = segs.reduce((sum, s) => sum + s.sku_count, 0);
    return {
      title: a === 'A' ? t('abcxyz.matrix.row_a') : a === 'B' ? t('abcxyz.matrix.row_b') : t('abcxyz.matrix.row_c'),
      sub: a === 'A' ? t('abcxyz.matrix.row_a_sub') : a === 'B' ? t('abcxyz.matrix.row_b_sub') : t('abcxyz.matrix.row_c_sub'),
      count,
    };
  };

  const getColMeta = (x: 'X' | 'Y' | 'Z') => {
    return {
      title: x === 'X' ? t('abcxyz.matrix.col_x') : x === 'Y' ? t('abcxyz.matrix.col_y') : t('abcxyz.matrix.col_z'),
      sub: x === 'X' ? t('abcxyz.matrix.col_x_sub') : x === 'Y' ? t('abcxyz.matrix.col_y_sub') : t('abcxyz.matrix.col_z_sub'),
    };
  };

  return (
    <Card
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Layers size={18} color="var(--color-accent)" />
            <span>{t('abcxyz.matrix.governance_title')}</span>
          </div>
          <span className="abc-interactive-hint">
            <strong>{t('abcxyz.matrix.interactive_hint')}</strong>
          </span>
        </div>
      }
      description={t('abcxyz.matrix.governance_subtitle')}
    >
      {error ? (
        <ErrorState error={error} onRetry={onRetry} compact />
      ) : loading && !matrix ? (
        <Skeleton height={380} />
      ) : (
        <div className="abc-matrix-wrap">
          <div className="abc-matrix" role="group" aria-label={t('abcxyz.matrix.governance_title')}>
            <div className="abc-matrix__corner">
              <span>{t('abcxyz.matrix.abc_axis')}</span>
              <span style={{ opacity: 0.4 }}>\</span>
              <span>{t('abcxyz.matrix.xyz_axis')}</span>
            </div>

            {XYZ.map((x) => {
              const meta = getColMeta(x);
              return (
                <div key={x} className="abc-matrix__col-header">
                  <span className="abc-matrix__col-title">{meta.title}</span>
                  <span className="abc-matrix__col-sub">{meta.sub}</span>
                </div>
              );
            })}

            {ABC.map((a) => {
              const rMeta = getRowMeta(a);
              return (
                <React.Fragment key={a}>
                  <div className="abc-matrix__row-header">
                    <span className="abc-matrix__row-title">{rMeta.title}</span>
                    <span className="abc-matrix__row-sub">{rMeta.sub}</span>
                    <span className="abc-matrix__row-count">{fmt.integer(rMeta.count)} SKUs</span>
                  </div>

                  {XYZ.map((x) => {
                    const seg = `${a}${x}`;
                    const cell = matrix?.matrix?.[seg];
                    const n = cell?.sku_count ?? 0;
                    const skuP = cell ? fmt.percent(cell.sku_percentage, { scale: 'percent', digits: 1 }) : '0%';
                    const revP = cell ? fmt.percent(cell.revenue_percentage, { scale: 'percent', digits: 1 }) : '0%';
                    const slaInfo = SEGMENT_SLA[seg] ?? { sla: 96.0, warning: false, diff: '+0.0%' };
                    const thetaVal = thetas?.[seg] ?? DEFAULT_THETAS[seg] ?? 0.1;
                    const isSelected = selected === seg;

                    return (
                      <button
                        type="button"
                        key={seg}
                        className={`abc-cell ${isSelected ? 'is-selected' : ''}`}
                        aria-pressed={isSelected}
                        onClick={() => onSelect(isSelected ? null : seg)}
                      >
                        <div className="abc-cell__top">
                          <span className="abc-cell__seg">{seg}</span>
                          <Badge tone={slaInfo.warning ? 'warning' : 'success'}>
                            {slaInfo.warning ? `⚠ ${slaInfo.diff}` : '✓ COMPLIANT'}
                          </Badge>
                        </div>

                        <div className="abc-cell__body">
                          <div className="abc-cell__metric">
                            <span className="abc-cell__label">{t('abcxyz.matrix.cell_vol')}:</span>
                            <span className="abc-cell__val">{fmt.integer(n)} ({skuP})</span>
                          </div>
                          <div className="abc-cell__metric">
                            <span className="abc-cell__label">{t('abcxyz.matrix.cell_rev')}:</span>
                            <span className="abc-cell__val">{revP}</span>
                          </div>
                          <div className="abc-cell__metric">
                            <span className="abc-cell__label">{t('abcxyz.matrix.cell_sla')}:</span>
                            <span className={`abc-cell__val ${slaInfo.warning ? 'abc-cell__val--warning' : 'abc-cell__val--success'}`}>
                              {slaInfo.sla}%
                            </span>
                          </div>
                          <div className="abc-cell__metric">
                            <span className="abc-cell__label">{t('abcxyz.matrix.cell_theta')}:</span>
                            <span className="abc-cell__theta">
                              θ{thetaVal >= 0 ? '+' : ''}{thetaVal.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>
        </div>
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
