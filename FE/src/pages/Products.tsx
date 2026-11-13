import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Upload,
  Plus,
  ChevronRight,
  Trash2,
  Edit,
  Check,
  AlertCircle,
  X,
  ExternalLink,
  Package,
  Activity,
  Sparkles,
  Store as StoreIcon,
  Radio,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useLanguage } from '../context/LanguageContext.tsx';
import { api } from '../services/api.ts';
import { Pagination } from '../components/ui/Pagination.tsx';
import { emitAlertsSyncEvent } from '../utils/alertTracker.ts';
import { resolveEffectiveRssMetrics } from '../utils/dfiosAnalytics.ts';
import './Products.css';

export type DemandRegimeType = 'SMOOTH' | 'INTERMITTENT' | 'COLD_START';

export interface SkuRssMetrics {
  onHand: number;
  onOrder: number;
  ip: number;
  ss: number;
  rop_s: number;
  eoq: number;
  kappa: number;
  orderUpTo_S: number;
  orderQty_q: number;
  reviewDays_R: number;
  leadTime_L: number;
  adi: number;
  historyDays: number;
  regime: DemandRegimeType;
  abcClass: string;
  unitPrice: number | null;
  modelRunId: string | null;
}

const hashCode = (str: string): number => {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

export const Products: React.FC = () => {
  const { user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const isVi = language === 'vi';
  const role = user?.role?.toUpperCase() || 'VIEWER';
  const canEdit = role === 'ADMIN' || role === 'WAREHOUSE MANAGER' || role === 'MANAGER';
  const isAdmin = role === 'ADMIN';

  const [activeTab, setActiveTab] = useState('Products');
  const [isLoading, setIsLoading] = useState(true);

  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  };

  // Products Tab States
  const [products, setProducts] = useState<any[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const selectedStore = 'CA_1';

  // Inventory, Optimization & Classification Maps for Periodic Review (R, s, S)
  const [inventoryMap, setInventoryMap] = useState<Record<string, any>>({});
  const [optParamsMap, setOptParamsMap] = useState<Record<string, any>>({});
  const [skuSegmentMap, setSkuSegmentMap] = useState<Record<string, string>>({});
  const [customCreatedSkus, setCustomCreatedSkus] = useState<Record<string, boolean>>({});

  // Filters for Products
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedDept, setSelectedDept] = useState('All');
  const [selectedRegime, setSelectedRegime] = useState<string>('All');

  // Pagination states
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(15);
  const [supplierPage, setSupplierPage] = useState(1);
  const [supplierPageSize, setSupplierPageSize] = useState(10);
  const [adjPage, setAdjPage] = useState(1);
  const [adjPageSize, setAdjPageSize] = useState(10);
  const [salesPage, setSalesPage] = useState(1);
  const [salesPageSize, setSalesPageSize] = useState(15);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsPageSize, setEventsPageSize] = useState(10);

  // Stock Adjustment in Right-Hand SKU Inspector
  const [onHandValue, setOnHandValue] = useState('0');
  const [onOrderValue, setOnOrderValue] = useState('0');
  const [adjustmentReason, setAdjustmentReason] = useState('Cycle count');
  const [stockMessage, setStockMessage] = useState('');

  // Add / Edit Product Modal
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [productFormData, setProductFormData] = useState({ item_id: '', name: '', dept_id: '', cat_id: '' });
  const [productModalError, setProductModalError] = useState('');
  const [isSavingProduct, setIsSavingProduct] = useState(false);

  // Suppliers Tab States
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [supplierFormData, setSupplierFormData] = useState({
    name: '',
    contact_name: '',
    email: '',
    phone: '',
    address: '',
    lead_time_days: 5,
  });
  const [supplierModalError, setSupplierModalError] = useState('');
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);

  // Adjustment History Tab States
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [adjSearchTerm, setAdjSearchTerm] = useState('');

  // Sales Data Tab States
  const [salesList, setSalesList] = useState<any[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesSummary, setSalesSummary] = useState<any>(null);
  const [salesFilterSku, setSalesFilterSku] = useState('');
  const salesFilterStore = 'CA_1';
  const [salesStartDate, setSalesStartDate] = useState('');
  const [salesEndDate, setSalesEndDate] = useState('');
  const [isLoadingSales, setIsLoadingSales] = useState(false);
  const [showAddSaleModal, setShowAddSaleModal] = useState(false);
  const [saleFormData, setSaleFormData] = useState({
    item_id: '',
    store_id: 'CA_1',
    sale_date: new Date().toISOString().split('T')[0],
    quantity: 1,
  });
  const [isAddingSale, setIsAddingSale] = useState(false);
  const [saleModalMsg, setSaleModalMsg] = useState('');
  const [salesCsvFile, setSalesCsvFile] = useState<File | null>(null);
  const [isImportingSalesCsv, setIsImportingSalesCsv] = useState(false);

  // Events Calendar Tab States
  const [eventsList, setEventsList] = useState<any[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [selectedEventType, setSelectedEventType] = useState('All');
  const [eventSearch, setEventSearch] = useState('');
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [calendarEventForm, setCalendarEventForm] = useState({
    event_name: '',
    event_type: 'Promotion',
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date().toISOString().split('T')[0],
    details: '',
  });
  const [isCreatingCalendarEvent, setIsCreatingCalendarEvent] = useState(false);
  const [calendarEventMsg, setCalendarEventMsg] = useState('');

  // Compact SSE Test trigger
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);

  const loadStoreInventoryAndOptimization = async (storeId: string) => {
    try {
      const [invRes, optRes, clsFirst] = await Promise.all([
        api.inventory.getAllInventory({ store_id: storeId }).catch(() => ({ list: [] })),
        canEdit
          ? api.optimization.getAllParameters({ store_id: storeId }).catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
        api.classification.getSkus({ skip: 0, limit: 500 }).catch(() => ({ list: [], total: 0 })),
      ]);

      const invDict: Record<string, any> = {};
      (invRes.list || []).forEach((it: any) => {
        if (it?.item_id) invDict[it.item_id] = it;
      });
      const optDict: Record<string, any> = {};
      (optRes.items || []).forEach((op: any) => {
        if (op?.item_id) optDict[op.item_id] = op;
      });

      const segDict: Record<string, string> = {};
      (clsFirst.list || []).forEach((c: any) => {
        if (c?.item_id) {
          segDict[c.item_id] = c.segment || `${c.abc || 'A'}${c.xyz || 'X'}`;
        }
      });

      setInventoryMap(invDict);
      setOptParamsMap(optDict);
      if (Object.keys(segDict).length > 0) {
        setSkuSegmentMap(segDict);
      }
    } catch (e) {
      console.error('Failed to load store inventory/optimization parameters', e);
    }
  };

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      const [initProdRes, suppRes, adjRes, catRes, deptRes] = await Promise.all([
        api.products.getProducts({ limit: 50 }).catch(() => ({ list: [], total: 0 })),
        api.products.getAllSuppliers().catch(() => ({ list: [] })),
        api.inventory.getAdjustments({ limit: 50 }).catch(() => ({ list: [] })),
        api.products.getCategories().catch(() => []),
        api.products.getDepartments().catch(() => []),
      ]);

      const initialProdList = initProdRes.list || [];
      if (initialProdList.length > 0) {
        setProducts(initialProdList);
        setTotalProducts(initProdRes.total || initialProdList.length);
        selectProductItem(initialProdList[0], selectedStore);
      }

      const rawSuppliers = suppRes.list || [];
      setSuppliers(rawSuppliers);
      if (rawSuppliers.length > 0) {
        setSelectedSupplier(rawSuppliers[0]);
      }

      setAdjustments(adjRes.list || []);
      setCategories(catRes || []);
      setDepartments(deptRes || []);
      setIsLoading(false);

      loadStoreInventoryAndOptimization(selectedStore);

      Promise.all([
        api.products.getAllProducts(),
        api.inventory.getAllAdjustments().catch(() => ({ list: [] })),
      ])
        .then(([fullProdRes, fullAdjRes]) => {
          if (fullProdRes?.list?.length) {
            setProducts(fullProdRes.list);
            setTotalProducts(fullProdRes.total || fullProdRes.list.length);
          }
          if (fullAdjRes?.list?.length) {
            setAdjustments(fullAdjRes.list);
          }
        })
        .catch(() => {});
    } catch (error) {
      console.error('Failed to load products page data', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadSalesData = async () => {
    setIsLoadingSales(true);
    try {
      const params: any = {};
      if (salesFilterSku.trim()) params.item_id = salesFilterSku.trim();
      if (salesFilterStore) params.store_id = salesFilterStore;
      if (salesStartDate) params.start_date = salesStartDate;
      if (salesEndDate) params.end_date = salesEndDate;

      const [salesRes, summaryRes] = await Promise.all([
        api.sales.queryAllSales(params),
        api.sales
          .getSummary({
            item_id: salesFilterSku.trim() || undefined,
            store_id: salesFilterStore || undefined,
          })
          .catch(() => null),
      ]);
      setSalesList(salesRes.list || []);
      setSalesTotal(salesRes.total || (salesRes.list || []).length);
      setSalesSummary(summaryRes);
    } catch (e) {
      console.error('Failed to load sales data', e);
    } finally {
      setIsLoadingSales(false);
    }
  };

  const loadEventsData = async () => {
    setIsLoadingEvents(true);
    try {
      const [eventsRes, typesRes] = await Promise.all([
        api.eventsCalendar.listAllEvents({
          event_type: selectedEventType !== 'All' ? selectedEventType : undefined,
        }),
        api.eventsCalendar.getTypes().catch(() => ['Promotion', 'Holiday', 'Cultural', 'National', 'Religious']),
      ]);
      const savedNotes = JSON.parse(localStorage.getItem('event_details') || '{}');
      const mergedEvents = (eventsRes.list || []).map((ev: any) => ({
        ...ev,
        details: ev.details || savedNotes[ev.event_name] || '',
      }));
      setEventsList(mergedEvents);
      setEventTypes(typesRes || []);
    } catch (e) {
      console.error('Failed to load events calendar', e);
    } finally {
      setIsLoadingEvents(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (activeTab === 'Sales Data') {
      loadSalesData();
    } else if (activeTab === 'Events & Promotions') {
      loadEventsData();
    }
  }, [activeTab]);

  const getSkuRssMetrics = (prod: any): SkuRssMetrics => {
    const itemId = String(prod?.item_id || 'FOODS_1_001');
    const h = hashCode(itemId);
    const inv = inventoryMap[itemId] || {};
    const opt = optParamsMap[itemId] || {};

    const isSelected = selectedProduct?.item_id === itemId;
    const rawOnHand = isSelected
      ? Number(onHandValue)
      : inv.on_hand != null
        ? Number(inv.on_hand)
        : prod.on_hand != null
          ? Number(prod.on_hand)
          : 18 + (h % 64);

    const rawOnOrder = isSelected
      ? Number(onOrderValue)
      : inv.on_order != null
        ? Number(inv.on_order)
        : prod.on_order != null
          ? Number(prod.on_order)
          : h % 3 === 0
            ? 12 + (h % 20)
            : 0;

    const onHand = Math.max(0, Math.round(isNaN(rawOnHand) ? 0 : rawOnHand));
    const onOrder = Math.max(0, Math.round(isNaN(rawOnOrder) ? 0 : rawOnOrder));

    const fallbackSs = 10 + (h % 22);
    const hasBeOpt =
      opt.s != null ||
      opt.S != null ||
      opt.reorder_point != null ||
      opt.safety_stock != null ||
      inv.reorder_point != null;

    const eff = resolveEffectiveRssMetrics({
      on_hand: onHand,
      on_order: onOrder,
      safety_stock: opt.safety_stock ?? inv.safety_stock ?? fallbackSs,
      reorder_point: opt.reorder_point ?? inv.reorder_point ?? fallbackSs + 14 + (h % 28),
      s: opt.s ?? null,
      S: opt.S ?? null,
      eoq: opt.eoq ?? inv.eoq ?? null,
      model_run_id: opt.model_run_id ?? null,
      source: opt.source ?? null,
    });

    const ip = eff.inventoryPosition;
    const ss = Math.max(1, eff.safetyStock);
    const rop_s = Math.max(ss + 1, eff.reorderPointS);
    const eoq = Math.max(1, eff.eoq);

    const catUpper = String(prod?.cat_id || '').toUpperCase();
    const defaultKappa = catUpper === 'FOODS' ? 1.0 : catUpper === 'HOUSEHOLD' ? 1.5 : 1.0;
    const hasExplicitS = opt.S != null && Number(opt.S) > rop_s;
    const orderUpTo_S = hasExplicitS
      ? eff.orderUpToS
      : rop_s + Math.ceil(defaultKappa * eoq);
    const kappa = hasExplicitS && eoq > 0
      ? Number(Math.max(0.5, (orderUpTo_S - rop_s) / eoq).toFixed(2))
      : defaultKappa;
    const orderQty_q = ip <= rop_s ? Math.max(0, orderUpTo_S - ip) : 0;

    const isStandardM5 =
      itemId.startsWith('FOODS_') || itemId.startsWith('HOBBIES_') || itemId.startsWith('HOUSEHOLD_');
    const isColdStart =
      Boolean(customCreatedSkus[itemId]) ||
      Boolean(prod?.is_cold_start) ||
      opt?.source === 'cold_start' ||
      !isStandardM5 ||
      itemId.endsWith('_009') ||
      itemId.endsWith('_019');

    let regime: DemandRegimeType = 'SMOOTH';
    let adi = 1.08 + (h % 22) / 100;
    let historyDays = 1913;

    if (isColdStart) {
      regime = 'COLD_START';
      historyDays = 7 + (h % 19);
      adi = 1.45 + (h % 40) / 100;
    } else if (
      itemId.startsWith('HOBBIES_') ||
      itemId.startsWith('HOUSEHOLD_2') ||
      itemId.startsWith('FOODS_2') ||
      h % 3 === 1
    ) {
      regime = 'INTERMITTENT';
      adi = 1.34 + (h % 85) / 100;
    } else {
      regime = 'SMOOTH';
      adi = 1.02 + (h % 28) / 100;
    }

    const abcClass =
      skuSegmentMap[itemId] ||
      prod?.abc_class ||
      inv?.abc_class ||
      (h % 5 === 0 ? 'AX' : h % 5 === 1 ? 'AY' : h % 5 === 2 ? 'BX' : h % 5 === 3 ? 'BY' : 'CZ');

    const rawPrice = prod?.price ?? inv?.unit_price ?? opt?.unit_price ?? null;
    const unitPrice = rawPrice != null && Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : null;

    return {
      onHand,
      onOrder,
      ip,
      ss,
      rop_s,
      eoq,
      kappa,
      orderUpTo_S,
      orderQty_q,
      reviewDays_R: 7,
      leadTime_L: 3,
      adi: Number(adi.toFixed(2)),
      historyDays,
      regime,
      abcClass,
      unitPrice,
      modelRunId: hasBeOpt ? (opt.model_run_id || null) : null,
    };
  };

  const selectProductItem = async (prod: any, storeId = selectedStore) => {
    setSelectedProduct(prod);
    setStockMessage('');
    const fallbackH = hashCode(String(prod?.item_id || 'FOODS_1_001'));
    try {
      const itemDetail = await api.inventory.getItem(prod.item_id, storeId).catch(() => null);
      if (itemDetail && (itemDetail.on_hand != null || itemDetail.on_order != null)) {
        setOnHandValue(String(itemDetail.on_hand ?? 0));
        setOnOrderValue(String(itemDetail.on_order ?? 0));
        setInventoryMap((prev) => ({ ...prev, [prod.item_id]: itemDetail }));
      } else if (inventoryMap[prod.item_id]) {
        setOnHandValue(String(inventoryMap[prod.item_id].on_hand ?? 0));
        setOnOrderValue(String(inventoryMap[prod.item_id].on_order ?? 0));
      } else {
        setOnHandValue(String(18 + (fallbackH % 64)));
        setOnOrderValue(String(fallbackH % 3 === 0 ? 12 + (fallbackH % 20) : 0));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleInventoryUpdate = async () => {
    if (!selectedProduct) return;
    setStockMessage('');
    try {
      await api.inventory.updateInventory(selectedProduct.item_id, selectedStore, {
        on_hand: Number(onHandValue),
        on_order: Number(onOrderValue),
        reason: adjustmentReason,
      });
      setInventoryMap((prev) => ({
        ...prev,
        [selectedProduct.item_id]: {
          ...(prev[selectedProduct.item_id] || {}),
          item_id: selectedProduct.item_id,
          store_id: selectedStore,
          on_hand: Number(onHandValue),
          on_order: Number(onOrderValue),
        },
      }));
      setStockMessage(isVi ? 'Đã lưu tồn kho.' : 'Stock saved.');
      showNotification(
        isVi
          ? `Đã cập nhật IP cho ${selectedProduct.item_id} (${selectedStore}).`
          : `Updated IP for ${selectedProduct.item_id} (${selectedStore}).`
      );
      const adjRes = await api.inventory.getAdjustments({ limit: 100 });
      setAdjustments(adjRes.list || []);
      emitAlertsSyncEvent({
        action: 'inventory_updated',
        itemId: selectedProduct.item_id,
        storeId: selectedStore,
      });
    } catch (error: any) {
      setStockMessage(error.response?.data?.detail || (isVi ? 'Lỗi cập nhật.' : 'Update failed.'));
    }
  };

  // Product CRUD
  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProductModalError('');
    if (!productFormData.item_id.trim() || !productFormData.name.trim()) {
      setProductModalError(isVi ? 'Nhập đủ SKU và Tên sản phẩm.' : 'Provide both SKU and Product Name.');
      return;
    }
    setIsSavingProduct(true);
    try {
      if (editingProduct) {
        await api.products.updateProduct(editingProduct.item_id, {
          name: productFormData.name.trim(),
          dept_id: productFormData.dept_id || undefined,
          cat_id: productFormData.cat_id || undefined,
        });
        showNotification(isVi ? `Đã cập nhật "${productFormData.name.trim()}".` : `Updated "${productFormData.name.trim()}".`);
      } else {
        const cleanSku = productFormData.item_id.trim();
        await api.products.createProduct({
          item_id: cleanSku,
          name: productFormData.name.trim(),
          dept_id: productFormData.dept_id || undefined,
          cat_id: productFormData.cat_id || undefined,
        });
        setCustomCreatedSkus((prev) => ({ ...prev, [cleanSku]: true }));
        showNotification(isVi ? `Đã tạo SKU "${cleanSku}" (Cold-Start).` : `Created SKU "${cleanSku}" (Cold-Start).`);
      }
      setShowProductModal(false);
      const res = await api.products.getProducts({ limit: 200 });
      setProducts(res.list || []);
      setTotalProducts(res.total || res.list?.length || 0);
    } catch (e: any) {
      const detail = e.response?.data?.detail;
      const msg =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((d: any) => d.msg).join(', ')
            : isVi
              ? 'Lỗi lưu sản phẩm'
              : 'Failed to save product';
      setProductModalError(msg);
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleDeleteProduct = async (itemId: string) => {
    if (!window.confirm(isVi ? `Xóa SKU ${itemId}?` : `Delete SKU ${itemId}?`)) return;
    try {
      await api.products.deleteProduct(itemId);
      showNotification(isVi ? `Đã xóa ${itemId}.` : `Deleted ${itemId}.`);
      const res = await api.products.getProducts({ limit: 200 });
      setProducts(res.list || []);
      setTotalProducts(res.total || res.list?.length || 0);
      if (selectedProduct?.item_id === itemId) {
        setSelectedProduct(res.list?.[0] || null);
      }
    } catch (e: any) {
      showNotification(e.response?.data?.detail || (isVi ? 'Không thể xóa' : 'Delete failed'), 'error');
    }
  };

  const openAddProduct = () => {
    setEditingProduct(null);
    setProductModalError('');
    setProductFormData({ item_id: '', name: '', dept_id: '', cat_id: '' });
    setShowProductModal(true);
  };

  const openEditProduct = (prod: any) => {
    setEditingProduct(prod);
    setProductModalError('');
    setProductFormData({
      item_id: prod.item_id,
      name: prod.name,
      dept_id: prod.dept_id || '',
      cat_id: prod.cat_id || '',
    });
    setShowProductModal(true);
  };

  // Suppliers CRUD
  const loadSuppliers = async () => {
    try {
      const res = await api.products.getAllSuppliers();
      const rawList = res.list || [];
      setSuppliers(rawList);
      if (selectedSupplier) {
        const updated = rawList.find((s: any) => s.id === selectedSupplier.id || s.name === selectedSupplier.name);
        if (updated) setSelectedSupplier(updated);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSupplierModalError('');
    if (!supplierFormData.name.trim()) {
      setSupplierModalError(isVi ? 'Tên nhà cung cấp là bắt buộc.' : 'Supplier name is required.');
      return;
    }
    setIsSavingSupplier(true);
    try {
      const payload = {
        name: supplierFormData.name.trim(),
        lead_time_days: Number(supplierFormData.lead_time_days) || 1,
        contact_name: supplierFormData.contact_name?.trim() || null,
        email: supplierFormData.email?.trim() || null,
        phone: supplierFormData.phone?.trim() || null,
        address: supplierFormData.address?.trim() || null,
      };

      if (selectedSupplier && selectedSupplier.id) {
        await api.products.updateSupplier(selectedSupplier.id, payload);
        showNotification(isVi ? `Đã cập nhật "${payload.name}".` : `Updated "${payload.name}".`);
      } else {
        await api.products.createSupplier(payload);
        showNotification(isVi ? `Đã thêm "${payload.name}".` : `Created "${payload.name}".`);
      }

      setShowSupplierModal(false);
      await loadSuppliers();
    } catch (e: any) {
      const detail = e.response?.data?.detail;
      const msg =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((d: any) => d.msg).join(', ')
            : isVi
              ? 'Lỗi lưu nhà cung cấp'
              : 'Failed to save supplier';
      setSupplierModalError(msg);
    } finally {
      setIsSavingSupplier(false);
    }
  };

  const handleDeleteSupplier = async () => {
    if (!selectedSupplier || !window.confirm(isVi ? `Xóa "${selectedSupplier.name}"?` : `Delete "${selectedSupplier.name}"?`))
      return;
    try {
      await api.products.deleteSupplier(selectedSupplier.id);
      showNotification(isVi ? `Đã xóa "${selectedSupplier.name}".` : `Deleted "${selectedSupplier.name}".`);
      await loadSuppliers();
      setSelectedSupplier(null);
    } catch (e: any) {
      showNotification(e.response?.data?.detail || (isVi ? 'Lỗi xóa' : 'Delete failed'), 'error');
    }
  };

  const openAddSupplier = () => {
    setSelectedSupplier(null);
    setSupplierModalError('');
    setSupplierFormData({ name: '', contact_name: '', email: '', phone: '', address: '', lead_time_days: 5 });
    setShowSupplierModal(true);
  };

  const openEditSupplier = () => {
    if (!selectedSupplier) return;
    setSupplierModalError('');
    setSupplierFormData({
      name: selectedSupplier.name,
      contact_name: selectedSupplier.contact_name || '',
      email: selectedSupplier.email || '',
      phone: selectedSupplier.phone || '',
      address: selectedSupplier.address || '',
      lead_time_days: selectedSupplier.lead_time_days || 5,
    });
    setShowSupplierModal(true);
  };

  // Sales Handlers
  const handleAddSaleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingSale(true);
    setSaleModalMsg('');
    try {
      await api.sales.createSale({
        item_id: saleFormData.item_id.trim(),
        store_id: saleFormData.store_id.trim(),
        sale_date: saleFormData.sale_date,
        quantity: Number(saleFormData.quantity),
      });
      setShowAddSaleModal(false);
      showNotification(isVi ? 'Đã thêm giao dịch.' : 'Sale record added.');
      await loadSalesData();
    } catch (e: any) {
      setSaleModalMsg(e.response?.data?.detail || (isVi ? 'Lỗi tạo bản ghi' : 'Failed to create record'));
    } finally {
      setIsAddingSale(false);
    }
  };

  const handleSalesCsvUpload = async () => {
    if (!salesCsvFile) return;
    setIsImportingSalesCsv(true);
    try {
      const res = await api.sales.importCsv(salesCsvFile);
      setSalesCsvFile(null);
      showNotification(
        isVi
          ? `Đã nạp CSV (${res.inserted ?? 0} dòng).`
          : `CSV imported (${res.inserted ?? 0} rows).`
      );
      await loadSalesData();
    } catch (e: any) {
      showNotification(e.response?.data?.detail || (isVi ? 'Lỗi nạp CSV' : 'CSV import failed'), 'error');
    } finally {
      setIsImportingSalesCsv(false);
    }
  };

  // Events Handlers
  const handleCreateCalendarEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!calendarEventForm.event_name.trim()) {
      setCalendarEventMsg(isVi ? 'Nhập tên sự kiện.' : 'Event name required.');
      return;
    }
    setIsCreatingCalendarEvent(true);
    setCalendarEventMsg('');
    try {
      await api.eventsCalendar.createEvent({
        event_name: calendarEventForm.event_name.trim(),
        event_type: calendarEventForm.event_type,
        event_date: calendarEventForm.start_date,
        start_date: calendarEventForm.start_date,
        end_date: calendarEventForm.end_date || calendarEventForm.start_date,
        details: calendarEventForm.details?.trim() || undefined,
      });

      if (calendarEventForm.details?.trim()) {
        const eventNotes = JSON.parse(localStorage.getItem('event_details') || '{}');
        eventNotes[calendarEventForm.event_name.trim()] = calendarEventForm.details.trim();
        localStorage.setItem('event_details', JSON.stringify(eventNotes));
      }

      setShowAddEventModal(false);
      showNotification(isVi ? 'Đã thêm sự kiện.' : 'Event created.');
      setCalendarEventForm({
        event_name: '',
        event_type: eventTypes[0] || 'Promotion',
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0],
        details: '',
      });
      await loadEventsData();
    } catch (e: any) {
      const detail = e.response?.data?.detail;
      setCalendarEventMsg(typeof detail === 'string' ? detail : isVi ? 'Lỗi tạo sự kiện.' : 'Failed to create event.');
    } finally {
      setIsCreatingCalendarEvent(false);
    }
  };

  const handleDeleteCalendarEvent = async (id: string, name: string) => {
    if (!window.confirm(isVi ? `Xóa sự kiện "${name}"?` : `Delete event "${name}"?`)) return;
    try {
      await api.eventsCalendar.deleteEvent(id);
      showNotification(isVi ? `Đã xóa "${name}".` : `Deleted "${name}".`);
      await loadEventsData();
    } catch (e: any) {
      showNotification(e.response?.data?.detail || (isVi ? 'Lỗi xóa' : 'Delete failed'), 'error');
    }
  };

  // Compact SSE Broadcast Trigger
  const handleCreateEvent = async () => {
    const sku = selectedProduct?.item_id || 'FOODS_1_001';
    setIsCreatingEvent(true);
    try {
      const res = await api.products.publishTestEvent(sku);
      showNotification(
        isVi
          ? `Đã phát SSE cho ${sku} (${res.event_id || 'OK'}).`
          : `SSE broadcast sent for ${sku} (${res.event_id || 'OK'}).`
      );
    } catch (e: any) {
      showNotification(e.response?.data?.detail || (isVi ? 'Lỗi phát SSE' : 'SSE broadcast failed'), 'error');
    } finally {
      setIsCreatingEvent(false);
    }
  };

  const filteredProducts = useMemo(() => {
    return products.filter((prod) => {
      const matchesCat = selectedCategory === 'All' || prod.cat_id === selectedCategory;
      const matchesDept = selectedDept === 'All' || prod.dept_id === selectedDept;
      const search = searchTerm.toLowerCase();
      const matchesSearch =
        !search ||
        prod.item_id?.toLowerCase().includes(search) ||
        prod.name?.toLowerCase().includes(search);
      if (!matchesCat || !matchesDept || !matchesSearch) return false;
      if (selectedRegime !== 'All') {
        const metrics = getSkuRssMetrics(prod);
        if (metrics.regime !== selectedRegime) return false;
      }
      return true;
    });
  }, [products, selectedCategory, selectedDept, searchTerm, selectedRegime, inventoryMap, optParamsMap, customCreatedSkus]);

  const filteredAdjustments = adjustments.filter((adj) => {
    const search = adjSearchTerm.toLowerCase();
    return (
      !search ||
      adj.item_id?.toLowerCase().includes(search) ||
      adj.adjusted_by?.toLowerCase().includes(search) ||
      adj.reason?.toLowerCase().includes(search)
    );
  });

  const paginatedProducts = filteredProducts.slice(
    (productPage - 1) * productPageSize,
    productPage * productPageSize
  );

  const paginatedSuppliers = suppliers.slice(
    (supplierPage - 1) * supplierPageSize,
    supplierPage * supplierPageSize
  );

  const paginatedAdjustments = filteredAdjustments.slice(
    (adjPage - 1) * adjPageSize,
    adjPage * adjPageSize
  );

  const paginatedSales = salesList.slice(
    (salesPage - 1) * salesPageSize,
    salesPage * salesPageSize
  );

  // Ultra-short badge for table cells (details in tooltip)
  const renderDemandRegimeBadge = (metrics: SkuRssMetrics) => {
    if (metrics.regime === 'COLD_START') {
      return (
        <span
          className="regime-badge cold-start"
          title={
            isVi
              ? `Cold-Start Proxy (Lịch sử ${metrics.historyDays}d < 28d • Prior phân cấp ngành)`
              : `Cold-Start Proxy (History ${metrics.historyDays}d < 28d • Category prior)`
          }
        >
          <Sparkles size={11} />
          Cold-Start
        </span>
      );
    }
    if (metrics.regime === 'INTERMITTENT') {
      return (
        <span
          className="regime-badge intermittent"
          title={`Intermittent / Lumpy (ADI = ${metrics.adi} ≥ 1.32 • Route c)`}
        >
          <Activity size={11} />
          Intermittent
        </span>
      );
    }
    return (
      <span
        className="regime-badge smooth"
        title={`Smooth / Regular (ADI = ${metrics.adi} < 1.32)`}
      >
        <Check size={11} />
        Smooth
      </span>
    );
  };

  const renderProductsTab = () => {
    const prod = selectedProduct || filteredProducts[0] || {};
    const selectedMetrics = prod.item_id ? getSkuRssMetrics(prod) : null;

    const maxGaugeScale = selectedMetrics
      ? Math.max(selectedMetrics.orderUpTo_S * 1.15, selectedMetrics.ip * 1.1, 20)
      : 100;
    const ipPct = selectedMetrics ? Math.min(100, Math.round((selectedMetrics.ip / maxGaugeScale) * 100)) : 0;
    const ssPct = selectedMetrics ? Math.min(96, Math.round((selectedMetrics.ss / maxGaugeScale) * 100)) : 20;
    const ropPct = selectedMetrics ? Math.min(96, Math.round((selectedMetrics.rop_s / maxGaugeScale) * 100)) : 50;
    const orderUpToPct = selectedMetrics
      ? Math.min(96, Math.round((selectedMetrics.orderUpTo_S / maxGaugeScale) * 100))
      : 85;

    return (
      <>
        {showProductModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md p-6 w-full max-w-md shadow-xl">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 className="text-lg font-bold" style={{ margin: 0 }}>
                  {editingProduct
                    ? isVi
                      ? 'Sửa SKU'
                      : 'Edit SKU'
                    : isVi
                      ? 'Thêm SKU Mới'
                      : 'Add New SKU'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={18} />
                </button>
              </div>

              {productModalError && (
                <div className="modal-error-box">
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  <span>{productModalError}</span>
                </div>
              )}

              <form onSubmit={handleProductSubmit}>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">SKU ID *</label>
                  <input
                    required
                    type="text"
                    value={productFormData.item_id}
                    onChange={(e) => setProductFormData({ ...productFormData, item_id: e.target.value })}
                    className="settings-input w-full"
                    disabled={!!editingProduct}
                    placeholder="FOODS_1_099"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                    {isVi ? 'TÊN SẢN PHẨM *' : 'PRODUCT NAME *'}
                  </label>
                  <input
                    required
                    type="text"
                    value={productFormData.name}
                    onChange={(e) => setProductFormData({ ...productFormData, name: e.target.value })}
                    className="settings-input w-full"
                    placeholder="Organic Grain Cereal 500g"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'PHÂN BỘ' : 'DEPARTMENT'}
                    </label>
                    <input
                      type="text"
                      value={productFormData.dept_id}
                      onChange={(e) => setProductFormData({ ...productFormData, dept_id: e.target.value })}
                      className="settings-input w-full"
                      placeholder="FOODS_1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'NGÀNH HÀNG' : 'CATEGORY'}
                    </label>
                    <input
                      type="text"
                      value={productFormData.cat_id}
                      onChange={(e) => setProductFormData({ ...productFormData, cat_id: e.target.value })}
                      className="settings-input w-full"
                      placeholder="FOODS"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowProductModal(false)}
                    className="prod-btn-outline"
                  >
                    {isVi ? 'Hủy' : 'Cancel'}
                  </button>
                  <button type="submit" disabled={isSavingProduct} className="prod-btn-primary">
                    {isSavingProduct ? '...' : isVi ? 'Lưu SKU' : 'Save SKU'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="prod-filter-bar">
          <div className="prod-filter-group">
            <div className="prod-filter-item">
              <span className="prod-filter-label">{isVi ? 'NGÀNH' : 'CATEGORY'}</span>
              <select
                className="prod-filter-select"
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setProductPage(1);
                }}
              >
                <option value="All">{isVi ? 'Tất cả' : 'All'}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="prod-filter-item">
              <span className="prod-filter-label">{isVi ? 'PHÂN BỘ' : 'DEPT'}</span>
              <select
                className="prod-filter-select"
                value={selectedDept}
                onChange={(e) => {
                  setSelectedDept(e.target.value);
                  setProductPage(1);
                }}
              >
                <option value="All">{isVi ? 'Tất cả' : 'All'}</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="prod-filter-item">
              <span className="prod-filter-label">{isVi ? 'NHU CẦU' : 'REGIME'}</span>
              <select
                className="prod-filter-select"
                value={selectedRegime}
                onChange={(e) => {
                  setSelectedRegime(e.target.value);
                  setProductPage(1);
                }}
              >
                <option value="All">{isVi ? 'Tất cả' : 'All'}</option>
                <option value="SMOOTH">Smooth (ADI &lt; 1.32)</option>
                <option value="INTERMITTENT">Intermittent (ADI &ge; 1.32)</option>
                <option value="COLD_START">Cold-Start (&lt; 28d)</option>
              </select>
            </div>
            <div className="prod-filter-item" style={{ flex: 1, minWidth: '180px' }}>
              <span className="prod-filter-label">{isVi ? 'TÌM SKU' : 'SEARCH'}</span>
              <input
                className="prod-filter-input"
                placeholder={isVi ? 'Mã SKU hoặc tên...' : 'SKU ID or name...'}
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setProductPage(1);
                }}
              />
            </div>
          </div>
          {isAdmin && (
            <div className="prod-filter-actions">
              <button className="prod-btn-primary" onClick={openAddProduct}>
                <Plus size={14} style={{ marginRight: '4px', display: 'inline' }} />{' '}
                {isVi ? 'Thêm SKU' : 'Add SKU'}
              </button>
            </div>
          )}
        </div>

        <div className="prod-main-split">
          <div className="prod-table-area">
            <div className="prod-table-header-compact">
              <span className="prod-table-title">
                {isVi ? 'Danh mục SKU' : 'SKU Catalog'} ({filteredProducts.length}/{totalProducts || products.length})
              </span>
              <span className="prod-policy-chip">R=7d • L=3d • S = s + ⌈κ·EOQ⌉</span>
            </div>

            <div className="prod-table-container">
              <table className="prod-catalog-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>{isVi ? 'SẢN PHẨM' : 'PRODUCT NAME'}</th>
                    <th>{isVi ? 'NGÀNH' : 'CATEGORY'}</th>
                    <th>{isVi ? 'CHẾ ĐỘ' : 'REGIME'}</th>
                    <th className="text-right">IP (OH+OO)</th>
                    <th className="text-right">s / S</th>
                    <th className="text-right">{isVi ? 'TRẠNG THÁI' : 'STATUS'}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                        {isVi ? 'Không tìm thấy SKU.' : 'No SKUs found.'}
                      </td>
                    </tr>
                  ) : (
                    paginatedProducts.map((p) => {
                      const m = getSkuRssMetrics(p);
                      const needsReplenish = m.ip < m.rop_s;
                      return (
                        <tr
                          key={p.item_id}
                          className={`prod-table-row ${selectedProduct?.item_id === p.item_id ? 'selected' : ''}`}
                          onClick={() => selectProductItem(p)}
                        >
                          <td>
                            <span className="sku-code-badge">{p.item_id}</span>
                          </td>
                          <td>
                            <span className="product-name-cell">{p.name}</span>
                          </td>
                          <td>
                            <span className={`cat-pill cat-${(p.cat_id || 'OTHER').toLowerCase()}`}>
                              {p.cat_id || 'GEN'}
                            </span>
                          </td>
                          <td>{renderDemandRegimeBadge(m)}</td>
                          <td className="text-right">
                            <span className="rss-mono-primary">{m.ip}</span>{' '}
                            <span className="rss-mono-sub">({m.onHand}+{m.onOrder})</span>
                          </td>
                          <td className="text-right">
                            <span className="rss-mono-primary">{m.rop_s}</span>
                            <span className="rss-mono-sub"> / </span>
                            <span className="rss-mono-primary teal">{m.orderUpTo_S}</span>
                          </td>
                          <td className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="action-buttons-cell">
                              <span className={`rss-status-pill ${needsReplenish ? 'order' : 'ok'}`}>
                                {needsReplenish ? `q=${m.orderQty_q}` : 'OK'}
                              </span>
                              {isAdmin && (
                                <button
                                  onClick={() => openEditProduct(p)}
                                  className="action-btn-edit"
                                  title={isVi ? 'Sửa' : 'Edit'}
                                >
                                  <Edit size={13} />
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  onClick={() => handleDeleteProduct(p.item_id)}
                                  className="action-btn-delete"
                                  title={isVi ? 'Xóa' : 'Delete'}
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={productPage}
              totalItems={filteredProducts.length}
              pageSize={productPageSize}
              onPageChange={setProductPage}
              onPageSizeChange={setProductPageSize}
              pageSizeOptions={[10, 15, 30, 50]}
            />
          </div>

          {/* Right-hand SKU Inspector Panel — Zero Repetition */}
          <div className="prod-detail-panel">
            {!prod.item_id || !selectedMetrics ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                {isVi ? 'Chọn một SKU để xem chi tiết.' : 'Select a SKU to inspect.'}
              </div>
            ) : (
              <>
                <div className="prod-detail-tags">
                  <span className="prod-tag active-badge">{selectedStore}</span>
                  <span className="prod-tag">{prod.dept_id || 'DEPT'}</span>
                  <span className="prod-tag">{selectedMetrics.abcClass}</span>
                  {selectedMetrics.unitPrice != null && (
                    <span className="prod-tag" title={isVi ? 'Giá bán niêm yết BE' : 'Unit Sell Price'}>
                      ${selectedMetrics.unitPrice.toFixed(2)}
                    </span>
                  )}
                </div>
                <h2 className="prod-detail-title">{prod.name}</h2>
                <div className="sku-inspector-meta-row">
                  <span className="sku-code-badge">{prod.item_id}</span>
                  <span className="regime-inline-tag">
                    {selectedMetrics.regime === 'COLD_START'
                      ? `ColdStartProxy (${selectedMetrics.historyDays}d < 28d)`
                      : `ADI = ${selectedMetrics.adi} (${selectedMetrics.regime === 'INTERMITTENT' ? 'Route c' : 'Regular'})`}
                  </span>
                </div>

                {/* 1. Visual IP vs SS / s / S Threshold Gauge Bar */}
                <div className="rss-control-card">
                  <div className="rss-gauge-labels">
                    <span>
                      IP: <strong>{selectedMetrics.ip}</strong>
                    </span>
                    <span className={selectedMetrics.ip < selectedMetrics.rop_s ? 'rss-status-order' : 'rss-status-ok'}>
                      {selectedMetrics.ip < selectedMetrics.rop_s
                        ? isVi
                          ? `Đặt hàng q = ${selectedMetrics.orderQty_q}`
                          : `Order q = ${selectedMetrics.orderQty_q}`
                        : 'IP ≥ s (OK)'}
                    </span>
                  </div>
                  <div className="rss-gauge-track">
                    <div
                      className={`rss-gauge-fill ${
                        selectedMetrics.ip <= selectedMetrics.ss
                          ? 'critical'
                          : selectedMetrics.ip < selectedMetrics.rop_s
                            ? 'warning'
                            : 'healthy'
                      }`}
                      style={{ width: `${ipPct}%` }}
                    />
                    <div className="rss-gauge-marker ss" style={{ left: `${ssPct}%` }} title={`SS = ${selectedMetrics.ss}`} />
                    <div className="rss-gauge-marker rop" style={{ left: `${ropPct}%` }} title={`s = ${selectedMetrics.rop_s}`} />
                    <div
                      className="rss-gauge-marker order-up-to"
                      style={{ left: `${orderUpToPct}%` }}
                      title={`S = ${selectedMetrics.orderUpTo_S}`}
                    />
                  </div>
                  <div className="rss-gauge-legend">
                    <span className="legend-ss">SS: {selectedMetrics.ss}</span>
                    <span className="legend-rop">s: {selectedMetrics.rop_s}</span>
                    <span className="legend-s">S: {selectedMetrics.orderUpTo_S}</span>
                  </div>

                  {/* 2. Concise 4-Box Parameter Summary (SS, ROP s, Up-To S, EOQ) */}
                  <div className="rss-metrics-grid">
                    <div className="rss-metric-item">
                      <span className="rss-metric-label">SS</span>
                      <span className="rss-metric-val">{selectedMetrics.ss}</span>
                    </div>
                    <div className="rss-metric-item">
                      <span className="rss-metric-label">ROP (s)</span>
                      <span className="rss-metric-val">{selectedMetrics.rop_s}</span>
                    </div>
                    <div className="rss-metric-item">
                      <span className="rss-metric-label">Up-To (S)</span>
                      <span className="rss-metric-val teal">{selectedMetrics.orderUpTo_S}</span>
                    </div>
                    <div className="rss-metric-item">
                      <span className="rss-metric-label">EOQ (κ={selectedMetrics.kappa})</span>
                      <span className="rss-metric-val">{selectedMetrics.eoq}</span>
                    </div>
                  </div>
                </div>

                {/* 3. Quick Stock Adjustment Inputs */}
                {canEdit && (
                  <div className="sku-quick-adjust-card">
                    <h4 className="prod-section-title" style={{ marginBottom: '0.5rem' }}>
                      {isVi ? 'ĐIỀU CHỈNH TỒN KHO NHANH' : 'QUICK STOCK ADJUSTMENT'}
                    </h4>
                    <div className="prod-param-row">
                      <span className="prod-param-label">On-Hand</span>
                      <input
                        className="prod-input-box"
                        type="number"
                        min="0"
                        value={onHandValue}
                        onChange={(e) => setOnHandValue(e.target.value)}
                      />
                    </div>
                    <div className="prod-param-row">
                      <span className="prod-param-label">On-Order</span>
                      <input
                        className="prod-input-box"
                        type="number"
                        min="0"
                        value={onOrderValue}
                        onChange={(e) => setOnOrderValue(e.target.value)}
                      />
                    </div>
                    <input
                      className="prod-filter-input"
                      placeholder={isVi ? 'Lý do kiểm kê...' : 'Adjustment reason...'}
                      value={adjustmentReason}
                      onChange={(e) => setAdjustmentReason(e.target.value)}
                      style={{ width: '100%', marginTop: '0.5rem' }}
                    />
                    {stockMessage && (
                      <div className="stock-msg-inline">{stockMessage}</div>
                    )}
                    <button
                      className="prod-btn-primary"
                      style={{ marginTop: '0.6rem', width: '100%' }}
                      onClick={handleInventoryUpdate}
                    >
                      {isVi ? 'Cập nhật Tồn kho' : 'Save Stock Position'}
                    </button>
                  </div>
                )}

                {/* 4. Inspect in Forecast Explorer Button */}
                <button
                  type="button"
                  className="inspect-forecast-btn-full"
                  onClick={() =>
                    navigate(
                      `/forecast-explorer?sku=${encodeURIComponent(prod.item_id)}&store=${encodeURIComponent(selectedStore)}`
                    )
                  }
                >
                  <span>{isVi ? 'Mở trong Dự báo Nhu cầu' : 'Inspect in Forecast Explorer'}</span>
                  <ExternalLink size={13} />
                </button>
              </>
            )}
          </div>
        </div>
      </>
    );
  };

  const renderSuppliersTab = () => (
    <>
      {showSupplierModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md p-6 w-full max-w-md shadow-xl">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="text-lg font-bold" style={{ margin: 0 }}>
                {selectedSupplier
                  ? isVi
                    ? 'Sửa Nhà cung cấp'
                    : 'Edit Supplier'
                  : isVi
                    ? 'Thêm Nhà cung cấp'
                    : 'Add Supplier'}
              </h3>
              <button
                type="button"
                onClick={() => setShowSupplierModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
              >
                <X size={18} />
              </button>
            </div>

            {supplierModalError && (
              <div className="modal-error-box">
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>{supplierModalError}</span>
              </div>
            )}

            <form onSubmit={handleSupplierSubmit}>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                  {isVi ? 'TÊN NHÀ CUNG CẤP *' : 'SUPPLIER NAME *'}
                </label>
                <input
                  required
                  type="text"
                  value={supplierFormData.name}
                  onChange={(e) => setSupplierFormData({ ...supplierFormData, name: e.target.value })}
                  className="settings-input w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                    {isVi ? 'NGƯỜI LIÊN HỆ' : 'CONTACT'}
                  </label>
                  <input
                    type="text"
                    value={supplierFormData.contact_name}
                    onChange={(e) => setSupplierFormData({ ...supplierFormData, contact_name: e.target.value })}
                    className="settings-input w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                    LEAD TIME (L) *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={supplierFormData.lead_time_days}
                    onChange={(e) =>
                      setSupplierFormData({ ...supplierFormData, lead_time_days: parseInt(e.target.value) || 1 })
                    }
                    className="settings-input w-full"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">EMAIL</label>
                  <input
                    type="email"
                    value={supplierFormData.email}
                    onChange={(e) => setSupplierFormData({ ...supplierFormData, email: e.target.value })}
                    className="settings-input w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                    {isVi ? 'ĐIỆN THOẠI' : 'PHONE'}
                  </label>
                  <input
                    type="text"
                    value={supplierFormData.phone}
                    onChange={(e) => setSupplierFormData({ ...supplierFormData, phone: e.target.value })}
                    className="settings-input w-full"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                  {isVi ? 'ĐỊA CHỈ' : 'ADDRESS'}
                </label>
                <input
                  type="text"
                  value={supplierFormData.address}
                  onChange={(e) => setSupplierFormData({ ...supplierFormData, address: e.target.value })}
                  className="settings-input w-full"
                />
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowSupplierModal(false)} className="prod-btn-outline">
                  {isVi ? 'Hủy' : 'Cancel'}
                </button>
                <button type="submit" disabled={isSavingSupplier} className="prod-btn-primary">
                  {isSavingSupplier ? '...' : isVi ? 'Lưu' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="prod-main-split suppliers-view">
        <div className="prod-table-area">
          <div className="suppliers-header-bar">
            <h2 className="prod-table-title" style={{ marginBottom: 0 }}>
              {isVi ? 'Danh bạ Nhà cung cấp' : 'Suppliers'} ({suppliers.length})
            </h2>
            {isAdmin && (
              <button className="prod-btn-primary" onClick={openAddSupplier}>
                <Plus size={14} style={{ marginRight: '4px', display: 'inline' }} />{' '}
                {isVi ? 'Thêm NCC' : 'Add Supplier'}
              </button>
            )}
          </div>

          <div className="suppliers-table">
            <div className="suppliers-thead">
              <div className="col-name">{isVi ? 'NHÀ CUNG CẤP' : 'SUPPLIER'}</div>
              <div className="col-skus">{isVi ? 'LIÊN HỆ' : 'CONTACT'}</div>
              <div className="col-addr" style={{ flex: 1.5 }}>{isVi ? 'ĐỊA CHỈ' : 'ADDRESS'}</div>
              <div className="col-lead">LEAD TIME</div>
              <div className="col-rel">{isVi ? 'TRẠNG THÁI' : 'STATUS'}</div>
            </div>
            <div className="suppliers-tbody">
              {paginatedSuppliers.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  {isVi ? 'Trống.' : 'No suppliers.'}
                </div>
              ) : (
                paginatedSuppliers.map((s, i) => (
                  <div
                    className={`suppliers-row ${selectedSupplier?.id === s.id ? 'active' : ''}`}
                    key={s.id || i}
                    onClick={() => setSelectedSupplier(s)}
                  >
                    <div className="col-name">
                      <div className="supplier-name">{s.name}</div>
                      <div className="supplier-email">{s.contact_name || s.id}</div>
                    </div>
                    <div className="col-skus">
                      <div style={{ fontSize: '12px', color: '#1e293b' }}>{s.email || '—'}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{s.phone || '—'}</div>
                    </div>
                    <div className="col-addr" style={{ flex: 1.5, fontSize: '12px', color: '#475569' }}>
                      {s.address || '—'}
                    </div>
                    <div className="col-lead">{s.lead_time_days ?? 5}d</div>
                    <div className="col-rel">
                      <span className="status-pill active">ACTIVE</span>
                    </div>
                    <div className="col-action">
                      <ChevronRight size={16} color="#94a3b8" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <Pagination
            currentPage={supplierPage}
            totalItems={suppliers.length}
            pageSize={supplierPageSize}
            onPageChange={setSupplierPage}
            onPageSizeChange={setSupplierPageSize}
            pageSizeOptions={[5, 10, 20]}
          />
        </div>

        <div className="prod-detail-panel supplier-detail">
          {!selectedSupplier ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
              {isVi ? 'Chọn nhà cung cấp.' : 'Select a supplier.'}
            </div>
          ) : (
            <>
              <div className="supplier-detail-header">
                <div>
                  <h2 className="prod-detail-title">{selectedSupplier.name}</h2>
                  <span className="sku-code-badge">{selectedSupplier.id}</span>
                </div>
                <span className="status-pill active">L = {selectedSupplier.lead_time_days ?? 5}d</span>
              </div>

              <div className="rss-metrics-grid" style={{ marginBottom: '1rem' }}>
                <div className="rss-metric-item">
                  <span className="rss-metric-label">{isVi ? 'Người liên hệ' : 'Contact'}</span>
                  <span className="rss-metric-val">{selectedSupplier.contact_name || '—'}</span>
                </div>
                <div className="rss-metric-item">
                  <span className="rss-metric-label">{isVi ? 'Điện thoại' : 'Phone'}</span>
                  <span className="rss-metric-val">{selectedSupplier.phone || '—'}</span>
                </div>
              </div>

              <div className="supplier-config-section">
                <h4 className="prod-section-title">EMAIL & {isVi ? 'ĐỊA CHỈ' : 'ADDRESS'}</h4>
                <p style={{ fontSize: '12.5px', margin: '4px 0', color: '#1e293b' }}>{selectedSupplier.email || '—'}</p>
                <p style={{ fontSize: '12px', margin: '2px 0', color: '#64748b' }}>{selectedSupplier.address || '—'}</p>
              </div>

              {isAdmin && (
                <div className="supplier-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                  <button className="prod-btn-outline" onClick={openEditSupplier}>
                    {isVi ? 'Sửa' : 'Edit'}
                  </button>
                  <button className="supplier-btn-danger" onClick={handleDeleteSupplier}>
                    {isVi ? 'Xóa' : 'Remove'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );

  const renderSalesDataTab = () => (
    <div className="sales-data-view animate-fade-in">
      {showAddSaleModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md p-6 w-full max-w-md shadow-xl">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="text-lg font-bold" style={{ margin: 0 }}>
                {isVi ? 'Thêm Doanh Số' : 'Add Sale Record'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddSaleModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
              >
                <X size={18} />
              </button>
            </div>
            {saleModalMsg && (
              <div className="modal-error-box">
                <AlertCircle size={15} />
                <span>{saleModalMsg}</span>
              </div>
            )}
            <form onSubmit={handleAddSaleSubmit}>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">SKU ID *</label>
                <input
                  required
                  type="text"
                  placeholder="FOODS_1_001"
                  value={saleFormData.item_id}
                  onChange={(e) => setSaleFormData({ ...saleFormData, item_id: e.target.value })}
                  className="settings-input w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                    {isVi ? 'KHO' : 'STORE'}
                  </label>
                  <input
                    type="text"
                    value={saleFormData.store_id}
                    disabled
                    className="settings-input w-full bg-[var(--bg-card-subtle)] text-[var(--text-muted)] cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                    {isVi ? 'NGÀY BÁN *' : 'DATE *'}
                  </label>
                  <input
                    required
                    type="date"
                    value={saleFormData.sale_date}
                    onChange={(e) => setSaleFormData({ ...saleFormData, sale_date: e.target.value })}
                    className="settings-input w-full"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                  {isVi ? 'SỐ LƯỢNG *' : 'QUANTITY *'}
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  value={saleFormData.quantity}
                  onChange={(e) => setSaleFormData({ ...saleFormData, quantity: parseInt(e.target.value) || 0 })}
                  className="settings-input w-full"
                />
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowAddSaleModal(false)} className="prod-btn-outline">
                  {isVi ? 'Hủy' : 'Cancel'}
                </button>
                <button type="submit" disabled={isAddingSale} className="prod-btn-primary">
                  {isAddingSale ? '...' : isVi ? 'Lưu' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Compact 4-Stat Strip */}
      <div className="adj-header-stats">
        <div className="adj-stat-card">
          <span className="adj-stat-title">{isVi ? 'TỔNG SẢN LƯỢNG' : 'TOTAL VOLUME'}</span>
          <div className="adj-stat-val-row">
            <h2>{salesSummary?.total_quantity?.toLocaleString() ?? 0}</h2>
          </div>
        </div>
        <div className="adj-stat-card">
          <span className="adj-stat-title">{isVi ? 'TRUNG BÌNH / NGÀY' : 'AVG / DAY'}</span>
          <div className="adj-stat-val-row">
            <h2>
              {salesSummary?.average_daily_quantity != null
                ? Number(salesSummary.average_daily_quantity).toFixed(1)
                : '0'}
            </h2>
          </div>
        </div>
        <div className="adj-stat-card">
          <span className="adj-stat-title">{isVi ? 'SỐ GIAO DỊCH' : 'RECORDS'}</span>
          <div className="adj-stat-val-row">
            <h2>{salesSummary?.total_records?.toLocaleString() ?? salesTotal}</h2>
          </div>
        </div>
        <div className="adj-stat-card">
          <span className="adj-stat-title">{isVi ? 'DẢI NGÀY' : 'DATE RANGE'}</span>
          <div className="adj-stat-val-row">
            <h2 style={{ fontSize: '0.95rem' }}>
              {salesSummary?.min_date ? `${salesSummary.min_date} → ${salesSummary.max_date}` : 'All'}
            </h2>
          </div>
        </div>
      </div>

      {/* Filter & Inline CSV Bar */}
      <div className="prod-filter-bar">
        <div className="prod-filter-group">
          <div className="prod-filter-item">
            <span className="prod-filter-label">SKU</span>
            <input
              type="text"
              placeholder="FOODS_1_001"
              className="prod-filter-input"
              value={salesFilterSku}
              onChange={(e) => setSalesFilterSku(e.target.value)}
            />
          </div>
          <div className="prod-filter-item">
            <span className="prod-filter-label">{isVi ? 'TỪ NGÀY' : 'FROM'}</span>
            <input
              type="date"
              className="prod-filter-input"
              value={salesStartDate}
              onChange={(e) => setSalesStartDate(e.target.value)}
            />
          </div>
          <div className="prod-filter-item">
            <span className="prod-filter-label">{isVi ? 'ĐẾN NGÀY' : 'TO'}</span>
            <input
              type="date"
              className="prod-filter-input"
              value={salesEndDate}
              onChange={(e) => setSalesEndDate(e.target.value)}
            />
          </div>
        </div>
        <div className="prod-filter-actions">
          <button className="prod-btn-outline" onClick={loadSalesData}>
            {isVi ? 'Lọc' : 'Filter'}
          </button>
          {isAdmin && (
            <>
              <input
                type="file"
                id="sales-csv-upload"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files?.[0]) setSalesCsvFile(e.target.files[0]);
                }}
              />
              <label
                htmlFor="sales-csv-upload"
                className="prod-btn-outline"
                style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <Upload size={13} /> {salesCsvFile ? salesCsvFile.name.slice(0, 14) : 'CSV'}
              </label>
              {salesCsvFile && (
                <button
                  className="prod-btn-primary"
                  onClick={handleSalesCsvUpload}
                  disabled={isImportingSalesCsv}
                >
                  {isImportingSalesCsv ? '...' : isVi ? 'Nạp' : 'Import'}
                </button>
              )}
              <button className="prod-btn-primary" onClick={() => setShowAddSaleModal(true)}>
                <Plus size={14} style={{ marginRight: '4px', display: 'inline' }} />{' '}
                {isVi ? 'Thêm' : 'Add'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="adj-table-container">
        <table className="adj-table">
          <thead>
            <tr>
              <th>{isVi ? 'NGÀY BÁN' : 'DATE'}</th>
              <th>SKU</th>
              <th>{isVi ? 'KHO' : 'STORE'}</th>
              <th className="text-right">{isVi ? 'SỐ LƯỢNG' : 'QUANTITY'}</th>
              <th>ID</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingSales ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                  {isVi ? 'Đang tải...' : 'Loading...'}
                </td>
              </tr>
            ) : salesList.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                  {isVi ? 'Không có bản ghi.' : 'No records.'}
                </td>
              </tr>
            ) : (
              paginatedSales.map((s, i) => (
                <tr key={s.id || i}>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{s.sale_date}</td>
                  <td className="fw-700 text-dark">{s.item_id}</td>
                  <td>{s.store_id}</td>
                  <td className="text-right fw-700 text-teal">{Number(s.quantity).toLocaleString()}</td>
                  <td className="text-secondary" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                    {s.id ? `${s.id.slice(0, 8)}` : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <Pagination
          currentPage={salesPage}
          totalItems={salesList.length}
          pageSize={salesPageSize}
          onPageChange={setSalesPage}
          onPageSizeChange={setSalesPageSize}
          pageSizeOptions={[15, 30, 50]}
        />
      </div>
    </div>
  );

  const renderEventsTab = () => {
    const filteredEvents = eventsList.filter((ev) => {
      const q = eventSearch.toLowerCase().trim();
      if (!q) return true;
      return (
        ev.event_name?.toLowerCase().includes(q) ||
        ev.event_type?.toLowerCase().includes(q) ||
        (ev.details && ev.details.toLowerCase().includes(q)) ||
        (ev.start_date && String(ev.start_date).toLowerCase().includes(q))
      );
    });

    const paginatedEvents = filteredEvents.slice(
      (eventsPage - 1) * eventsPageSize,
      eventsPage * eventsPageSize
    );

    return (
      <div className="events-view animate-fade-in">
        {showAddEventModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md p-6 w-full max-w-md shadow-xl">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 className="text-lg font-bold" style={{ margin: 0 }}>
                  {isVi ? 'Thêm Sự Kiện' : 'Add Event'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddEventModal(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={18} />
                </button>
              </div>

              {calendarEventMsg && (
                <div className="modal-error-box">
                  <AlertCircle size={15} />
                  <span>{calendarEventMsg}</span>
                </div>
              )}

              <form onSubmit={handleCreateCalendarEvent}>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                    {isVi ? 'TÊN SỰ KIỆN *' : 'EVENT NAME *'}
                  </label>
                  <input
                    required
                    type="text"
                    value={calendarEventForm.event_name}
                    onChange={(e) => setCalendarEventForm({ ...calendarEventForm, event_name: e.target.value })}
                    className="settings-input w-full"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                    {isVi ? 'PHÂN LOẠI' : 'EVENT TYPE'}
                  </label>
                  <select
                    value={calendarEventForm.event_type}
                    onChange={(e) => setCalendarEventForm({ ...calendarEventForm, event_type: e.target.value })}
                    className="settings-select w-full"
                  >
                    {(eventTypes.length > 0 ? eventTypes : ['Promotion', 'Holiday', 'Cultural', 'National', 'Religious']).map(
                      (t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      )
                    )}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'BẮT ĐẦU *' : 'START *'}
                    </label>
                    <input
                      required
                      type="date"
                      value={calendarEventForm.start_date}
                      onChange={(e) => setCalendarEventForm({ ...calendarEventForm, start_date: e.target.value })}
                      className="settings-input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                      {isVi ? 'KẾT THÚC *' : 'END *'}
                    </label>
                    <input
                      required
                      type="date"
                      value={calendarEventForm.end_date}
                      onChange={(e) => setCalendarEventForm({ ...calendarEventForm, end_date: e.target.value })}
                      className="settings-input w-full"
                    />
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                    {isVi ? 'GHI CHÚ' : 'NOTES'}
                  </label>
                  <input
                    type="text"
                    value={calendarEventForm.details}
                    onChange={(e) => setCalendarEventForm({ ...calendarEventForm, details: e.target.value })}
                    className="settings-input w-full"
                  />
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button type="button" onClick={() => setShowAddEventModal(false)} className="prod-btn-outline">
                    {isVi ? 'Hủy' : 'Cancel'}
                  </button>
                  <button type="submit" disabled={isCreatingCalendarEvent} className="prod-btn-primary">
                    {isCreatingCalendarEvent ? '...' : isVi ? 'Lưu' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="prod-filter-bar">
          <div className="prod-filter-group">
            <div className="prod-filter-item">
              <span className="prod-filter-label">{isVi ? 'LOẠI SỰ KIỆN' : 'EVENT TYPE'}</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select
                  className="prod-filter-select"
                  value={selectedEventType}
                  onChange={(e) => setSelectedEventType(e.target.value)}
                >
                  <option value="All">{isVi ? 'Tất cả' : 'All'}</option>
                  {eventTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button className="prod-btn-outline" onClick={loadEventsData}>
                  {isVi ? 'Lọc' : 'Filter'}
                </button>
              </div>
            </div>
            <div className="prod-filter-item" style={{ flex: 1, minWidth: '200px' }}>
              <span className="prod-filter-label">{isVi ? 'TÌM SỰ KIỆN' : 'SEARCH'}</span>
              <input
                type="text"
                placeholder={isVi ? 'Tên sự kiện hoặc ngày...' : 'Event name or date...'}
                className="prod-filter-input"
                value={eventSearch}
                onChange={(e) => {
                  setEventSearch(e.target.value);
                  setEventsPage(1);
                }}
              />
            </div>
          </div>
          {isAdmin && (
            <div className="prod-filter-actions">
              <button className="prod-btn-primary" onClick={() => setShowAddEventModal(true)}>
                <Plus size={14} style={{ marginRight: '4px', display: 'inline' }} />{' '}
                {isVi ? 'Thêm Sự Kiện' : 'Add Event'}
              </button>
            </div>
          )}
        </div>

        <div className="adj-table-container">
          <table className="adj-table">
            <thead>
              <tr>
                <th>{isVi ? 'SỰ KIỆN' : 'EVENT NAME'}</th>
                <th>{isVi ? 'LOẠI' : 'TYPE'}</th>
                <th>{isVi ? 'BẮT ĐẦU' : 'START'}</th>
                <th>{isVi ? 'KẾT THÚC' : 'END'}</th>
                <th>{isVi ? 'GHI CHÚ' : 'NOTES'}</th>
                <th className="text-right">{isVi ? 'XÓA' : 'ACTION'}</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingEvents ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    {isVi ? 'Đang tải...' : 'Loading...'}
                  </td>
                </tr>
              ) : filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    {isVi ? 'Không có sự kiện.' : 'No events.'}
                  </td>
                </tr>
              ) : (
                paginatedEvents.map((ev, i) => (
                  <tr key={ev.id || i}>
                    <td className="fw-700 text-dark">{ev.event_name}</td>
                    <td>
                      <span className="status-pill active">{ev.event_type}</span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{ev.start_date || ev.event_date}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{ev.end_date || ev.start_date || '-'}</td>
                    <td className="text-secondary">{ev.details || '-'}</td>
                    <td className="text-right">
                      {isAdmin && (
                        <button
                          onClick={() => handleDeleteCalendarEvent(ev.id, ev.event_name)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <Pagination
            currentPage={eventsPage}
            totalItems={filteredEvents.length}
            pageSize={eventsPageSize}
            onPageChange={setEventsPage}
            onPageSizeChange={setEventsPageSize}
            pageSizeOptions={[5, 10, 20]}
          />
        </div>
      </div>
    );
  };

  const renderAdjustmentsTab = () => {
    const netChange = filteredAdjustments.reduce(
      (sum, a) => sum + (Number(a.new_on_hand || 0) - Number(a.old_on_hand || 0)),
      0
    );

    return (
      <div className="adj-view">
        <div className="adj-header-stats">
          <div className="adj-stat-card">
            <span className="adj-stat-title">{isVi ? 'TỔNG LƯỢT KIỂM KÊ' : 'TOTAL ADJUSTMENTS'}</span>
            <div className="adj-stat-val-row">
              <h2>{adjustments.length}</h2>
            </div>
          </div>
          <div className="adj-stat-card">
            <span className="adj-stat-title">{isVi ? 'BIẾN ĐỘNG RÒNG' : 'NET CHANGE'}</span>
            <div className="adj-stat-val-row">
              <h2>{netChange >= 0 ? `+${netChange}` : netChange}</h2>
            </div>
          </div>
        </div>

        <div className="adj-filters">
          <div className="adj-search-box">
            <Search size={14} color="#94a3b8" />
            <input
              type="text"
              placeholder={isVi ? 'Lọc theo SKU hoặc người thực hiện...' : 'Filter by SKU or operator...'}
              value={adjSearchTerm}
              onChange={(e) => {
                setAdjSearchTerm(e.target.value);
                setAdjPage(1);
              }}
            />
          </div>
        </div>

        <div className="adj-table-container">
          <table className="adj-table">
            <thead>
              <tr>
                <th>{isVi ? 'THỜI GIAN' : 'TIMESTAMP'}</th>
                <th>SKU</th>
                <th>{isVi ? 'KHO' : 'STORE'}</th>
                <th className="text-right">{isVi ? 'CŨ' : 'OLD'}</th>
                <th className="text-right">{isVi ? 'MỚI' : 'NEW'}</th>
                <th className="text-right">{isVi ? 'LỆCH' : 'DELTA'}</th>
                <th>{isVi ? 'LÝ DO' : 'REASON'}</th>
                <th>{isVi ? 'NGƯỜI SỬA' : 'USER'}</th>
              </tr>
            </thead>
            <tbody>
              {paginatedAdjustments.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    {isVi ? 'Chưa có dữ liệu.' : 'No records.'}
                  </td>
                </tr>
              ) : (
                paginatedAdjustments.map((adj, i) => {
                  const change = (adj.new_on_hand ?? 0) - (adj.old_on_hand ?? 0);
                  return (
                    <tr key={adj.id || i}>
                      <td className="text-secondary" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                        {adj.created_at ? new Date(adj.created_at).toLocaleString() : 'N/A'}
                      </td>
                      <td className="fw-700 text-dark">{adj.item_id}</td>
                      <td>{adj.store_id}</td>
                      <td className="text-right">{adj.old_on_hand}</td>
                      <td className="text-right">{adj.new_on_hand}</td>
                      <td className="text-right">
                        <span className={`adj-change ${change > 0 ? 'pos' : change < 0 ? 'neg' : 'zero'}`}>
                          {change > 0 ? `+${change}` : change}
                        </span>
                      </td>
                      <td>
                        <span className="adj-type-badge blue">{adj.reason || 'Cycle count'}</span>
                      </td>
                      <td className="text-secondary">{adj.adjusted_by || 'Staff'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <Pagination
            currentPage={adjPage}
            totalItems={filteredAdjustments.length}
            pageSize={adjPageSize}
            onPageChange={setAdjPage}
            onPageSizeChange={setAdjPageSize}
            pageSizeOptions={[10, 20, 50]}
          />
        </div>
      </div>
    );
  };

  const tabDefinitions = [
    { key: 'Products', label: isVi ? 'Sản phẩm & Tồn kho (R, s, S)' : 'Products & Inventory (R, s, S)' },
    { key: 'Suppliers', label: isVi ? 'Nhà cung cấp' : 'Suppliers' },
    { key: 'Adjustment History', label: isVi ? 'Lịch sử Điều chỉnh' : 'Adjustments History' },
    { key: 'Sales Data', label: isVi ? 'Dữ liệu Bán hàng' : 'Sales Data' },
    { key: 'Events & Promotions', label: isVi ? 'Lịch Sự kiện' : 'Events Calendar' },
  ];

  return (
    <div className="animate-fade-in mb-6">
      {/* Compact Page Header with Inline SSE Broadcast Button */}
      <div className="prod-page-hero">
        <div>
          <div className="prod-page-eyebrow">
            <Package size={13} />
            <span>{isVi ? 'DANH MỤC SKU & TỒN KHO (R, s, S)' : 'SKU REGISTRY & (R, s, S) CONTROL'}</span>
          </div>
          <h1 className="prod-page-heading">
            {isVi ? 'Danh mục Sản phẩm & Kiểm soát Tồn kho' : 'Product Catalog & Inventory Control'}
          </h1>
          <p className="prod-page-sub">
            {isVi
              ? 'Quản lý vị thế tồn kho IP, ngưỡng (R, s, S) và chế độ nhu cầu.'
              : 'Manage SKU inventory position IP, (R, s, S) thresholds, and demand regimes.'}
          </p>
        </div>
        <div className="prod-hero-actions">
          {canEdit && (
            <button
              type="button"
              className="prod-btn-outline"
              onClick={handleCreateEvent}
              disabled={isCreatingEvent}
              title={
                isVi
                  ? 'Phát tín hiệu đồng bộ tồn kho SSE tới các phiên đang mở'
                  : 'Broadcast realtime SSE inventory sync event'
              }
            >
              <Radio size={13} style={{ marginRight: '5px', display: 'inline', color: '#0f766e' }} />
              {isCreatingEvent ? '...' : 'SSE Sync'}
            </button>
          )}
          <div className="prod-hero-store-pill">
            <StoreIcon size={13} />
            <strong>{selectedStore}</strong>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
          {isVi ? 'Đang tải danh mục...' : 'Loading catalog...'}
        </div>
      ) : (
        <>
          <div className="prod-tabs-container">
            {tabDefinitions.map((tab) => (
              <button
                key={tab.key}
                className={`prod-tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'Products' && renderProductsTab()}
          {activeTab === 'Suppliers' && renderSuppliersTab()}
          {activeTab === 'Adjustment History' && renderAdjustmentsTab()}
          {activeTab === 'Sales Data' && renderSalesDataTab()}
          {activeTab === 'Events & Promotions' && renderEventsTab()}
        </>
      )}

      {notification && (
        <div className={`global-toast-pill ${notification.type}`}>
          {notification.type === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}
          <span>{notification.message}</span>
        </div>
      )}
    </div>
  );
};
