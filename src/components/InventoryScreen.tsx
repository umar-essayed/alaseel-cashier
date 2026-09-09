import React, { useState, useEffect } from 'react';
import { Search, AlertTriangle, Settings, RefreshCw, Barcode, HelpCircle, Layers, Plus, PenSquare, ArrowLeftRight, CheckCircle2, X, Trash2 } from 'lucide-react';
import { dbClient } from '../database/dbClient';
import { ProductVariant } from '../types';

interface InventoryScreenProps {
  currentUserId: string;
  currentUsername: string;
  onRefreshData: () => void;
}

export const InventoryScreen: React.FC<InventoryScreenProps> = ({
  currentUserId,
  currentUsername,
  onRefreshData
}) => {
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [onlyLowStock, setOnlyLowStock] = useState(false);

  // Custom UI alert state
  const [alertConfig, setAlertConfig] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const showAlert = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setAlertConfig({ message, type });
  };

  // Modals state
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [adjustStockModal, setAdjustStockModal] = useState(false);
  const [editVariantModal, setEditVariantModal] = useState(false);
  const [addProductModal, setAddProductModal] = useState(false);
  const [deleteConfirmVariant, setDeleteConfirmVariant] = useState<ProductVariant | null>(null);

  const handleDeleteVariant = async () => {
    if (!deleteConfirmVariant) return;
    try {
      const res = await (window as any).api.deleteVariant(deleteConfirmVariant.id);
      if (res.success) {
        setDeleteConfirmVariant(null);
        loadVariants();
        onRefreshData();
        showAlert('تم حذف الصنف نهائياً من المخزن.', 'success');
      }
    } catch (e) {
      showAlert('فشل حذف الصنف.', 'error');
    }
  };

  // Adjust stock fields
  const [adjustQty, setAdjustQty] = useState(0);
  const [adjustReason, setAdjustReason] = useState('جرد دوري للمخزن');

  // Edit fields
  const [editOrigin, setEditOrigin] = useState('');
  const [editSpec, setEditSpec] = useState('');
  const [editCost, setEditCost] = useState(0);
  const [editSelling, setEditSelling] = useState(0);
  const [editMinLimit, setEditMinLimit] = useState(0);
  const [editBarcode, setEditBarcode] = useState('');

  // Add Product Modal states
  const [modalTab, setModalTab] = useState<'NEW_PRODUCT' | 'ADD_VARIANT'>('NEW_PRODUCT');
  const [existingProducts, setExistingProducts] = useState<any[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');

  // Add Product form fields
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('فرامل');
  const [newOrigin, setNewOrigin] = useState('');
  const [newSpec, setNewSpec] = useState('');
  const [newCost, setNewCost] = useState(0);
  const [newSelling, setNewSelling] = useState(0);
  const [newStock, setNewStock] = useState(0);
  const [newMinLimit, setNewMinLimit] = useState(3);
  const [newBarcode, setNewBarcode] = useState('');
  
  // Compatibility fields list in new product modal
  const [newCompatibilities, setNewCompatibilities] = useState<Array<{ carMake: string; carModel: string; yearStart: number; yearEnd: number }>>([]);
  const [compMake, setCompMake] = useState('');
  const [compModel, setCompModel] = useState('');
  const [compStart, setCompStart] = useState(2015);
  const [compEnd, setCompEnd] = useState(2020);
  const [soldMap, setSoldMap] = useState<Record<string, { qty: number; cost: number }>>({});

  const loadVariants = async () => {
    setLoading(true);
    try {
      const [data, saleItems] = await Promise.all([
        dbClient.getVariants(),
        dbClient.dbQuery('SELECT variant_id, quantity, cost_price FROM sale_items')
      ]);
      setVariants(data || []);
      const map: Record<string, { qty: number; cost: number }> = {};
      if (saleItems && Array.isArray(saleItems)) {
        saleItems.forEach((si: any) => {
          if (!si.variant_id) return;
          if (!map[si.variant_id]) map[si.variant_id] = { qty: 0, cost: 0 };
          map[si.variant_id].qty += Number(si.quantity) || 0;
          map[si.variant_id].cost += (Number(si.cost_price) || 0) * (Number(si.quantity) || 0);
        });
      }
      setSoldMap(map);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVariants();
  }, []);

  const openAddProductModal = async () => {
    setLoading(true);
    try {
      const prods = await dbClient.dbQuery('SELECT * FROM products ORDER BY name ASC');
      setExistingProducts(prods || []);
      
      if (prods && prods.length > 0) {
        setSelectedProductId(prods[0].id);
        setNewName(prods[0].name);
        setNewCategory(prods[0].category || 'فرامل');
        setModalTab('ADD_VARIANT');
      } else {
        setModalTab('NEW_PRODUCT');
        setNewName('');
        setNewCategory('فرامل');
      }
    } catch (err) {
      console.error('Failed to query existing products:', err);
      setModalTab('NEW_PRODUCT');
    } finally {
      setLoading(false);
      setAddProductModal(true);
    }
  };

  const handleProductDropdownChange = (prodId: string) => {
    setSelectedProductId(prodId);
    const matched = existingProducts.find(p => p.id === prodId);
    if (matched) {
      setNewName(matched.name);
      setNewCategory(matched.category || 'فرامل');
    }
  };

  const handleAutoGenerateBarcode = () => {
    const generated = Math.floor(1000000000 + Math.random() * 9000000000).toString();
    setNewBarcode(generated);
  };

  const handleAddCompatibility = () => {
    if (!compMake || !compModel) {
      showAlert('يرجى كتابة ماركة السيارة وموديلها!', 'warning');
      return;
    }
    setNewCompatibilities([
      ...newCompatibilities,
      { carMake: compMake, carModel: compModel, yearStart: Number(compStart), yearEnd: Number(compEnd) }
    ]);
    setCompMake('');
    setCompModel('');
  };

  const handleRemoveCompatibility = (idx: number) => {
    setNewCompatibilities(newCompatibilities.filter((_, i) => i !== idx));
  };

  const handleAddProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newOrigin || !newBarcode) {
      showAlert('يرجى ملء الحقول الأساسية: الاسم، بلد المنشأ، والباركود!', 'warning');
      return;
    }

    try {
      const res = await dbClient.addProduct({
        productName: newName,
        category: newCategory,
        origin: newOrigin,
        specification: newSpec,
        costPrice: Number(newCost),
        sellingPrice: Number(newSelling),
        stockQuantity: Number(newStock),
        minLimit: Number(newMinLimit),
        barcode: newBarcode,
        compatibility: newCompatibilities
      }, currentUserId, currentUsername);

      if (res.success) {
        setAddProductModal(false);
        resetAddProductForm();
        loadVariants();
        onRefreshData();
        showAlert('تم حفظ وتأسيس قطعة الغيار بنجاح في قاعدة البيانات المحلية.', 'success');
      }
    } catch (err) {
      showAlert('خطأ أثناء تكويد وإضافة الصنف الجديد بقاعدة البيانات.', 'error');
      console.error(err);
    }
  };

  const resetAddProductForm = () => {
    setNewName('');
    setNewOrigin('');
    setNewSpec('');
    setNewCost(0);
    setNewSelling(0);
    setNewStock(0);
    setNewMinLimit(3);
    setNewBarcode('');
    setNewCompatibilities([]);
  };

  const openAdjustStock = (variant: ProductVariant) => {
    setSelectedVariant(variant);
    setAdjustQty(variant.stock_quantity);
    setAdjustReason('جرد دوري للمخزن');
    setAdjustStockModal(true);
  };

  const handleAdjustStockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVariant) return;

    try {
      const res = await dbClient.updateVariantStock(
        selectedVariant.id,
        adjustQty,
        currentUserId,
        currentUsername,
        adjustReason
      );

      if (res.success) {
        setAdjustStockModal(false);
        loadVariants();
        onRefreshData();
        showAlert('تم تعديل رصيد المخزن للقطعة بنجاح.', 'success');
      }
    } catch (err) {
      showAlert('خطأ أثناء تعديل كمية المخزن.', 'error');
      console.error(err);
    }
  };

  const openEditVariant = (variant: ProductVariant) => {
    setSelectedVariant(variant);
    setEditOrigin(variant.origin);
    setEditSpec(variant.specification || '');
    setEditCost(variant.cost_price);
    setEditSelling(variant.selling_price);
    setEditMinLimit(variant.min_limit);
    setEditBarcode(variant.sku_barcode);
    setEditVariantModal(true);
  };

  const handleEditVariantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVariant) return;

    try {
      const res = await dbClient.editVariant(
        {
          id: selectedVariant.id,
          origin: editOrigin,
          specification: editSpec,
          cost_price: Number(editCost),
          selling_price: Number(editSelling),
          min_limit: Number(editMinLimit),
          sku_barcode: editBarcode
        },
        currentUserId,
        currentUsername
      );

      if (res.success) {
        setEditVariantModal(false);
        loadVariants();
        onRefreshData();
        showAlert('تم تحديث بيانات الصنف بنجاح.', 'success');
      }
    } catch (err) {
      showAlert('خطأ أثناء تحديث بيانات الصنف. قد يكون الباركود مكرراً.', 'error');
      console.error(err);
    }
  };

  const categories = Array.from(new Set(variants.map(v => v.category || 'عام'))).filter(Boolean);

  const filtered = variants.filter(v => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      (v.product_name || '').toLowerCase().includes(term) ||
      (v.category || '').toLowerCase().includes(term) ||
      v.sku_barcode.includes(term) ||
      v.origin.toLowerCase().includes(term) ||
      (v.specification || '').toLowerCase().includes(term) ||
      (v.compatibility?.some(c => c.car_make.toLowerCase().includes(term) || c.car_model.toLowerCase().includes(term)) || false);

    const matchesCategory = categoryFilter === 'ALL' || (v.category || 'عام') === categoryFilter;
    const matchesLowStock = !onlyLowStock || v.stock_quantity <= v.min_limit;

    return matchesSearch && matchesCategory && matchesLowStock;
  });

  const totalItems = variants.length;
  const lowStockCount = variants.filter(v => v.stock_quantity <= v.min_limit).length;
  const totalStockValue = variants.reduce((sum, v) => sum + (v.stock_quantity * v.cost_price), 0);
  const totalSoldCost = variants.reduce((sum, v) => sum + ((soldMap[v.id]?.cost) || 0), 0);
  const totalWarehouseEnteredCost = totalStockValue + totalSoldCost;
  const totalWarehouseEnteredQty = variants.reduce((sum, v) => sum + v.stock_quantity + (soldMap[v.id]?.qty || 0), 0);

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-100px)] overflow-hidden text-main">
      {/* Top statistics summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-panel p-5 flex items-center justify-between border-l-4 border-l-blue-500 bg-panel border-main">
          <div>
            <p className="text-xs text-muted font-bold mb-1">إجمالي قطع الغيار المسجلة</p>
            <p className="text-2xl font-black">{totalItems} أصناف</p>
          </div>
          <Layers className="w-9 h-9 text-blue-500 opacity-80" />
        </div>

        <div className="glass-panel p-5 flex items-center justify-between border-l-4 border-l-rose-500 bg-panel border-main">
          <div>
            <p className="text-xs text-muted font-bold mb-1">قطع في مستوى حد الطلب الحرِج</p>
            <p className="text-2xl font-black text-rose-500 dark:text-rose-455">{lowStockCount} قطع</p>
          </div>
          <AlertTriangle className="w-9 h-9 text-rose-500 opacity-80 animate-pulse" />
        </div>

        <div className="glass-panel p-5 flex items-center justify-between border-l-4 border-l-emerald-500 bg-panel border-main">
          <div>
            <p className="text-xs text-muted font-bold mb-1">قيمة المخزون الحالي (المتاح للتكلفة)</p>
            <p className="text-2xl font-black text-emerald-500 dark:text-emerald-400">{totalStockValue.toLocaleString()} ج.م</p>
          </div>
          <Settings className="w-9 h-9 text-emerald-500 opacity-80" />
        </div>

        <div className="glass-panel p-5 flex items-center justify-between border-l-4 border-l-purple-500 bg-panel border-main">
          <div>
            <p className="text-xs text-purple-600 dark:text-purple-400 font-extrabold mb-1">إجمالي ما دخل المخزن (تراكمي)</p>
            <p className="text-2xl font-black text-purple-600 dark:text-purple-400">{totalWarehouseEnteredCost.toLocaleString()} ج.م</p>
            <p className="text-[10px] text-muted font-bold mt-0.5">{totalWarehouseEnteredQty.toLocaleString()} وحدة (متاح + مباع)</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500 font-black text-lg">
            ▣
          </div>
        </div>
      </div>

      {/* Filter and control panel */}
      <div className="glass-panel p-4 flex flex-col md:flex-row gap-4 items-center justify-between bg-panel border-main">
        <div className="flex flex-col md:flex-row gap-4 items-center flex-1 w-full">
          {/* Search */}
          <div className="relative flex-1 w-full md:max-w-md">
            <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-muted">
              <Search className="w-5 h-5" />
            </span>
            <input
              type="text"
              className="w-full bg-input-field border border-main text-main placeholder-slate-400 dark:placeholder-slate-650 rounded-xl py-2.5 pr-10 pl-4 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="ابحث بالاسم، الموديل، الباركود، بلد المنشأ..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Category Filter */}
          <div className="w-full md:w-48">
            <select
              className="w-full bg-input-field border border-main text-main rounded-xl py-2.5 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm cursor-pointer"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="ALL">جميع الأقسام</option>
              {categories.map((c, idx) => (
                <option key={idx} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Low Stock Toggle */}
          <label className="flex items-center gap-2 cursor-pointer self-start md:self-auto mt-2 md:mt-0 select-none">
            <input
              type="checkbox"
              className="w-4.5 h-4.5 rounded bg-input-field border-main text-rose-500 focus:ring-rose-500"
              checked={onlyLowStock}
              onChange={(e) => setOnlyLowStock(e.target.checked)}
            />
            <span className="text-xs font-bold text-rose-500 dark:text-rose-455">عرض المخزون الحرج فقط</span>
          </label>
        </div>

        {/* Action Controls */}
        <div className="flex gap-2 w-full md:w-auto">
          <button
            onClick={openAddProductModal}
            className="flex-1 md:flex-none bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold py-2.5 px-5 rounded-xl transition-all text-sm flex items-center justify-center gap-1.5"
          >
            <Plus className="w-5 h-5" />
            تكويد وإضافة قطعة
          </button>

          <button
            onClick={loadVariants}
            disabled={loading}
            className="bg-main hover:bg-panel-hover border border-main p-2.5 rounded-xl transition-all disabled:opacity-50 text-muted hover:text-main"
            title="تحديث البيانات"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Grid/Table of items */}
      <div className="flex-1 overflow-y-auto border border-main rounded-2xl bg-panel">
        <table className="w-full text-right border-collapse">
          <thead>
            <tr className="bg-panel-accent text-muted border-b border-main text-xs font-bold uppercase tracking-wider sticky top-0 z-10">
              <th className="py-4 px-6">القطعة / الباركود</th>
              <th className="py-4 px-6">المنشأ / الوصف</th>
              <th className="py-4 px-6 text-center">الكمية الحالية</th>
              <th className="py-4 px-6 text-center bg-purple-500/5 text-purple-600 dark:text-purple-400 font-black">إجمالي ما دخل المخزن</th>
              <th className="py-4 px-6 text-center">حد الطلب (S_min)</th>
              <th className="py-4 px-6">التكلفة والبيع</th>
              <th className="py-4 px-6">التوافقية</th>
              <th className="py-4 px-6 text-center">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-main">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500 text-sm">
                  لا توجد قطع غيار مطابقة للبحث المحدد في المخزن المحلي.
                </td>
              </tr>
            ) : (
              filtered.map(variant => {
                const isLow = variant.stock_quantity <= variant.min_limit;
                return (
                  <tr
                    key={variant.id}
                    className={`hover:bg-panel-hover/50 transition-colors ${
                      isLow ? 'bg-rose-500/5 text-rose-950 dark:text-rose-100' : ''
                    }`}
                  >
                    {/* Part & Barcode */}
                    <td className="py-4 px-6">
                      <div className="font-bold text-main">{variant.product_name}</div>
                      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted bg-main w-fit px-2 py-0.5 rounded border border-main font-mono">
                        <Barcode className="w-3.5 h-3.5 text-muted" />
                        <span>{variant.sku_barcode}</span>
                      </div>
                    </td>
                    
                    {/* Origin / Spec */}
                    <td className="py-4 px-6">
                      <div className="text-sm font-bold text-main">{variant.origin}</div>
                      <div className="text-xs text-muted mt-0.5">{variant.specification || 'لا توجد مواصفات فنية إضافية'}</div>
                    </td>

                    {/* Stock */}
                    <td className="py-4 px-6 text-center">
                      <span className={`px-3 py-1 rounded-full text-xs font-black border ${
                        isLow
                          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-455 border-rose-500/20'
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-450 border-emerald-500/20'
                      }`}>
                        {variant.stock_quantity} وحدة
                      </span>
                    </td>

                    {/* Total Entered Warehouse (Cumulative) */}
                    <td className="py-4 px-6 text-center bg-purple-500/[0.02]">
                      {(() => {
                        const sold = soldMap[variant.id]?.qty || 0;
                        const totalEntered = (variant.stock_quantity || 0) + sold;
                        const totalCost = totalEntered * variant.cost_price;
                        return (
                          <div>
                            <span className="font-mono font-black text-sm text-purple-600 dark:text-purple-400">
                              {totalEntered.toLocaleString()} وحدة
                            </span>
                            <div className="text-[10px] text-muted font-bold mt-0.5">
                              بتكلفة: {totalCost.toLocaleString()} ج.م
                            </div>
                            <div className="text-[9px] text-slate-400 font-mono mt-0.5">
                              (متاح: {variant.stock_quantity} · مباع: {sold})
                            </div>
                          </div>
                        );
                      })()}
                    </td>

                    {/* Limit */}
                    <td className="py-4 px-6 text-center font-bold text-muted">
                      {variant.min_limit} وحدة
                    </td>

                    {/* Prices */}
                    <td className="py-4 px-6">
                      <div className="text-xs text-muted">التكلفة: <span className="font-bold text-main">{variant.cost_price} ج.م</span></div>
                      <div className="text-sm text-main mt-0.5 font-bold">البيع: <span className="font-black text-emerald-500 dark:text-emerald-400">{variant.selling_price} ج.م</span></div>
                    </td>

                    {/* Compatibility */}
                    <td className="py-4 px-6 max-w-xs">
                      {variant.compatibility && variant.compatibility.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {variant.compatibility.map((c, i) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 bg-main rounded text-main border border-main">
                              {c.car_make} {c.car_model} ({c.year_start}-{c.year_end})
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">متوافق مع كل الموديلات</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-6 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openAdjustStock(variant)}
                          className="bg-main hover:bg-panel-hover text-main px-3 py-1.5 rounded-lg text-xs font-bold border border-main flex items-center gap-1 transition-all active:scale-95"
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5" />
                          تعديل الكمية
                        </button>
                        
                        <button
                          onClick={() => openEditVariant(variant)}
                          className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 px-3 py-1.5 rounded-lg text-xs font-bold border border-blue-500/20 flex items-center gap-1 transition-all active:scale-95"
                        >
                          <PenSquare className="w-3.5 h-3.5" />
                          تعديل الصنف
                        </button>

                        <button
                          onClick={() => setDeleteConfirmVariant(variant)}
                          className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-455 p-1.5 rounded-lg text-xs font-bold border border-rose-500/20 flex items-center justify-center transition-all active:scale-95"
                          title="حذف نهائي"
                        >
                          <Trash2 className="w-4.5 h-4.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add New Product / Variant Modal */}
      {addProductModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-2xl space-y-5 shadow-2xl my-8">
            
            {/* Modal Title & Close */}
            <div className="flex justify-between items-center pb-2 border-b border-main">
              <div>
                <h3 className="font-bold text-lg text-main">
                  تكويد وتأسيس أصناف جديدة بالمخزن
                </h3>
                <p className="text-[10px] text-muted">اختر نوع الإدخال لربط البدائل أو إنشاء صنف مستقل</p>
              </div>
              <button onClick={() => setAddProductModal(false)} className="text-muted hover:text-main">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Segmented Control Tabs */}
            <div className="flex bg-main p-1 rounded-xl border border-main">
              <button
                type="button"
                onClick={() => {
                  setModalTab('NEW_PRODUCT');
                  resetAddProductForm();
                }}
                className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                  modalTab === 'NEW_PRODUCT'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-muted hover:text-main'
                }`}
              >
                تأسيس صنف جديد بالكامل
              </button>
              
              <button
                type="button"
                disabled={existingProducts.length === 0}
                onClick={() => {
                  setModalTab('ADD_VARIANT');
                  if (existingProducts.length > 0) {
                    handleProductDropdownChange(existingProducts[0].id);
                  }
                }}
                className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all disabled:opacity-40 ${
                  modalTab === 'ADD_VARIANT'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-muted hover:text-main'
                }`}
              >
                إضافة بديل إضافي لصنف مسجل مسبقاً ({existingProducts.length})
              </button>
            </div>

            <form onSubmit={handleAddProductSubmit} className="space-y-4">
              
              {/* Product grouping section */}
              {modalTab === 'ADD_VARIANT' ? (
                <div className="bg-panel-accent border border-main p-4 rounded-2xl">
                  <label className="block text-xs text-muted mb-2 font-bold">اختر الصنف الرئيسي المسجل *</label>
                  <select
                    className="w-full bg-input-field border border-main text-main rounded-xl py-2.5 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-semibold cursor-pointer"
                    value={selectedProductId}
                    onChange={(e) => handleProductDropdownChange(e.target.value)}
                  >
                    {existingProducts.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.category || 'عام'})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Product Name */}
                  <div>
                    <label className="block text-xs text-muted mb-1 font-bold">اسم قطعة الغيار الرئيسي *</label>
                    <input
                      type="text"
                      required
                      className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-semibold"
                      placeholder="مثال: فحمات فرامل خلفية"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  </div>

                  {/* Category */}
                  <div>
                    <label className="block text-xs text-muted mb-1 font-bold">القسم الفني الرئيسي</label>
                    <select
                      className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                    >
                      <option value="فرامل">فرامل</option>
                      <option value="عفشة وتعليق">عفشة وتعليق</option>
                      <option value="فلاتر وزيوت">فلاتر وزيوت</option>
                      <option value="كهرباء وبطاريات">كهرباء وبطاريات</option>
                      <option value="تكييف وتبريد">تكييف وتبريد</option>
                      <option value="محرك وأجزاؤه">محرك وأجزاؤه</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Variant Details Section */}
              <div className="border border-main p-4 rounded-2xl bg-panel-accent space-y-4">
                <h4 className="font-bold text-xs text-blue-500 border-b border-main pb-2">تفاصيل المتغير والمنشأ المطلوب تسجيله</h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Origin */}
                  <div>
                    <label className="block text-xs text-muted mb-1 font-bold">بلد المنشأ (الشركة المصنعة) *</label>
                    <input
                      type="text"
                      required
                      className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-semibold"
                      placeholder="مثال: ألماني (Bosch) أو كوري"
                      value={newOrigin}
                      onChange={(e) => setNewOrigin(e.target.value)}
                    />
                  </div>

                  {/* Spec */}
                  <div>
                    <label className="block text-xs text-muted mb-1 font-bold">المواصفة والوضع (التوصيف)</label>
                    <input
                      type="text"
                      className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      placeholder="مثال: يمين خلفي - سيراميك"
                      value={newSpec}
                      onChange={(e) => setNewSpec(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Cost Price */}
                  <div>
                    <label className="block text-xs text-muted mb-1 font-bold">سعر الشراء (التكلفة) *</label>
                    <input
                      type="number"
                      min="0"
                      required
                      className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold"
                      value={newCost || ''}
                      onChange={(e) => setNewCost(Math.max(0, Number(e.target.value)))}
                    />
                  </div>

                  {/* Selling Price */}
                  <div>
                    <label className="block text-xs text-muted mb-1 font-bold">سعر البيع الافتراضي *</label>
                    <input
                      type="number"
                      min="0"
                      required
                      className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold text-emerald-500"
                      value={newSelling || ''}
                      onChange={(e) => setNewSelling(Math.max(0, Number(e.target.value)))}
                    />
                  </div>

                  {/* Min Limit */}
                  <div>
                    <label className="block text-xs text-muted mb-1 font-bold">حد الأمان الأدنى (S_min) *</label>
                    <input
                      type="number"
                      min="1"
                      required
                      className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold"
                      value={newMinLimit}
                      onChange={(e) => setNewMinLimit(Math.max(1, Number(e.target.value)))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Stock Quantity */}
                  <div>
                    <label className="block text-xs text-muted mb-1 font-bold">الكمية الافتتاحية الحالية بالمخزن</label>
                    <input
                      type="number"
                      min="0"
                      required
                      className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold"
                      value={newStock}
                      onChange={(e) => setNewStock(Math.max(0, Number(e.target.value)))}
                    />
                  </div>

                  {/* Barcode input with Auto-Generate */}
                  <div>
                    <label className="block text-xs text-muted mb-1 font-bold">الباركود الفريد لهذا البديل *</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        required
                        className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                        placeholder="امسح الباركود أو اضغط توليد تلقائي"
                        value={newBarcode}
                        onChange={(e) => setNewBarcode(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={handleAutoGenerateBarcode}
                        className="bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-all shrink-0"
                      >
                        توليد تلقائي
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Compatibility builder sub-section */}
              <div className="border border-main p-4 rounded-xl space-y-3 bg-panel-accent">
                <h4 className="font-bold text-xs text-main">إعداد توافقية السيارات لهذا البديل (اختياري)</h4>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <input
                    type="text"
                    placeholder="الماركة (Toyota)"
                    className="bg-input-field border border-main text-main rounded-lg p-2 text-xs text-right focus:outline-none"
                    value={compMake}
                    onChange={(e) => setCompMake(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="الموديل (Corolla)"
                    className="bg-input-field border border-main text-main rounded-lg p-2 text-xs text-right focus:outline-none"
                    value={compModel}
                    onChange={(e) => setCompModel(e.target.value)}
                  />
                  <input
                    type="number"
                    placeholder="سنة البداية"
                    className="bg-input-field border border-main text-main rounded-lg p-2 text-xs text-right focus:outline-none"
                    value={compStart || ''}
                    onChange={(e) => setCompStart(Number(e.target.value))}
                  />
                  <button
                    type="button"
                    onClick={handleAddCompatibility}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg py-2 text-xs transition-all flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    إضافة توافق
                  </button>
                </div>

                {/* Compatibility tags list */}
                {newCompatibilities.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {newCompatibilities.map((c, idx) => (
                      <span key={idx} className="bg-main border border-main text-main text-xs px-2.5 py-1 rounded-xl flex items-center gap-2">
                        {c.carMake} {c.carModel} ({c.yearStart}-{c.yearEnd})
                        <button
                          type="button"
                          onClick={() => handleRemoveCompatibility(idx)}
                          className="text-rose-500 hover:text-rose-600 font-bold"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action submit */}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition-all shadow-md"
                >
                  حفظ وتأسيس الصنف بالمخازن
                </button>
                
                <button
                  type="button"
                  onClick={() => {
                    setAddProductModal(false);
                    resetAddProductForm();
                  }}
                  className="flex-1 bg-main hover:bg-panel-hover text-muted border border-main font-bold py-3 rounded-xl transition-all"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust Stock Level Modal */}
      {adjustStockModal && selectedVariant && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={handleAdjustStockSubmit} className="bg-panel border border-main rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <h3 className="font-bold text-lg text-main pb-2 border-b border-main">
              تعديل رصيد المخزن: {selectedVariant.product_name}
            </h3>
            
            <div>
              <label className="block text-xs text-muted mb-1">الرصيد الحالي بالمخزن</label>
              <input
                type="number"
                disabled
                className="w-full bg-main text-muted rounded-xl py-2 px-3 text-right border border-main font-bold cursor-not-allowed"
                value={selectedVariant.stock_quantity}
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 font-bold">الرصيد الفعلي الجديد *</label>
              <input
                type="number"
                min="0"
                required
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main font-bold"
                value={adjustQty}
                onChange={(e) => setAdjustQty(Math.max(0, Number(e.target.value)))}
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 font-bold">سبب التعديل (يسجل في تقرير الحركة) *</label>
              <textarea
                required
                rows={2}
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main text-sm"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl transition-all"
              >
                تأكيد وحفظ
              </button>
              <button
                type="button"
                onClick={() => setAdjustStockModal(false)}
                className="flex-1 bg-main hover:bg-panel-hover text-muted font-bold py-2.5 rounded-xl transition-all border border-main"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Variant Details Modal */}
      {editVariantModal && selectedVariant && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={handleEditVariantSubmit} className="bg-panel border border-main rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-2xl">
            <h3 className="font-bold text-lg text-main pb-2 border-b border-main">
              تعديل بيانات المتغير: {selectedVariant.product_name}
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted mb-1 font-bold">بلد المنشأ</label>
                <input
                  type="text"
                  required
                  className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main text-sm font-semibold"
                  value={editOrigin}
                  onChange={(e) => setEditOrigin(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-1 font-bold">الباركود الفريد (SKU)</label>
                <input
                  type="text"
                  required
                  className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main text-sm font-mono"
                  value={editBarcode}
                  onChange={(e) => setEditBarcode(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 font-bold">المواصفة الفنية</label>
              <input
                type="text"
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main text-sm"
                value={editSpec}
                onChange={(e) => setEditSpec(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-muted mb-1 font-bold">سعر التكلفة (ج.م)</label>
                <input
                  type="number"
                  min="0"
                  required
                  className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main font-bold"
                  value={editCost}
                  onChange={(e) => setEditCost(Math.max(0, Number(e.target.value)))}
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-1 font-bold">سعر البيع (ج.م)</label>
                <input
                  type="number"
                  min="0"
                  required
                  className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main font-bold text-emerald-500"
                  value={editSelling}
                  onChange={(e) => setEditSelling(Math.max(0, Number(e.target.value)))}
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-1 font-bold">حد الطلب (S_min)</label>
                <input
                  type="number"
                  min="1"
                  required
                  className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main font-bold"
                  value={editMinLimit}
                  onChange={(e) => setEditMinLimit(Math.max(1, Number(e.target.value)))}
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl transition-all"
              >
                تحديث وحفظ البيانات
              </button>
              <button
                type="button"
                onClick={() => setEditVariantModal(false)}
                className="flex-1 bg-main hover:bg-panel-hover text-muted font-bold py-2.5 rounded-xl transition-all border border-main"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmVariant && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-md space-y-4 text-right shadow-2xl">
            <div className="flex items-center gap-2 text-rose-500 font-bold border-b border-main pb-2">
              <AlertTriangle className="w-5 h-5" />
              <span>تنبيه: حذف صنف نهائياً</span>
            </div>
            <p className="text-sm text-main">
              هل أنت متأكد من رغبتك في حذف قطعة الغيار:
              <br />
              <strong className="text-blue-500">"{deleteConfirmVariant.product_name}" ({deleteConfirmVariant.origin})</strong>
              <br />
              ذات الباركود <strong className="font-mono bg-main px-1.5 py-0.5 rounded">{deleteConfirmVariant.sku_barcode}</strong>؟
              <br />
              <span className="text-xs text-rose-500 font-bold mt-2 block">تحذير: سيتم حذف هذا الصنف وجميع بيانات التوافقية المرتبطة به نهائياً ولا يمكن الاسترجاع!</span>
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleDeleteVariant}
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all active:scale-95 shadow-md"
              >
                نعم، احذف نهائياً
              </button>
              <button
                onClick={() => setDeleteConfirmVariant(null)}
                className="flex-1 bg-main hover:bg-panel-hover border border-main text-muted font-bold py-2.5 rounded-xl text-xs transition-all"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Custom Reusable React Alert Modal Overlay */}
      {alertConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-sm space-y-4 text-center shadow-2xl">
            <div className="text-lg font-bold text-main">إشعار النظام</div>
            <p className="text-xs text-muted leading-relaxed">{alertConfig.message}</p>
            <button
              onClick={() => setAlertConfig(null)}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all active:scale-95 shadow-md"
            >
              موافق / إغلاق
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
