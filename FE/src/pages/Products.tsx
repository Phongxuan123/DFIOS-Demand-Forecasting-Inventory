import React, { useState, useEffect } from 'react';
import { Search, Upload, Plus, Calendar as CalendarIcon, ChevronRight, Trash2, Edit, Check, AlertCircle, X } from 'lucide-react';
import { BarChart, Bar, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../context/AuthContext.tsx';
import { api } from '../services/api.ts';
import './Products.css';

export const Products: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role?.toUpperCase() || 'VIEWER';
  const canEdit = role === 'ADMIN' || role === 'WAREHOUSE MANAGER';
  const isAdmin = role === 'ADMIN';

  const [activeTab, setActiveTab] = useState('Products');
  const [isLoading, setIsLoading] = useState(true);

  // Global Toast Notifications
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  };

  // Products Tab States
  const [products, setProducts] = useState<any[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [stores, setStores] = useState<string[]>(['CA_1']);
  const [selectedStore, setSelectedStore] = useState('CA_1');

  // Filters for Products
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedDept, setSelectedDept] = useState('All');

  // Inventory Stock Adjustment in Product Detail Panel
  const [onHandValue, setOnHandValue] = useState('0');
  const [onOrderValue, setOnOrderValue] = useState('0');
  const [adjustmentReason, setAdjustmentReason] = useState('Cycle count update');
  const [skuAdjustments, setSkuAdjustments] = useState<any[]>([]);
  const [stockMessage, setStockMessage] = useState('');

  // Add / Edit Product Modals
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [productFormData, setProductFormData] = useState({ item_id: '', name: '', dept_id: '', cat_id: '' });
  const [productModalError, setProductModalError] = useState('');
  const [isSavingProduct, setIsSavingProduct] = useState(false);

  // Suppliers Tab States
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [supplierFormData, setSupplierFormData] = useState({ name: '', email: '', phone: '', lead_time_days: 5 });
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
  const [salesFilterStore, setSalesFilterStore] = useState('All');
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
  const [salesCsvResult, setSalesCsvResult] = useState<any>(null);

  // Events & Promotions Calendar Tab States
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

  // Realtime SSE Test trigger
  const [eventForm, setEventForm] = useState({ sku: '', name: '', type: 'Marketing Promotion', lift: '+20%' });
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [eventMessage, setEventMessage] = useState('');

  // Initial Data Load
  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      const [prodRes, suppRes, storesRes, adjRes, catRes, deptRes] = await Promise.all([
        api.products.getProducts({ limit: 200 }),
        api.products.getSuppliers(),
        api.inventory.getStores().catch(() => ['CA_1']),
        api.inventory.getAdjustments({ limit: 100 }),
        api.products.getCategories().catch(() => []),
        api.products.getDepartments().catch(() => []),
      ]);

      const prodList = prodRes.list || [];
      setProducts(prodList);
      const rawSuppliers = suppRes.list || [];
      const savedContacts = JSON.parse(localStorage.getItem('supplier_contacts') || '{}');
      const mergedSuppliers = rawSuppliers.map((s: any) => ({
        ...s,
        email: s.email || savedContacts[s.id]?.email || savedContacts[s.name]?.email || '',
        phone: s.phone || savedContacts[s.id]?.phone || savedContacts[s.name]?.phone || '',
      }));
      setSuppliers(mergedSuppliers);
      setStores(storesRes.length ? storesRes : ['CA_1']);
      setSelectedStore(storesRes[0] || 'CA_1');
      setAdjustments(adjRes.list || []);
      setCategories(catRes || []);
      setDepartments(deptRes || []);

      if (prodList.length > 0) {
        selectProductItem(prodList[0], storesRes[0] || 'CA_1');
      }
      if (mergedSuppliers.length > 0) {
        setSelectedSupplier(mergedSuppliers[0]);
      }
    } catch (error) {
      console.error('Failed to load products page data', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadSalesData = async () => {
    setIsLoadingSales(true);
    try {
      const params: any = { limit: 50 };
      if (salesFilterSku.trim()) params.item_id = salesFilterSku.trim();
      if (salesFilterStore !== 'All') params.store_id = salesFilterStore;
      if (salesStartDate) params.start_date = salesStartDate;
      if (salesEndDate) params.end_date = salesEndDate;

      const [salesRes, summaryRes] = await Promise.all([
        api.sales.querySales(params),
        api.sales.getSummary({
          item_id: salesFilterSku.trim() || undefined,
          store_id: salesFilterStore !== 'All' ? salesFilterStore : undefined,
        }).catch(() => null),
      ]);
      setSalesList(salesRes.list || []);
      setSalesTotal(salesRes.total || 0);
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
        api.eventsCalendar.listEvents({
          limit: 200,
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

  const selectProductItem = async (prod: any, storeId = selectedStore) => {
    setSelectedProduct(prod);
    setStockMessage('');
    try {
      const itemDetail = await api.inventory.getItem(prod.item_id, storeId).catch(() => null);
      if (itemDetail) {
        setOnHandValue(String(itemDetail.on_hand ?? 0));
        setOnOrderValue(String(itemDetail.on_order ?? 0));
      } else {
        setOnHandValue('0');
        setOnOrderValue('0');
      }
      const skuAdj = await api.inventory.getAdjustments({ item_id: prod.item_id, limit: 5 });
      setSkuAdjustments(skuAdj.list || []);
    } catch (e) {
      console.error(e);
    }
  };

  // Stock Adjustment for selected product
  const handleInventoryUpdate = async () => {
    if (!selectedProduct) return;
    setStockMessage('');
    try {
      await api.inventory.updateInventory(selectedProduct.item_id, selectedStore, {
        on_hand: Number(onHandValue),
        on_order: Number(onOrderValue),
        reason: adjustmentReason,
      });
      setStockMessage('Stock updated successfully.');
      const adjRes = await api.inventory.getAdjustments({ limit: 100 });
      setAdjustments(adjRes.list || []);
      const skuAdj = await api.inventory.getAdjustments({ item_id: selectedProduct.item_id, limit: 5 });
      setSkuAdjustments(skuAdj.list || []);
    } catch (error: any) {
      setStockMessage(error.response?.data?.detail || 'Inventory update failed.');
    }
  };

  // Product CRUD
  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProductModalError('');
    if (!productFormData.item_id.trim() || !productFormData.name.trim()) {
      setProductModalError('Please provide both SKU / Item ID and Product Name.');
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
        showNotification(`Product "${productFormData.name.trim()}" updated successfully.`);
      } else {
        await api.products.createProduct({
          item_id: productFormData.item_id.trim(),
          name: productFormData.name.trim(),
          dept_id: productFormData.dept_id || undefined,
          cat_id: productFormData.cat_id || undefined,
        });
        showNotification(`Product "${productFormData.name.trim()}" created successfully.`);
      }
      setShowProductModal(false);
      const res = await api.products.getProducts({ limit: 200 });
      setProducts(res.list || []);
      setTotalProducts(res.total || res.list?.length || 0);
    } catch (e: any) {
      console.error(e);
      const detail = e.response?.data?.detail;
      const msg = typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d.msg).join(', ')
          : 'Failed to save product';
      setProductModalError(msg);
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleDeleteProduct = async (itemId: string) => {
    if (!window.confirm(`Are you sure you want to delete SKU ${itemId}?`)) return;
    try {
      await api.products.deleteProduct(itemId);
      showNotification(`SKU "${itemId}" deleted successfully.`);
      const res = await api.products.getProducts({ limit: 200 });
      setProducts(res.list || []);
      setTotalProducts(res.total || res.list?.length || 0);
      if (selectedProduct?.item_id === itemId) {
        setSelectedProduct(res.list?.[0] || null);
      }
    } catch (e: any) {
      console.error(e);
      showNotification(e.response?.data?.detail || 'Failed to delete product', 'error');
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
      const res = await api.products.getSuppliers();
      const rawList = res.list || [];
      const savedContacts = JSON.parse(localStorage.getItem('supplier_contacts') || '{}');
      const merged = rawList.map((s: any) => ({
        ...s,
        email: s.email || savedContacts[s.id]?.email || savedContacts[s.name]?.email || '',
        phone: s.phone || savedContacts[s.id]?.phone || savedContacts[s.name]?.phone || '',
      }));
      setSuppliers(merged);
      if (selectedSupplier) {
        const updated = merged.find((s: any) => s.id === selectedSupplier.id || s.name === selectedSupplier.name);
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
      setSupplierModalError('Tên nhà cung cấp là bắt buộc.');
      return;
    }
    if (supplierFormData.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplierFormData.email.trim())) {
      setSupplierModalError('Địa chỉ email liên hệ không đúng định dạng (ví dụ: contact@supplier.com).');
      return;
    }
    if (supplierFormData.phone?.trim() && !/^[+0-9\s\-()]{6,20}$/.test(supplierFormData.phone.trim())) {
      setSupplierModalError('Số điện thoại liên hệ phải chứa từ 6-20 ký tự số.');
      return;
    }

    setIsSavingSupplier(true);
    try {
      const payload = {
        name: supplierFormData.name.trim(),
        lead_time_days: Number(supplierFormData.lead_time_days) || 1,
      };

      let supplierId = selectedSupplier?.id;
      if (selectedSupplier && selectedSupplier.id) {
        await api.products.updateSupplier(selectedSupplier.id, payload);
        showNotification(`Cập nhật thông tin nhà cung cấp "${payload.name}" thành công!`);
      } else {
        const created = await api.products.createSupplier(payload);
        supplierId = created?.id;
        showNotification(`Thêm mới nhà cung cấp "${payload.name}" thành công!`);
      }

      // Persist Contact Info (Email & Phone)
      const contacts = JSON.parse(localStorage.getItem('supplier_contacts') || '{}');
      const contactInfo = {
        email: supplierFormData.email?.trim() || '',
        phone: supplierFormData.phone?.trim() || '',
      };
      if (supplierId) contacts[supplierId] = contactInfo;
      contacts[payload.name] = contactInfo;
      localStorage.setItem('supplier_contacts', JSON.stringify(contacts));

      setShowSupplierModal(false);
      await loadSuppliers();
    } catch (e: any) {
      console.error(e);
      const detail = e.response?.data?.detail;
      const msg = typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d.msg).join(', ')
          : 'Lỗi khi lưu thông tin nhà cung cấp';
      setSupplierModalError(msg);
    } finally {
      setIsSavingSupplier(false);
    }
  };

  const handleDeleteSupplier = async () => {
    if (!selectedSupplier || !window.confirm(`Bạn có chắc chắn muốn xóa nhà cung cấp "${selectedSupplier.name}"?`)) return;
    try {
      await api.products.deleteSupplier(selectedSupplier.id);
      showNotification(`Đã xóa nhà cung cấp "${selectedSupplier.name}" thành công!`);
      await loadSuppliers();
      setSelectedSupplier(null);
    } catch (e: any) {
      console.error(e);
      showNotification(e.response?.data?.detail || 'Không thể xóa nhà cung cấp', 'error');
    }
  };

  const openAddSupplier = () => {
    setSelectedSupplier(null);
    setSupplierModalError('');
    setSupplierFormData({ name: '', email: '', phone: '', lead_time_days: 5 });
    setShowSupplierModal(true);
  };

  const openEditSupplier = () => {
    if (!selectedSupplier) return;
    setSupplierModalError('');
    const savedContacts = JSON.parse(localStorage.getItem('supplier_contacts') || '{}');
    const extra = savedContacts[selectedSupplier.id] || savedContacts[selectedSupplier.name] || {};
    setSupplierFormData({
      name: selectedSupplier.name,
      email: selectedSupplier.email || extra.email || '',
      phone: selectedSupplier.phone || extra.phone || '',
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
      await loadSalesData();
    } catch (e: any) {
      setSaleModalMsg(e.response?.data?.detail || 'Failed to create sales record');
    } finally {
      setIsAddingSale(false);
    }
  };

  const handleSalesCsvUpload = async () => {
    if (!salesCsvFile) return;
    setIsImportingSalesCsv(true);
    setSalesCsvResult(null);
    try {
      const res = await api.sales.importCsv(salesCsvFile);
      setSalesCsvResult(res);
      setSalesCsvFile(null);
      await loadSalesData();
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Failed to import sales CSV file');
    } finally {
      setIsImportingSalesCsv(false);
    }
  };

  // Events Handlers
  const handleCreateCalendarEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!calendarEventForm.event_name.trim()) {
      setCalendarEventMsg('Tên sự kiện là bắt buộc.');
      return;
    }
    if (!calendarEventForm.start_date) {
      setCalendarEventMsg('Ngày diễn ra sự kiện là bắt buộc.');
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
      showNotification(`Thêm sự kiện "${calendarEventForm.event_name.trim()}" thành công!`);
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
      const msg = typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ')
          : (detail && typeof detail === 'object' ? JSON.stringify(detail) : 'Không thể tạo sự kiện lịch trình.');
      setCalendarEventMsg(msg);
    } finally {
      setIsCreatingCalendarEvent(false);
    }
  };

  const handleDeleteCalendarEvent = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete event "${name}"?`)) return;
    try {
      await api.eventsCalendar.deleteEvent(id);
      showNotification(`Event "${name}" deleted successfully.`);
      await loadEventsData();
    } catch (e: any) {
      showNotification(e.response?.data?.detail || 'Failed to delete event', 'error');
    }
  };

  // Realtime Event Trigger
  const handleCreateEvent = async () => {
    const sku = eventForm.sku || selectedProduct?.item_id || 'TEST_SKU';
    setIsCreatingEvent(true);
    setEventMessage('');
    try {
      const res = await api.products.publishTestEvent(sku);
      setEventMessage(`Live event published for SKU '${sku}' (Event ID: ${res.event_id || 'OK'}). Subscribers will receive realtime update.`);
    } catch (e: any) {
      setEventMessage(e.response?.data?.detail || 'Failed to publish event');
    } finally {
      setIsCreatingEvent(false);
    }
  };

  // Filtered Products
  const filteredProducts = products.filter((prod) => {
    const matchesCat = selectedCategory === 'All' || prod.cat_id === selectedCategory;
    const matchesDept = selectedDept === 'All' || prod.dept_id === selectedDept;
    const search = searchTerm.toLowerCase();
    const matchesSearch =
      !search ||
      prod.item_id?.toLowerCase().includes(search) ||
      prod.name?.toLowerCase().includes(search);
    return matchesCat && matchesDept && matchesSearch;
  });

  // Filtered Adjustments
  const filteredAdjustments = adjustments.filter((adj) => {
    const search = adjSearchTerm.toLowerCase();
    return (
      !search ||
      adj.item_id?.toLowerCase().includes(search) ||
      adj.adjusted_by?.toLowerCase().includes(search) ||
      adj.reason?.toLowerCase().includes(search)
    );
  });

  const renderProductsTab = () => {
    const prod = selectedProduct || filteredProducts[0] || {};
    return (
      <>
        {showProductModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md p-6 w-full max-w-md shadow-xl" style={{ borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 className="text-lg font-bold" style={{ margin: 0 }}>{editingProduct ? 'Edit Product' : 'Add New SKU / Product'}</h3>
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={18} />
                </button>
              </div>

              {productModalError && (
                <div style={{
                  marginBottom: '1rem',
                  padding: '0.625rem 0.75rem',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  backgroundColor: '#fef2f2',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                }}>
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  <span>{productModalError}</span>
                </div>
              )}

              <form onSubmit={handleProductSubmit}>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">SKU / ITEM ID *</label>
                  <input
                    required
                    type="text"
                    value={productFormData.item_id}
                    onChange={(e) => setProductFormData({ ...productFormData, item_id: e.target.value })}
                    className="settings-input w-full"
                    disabled={!!editingProduct}
                    placeholder="e.g. SKU-8921"
                    style={{ borderRadius: '4px' }}
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">PRODUCT NAME *</label>
                  <input
                    required
                    type="text"
                    value={productFormData.name}
                    onChange={(e) => setProductFormData({ ...productFormData, name: e.target.value })}
                    className="settings-input w-full"
                    placeholder="e.g. Premium Cotton Shirt"
                    style={{ borderRadius: '4px' }}
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">DEPARTMENT</label>
                  <input
                    type="text"
                    value={productFormData.dept_id}
                    onChange={(e) => setProductFormData({ ...productFormData, dept_id: e.target.value })}
                    className="settings-input w-full"
                    placeholder="e.g. APPAREL"
                    style={{ borderRadius: '4px' }}
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">CATEGORY</label>
                  <input
                    type="text"
                    value={productFormData.cat_id}
                    onChange={(e) => setProductFormData({ ...productFormData, cat_id: e.target.value })}
                    className="settings-input w-full"
                    placeholder="e.g. SHIRTS"
                    style={{ borderRadius: '4px' }}
                  />
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowProductModal(false)}
                    className="px-4 py-2 border border-[var(--border-color)] text-sm hover:bg-[var(--hover-bg)]"
                    style={{ borderRadius: '4px' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProduct}
                    className="px-4 py-2 bg-teal-600 text-white text-sm hover:bg-teal-700 font-semibold"
                    style={{ borderRadius: '4px' }}
                  >
                    {isSavingProduct ? 'Saving...' : 'Save Product'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="prod-filter-bar">
          <div className="prod-filter-group">
            <div className="prod-filter-item">
              <span className="prod-filter-label">CATEGORY</span>
              <select
                className="prod-filter-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="All">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="prod-filter-item">
              <span className="prod-filter-label">DEPARTMENT</span>
              <select
                className="prod-filter-select"
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
              >
                <option value="All">All Departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div className="prod-filter-item" style={{ flex: 1 }}>
              <span className="prod-filter-label">SEARCH</span>
              <input
                className="prod-filter-input"
                placeholder="Search SKU or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          {canEdit && (
            <div className="prod-filter-actions">
              <button className="prod-btn-primary" onClick={openAddProduct}>
                <Plus size={14} style={{ marginRight: '4px', display: 'inline' }} /> Add SKU
              </button>
            </div>
          )}
        </div>

        <div className="prod-main-split">
          <div className="prod-table-area">
            <div className="prod-table-header">
              <span className="prod-table-title">Product Catalog ({filteredProducts.length} of {totalProducts} SKUs)</span>
            </div>
            <div className="prod-table">
              <div className="prod-thead">
                <div className="col-sku">SKU ID</div>
                <div className="col-name">NAME</div>
                <div className="col-dept">DEPT</div>
                <div className="col-cat">CATEGORY</div>
                <div className="col-actions">ACTIONS</div>
              </div>
              <div className="prod-tbody">
                {filteredProducts.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                    No products found matching filters.
                  </div>
                ) : (
                  filteredProducts.map((p) => (
                    <div
                      className={`prod-row ${selectedProduct?.item_id === p.item_id ? 'active' : ''}`}
                      key={p.item_id}
                      onClick={() => selectProductItem(p)}
                    >
                      <div className="col-sku fw-600">{p.item_id}</div>
                      <div className="col-name">{p.name}</div>
                      <div className="col-dept">{p.dept_id || '-'}</div>
                      <div className="col-cat">
                        <span className="status-pill active">{p.cat_id || 'GENERAL'}</span>
                      </div>
                      <div className="col-actions" onClick={(e) => e.stopPropagation()}>
                        {canEdit && (
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <button
                              onClick={() => openEditProduct(p)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0d9488' }}
                              title="Edit product"
                            >
                              <Edit size={14} />
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => handleDeleteProduct(p.item_id)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}
                                title="Delete SKU"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="prod-detail-panel">
            {!prod.item_id ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                Select a product from the list to view and manage inventory.
              </div>
            ) : (
              <>
                <div className="prod-detail-tags">
                  <span className="prod-tag">ACTIVE</span>
                  <span className="prod-tag">{prod.cat_id || 'CAT'}</span>
                  <span className="prod-tag">{prod.dept_id || 'DEPT'}</span>
                </div>
                <h2 className="prod-detail-title">{prod.name}</h2>
                <p className="prod-detail-subtitle">SKU: {prod.item_id}</p>

                {canEdit && (
                  <div style={{ marginBottom: '1.5rem', background: '#f8fafc', padding: '1rem', borderRadius: '8px' }}>
                    <h4 className="prod-section-title" style={{ marginBottom: '0.75rem' }}>
                      UPDATE INVENTORY
                    </h4>
                    <div className="prod-param-row">
                      <span className="prod-param-label">Store / Warehouse</span>
                      <select
                        className="prod-input-box"
                        value={selectedStore}
                        onChange={(e) => {
                          setSelectedStore(e.target.value);
                          selectProductItem(prod, e.target.value);
                        }}
                      >
                        {stores.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div className="prod-param-row" style={{ marginTop: '0.5rem' }}>
                      <span className="prod-param-label">On-hand Stock</span>
                      <input
                        className="prod-input-box"
                        type="number"
                        min="0"
                        value={onHandValue}
                        onChange={(e) => setOnHandValue(e.target.value)}
                      />
                    </div>
                    <div className="prod-param-row" style={{ marginTop: '0.5rem' }}>
                      <span className="prod-param-label">On-order Quantity</span>
                      <input
                        className="prod-input-box"
                        type="number"
                        min="0"
                        value={onOrderValue}
                        onChange={(e) => setOnOrderValue(e.target.value)}
                      />
                    </div>
                    <div style={{ marginTop: '0.5rem' }}>
                      <input
                        className="prod-filter-input"
                        placeholder="Reason (e.g. Cycle count, Restock)"
                        value={adjustmentReason}
                        onChange={(e) => setAdjustmentReason(e.target.value)}
                        style={{ width: '100%' }}
                      />
                    </div>

                    {stockMessage && (
                      <div style={{ fontSize: '12px', marginTop: '0.5rem', color: stockMessage.includes('success') ? '#0d9488' : '#ef4444' }}>
                        {stockMessage}
                      </div>
                    )}

                    <button
                      className="prod-btn-primary"
                      style={{ marginTop: '0.75rem', width: '100%' }}
                      onClick={handleInventoryUpdate}
                    >
                      Update Stock
                    </button>
                  </div>
                )}

                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 className="prod-section-title" style={{ marginBottom: '0.5rem' }}>
                    RECENT SKU ADJUSTMENTS
                  </h4>
                  {skuAdjustments.length === 0 ? (
                    <p style={{ fontSize: '12px', color: '#94a3b8' }}>No adjustments recorded for this SKU.</p>
                  ) : (
                    skuAdjustments.map((adj, i) => (
                      <div className="prod-adj-row" key={adj.id || i}>
                        <span className="prod-adj-text">
                          {adj.store_id}: {adj.old_on_hand} &rarr; {adj.new_on_hand}
                        </span>
                        <span className="prod-adj-badge">{adj.reason || 'Manual'}</span>
                      </div>
                    ))
                  )}
                </div>

                <div>
                  <div className="prod-section-header">
                    <h4 className="prod-section-title" style={{ marginBottom: 0 }}>DEMAND PREVIEW</h4>
                  </div>
                  <div className="prod-chart-placeholder" style={{ height: '80px', marginTop: '0.5rem' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[{ v: 12 }, { v: 18 }, { v: 15 }, { v: 22 }, { v: 28 }, { v: 25 }]}>
                        <Tooltip contentStyle={{ fontSize: '10px', padding: '4px' }} />
                        <Bar dataKey="v" fill="#0d9488" radius={[2, 2, 0, 0]} barSize={6} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
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
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md p-6 w-full max-w-md shadow-xl" style={{ borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="text-lg font-bold" style={{ margin: 0 }}>
                {selectedSupplier ? 'Edit Supplier' : 'Add New Supplier'}
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
              <div style={{
                marginBottom: '1rem',
                padding: '0.625rem 0.75rem',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                backgroundColor: '#fef2f2',
                color: '#b91c1c',
                border: '1px solid #fecaca',
              }}>
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>{supplierModalError}</span>
              </div>
            )}

            <form onSubmit={handleSupplierSubmit}>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">SUPPLIER NAME *</label>
                <input
                  required
                  type="text"
                  value={supplierFormData.name}
                  onChange={(e) => setSupplierFormData({ ...supplierFormData, name: e.target.value })}
                  className="settings-input w-full"
                  placeholder="e.g. Acme Logistics"
                  style={{ borderRadius: '4px' }}
                />
              </div>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">EMAIL ADDRESS (CONTACT INFO)</label>
                <input
                  type="email"
                  value={supplierFormData.email}
                  onChange={(e) => setSupplierFormData({ ...supplierFormData, email: e.target.value })}
                  className="settings-input w-full"
                  placeholder="e.g. contact@supplier.com"
                  style={{ borderRadius: '4px' }}
                />
              </div>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">PHONE NUMBER (CONTACT INFO)</label>
                <input
                  type="text"
                  value={supplierFormData.phone}
                  onChange={(e) => setSupplierFormData({ ...supplierFormData, phone: e.target.value })}
                  className="settings-input w-full"
                  placeholder="e.g. +84 912 345 678"
                  style={{ borderRadius: '4px' }}
                />
              </div>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">LEAD TIME (DAYS) *</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={supplierFormData.lead_time_days}
                  onChange={(e) => setSupplierFormData({ ...supplierFormData, lead_time_days: parseInt(e.target.value) || 1 })}
                  className="settings-input w-full"
                  style={{ borderRadius: '4px' }}
                />
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  className="px-4 py-2 border border-[var(--border-color)] text-sm hover:bg-[var(--hover-bg)]"
                  style={{ borderRadius: '4px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingSupplier}
                  className="px-4 py-2 bg-teal-600 text-white text-sm hover:bg-teal-700"
                  style={{ borderRadius: '4px' }}
                >
                  {isSavingSupplier ? 'Saving...' : 'Save Supplier'}
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
              Supplier Directory
            </h2>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              {canEdit && (
                <button className="prod-btn-primary" onClick={openAddSupplier}>
                  <Plus size={14} style={{ marginRight: '4px', display: 'inline' }} /> Add Supplier
                </button>
              )}
            </div>
          </div>

          <div className="suppliers-table">
            <div className="suppliers-thead">
              <div className="col-name">SUPPLIER NAME</div>
              <div className="col-skus">CONTACT INFO</div>
              <div className="col-lead">LEAD TIME</div>
              <div className="col-rel">STATUS</div>
            </div>
            <div className="suppliers-tbody">
              {suppliers.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  No suppliers found in directory.
                </div>
              ) : (
                suppliers.map((s, i) => (
                  <div
                    className={`suppliers-row ${selectedSupplier?.id === s.id ? 'active' : ''}`}
                    key={s.id || i}
                    onClick={() => setSelectedSupplier(s)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="col-name">
                      <div className="supplier-name">{s.name}</div>
                      <div className="supplier-email">{s.email || 'No email registered'}</div>
                    </div>
                    <div className="col-skus">{s.phone || 'N/A'}</div>
                    <div className="col-lead">{s.lead_time_days ?? 5} days</div>
                    <div className="col-rel">
                      <span className="status-pill active">ACTIVE</span>
                    </div>
                    <div className="col-action">
                      <ChevronRight size={18} color="#94a3b8" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="prod-detail-panel supplier-detail">
          {!selectedSupplier ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
              Select a supplier from directory to view contract rules.
            </div>
          ) : (
            <>
              <div className="supplier-detail-header">
                <h2 className="prod-detail-title" style={{ marginBottom: '0.25rem' }}>
                  {selectedSupplier.name}
                </h2>
                <span className="status-pill active">PARTNER VENDOR</span>
              </div>

              <div className="supplier-config-section">
                <h4 className="prod-section-title">Contracted Lead Time</h4>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0d9488' }}>
                  {selectedSupplier.lead_time_days ?? 5} Days
                </div>
                <span className="supplier-input-hint">Delivery timeline used for Safety Stock and ROP calculations.</span>
              </div>

              <div className="supplier-config-section">
                <h4 className="prod-section-title">Contact Channel</h4>
                <p style={{ fontSize: '13px', margin: '4px 0' }}>Email: {selectedSupplier.email || 'N/A'}</p>
                <p style={{ fontSize: '13px', margin: '4px 0' }}>Phone: {selectedSupplier.phone || 'N/A'}</p>
              </div>

              {canEdit && (
                <div className="supplier-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
                  <button className="prod-btn-outline" onClick={openEditSupplier}>
                    Edit Supplier
                  </button>
                  {isAdmin && (
                    <button className="supplier-btn-danger" onClick={handleDeleteSupplier}>
                      Remove Supplier
                    </button>
                  )}
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
      {/* Add Single Sale Modal (Admin) */}
      {showAddSaleModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md p-6 w-full max-w-md shadow-xl" style={{ borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="text-lg font-bold" style={{ margin: 0 }}>Add Historical Sale Record</h3>
              <button
                type="button"
                onClick={() => setShowAddSaleModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
              >
                <X size={18} />
              </button>
            </div>
            {saleModalMsg && (
              <div style={{
                marginBottom: '1rem',
                padding: '0.625rem 0.75rem',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                backgroundColor: '#fef2f2',
                color: '#b91c1c',
                border: '1px solid #fecaca',
              }}>
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>{saleModalMsg}</span>
              </div>
            )}
            <form onSubmit={handleAddSaleSubmit}>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">SKU / ITEM ID *</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. FOODS_1_001"
                  value={saleFormData.item_id}
                  onChange={(e) => setSaleFormData({ ...saleFormData, item_id: e.target.value })}
                  className="settings-input w-full"
                  style={{ borderRadius: '4px' }}
                />
              </div>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">STORE / WAREHOUSE</label>
                <select
                  value={saleFormData.store_id}
                  onChange={(e) => setSaleFormData({ ...saleFormData, store_id: e.target.value })}
                  className="settings-select w-full"
                  style={{ borderRadius: '4px' }}
                >
                  {stores.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">SALE DATE *</label>
                <input
                  required
                  type="date"
                  value={saleFormData.sale_date}
                  onChange={(e) => setSaleFormData({ ...saleFormData, sale_date: e.target.value })}
                  className="settings-input w-full"
                  style={{ borderRadius: '4px' }}
                />
              </div>
              <div className="mb-4">
                <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">QUANTITY SOLD *</label>
                <input
                  required
                  type="number"
                  min="0"
                  value={saleFormData.quantity}
                  onChange={(e) => setSaleFormData({ ...saleFormData, quantity: parseInt(e.target.value) || 0 })}
                  className="settings-input w-full"
                  style={{ borderRadius: '4px' }}
                />
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddSaleModal(false)}
                  className="px-4 py-2 border border-[var(--border-color)] text-sm hover:bg-[var(--hover-bg)]"
                  style={{ borderRadius: '4px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingSale}
                  className="px-4 py-2 bg-teal-600 text-white text-sm hover:bg-teal-700"
                  style={{ borderRadius: '4px' }}
                >
                  {isAddingSale ? 'Recording...' : 'Save Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="adj-header-stats" style={{ marginBottom: '1.5rem' }}>
        <div className="adj-stat-card">
          <span className="adj-stat-title">TOTAL HISTORICAL VOLUME</span>
          <div className="adj-stat-val-row">
            <h2>{salesSummary?.total_quantity?.toLocaleString() ?? 0} units</h2>
            <span className="adj-stat-badge success">Live Query</span>
          </div>
        </div>
        <div className="adj-stat-card">
          <span className="adj-stat-title">AVG DAILY DEMAND</span>
          <div className="adj-stat-val-row">
            <h2>{salesSummary?.average_daily_quantity != null ? Number(salesSummary.average_daily_quantity).toFixed(1) : '0'} / day</h2>
            <span className="adj-stat-badge neutral">Aggregated</span>
          </div>
        </div>
        <div className="adj-stat-card">
          <span className="adj-stat-title">LOGGED TRANSACTIONS</span>
          <div className="adj-stat-val-row">
            <h2>{salesSummary?.total_records?.toLocaleString() ?? salesTotal} records</h2>
            <span className="adj-stat-badge neutral">Historical Data</span>
          </div>
        </div>
        <div className="adj-stat-card">
          <span className="adj-stat-title">DATE SPAN</span>
          <div className="adj-stat-val-row">
            <h2 style={{ fontSize: '1rem', marginTop: '0.25rem' }}>
              {salesSummary?.min_date ? `${salesSummary.min_date} &rarr; ${salesSummary.max_date}` : 'All time'}
            </h2>
          </div>
        </div>
      </div>

      {/* Filter & Action Bar */}
      <div className="prod-filter-bar" style={{ flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <div className="prod-filter-group" style={{ flexWrap: 'wrap' }}>
          <div className="prod-filter-item">
            <span className="prod-filter-label">FILTER SKU</span>
            <input
              type="text"
              placeholder="e.g. FOODS_1_001"
              className="prod-filter-input"
              value={salesFilterSku}
              onChange={(e) => setSalesFilterSku(e.target.value)}
            />
          </div>
          <div className="prod-filter-item">
            <span className="prod-filter-label">STORE</span>
            <select
              className="prod-filter-select"
              value={salesFilterStore}
              onChange={(e) => setSalesFilterStore(e.target.value)}
            >
              <option value="All">All Stores</option>
              {stores.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="prod-filter-item">
            <span className="prod-filter-label">FROM DATE</span>
            <input
              type="date"
              className="prod-filter-input"
              value={salesStartDate}
              onChange={(e) => setSalesStartDate(e.target.value)}
            />
          </div>
          <div className="prod-filter-item">
            <span className="prod-filter-label">TO DATE</span>
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
            Apply Filter
          </button>
          {isAdmin && (
            <button className="prod-btn-primary" onClick={() => setShowAddSaleModal(true)}>
              <Plus size={14} style={{ marginRight: '4px', display: 'inline' }} /> Add Sale
            </button>
          )}
        </div>
      </div>

      {/* CSV Bulk Import Section for Admin */}
      {isAdmin && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>
                Bulk Import Historical Sales CSV
              </h4>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                File columns required: <code>item_id, store_id, sale_date, quantity</code>
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <input
                type="file"
                id="sales-csv-upload"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    setSalesCsvFile(e.target.files[0]);
                    setSalesCsvResult(null);
                  }
                }}
              />
              <label htmlFor="sales-csv-upload" className="prod-btn-outline" style={{ cursor: 'pointer', margin: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Upload size={14} /> {salesCsvFile ? salesCsvFile.name : 'Choose CSV File'}
              </label>
              {salesCsvFile && (
                <button
                  className="prod-btn-primary"
                  onClick={handleSalesCsvUpload}
                  disabled={isImportingSalesCsv}
                >
                  {isImportingSalesCsv ? 'Importing...' : 'Upload & Process'}
                </button>
              )}
            </div>
          </div>
          {salesCsvResult && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', borderRadius: '4px', backgroundColor: '#ecfdf5', color: '#047857', fontSize: '12px' }}>
              <strong>Import Result:</strong> {salesCsvResult.message || 'Done'} ({salesCsvResult.inserted ?? 0} inserted, {salesCsvResult.skipped ?? 0} skipped).
            </div>
          )}
        </div>
      )}

      {/* Sales Records Table */}
      <div className="adj-table-container">
        <table className="adj-table">
          <thead>
            <tr>
              <th>SALE DATE</th>
              <th>SKU / ITEM ID</th>
              <th>STORE / WAREHOUSE</th>
              <th className="text-right">QUANTITY SOLD</th>
              <th>RECORD ID</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingSales ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                  Loading sales data from database...
                </td>
              </tr>
            ) : salesList.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                  No historical sales records match current filters.
                </td>
              </tr>
            ) : (
              salesList.map((s, i) => (
                <tr key={s.id || i}>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{s.sale_date}</td>
                  <td className="fw-700 text-dark">{s.item_id}</td>
                  <td>{s.store_id}</td>
                  <td className="text-right fw-700 text-teal">{Number(s.quantity).toLocaleString()} units</td>
                  <td className="text-secondary" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                    {s.id ? `${s.id.slice(0, 10)}...` : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="adj-footer">
          <span className="text-secondary">
            Showing {salesList.length} of {salesTotal} sales records
          </span>
        </div>
      </div>
    </div>
  );

  const renderEventsTab = () => {
    // Instant live search filter for calendar events
    const filteredEvents = eventsList.filter((ev) => {
      const q = eventSearch.toLowerCase().trim();
      if (!q) return true;
      return (
        ev.event_name?.toLowerCase().includes(q) ||
        ev.event_type?.toLowerCase().includes(q) ||
        (ev.details && ev.details.toLowerCase().includes(q)) ||
        (ev.start_date && String(ev.start_date).toLowerCase().includes(q)) ||
        (ev.end_date && String(ev.end_date).toLowerCase().includes(q))
      );
    });

    return (
      <div className="events-view animate-fade-in">
        {/* Add Calendar Event Modal (Admin) */}
        {showAddEventModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md p-6 w-full max-w-md shadow-xl" style={{ borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 className="text-lg font-bold" style={{ margin: 0 }}>Add Calendar Event</h3>
                <button
                  type="button"
                  onClick={() => setShowAddEventModal(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={18} />
                </button>
              </div>

              {calendarEventMsg && (
                <div style={{
                  marginBottom: '1rem',
                  padding: '0.625rem 0.75rem',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  backgroundColor: '#fef2f2',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                }}>
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  <span>{calendarEventMsg}</span>
                </div>
              )}

              <form onSubmit={handleCreateCalendarEvent}>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">EVENT NAME *</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Black Friday Flash Sale"
                    value={calendarEventForm.event_name}
                    onChange={(e) => setCalendarEventForm({ ...calendarEventForm, event_name: e.target.value })}
                    className="settings-input w-full"
                    style={{ borderRadius: '4px' }}
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">EVENT TYPE (COVARIATE)</label>
                  <select
                    value={calendarEventForm.event_type}
                    onChange={(e) => setCalendarEventForm({ ...calendarEventForm, event_type: e.target.value })}
                    className="settings-select w-full"
                    style={{ borderRadius: '4px' }}
                  >
                    {eventTypes.length > 0 ? (
                      eventTypes.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))
                    ) : (
                      <>
                        <option value="Promotion">Promotion</option>
                        <option value="Holiday">Holiday</option>
                        <option value="Cultural">Cultural</option>
                        <option value="National">National</option>
                        <option value="Religious">Religious</option>
                      </>
                    )}
                  </select>
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">START DATE *</label>
                  <input
                    required
                    type="date"
                    value={calendarEventForm.start_date}
                    onChange={(e) => setCalendarEventForm({ ...calendarEventForm, start_date: e.target.value })}
                    className="settings-input w-full"
                    style={{ borderRadius: '4px' }}
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">END DATE *</label>
                  <input
                    required
                    type="date"
                    value={calendarEventForm.end_date}
                    onChange={(e) => setCalendarEventForm({ ...calendarEventForm, end_date: e.target.value })}
                    className="settings-input w-full"
                    style={{ borderRadius: '4px' }}
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">DETAILS / NOTES</label>
                  <textarea
                    placeholder="Expected demand uplift notes..."
                    value={calendarEventForm.details}
                    onChange={(e) => setCalendarEventForm({ ...calendarEventForm, details: e.target.value })}
                    className="settings-input w-full"
                    style={{ height: '70px', padding: '0.5rem', borderRadius: '4px' }}
                  />
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowAddEventModal(false)}
                    className="px-4 py-2 border border-[var(--border-color)] text-sm hover:bg-[var(--hover-bg)]"
                    style={{ borderRadius: '4px' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreatingCalendarEvent}
                    className="px-4 py-2 bg-teal-600 text-white text-sm hover:bg-teal-700"
                    style={{ borderRadius: '4px' }}
                  >
                    {isCreatingCalendarEvent ? 'Saving...' : 'Add Event'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Header and Controls */}
        <div className="events-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <h2 className="events-title" style={{ margin: 0 }}>Event & Promotion Calendar</h2>
            <p className="text-secondary text-sm" style={{ margin: '4px 0 0' }}>
              Historical and planned events feed into ML temporal feature extractors as exogenous covariates.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {isAdmin && (
              <button className="prod-btn-primary" onClick={() => setShowAddEventModal(true)}>
                <Plus size={14} style={{ marginRight: '4px', display: 'inline' }} /> Add Event
              </button>
            )}
          </div>
        </div>

        {/* Filter Row */}
        <div className="prod-filter-bar" style={{ marginBottom: '1.5rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="prod-filter-item">
            <span className="prod-filter-label">EVENT TYPE</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <select
                className="prod-filter-select"
                value={selectedEventType}
                onChange={(e) => setSelectedEventType(e.target.value)}
              >
                <option value="All">All Types</option>
                {eventTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button
                className="prod-btn-outline"
                onClick={loadEventsData}
                title="Áp dụng lọc theo loại sự kiện đã chọn"
                style={{ height: '36px', whiteSpace: 'nowrap' }}
              >
                Apply Filter
              </button>
            </div>
          </div>
          <div className="prod-filter-item" style={{ flex: 1, minWidth: '240px' }}>
            <span className="prod-filter-label">SEARCH EVENT (TÌM KIẾM TỨC THÌ)</span>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Nhập tên sự kiện, loại, chi tiết hoặc ngày để lọc..."
                className="prod-filter-input"
                style={{ paddingLeft: '32px', width: '100%', height: '36px' }}
                value={eventSearch}
                onChange={(e) => setEventSearch(e.target.value)}
              />
              {eventSearch && (
                <button
                  type="button"
                  onClick={() => setEventSearch('')}
                  style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Events Table */}
        <div className="adj-table-container" style={{ marginBottom: '2rem' }}>
          <table className="adj-table">
            <thead>
              <tr>
                <th>EVENT NAME</th>
                <th>EVENT TYPE</th>
                <th>START DATE</th>
                <th>END DATE</th>
                <th>NOTES / DETAILS</th>
                <th className="text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingEvents ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    Loading events calendar...
                  </td>
                </tr>
              ) : filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    {eventSearch ? `No events match "${eventSearch}".` : 'No events found in calendar.'}
                  </td>
                </tr>
              ) : (
                filteredEvents.map((ev, i) => (
                  <tr key={ev.id || i}>
                    <td className="fw-700 text-dark">{ev.event_name}</td>
                    <td>
                      <span className="status-pill active" style={{ fontSize: '11px' }}>
                        {ev.event_type}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{ev.start_date || ev.event_date}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{ev.end_date || ev.start_date || '-'}</td>
                    <td className="text-secondary">{ev.details || '-'}</td>
                    <td className="text-right">
                      {isAdmin && (
                        <button
                          onClick={() => handleDeleteCalendarEvent(ev.id, ev.event_name)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}
                          title="Delete event"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      {/* Realtime Event Bus SSE broadcast panel */}
      <div className="prod-detail-panel event-detail" style={{ maxWidth: '650px', background: 'white', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1.5rem' }}>
        <div className="event-detail-header" style={{ marginBottom: '1rem' }}>
          <CalendarIcon size={24} color="#0d9488" style={{ marginBottom: '0.5rem' }} />
          <h3 className="prod-detail-title" style={{ fontSize: '1.1rem', margin: '0 0 4px' }}>
            Realtime Event Bus & SSE Ingestion Trigger
          </h3>
          <p className="prod-detail-subtitle" style={{ fontSize: '12px', margin: 0 }}>
            Broadcast an <code>inventory.updated</code> signal over Server-Sent Events to all active connected browser sessions.
          </p>
        </div>

        <div className="event-form">
          <div className="event-group">
            <label className="event-label">Target SKU ID</label>
            <input
              type="text"
              className="event-input"
              value={eventForm.sku || selectedProduct?.item_id || ''}
              onChange={(e) => setEventForm({ ...eventForm, sku: e.target.value })}
              placeholder="e.g. SKU-8921"
              disabled={!canEdit}
            />
          </div>
        </div>

        {eventMessage && (
          <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '6px', backgroundColor: '#f0fdfa', color: '#0d9488', fontSize: '13px' }}>
            {eventMessage}
          </div>
        )}

        {canEdit && (
          <div className="event-actions" style={{ marginTop: '1rem' }}>
            <button
              className="prod-btn-primary"
              onClick={handleCreateEvent}
              disabled={isCreatingEvent}
            >
              {isCreatingEvent ? 'Broadcasting...' : 'Publish Live SSE Event'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

  const renderAdjustmentsTab = () => {
    const netChange = filteredAdjustments.reduce((sum, a) => sum + (Number(a.new_on_hand || 0) - Number(a.old_on_hand || 0)), 0);

    return (
      <div className="adj-view">
        <div className="adj-header-stats">
          <div className="adj-stat-card">
            <span className="adj-stat-title">TOTAL LOGGED ADJUSTMENTS</span>
            <div className="adj-stat-val-row">
              <h2>{adjustments.length} Runs</h2>
              <span className="adj-stat-badge neutral">Audit Tracked</span>
            </div>
          </div>
          <div className="adj-stat-card">
            <span className="adj-stat-title">NET INVENTORY CHANGE</span>
            <div className="adj-stat-val-row">
              <h2>{netChange >= 0 ? `+${netChange}` : netChange} units</h2>
              <span className="adj-stat-badge success">Live Count</span>
            </div>
          </div>
        </div>

        <div className="adj-filters">
          <div className="adj-search-box">
            <Search size={14} color="#94a3b8" />
            <input
              type="text"
              placeholder="Filter by SKU or adjusted by..."
              value={adjSearchTerm}
              onChange={(e) => setAdjSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="adj-table-container">
          <table className="adj-table">
            <thead>
              <tr>
                <th>DATE & TIME</th>
                <th>SKU ID</th>
                <th>STORE</th>
                <th className="text-right">PREV ON-HAND</th>
                <th className="text-right">NEW ON-HAND</th>
                <th className="text-right">CHANGE</th>
                <th>REASON</th>
                <th>OPERATOR</th>
              </tr>
            </thead>
            <tbody>
              {filteredAdjustments.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    No inventory adjustments found.
                  </td>
                </tr>
              ) : (
                filteredAdjustments.map((adj, i) => {
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

          <div className="adj-footer">
            <span className="text-secondary">
              Showing {filteredAdjustments.length} of {adjustments.length} adjustment records
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="animate-fade-in mb-6">
      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
          Loading master catalog & inventory...
        </div>
      ) : (
        <>
          <div className="prod-tabs-container">
            {['Products', 'Suppliers', 'Adjustment History', 'Sales Data', 'Events & Promotions'].map((tab) => (
              <button
                key={tab}
                className={`prod-tab-btn ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
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
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            backgroundColor: notification.type === 'error' ? '#ef4444' : '#0d9488',
            color: '#ffffff',
            padding: '12px 20px',
            borderRadius: '6px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '13px',
            fontWeight: 500,
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          {notification.type === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}
          <span>{notification.message}</span>
        </div>
      )}
    </div>
  );
};
