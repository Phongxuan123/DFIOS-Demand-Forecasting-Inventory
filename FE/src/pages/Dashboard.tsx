import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  PackageX,
  Play,
  ShieldAlert,
  ShoppingCart,
  Target,
  TriangleAlert,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  EmptyState,
  KpiTile,
  PageHeader,
  Section,
  Select,
  Table,
  Tabs,
  useChartTheme,
  useConfirm,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { useApi } from '../hooks/useApi.ts';
import { AsyncAdvanceError, CLOCK_ADVANCE_DAYS, useClock } from '../context/ClockContext.tsx';

/** Review periods offered by the clock panel (demo step 7: +1 review twice, then 8 reviews). */
const CLOCK_ADVANCE_REVIEWS = [1, 2, 4, 8] as const;

function nextIsoDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
import { useStore } from '../context/StoreContext.tsx';
import { useFormat, useT } from '../i18n/index.tsx';
import { useBeCode } from '../i18n/useBe.ts';
import { prefixCode } from '../i18n/beText.ts';
import { costVsB0, countPhrase, reviewsPhrase, reviewsSinceStart, signedCurrency } from '../utils/simText.ts';
import { thetaDomain } from '../utils/chartScale.ts';
import { backtestTrendNote } from '../utils/trendText.ts';
import { AdvanceProgress } from '../components/common/AdvanceProgress.tsx';
import { apiErrorMessage, toApiError } from '../services/apiClient.ts';
import {
  getAlerts,
  getCalibrationHistory,
  getDemandTrend,
  getKpiShadowDashboard,
  getKpis,
  type AlertItem,
  type CalibrationState,
  type CostCurvePoint,
  type SegmentAvailability,
} from '../services/dashboardApi.ts';
import './dashboard.css';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

function parseWrmsse(text: string | undefined): number | null {
  if (!text) return null;
  const m = /WRMSSE\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i.exec(text);
  return m ? Number(m[1]) : null;
}

