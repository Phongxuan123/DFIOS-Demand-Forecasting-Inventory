import React, { useState } from 'react';
import { GitBranch, RefreshCw, Cpu, RotateCcw } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  PageHeader,
  Select,
  Table,
  useConfirm,
  useToast,
  type Column,
} from '../components/ui/index.ts';
import { useApi } from '../hooks/useApi.ts';
import { useStore } from '../context/StoreContext.tsx';
import { useClock } from '../context/ClockContext.tsx';
import { useFormat } from '../i18n/index.tsx';
import {
  activateForecastSource,
  getForecastSources,
  type ModelActivationLog,
} from '../services/forecastSourcesApi.ts';

export const ModelVersions: React.FC = () => {
  const fmt = useFormat();
  const toast = useToast();
  const { concreteStoreId: storeId } = useStore();
  const clock = useClock();
  const { confirm, dialog } = useConfirm();

  const [selectedModel, setSelectedModel] = useState<string>('');
  const [activating, setActivating] = useState<boolean>(false);
  const [nonce, setNonce] = useState(0);

  const sourcesApi = useApi(
    (signal) => getForecastSources(storeId || 'CA_1', signal),
    [storeId, clock.version, nonce],
  );

  const activeModel = sourcesApi.data?.active_model || '—';
  const availableModels = sourcesApi.data?.available_models ?? [];
  const activations = sourcesApi.data?.activations ?? [];
  const latestActivation = activations[0] ?? null;

  const handleActivate = async (modelToActivate: string) => {
    if (!modelToActivate) return;
    const ok = await confirm({
      title: `Kích hoạt mô hình ${modelToActivate}?`,
      description: `Áp dụng mô hình ${modelToActivate} từ kỳ review kế tiếp trở đi cho kho ${storeId || 'CA_1'}. Các quyết định trong quá khứ giữ nguyên để đảm bảo tính nhân quả (causality).`,
      confirmLabel: `Kích hoạt ${modelToActivate}`,
    });
    if (!ok) return;

    setActivating(true);
    try {
      const res = await activateForecastSource({
        store_id: storeId || 'CA_1',
        model: modelToActivate,
      });
      toast.success(
        `Đã kích hoạt mô hình ${res.model}`,
        `Áp dụng từ kỳ review ${fmt.date(res.from_date)}: cập nhật ${fmt.integer(res.n_rows)} dòng quantile.`,
      );
      setSelectedModel('');
      clock.refresh();
      setNonce((n) => n + 1);
    } catch (err: any) {
      toast.error('Không thể kích hoạt mô hình', err?.message || String(err));
    } finally {
      setActivating(false);
    }
  };

  const handleRollback = async () => {
    if (!latestActivation?.previous_model) return;
    const prev = latestActivation.previous_model;
    const ok = await confirm({
      title: `Quay lại mô hình ${prev}?`,
      description: `Quay lại mô hình nguồn ${prev} cho các kỳ review sắp tới (tương đương kích hoạt lại ${prev}).`,
      confirmLabel: `Quay lại ${prev}`,
    });
    if (!ok) return;
    await handleActivate(prev);
  };

  const modelOptions = availableModels.map((m) => ({
    value: m.model,
    label: `${m.model} (${m.n_origins} origins, ${m.first_origin} → ${m.last_origin})`,
  }));

  const logColumns: Column<ModelActivationLog>[] = [
    {
      key: 'model',
      header: 'Mô hình kích hoạt',
      cell: (r, idx) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 'var(--weight-semibold)', fontFamily: 'var(--font-mono)' }}>
            {r.model}
          </span>
          {idx === 0 && <Badge tone="success">Hiện tại</Badge>}
        </div>
      ),
    },
    {
      key: 'previous_model',
      header: 'Mô hình trước',
      cell: (r) => (
        <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
          {r.previous_model || '—'}
        </span>
      ),
    },
    {
      key: 'from_date',
      header: 'Áp dụng từ kỳ',
      cell: (r) => fmt.date(r.from_date),
    },
    {
      key: 'n_origins',
      header: 'Số kỳ review',
      align: 'right',
      cell: (r) => fmt.integer(r.n_origins),
    },
    {
      key: 'n_rows',
      header: 'Số dòng quantile',
      align: 'right',
      cell: (r) => fmt.integer(r.n_rows),
    },
    {
      key: 'activated_by',
      header: 'Người kích hoạt',
      cell: (r) => r.activated_by || 'Admin',
    },
    {
      key: 'activated_at',
      header: 'Thời gian',
      cell: (r) => fmt.date(r.activated_at, 'long'),
    },
  ];

  return (
    <div className="ui-stack">
      <PageHeader
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <GitBranch size={22} />
            <span>Phiên bản mô hình (Model Versions)</span>
          </div>
        }
        description="Quản lý và kích hoạt mô hình nguồn cho phân phối quantile cửa sổ L+R (Route c). Hỗ trợ kịch bản kiểm thử suy thoái mô hình (E9c) và Rollback tức thì."
        actions={
          <Button
            variant="secondary"
            leftIcon={<RefreshCw size={15} />}
            onClick={() => setNonce((n) => n + 1)}
            loading={sourcesApi.loading}
          >
            Làm mới
          </Button>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
        <Card title="Mô hình nguồn đang phục vụ">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-accent-subtle)',
                  color: 'var(--color-accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Cpu size={24} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', fontFamily: 'var(--font-mono)' }}>
                  {activeModel}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  Mô hình quantile phục vụ kỳ review tiếp theo
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-3)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', fontSize: 'var(--text-xs)' }}>
              <div>
                <span className="ui-muted">Kho: </span>
                <strong>{storeId || 'CA_1'}</strong>
              </div>
              <div>
                <span className="ui-muted">Cửa sổ (L+R): </span>
                <strong>{sourcesApi.data?.horizon_days ?? 10} ngày</strong>
              </div>
              <div>
                <span className="ui-muted">Ngày mô phỏng: </span>
                <strong>{sourcesApi.data?.clock_date ? fmt.date(sourcesApi.data.clock_date) : '—'}</strong>
              </div>
              <div>
                <span className="ui-muted">Mô hình có sẵn: </span>
                <strong>{availableModels.length} mô hình</strong>
              </div>
            </div>

            {latestActivation?.previous_model && (
              <div style={{ paddingTop: 'var(--space-2)' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<RotateCcw size={14} />}
                  onClick={() => void handleRollback()}
                  loading={activating}
                >
                  Quay lại {latestActivation.previous_model} (Rollback)
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card title="Kích hoạt mô hình mới">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
              Chọn mô hình nguồn để sao chép quantile vào chuỗi dự báo cho các kỳ review sắp tới:
            </p>

            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <Select<string>
                  id="model-source-select"
                  size="sm"
                  value={selectedModel}
                  onChange={setSelectedModel}
                  options={[
                    { value: '', label: '-- Chọn mô hình nguồn --' },
                    ...modelOptions,
                  ]}
                  disabled={activating}
                  aria-label="Chọn mô hình nguồn"
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleActivate(selectedModel)}
                disabled={!selectedModel || selectedModel === activeModel}
                loading={activating}
              >
                Kích hoạt
              </Button>
            </div>

            <div style={{ padding: 'var(--space-2)', backgroundColor: 'var(--color-surface-subtle)', borderRadius: 'var(--radius-sm)', fontSize: '11px', color: 'var(--color-text-muted)' }}>
              💡 <strong>Lưu ý:</strong> Khi kích hoạt, chỉ các kỳ review sau ngày hiện tại mới dùng mô hình mới. Các kỳ review đã qua giữ nguyên lịch sử tính toán để đảm bảo tính nhân quả.
            </div>
          </div>
        </Card>
      </div>

      <Card title="Lịch sử kích hoạt mô hình (Activation Log)">
        {activations.length === 0 ? (
          <div style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
            <p className="ui-muted">Chưa có lượt chuyển đổi mô hình nào.</p>
          </div>
        ) : (
          <Table
            columns={logColumns}
            rows={activations}
            rowKey={(r) => `${r.model}_${r.activated_at}`}
            loading={sourcesApi.loading}
          />
        )}
      </Card>

      {dialog}
    </div>
  );
};
