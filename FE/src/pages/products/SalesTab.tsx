import React, { useRef, useState } from 'react';
import { Download, Plus, Upload } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useStore } from '../../context/StoreContext.tsx';
import { useClock } from '../../context/ClockContext.tsx';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { can, normalizeRole } from '../../auth/permissions.ts';
import { apiErrorMessage } from '../../services/apiClient.ts';
import {
  createSale,
  downloadImportTemplate,
  getImportTemplateSpec,
  importStoreCsv,
  querySales,
  salesSummary,
  type ImportResult,
  type SaleRecord,
} from '../../services/productsApi.ts';
import { emitAlertsSyncEvent } from '../../utils/alertTracker.ts';
import {
  Alert,
  Button,
  Card,
  DataSourceNote,
  Input,
  KpiTile,
  Modal,
  Table,
  usePagination,
  useToast,
  type Column,
} from '../../components/ui/index.ts';

const EMPTY = { sku: '', from: '', to: '' };
const MAX_REJECTED_SHOWN = 100;

export const SalesTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const { user } = useAuth();
  const { storeId } = useStore();
  const { version } = useClock();
  const isAdmin = normalizeRole(user?.role) === 'ADMIN';
  const canImport = can(user?.role, 'inventory:adjust'); // POST /imports is Manager/Admin
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [nonce, setNonce] = useState(0);
  const [adding, setAdding] = useState(false);
  const pg = usePagination(25);

  const list = useApi(
    (signal) =>
      querySales(
        {
          skip: pg.offset,
          limit: pg.pageSize,
          store_id: storeId ?? undefined,
          item_id: applied.sku.trim() || undefined,
          start_date: applied.from || undefined,
          end_date: applied.to || undefined,
        },
        signal,
      ),
    [pg.offset, pg.pageSize, storeId, applied, version, nonce],
    { enabled: !!storeId },
  );
  const summary = useApi(
    (signal) => salesSummary({ store_id: storeId ?? undefined, item_id: applied.sku.trim() || undefined }, signal),
    [storeId, applied.sku, version, nonce],
    { enabled: !!storeId },
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setApplied(draft);
    pg.setPage(1);
  };
  const reset = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    pg.setPage(1);
  };
  const filtered = !!(applied.sku.trim() || applied.from || applied.to);
  const s = summary.data;

  const columns: Column<SaleRecord>[] = [
    { key: 'date', header: t('products.col.date'), cell: (r) => fmt.date(r.sale_date, 'medium') },
    { key: 'sku', header: t('products.col.sku'), cell: (r) => <span className="prd-sku">{r.item_id}</span> },
    { key: 'store', header: t('products.col.store'), cell: (r) => r.store_id },
    { key: 'qty', header: t('products.col.quantity'), align: 'right', cell: (r) => fmt.number(r.quantity, { digits: 2 }) },
  ];

  return (
    <div className="ui-stack">
      <div className="ui-grid ui-grid--kpi">
        <KpiTile
          label={t('products.sales.kpi_records')}
          value={s ? fmt.integer(s.total_records) : null}
          loading={summary.loading && !s}
          unavailableReason={summary.error ? t('products.sales.summary_unavailable') : undefined}
        />
        <KpiTile
          label={t('products.sales.kpi_total')}
          value={s ? fmt.integer(s.total_quantity) : null}
          loading={summary.loading && !s}
          unavailableReason={summary.error ? t('products.sales.summary_unavailable') : undefined}
        />
        <KpiTile
          label={t('products.sales.kpi_avg')}
          value={list.data ? fmt.number(list.data.average_quantity, { digits: 2 }) : null}
          loading={list.loading && !list.data}
          unavailableReason={list.error ? t('common.state.error_title') : undefined}
        />
        <KpiTile
          label={t('products.sales.kpi_range')}
          value={s && s.min_date && s.max_date ? t('products.sales.range_value', { from: fmt.date(s.min_date, 'short'), to: fmt.date(s.max_date, 'short') }) : null}
          loading={summary.loading && !s}
          unavailableReason={summary.error ? t('products.sales.summary_unavailable') : undefined}
        />
      </div>

      <Card
        flush
        actions={
          <Button leftIcon={<Plus size={16} />} onClick={() => setAdding(true)} disabled={!isAdmin || !storeId} title={!isAdmin ? t('products.admin_only') : undefined}>
            {t('products.action.add_sale')}
          </Button>
        }
      >
        <form className="prd-filters prd-filters--sales" onSubmit={submit}>
          <Input label={t('products.sales.filter_sku')} value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} />
          <Input label={t('products.sales.from')} type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <Input label={t('products.sales.to')} type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <div className="prd-filters__buttons">
            <Button type="submit">{t('products.list.apply')}</Button>
            <Button type="button" variant="secondary" onClick={reset}>
              {t('products.list.reset')}
            </Button>
          </div>
        </form>
        <Table
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey={(r) => r.id ?? `${r.item_id}|${r.store_id}|${r.sale_date}`}
          loading={list.loading && !list.data}
          error={list.error}
          onRetry={list.refetch}
          filtered={filtered}
          dense
          pagination={{ page: pg.page, pageSize: pg.pageSize, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize, total: list.data?.total ?? 0 }}
        />
        <div className="prd-pad">
          <DataSourceNote source={t('products.sales.source', { store: storeId ?? '—' })} />
        </div>
      </Card>

      {canImport && <ImportCard storeId={storeId} onDone={() => setNonce((n) => n + 1)} />}

      <SaleModal
        open={adding}
        storeId={storeId}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          setNonce((n) => n + 1);
        }}
      />
    </div>
  );
};

