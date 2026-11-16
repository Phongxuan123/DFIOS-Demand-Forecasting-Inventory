import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Alert, Button, Modal, Select, Tooltip, useToast } from '../../components/ui/index.ts';
import { useT } from '../../i18n/index.tsx';
import { apiErrorMessage } from '../../services/apiClient.ts';
import { recompute, type RecomputeResult } from '../../services/abcxyzApi.ts';

interface Props {
  storeId: string;
  allowed: boolean;
  onDone: (result: RecomputeResult) => void;
}

/** Recompute the classification of ONE store (Admin/Manager). Confirm, progress and error states in-app. */
export const RecomputeButton: React.FC<Props> = ({ storeId, allowed, onDone }) => {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<'auto' | 'thresholds'>('auto');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (running) return;
    setOpen(false);
    setError(null);
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await recompute(storeId, source);
      toast.success(t('abcxyz.recompute.done', { n: res.total_skus_classified, store: res.store_id ?? storeId }));
      setOpen(false);
      onDone(res);
    } catch (e) {
      setError(apiErrorMessage(e, t));
    } finally {
      setRunning(false);
    }
  };

  const button = (
    <Button variant="secondary" leftIcon={<RefreshCw size={16} />} disabled={!allowed} onClick={() => setOpen(true)}>
      {t('abcxyz.recompute.button')}
    </Button>
  );

  return (
    <>
      {allowed ? button : <Tooltip content={t('abcxyz.recompute.only_manager')}><span>{button}</span></Tooltip>}
      <Modal
        open={open}
        onClose={close}
        dismissible={!running}
        title={t('abcxyz.recompute.title', { store: storeId })}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={running}>
              {t('common.actions.cancel')}
            </Button>
            <Button variant="primary" loading={running} onClick={run}>
              {t('abcxyz.recompute.confirm')}
            </Button>
          </>
        }
      >
        <div className="ui-stack">
          <Alert tone="warning">{t('abcxyz.recompute.description', { store: storeId })}</Alert>
          <Select
            label={t('abcxyz.recompute.source_label')}
            value={source}
            onChange={setSource}
            disabled={running}
            options={[
              { value: 'auto', label: t('abcxyz.recompute.source_auto') },
              { value: 'thresholds', label: t('abcxyz.recompute.source_thresholds') },
            ]}
          />
          {running && <Alert tone="info">{t('abcxyz.recompute.running', { store: storeId })}</Alert>}
          {error && (
            <Alert tone="danger" title={t('abcxyz.recompute.failed')}>
              {error}
            </Alert>
          )}
        </div>
      </Modal>
    </>
  );
};
