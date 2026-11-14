import React, { useState } from 'react';
import { Copy, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useStore } from '../../context/StoreContext.tsx';
import { useClock } from '../../context/ClockContext.tsx';
import { useApi } from '../../hooks/useApi.ts';
import { useFormat, useT } from '../../i18n/index.tsx';
import { can, normalizeRole } from '../../auth/permissions.ts';
import { apiErrorMessage, toApiError } from '../../services/apiClient.ts';
import {
  createProduct,
  deleteProduct,
  getInventoryItem,
  getInventoryParam,
  listCategories,
  listDepartments,
  listProducts,
  updateInventory,
  updateProduct,
  type Product,
} from '../../services/productsApi.ts';
import { emitAlertsSyncEvent } from '../../utils/alertTracker.ts';
import { kappaFromPolicy } from '../../utils/policyMath.ts';
import {
  Button,
  Card,
  DataSourceNote,
  Drawer,
  IconButton,
  Input,
  Modal,
  SearchInput,
  Select,
  Table,
  Unavailable,
  useConfirm,
  usePagination,
  useRowSelection,
  useToast,
  type Column,
  type SortState,
} from '../../components/ui/index.ts';

const SORT_MAP: Record<string, string> = { sku: 'item_id', name: 'name', dept: 'dept_id', cat: 'cat_id' };

