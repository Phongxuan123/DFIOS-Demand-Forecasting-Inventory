import React from 'react';
import { Info } from 'lucide-react';
import { Badge, KpiTile, Tooltip } from '../ui/index.ts';
import { useFormat, useT } from '../../i18n/index.tsx';

/** Research objective O2: window quantile coverage at tau = 0.95 must lie in [0.93, 0.97]. */
export const O2_LOW = 0.93;
export const O2_HIGH = 0.97;

interface Props {
  /** `coverage_q95`: 10-day (L+R) window coverage of Q0.95, offline c3ok pipeline, M5 test split. */
  artifact?: number | null;
  artifactSource?: string | null;
  /** `coverage_q95_db_causal`: same 10-day window definition, but route (c) causal quantiles of this DB (other forecasts and sample). Never merged with `artifact`. */
  dbCausal?: number | null;
  dbCausalN?: number | null;
  loading?: boolean;
  /** Reason shown when a value is null. */
  missingReason?: string;
}

const Help: React.FC<{ text: string; label: string }> = ({ text, label }) => (
  <Tooltip content={text}>
    <button type="button" className="ui-btn ui-btn--ghost" style={{ padding: 0, height: 'auto', minWidth: 0, display: 'inline-flex' }} aria-label={label}>
      <Info size={13} aria-hidden="true" />
    </button>
  </Tooltip>
);

/**
 * Two separate tiles: coverage_q95 and coverage_q95_db_causal share the definition (share of SKU × origin
 * 10-day windows with actual total <= Q0.95) but come from different forecasts, calibration and samples,
 * so each keeps its own label, provenance and tooltip.
 */
export const CoverageTiles: React.FC<Props> = ({ artifact, artifactSource, dbCausal, dbCausalN, loading, missingReason }) => {
  const t = useT();
  const fmt = useFormat();
  const band = (v: number) => (v >= O2_LOW && v <= O2_HIGH ? 'success' : 'danger');
  const target = t('common.coverage.target', { low: fmt.number(O2_LOW, { digits: 2 }), high: fmt.number(O2_HIGH, { digits: 2 }) });
  const reason = missingReason ?? t('common.coverage.missing');
  return (
    <>
      <KpiTile
        label={
          <span>
            {t('common.coverage.artifact_label')} <Help text={t('common.coverage.artifact_help')} label={t('common.coverage.artifact_label')} />
          </span>
        }
        loading={loading}
        value={artifact != null ? fmt.percent(artifact, { digits: 1 }) : null}
        unavailableReason={artifact == null && !loading ? reason : undefined}
        hint={
          artifact != null ? (
            <>
              <Badge tone={band(artifact)}>{band(artifact) === 'success' ? t('common.coverage.in') : t('common.coverage.out')}</Badge> {target}
              {artifactSource ? ` · ${artifactSource}` : ''}
            </>
          ) : (
            target
          )
        }
      />
      <KpiTile
        label={
          <span>
            {t('common.coverage.db_label')} <Help text={t('common.coverage.db_help')} label={t('common.coverage.db_label')} />
          </span>
        }
        loading={loading}
        value={dbCausal != null ? fmt.percent(dbCausal, { digits: 1 }) : null}
        unavailableReason={dbCausal == null && !loading ? reason : undefined}
        hint={
          dbCausal != null ? (
            <>
              <Badge tone={band(dbCausal)}>{band(dbCausal) === 'success' ? t('common.coverage.in') : t('common.coverage.out')}</Badge>{' '}
              {dbCausalN != null ? t('common.coverage.db_n', { n: fmt.integer(dbCausalN) }) : t('common.coverage.db_source')}
            </>
          ) : (
            target
          )
        }
      />
    </>
  );
};