const ClockPanel: React.FC<{ onAdvanceRequested?: () => void }> = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const navigate = useNavigate();
  const { concreteStoreId: storeId } = useStore();
  const { clock, status, reason, canAdvance, advancing, advance } = useClock();
  const { confirm, dialog } = useConfirm();
  const [days, setDays] = useState<number>(7);
  /** Advance unit: a number of days, a number of review periods (R), or up to a date. */
  const [unit, setUnit] = useState<'days' | 'reviews' | 'until'>('days');
  const [reviews, setReviews] = useState<number>(1);
  const [untilDate, setUntilDate] = useState<string>('');
  const [approvalMode, setApprovalMode] = useState<'auto' | 'planner'>('auto');
  const [asyncJob, setAsyncJob] = useState<boolean>(false);
  const [stoppedReviewDate, setStoppedReviewDate] = useState<string | null>(null);
  const [last, setLast] = useState<{ from: string; to: string; reviews: number; day0: boolean; stockouts: number; recs: number } | null>(null);

  const runInBackground = asyncJob && approvalMode === 'auto';
  const minUntil = clock?.current_date ? nextIsoDay(clock.current_date) : '';
  const untilValid = !!untilDate && (!minUntil || untilDate >= minUntil);
  const actionLabel =
    unit === 'days'
      ? t('dashboard.clock.advance_action', { days: String(days) })
      : unit === 'reviews'
        ? t('dashboard.clock.advance_reviews', { n: reviews })
        : untilValid
          ? t('dashboard.clock.advance_until', { date: fmt.date(untilDate) })
          : t('dashboard.clock.advance');

  const doAdvance = async (expirePending: boolean = false) => {
    try {
      const res = await advance({
        ...(unit === 'days' ? { days } : unit === 'reviews' ? { reviews } : { until: untilDate }),
        approval_mode: approvalMode,
        expire_pending: expirePending,
        async_job: runInBackground,
      });
      setStoppedReviewDate(res.stopped_at_review ? res.current_date : null);
      if (res.pending_expired) toast.info(t('dashboard.clock.pending_expired', { count: fmt.integer(res.pending_expired) }));
      setLast({
        from: res.previous_date,
        to: res.current_date,
        reviews: res.reviews_executed,
        day0: !!res.day0_review_executed,
        stockouts: res.stockouts_recorded,
        recs: res.recommendations_generated,
      });
      toast.success(
        t('shell.clock.advanced', {
          from: fmt.date(res.previous_date),
          to: fmt.date(res.current_date),
          reviews: reviewsPhrase(t, fmt, res.reviews_executed, !!res.day0_review_executed),
          recommendations: countPhrase(t, fmt, 'recs', res.recommendations_generated),
        }),
        typeof res.duration_seconds === 'number' ? t('shell.clock.advance_duration', { seconds: fmt.number(res.duration_seconds, { digits: 1 }) }) : undefined,
      );
    } catch (err: unknown) {
      if (err instanceof AsyncAdvanceError) {
        toast.error(
          t('shell.clock.advance_failed'),
          err.kind === 'timeout' ? t('dashboard.clock.async_timeout') : t('dashboard.clock.async_failed', { error: err.serverError ?? '—' }),
        );
        return;
      }
      const e = toApiError(err);
      // proposals of a previous review are still PENDING (any mode) -> offer to skip them (expire_pending)
      if (e.status === 409 && !expirePending) {
        const skip = await confirm({
          title: t('dashboard.clock.pending_title'),
          description: t('dashboard.clock.pending_body', { detail: e.detail ?? '' }),
          confirmLabel: t('dashboard.clock.pending_confirm'),
          tone: 'danger',
        });
        if (skip) await doAdvance(true);
        return;
      }
      toast.error(t('shell.clock.advance_failed'), apiErrorMessage(err, t));
    }
  };

  const onAdvance = async () => {
    if (unit === 'until' && !untilValid) return;
    const ok = await confirm({
      title:
        unit === 'days'
          ? t('shell.clock.advance_title', { days })
          : unit === 'reviews'
            ? t('dashboard.clock.confirm_reviews', { n: reviews })
            : t('dashboard.clock.confirm_until', { date: fmt.date(untilDate) }),
      description: t('shell.clock.advance_body', { store: storeId ?? '—' }),
      confirmLabel: t('dashboard.clock.advance'),
    });
    if (!ok) return;
    await doAdvance(false);
  };

  if (status === 'loading') {
    return (
      <div className="dash-clock-bar">
        <p className="ui-muted">{t('shell.clock.loading')}</p>
      </div>
    );
  }

  if (status === 'unavailable' || !clock) {
    const key = `shell.clock.unavailable_${reason ?? 'error'}` as const;
    return (
      <div className="dash-clock-bar">
        <Alert tone="info">
          {t('dashboard.clock.unavailable', { reason: t(key as 'shell.clock.unavailable_error') })}
        </Alert>
      </div>
    );
  }

  return (
    <>
      <div className="dash-clock-bar">
        <div className="dash-clock-left">
          <div className="dash-clock-badge">
            <span className="dash-clock-pulse" aria-hidden="true" />
            <span>{t('dashboard.clock.title')}</span>
          </div>
          <div className="dash-clock-date">
            {fmt.date(clock.current_date, 'long')}
          </div>
          <div className="dash-clock-meta">
            <span>{t('dashboard.clock.start')}: <strong>{fmt.date(clock.start_date)}</strong></span>
            <span className="dash-clock-dot">·</span>
            <span>{t('dashboard.clock.elapsed', { days: countPhrase(t, fmt, 'days', clock.days_elapsed), reviews: reviewsPhrase(t, fmt, reviewsSinceStart(clock), true) })}</span>
            {last && (
              <>
                <span className="dash-clock-dot">·</span>
                <span>
                  {t('dashboard.clock.last_advance')}: {t('dashboard.clock.last_advance_value', {
                    from: fmt.date(last.from),
                    to: fmt.date(last.to),
                    reviews: reviewsPhrase(t, fmt, last.reviews, last.day0),
                    stockouts: countPhrase(t, fmt, 'stockouts', last.stockouts),
                    recs: countPhrase(t, fmt, 'recs', last.recs),
                  })}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="dash-clock-right">
          {canAdvance ? (
            <div className="dash-clock-form">
              <div className="dash-clock-field dash-clock-field--mode">
                <label htmlFor="dash-clock-unit" className="dash-clock-label">
                  {t('dashboard.clock.unit_label')}
                </label>
                <Select<'days' | 'reviews' | 'until'>
                  id="dash-clock-unit"
                  size="sm"
                  value={unit}
                  onChange={setUnit}
                  options={[
                    { value: 'days', label: t('dashboard.clock.unit_days') },
                    { value: 'reviews', label: t('dashboard.clock.unit_reviews') },
                    { value: 'until', label: t('dashboard.clock.unit_until') },
                  ]}
                  disabled={advancing}
                  aria-label={t('dashboard.clock.unit_label')}
                />
              </div>
              {unit === 'days' && (
                <div className="dash-clock-field">
                  <label htmlFor="dash-clock-days" className="dash-clock-label">
                    {t('dashboard.clock.days')}
                  </label>
                  <Select<number>
                    id="dash-clock-days"
                    size="sm"
                    value={days}
                    onChange={setDays}
                    options={CLOCK_ADVANCE_DAYS.map((d) => ({ value: d, label: String(d) }))}
                    disabled={advancing}
                    aria-label={t('dashboard.clock.days')}
                  />
                </div>
              )}
              {unit === 'reviews' && (
                <div className="dash-clock-field">
                  <label htmlFor="dash-clock-reviews" className="dash-clock-label">
                    {t('dashboard.clock.reviews')}
                  </label>
                  <Select<number>
                    id="dash-clock-reviews"
                    size="sm"
                    value={reviews}
                    onChange={setReviews}
                    options={CLOCK_ADVANCE_REVIEWS.map((r) => ({ value: r, label: String(r) }))}
                    disabled={advancing}
                    aria-label={t('dashboard.clock.reviews')}
                  />
                </div>
              )}
              {unit === 'until' && (
                <div className="dash-clock-field">
                  <label htmlFor="dash-clock-until" className="dash-clock-label">
                    {t('dashboard.clock.until')}
                  </label>
                  <input
                    id="dash-clock-until"
                    type="date"
                    className="ui-input dash-clock-date-input"
                    value={untilDate}
                    min={minUntil || undefined}
                    onChange={(e) => setUntilDate(e.target.value)}
                    disabled={advancing}
                    aria-invalid={!!untilDate && !untilValid}
                  />
                </div>
              )}
              <div className="dash-clock-field dash-clock-field--mode">
                <label htmlFor="dash-clock-mode" className="dash-clock-label">
                  {t('dashboard.clock.mode_label')}
                </label>
                <Select<'auto' | 'planner'>
                  id="dash-clock-mode"
                  size="sm"
                  value={approvalMode}
                  onChange={setApprovalMode}
                  options={[
                    { value: 'auto', label: t('dashboard.clock.mode_auto') },
                    { value: 'planner', label: t('dashboard.clock.mode_planner') },
                  ]}
                  disabled={advancing}
                  aria-label={t('dashboard.clock.mode_label')}
                />
              </div>
              <label
                title={approvalMode === 'planner' ? t('dashboard.clock.async_planner_hint') : undefined}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 'var(--text-xs)',
                  color: approvalMode === 'planner' ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                  cursor: approvalMode === 'planner' ? 'not-allowed' : 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                <input
                  type="checkbox"
                  checked={runInBackground}
                  onChange={(e) => setAsyncJob(e.target.checked)}
                  disabled={advancing || approvalMode === 'planner'}
                />
                {t('dashboard.clock.async_label')}
              </label>
              <Button
                variant="primary"
                loading={advancing}
                onClick={onAdvance}
                disabled={unit === 'until' && !untilValid}
                className="dash-clock-btn"
                leftIcon={<Play size={13} fill="currentColor" />}
              >
                {advancing ? t('shell.clock.advancing') : actionLabel}
              </Button>
              <AdvanceProgress />
            </div>
          ) : (
            <span className="ui-muted">{t('dashboard.clock.admin_only')}</span>
          )}
        </div>
        {dialog}
      </div>
      {stoppedReviewDate && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <Alert tone="warning" title={t('dashboard.clock.stopped_title', { date: fmt.date(stoppedReviewDate) })}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <span>{t('dashboard.clock.stopped_body')}</span>
              <Button size="sm" variant="secondary" onClick={() => navigate('/replenishment?status=PENDING')}>
                {t('dashboard.clock.stopped_cta')}
              </Button>
            </div>
          </Alert>
        </div>
      )}
    </>
  );
};

