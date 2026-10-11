import React, { useState, useEffect } from 'react';
import { Search, Upload, Plus, Calendar as CalendarIcon, ChevronRight, Trash2, Edit } from 'lucide-react';
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

  // Suppliers Tab States
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [supplierFormData, setSupplierFormData] = useState({ name: '', email: '', phone: '', lead_time_days: 5 });

  // Adjustment History Tab States
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [adjSearchTerm, setAdjSearchTerm] = useState('');

  // Sales Data (Bulk Import) Tab States
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);

  // Events Tab States
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
      setTotalProducts(prodRes.total || prodList.length);
      setSuppliers(suppRes.list || []);
      setStores(storesRes.length ? storesRes : ['CA_1']);
      setSelectedStore(storesRes[0] || 'CA_1');
      setAdjustments(adjRes.list || []);
      setCategories(catRes || []);
      setDepartments(deptRes || []);

      if (prodList.length > 0) {
        selectProductItem(prodList[0], storesRes[0] || 'CA_1');
      }
      if (suppRes.list?.length > 0) {
        setSelectedSupplier(suppRes.list[0]);
      }
    } catch (error) {
      console.error('Failed to load products page data', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

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
      // Load recent adjustments for this SKU
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
      // Refresh adjustment history
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
    try {
      if (editingProduct) {
        await api.products.updateProduct(editingProduct.item_id, {
          name: productFormData.name,
          dept_id: productFormData.dept_id || undefined,
          cat_id: productFormData.cat_id || undefined,
        });
      } else {
        await api.products.createProduct({
          item_id: productFormData.item_id,
          name: productFormData.name,
          dept_id: productFormData.dept_id || undefined,
          cat_id: productFormData.cat_id || undefined,
        });
      }
      setShowProductModal(false);
      const res = await api.products.getProducts({ limit: 200 });
      setProducts(res.list || []);
      setTotalProducts(res.total || res.list?.length || 0);
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to save product');
    }
  };

  const handleDeleteProduct = async (itemId: string) => {
    if (!window.confirm(`Are you sure you want to delete SKU ${itemId}?`)) return;
    try {
      await api.products.deleteProduct(itemId);
      const res = await api.products.getProducts({ limit: 200 });
      setProducts(res.list || []);
      setTotalProducts(res.total || res.list?.length || 0);
      if (selectedProduct?.item_id === itemId) {
        setSelectedProduct(res.list?.[0] || null);
      }
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to delete product');
    }
  };

  const openAddProduct = () => {
    setEditingProduct(null);
    setProductFormData({ item_id: '', name: '', dept_id: '', cat_id: '' });
    setShowProductModal(true);
  };

  const openEditProduct = (prod: any) => {
    setEditingProduct(prod);
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
      setSuppliers(res.list || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (selectedSupplier && selectedSupplier.id) {
        await api.products.updateSupplier(selectedSupplier.id, supplierFormData);
      } else {
        await api.products.createSupplier(supplierFormData);
      }
      setShowSupplierModal(false);
      await loadSuppliers();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to save supplier');
    }
  };

  const handleDeleteSupplier = async () => {
    if (!selectedSupplier || !window.confirm(`Are you sure you want to delete supplier "${selectedSupplier.name}"?`)) return;
    try {
      await api.products.deleteSupplier(selectedSupplier.id);
      await loadSuppliers();
      setSelectedSupplier(null);
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.detail || 'Failed to delete supplier');
    }
  };

  const openAddSupplier = () => {
    setSelectedSupplier(null);
    setSupplierFormData({ name: '', email: '', phone: '', lead_time_days: 5 });
    setShowSupplierModal(true);
  };

  const openEditSupplier = () => {
    if (!selectedSupplier) return;
    setSupplierFormData({
      name: selectedSupplier.name,
      email: selectedSupplier.email || '',
      phone: selectedSupplier.phone || '',
      lead_time_days: selectedSupplier.lead_time_days || 5,
    });
    setShowSupplierModal(true);
  };

  // Bulk File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
      setUploadResult(null);
    }
  };

  const submitFile = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setUploadResult(null);
    try {
      const result = await api.products.uploadDataFile(selectedFile);
      setUploadResult(result);
      setSelectedFile(null);
      // Reload products
      const prodRes = await api.products.getProducts({ limit: 200 });
      setProducts(prodRes.list || []);
      setTotalProducts(prodRes.total || prodRes.list?.length || 0);
    } catch (e: any) {
      alert(e.message || 'File upload failed');
    } finally {
      setIsUploading(false);
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
            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-6 w-full max-w-md shadow-xl">
              <h3 className="text-xl font-bold mb-4">{editingProduct ? 'Edit Product' : 'Add New SKU / Product'}</h3>
              <form onSubmit={handleProductSubmit}>
                <div className="mb-4">
                  <label className="block text-sm mb-1 text-[var(--text-secondary)]">SKU / Item ID</label>
                  <input
                    required
                    type="text"
                    value={productFormData.item_id}
                    onChange={(e) => setProductFormData({ ...productFormData, item_id: e.target.value })}
                    className="settings-input w-full"
                    disabled={!!editingProduct}
                    placeholder="e.g. SKU-8921"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm mb-1 text-[var(--text-secondary)]">Product Name</label>
                  <input
                    required
                    type="text"
                    value={productFormData.name}
                    onChange={(e) => setProductFormData({ ...productFormData, name: e.target.value })}
                    className="settings-input w-full"
                    placeholder="e.g. Nike Air Zoom"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm mb-1 text-[var(--text-secondary)]">Category (Cat ID)</label>
                  <input
                    type="text"
                    value={productFormData.cat_id}
                    onChange={(e) => setProductFormData({ ...productFormData, cat_id: e.target.value })}
                    className="settings-input w-full"
                    placeholder="e.g. Footwear"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm mb-1 text-[var(--text-secondary)]">Department (Dept ID)</label>
                  <input
                    type="text"
                    value={productFormData.dept_id}
                    onChange={(e) => setProductFormData({ ...productFormData, dept_id: e.target.value })}
                    className="settings-input w-full"
                    placeholder="e.g. Athletics"
                  />
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowProductModal(false)}
                    className="px-4 py-2 border border-[var(--border-color)] rounded text-sm hover:bg-[var(--hover-bg)]"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="px-4 py-2 bg-teal-600 text-white rounded text-sm hover:bg-teal-700">
                    Save Product
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="prod-filter-bar">
          <div className="prod-filter-group">
            <div className="prod-filter-item">
              <label className="prod-filter-label">Category</label>
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
              <label className="prod-filter-label">Department</label>
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
            <div className="prod-filter-item" style={{ flex: 2 }}>
              <label className="prod-filter-label">Search SKU or Name</label>
              <input
                type="text"
                className="prod-filter-input"
                placeholder="Search SKU ID or product name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div className="prod-filter-actions">
            {isAdmin && (
              <button className="prod-btn-primary" onClick={openAddProduct}>
                <Plus size={14} style={{ marginRight: '4px', display: 'inline' }} /> Add Product
              </button>
            )}
          </div>
        </div>

        <div className="prod-main-split">
          <div className="prod-table-area">
            <h2 className="prod-table-title">Monitored SKUs (Master Data - UC11)</h2>

            <div className="prod-list-header">
              <div className="prod-col-title prod-col-1">SKU ID</div>
              <div className="prod-col-title prod-col-2">PRODUCT NAME</div>
              <div className="prod-col-title prod-col-3">CATEGORY</div>
              <div className="prod-col-title prod-col-4">DEPARTMENT</div>
              <div className="prod-col-title prod-col-7" style={{ textAlign: 'right' }}>ACTIONS</div>
            </div>

            <div>
              {filteredProducts.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  No SKUs found in master data catalog.
                </div>
              ) : (
                filteredProducts.map((p, idx) => (
                  <div
                    className={`prod-row ${selectedProduct?.item_id === p.item_id ? 'active-row' : ''}`}
                    key={p.item_id || idx}
                    onClick={() => selectProductItem(p)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="prod-col-1 fw-700">{p.item_id}</div>
                    <div className="prod-col-2">{p.name}</div>
                    <div className="prod-col-3">{p.cat_id || 'General'}</div>
                    <div className="prod-col-4">{p.dept_id || 'Main'}</div>
                    <div className="prod-col-7" style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                      {isAdmin && (
                        <>
                          <button
                            className="p-1 text-slate-500 hover:text-teal-600"
                            onClick={(e) => { e.stopPropagation(); openEditProduct(p); }}
                            title="Edit Product"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            className="p-1 text-slate-500 hover:text-red-600"
                            onClick={(e) => { e.stopPropagation(); handleDeleteProduct(p.item_id); }}
                            title="Delete Product"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="prod-table-footer">
              <div className="prod-showing-text">
                Showing {filteredProducts.length} of {totalProducts} SKUs
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
                      UPDATE INVENTORY (UC13)
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
                      Update Stock (PUT /inventory)
                    </button>
                  </div>
                )}

                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 className="prod-section-title" style={{ marginBottom: '0.5rem' }}>
                    RECENT SKU ADJUSTMENTS (UC14)
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
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-xl font-bold mb-4">{selectedSupplier ? 'Edit Supplier' : 'Add New Supplier'}</h3>
            <form onSubmit={handleSupplierSubmit}>
              <div className="mb-4">
                <label className="block text-sm mb-1 text-[var(--text-secondary)]">Supplier Name</label>
                <input
                  required
                  type="text"
                  value={supplierFormData.name}
                  onChange={(e) => setSupplierFormData({ ...supplierFormData, name: e.target.value })}
                  className="settings-input w-full"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1 text-[var(--text-secondary)]">Email</label>
                <input
                  type="email"
                  value={supplierFormData.email}
                  onChange={(e) => setSupplierFormData({ ...supplierFormData, email: e.target.value })}
                  className="settings-input w-full"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1 text-[var(--text-secondary)]">Phone</label>
                <input
                  type="text"
                  value={supplierFormData.phone}
                  onChange={(e) => setSupplierFormData({ ...supplierFormData, phone: e.target.value })}
                  className="settings-input w-full"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm mb-1 text-[var(--text-secondary)]">Lead Time (Days)</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={supplierFormData.lead_time_days}
                  onChange={(e) => setSupplierFormData({ ...supplierFormData, lead_time_days: parseInt(e.target.value) || 1 })}
                  className="settings-input w-full"
                />
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  className="px-4 py-2 border border-[var(--border-color)] rounded text-sm hover:bg-[var(--hover-bg)]"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-teal-600 text-white rounded text-sm hover:bg-teal-700">
                  Save Supplier
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
              Supplier Directory (Master Data - UC12)
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
    <div className="sales-data-view">
      <div className="sales-upload-area">
        <div className="upload-box">
          <Upload size={32} color="#94a3b8" style={{ marginBottom: '1rem' }} />
          <h3 className="upload-title">Bulk Import Product Master Data (UC11)</h3>
          <p className="upload-desc">
            Upload CSV or JSON file containing product catalog items.<br />
            Required format: <code>item_id, name, dept_id, cat_id</code>.
          </p>

          {canEdit && (
            <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="file"
                id="file-upload"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
                accept=".csv,.json"
              />
              <label htmlFor="file-upload" className="prod-btn-outline" style={{ cursor: 'pointer' }}>
                Browse Files
              </label>
              {selectedFile && (
                <div style={{ fontSize: '0.875rem', marginTop: '0.5rem', fontWeight: 600 }}>
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </div>
              )}
              {selectedFile && (
                <button className="prod-btn-primary" onClick={submitFile} disabled={isUploading}>
                  {isUploading ? 'Uploading & Processing...' : 'Submit Bulk Import'}
                </button>
              )}
            </div>
          )}

          {uploadResult && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '6px', backgroundColor: '#ecfdf5', color: '#047857', fontSize: '13px' }}>
              <strong>Import Successful:</strong> {uploadResult.inserted ?? 0} items inserted, {uploadResult.skipped ?? 0} skipped. {uploadResult.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderEventsTab = () => (
    <div className="events-view">
      <div className="events-header">
        <h2 className="events-title">Realtime Event Bus & Ingestion Trigger</h2>
      </div>

      <div className="events-main-split">
        <div className="prod-detail-panel event-detail" style={{ width: '100%', maxWidth: '600px' }}>
          <div className="event-detail-header">
            <CalendarIcon size={24} color="#0d9488" style={{ marginBottom: '1rem' }} />
            <h2 className="prod-detail-title">Publish Realtime Event (SSE)</h2>
            <p className="prod-detail-subtitle">
              Broadcast an <code>inventory.updated</code> signal over the Server-Sent Events stream to all active sessions.
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
            <div className="event-actions" style={{ marginTop: '1.5rem' }}>
              <button
                className="prod-btn-primary"
                onClick={handleCreateEvent}
                disabled={isCreatingEvent}
              >
                {isCreatingEvent ? 'Broadcasting...' : 'Publish Live Event (POST /events/publish-test)'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

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
    </div>
  );
};
