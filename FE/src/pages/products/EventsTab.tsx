import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { normalizeRole } from '../../auth/permissions.ts';
import { apiErrorMessage } from '../../services/apiClient.ts';
import { createEvent, deleteEvent, listEventTypes, listEvents, type CalendarEvent } from '../../services/productsApi.ts';
import {
  Button,
  Card,
  DataSourceNote,
  IconButton,
  Input,
  Modal,
  SearchInput,
  Select,
  Table,
  Unavailable,
  useConfirm,
  usePagination,
  useToast,
  type Column,
} from '../../components/ui/index.ts';

export const EventsTab: React.FC = () => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { user } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const isAdmin = normalizeRole(user?.role) === 'ADMIN';
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [nonce, setNonce] = useState(0);
  const [adding, setAdding] = useState(false);
  const pg = usePagination(25);

  const types = useApi((s) => listEventTypes(s), []);
  const list = useApi(
    (signal) => listEvents({ skip: pg.offset, limit: pg.pageSize, event_type: type || undefined, search: search.trim() || undefined }, signal),
    [pg.offset, pg.pageSize, type, search, nonce],
  );

  const onDelete = async (ev: CalendarEvent) => {
    const ok = await confirm({ title: t('products.confirm.delete_event_title', { name: ev.event_name }), tone: 'danger', confirmLabel: t('products.action.delete') });
    if (!ok) return;
    try {
      await deleteEvent(ev.id);
      toast.success(t('products.toast.deleted'));
      setNonce((n) => n + 1);
    } catch (err) {
      toast.error(t('products.toast.failed', { message: apiErrorMessage(err, t) }));
    }
  };

  const columns: Column<CalendarEvent>[] = [
    { key: 'name', header: t('products.col.event'), cell: (r) => r.event_name },
    { key: 'date', header: t('products.col.event_date'), cell: (r) => fmt.date(r.event_date, 'medium') },
    { key: 'type', header: t('products.col.event_type'), cell: (r) => r.event_type ?? <Unavailable /> },
    {
      key: 'actions',
      header: <span className="ui-sr-only">{t('products.col.actions')}</span>,
      align: 'right',
      cell: (r) => (
        <div className="prd-actions">
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
          <Button leftIcon={<Plus size={16} />} onClick={() => setAdding(true)} disabled={!isAdmin} title={!isAdmin ? t('products.admin_only') : undefined}>
            {t('products.action.add_event')}
          </Button>
        }
      >
        <div className="prd-filters prd-filters--two" style={{ gridTemplateColumns: 'minmax(200px, 2fr) minmax(150px, 1fr)' }}>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              pg.setPage(1);
            }}
            placeholder={t('products.events.search')}
          />
          <Select
            aria-label={t('products.events.type')}
            value={type}
            onChange={(v) => {
              setType(v);
              pg.setPage(1);
            }}
            options={[{ value: '', label: t('products.events.all_types') }, ...(types.data ?? []).map((x) => ({ value: x, label: x }))]}
          />
        </div>
        <Table
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey={(r) => r.id}
          loading={list.loading && !list.data}
          error={list.error}
          onRetry={list.refetch}
          filtered={!!(type || search.trim())}
          dense
          pagination={{ page: pg.page, pageSize: pg.pageSize, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize, total: list.data?.total ?? 0 }}
        />
        <div className="prd-pad">
          <DataSourceNote source={t('products.events.source')} />
        </div>
      </Card>
      <EventModal
        open={adding}
        types={types.data ?? []}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          setNonce((n) => n + 1);
        }}
      />
      {confirmDialog}
    </>
  );
};

const EventModal: React.FC<{ open: boolean; types: string[]; onClose: () => void; onSaved: () => void }> = ({ open, types, onClose, onSaved }) => {
  const t = useT();
  const toast = useToast();
  const [form, setForm] = useState({ event_name: '', event_date: '', event_type: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm({ event_name: '', event_date: '', event_type: '' });
      setTouched(false);
    }
  }

  const nameOk = form.event_name.trim().length > 0;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(form.event_date);
  const save = async () => {
    setTouched(true);
    if (!nameOk || !dateOk) return;
    setSaving(true);
    try {
      // F-18: only event_name, event_date and event_type exist in the backend schema.
      await createEvent({ event_name: form.event_name.trim(), event_date: form.event_date, event_type: form.event_type || undefined });
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
      title={t('products.form.create_event')}
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
        <Input label={t('products.form.event_name')} value={form.event_name} onChange={(e) => setForm({ ...form, event_name: e.target.value })} error={touched && !nameOk ? t('products.form.required') : undefined} />
        <Input label={t('products.form.event_date')} type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} error={touched && !dateOk ? t('products.form.required') : undefined} />
        <Select
          label={t('products.form.event_type')}
          value={form.event_type}
          onChange={(v) => setForm({ ...form, event_type: v })}
          options={[{ value: '', label: '—' }, ...types.map((x) => ({ value: x, label: x }))]}
        />
      </div>
    </Modal>
  );
};