/* ------------------------------- CSV import ------------------------------- */
const ImportCard: React.FC<{ storeId: string | null; onDone: () => void }> = ({ storeId, onDone }) => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const spec = useApi((s) => getImportTemplateSpec(s), []);

  const upload = async () => {
    if (!file || !storeId) return;
    setUploading(true);
    setResult(null);
    setError(null);
    try {
      const res = await importStoreCsv(file, storeId);
      setResult(res);
      if ((res.inserted ?? 0) + (res.updated ?? 0) > 0) {
        emitAlertsSyncEvent();
        onDone();
      }
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setUploading(false);
    }
  };

  const download = async () => {
    try {
      await downloadImportTemplate();
    } catch (err) {
      toast.error(t('products.toast.failed', { message: apiErrorMessage(err, t) }));
    }
  };

  const inserted = result?.inserted ?? 0;
  const updated = result?.updated ?? 0;
  const rejected = result?.rejected ?? 0;
  const written = inserted + updated;
  const rejectedRows = result?.rejected_rows ?? [];
  // Never claim success when any row was rejected (R-38).
  const tone = !result ? 'info' : written === 0 ? 'danger' : rejected > 0 ? 'warning' : 'success';
  const title = written === 0 ? t('products.sales.result_title_none') : rejected > 0 ? t('products.sales.result_title_partial') : t('products.sales.result_title_ok');
  const warnings = result?.quality_report?.warnings ?? [];

  return (
    <Card title={t('products.sales.import_title')} description={t('products.sales.import_desc', { store: storeId ?? '—' })}>
      <div className="ui-stack" style={{ gap: 'var(--space-3)' }}>
        {spec.data ? (
          <p className="prd-note">
            {t('products.sales.template_cols', {
              cols: spec.data.required.join(', '),
              dates: spec.data.date_formats.join(', '),
              mb: fmt.integer(spec.data.max_file_size_mb),
            })}
          </p>
        ) : spec.error ? (
          <p className="prd-note">{t('products.sales.template_unavailable')}</p>
        ) : null}
        <div className="prd-file">
          <Button variant="secondary" leftIcon={<Download size={16} />} onClick={() => void download()}>
            {t('products.sales.download_template')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="ui-sr-only"
            id="sales-csv-input"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            {t('products.sales.choose_file')}
          </Button>
          <span className="prd-file__name">{file ? file.name : t('products.sales.no_file')}</span>
          <Button leftIcon={<Upload size={16} />} onClick={() => void upload()} disabled={!file || !storeId} loading={uploading}>
            {t('products.sales.upload')}
          </Button>
        </div>

        {error && <Alert tone="danger">{error}</Alert>}
        {result && (
          <Alert tone={tone} title={title}>
            <div>{t('products.sales.result_summary', { inserted: fmt.integer(inserted), updated: fmt.integer(updated), rejected: fmt.integer(rejected) })}</div>
            {warnings.length > 0 && <div>{t('products.sales.warnings', { text: warnings.join('; ') })}</div>}
            {rejectedRows.length > 0 && (
              <>
                <div>{t('products.sales.rejected_heading', { shown: Math.min(rejectedRows.length, MAX_REJECTED_SHOWN) })}</div>
                <ul className="prd-rejected">
                  {rejectedRows.slice(0, MAX_REJECTED_SHOWN).map((r, i) => (
                    <li key={`${r.row}-${i}`}>{t('products.sales.rejected_row', { row: r.row, sku: r.item_id ? ` (${r.item_id})` : '', reason: r.reason })}</li>
                  ))}
                </ul>
              </>
            )}
          </Alert>
        )}
      </div>
    </Card>
  );
};

/* -------------------------------- add a sale -------------------------------- */
const SaleModal: React.FC<{ open: boolean; storeId: string | null; onClose: () => void; onSaved: () => void }> = ({ open, storeId, onClose, onSaved }) => {
  const t = useT();
  const toast = useToast();
  const [form, setForm] = useState({ item_id: '', sale_date: '', quantity: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm({ item_id: '', sale_date: '', quantity: '' });
      setTouched(false);
    }
  }
  const skuOk = form.item_id.trim().length > 0;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(form.sale_date);
  const qty = Number(form.quantity);
  const qtyOk = form.quantity.trim() !== '' && Number.isFinite(qty) && qty >= 0;

  const save = async () => {
    setTouched(true);
    if (!skuOk || !dateOk || !qtyOk || !storeId) return;
    setSaving(true);
    try {
      await createSale({ item_id: form.item_id.trim(), store_id: storeId, sale_date: form.sale_date, quantity: qty });
      emitAlertsSyncEvent();
      toast.success(t('products.toast.created'));
      onSaved();
    } catch (err) {
      toast.error(t('products.toast.failed', { message: apiErrorMessage(err, t) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!saving}
      size="sm"
      title={t('products.form.create_sale')}
      description={t('products.form.sale_store_note', { store: storeId ?? '—' })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t('common.actions.create')}
          </Button>
        </>
      }
    >
      <div className="ui-stack" style={{ gap: 'var(--space-3)' }}>
        <Input label={t('products.form.sku')} value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })} error={touched && !skuOk ? t('products.form.required') : undefined} />
        <Input label={t('products.form.sale_date')} type="date" value={form.sale_date} onChange={(e) => setForm({ ...form, sale_date: e.target.value })} error={touched && !dateOk ? t('products.form.required') : undefined} />
        <Input label={t('products.form.sale_qty')} inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} error={touched && !qtyOk ? t('products.form.sale_qty_invalid') : undefined} />
      </div>
    </Modal>
  );
};
