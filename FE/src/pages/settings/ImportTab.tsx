import React, { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Alert, Badge, Button, Card, DataSourceNote, KpiTile, Select, Table, useToast, type Column } from '../../components/ui/index.ts';
import { useStore } from '../../context/StoreContext.tsx';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { apiErrorMessage } from '../../services/apiClient.ts';
import { downloadImportTemplate, getImportTemplate, uploadImport, type ImportResult, type RejectedRow, type TemplateColumn } from '../../services/settingsApi.ts';

const FALLBACK_MAX_MB = 50;

export const ImportTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { storeId, stores } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [store, setStore] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const tpl = useApi((s) => getImportTemplate(s), []);
  const target = store || storeId || '';
  const maxMb = tpl.data?.max_file_size_mb ?? FALLBACK_MAX_MB;

  const pick = (f: File | null) => {
    setResult(null);
    setUploadError(null);
    if (!f) {
      setFile(null);
      setFileError(null);
      return;
    }
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setFile(null);
      setFileError(t('settings.import.not_csv'));
      return;
    }
    if (f.size > maxMb * 1024 * 1024) {
      setFile(null);
      setFileError(t('settings.import.too_big', { mb: maxMb }));
      return;
    }
    setFileError(null);
    setFile(f);
  };

  const download = async () => {
    try {
      const blob = await downloadImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = tpl.data?.file_name ?? 'template_store_import.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(t('settings.import.template_failed'), apiErrorMessage(e, t));
    }
  };

  const upload = async () => {
    if (!file || !target) return;
    setUploading(true);
    setUploadError(null);
    setResult(null);
    try {
      const res = await uploadImport(target, file);
      setResult(res);
      const rej = res.rejected ?? res.skipped_count ?? 0;
      if (rej > 0) toast.warning(t('settings.import.outcome_partial', { rejected: fmt.integer(rej) }));
      else toast.success(t('settings.import.outcome_ok'));
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setUploadError(apiErrorMessage(e, t));
    } finally {
      setUploading(false);
    }
  };

  const colColumns: Column<TemplateColumn>[] = [
    { key: 'name', header: t('settings.import.col_name'), cell: (c) => <code>{c.name}</code> },
    { key: 'required', header: t('settings.import.col_required'), cell: (c) => <Badge tone={c.required ? 'accent' : 'neutral'}>{t(c.required ? 'settings.import.required_yes' : 'settings.import.required_no')}</Badge>, width: 110 },
    { key: 'type', header: t('settings.import.col_type'), value: (c) => c.type, width: 90 },
    { key: 'description', header: t('settings.import.col_description'), cell: (c) => <span className="set-wrap">{c.description}</span> },
    { key: 'example', header: t('settings.import.col_example'), cell: (c) => <code>{c.example}</code> },
  ];

  const rejCols: Column<RejectedRow>[] = [
    { key: 'row', header: t('settings.import.rej_row'), align: 'right', cell: (r) => fmt.integer(r.row), width: 80 },
    { key: 'sku', header: t('settings.import.rej_sku'), value: (r) => r.item_id, width: 160 },
    { key: 'reason', header: t('settings.import.rej_reason'), cell: (r) => <span className="set-wrap">{r.reason}</span> },
  ];

  const rejected = result ? (result.rejected ?? result.skipped_count ?? 0) : 0;
  const inserted = result ? (result.inserted ?? null) : null;
  const updated = result ? (result.updated ?? null) : null;
  // R-38: when the BE only reports a total (imported_count), show it as "inserted" instead of an empty tile.
  const onlyTotal = result && inserted === null && updated === null && typeof result.imported_count === 'number' ? result.imported_count : null;
  const imported = (inserted ?? 0) + (updated ?? 0) + (onlyTotal ?? 0);
  const rows: RejectedRow[] = result?.rejected_rows ?? (result?.quality_report?.rejected_rows as RejectedRow[] | undefined) ?? [];
  const warnings = result?.quality_report?.warnings ?? [];

  return (
    <div className="ui-stack">
      <Card title={t('settings.import.title')} description={t('settings.import.description')}>
        <div className="ui-stack">
          <Alert tone="info">{t('settings.import.date_note')}</Alert>
          <div className="set-fields">
            <Select label={t('settings.import.store')} hint={t('settings.import.store_hint')} value={target} onChange={setStore} options={stores.map((s) => ({ value: s, label: s }))} disabled={uploading} />
            <div>
              <label className="set-label" htmlFor="import-file">
                {t('settings.import.file')}
              </label>
              <input id="import-file" ref={fileRef} className="set-file" type="file" accept=".csv,text/csv" disabled={uploading} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
              {fileError && <p className="set-error">{fileError}</p>}
              <p className="set-note">{t('settings.import.max_size', { mb: maxMb })}</p>
            </div>
          </div>
          <div className="ui-row">
            <Button variant="primary" leftIcon={<Upload size={16} />} loading={uploading} disabled={!file || !target} onClick={upload}>
              {t('settings.import.upload')}
            </Button>
            <Button variant="secondary" leftIcon={<Download size={16} />} onClick={download}>
              {t('settings.import.template_download')}
            </Button>
          </div>
          {uploading && <Alert tone="info">{t('settings.import.uploading')}</Alert>}
          {uploadError && (
            <Alert tone="danger" title={t('settings.import.failed')}>
              {uploadError}
            </Alert>
          )}
        </div>
      </Card>

      {result && (
        <Card title={t('settings.import.result_title', { file: result.file_name ?? file?.name ?? '' })}>
          <div className="ui-stack">
            {rejected === 0 ? (
              <Alert tone="success">{t('settings.import.outcome_ok')}</Alert>
            ) : imported > 0 ? (
              <Alert tone="warning">{t('settings.import.outcome_partial', { rejected: fmt.integer(rejected) })}</Alert>
            ) : (
              <Alert tone="danger">{t('settings.import.outcome_none', { rejected: fmt.integer(rejected) })}</Alert>
            )}
            <div className="ui-grid ui-grid--kpi">
              <KpiTile label={t('settings.import.inserted')} value={inserted !== null ? fmt.integer(inserted) : onlyTotal !== null ? fmt.integer(onlyTotal) : null} unavailableReason="—" />
              <KpiTile label={t('settings.import.updated')} value={updated === null ? null : fmt.integer(updated)} unavailableReason="—" />
              <KpiTile label={t('settings.import.rejected')} value={fmt.integer(rejected)} />
            </div>
            {result.quality_report?.date_format && <p className="set-note">{t('settings.import.date_format_detected', { format: result.quality_report.date_format })}</p>}
            {warnings.length > 0 && (
              <Alert tone="warning" title={t('settings.import.warnings')}>
                <ul className="set-hints">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {rows.length > 0 && (
              <div>
                <div className="set-label">{t('settings.import.rejected_title')}</div>
                <Table columns={rejCols} rows={rows} rowKey={(r) => `${r.row}-${r.item_id ?? ''}-${r.reason}`} dense maxHeight={320} />
                {rejected > rows.length && <p className="set-note">{t('settings.import.rejected_sample', { n: rows.length, total: fmt.integer(rejected) })}</p>}
              </div>
            )}
          </div>
        </Card>
      )}

      <Card title={t('settings.import.template_title')} flush>
        <Table columns={colColumns} rows={tpl.data?.columns ?? []} rowKey={(c) => c.name} loading={tpl.loading} error={tpl.error} onRetry={tpl.refetch} dense wrap />
        <div className="set-pad">
          {(tpl.data?.notes ?? []).map((n) => (
            <p key={n} className="set-note">
              {n}
            </p>
          ))}
          <DataSourceNote source={t('settings.import.source')} />
        </div>
      </Card>
    </div>
  );
};
