/**
 * Chart theme: Recharts colours come from the --chart-* CSS tokens, so charts follow the
 * light/dark theme (and a forced data-theme on a subtree). Colours are read from the nearest
 * <ChartFrame>; outside a frame the <html> element is used.
 *
 *   const c = useChartTheme();
 *   <CartesianGrid stroke={c.grid} vertical={false} />
 *   <XAxis {...c.axis} />  <YAxis {...c.axis} />
 *   <Line stroke={c.series[0]} strokeWidth={2} dot={false} />
 *   <Tooltip content={<ChartTooltip format={(v) => fmt.integer(v)} />} cursor={c.cursor} />
 */
import React, { createContext, useContext } from 'react';
import { cx } from './primitives.tsx';
import './ui.css';

export interface ChartTheme {
  /** Categorical palette (max 8, fixed order, colour-blind safe). Never cycle: group the tail into "other". */
  series: string[];
  /** Single-hue sequential scale, low -> high (heatmaps, density). */
  sequential: string[];
  diverging: { negative: string; mid: string; positive: string };
  status: { good: string; warning: string; serious: string; critical: string };
  grid: string;
  axisLine: string;
  tick: string;
  reference: string;
  surface: string;
  bandOpacity: number;
  /** Spread on <XAxis>/<YAxis>. */
  axis: { stroke: string; tick: { fill: string; fontSize: number }; tickLine: false; axisLine: { stroke: string } };
  cursor: { stroke: string; strokeDasharray: string };
}

const SERIES_VARS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8'];
const SEQ_VARS = ['--chart-seq-1', '--chart-seq-2', '--chart-seq-3', '--chart-seq-4', '--chart-seq-5', '--chart-seq-6', '--chart-seq-7'];

export function readChartTheme(el: Element | null): ChartTheme {
  const cs = getComputedStyle(el ?? document.documentElement);
  const v = (name: string, fallback = '#888') => cs.getPropertyValue(name).trim() || fallback;
  const tick = v('--chart-tick');
  const axisLine = v('--chart-axis');
  return {
    series: SERIES_VARS.map((n) => v(n)),
    sequential: SEQ_VARS.map((n) => v(n)),
    diverging: { negative: v('--chart-div-neg'), mid: v('--chart-div-mid'), positive: v('--chart-div-pos') },
    status: { good: v('--chart-good'), warning: v('--chart-warning'), serious: v('--chart-serious'), critical: v('--chart-critical') },
    grid: v('--chart-grid'),
    axisLine,
    tick,
    reference: v('--chart-reference'),
    surface: v('--chart-surface', '#fff'),
    bandOpacity: Number(v('--chart-band-opacity', '0.14')) || 0.14,
    axis: { stroke: axisLine, tick: { fill: tick, fontSize: 11 }, tickLine: false, axisLine: { stroke: axisLine } },
    cursor: { stroke: axisLine, strokeDasharray: '3 3' },
  };
}

export const ChartThemeContext = createContext<ChartTheme | null>(null);

/** Theme for the current chart. Re-renders when the frame detects a theme change. */
export function useChartTheme(): ChartTheme {
  const ctx = useContext(ChartThemeContext);
  // Outside a ChartFrame: read once per render from <html> (cheap, and correct after a theme toggle re-render).
  return ctx ?? readChartTheme(null);
}

/* ------------------------------ Tooltip / legend --------------------------- */
interface TooltipPayloadItem {
  name?: string | number;
  value?: number | string | null;
  color?: string;
  stroke?: string;
  fill?: string;
  dataKey?: string | number;
}

export interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipPayloadItem[];
  /** Format the header (x value). */
  formatLabel?: (label: string | number) => string;
  /** Format each value. `null` values render "—". */
  format?: (value: number, name: string) => string;
}

/** Drop-in `content` for Recharts <Tooltip>. */
export const ChartTooltip: React.FC<ChartTooltipProps> = ({ active, label, payload, formatLabel, format }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="ui-chart-tooltip">
      {label !== undefined && label !== '' && (
        <div className="ui-chart-tooltip__title">{formatLabel ? formatLabel(label) : String(label)}</div>
      )}
      {payload.map((p, i) => {
        const name = String(p.name ?? p.dataKey ?? '');
        const raw = p.value;
        const text = typeof raw === 'number' && Number.isFinite(raw) ? (format ? format(raw, name) : String(raw)) : '—';
        return (
          <div className="ui-chart-tooltip__row" key={`${name}-${i}`}>
            <span className="ui-chart-tooltip__swatch" style={{ background: p.color ?? p.stroke ?? p.fill }} />
            <span>{name}</span>
            <span className="ui-chart-tooltip__value">{text}</span>
          </div>
        );
      })}
    </div>
  );
};

export const ChartLegend: React.FC<{ items: ReadonlyArray<{ label: string; color: string }>; className?: string }> = ({ items, className }) => (
  <div className={cx('ui-chart-legend', className)}>
    {items.map((it) => (
      <span className="ui-chart-legend__item" key={it.label}>
        <span className="ui-chart-legend__swatch" style={{ background: it.color }} />
        {it.label}
      </span>
    ))}
  </div>
);
