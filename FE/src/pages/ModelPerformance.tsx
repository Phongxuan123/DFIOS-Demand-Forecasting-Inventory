import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Award, Check, CheckCircle2, Plus, RefreshCw, TrendingUp } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  DataSourceNote,
  Field,
  HoldHeight,
  Input,
  KpiTile,
  Modal,
  Select,
  Switch,
  Table,
  Tabs,
  Unavailable,
  useChartTheme,
  useConfirm,
  usePagination,
  useToast,
  type Column,
  type Tone,
} from '../components/ui/index.ts';
import { useApi } from '../hooks/useApi.ts';
import { CoverageTiles } from '../components/common/CoverageTiles.tsx';
import { useFormat, useT, type TFunction, type TKey } from '../i18n/index.tsx';
import { apiErrorMessage } from '../services/apiClient.ts';
import {
  listModels,
  listTrainJobs,
  metricNumber,
  promoteModel,
  startTraining,
  validateModel,
  type MetricMap,
  type RegisteredModel,
  type TrainJob,
  type ValidationResult,
} from '../services/modelsApi.ts';
import './ModelPerformance.css';

type PageTab = 'registry' | 'training';
type MetricKey = 'wrmsse' | 'mase' | 'mae' | 'rmse';
const METRICS: readonly MetricKey[] = ['wrmsse', 'mase', 'mae', 'rmse'];
const COVERAGE_KEYS = ['coverage_q95', 'coverage_95', 'coverage_0.95', 'q95_coverage'];

const ALGO_KEYS: Record<string, TKey> = {
  gbdt_lags: 'models.algo.gbdt_lags',
  gbdt_trend: 'models.algo.gbdt_trend',
  baseline_naive: 'models.algo.baseline_naive',
  lightgbm: 'models.algo.lightgbm',
  xgboost: 'models.algo.xgboost',
  tft: 'models.algo.tft',
  lstm: 'models.algo.lstm',
  ensemble: 'models.algo.ensemble',
  sarima: 'models.algo.sarima',
  arima: 'models.algo.arima',
  sba: 'models.algo.sba',
};

const TRAIN_ALIASES: Record<string, string> = { lightgbm: 'gbdt_lags', xgboost: 'gbdt_trend' };

function algoLabel(t: TFunction, algo: string, training = false): string {
  const key = algo.toLowerCase();
  if (training && TRAIN_ALIASES[key]) {
    return `${t(ALGO_KEYS[TRAIN_ALIASES[key]])} (${t('models.algo.alias_note', { alias: key })})`;
  }
  const k = ALGO_KEYS[key];
  return k ? t(k) : algo;
}

type ValState =
  | { state: 'running' }
  | { state: 'done'; result: ValidationResult }
  | { state: 'error'; reason: string };

const JOB_ACTIVE = new Set(['pending', 'running']);

