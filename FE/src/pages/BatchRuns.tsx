import React, { useMemo, useState } from 'react';
import { Eye, RefreshCw, Clock, Layers } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  IconButton,
  Modal,
  PageHeader,
  Select,
  Table,
  usePagination,
  useToast,
  type Column,
  type Tone,
} from '../components/ui/index.ts';
import { useApi } from '../hooks/useApi.ts';
import { useStore } from '../context/StoreContext.tsx';
import { useClock } from '../context/ClockContext.tsx';
import { useFormat, useT, type TKey } from '../i18n/index.tsx';
import { apiErrorMessage } from '../services/apiClient.ts';
import {
  getBatchRunDetail,
  listBatchRuns,
  type BatchRunDetail,
  type BatchRunItem,
} from '../services/batchRunsApi.ts';

const STATUS_TONES: Record<string, Tone> = {
  success: 'success',
  failed: 'danger',
  running: 'warning',
  queued: 'neutral',
};

const JOBS = ['ADVANCE', 'J1', 'J3', 'J4', 'J5', 'J6'] as const;
/** GET /batch-runs filters on these; 'queued' only exists while the compose worker has not picked a job up. */
const STATUS_FILTERS = ['running', 'success', 'failed'] as const;
const STATUSES = ['queued', 'running', 'success', 'failed'] as const;

