/** API functions for the Products / Sales page (own module, uses apiClient directly). */
import apiClient, { getJson } from './apiClient.ts';

export interface Product {
  item_id: string;
  name: string;
  dept_id?: string | null;
  cat_id?: string | null;
  /** List rows only (null on single-item routes or when unknown). */
  price?: number | null;
  on_hand?: number | null;
  s?: number | null;
  S?: number | null;
}
export interface Paged<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}
export interface ProductQuery {
  page: number;
  page_size: number;
  q?: string;
  dept_id?: string;
  cat_id?: string;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  store_id?: string;
}
export interface Supplier {
  id: string;
  name: string;
  lead_time_days: number;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}
export interface InventoryRow {
  item_id: string;
  store_id: string;
  on_hand: number;
  on_order: number;
  updated_at?: string | null;
  product_name?: string | null;
}
export interface InventoryParam {
  item_id: string;
  store_id: string;
  service_level: number;
  lead_time_days: number;
  safety_stock: number;
  reorder_point: number;
  eoq: number;
  s?: number | null;
  S?: number | null;
  model_run_id?: string | null;
  source: string;
  updated_at?: string | null;
}
export interface Adjustment {
  id: string;
  item_id: string;
  store_id: string;
  old_on_hand: number;
  new_on_hand: number;
  old_on_order: number;
  new_on_order: number;
  reason?: string | null;
  adjusted_by?: string | null;
  created_at: string;
}
export interface SaleRecord {
  id?: string | null;
  item_id: string;
  store_id: string;
  sale_date: string;
  quantity: number;
}
export interface SalesPage extends Paged<SaleRecord> {
  total_quantity: number;
  average_quantity: number;
}
export interface SalesSummary {
  item_id?: string | null;
  store_id?: string | null;
  total_records: number;
  min_date?: string | null;
  max_date?: string | null;
  total_quantity: number;
}
export interface CalendarEvent {
  id: string;
  event_name: string;
  event_date: string;
  event_type?: string | null;
}
export interface RejectedRow {
  row: number;
  item_id?: string;
  reason: string;
}
export interface ImportResult {
  inserted?: number;
  updated?: number;
  rejected?: number;
  rejected_rows?: RejectedRow[];
  message?: string;
  quality_report?: { warnings?: string[]; date_format?: string };
}
export interface TemplateSpec {
  header: string[];
  required: string[];
  date_formats: string[];
  max_file_size_mb: number;
  notes?: string[];
}

export const listProducts = (p: ProductQuery, signal?: AbortSignal) => getJson<Paged<Product>>('/products', { params: p, signal });
export const listCategories = (signal?: AbortSignal) => getJson<string[]>('/products/categories', { signal });
export const listDepartments = (signal?: AbortSignal) => getJson<string[]>('/products/departments', { signal });
export const createProduct = (d: Product) => apiClient.post<Product>('/products', d).then((r) => r.data);
export const updateProduct = (id: string, d: { name?: string; dept_id?: string; cat_id?: string }) =>
  apiClient.put<Product>(`/products/${encodeURIComponent(id)}`, d).then((r) => r.data);
export const deleteProduct = (id: string) => apiClient.delete(`/products/${encodeURIComponent(id)}`);

export const listSuppliers = (params: { skip: number; limit: number; search?: string }, signal?: AbortSignal) =>
  getJson<Paged<Supplier>>('/suppliers', { params, signal });
export interface SupplierInput {
  name: string;
  lead_time_days: number;
  contact_name?: string;
  email?: string;
  phone?: string;
  address?: string;
}
export const createSupplier = (d: SupplierInput) => apiClient.post<Supplier>('/suppliers', d).then((r) => r.data);
export const updateSupplier = (id: string, d: Partial<SupplierInput>) =>
  apiClient.put<Supplier>(`/suppliers/${encodeURIComponent(id)}`, d).then((r) => r.data);
export const deleteSupplier = (id: string) => apiClient.delete(`/suppliers/${encodeURIComponent(id)}`);

export const getInventoryItem = (itemId: string, storeId: string, signal?: AbortSignal) =>
  getJson<InventoryRow>(`/inventory/${encodeURIComponent(itemId)}/${encodeURIComponent(storeId)}`, { signal });
export const updateInventory = (itemId: string, storeId: string, d: { on_hand?: number; on_order?: number; reason?: string }) =>
  apiClient.put<InventoryRow>(`/inventory/${encodeURIComponent(itemId)}/${encodeURIComponent(storeId)}`, d).then((r) => r.data);
/** s, S, EOQ, lead time as computed by the backend (Manager/Admin only). */
export const getInventoryParam = (itemId: string, storeId: string, signal?: AbortSignal) =>
  getJson<Paged<InventoryParam>>('/optimization/parameters', {
    params: { item_id: itemId, store_id: storeId, limit: 1 },
    signal,
  });
export const listAdjustments = (params: { skip: number; limit: number; item_id?: string; store_id?: string }, signal?: AbortSignal) =>
  getJson<Paged<Adjustment>>('/inventory/history', { params, signal });

export const querySales = (
  params: { skip: number; limit: number; item_id?: string; store_id?: string; start_date?: string; end_date?: string },
  signal?: AbortSignal,
) => getJson<SalesPage>('/sales', { params, signal });
export const salesSummary = (params: { item_id?: string; store_id?: string }, signal?: AbortSignal) =>
  getJson<SalesSummary>('/sales/summary', { params, signal });
export const createSale = (d: { item_id: string; store_id: string; sale_date: string; quantity: number }) =>
  apiClient.post<SaleRecord>('/sales', d).then((r) => r.data);

export const getImportTemplateSpec = (signal?: AbortSignal) =>
  getJson<TemplateSpec>('/imports/template', { params: { format: 'json' }, signal });

function saveBlob(blob: Blob, name: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
export async function downloadImportTemplate(): Promise<void> {
  const res = await apiClient.get('/imports/template', { params: { format: 'csv' }, responseType: 'blob', notifyForbidden: true });
  saveBlob(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }), 'template_store_import.csv');
}
export function importStoreCsv(file: File, storeId: string): Promise<ImportResult> {
  const fd = new FormData();
  fd.append('file', file);
  return apiClient
    .post<ImportResult>('/imports', fd, {
      params: { store_id: storeId },
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    .then((r) => r.data);
}

export const listEvents = (params: { skip: number; limit: number; event_type?: string; search?: string }, signal?: AbortSignal) =>
  getJson<Paged<CalendarEvent>>('/events-calendar', { params, signal });
export const listEventTypes = (signal?: AbortSignal) => getJson<string[]>('/events-calendar/types', { signal });
/** F-18: send only the fields the backend schema accepts. */
export const createEvent = (d: { event_name: string; event_date: string; event_type?: string }) =>
  apiClient
    .post<CalendarEvent>('/events-calendar', {
      event_name: d.event_name,
      event_date: d.event_date,
      ...(d.event_type ? { event_type: d.event_type } : {}),
    })
    .then((r) => r.data);
export const deleteEvent = (id: string) => apiClient.delete(`/events-calendar/${encodeURIComponent(id)}`);