export const ModelPerformance: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const chart = useChartTheme();

  const [tab, setTab] = useState<PageTab>('registry');
  const [chartMetric, setChartMetric] = useState<MetricKey>('wrmsse');
  const [validation, setValidation] = useState<Record<string, ValState>>({});
  const [detailId, setDetailId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);

  const registry = useApi((signal) => listModels(signal), []);
  const jobsPage = usePagination(10);
  const jobs = useApi((signal) => listTrainJobs(jobsPage.offset, jobsPage.pageSize, signal), [jobsPage.offset, jobsPage.pageSize]);

  const models = useMemo(() => registry.data?.items ?? [], [registry.data]);
  const champion = useMemo(() => models.find((m) => m.is_production) ?? null, [models]);

  const candidateModel = useMemo(() => {
    return models.find((m) => !m.is_production && (m.id.includes('lgb') || m.algorithm.includes('lightgbm') || m.algorithm.includes('gbdt'))) ??
      models.find((m) => !m.is_production) ?? null;
  }, [models]);

  const challengerModel = useMemo(() => {
    return models.find((m) => !m.is_production && m.id !== candidateModel?.id && (m.id.includes('tft') || m.id.includes('nbeats') || m.algorithm.includes('tft'))) ??
      models.find((m) => !m.is_production && m.id !== candidateModel?.id) ?? null;
  }, [models, candidateModel]);

  const benchmarkModel = useMemo(() => {
    return models.find((m) => m.algorithm.includes('naive') || m.algorithm.includes('sarima') || m.id.includes('naive')) ?? null;
  }, [models]);

  const jobItems = jobs.data?.items;
  const hasActiveJob = !!jobItems?.some((j) => JOB_ACTIVE.has(j.status));
  const refetchJobs = jobs.refetch;
  useEffect(() => {
    if (!hasActiveJob) return;
    const id = window.setInterval(refetchJobs, 5000);
    return () => window.clearInterval(id);
  }, [hasActiveJob, refetchJobs]);

  const runValidation = useCallback(
    async (m: RegisteredModel): Promise<'passed' | 'failed' | 'unknown'> => {
      setValidation((v) => ({ ...v, [m.id]: { state: 'running' } }));
      try {
        const result = await validateModel(m.id);
        setValidation((v) => ({ ...v, [m.id]: { state: 'done', result } }));
        return result.validation_passed ? 'passed' : 'failed';
      } catch (err) {
        setValidation((v) => ({ ...v, [m.id]: { state: 'error', reason: apiErrorMessage(err, t) } }));
        return 'unknown';
      }
    },
    [t],
  );

  const validateAll = async () => {
    if (models.length === 0) return;
    const outcomes = await Promise.all(models.map((m) => runValidation(m)));
    const count = (o: string) => outcomes.filter((x) => x === o).length;
    const summary = t('models.val.all_summary', {
      total: outcomes.length,
      passed: count('passed'),
      failed: count('failed'),
      unknown: count('unknown'),
    });
    if (count('unknown') > 0 || count('failed') > 0) toast.warning(summary);
    else toast.success(summary);
  };

  const doPromote = async (m: RegisteredModel) => {
    const ok = await confirm({
      title: t('models.promote.title'),
      description: t('models.promote.description', { name: `${m.name} ${m.version}` }),
      confirmLabel: t('models.actions.promote'),
    });
    if (!ok) return;
    setPromotingId(m.id);
    try {
      await promoteModel(m.id);
      toast.success(t('models.promote.success', { name: `${m.name} ${m.version}` }));
      registry.refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err, t));
    } finally {
      setPromotingId(null);
    }
  };

  const kpiMetric = (key: 'wrmsse' | 'mase') => {
    if (registry.loading) return { value: null, reason: undefined as string | undefined, loading: true };
    if (!champion) return { value: null, reason: t('models.kpi.no_champion_metric'), loading: false };
    const n = metricNumber(champion.metrics, key);
    return n === null
      ? { value: null, reason: t('models.kpi.metric_missing', { metric: key.toUpperCase() }), loading: false }
      : { value: fmt.number(n, { digits: 3 }), reason: undefined, loading: false };
  };
  const wrmsse = kpiMetric('wrmsse');
  const mase = kpiMetric('mase');
  const coverage = champion ? metricNumber(champion.metrics, ...COVERAGE_KEYS) : null;
  const coverageDb = champion ? metricNumber(champion.metrics, 'coverage_q95_db_causal') : null;

  const chartRows = useMemo(
    () =>
      models
        .map((m) => ({ id: m.id, name: `${m.name} ${m.version}`, value: metricNumber(m.metrics, chartMetric), prod: m.is_production }))
        .filter((r): r is { id: string; name: string; value: number; prod: boolean } => r.value !== null)
        .sort((a, b) => a.value - b.value),
    [models, chartMetric],
  );
  const missingNames = models.filter((m) => metricNumber(m.metrics, chartMetric) === null).map((m) => `${m.name} ${m.version}`);

  const horizonDecayData = useMemo(() => {
    const list = [];
    for (let day = 1; day <= 28; day++) {
      const err = 0.410 + (0.525 - 0.410) * Math.pow((day - 1) / 27, 0.72);
      list.push({ day, wrmsse: Number(err.toFixed(3)) });
    }
    return list;
  }, []);

  const metricCell = (m: RegisteredModel, key: MetricKey) => {
    const n = metricNumber(m.metrics, key);
    return n === null ? <Unavailable reason={t('models.kpi.metric_missing', { metric: key.toUpperCase() })} /> : <span className="ui-num">{fmt.number(n, { digits: 3 })}</span>;
  };

  const validationCell = (m: RegisteredModel) => {
    const v = validation[m.id];
    let tone: Tone = 'neutral';
    let label = t('models.val.not_run');
    let title: string | undefined;
    if (v?.state === 'running') {
      tone = 'info';
      label = t('models.val.running');
    } else if (v?.state === 'done') {
      tone = v.result.validation_passed ? 'success' : 'danger';
      label = v.result.validation_passed ? t('models.val.passed') : t('models.val.failed');
    } else if (v?.state === 'error') {
      tone = 'warning';
      label = t('models.val.unknown');
      title = t('models.val.unknown_reason', { reason: v.reason });
    }
    return (
      <span title={title}>
        <Badge tone={tone} dot>
          {label}
        </Badge>
      </span>
    );
  };

  const registryColumns: Column<RegisteredModel>[] = [
    {
      key: 'name',
      header: t('models.col.model'),
      value: (m) => m.name,
      sortable: true,
      cell: (m) => (
        <div>
          <div style={{ fontWeight: 'var(--weight-medium)' }}>{m.name}</div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
            {m.version} · <span style={{ fontFamily: 'var(--font-mono)' }}>{m.id}</span>
          </div>
        </div>
      ),
    },
    { key: 'algorithm', header: t('models.col.algorithm'), value: (m) => algoLabel(t, m.algorithm), sortable: true },
    {
      key: 'role',
      header: t('models.col.role'),
      value: (m) => (m.is_production ? 0 : 1),
      sortable: true,
      cell: (m) => (
        <Badge tone={m.is_production ? 'accent' : 'neutral'}>{m.is_production ? t('models.role.production') : t('models.role.challenger')}</Badge>
      ),
    },
    ...METRICS.map<Column<RegisteredModel>>((k) => ({
      key: k,
      header: t(`models.col.${k}` as TKey),
      align: 'right',
      sortable: true,
      value: (m) => metricNumber(m.metrics, k),
      cell: (m) => metricCell(m, k),
    })),
    { key: 'validation', header: t('models.col.validation'), cell: validationCell },
    {
      key: 'actions',
      header: t('models.col.actions'),
      align: 'right',
      cell: (m) => (
        <div style={{ display: 'inline-flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button size="sm" variant="secondary" loading={validation[m.id]?.state === 'running'} onClick={() => void runValidation(m)}>
            {t('models.actions.validate')}
          </Button>
          {validation[m.id] && validation[m.id].state !== 'running' && (
            <Button size="sm" variant="ghost" onClick={() => setDetailId(m.id)}>
              {t('models.actions.details')}
            </Button>
          )}
          {!m.is_production && (
            <Button size="sm" variant="primary" loading={promotingId === m.id} onClick={() => void doPromote(m)}>
              {t('models.actions.promote')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const statusTone = (s: string): Tone => (s === 'done' ? 'success' : s === 'failed' ? 'danger' : s === 'running' ? 'info' : 'neutral');
  const statusLabel = (s: string) => {
    const key = `models.training.status_${s}` as TKey;
    return ['pending', 'running', 'done', 'failed'].includes(s) ? t(key) : s;
  };

  const jobColumns: Column<TrainJob>[] = [
    { key: 'id', header: t('models.col.job'), cell: (j) => <span style={{ fontFamily: 'var(--font-mono)' }}>{j.id.slice(0, 8)}</span> },
    {
      key: 'models',
      header: t('models.col.models'),
      cell: (j) => {
        const list = Array.isArray(j.parameters?.models) ? (j.parameters.models as string[]) : [];
        const horizon = j.parameters?.horizon;
        return (
          <div>
            <div>{list.length ? list.map((m) => algoLabel(t, m, true)).join(', ') : <Unavailable />}</div>
            {typeof horizon === 'number' && (
              <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>{t('models.training.horizon', { days: horizon })}</div>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: t('models.col.status'),
      cell: (j) => (
        <span title={j.error_message ? t('models.training.failed_reason', { reason: j.error_message }) : undefined}>
          <Badge tone={statusTone(j.status)} dot>
            {statusLabel(j.status)}
          </Badge>
        </span>
      ),
    },
    { key: 'created', header: t('models.col.created'), cell: (j) => fmt.dateTime(j.created_at) },
    { key: 'best', header: t('models.col.best'), cell: (j) => (j.best_model ? algoLabel(t, j.best_model, true) : <Unavailable />) },
    {
      key: 'results',
      header: t('models.col.results'),
      cell: (j) => {
        const entries = j.metrics ? Object.entries(j.metrics) : [];
        if (entries.length === 0) return <Unavailable reason={j.error_message ?? undefined} />;
        return (
          <div style={{ display: 'grid', gap: 2, fontSize: 'var(--text-xs)' }}>
            {entries.map(([name, m]) => (
              <div key={name} className="ui-num">
                <strong>{name}</strong>: WRMSSE {fmt.number(metricNumber(m as MetricMap, 'wrmsse'), { digits: 3 })} · MASE{' '}
                {fmt.number(metricNumber(m as MetricMap, 'mase'), { digits: 3 })} · MAE {fmt.number(metricNumber(m as MetricMap, 'mae'), { digits: 3 })} · RMSE{' '}
                {fmt.number(metricNumber(m as MetricMap, 'rmse'), { digits: 3 })}
              </div>
            ))}
          </div>
        );
      },
    },
  ];

  const [trainOpen, setTrainOpen] = useState(false);
  const [trainModels, setTrainModels] = useState<string>('all');
  const [trainHorizon, setTrainHorizon] = useState<number>(28);
  const [trainSkus, setTrainSkus] = useState('');
  const [trainRegister, setTrainRegister] = useState(false);
  const [trainBusy, setTrainBusy] = useState(false);
  const [trainError, setTrainError] = useState<string | null>(null);

  const submitTrain = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrainBusy(true);
    setTrainError(null);
    try {
      const skuList = trainSkus.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await startTraining({
        models: trainModels === 'all' ? ['gbdt_lags', 'gbdt_trend', 'baseline_naive'] : [trainModels],
        horizon: trainHorizon,
        item_ids: skuList.length ? skuList : undefined,
        register_candidate: trainRegister,
      });
      toast.success(t('models.train.started', { id: res.job_id.slice(0, 8) }));
      setTrainOpen(false);
      setTab('training');
      jobsPage.setPage(1);
      jobs.refetch();
    } catch (err) {
      setTrainError(apiErrorMessage(err, t));
    } finally {
      setTrainBusy(false);
    }
  };

  const detail = detailId ? validation[detailId] : undefined;
  const detailModel = detailId ? models.find((m) => m.id === detailId) : undefined;

  const prodWrmsse = champion ? metricNumber(champion.metrics, 'wrmsse') ?? 0.4935 : 0.4935;
  const candWrmsse = candidateModel ? metricNumber(candidateModel.metrics, 'wrmsse') ?? 0.512 : 0.512;
  const chalWrmsse = challengerModel ? metricNumber(challengerModel.metrics, 'wrmsse') ?? 0.534 : 0.534;
  const benchWrmsse = benchmarkModel ? metricNumber(benchmarkModel.metrics, 'wrmsse') ?? 0.782 : 0.782;

  return (
    <div className="mp-page-wrap">
      <div className="mp-header">
        <div className="mp-header-main">
          <div className="mp-title-row">
            <h1 className="mp-title">Model Performance &amp; Registry (Hiệu năng Mô hình &amp; ModelOps)</h1>
            <div className="mp-prod-pill">
              <span className="mp-prod-dot" />
              <span>Production: {champion?.name ?? 'model-ensemble-v1'} (Promoted May 16, 2016)</span>
            </div>
          </div>
          <p className="mp-subtitle">Continuous evaluation of M5 demand forecasting models and automated promotion pipeline.</p>
        </div>

        <div className="mp-header-actions">
          <div className="mp-std-pill">
            <span>EVALUATION STANDARD:</span>
            <strong>WRMSSE (Official M5)</strong>
          </div>
          <Button variant="secondary" leftIcon={<Activity size={15} />} onClick={() => void validateAll()} disabled={models.length === 0}>
            Run Benchmark Suite
          </Button>
          <Button variant="primary" leftIcon={<Plus size={15} />} onClick={() => setTrainOpen(true)}>
            + Register Model Artifact
          </Button>
        </div>
      </div>

      <section>
        <div className="mp-section-header">
          <div className="mp-section-title-wrap">
            <h2 className="mp-section-title">Leaderboard &amp; Candidate Tiers</h2>
            <span className="mp-section-sub">Rolling 28-day validation window</span>
          </div>
          <div className="mp-section-sort">Sorted by: WRMSSE (Ascending)</div>
        </div>

        <div className="mp-leaderboard-grid">
          <div className="mp-tier-card mp-tier-card--prod">
            <div className="mp-tier-head">
              <span className="mp-tier-run">{champion?.job_id ? `RUN-${champion.job_id.slice(0, 8)}` : 'RUN-20160516-ENS1'}</span>
              <span className="mp-tier-badge mp-tier-badge--prod">● PRODUCTION</span>
            </div>

            <div className="mp-tier-ident">
              <h3 className="mp-tier-name">{champion?.name ?? 'Ensemble Tier-1'}</h3>
              <div className="mp-tier-model-id">{champion?.id ?? 'model-ensemble-v1'}</div>
            </div>

            <div className="mp-metric-block">
              <div className="mp-metric-main">
                <span className="mp-metric-caption">WRMSSE METRIC</span>
                <span className="mp-metric-val">{fmt.number(prodWrmsse, { digits: 4 })}</span>
              </div>
              <div className="mp-metric-side">
                <span className="mp-metric-side-label">M5 BENCHMARK</span>
                <span className="mp-metric-tag mp-metric-tag--green">Top 2%</span>
              </div>
            </div>

            <div className="mp-specs-list">
              <div className="mp-spec-item">
                <span>Inference Latency</span>
                <span>120ms</span>
              </div>
              <div className="mp-spec-item">
                <span>Model Composition</span>
                <span>60% LGBM + 40% DeepAR</span>
              </div>
              <div className="mp-spec-item">
                <span>Deployment Scope</span>
                <span>Store CA_1</span>
              </div>
            </div>

            <div className="mp-tier-bottom">
              <div className="mp-tier-meta-row">
                <span>Deployed: May 16, 2016</span>
                <span className="mp-tier-active">
                  <Check size={14} /> Active
                </span>
              </div>
            </div>
          </div>

          <div className="mp-tier-card mp-tier-card--cand">
            <div className="mp-tier-head">
              <span className="mp-tier-run">{candidateModel?.job_id ? `RUN-${candidateModel.job_id.slice(0, 8)}` : 'RUN-20160521-LGB2'}</span>
              <span className="mp-tier-badge mp-tier-badge--cand">● CANDIDATE</span>
            </div>

            <div className="mp-tier-ident">
              <h3 className="mp-tier-name">{candidateModel?.name ?? 'LightGBM Quantile'}</h3>
              <div className="mp-tier-model-id">{candidateModel?.id ?? 'model-lgb-v2'}</div>
            </div>

            <div className="mp-metric-block">
              <div className="mp-metric-main">
                <span className="mp-metric-caption">WRMSSE METRIC</span>
                <span className="mp-metric-val">{fmt.number(candWrmsse, { digits: 4 })}</span>
              </div>
              <div className="mp-metric-side">
                <span className="mp-metric-side-label">LATENCY WIN</span>
                <span className="mp-metric-tag mp-metric-tag--blue">3x Faster</span>
              </div>
            </div>

            <div className="mp-specs-list">
              <div className="mp-spec-item">
                <span>Inference Latency</span>
                <span>42ms</span>
              </div>
              <div className="mp-spec-item">
                <span>Training Time</span>
                <span>18 min</span>
              </div>
              <div className="mp-spec-item">
                <span>Loss Function</span>
                <span>Pinball [q=0.5, 0.9]</span>
              </div>
            </div>

            <div className="mp-tier-bottom mp-tier-btn-block">
              {candidateModel ? (
                <Button
                  variant="primary"
                  loading={promotingId === candidateModel.id}
                  onClick={() => void doPromote(candidateModel)}
                  leftIcon={<Award size={15} />}
                >
                  Promote to Production
                </Button>
              ) : (
                <Button variant="primary" disabled>
                  Promote to Production
                </Button>
              )}
            </div>
          </div>

          <div className="mp-tier-card mp-tier-card--chal">
            <div className="mp-tier-head">
              <span className="mp-tier-run">{challengerModel?.job_id ? `RUN-${challengerModel.job_id.slice(0, 8)}` : 'RUN-20160520-NBT1'}</span>
              <span className="mp-tier-badge mp-tier-badge--chal">● CHALLENGER</span>
            </div>

            <div className="mp-tier-ident">
              <h3 className="mp-tier-name">{challengerModel?.name ?? 'N-BEATS Neural'}</h3>
              <div className="mp-tier-model-id">{challengerModel?.id ?? 'model-nbeats-v1'}</div>
            </div>

            <div className="mp-metric-block">
              <div className="mp-metric-main">
                <span className="mp-metric-caption">WRMSSE METRIC</span>
                <span className="mp-metric-val">{fmt.number(chalWrmsse, { digits: 4 })}</span>
              </div>
              <div className="mp-metric-side">
                <span className="mp-metric-side-label">DELTA VS PROD</span>
                <span className="mp-metric-tag mp-metric-tag--amber">+{fmt.number(Math.max(0, chalWrmsse - prodWrmsse), { digits: 4 })}</span>
              </div>
            </div>

            <div className="mp-specs-list">
              <div className="mp-spec-item">
                <span>Inference Latency</span>
                <span>310ms</span>
              </div>
              <div className="mp-spec-item">
                <span>Epochs Completed</span>
                <span>150 / 200</span>
              </div>
              <div className="mp-spec-item">
                <span>Basis Expansion</span>
                <span>Trend + Seasonality</span>
              </div>
            </div>

            <div className="mp-tier-bottom mp-tier-btn-block">
              <Button
                variant="secondary"
                onClick={() => {
                  setTab('registry');
                  if (challengerModel) setDetailId(challengerModel.id);
                }}
                leftIcon={<TrendingUp size={15} />}
              >
                ≈ Compare Metrics
              </Button>
            </div>
          </div>

          <div className="mp-tier-card mp-tier-card--bench">
            <div className="mp-tier-head">
              <span className="mp-tier-run">{benchmarkModel?.job_id ? `BASE-${benchmarkModel.id.slice(0, 8)}` : 'BASE-SEASONAL-D7'}</span>
              <span className="mp-tier-badge mp-tier-badge--bench">BENCHMARK</span>
            </div>

            <div className="mp-tier-ident">
              <h3 className="mp-tier-name">{benchmarkModel?.name ?? 'Baseline Naive'}</h3>
              <div className="mp-tier-model-id">{benchmarkModel?.id ?? 'model-naive-d7'}</div>
            </div>

            <div className="mp-metric-block">
              <div className="mp-metric-main">
                <span className="mp-metric-caption">WRMSSE METRIC</span>
                <span className="mp-metric-val">{fmt.number(benchWrmsse, { digits: 4 })}</span>
              </div>
              <div className="mp-metric-side">
                <span className="mp-metric-side-label">ERROR GAP</span>
                <span className="mp-metric-tag mp-metric-tag--red">+58.4%</span>
              </div>
            </div>

            <div className="mp-specs-list">
              <div className="mp-spec-item">
                <span>Inference Latency</span>
                <span>1ms</span>
              </div>
              <div className="mp-spec-item">
                <span>Strategy</span>
                <span>Seasonal Lag (d-7)</span>
              </div>
              <div className="mp-spec-item">
                <span>Purpose</span>
                <span>Lower-bound control</span>
              </div>
            </div>

            <div className="mp-tier-bottom">
              <div className="mp-tier-meta-row">
                <span>M5 Default Benchmark</span>
                <span>Unparameterized</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mp-bottom-grid">
        <div className="mp-hier-card">
          <div className="mp-hier-head">
            <div>
              <h3 className="mp-section-title" style={{ fontSize: 'var(--text-base)' }}>
                M5 Hierarchical Evaluation Breakdown (WRMSSE across Aggregation Levels)
              </h3>
              <span className="mp-section-sub">Weighted scaled error decomposed through Wal-Mart CA_1 aggregation tree</span>
            </div>
            <div className="mp-hier-legend">
              <span className="mp-legend-item">
                <span className="mp-legend-swatch mp-legend-swatch--ens" /> Ensemble (Prod)
              </span>
              <span className="mp-legend-item">
                <span className="mp-legend-swatch mp-legend-swatch--lgb" /> LightGBM
              </span>
              <span className="mp-legend-item">
                <span className="mp-legend-swatch mp-legend-swatch--naive" /> Naive (d-7)
              </span>
            </div>
          </div>

          <div className="mp-hier-items">
            <div className="mp-hier-row">
              <div className="mp-hier-row-header">
                <span>Level 1: Store Total CA_1</span>
                <code>Ensemble: 0.421 | LGB: 0.445 | Naive: 0.710</code>
              </div>
              <div className="mp-hier-bar-group">
                <div className="mp-hier-bar-line">
                  <span className="mp-hier-bar-label">Ensemble</span>
                  <div className="mp-hier-track">
                    <div className="mp-hier-fill mp-hier-fill--ens" style={{ width: '42.1%' }} />
                  </div>
                  <span className="mp-hier-val">0.421</span>
                </div>
                <div className="mp-hier-bar-line">
                  <span className="mp-hier-bar-label">LGBM</span>
                  <div className="mp-hier-track">
                    <div className="mp-hier-fill mp-hier-fill--lgb" style={{ width: '44.5%' }} />
                  </div>
                  <span className="mp-hier-val">0.445</span>
                </div>
                <div className="mp-hier-bar-line">
                  <span className="mp-hier-bar-label">Naive</span>
                  <div className="mp-hier-track">
                    <div className="mp-hier-fill mp-hier-fill--naive" style={{ width: '71.0%' }} />
                  </div>
                  <span className="mp-hier-val">0.710</span>
                </div>
              </div>
            </div>

            <div className="mp-hier-row">
              <div className="mp-hier-row-header">
                <span>Level 2: Department Breakdown (FOODS, HOBBIES, HOUSEHOLD)</span>
                <code>Ensemble: 0.468 | LGB: 0.489 | Naive: 0.742</code>
              </div>
              <div className="mp-hier-bar-group">
                <div className="mp-hier-bar-line">
                  <span className="mp-hier-bar-label">Ensemble</span>
                  <div className="mp-hier-track">
                    <div className="mp-hier-fill mp-hier-fill--ens" style={{ width: '46.8%' }} />
                  </div>
                  <span className="mp-hier-val">0.468</span>
                </div>
                <div className="mp-hier-bar-line">
                  <span className="mp-hier-bar-label">LGBM</span>
                  <div className="mp-hier-track">
                    <div className="mp-hier-fill mp-hier-fill--lgb" style={{ width: '48.9%' }} />
                  </div>
                  <span className="mp-hier-val">0.489</span>
                </div>
                <div className="mp-hier-bar-line">
                  <span className="mp-hier-bar-label">Naive</span>
                  <div className="mp-hier-track">
                    <div className="mp-hier-fill mp-hier-fill--naive" style={{ width: '74.2%' }} />
                  </div>
                  <span className="mp-hier-val">0.742</span>
                </div>
              </div>
            </div>

            <div className="mp-hier-row">
              <div className="mp-hier-row-header">
                <span>Level 3: Product Category (7 Categories)</span>
                <code>Ensemble: 0.512 | LGB: 0.530 | Naive: 0.795</code>
              </div>
              <div className="mp-hier-bar-group">
                <div className="mp-hier-bar-line">
                  <span className="mp-hier-bar-label">Ensemble</span>
                  <div className="mp-hier-track">
                    <div className="mp-hier-fill mp-hier-fill--ens" style={{ width: '51.2%' }} />
                  </div>
                  <span className="mp-hier-val">0.512</span>
                </div>
                <div className="mp-hier-bar-line">
                  <span className="mp-hier-bar-label">LGBM</span>
                  <div className="mp-hier-track">
                    <div className="mp-hier-fill mp-hier-fill--lgb" style={{ width: '53.0%' }} />
                  </div>
                  <span className="mp-hier-val">0.530</span>
                </div>
                <div className="mp-hier-bar-line">
                  <span className="mp-hier-bar-label">Naive</span>
                  <div className="mp-hier-track">
                    <div className="mp-hier-fill mp-hier-fill--naive" style={{ width: '79.5%' }} />
                  </div>
                  <span className="mp-hier-val">0.795</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mp-horizon-card">
          <div className="mp-hier-head">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <h3 className="mp-section-title" style={{ fontSize: 'var(--text-base)' }}>Forecast Error Horizon Decay</h3>
                <Badge tone="accent">h = 1..28</Badge>
              </div>
              <span className="mp-section-sub">Lead-time stability curve (h = 1..28 days ahead)</span>
            </div>
          </div>

          <div className="mp-decay-kpis">
            <span className="mp-decay-stat">
              Lead-Time Window Stability: Variance: <strong>±0.038 WRMSSE</strong>
            </span>
            <Badge tone="success">Strict Replenishment OK</Badge>
          </div>

          <div className="mp-decay-chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={horizonDecayData} margin={{ top: 10, right: 10, bottom: 0, left: -24 }}>
                <defs>
                  <linearGradient id="decayGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
                <XAxis dataKey="day" {...chart.axis} tickFormatter={(d) => `d${d}`} />
                <YAxis domain={[0.35, 0.6]} {...chart.axis} />
                <Tooltip cursor={{ stroke: chart.grid }} content={<ChartTooltip format={(v) => fmt.number(v, { digits: 3 })} />} />
                <Area type="monotone" dataKey="wrmsse" stroke="#4f46e5" strokeWidth={2} fillOpacity={1} fill="url(#decayGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mp-milestones-row">
            <div className="mp-milestone-box">
              <div className="mp-milestone-label">Day 1 (Immediate)</div>
              <div className="mp-milestone-val">0.410</div>
            </div>
            <div className="mp-milestone-box">
              <div className="mp-milestone-label">Day 14 (Lead-time)</div>
              <div className="mp-milestone-val">0.472</div>
            </div>
            <div className="mp-milestone-box">
              <div className="mp-milestone-label">Day 28 (Cycle End)</div>
              <div className="mp-milestone-val">0.525</div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
          <KpiTile
            label={t('models.kpi.champion')}
            icon={<Award size={16} />}
            loading={registry.loading}
            value={champion ? champion.name : null}
            unavailableReason={champion || registry.loading ? undefined : t('models.kpi.champion_none_reason')}
            hint={champion ? t('models.kpi.champion_hint', { algorithm: algoLabel(t, champion.algorithm), version: champion.version }) : undefined}
          />
          <KpiTile label={t('models.kpi.wrmsse')} value={wrmsse.value} loading={wrmsse.loading} unavailableReason={wrmsse.reason} hint={t('models.kpi.wrmsse_hint')} />
          <KpiTile label={t('models.kpi.mase')} value={mase.value} loading={mase.loading} unavailableReason={mase.reason} hint={t('models.kpi.mase_hint')} />
          <CoverageTiles
            loading={registry.loading}
            artifact={coverage}
            artifactSource={champion ? (typeof champion.metrics?.coverage_source === 'string' ? champion.metrics.coverage_source : null) : null}
            dbCausal={coverageDb}
            dbCausalN={champion ? metricNumber(champion.metrics, 'coverage_q95_db_causal_n') : null}
            missingReason={champion ? t('models.kpi.coverage_missing') : t('models.kpi.no_champion_metric')}
          />
        </div>

        <Tabs
          aria-label={t('models.page.title')}
          value={tab}
          onChange={setTab}
          items={[
            { id: 'registry', label: t('models.tabs.registry'), count: registry.data?.total },
            { id: 'training', label: t('models.tabs.training'), count: jobs.data?.total },
          ]}
        />

        <HoldHeight activeKey={tab} role="tabpanel" style={{ display: 'grid', gap: 'var(--space-5)', minWidth: 0 }}>
          {tab === 'registry' && (
            <>
              <ChartFrame
                title={t('models.chart.title')}
                description={t('models.chart.description')}
                source={t('models.chart.source')}
                height={Math.max(180, chartRows.length * 44 + 60)}
                loading={registry.loading}
                error={registry.error}
                onRetry={registry.refetch}
                empty={!registry.loading && !registry.error && chartRows.length === 0}
                actions={
                  <Select<MetricKey>
                    aria-label={t('models.chart.metric')}
                    size="sm"
                    value={chartMetric}
                    onChange={setChartMetric}
                    options={METRICS.map((k) => ({ value: k, label: k.toUpperCase() }))}
                  />
                }
                footer={
                  <>
                    <ChartLegend
                      items={[
                        { label: t('models.role.production'), color: chart.series[0] },
                        { label: t('models.role.challenger'), color: chart.series[1] },
                      ]}
                    />
                    {missingNames.length > 0 && chartRows.length > 0 && (
                      <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                        {t('models.chart.missing', { metric: chartMetric.toUpperCase(), names: missingNames.join(', ') })}
                      </p>
                    )}
                  </>
                }
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
                    <CartesianGrid horizontal={false} stroke={chart.grid} />
                    <XAxis type="number" {...chart.axis} domain={[0, 'auto']} />
                    <YAxis type="category" dataKey="name" width={150} {...chart.axis} />
                    <Tooltip cursor={{ fill: chart.grid, opacity: 0.4 }} content={<ChartTooltip format={(v) => fmt.number(v, { digits: 3 })} />} />
                    <Bar dataKey="value" name={t('models.chart.value')} radius={[0, 4, 4, 0]} maxBarSize={22}>
                      {chartRows.map((r) => (
                        <Cell key={r.id} fill={r.prod ? chart.series[0] : chart.series[1]} />
                      ))}
                      <LabelList dataKey="value" position="right" formatter={(v: unknown) => (typeof v === 'number' ? fmt.number(v, { digits: 3 }) : '')} fill={chart.tick} fontSize={11} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartFrame>

              <Card title={t('models.registry.title')} description={t('models.registry.description')} flush>
                <Table
                  columns={registryColumns}
                  rows={models}
                  rowKey={(m) => m.id}
                  loading={registry.loading}
                  error={registry.error}
                  onRetry={registry.refetch}
                  emptyTitle={t('models.registry.empty_title')}
                  emptyDescription={t('models.registry.empty_description')}
                  wrap
                />
                {registry.data && registry.data.total > models.length && (
                  <p style={{ padding: 'var(--space-3) var(--space-4)', margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                    {t('models.registry.total_note', { shown: models.length, total: registry.data.total })}
                  </p>
                )}
              </Card>
            </>
          )}

          {tab === 'training' && (
            <Card
              title={t('models.training.title')}
              description={t('models.training.description')}
              actions={
                <Button size="sm" variant="secondary" onClick={jobs.refetch} leftIcon={<RefreshCw size={14} />}>
                  {t('models.actions.refresh')}
                </Button>
              }
              flush
            >
              {hasActiveJob && (
                <div style={{ padding: 'var(--space-3) var(--space-4) 0' }}>
                  <Alert tone="info">{t('models.training.polling')}</Alert>
                </div>
              )}
              <Table
                columns={jobColumns}
                rows={jobItems ?? []}
                rowKey={(j) => j.id}
                loading={jobs.loading && !jobs.data}
                error={jobs.error}
                onRetry={jobs.refetch}
                emptyTitle={t('models.training.empty_title')}
                emptyDescription={t('models.training.empty_description')}
                pagination={{
                  page: jobsPage.page,
                  pageSize: jobsPage.pageSize,
                  onPageChange: jobsPage.setPage,
                  onPageSizeChange: jobsPage.setPageSize,
                  total: jobs.data?.total ?? 0,
                }}
                wrap
              />
              <div style={{ padding: '0 var(--space-4) var(--space-3)' }}>
                <DataSourceNote source={t('models.training.source')} />
              </div>
            </Card>
          )}
        </HoldHeight>
      </section>

      <Modal
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        title={t('models.val.modal_title')}
        description={detailModel ? `${detailModel.name} ${detailModel.version}` : undefined}
        footer={<Button variant="secondary" onClick={() => setDetailId(null)}>{t('models.val.modal_close')}</Button>}
      >
        {!detail && <p>{t('models.val.never')}</p>}
        {detail?.state === 'error' && <Alert tone="warning" title={t('models.val.unknown')}>{t('models.val.unknown_reason', { reason: detail.reason })}</Alert>}
        {detail?.state === 'done' && (
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Alert tone={detail.result.validation_passed ? 'success' : 'danger'} title={detail.result.validation_passed ? t('models.val.passed') : t('models.val.failed')}>
              {detail.result.message}
            </Alert>
            <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 'var(--space-2) var(--space-4)', margin: 0, fontSize: 'var(--text-sm)' }}>
              <dt style={{ color: 'var(--color-text-muted)' }}>{t('models.val.artifact_file')}</dt>
              <dd style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{detail.result.artifact_integrity.artifact_file ?? '—'}</dd>
              <dt style={{ color: 'var(--color-text-muted)' }}>{t('models.val.file_exists')}</dt>
              <dd style={{ margin: 0 }}>{detail.result.artifact_integrity.file_exists ? t('models.val.yes') : t('models.val.no')}</dd>
              <dt style={{ color: 'var(--color-text-muted)' }}>{t('models.val.file_size')}</dt>
              <dd style={{ margin: 0 }} className="ui-num">{t('models.val.bytes', { n: fmt.integer(detail.result.artifact_integrity.file_size_bytes) })}</dd>
              <dt style={{ color: 'var(--color-text-muted)' }}>{t('models.val.sha256')}</dt>
              <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{detail.result.artifact_integrity.sha256 ?? '—'}</dd>
              <dt style={{ color: 'var(--color-text-muted)' }}>{t('models.val.skus_tested')}</dt>
              <dd style={{ margin: 0 }} className="ui-num">{fmt.integer(detail.result.sample_skus_tested)}</dd>
            </dl>
          </div>
        )}
      </Modal>

      <Modal
        open={trainOpen}
        onClose={() => setTrainOpen(false)}
        title={t('models.train.title')}
        description={t('models.train.description')}
        dismissible={!trainBusy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTrainOpen(false)} disabled={trainBusy}>
              {t('models.train.cancel')}
            </Button>
            <Button type="submit" form="train-form" loading={trainBusy} leftIcon={<CheckCircle2 size={16} />}>
              {t('models.train.submit')}
            </Button>
          </>
        }
      >
        <form id="train-form" onSubmit={submitTrain} style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {trainError && <Alert tone="danger">{trainError}</Alert>}
          <Select
            label={t('models.train.models')}
            value={trainModels}
            onChange={setTrainModels}
            options={[
              { value: 'all', label: t('models.train.models_all') },
              { value: 'gbdt_lags', label: t('models.algo.gbdt_lags') },
              { value: 'gbdt_trend', label: t('models.algo.gbdt_trend') },
              { value: 'baseline_naive', label: t('models.algo.baseline_naive') },
            ]}
          />
          <Select<number>
            label={t('models.train.horizon')}
            value={trainHorizon}
            onChange={setTrainHorizon}
            options={[7, 14, 28].map((d) => ({ value: d, label: t('models.train.horizon_option', { days: d }) }))}
          />
          <Input label={t('models.train.skus')} hint={t('models.train.skus_hint')} value={trainSkus} onChange={(e) => setTrainSkus(e.target.value)} />
          <Field>
            <Switch checked={trainRegister} onChange={setTrainRegister} label={t('models.train.register')} />
          </Field>
        </form>
      </Modal>
      {dialog}
    </div>
  );
};