export const BatchRuns: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const statusLabel = (s: string) => ((STATUSES as readonly string[]).includes(s) ? t(`ops.batch.status_${s}` as TKey) : s);
  const jobOptions = [{ value: '', label: t('ops.batch.job_all') }, ...JOBS.map((j) => ({ value: j, label: t(`ops.batch.job_${j}` as TKey) }))];
  const statusOptions = [{ value: '', label: t('ops.batch.status_all') }, ...STATUS_FILTERS.map((s) => ({ value: s, label: statusLabel(s) }))];
  const toast = useToast();
  const { concreteStoreId: storeId } = useStore();
  const clock = useClock();

  const [selectedJob, setSelectedJob] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [detailRunId, setDetailRunId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<BatchRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [nonce, setNonce] = useState(0);

  const pg = usePagination(20);

  const queryParams = useMemo(
    () => ({
      store_id: storeId || 'CA_1',
      job: selectedJob || undefined,
      status: selectedStatus || undefined,
      limit: pg.pageSize,
      offset: pg.offset,
    }),
    [storeId, selectedJob, selectedStatus, pg.pageSize, pg.offset],
  );

  const runsApi = useApi(
    (signal) => listBatchRuns(queryParams, signal),
    [queryParams, clock.version, nonce],
  );

  const openDetail = async (runId: string) => {
    setDetailRunId(runId);
    setDetailLoading(true);
    try {
      const data = await getBatchRunDetail(runId);
      setDetailData(data);
    } catch (err) {
      toast.error(t('ops.batch.detail_failed'), apiErrorMessage(err, t));
      setDetailRunId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailRunId(null);
    setDetailData(null);
  };

  const formatDuration = (ms?: number | null) => {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${ms.toFixed(0)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const columns: Column<BatchRunItem>[] = [
    {
      key: 'job',
      header: t('ops.batch.col_job'),
      cell: (r) => (
        <span style={{ fontWeight: 'var(--weight-semibold)', fontFamily: 'var(--font-mono)' }}>
          {r.job}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('ops.batch.col_status'),
      cell: (r) => (
        <Badge tone={STATUS_TONES[r.status] || 'neutral'} dot>
          {statusLabel(r.status)}
        </Badge>
      ),
    },
    {
      key: 'sim_date',
      header: t('ops.batch.col_sim_date'),
      cell: (r) => (r.sim_date ? fmt.date(r.sim_date) : '—'),
    },
    {
      key: 'review_index',
      header: t('ops.batch.col_review'),
      align: 'right',
      cell: (r) => (r.review_index !== null && r.review_index !== undefined ? `#${r.review_index}` : '—'),
    },
    {
      key: 'duration',
      header: t('ops.batch.col_duration'),
      align: 'right',
      cell: (r) => (
        <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(r.duration_ms)}</span>
      ),
    },
    {
      key: 'n_items',
      header: t('ops.batch.col_items'),
      align: 'right',
      cell: (r) => (r.n_items !== null && r.n_items !== undefined ? fmt.integer(r.n_items) : '—'),
    },
    {
      key: 'triggered_by',
      header: t('ops.batch.col_by'),
      cell: (r) => r.triggered_by || t('ops.batch.by_system'),
    },
    {
      key: 'started_at',
      header: t('ops.batch.col_started'),
      cell: (r) => fmt.dateTime(r.started_at),
    },
    {
      key: 'actions',
      header: t('ops.batch.col_actions'),
      align: 'right',
      cell: (r) => (
        <IconButton
          size="sm"
          label={t('ops.batch.view_detail')}
          icon={<Eye size={15} />}
          onClick={() => void openDetail(r.run_id)}
        />
      ),
    },
  ];

  const subJobColumns: Column<BatchRunItem>[] = [
    {
      key: 'job',
      header: t('ops.batch.col_job'),
      cell: (j) => <span style={{ fontWeight: 'var(--weight-semibold)' }}>{j.job}</span>,
    },
    {
      key: 'status',
      header: t('ops.batch.col_status'),
      cell: (j) => <Badge tone={STATUS_TONES[j.status] || 'neutral'}>{statusLabel(j.status)}</Badge>,
    },
    {
      key: 'duration',
      header: t('ops.batch.col_duration'),
      align: 'right',
      cell: (j) => <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(j.duration_ms)}</span>,
    },
    {
      key: 'n_items',
      header: t('ops.batch.col_items'),
      align: 'right',
      cell: (j) => (j.n_items !== null && j.n_items !== undefined ? fmt.integer(j.n_items) : '—'),
    },
  ];

  return (
    <div className="ui-stack">
      <PageHeader
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Clock size={22} />
            <span>{t('ops.batch.title')}</span>
          </div>
        }
        description={t('ops.batch.description')}
        actions={
          <Button
            variant="secondary"
            leftIcon={<RefreshCw size={15} />}
            onClick={() => setNonce((n) => n + 1)}
            loading={runsApi.loading}
          >
            {t('ops.batch.refresh')}
          </Button>
        }
      />

      <Card>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
          <div style={{ minWidth: 220 }}>
            <Select<string>
              id="batch-job-filter"
              size="sm"
              value={selectedJob}
              onChange={setSelectedJob}
              options={jobOptions}
              aria-label={t('ops.batch.filter_job')}
            />
          </div>
          <div style={{ minWidth: 180 }}>
            <Select<string>
              id="batch-status-filter"
              size="sm"
              value={selectedStatus}
              onChange={setSelectedStatus}
              options={statusOptions}
              aria-label={t('ops.batch.filter_status')}
            />
          </div>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
            {t('ops.batch.summary', { store: storeId || 'CA_1', total: fmt.integer(runsApi.data?.total ?? 0) })}
          </span>
        </div>

        <Table
          columns={columns}
          rows={runsApi.data?.items ?? []}
          rowKey={(r) => r.id}
          loading={runsApi.loading}
          pagination={{
            page: pg.page,
            pageSize: pg.pageSize,
            total: runsApi.data?.total ?? 0,
            onPageChange: pg.setPage,
            onPageSizeChange: pg.setPageSize,
          }}
        />
      </Card>

      <Modal
        open={!!detailRunId}
        onClose={closeDetail}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Layers size={18} />
            <span>{t('ops.batch.detail_title', { id: detailRunId?.slice(0, 8) ?? '' })}</span>
          </div>
        }
        size="lg"
      >
        {detailLoading ? (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
            <p className="ui-muted">{t('ops.batch.detail_loading')}</p>
          </div>
        ) : detailData ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
              <div className="ui-summary-item">
                <span className="ui-summary-item__label">{t('ops.batch.detail_job')}</span>
                <span className="ui-summary-item__value">{detailData.job}</span>
              </div>
              <div className="ui-summary-item">
                <span className="ui-summary-item__label">{t('ops.batch.col_status')}</span>
                <span className="ui-summary-item__value">
                  <Badge tone={STATUS_TONES[detailData.status] || 'neutral'} dot>
                    {statusLabel(detailData.status)}
                  </Badge>
                </span>
              </div>
              <div className="ui-summary-item">
                <span className="ui-summary-item__label">{t('ops.batch.detail_total')}</span>
                <span className="ui-summary-item__value" style={{ fontFamily: 'var(--font-mono)' }}>
                  {formatDuration(detailData.duration_ms)}
                </span>
              </div>
              <div className="ui-summary-item">
                <span className="ui-summary-item__label">{t('ops.batch.detail_by')}</span>
                <span className="ui-summary-item__value">{detailData.triggered_by || t('ops.batch.by_system')}</span>
              </div>
            </div>

            {detailData.error && (
              <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--color-danger-subtle)', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)' }}>
                <strong>{t('ops.batch.detail_error')}</strong>
                <pre style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xs)', whiteSpace: 'pre-wrap' }}>
                  {detailData.error}
                </pre>
              </div>
            )}

            {detailData.totals_by_job && Object.keys(detailData.totals_by_job).length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 var(--space-2) 0', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
                  {t('ops.batch.detail_totals')}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-2)' }}>
                  {Object.entries(detailData.totals_by_job).map(([jobName, summary]) => (
                    <div
                      key={jobName}
                      style={{
                        padding: 'var(--space-2)',
                        border: '1px solid var(--color-border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-surface)',
                      }}
                    >
                      <div style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-xs)' }}>{jobName}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                        {t('ops.batch.detail_totals_value', { duration: formatDuration(summary.duration_ms), count: summary.count })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detailData.jobs && detailData.jobs.length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 var(--space-2) 0', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
                  {t('ops.batch.detail_jobs', { count: detailData.jobs.length })}
                </h4>
                <Table
                  columns={subJobColumns}
                  rows={detailData.jobs}
                  rowKey={(j) => j.id}
                  dense
                  maxHeight={260}
                />
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

