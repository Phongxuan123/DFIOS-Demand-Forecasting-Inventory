import React, { useMemo } from 'react';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { ChartFrame, ChartLegend, useChartTheme } from '../../components/ui/index.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import type { SkuClassification } from '../../services/abcxyzApi.ts';

interface Props {
  items: SkuClassification[] | undefined;
  total: number | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  storeId: string;
}

interface Point {
  item_id: string;
  cv: number;
  revenue: number;
  segment: string;
  name: string;
}

const Inner: React.FC<{ groups: Record<'A' | 'B' | 'C', Point[]> }> = ({ groups }) => {
  const c = useChartTheme();
  const fmt = useFormat();
  const t = useT();
  const colors = { A: c.series[0], B: c.series[1], C: c.series[2] };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke={c.grid} />
        <XAxis type="number" dataKey="cv" name="CV" {...c.axis} label={{ value: t('abcxyz.scatter.x'), position: 'insideBottom', offset: -12, fill: c.axis.tick?.fill }} tickFormatter={(v: number) => fmt.number(v, { digits: 1 })} />
        <YAxis type="number" dataKey="revenue" scale="log" domain={['auto', 'auto']} allowDataOverflow {...c.axis} width={64} tickFormatter={(v: number) => fmt.compact(v)} />
        <ZAxis range={[28, 28]} />
        <Tooltip
          cursor={c.cursor}
          content={({ active, payload }) => {
            const p = active && payload && payload[0] ? (payload[0].payload as Point) : null;
            if (!p) return null;
            return (
              <div className="ui-chart-tooltip">
                <div className="ui-chart-tooltip__title">
                  {p.item_id} · {p.segment}
                </div>
                <div className="ui-chart-tooltip__row">
                  <span>{p.name}</span>
                </div>
                <div className="ui-chart-tooltip__row">
                  <span>CV</span>
                  <span className="ui-chart-tooltip__value">{fmt.number(p.cv, { digits: 2 })}</span>
                </div>
                <div className="ui-chart-tooltip__row">
                  <span>{t('abcxyz.skus.revenue')}</span>
                  <span className="ui-chart-tooltip__value">{fmt.currency(p.revenue)}</span>
                </div>
              </div>
            );
          }}
        />
        <Scatter name="A" data={groups.A} fill={colors.A} fillOpacity={0.75} isAnimationActive={false} />
        <Scatter name="B" data={groups.B} fill={colors.B} fillOpacity={0.75} isAnimationActive={false} />
        <Scatter name="C" data={groups.C} fill={colors.C} fillOpacity={0.75} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
};

const Legend: React.FC = () => {
  const c = useChartTheme();
  const t = useT();
  return (
    <ChartLegend
      items={[
        { label: t('abcxyz.scatter.class_a'), color: c.series[0] },
        { label: t('abcxyz.scatter.class_b'), color: c.series[1] },
        { label: t('abcxyz.scatter.class_c'), color: c.series[2] },
      ]}
    />
  );
};

export const ScatterCard: React.FC<Props> = ({ items, total, loading, error, onRetry }) => {
  const t = useT();
  const fmt = useFormat();
  const groups = useMemo(() => {
    const g: Record<'A' | 'B' | 'C', Point[]> = { A: [], B: [], C: [] };
    for (const s of items ?? []) {
      if (!(s.revenue > 0) || !Number.isFinite(s.cv)) continue;
      const k = (s.abc === 'A' || s.abc === 'B' ? s.abc : 'C') as 'A' | 'B' | 'C';
      g[k].push({ item_id: s.item_id, cv: s.cv, revenue: s.revenue, segment: s.segment, name: s.product_name ?? s.item_id });
    }
    return g;
  }, [items]);
  const shown = items?.length ?? 0;
  const note =
    total !== undefined && shown < total
      ? t('abcxyz.scatter.sample', { n: fmt.integer(shown), total: fmt.integer(total) })
      : t('abcxyz.scatter.full', { total: fmt.integer(total ?? shown) });

  return (
    <ChartFrame
      title={t('abcxyz.scatter.title')}
      description={t('abcxyz.scatter.description')}
      height={320}
      loading={loading && !items}
      error={error}
      onRetry={onRetry}
      empty={!!items && items.length === 0}
      asOf={note}
      footer={<Legend />}
    >
      <Inner groups={groups} />
    </ChartFrame>
  );
};
