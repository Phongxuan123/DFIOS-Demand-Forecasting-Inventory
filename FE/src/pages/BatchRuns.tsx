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
import { useFormat } from '../i18n/index.tsx';
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

const JOB_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Tất cả Jobs' },
  { value: 'ADVANCE', label: 'ADVANCE (Tua đồng hồ)' },
  { value: 'J1', label: 'J1 (Replay & Daily Inventory)' },
  { value: 'J3', label: 'J3 (Route (c) Distribution)' },
  { value: 'J4', label: 'J4 (C³-OUT & Replenishment)' },
  { value: 'J5', label: 'J5 (Quarterly Refit)' },
  { value: 'J6', label: 'J6 (Service Outcomes)' },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'running', label: 'Đang chạy (Running)' },
  { value: 'success', label: 'Thành công (Success)' },
  { value: 'failed', label: 'Thất bại (Failed)' },
];

export const BatchRuns: React.FC = () => {
  const fmt = useFormat();
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
    } catch (err: any) {
      toast.error('Không tải được chi tiết batch run', err?.message || String(err));
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
      header: 'Job',
      cell: (r) => (
        <span style={{ fontWeight: 'var(--weight-semibold)', fontFamily: 'var(--font-mono)' }}>
          {r.job}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (r) => (
        <Badge tone={STATUS_TONES[r.status] || 'neutral'} dot>
          {r.status}
        </Badge>
      ),
    },
    {
      key: 'sim_date',
      header: 'Ngày mô phỏng',
      cell: (r) => (r.sim_date ? fmt.date(r.sim_date) : '—'),
    },
    {
      key: 'review_index',
      header: 'Kỳ review #',
      align: 'right',
      cell: (r) => (r.review_index !== null && r.review_index !== undefined ? `#${r.review_index}` : '—'),
    },
    {
      key: 'duration',
      header: 'Thời lượng',
      align: 'right',
      cell: (r) => (
        <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(r.duration_ms)}</span>
      ),
    },
    {
      key: 'n_items',
      header: 'Số mục',
      align: 'right',
      cell: (r) => (r.n_items !== null && r.n_items !== undefined ? fmt.integer(r.n_items) : '—'),
    },
    {
      key: 'triggered_by',
      header: 'Người kích hoạt',
      cell: (r) => r.triggered_by || 'Hệ thống (auto)',
    },
    {
      key: 'started_at',
      header: 'Bắt đầu lúc',
      cell: (r) => fmt.date(r.started_at, 'long'),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      align: 'right',
      cell: (r) => (
        <IconButton
          size="sm"
          label="Xem chi tiết"
          icon={<Eye size={15} />}
          onClick={() => void openDetail(r.run_id)}
        />
      ),
    },
  ];

  const subJobColumns: Column<BatchRunItem>[] = [
    {
      key: 'job',
      header: 'Job con',
      cell: (j) => <span style={{ fontWeight: 'var(--weight-semibold)' }}>{j.job}</span>,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (j) => <Badge tone={STATUS_TONES[j.status] || 'neutral'}>{j.status}</Badge>,
    },
    {
      key: 'duration',
      header: 'Thời lượng',
      align: 'right',
      cell: (j) => <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(j.duration_ms)}</span>,
    },
    {
      key: 'n_items',
      header: 'Số mục',
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
            <span>Lịch sử batch (Batch Runs)</span>
          </div>
        }
        description="Theo dõi chi tiết các tiến trình chạy nền J1–J6, tua đồng hồ mô phỏng và tái tối ưu chính sách tồn kho."
        actions={
          <Button
            variant="secondary"
            leftIcon={<RefreshCw size={15} />}
            onClick={() => setNonce((n) => n + 1)}
            loading={runsApi.loading}
          >
            Làm mới
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
              options={JOB_OPTIONS}
              aria-label="Lọc theo Job"
            />
          </div>
          <div style={{ minWidth: 180 }}>
            <Select<string>
              id="batch-status-filter"
              size="sm"
              value={selectedStatus}
              onChange={setSelectedStatus}
              options={STATUS_OPTIONS}
              aria-label="Lọc theo Trạng thái"
            />
          </div>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
            Kho: <strong>{storeId || 'CA_1'}</strong> · Tổng cộng: <strong>{runsApi.data?.total ?? 0}</strong> lần chạy
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
            <span>Chi tiết Batch Run #{detailRunId?.slice(0, 8)}</span>
          </div>
        }
        size="lg"
      >
        {detailLoading ? (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
            <p className="ui-muted">Đang tải thông tin batch run…</p>
          </div>
        ) : detailData ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
              <div className="ui-summary-item">
                <span className="ui-summary-item__label">Job chính</span>
                <span className="ui-summary-item__value">{detailData.job}</span>
              </div>
              <div className="ui-summary-item">
                <span className="ui-summary-item__label">Trạng thái</span>
                <span className="ui-summary-item__value">
                  <Badge tone={STATUS_TONES[detailData.status] || 'neutral'} dot>
                    {detailData.status}
                  </Badge>
                </span>
              </div>
              <div className="ui-summary-item">
                <span className="ui-summary-item__label">Thời lượng tổng</span>
                <span className="ui-summary-item__value" style={{ fontFamily: 'var(--font-mono)' }}>
                  {formatDuration(detailData.duration_ms)}
                </span>
              </div>
              <div className="ui-summary-item">
                <span className="ui-summary-item__label">Người thực hiện</span>
                <span className="ui-summary-item__value">{detailData.triggered_by || 'Simulator'}</span>
              </div>
            </div>

            {detailData.error && (
              <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--color-danger-subtle)', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)' }}>
                <strong>Lỗi tiến trình:</strong>
                <pre style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xs)', whiteSpace: 'pre-wrap' }}>
                  {detailData.error}
                </pre>
              </div>
            )}

            {detailData.totals_by_job && Object.keys(detailData.totals_by_job).length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 var(--space-2) 0', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
                  Tổng hợp thời lượng theo từng Job (E7)
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
                        {formatDuration(summary.duration_ms)} ({summary.count} lần)
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detailData.jobs && detailData.jobs.length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 var(--space-2) 0', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
                  Các bước thực thi con ({detailData.jobs.length} jobs)
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