export const ProductsTab: React.FC = () => {
  const t = useT();
  const toast = useToast();
  const { user } = useAuth();
  const { storeId } = useStore();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const isAdmin = normalizeRole(user?.role) === 'ADMIN';

  // Draft filters change freely; only the submitted ones hit the API (P-29).
  const [draft, setDraft] = useState({ q: '', dept: '', cat: '' });
  const [applied, setApplied] = useState({ q: '', dept: '', cat: '' });
  const [sort, setSort] = useState<SortState | null>(null);
  const [nonce, setNonce] = useState(0);
  const pg = usePagination(25);
  const sel = useRowSelection();
  const [inspect, setInspect] = useState<Product | null>(null);
  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; product?: Product } | null>(null);

  const depts = useApi((s) => listDepartments(s), []);
  const cats = useApi((s) => listCategories(s), []);
  const list = useApi(
    (signal) =>
      listProducts(
        {
          page: pg.page,
          page_size: pg.pageSize,
          q: applied.q.trim() || undefined,
          dept_id: applied.dept || undefined,
          cat_id: applied.cat || undefined,
          sort_by: sort ? SORT_MAP[sort.key] : undefined,
          sort_dir: sort?.dir,
        },
        signal,
      ),
    [pg.page, pg.pageSize, applied, sort, nonce],
  );

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setApplied(draft);
    pg.setPage(1);
  };
  const reset = () => {
    const empty = { q: '', dept: '', cat: '' };
    setDraft(empty);
    setApplied(empty);
    pg.setPage(1);
  };
  const filtered = !!(applied.q.trim() || applied.dept || applied.cat);

  const onDelete = async (p: Product) => {
    const ok = await confirm({
      title: t('products.confirm.delete_product_title', { sku: p.item_id }),
      description: t('products.confirm.delete_product_desc'),
      tone: 'danger',
      confirmLabel: t('products.action.delete'),
    });
    if (!ok) return;
    try {
      await deleteProduct(p.item_id);
      toast.success(t('products.toast.deleted'));
      sel.set(new Set([...sel.selected].filter((k) => k !== p.item_id)));
      setNonce((n) => n + 1);
    } catch (err) {
      toast.error(t('products.toast.failed', { message: apiErrorMessage(err, t) }));
    }
  };

  const copySelected = async () => {
    try {
      await navigator.clipboard.writeText([...sel.selected].join('\n'));
      toast.success(t('products.toast.saved'));
    } catch {
      toast.error(t('products.toast.failed', { message: t('common.errors.unknown') }));
    }
  };

  const columns: Column<Product>[] = [
    { key: 'sku', header: t('products.col.sku'), sortable: true, cell: (r) => <span className="prd-sku">{r.item_id}</span> },
    { key: 'name', header: t('products.col.name'), sortable: true, cell: (r) => r.name },
    { key: 'dept', header: t('products.col.dept'), sortable: true, cell: (r) => r.dept_id ?? <Unavailable /> },
    { key: 'cat', header: t('products.col.cat'), sortable: true, cell: (r) => r.cat_id ?? <Unavailable /> },
    {
      key: 'actions',
      header: <span className="ui-sr-only">{t('products.col.actions')}</span>,
      align: 'right',
      cell: (r) => (
        <div className="prd-actions" onClick={(e) => e.stopPropagation()}>
          <IconButton size="sm" label={t('products.action.inspect')} icon={<Eye size={15} />} onClick={() => setInspect(r)} />
          <IconButton size="sm" label={isAdmin ? t('products.action.edit') : t('products.admin_only')} icon={<Pencil size={15} />} disabled={!isAdmin} onClick={() => setEditing({ mode: 'edit', product: r })} />
          <IconButton size="sm" label={isAdmin ? t('products.action.delete') : t('products.admin_only')} icon={<Trash2 size={15} />} disabled={!isAdmin} onClick={() => void onDelete(r)} />
        </div>
      ),
    },
  ];

  return (
    <>
      <Card
        flush
        title={undefined}
        actions={
          <Button leftIcon={<Plus size={16} />} onClick={() => setEditing({ mode: 'create' })} disabled={!isAdmin} title={!isAdmin ? t('products.admin_only') : undefined}>
            {t('products.action.add_product')}
          </Button>
        }
      >
        <form className="prd-filters" onSubmit={submit}>
          <SearchInput value={draft.q} onChange={(v) => setDraft((d) => ({ ...d, q: v }))} delay={0} placeholder={t('products.list.search')} />
          <Select
            aria-label={t('products.list.dept')}
            value={draft.dept}
            onChange={(v) => setDraft((d) => ({ ...d, dept: v }))}
            options={[{ value: '', label: t('products.list.all_dept') }, ...(depts.data ?? []).map((d) => ({ value: d, label: d }))]}
          />
          <Select
            aria-label={t('products.list.cat')}
            value={draft.cat}
            onChange={(v) => setDraft((d) => ({ ...d, cat: v }))}
            options={[{ value: '', label: t('products.list.all_cat') }, ...(cats.data ?? []).map((c) => ({ value: c, label: c }))]}
          />
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
          rowKey={(r) => r.item_id}
          loading={list.loading && !list.data}
          error={list.error}
          onRetry={list.refetch}
          filtered={filtered}
          dense
          sort={sort}
          onSortChange={(s) => {
            setSort(s);
            pg.setPage(1);
          }}
          onRowClick={setInspect}
          pagination={{ page: pg.page, pageSize: pg.pageSize, onPageChange: pg.setPage, onPageSizeChange: pg.setPageSize, total: list.data?.total ?? 0 }}
          selection={{
            selected: sel.selected,
            onChange: sel.set,
            actions: (
              <Button size="sm" variant="secondary" leftIcon={<Copy size={14} />} onClick={() => void copySelected()}>
                {t('common.actions.copy')}
              </Button>
            ),
          }}
        />
        <div className="prd-pad">
          <DataSourceNote source={t('products.list.source')} />
        </div>
      </Card>

      <ProductDrawer key={inspect?.item_id ?? "none"} product={inspect} storeId={storeId} onClose={() => setInspect(null)} />
      <ProductFormModal
        state={editing}
        depts={depts.data ?? []}
        cats={cats.data ?? []}
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

/* ------------------------------- create / edit ------------------------------- */
const ProductFormModal: React.FC<{
  state: { mode: 'create' | 'edit'; product?: Product } | null;
  depts: string[];
  cats: string[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ state, depts, cats, onClose, onSaved }) => {
  const t = useT();
  const toast = useToast();
  const [form, setForm] = useState({ item_id: '', name: '', dept_id: '', cat_id: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const key = state ? `${state.mode}:${state.product?.item_id ?? ''}` : '';
  const [lastKey, setLastKey] = useState('');
  if (key !== lastKey) {
    setLastKey(key);
    setTouched(false);
    setForm({ item_id: state?.product?.item_id ?? '', name: state?.product?.name ?? '', dept_id: state?.product?.dept_id ?? '', cat_id: state?.product?.cat_id ?? '' });
  }
  if (!state) return <Modal open={false} onClose={onClose} title="" />;

  const skuOk = state.mode === 'edit' || form.item_id.trim().length > 0;
  const nameOk = form.name.trim().length > 0;
  const save = async () => {
    setTouched(true);
    if (!skuOk || !nameOk) return;
    setSaving(true);
    try {
      const body = { name: form.name.trim(), dept_id: form.dept_id.trim() || undefined, cat_id: form.cat_id.trim() || undefined };
      if (state.mode === 'edit') await updateProduct(state.product!.item_id, body);
      else await createProduct({ item_id: form.item_id.trim(), ...body });
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
      title={state.mode === 'edit' ? t('products.form.edit_product', { sku: state.product!.item_id }) : t('products.form.create_product')}
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
        <Input label={t('products.form.sku')} value={form.item_id} disabled={state.mode === 'edit'} onChange={(e) => setForm({ ...form, item_id: e.target.value })} error={touched && !skuOk ? t('products.form.required') : undefined} />
        <Input label={t('products.form.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={touched && !nameOk ? t('products.form.required') : undefined} />
        <Select
          label={t('products.form.dept')}
          value={form.dept_id}
          onChange={(v) => setForm({ ...form, dept_id: v })}
          options={[{ value: '', label: '—' }, ...depts.map((d) => ({ value: d, label: d }))]}
        />
        <Select
          label={t('products.form.cat')}
          value={form.cat_id}
          onChange={(v) => setForm({ ...form, cat_id: v })}
          options={[{ value: '', label: '—' }, ...cats.map((c) => ({ value: c, label: c }))]}
        />
      </div>
    </Modal>
  );
};

/* ------------------------------ SKU inspector ------------------------------ */
const ProductDrawer: React.FC<{ product: Product | null; storeId: string | null; onClose: () => void }> = ({ product, storeId, onClose }) => {
  const t = useT();
  const fmt = useFormat();
  const toast = useToast();
  const { user } = useAuth();
  const { version } = useClock();
  const canAdjust = can(user?.role, 'inventory:adjust');
  const [nonce, setNonce] = useState(0);
  const enabled = !!product && !!storeId;

  const inv = useApi((s) => getInventoryItem(product!.item_id, storeId!, s), [product?.item_id, storeId, version, nonce], { enabled });
  const params = useApi((s) => getInventoryParam(product!.item_id, storeId!, s), [product?.item_id, storeId, version, nonce], { enabled: enabled && canAdjust });
  const p = params.data?.items?.[0];
  const invMissing = inv.error && toApiError(inv.error).kind === 'not_found';

  const [form, setForm] = useState({ on_hand: '', on_order: '', reason: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const formKey = `${product?.item_id}:${storeId}:${inv.data?.updated_at ?? ''}:${inv.data?.on_hand}:${inv.data?.on_order}`;
  const [lastKey, setLastKey] = useState('');
  if (formKey !== lastKey) {
    setLastKey(formKey);
    setForm({ on_hand: inv.data ? String(inv.data.on_hand) : '', on_order: inv.data ? String(inv.data.on_order) : '', reason: '' });
    setTouched(false);
  }

  const num = (s: string) => (s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0 ? Number(s) : null);
  const onHandN = num(form.on_hand);
  const onOrderN = num(form.on_order);
  const reasonOk = form.reason.trim().length > 0;
  const changed = !!inv.data && (onHandN !== inv.data.on_hand || onOrderN !== inv.data.on_order);

  const save = async () => {
    setTouched(true);
    if (!product || !storeId || onHandN === null || onOrderN === null || !reasonOk || !changed) return;
    setSaving(true);
    try {
      await updateInventory(product.item_id, storeId, { on_hand: onHandN, on_order: onOrderN, reason: form.reason.trim() });
      toast.success(t('products.detail.stock_saved'));
      emitAlertsSyncEvent();
      setNonce((n) => n + 1);
    } catch (err) {
      toast.error(t('products.toast.failed', { message: apiErrorMessage(err, t) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={!!product} onClose={onClose} title={product ? t('products.detail.title', { sku: product.item_id }) : ''} description={product?.name}>
      {product && (
        <div className="ui-stack" style={{ gap: 'var(--space-4)' }}>
          <Card title={t('products.detail.inventory', { store: storeId ?? '—' })}>
            {!storeId ? (
              <Unavailable reason={t('products.no_store')} />
            ) : inv.loading && !inv.data ? (
              <p className="prd-note">{t('common.state.loading')}</p>
            ) : invMissing ? (
              <Unavailable reason={t('products.detail.inventory_unavailable')} />
            ) : inv.error ? (
              <p className="prd-note">{apiErrorMessage(inv.error, t)}</p>
            ) : (
              <dl className="prd-dl">
                <dt>{t('products.detail.on_hand')}</dt>
                <dd className="ui-num">{fmt.integer(inv.data?.on_hand)}</dd>
                <dt>{t('products.detail.on_order')}</dt>
                <dd className="ui-num">{fmt.integer(inv.data?.on_order)}</dd>
                <dt>{t('products.detail.updated')}</dt>
                <dd>{fmt.dateTime(inv.data?.updated_at)}</dd>
              </dl>
            )}
          </Card>

          <Card title={t('products.detail.params')}>
            {!canAdjust ? (
              <Unavailable reason={t('products.detail.params_no_permission')} />
            ) : params.loading && !params.data ? (
              <p className="prd-note">{t('common.state.loading')}</p>
            ) : params.error ? (
              <p className="prd-note">{apiErrorMessage(params.error, t)}</p>
            ) : !p ? (
              <Unavailable reason={t('products.detail.params_unavailable')} />
            ) : (
              <div className="ui-stack" style={{ gap: 'var(--space-3)' }}>
                <dl className="prd-dl">
                  <dt>{t('products.detail.s')}</dt>
                  <dd className="ui-num">{fmt.integer(p.s)}</dd>
                  <dt>{t('products.detail.S')}</dt>
                  <dd className="ui-num">{fmt.integer(p.S)}</dd>
                  <dt>{t('products.detail.eoq')}</dt>
                  <dd className="ui-num">{fmt.integer(p.eoq)}</dd>
                  <dt>{t('products.detail.kappa')}</dt>
                  <dd className="ui-num">{fmt.number(kappaFromPolicy(p.s, p.S, p.eoq), { digits: 2 })}</dd>
                  <dt>{t('products.detail.lead_time')}</dt>
                  <dd className="ui-num">{t('products.detail.lead_time_value', { days: fmt.integer(p.lead_time_days) })}</dd>
                  <dt>{t('products.detail.service_level')}</dt>
                  <dd className="ui-num">{fmt.percent(p.service_level)}</dd>
                  <dt>{t('products.detail.safety_stock')}</dt>
                  <dd className="ui-num">{fmt.integer(p.safety_stock)}</dd>
                  <dt>{t('products.detail.rop')}</dt>
                  <dd className="ui-num">{fmt.integer(p.reorder_point)}</dd>
                  <dt>{t('products.detail.source')}</dt>
                  <dd>{p.source}</dd>
                  <dt>{t('products.detail.model_run')}</dt>
                  <dd className="prd-sku">{p.model_run_id ?? <Unavailable />}</dd>
                </dl>
                <DataSourceNote source={t('products.detail.params_source')} asOf={p.updated_at ? fmt.date(p.updated_at, 'medium') : undefined} />
              </div>
            )}
          </Card>

          {canAdjust && storeId && inv.data && (
            <Card title={t('products.detail.adjust_title')}>
              <div className="ui-stack" style={{ gap: 'var(--space-3)' }}>
                <div className="prd-form-grid">
                  <Input label={t('products.detail.new_on_hand')} inputMode="decimal" value={form.on_hand} onChange={(e) => setForm({ ...form, on_hand: e.target.value })} error={touched && onHandN === null ? t('products.detail.number_invalid') : undefined} />
                  <Input label={t('products.detail.new_on_order')} inputMode="decimal" value={form.on_order} onChange={(e) => setForm({ ...form, on_order: e.target.value })} error={touched && onOrderN === null ? t('products.detail.number_invalid') : undefined} />
                </div>
                <Input label={t('products.detail.reason')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={touched && !reasonOk ? t('products.detail.reason_required') : undefined} />
                <Button onClick={() => void save()} loading={saving} disabled={!changed} title={!changed ? t('products.detail.no_change') : undefined}>
                  {t('products.detail.save_stock')}
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </Drawer>
  );
};
