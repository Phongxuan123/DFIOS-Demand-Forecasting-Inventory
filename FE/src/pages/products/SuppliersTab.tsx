import React, { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { normalizeRole } from '../../auth/permissions.ts';
import { apiErrorMessage } from '../../services/apiClient.ts';
import { createSupplier, deleteSupplier, listSuppliers, updateSupplier, type Supplier } from '../../services/productsApi.ts';
import {
  Button,
  Card,
  DataSourceNote,
  IconButton,
  Input,
  Modal,
  SearchInput,
  Table,
  Unavailable,
  useConfirm,
  usePagination,
  useToast,
  type Column,
} from '../../components/ui/index.ts';

const EMPTY = { name: '', lead_time_days: '5', contact_name: '', email: '', phone: '', address: '' };

export const SuppliersTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { user } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const isAdmin = normalizeRole(user?.role) === 'ADMIN';
  const [search, setSearch] = useState('');
  const [nonce, setNonce] = useState(0);
  const [editing, setEditing] = useState<{ supplier?: Supplier } | null>(null);
  const pg = usePagination(25);

  const list = useApi(
    (signal) => listSuppliers({ skip: pg.offset, limit: pg.pageSize, search: search.trim() || undefined }, signal),
    [pg.offset, pg.pageSize, search, nonce],
  );

  const onDelete = async (s: Supplier) => {
    const ok = await confirm({ title: t('products.confirm.delete_supplier_title', { name: s.name }), tone: 'danger', confirmLabel: t('products.action.delete') });
    if (!ok) return;
    try {
      await deleteSupplier(s.id);
      toast.success(t('products.toast.deleted'));
      setNonce((n) => n + 1);
    } catch (err) {
      toast.error(t('products.toast.failed', { message: apiErrorMessage(err, t) }));
    }
  };

  const columns: Column<Supplier>[] = [
    { key: 'name', header: t('products.col.name'), cell: (r) => r.name },
    { key: 'lead', header: t('products.col.lead_time'), align: 'right', cell: (r) => fmt.integer(r.lead_time_days) },
    { key: 'contact', header: t('products.col.contact'), cell: (r) => r.contact_name ?? <Unavailable /> },
    { key: 'email', header: t('products.col.email'), cell: (r) => r.email ?? <Unavailable /> },
    { key: 'phone', header: t('products.col.phone'), cell: (r) => r.phone ?? <Unavailable /> },
    { key: 'address', header: t('products.col.address'), cell: (r) => r.address ?? <Unavailable /> },
    {
      key: 'actions',
      header: <span className="ui-sr-only">{t('products.col.actions')}</span>,
      align: 'right',
      cell: (r) => (
        <div className="prd-actions">
          <IconButton size="sm" label={isAdmin ? t('products.action.edit') : t('products.admin_only')} icon={<Pencil size={15} />} disabled={!isAdmin} onClick={() => setEditing({ supplier: r })} />
          <IconButton size="sm" label={isAdmin ? t('products.action.delete') : t('products.admin_only')} icon={<Trash2 size={15} />} disabled={!isAdmin} onClick={() => void onDelete(r)} />
        </div>
      ),
    },
  ];

  return (
    <>
      <Card
        flush
        actions={
          <Button leftIcon={<Plus size={16} />} onClick={() => setEditing({})} disabled={!isAdmin} title={!isAdmin ? t('products.admin_only') : undefined}>
            {t('products.action.add_supplier')}
          </Button>
        }
      >
        <div className="prd-pad">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              pg.setPage(1);
            }}
            placeholder={t('products.suppliers.search')}
          />
        </div>
        <Table
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey={(r) => r.id}
          loading={list.loading && !list.data}
          error={list.error}
          onRetry={list.refetch}
          filtered={!!search.trim()}
          dense
          pagination={{ page: pg.page, pageSize: pg.pageSize, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize, total: list.data?.total ?? 0 }}
        />
        <div className="prd-pad">
          <DataSourceNote source={t('products.suppliers.source')} />
        </div>
      </Card>
      <SupplierModal
        state={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setNonce((n) => n + 1);
        }}
      />
      {confirmDialog}
    </>
  );
};

const SupplierModal: React.FC<{ state: { supplier?: Supplier } | null; onClose: () => void; onSaved: () => void }> = ({ state, onClose, onSaved }) => {
  const t = useT();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const key = state ? (state.supplier?.id ?? 'new') : '';
  const [lastKey, setLastKey] = useState('');
  if (key !== lastKey) {
    setLastKey(key);
    setTouched(false);
    const s = state?.supplier;
    setForm(
      s
        ? { name: s.name, lead_time_days: String(s.lead_time_days), contact_name: s.contact_name ?? '', email: s.email ?? '', phone: s.phone ?? '', address: s.address ?? '' }
        : EMPTY,
    );
  }
  if (!state) return <Modal open={false} onClose={onClose} title="" />;

  const nameOk = form.name.trim().length > 0;
  const lt = Number(form.lead_time_days);
  const ltOk = /^\d+$/.test(form.lead_time_days.trim()) && lt >= 1 && lt <= 365;
  const save = async () => {
    setTouched(true);
    if (!nameOk || !ltOk) return;
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        lead_time_days: lt,
        contact_name: form.contact_name.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
      };
      if (state.supplier) await updateSupplier(state.supplier.id, body);
      else await createSupplier(body);
      toast.success(t('products.toast.saved'));
      onSaved();
    } catch (err) {
      toast.error(t('products.toast.failed', { message: apiErrorMessage(err, t) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving}
      title={state.supplier ? t('products.form.edit_supplier') : t('products.form.create_supplier')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t('common.actions.save')}
          </Button>
        </>
      }
    >
      <div className="prd-form-grid">
        <Input label={t('products.form.supplier_name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={touched && !nameOk ? t('products.form.required') : undefined} />
        <Input label={t('products.form.lead_time')} inputMode="numeric" value={form.lead_time_days} onChange={(e) => setForm({ ...form, lead_time_days: e.target.value })} error={touched && !ltOk ? t('products.form.lead_time_invalid') : undefined} />
        <Input label={t('products.form.contact')} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
        <Input label={t('products.form.email')} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label={t('products.form.phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <Input label={t('products.form.address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>
    </Modal>
  );
};