const CostChart: React.FC<{ rows: CostCurvePoint[] }> = ({ rows }) => {
  const c = useChartTheme();
  const t = useT();
  const fmt = useFormat();
  const hasB0 = rows.some((r) => r.b0_total_cost !== null);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="cycle_index" {...c.axis} tickFormatter={(v: number) => String(v)} />
        <YAxis {...c.axis} width={56} tickFormatter={(v: number) => fmt.compact(v)} />
        <RTooltip
          content={<ChartTooltip formatLabel={(l) => t('dashboard.charts.review', { n: String(l) })} format={(v) => fmt.currency(v, { compact: true })} />}
          cursor={c.cursor}
        />
        <Line type="monotone" dataKey="c3out_total_cost" name={t('dashboard.charts.cost_c3')} stroke={c.series[0]} strokeWidth={2} dot={rows.length <= 3 ? { r: 3 } : false} />
        {hasB0 && <Line type="monotone" dataKey="b0_total_cost" name={t('dashboard.charts.cost_b0')} stroke={c.series[1]} strokeWidth={2} strokeDasharray="5 3" dot={rows.length <= 3 ? { r: 3 } : false} connectNulls={false} />}
      </LineChart>
    </ResponsiveContainer>
  );
};

const THETA_DASH: Record<string, string | undefined> = { X: undefined, Y: '6 3', Z: '2 3' };
const thetaDash = (cls: string) => THETA_DASH[cls.slice(-1)];

