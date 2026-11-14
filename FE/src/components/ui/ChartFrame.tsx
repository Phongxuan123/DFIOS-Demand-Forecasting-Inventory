import React, { useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/index.tsx';
import { useTheme } from '../../theme/ThemeContext.tsx';
import { Card, DataSourceNote, Skeleton } from './primitives.tsx';
import { EmptyState, ErrorState } from './states.tsx';
import { ChartThemeContext, readChartTheme, type ChartTheme } from './chartTheme.tsx';
import './ui.css';

export interface ChartFrameProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Chart height in px (Recharts needs a definite height). Default 280. */
  height?: number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** No data points: shows the empty state instead of an empty axis. */
  empty?: boolean;
  /** The series cannot be computed (reason shown). */
  unavailableReason?: string;
  /** Provenance, rendered as "Nguồn: …". Always provide it for real data. */
  source?: string;
  asOf?: React.ReactNode;
  /** Legend / table toggle etc. rendered under the chart. */
  footer?: React.ReactNode;
  /** The chart; wrap with <ResponsiveContainer width="100%" height="100%">. */
  children: React.ReactNode;
  className?: string;
}

/**
 * Card that hosts one chart and gives it loading / empty / error / unavailable states and a
 * theme (useChartTheme). The theme is re-read when the app theme (or a forced data-theme) changes.
 */
export const ChartFrame: React.FC<ChartFrameProps> = ({
  title,
  description,
  actions,
  height = 280,
  loading,
  error,
  onRetry,
  empty,
  unavailableReason,
  source,
  asOf,
  footer,
  children,
  className,
}) => {
  const t = useT();
  const { theme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [chartTheme, setChartTheme] = useState<ChartTheme | null>(null);

  useLayoutEffect(() => {
    setChartTheme(readChartTheme(ref.current));
  }, [theme]);

  // A forced data-theme on an ancestor (design-system page) changes tokens without changing `theme`.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const host = el.closest('[data-theme]');
    if (!host) return;
    const obs = new MutationObserver(() => setChartTheme(readChartTheme(el)));
    obs.observe(host, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  let body: React.ReactNode;
  if (loading) body = <Skeleton height={height} style={{ borderRadius: 'var(--radius-md)' }} />;
  else if (error) body = <ErrorState error={error} onRetry={onRetry} compact />;
  else if (unavailableReason)
    body = <EmptyState compact title={t('common.state.unavailable')} description={t('common.state.unavailable_reason', { reason: unavailableReason })} />;
  else if (empty) body = <EmptyState compact title={t('common.chart.no_data')} description="" />;
  else body = <div style={{ height }}>{chartTheme ? children : null}</div>;

  return (
    <Card title={title} description={description} actions={actions} className={className}>
      <div ref={ref} className="ui-chart__body">
        <ChartThemeContext.Provider value={chartTheme}>{body}</ChartThemeContext.Provider>
      </div>
      {footer}
      {source && !loading && <DataSourceNote source={source} asOf={asOf} />}
    </Card>
  );
};