const ThetaChart: React.FC<{ rows: Array<Record<string, number | string>>; classes: string[] }> = ({ rows, classes }) => {
  const c = useChartTheme();
  const t = useT();
  const fmt = useFormat();
  const domain = useMemo(() => thetaDomain(rows.flatMap((r) => classes.map((cls) => (typeof r[cls] === 'number' ? (r[cls] as number) : null)))), [rows, classes]);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="review_index" {...c.axis} allowDecimals={false} tickFormatter={(v: number) => t('dashboard.charts.review_tick', { n: String(v) })} />
        <YAxis {...c.axis} width={48} domain={domain} allowDataOverflow tickFormatter={(v: number) => fmt.number(v, { digits: 2 })} />
        <ReferenceLine y={0} stroke={c.reference} strokeDasharray="2 2" />
        <RTooltip
          content={<ChartTooltip formatLabel={(l) => t('dashboard.charts.review', { n: String(l) })} format={(v) => fmt.number(v, { digits: 3 })} />}
          cursor={c.cursor}
        />
        {classes.map((cls, i) => (
          <Line key={cls} type="stepAfter" dataKey={cls} name={cls} stroke={c.series[i % c.series.length]} strokeDasharray={thetaDash(cls)} strokeWidth={2} dot={rows.length <= 3 ? { r: 3 } : false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

const SegmentChart: React.FC<{ rows: SegmentAvailability[] }> = ({ rows }) => {
  const c = useChartTheme();
  const t = useT();
  const fmt = useFormat();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="class_id" {...c.axis} />
        <YAxis {...c.axis} width={44} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
        <RTooltip content={<ChartTooltip format={(v) => fmt.percent(v, { scale: 'percent', digits: 1 })} />} cursor={false} />
        <Bar dataKey="c3out_availability" name={t('dashboard.charts.cost_c3')} fill={c.series[0]} radius={[3, 3, 0, 0]} />
        <Bar dataKey="b0_availability" name="B0" fill={c.series[1]} radius={[3, 3, 0, 0]} />
        <Bar dataKey="target" name={t('dashboard.charts.target')} fill={c.reference} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

const TrendChart: React.FC<{ rows: Array<{ date: string; actual: number | null; predicted: number | null }>; clockDate: string | null }> = ({ rows, clockDate }) => {
  const c = useChartTheme();
  const fmt = useFormat();
  const t = useT();
  const afterStart = clockDate ? rows.find((r) => r.date > clockDate)?.date : undefined;
  const inRange = !!clockDate && rows.length > 0 && rows[0].date <= clockDate && !!afterStart;

  const { chartRows, anchorDate } = useMemo(() => {
    if (!rows || rows.length === 0) return { chartRows: rows, anchorDate: undefined };
    let lastActualIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].actual !== null) {
        lastActualIdx = i;
        break;
      }
    }
    const firstPredIdx = rows.findIndex((r) => r.predicted !== null);
    if (lastActualIdx >= 0 && firstPredIdx > lastActualIdx && rows[lastActualIdx].predicted === null) {
      const anchor = rows[lastActualIdx].date;
      const patched = rows.map((r, i) => (i === lastActualIdx ? { ...r, predicted: r.actual } : r));
      return { chartRows: patched, anchorDate: anchor };
    }
    return { chartRows: rows, anchorDate: undefined };
  }, [rows]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis dataKey="date" {...c.axis} tickFormatter={(v: string) => fmt.date(v, 'axis')} minTickGap={32} />
        <YAxis {...c.axis} width={48} tickFormatter={(v: number) => fmt.compact(v)} />
        {inRange && afterStart && (
          <ReferenceArea x1={afterStart} x2={rows[rows.length - 1].date} fill={c.reference} fillOpacity={0.12} stroke="none" label={{ value: t('dashboard.charts.after_clock'), fill: c.tick, fontSize: 11, position: 'insideTopRight' }} />
        )}
        {clockDate && rows.some((r) => r.date === clockDate) && (
          // label at the bottom: the "after the clock" area label sits at the top right of the same spot
          <ReferenceLine x={clockDate} stroke={c.series[2]} label={{ value: t('dashboard.charts.clock_line', { date: fmt.date(clockDate, 'axis') }), fill: c.tick, fontSize: 11, position: inRange ? 'insideBottomLeft' : 'insideTopLeft' }} />
        )}
        <RTooltip
          content={(props) => {
            const payload = props.payload && anchorDate
              ? props.payload.filter((p) => !(String(props.label) === anchorDate && p.dataKey === 'predicted'))
              : props.payload;
            return (
              <ChartTooltip
                {...props}
                payload={payload as any}
                formatLabel={(l) => fmt.date(String(l))}
                format={(v) => fmt.number(v, { digits: 0 })}
              />
            );
          }}
          cursor={c.cursor}
        />
        <Line type="monotone" dataKey="actual" name={t('dashboard.charts.actual')} stroke={c.series[0]} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="predicted" name={t('dashboard.charts.predicted')} stroke={c.series[1]} strokeWidth={2} strokeDasharray="5 3" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
};

export const Dashboard: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const beCode = useBeCode();
  const navigate = useNavigate();
  const { storeId, concreteStoreId } = useStore();
  const clock = useClock();
  const { confirm, dialog } = useConfirm();
  const toast = useToast();

  const enabled = !!storeId;
  const sid = concreteStoreId ?? '';
  const scope = storeId ?? '';
  const version = clock.version;

  const kpis = useApi((s) => getKpis(sid, s), [sid, version], { enabled });
  const shadow = useApi((s) => getKpiShadowDashboard(scope, s), [scope, version], { enabled });
  const theta = useApi((s) => getCalibrationHistory(scope, s), [scope, version], { enabled });
  const trend = useApi((s) => getDemandTrend(sid, 30, s), [sid, version], { enabled });
  const [severity, setSeverity] = useState<string>('');
  const alerts = useApi((s) => getAlerts(sid, severity || undefined, 50, s), [sid, version, severity], { enabled });
  const [abc, setAbc] = useState<string>('A');

  const k = kpis.data;
  const sh = shadow.data;
  const wrmsse = k?.production_wrmsse ?? parseWrmsse(k?.avg_forecast_accuracy);

  const onAdvanceSevenDays = async () => {
    const ok = await confirm({
      title: t('shell.clock.advance_title', { days: 7 }),
      description: t('shell.clock.advance_body', { store: storeId ?? '—' }),
      confirmLabel: t('dashboard.clock.advance'),
    });
    if (!ok) return;
    try {
      const res = await clock.advance(7);
      toast.success(
        t('shell.clock.advanced', {
          from: fmt.date(res.previous_date),
          to: fmt.date(res.current_date),
          reviews: reviewsPhrase(t, fmt, res.reviews_executed, !!res.day0_review_executed),
          recommendations: countPhrase(t, fmt, 'recs', res.recommendations_generated),
        }),
      );
    } catch (err) {
      toast.error(t('shell.clock.advance_failed'), apiErrorMessage(err, t));
    }
  };

  const thetaView = useMemo(() => {
    const hist: CalibrationState[] = theta.data ?? [];
    const classes = [...new Set(hist.map((h) => h.class_id))].filter((cl) => cl.startsWith(abc)).sort();
    const byReview = new Map<number, Record<string, number | string>>();
    for (const h of hist) {
      if (!h.class_id.startsWith(abc)) continue;
      const row = byReview.get(h.review_index) ?? { review_index: h.review_index };
      row[h.class_id] = h.theta;
      byReview.set(h.review_index, row);
    }
    return { classes, rows: [...byReview.values()].sort((a, b) => Number(a.review_index) - Number(b.review_index)) };
  }, [theta.data, abc]);

  // Before the first review cycle closes (R days) the comparison is not like for like: a planner-mode stop keeps the
  // day-0 orders PENDING (no ordering cost yet) while the shadow B0 has already ordered. No verdict until then.
  const reviewDays = clock.clock?.review_period_days ?? 7;
  const costEarly = !!sh && (sh.days_elapsed ?? 0) < reviewDays;
  const costSavingsBadge = useMemo(() => {
    if (costEarly || !sh || sh.c3out_total_cost == null || sh.b0_total_cost == null) return undefined;
    const diff = sh.b0_total_cost - sh.c3out_total_cost;
    if (diff <= 0) return undefined;
    const pct = sh.b0_total_cost > 0 ? (diff / sh.b0_total_cost) * 100 : 0;
    return (
      <Badge tone="success">
        {t('dashboard.charts.cost_savings', {
          saved: fmt.currency(diff, { compact: true }),
          pct: fmt.percent(pct, { scale: 'percent', digits: 1 }),
        })}
      </Badge>
    );
  }, [sh, fmt, t, costEarly]);

  const sevTone = (s: string): Tone => (s === 'CRITICAL' ? 'danger' : s === 'WARNING' ? 'warning' : 'success');
  const sevLabel = (s: string) =>
    s === 'CRITICAL' ? t('dashboard.alerts.sev_critical') : s === 'WARNING' ? t('dashboard.alerts.sev_warning') : t('dashboard.alerts.sev_healthy');

  const alertCols: Column<AlertItem>[] = [
    { key: 'item_id', header: t('dashboard.alerts.col_sku'), value: (r) => r.item_id, sortable: true },
    { key: 'name', header: t('dashboard.alerts.col_name'), value: (r) => r.product_name, sortable: true },
    { key: 'on_hand', header: t('dashboard.alerts.col_on_hand'), align: 'right', value: (r) => r.on_hand, cell: (r) => fmt.number(r.on_hand, { digits: 0 }), sortable: true },
    { key: 'on_order', header: t('dashboard.alerts.col_on_order'), align: 'right', value: (r) => r.on_order, cell: (r) => fmt.number(r.on_order, { digits: 0 }), sortable: true },
    { key: 'ss', header: t('dashboard.alerts.col_ss'), align: 'right', value: (r) => r.safety_stock, cell: (r) => fmt.number(r.safety_stock, { digits: 1 }), sortable: true },
    { key: 'rop', header: t('dashboard.alerts.col_rop'), align: 'right', value: (r) => r.reorder_point, cell: (r) => fmt.number(r.reorder_point, { digits: 1 }), sortable: true },
    { key: 'sev', header: t('dashboard.alerts.col_severity'), value: (r) => r.severity, cell: (r) => <Badge tone={sevTone(r.severity)}>{sevLabel(r.severity)}</Badge>, sortable: true },
    {
      key: 'action',
      header: t('dashboard.alerts.col_action'),
      value: (r) => r.severity,
      cell: (r) =>
        r.severity === 'CRITICAL' ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => navigate(`/replenishment?search=${encodeURIComponent(r.item_id)}`)}
          >
            {t('dashboard.alerts.action_create_po')}
          </Button>
        ) : r.severity === 'WARNING' ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate(`/replenishment?search=${encodeURIComponent(r.item_id)}`)}
          >
            {t('dashboard.alerts.action_reorder')}
          </Button>
        ) : (
          <span className="ui-muted" style={{ fontSize: 'var(--text-xs)' }}>
            {t('dashboard.alerts.action_stable')}
          </span>
        ),
    },
  ];

  const segCols: Column<SegmentAvailability>[] = [
    { key: 'class', header: t('dashboard.seg.col_class'), value: (r) => r.class_id, sortable: true },
    { key: 'target', header: t('dashboard.seg.col_target'), align: 'right', value: (r) => r.target, cell: (r) => fmt.percent(r.target, { scale: 'percent', digits: 1 }) },
    {
      key: 'c3',
      header: t('dashboard.seg.col_c3'),
      align: 'right',
      value: (r) => r.c3out_availability,
      cell: (r) =>
        r.c3out_availability != null ? (
          <span style={{ fontWeight: 600, color: r.c3out_availability >= r.target ? 'var(--color-success-text)' : 'var(--color-warning-text)' }}>
            {fmt.percent(r.c3out_availability, { scale: 'percent', digits: 1 })}
          </span>
        ) : (
          <span className="ui-muted">—</span>
        ),
      sortable: true,
    },
    {
      key: 'b0',
      header: t('dashboard.seg.col_b0'),
      align: 'right',
      value: (r) => r.b0_availability,
      cell: (r) => (r.b0_availability != null ? fmt.percent(r.b0_availability, { scale: 'percent', digits: 1 }) : <span className="ui-muted">—</span>),
      sortable: true,
    },
    { key: 'theta', header: t('dashboard.seg.col_theta'), align: 'right', value: (r) => r.theta, cell: (r) => fmt.number(r.theta, { digits: 3 }) },
    { key: 'sku', header: t('dashboard.seg.col_skus'), align: 'right', value: (r) => r.n_sku, cell: (r) => (r.n_sku != null ? fmt.integer(r.n_sku) : <span className="ui-muted">—</span>) },
    {
      key: 'status',
      header: t('dashboard.seg.col_status'),
      value: (r) => r.status,
      cell: (r) =>
        r.status === 'NOT_MEASURED' || (r.status === 'COMPLIANT' && r.c3out_availability == null) ? (
          <Badge tone="neutral">{t('dashboard.seg.status_not_measured')}</Badge>
        ) : (
          <Badge tone={r.status === 'COMPLIANT' ? 'success' : 'warning'}>
            {r.status === 'COMPLIANT' ? <CheckCircle2 size={12} aria-hidden="true" /> : <TriangleAlert size={12} aria-hidden="true" />}{' '}
            {r.status === 'COMPLIANT' ? t('dashboard.seg.status_compliant') : t('dashboard.seg.status_warning')}
          </Badge>
        ),
    },
  ];

  if (!storeId) {
    return (
      <>
        <PageHeader title={t('dashboard.title')} description={t('dashboard.description')} />
        <EmptyState title={t('shell.store.empty')} />
      </>
    );
  }

  const asOf = sh?.as_of ? fmt.date(sh.as_of) : undefined;
  const costCmp = costVsB0(sh?.c3out_total_cost, sh?.b0_total_cost);
  const tabs = ['A', 'B', 'C'].map((id) => ({ id, label: id }));
  const trendRows = trend.data?.data ?? [];
  const trendHasData = trendRows.some((r) => r.actual !== null || r.predicted !== null);
  const clockDate = clock.status === 'ready' && clock.clock ? clock.clock.current_date.slice(0, 10) : null;
  const trendBeyondClock = !!clockDate && trendRows.some((r) => r.actual !== null && r.date > clockDate);
  const trendNoForecast = trendHasData && !trendRows.some((r) => r.predicted !== null);
  const trendNoActual = trendHasData && !trendRows.some((r) => r.actual !== null);
  const trendBacktest = backtestTrendNote(trend.data, t, fmt);
  const availMiss =
    sh && sh.c3out_overall_availability != null && sh.target_availability != null && sh.c3out_overall_availability < sh.target_availability;
  const segAllNull = !!sh && sh.segment_availabilities.length > 0 && sh.segment_availabilities.every((r) => r.c3out_availability == null && r.b0_availability == null);
  const thetaSingle = !!theta.data && thetaView.rows.length === 1;

  const advanceBtn = clock.canAdvance ? (
    <Button size="sm" variant="secondary" leftIcon={<Play size={12} />} onClick={onAdvanceSevenDays}>
      {t('dashboard.charts.advance_to_view')}
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        meta={<Badge tone="neutral">{t('dashboard.source_note')}</Badge>}
      />

      <Section>
        <ClockPanel />
      </Section>

      {availMiss && sh && (
        <Section>
          <Alert tone="info" title={t('dashboard.availability_miss.title')}>
            {t('dashboard.availability_miss.body', {
              value: fmt.percent(sh.c3out_overall_availability, { scale: 'percent', digits: 1 }),
              target: fmt.percent(sh.target_availability, { scale: 'percent', digits: 1 }),
              days: fmt.integer(sh.days_elapsed),
            })}
          </Alert>
        </Section>
      )}

      <Section>
        <div className="dash-kpi-grid">
          <KpiTile
            className="dash-kpi-tile"
            icon={<Target size={16} />}
            label={
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 'var(--space-2)' }}>
                <span>{t('dashboard.kpi.availability')}</span>
                {sh?.c3out_overall_availability != null && sh.target_availability != null && (
                  <Badge tone={sh.c3out_overall_availability >= sh.target_availability ? 'success' : 'warning'}>
                    {sh.c3out_overall_availability >= sh.target_availability ? t('dashboard.seg.status_compliant') : t('dashboard.seg.status_warning')}
                  </Badge>
                )}
              </span>
            }
            loading={shadow.loading && !sh}
            value={sh?.c3out_overall_availability != null ? fmt.percent(sh.c3out_overall_availability, { scale: 'percent', digits: 1 }) : null}
            delta={
              sh?.c3out_overall_availability != null && sh.b0_overall_availability != null
                ? {
                    // both availabilities are already in percent (96.7 vs 90.1): the gap is in percentage points
                    value: sh.c3out_overall_availability - sh.b0_overall_availability,
                    text: t('dashboard.kpi.availability_vs_b0', {
                      pp: `${sh.c3out_overall_availability >= sh.b0_overall_availability ? '+' : ''}${fmt.number(sh.c3out_overall_availability - sh.b0_overall_availability, { digits: 1 })}`,
                    }),
                    goodWhen: 'up',
                  }
                : undefined
            }
            unavailableReason={shadow.error ? apiErrorMessage(shadow.error, t) : sh?.c3out_overall_availability == null ? t('dashboard.reason.availability') : undefined}
            hint={
              sh?.c3out_overall_availability != null
                ? t('dashboard.kpi.availability_hint', {
                    target: sh.target_availability != null ? fmt.percent(sh.target_availability, { scale: 'percent', digits: 1 }) : t('dashboard.kpi.availability_target_missing'),
                    b0: fmt.percent(sh.b0_overall_availability, { scale: 'percent', digits: 1 }),
                  })
                : undefined
            }
          />
          <KpiTile
            className="dash-kpi-tile"
            icon={<ShoppingCart size={16} />}
            label={t('dashboard.kpi.fill_rate')}
            loading={shadow.loading && !sh}
            value={sh?.c3out_fill_rate != null ? fmt.percent(sh.c3out_fill_rate, { scale: 'percent', digits: 1 }) : null}
            delta={
              sh?.c3out_fill_rate != null && sh.b0_fill_rate != null
                ? {
                    value: sh.c3out_fill_rate - sh.b0_fill_rate,
                    text: t('dashboard.kpi.availability_vs_b0', {
                      pp: `${sh.c3out_fill_rate >= sh.b0_fill_rate ? '+' : ''}${fmt.number(sh.c3out_fill_rate - sh.b0_fill_rate, { digits: 1 })}`,
                    }),
                    goodWhen: 'up',
                  }
                : undefined
            }
            unavailableReason={shadow.error ? apiErrorMessage(shadow.error, t) : sh?.c3out_fill_rate == null ? t('dashboard.reason.fill_rate') : undefined}
            hint={sh?.c3out_fill_rate != null ? t('dashboard.kpi.fill_rate_hint', { b0: fmt.percent(sh.b0_fill_rate, { scale: 'percent', digits: 1 }) }) : undefined}
          />
          <KpiTile
            className="dash-kpi-tile"
            icon={<ShieldAlert size={16} />}
            label={t('dashboard.kpi.classes_below')}
            loading={shadow.loading && !sh}
            value={sh?.classes_below_recent != null ? `${fmt.integer(sh.classes_below_recent)} / ${fmt.integer(sh.classes_measured_recent ?? 9)}` : null}
            unavailableReason={shadow.error ? apiErrorMessage(shadow.error, t) : sh?.classes_below_recent == null ? t('dashboard.reason.availability') : undefined}
            hint={
              sh?.classes_below_recent != null
                ? t('dashboard.kpi.classes_below_hint', {
                    n: fmt.integer(sh.recent_cycles_used),
                    target: sh.target_availability != null ? fmt.percent(sh.target_availability, { scale: 'percent', digits: 1 }) : '—',
                  })
                : undefined
            }
          />
          <KpiTile
            className="dash-kpi-tile"
            icon={<PackageX size={16} />}
            label={t('dashboard.kpi.stockouts')}
            loading={kpis.loading && !k}
            value={k ? fmt.percent(k.stockout_rate, { scale: 'percent', digits: 1 }) : null}
            unavailableReason={kpis.error ? apiErrorMessage(kpis.error, t) : undefined}
            hint={k ? t('dashboard.kpi.stockouts_hint', { rate: fmt.percent(k.stockout_rate, { scale: 'percent', digits: 1 }), total: fmt.integer(k.total_skus) }) : undefined}
          />
          <KpiTile
            className="dash-kpi-tile"
            icon={<Boxes size={16} />}
            label={t('dashboard.kpi.inventory_value')}
            loading={kpis.loading && !k}
            value={k ? fmt.currency(k.total_inventory_value, { compact: true }) : null}
            unavailableReason={kpis.error ? apiErrorMessage(kpis.error, t) : undefined}
            hint={t('dashboard.kpi.inventory_hint')}
          />
          <KpiTile
            className="dash-kpi-tile"
            icon={<ClipboardList size={16} />}
            label={t('dashboard.kpi.orders')}
            loading={kpis.loading && !k}
            value={k ? fmt.integer(k.pending_replenishments_count) : null}
            unavailableReason={kpis.error ? apiErrorMessage(kpis.error, t) : undefined}
            hint={k ? t('dashboard.kpi.orders_hint', { count: fmt.integer(k.reorder_alerts_count) }) : undefined}
          />
          <KpiTile
            className="dash-kpi-tile"
            icon={<CircleDollarSign size={16} />}
            label={t('dashboard.kpi.cost')}
            loading={shadow.loading && !sh}
            value={sh?.c3out_total_cost != null ? fmt.currency(sh.c3out_total_cost, { compact: true }) : null}
            unavailableReason={shadow.error ? apiErrorMessage(shadow.error, t) : sh?.c3out_total_cost == null ? t('dashboard.reason.cost') : undefined}
            hint={
              costEarly && sh?.c3out_total_cost != null ? (
                t('dashboard.kpi.cost_first_cycle', { days: fmt.integer(reviewDays) })
              ) : sh?.c3out_total_cost != null ? (
                <>
                  {t('dashboard.kpi.cost_hint', {
                    b0: sh.b0_total_cost != null ? fmt.currency(sh.b0_total_cost, { compact: true }) : (beCode(prefixCode('kpi', sh.b0_reason_code), null, sh.b0_reason) || '—'),
                    delta: costCmp ? signedCurrency(fmt, costCmp.diff) : '—',
                  })}
                  {costCmp ? (
                    <>
                      {' '}
                      <Badge tone={costCmp.direction === 'more' ? 'danger' : costCmp.direction === 'less' ? 'success' : 'neutral'}>
                        {t(`dashboard.kpi.cost_${costCmp.direction}`)}
                      </Badge>
                    </>
                  ) : null}
                </>
              ) : undefined
            }
          />
          <KpiTile
            className="dash-kpi-tile"
            icon={<Activity size={16} />}
            label={t('dashboard.kpi.wrmsse')}
            loading={kpis.loading && !k}
            value={wrmsse != null ? fmt.number(wrmsse, { digits: 4 }) : null}
            unavailableReason={kpis.error ? apiErrorMessage(kpis.error, t) : wrmsse == null ? t('dashboard.kpi.wrmsse_unavailable') : undefined}
            hint={
              <>
                {k?.production_model_id ? `${t('dashboard.kpi.wrmsse_hint')} (${k.production_model_id})` : t('dashboard.kpi.wrmsse_hint')}
                {k?.replay_wrmsse != null ? (
                  <>
                    <br />
                    {t('dashboard.kpi.wrmsse_replay', { value: fmt.number(k.replay_wrmsse, { digits: 3 }) })}
                  </>
                ) : null}
              </>
            }
          />
        </div>
      </Section>

      <Section>
        <div className="dash-charts-grid">
          <ChartFrame
            title={t('dashboard.charts.trend_title')}
            description={t('dashboard.charts.trend_desc')}
            loading={trend.loading && !trend.data}
            error={trend.error}
            onRetry={trend.refetch}
            empty={!!trend.data && !trendHasData}
            footer={
              <>
                <ChartLegend
                  items={[
                    ...(trendNoActual ? [] : [{ label: t('dashboard.charts.actual'), color: 'var(--chart-1)' }]),
                    ...(trendNoForecast ? [] : [{ label: t('dashboard.charts.predicted'), color: 'var(--chart-2)', dash: '5 3' }]),
                  ]}
                />
                {!trendNoForecast && trendBacktest && (
                  <p className="ui-muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>{trendBacktest}</p>
                )}
                {trendNoForecast && <p className="ui-muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>{t('dashboard.charts.trend_no_forecast')}</p>}
                {trendNoActual && <p className="ui-muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>{t('dashboard.charts.trend_no_actual')}</p>}
                {trendBeyondClock && <p className="ui-muted" style={{ margin: 0, fontSize: 'var(--text-xs)' }}>{t('dashboard.charts.trend_beyond_clock')}</p>}
              </>
            }
          >
            <TrendChart rows={trendRows} clockDate={clockDate} />
          </ChartFrame>

          <ChartFrame
            title={t('dashboard.charts.cost_title')}
            description={t('dashboard.charts.cost_desc')}
            actions={costSavingsBadge}
            loading={shadow.loading && !sh}
            error={shadow.error}
            onRetry={shadow.refetch}
            empty={!!sh && sh.cost_curves.length === 0}
            unavailableReason={sh && sh.cost_curves.length === 0 ? t('dashboard.reason.cost') : undefined}
            asOf={asOf}
            footer={
              sh && sh.cost_curves.length > 0 ? (
                <ChartLegend items={[{ label: t('dashboard.charts.cost_c3'), color: 'var(--chart-1)' }, { label: t('dashboard.charts.cost_b0'), color: 'var(--chart-2)', dash: '5 3' }]} />
              ) : undefined
            }
          >
            <CostChart rows={sh?.cost_curves ?? []} />
          </ChartFrame>

          <ChartFrame
            title={t('dashboard.charts.seg_title')}
            description={t('dashboard.charts.seg_desc')}
            loading={shadow.loading && !sh}
            error={shadow.error}
            onRetry={shadow.refetch}
            empty={!!sh && sh.segment_availabilities.length === 0}
            unavailableReason={segAllNull ? t('dashboard.reason.availability') : undefined}
            asOf={asOf}
            footer={
              !segAllNull && sh && sh.segment_availabilities.length > 0 ? (
                <ChartLegend
                  items={[
                    { label: t('dashboard.charts.cost_c3'), color: 'var(--chart-1)' },
                    { label: 'B0', color: 'var(--chart-2)' },
                    { label: t('dashboard.charts.target'), color: 'var(--chart-reference)' },
                  ]}
                />
              ) : undefined
            }
          >
            <SegmentChart rows={sh?.segment_availabilities ?? []} />
          </ChartFrame>

          <ChartFrame
            title={t('dashboard.charts.theta_title')}
            description={t('dashboard.charts.theta_desc')}
            actions={<Tabs items={tabs} value={abc} onChange={setAbc} />}
            loading={theta.loading && !theta.data}
            error={theta.error?.kind === 'forbidden' ? undefined : theta.error}
            onRetry={theta.refetch}
            unavailableReason={theta.error?.kind === 'forbidden' ? t('dashboard.charts.theta_unavailable_forbidden') : thetaSingle ? t('dashboard.charts.theta_single') : undefined}
            empty={!!theta.data && thetaView.rows.length === 0}
            footer={
              thetaView.rows.length > 1 ? (
                <ChartLegend items={thetaView.classes.map((cls, i) => ({ label: cls, color: `var(--chart-${(i % 8) + 1})`, dash: thetaDash(cls) }))} />
              ) : undefined
            }
          >
            <ThetaChart rows={thetaView.rows} classes={thetaView.classes} />
          </ChartFrame>
        </div>
      </Section>

      <Section
        title={t('dashboard.seg.col_class')}
        actions={
          <Button
            variant="secondary"
            size="sm"
            rightIcon={<ArrowRight size={14} />}
            onClick={() => navigate('/abc-xyz')}
          >
            {t('nav.abc_xyz')}
          </Button>
        }
      >
        {segAllNull && (
          <div style={{ padding: 'var(--space-2) var(--space-4)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <span>{t('dashboard.reason.availability')}</span>
            {advanceBtn}
          </div>
        )}
        <Card flush>
          <Table
            columns={segCols}
            rows={sh?.segment_availabilities ?? []}
            rowKey={(r) => r.class_id}
            loading={shadow.loading && !sh}
            error={shadow.error}
            onRetry={shadow.refetch}
            dense
          />
        </Card>
      </Section>

      <Section
        title={t('dashboard.alerts.title')}
        description={
          alerts.data
            ? t('dashboard.alerts.summary', {
                critical: fmt.integer(alerts.data.summary.critical_count),
                warning: fmt.integer(alerts.data.summary.warning_count),
                healthy: fmt.integer(alerts.data.summary.healthy_count),
                total: fmt.integer(alerts.data.summary.total_monitored),
              })
            : t('dashboard.alerts.description')
        }
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Select
              aria-label={t('dashboard.alerts.col_severity')}
              value={severity}
              onChange={setSeverity}
              options={[
                { value: '', label: t('dashboard.alerts.filter_all') },
                { value: 'CRITICAL', label: t('dashboard.alerts.sev_critical') },
                { value: 'WARNING', label: t('dashboard.alerts.sev_warning') },
                { value: 'HEALTHY', label: t('dashboard.alerts.sev_healthy') },
              ]}
            />
            <Button
              variant="secondary"
              size="sm"
              rightIcon={<ArrowRight size={14} />}
              onClick={() => navigate('/replenishment')}
            >
              {t('dashboard.alerts.view_all_replenishments')}
            </Button>
          </div>
        }
      >
        <Card flush>
          <Table
            columns={alertCols}
            rows={alerts.data?.items ?? []}
            rowKey={(r) => `${r.item_id}|${r.store_id}`}
            loading={alerts.loading && !alerts.data}
            error={alerts.error}
            onRetry={alerts.refetch}
            filtered={!!severity}
            maxHeight={360}
            dense
          />
        </Card>
        {alerts.data && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <span className="ui-muted" style={{ fontSize: 'var(--text-xs)' }}>
              {t('dashboard.alerts.shown', { shown: fmt.integer(alerts.data.items.length), total: fmt.integer(alerts.data.total) })}
            </span>
            <span className="ui-muted" style={{ fontSize: 'var(--text-xs)' }}>
              {t('dashboard.realtime_note')}
            </span>
          </div>
        )}
      </Section>
      {dialog}
    </>
  );
};

export default Dashboard;
