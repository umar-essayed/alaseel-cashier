import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Banknote, User, AlertCircle, Printer, Sparkles, X, ChevronLeft, Bookmark, UserCheck } from 'lucide-react';
import { dbClient } from '../database/dbClient';
import { ProductVariant, Sale, SaleItem } from '../types';
import { playSound } from '../utils/audio';

interface CashierScreenProps {
  currentUserId: string;
  currentUsername: string;
  storeSettings: Record<string, string>;
  onRefreshData: () => void;
}

export const CashierScreen: React.FC<CashierScreenProps> = ({
  currentUserId,
  currentUsername,
  storeSettings,
  onRefreshData
}) => {
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<Array<ProductVariant & { quantitySelected: number }>>([]);
  const [discount, setDiscount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'VODAFONE_CASH' | 'DEBT'>('CASH');
  const [customerName, setCustomerName] = useState('');
  const [selectedCreditCustomerId, setSelectedCreditCustomerId] = useState<string | null>(null);
  const [creditCustomers, setCreditCustomers] = useState<Array<{ id: string; name: string; phone?: string; total_debt: number }>>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const customerDropdownRef = useRef<HTMLDivElement>(null);

  // Custom UI alert & confirm states (replaces browser blocking alert/confirm)
  const [confirmConfig, setConfirmConfig] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // Search focus styling state
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Auto-print toggle — persisted in localStorage
  const [autoPrint, setAutoPrint] = useState<boolean>(() => {
    try { return localStorage.getItem('cashier_auto_print') !== 'false'; } catch { return true; }
  });
  const toggleAutoPrint = () => setAutoPrint(prev => {
    const next = !prev;
    try { localStorage.setItem('cashier_auto_print', String(next)); } catch {}
    return next;
  });

  // Vodafone Cash numbers
  const vCashNumbers = useMemo(() => {
    const raw = storeSettings.vodafone_cash_numbers || '01011111111,01022222222';
    return raw.split(',').map(x => x.trim()).filter(Boolean);
  }, [storeSettings.vodafone_cash_numbers]);
  const [selectedVodafoneNumber, setSelectedVodafoneNumber] = useState(vCashNumbers[0] || '');

  // Update default vodafone cash number if settings change
  useEffect(() => {
    if (vCashNumbers.length > 0) {
      setSelectedVodafoneNumber(vCashNumbers[0]);
    }
  }, [vCashNumbers]);

  // Suspended (Held) Invoices State
  const [suspendedInvoices, setSuspendedInvoices] = useState<Array<{
    id: string;
    customerName: string;
    cart: typeof cart;
    discount: number;
    paymentMethod: 'CASH' | 'VODAFONE_CASH' | 'DEBT';
    selectedVodafoneNumber: string;
    timestamp: string;
  }>>([]);

  // Variant Picker Modal State
  const [pickerProduct, setPickerProduct] = useState<{ name: string; category: string; variants: ProductVariant[] } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load credit customers for DEBT payment dropdown
  const loadCreditCustomers = async () => {
    try {
      const data = await (window as any).api.getCreditCustomers();
      setCreditCustomers(data || []);
    } catch (e) {}
  };

  // Close customer dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node) &&
        customerInputRef.current && !customerInputRef.current.contains(e.target as Node)
      ) {
        setShowCustomerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Load available parts variants
  const loadData = async () => {
    try {
      const data = await dbClient.getVariants();
      setVariants(data);
    } catch (e) {
      console.error('Failed to load variants:', e);
    }
  };

  useEffect(() => {
    loadData();
    loadCreditCustomers();
  }, []);

  // Group variants by product name
  const groupedProducts = useMemo(() => {
    const groups: Record<string, { product_id: string; name: string; category: string; variants: ProductVariant[] }> = {};
    
    variants.forEach(v => {
      const pid = v.product_id || v.product_name || 'unknown';
      if (!groups[pid]) {
        groups[pid] = {
          product_id: pid,
          name: v.product_name || 'غير معروف',
          category: v.category || 'عام',
          variants: []
        };
      }
      groups[pid].variants.push(v);
    });

    return Object.values(groups);
  }, [variants]);

  // Global Barcode Scan Hook
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = Date.now();

    const handleKeyPress = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }

      const currentTime = Date.now();
      if (currentTime - lastKeyTime > 50) {
        buffer = '';
      }
      
      lastKeyTime = currentTime;

      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt') {
        return;
      }

      if (e.key === 'Enter') {
        if (buffer.length > 3) {
          handleBarcodeScanned(buffer);
          buffer = '';
          e.preventDefault();
        }
      } else {
        if (e.key.length === 1) {
          buffer += e.key;
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [variants, cart]);

  // Handle scanned barcode — Smart Fallback for out-of-stock variants
  const handleBarcodeScanned = (barcode: string) => {
    const cleanedBarcode = barcode.trim();
    const matched = variants.filter(v => v.sku_barcode === cleanedBarcode);

    if (matched.length === 0) {
      playSound('error');
      showTemporaryMessage(`باركود غير مسجل بالمخزن: ${cleanedBarcode}`, 'warning');
      dbClient.logActivity(currentUserId, currentUsername, 'SCAN_FAILED', `محاولة مسح باركود غير مسجل: ${cleanedBarcode}`);
      return;
    }

    // Single exact match
    if (matched.length === 1) {
      const v = matched[0];
      if (v.stock_quantity > 0) {
        playSound('scan');
        addToCart(v);
        showTemporaryMessage(`✅ تم مسح الباركود: ${v.product_name} (${v.origin})`, 'success');
        dbClient.logActivity(currentUserId, currentUsername, 'BARCODE_SCANNED', `مسح باركود ${cleanedBarcode} للصنف ${v.product_name}`);
      } else {
        // Out of stock — look for sibling variants of same product with stock
        const siblings = variants.filter(
          sv => sv.product_id === v.product_id && sv.id !== v.id && sv.stock_quantity > 0
        );
        if (siblings.length === 1) {
          playSound('scan');
          addToCart(siblings[0]);
          showTemporaryMessage(
            `⚠️ "${v.origin}" غير متاح — تم إضافة "${siblings[0].origin}" تلقائياً (${v.product_name})`,
            'warning'
          );
        } else if (siblings.length > 1) {
          playSound('scan');
          setPickerProduct({ name: v.product_name || '', category: v.category || '', variants: siblings });
          showTemporaryMessage(`⚠️ "${v.origin}" غير متاح — اختر من البدائل المتوفرة`, 'warning');
        } else {
          playSound('error');
          showTemporaryMessage(`❌ "${v.product_name}" — جميع البدائل غير متوفرة في المخزن!`, 'error');
        }
      }
      return;
    }

    // Multiple matches (shared barcode) — show only in-stock ones first
    const inStock = matched.filter(v => v.stock_quantity > 0);
    if (inStock.length === 1) {
      playSound('scan');
      addToCart(inStock[0]);
      showTemporaryMessage(`✅ تم إضافة: ${inStock[0].product_name} (${inStock[0].origin})`, 'success');
    } else if (inStock.length > 1) {
      playSound('scan');
      setPickerProduct({ name: matched[0].product_name || '', category: matched[0].category || '', variants: inStock });
      showTemporaryMessage('الباركود مشترك لعدة بدائل — يرجى اختيار المنشأ المطلوب.', 'warning');
    } else {
      playSound('error');
      showTemporaryMessage('جميع بدائل هذا الباركود غير متوفرة في المخزن!', 'error');
    }
  };


  // Keyboard Shortcuts (F1: Search, F2: Pay, F4: Hold, F5: Reset)
  useEffect(() => {
    const handleShortcuts = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        searchInputRef.current?.focus();
        playSound('scan');
      }
      if (e.key === 'F2') {
        e.preventDefault();
        handleCheckout();
      }
      if (e.key === 'F4') {
        e.preventDefault();
        handleHoldInvoice();
      }
      if (e.key === 'F5') {
        e.preventDefault();
        resetCart();
        playSound('warn');
        showTemporaryMessage('تم تفريغ سلة المشتريات بالكامل', 'warning');
      }
    };

    window.addEventListener('keydown', handleShortcuts);
    return () => window.removeEventListener('keydown', handleShortcuts);
  }, [cart, discount, paymentMethod, customerName, selectedVodafoneNumber, variants, suspendedInvoices]);

  const showTemporaryMessage = (text: string, type: 'success' | 'error' | 'warning') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  // Suspend/Hold current cart
  const handleHoldInvoice = () => {
    if (cart.length === 0) {
      playSound('error');
      showTemporaryMessage('سلة المشتريات فارغة؛ لا يمكن تعليقها!', 'warning');
      return;
    }
    const name = customerName.trim() || `عميل متردد #${suspendedInvoices.length + 1}`;
    const newSuspended = {
      id: 'susp_' + Date.now(),
      customerName: name,
      cart,
      discount,
      paymentMethod,
      selectedVodafoneNumber,
      timestamp: new Date().toLocaleTimeString('ar-EG')
    };

    setSuspendedInvoices([...suspendedInvoices, newSuspended]);
    resetCart();
    playSound('warn');
    showTemporaryMessage(`تم تعليق الفاتورة بنجاح باسم: ${name}`, 'success');
  };

  const executeResume = (item: typeof suspendedInvoices[0]) => {
    setCart(item.cart);
    setDiscount(item.discount);
    setCustomerName(item.customerName.includes('عميل متردد') ? '' : item.customerName);
    setPaymentMethod(item.paymentMethod);
    setSelectedVodafoneNumber(item.selectedVodafoneNumber);
    setSuspendedInvoices(suspendedInvoices.filter(x => x.id !== item.id));
    playSound('scan');
    showTemporaryMessage(`تم استعادة فاتورة العميل: ${item.customerName}`, 'success');
  };

  // Resume Suspended Cart
  const handleResumeInvoice = (item: typeof suspendedInvoices[0]) => {
    if (cart.length === 0) {
      executeResume(item);
    } else {
      setConfirmConfig({
        message: 'السلة الحالية بها منتجات؛ هل تريد تفريغها واستبدالها بالفاتورة المعلقة؟',
        onConfirm: () => executeResume(item)
      });
    }
  };

  // Discard Suspended Cart
  const handleDeleteSuspended = (id: string) => {
    setSuspendedInvoices(suspendedInvoices.filter(x => x.id !== id));
    playSound('error');
    showTemporaryMessage('تم إهمال الفاتورة المعلقة.', 'warning');
  };

  const addToCart = (variant: ProductVariant) => {
    if (variant.stock_quantity <= 0) {
      playSound('error');
      showTemporaryMessage('لا يوجد مخزون كافي لهذه القطعة!', 'error');
      return;
    }

    const existing = cart.find(item => item.id === variant.id);
    if (existing) {
      if (existing.quantitySelected >= variant.stock_quantity) {
        playSound('error');
        showTemporaryMessage(`الكمية المطلوبة تتجاوز المتاح في المخزن (${variant.stock_quantity} قطع)`, 'error');
        return;
      }
      setCart(
        cart.map(item =>
          item.id === variant.id ? { ...item, quantitySelected: item.quantitySelected + 1 } : item
        )
      );
    } else {
      setCart([...cart, { ...variant, quantitySelected: 1 }]);
    }
  };

  const handleProductCardClick = (prod: typeof groupedProducts[0]) => {
    if (prod.variants.length === 1) {
      playSound('scan');
      addToCart(prod.variants[0]);
    } else {
      playSound('scan');
      setPickerProduct(prod);
    }
    // Clear search after selection for clean next scan
    setSearchTerm('');
  };

  const updateCartQty = (variantId: string, newQty: number) => {
    const variant = variants.find(v => v.id === variantId);
    if (!variant) return;

    if (newQty <= 0) {
      const item = cart.find(c => c.id === variantId);
      dbClient.logActivity(currentUserId, currentUsername, 'ITEM_DELETED_FROM_CART', `حذف صنف من السلة: ${item?.product_name}`);
      setCart(cart.filter(item => item.id !== variantId));
      return;
    }

    if (newQty > variant.stock_quantity) {
      playSound('error');
      showTemporaryMessage(`الكمية المطلوبة تتجاوز المتاح في المخزن (${variant.stock_quantity} قطع)`, 'error');
      return;
    }

    setCart(
      cart.map(item =>
        item.id === variantId ? { ...item, quantitySelected: newQty } : item
      )
    );
  };

  const removeFromCart = (variantId: string) => {
    const item = cart.find(c => c.id === variantId);
    dbClient.logActivity(currentUserId, currentUsername, 'ITEM_DELETED_FROM_CART', `حذف صنف من السلة: ${item?.product_name}`);
    setCart(cart.filter(item => item.id !== variantId));
  };

  const resetCart = () => {
    setCart([]);
    setDiscount(0);
    setPaymentMethod('CASH');
    setCustomerName('');
    setSelectedCreditCustomerId(null);
  };

  const getSubtotal = () => cart.reduce((sum, item) => sum + item.selling_price * item.quantitySelected, 0);
  const getTotal = () => Math.max(0, getSubtotal() - discount);

  const handleCheckout = async () => {
    if (cart.length === 0) {
      playSound('error');
      showTemporaryMessage('سلة التسوق فارغة!', 'error');
      return;
    }

    if (paymentMethod === 'VODAFONE_CASH' && !selectedVodafoneNumber) {
      playSound('error');
      showTemporaryMessage('يرجى تحديد رقم فودافون كاش الذي استلمت عليه التحويل!', 'error');
      return;
    }

    if (paymentMethod === 'DEBT' && !selectedCreditCustomerId) {
      playSound('error');
      showTemporaryMessage('يرجى تحديد عميل آجل مربوط من القائمة لتسجيل الدين عليه!', 'error');
      return;
    }

    const saleId = 'sale_' + Math.random().toString(36).substr(2, 9);
    const invoiceNumber = 'INV-' + Date.now().toString().slice(-6);

    const saleItems: SaleItem[] = cart.map(item => ({
      variant_id: item.id,
      name: item.product_name || '',
      origin: item.origin,
      quantity: item.quantitySelected,
      unit_price: item.selling_price,
      cost_price: item.cost_price,
      total_price: item.selling_price * item.quantitySelected
    }));

    const finalCustomerName = paymentMethod === 'VODAFONE_CASH'
      ? `${customerName ? customerName : 'عميل نقدي'} (تحويل فودافون كاش: ${selectedVodafoneNumber})`
      : (customerName || 'عميل نقدي');

    const mappedPaymentMethod = paymentMethod === 'DEBT'
      ? 'DEBT'
      : (paymentMethod === 'VODAFONE_CASH' ? 'CARD' : 'CASH');

    const saleData: Sale = {
      id: saleId,
      invoice_number: invoiceNumber,
      cashier_id: currentUserId,
      cashier_name: currentUsername,
      customer_name: finalCustomerName,
      total_amount: getSubtotal(),
      discount: discount,
      final_amount: getTotal(),
      payment_method: mappedPaymentMethod,
      credit_customer_id: selectedCreditCustomerId,
      items: saleItems
    };

    try {
      const result = await dbClient.checkout(saleData, currentUsername);
      
      if (result.success) {
        playSound('success');
        showTemporaryMessage(`تمت عملية البيع بنجاح! رقم الفاتورة: ${invoiceNumber}`, 'success');
        
        if (autoPrint) {
          dbClient.printReceipt({
            storeName: storeSettings.store_name || 'الأصيل لقطع الغيار',
            phone: storeSettings.store_phone || '01012345678',
            invoiceNumber: invoiceNumber,
            cashierName: currentUsername,
            customerName: finalCustomerName,
            items: saleItems.map(x => ({
              name: x.name,
              origin: x.origin,
              qty: x.quantity,
              price: x.unit_price,
              total: x.total_price
            })),
            totalAmount: saleData.total_amount,
            discount: saleData.discount,
            finalAmount: saleData.final_amount,
            paymentMethod: mappedPaymentMethod,
            headerMsg: storeSettings.invoice_header || 'مرحباً بكم ثقة وأمان',
            footerMsg: storeSettings.invoice_footer || 'شكراً لتعاملكم معنا',
            qrCodeData: `INV-VERIFY-${invoiceNumber}-${saleData.final_amount}`
          }).catch(err => console.warn('Background printer job failed:', err));
        }

        resetCart();
        loadData();
        loadCreditCustomers();
        onRefreshData();
      }
    } catch (err) {
      console.error('Checkout failed:', err);
      playSound('error');
      showTemporaryMessage('خطأ في إتمام عملية البيع بقاعدة البيانات المحلية', 'error');
    }
  };

  const filteredProducts = groupedProducts.filter(p => {
    const term = searchTerm.toLowerCase();
    const matchesName = p.name.toLowerCase().includes(term);
    const matchesCategory = p.category.toLowerCase().includes(term);
    
    const matchesVariant = p.variants.some(v => 
      v.sku_barcode.includes(term) ||
      v.origin.toLowerCase().includes(term) ||
      (v.specification || '').toLowerCase().includes(term) ||
      v.compatibility?.some(c => 
        c.car_make.toLowerCase().includes(term) || 
        c.car_model.toLowerCase().includes(term)
      )
    );

    return matchesName || matchesCategory || matchesVariant;
  });

  // Handle Enter key in search field: auto-add product or open variant picker then clear field
  const handleSearchEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const term = searchTerm.trim();
    if (!term) return;

    // Priority 1: exact barcode match across all variants
    const exactBarcode = variants.filter(v => v.sku_barcode === term);
    if (exactBarcode.length === 1) {
      playSound('scan');
      addToCart(exactBarcode[0]);
      showTemporaryMessage(`✅ تمت إضافة: ${exactBarcode[0].product_name} (${exactBarcode[0].origin})`, 'success');
      setSearchTerm('');
      return;
    }
    if (exactBarcode.length > 1) {
      playSound('scan');
      setPickerProduct({ name: exactBarcode[0].product_name || '', category: exactBarcode[0].category || '', variants: exactBarcode });
      setSearchTerm('');
      return;
    }

    // Priority 2: single product match → add (or open picker if multiple variants)
    if (filteredProducts.length === 1) {
      const prod = filteredProducts[0];
      playSound('scan');
      if (prod.variants.length === 1) {
        addToCart(prod.variants[0]);
        showTemporaryMessage(`✅ تمت إضافة: ${prod.name}`, 'success');
      } else {
        setPickerProduct(prod);
      }
      setSearchTerm('');
      return;
    }

    // Priority 3: multiple matches — show message but don't clear
    showTemporaryMessage(`تم العثور على ${filteredProducts.length} نتائج — حدد منتجاً بالنقر أو ضيّق البحث`, 'warning');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-100px)] text-main">
      
      {/* Product List Panel (8 cols) */}
      <div className="lg:col-span-8 flex flex-col h-full bg-panel border border-main rounded-2xl overflow-hidden p-4">
        
        {/* Header Search control */}
        <div className="mb-4">
          <div className={`relative w-full transition-all duration-200 rounded-xl ${
            isSearchFocused
              ? 'ring-4 ring-blue-500/20 border-blue-500 scale-[1.005]'
              : ''
          }`}>
            <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-muted">
              <Search className={`w-5 h-5 transition-colors ${isSearchFocused ? 'text-blue-500' : ''}`} />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              className="w-full bg-input-field border border-main text-main placeholder-slate-400 dark:placeholder-slate-650 rounded-xl py-3 pr-10 pl-4 text-right focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
              placeholder="ابحث أو امسح باركود ثم اضغط Enter للإضافة الفورية... (F1 للتركيز)"
              value={searchTerm}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchEnter}
            />
          </div>
        </div>

        {/* Quick alerts display */}
        {message && (
          <div className={`p-3 rounded-xl mb-4 text-center font-semibold text-sm transition-all border ${
            message.type === 'success' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' :
            message.type === 'error' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-455 border-rose-500/20' :
            'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
          }`}>
            {message.text}
          </div>
        )}

        {/* Grouped Products Grid List */}
        <div className="flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredProducts.map(prod => {
              const totalStock = prod.variants.reduce((sum, v) => sum + v.stock_quantity, 0);
              const minPrice = Math.min(...prod.variants.map(v => v.selling_price));
              const maxPrice = Math.max(...prod.variants.map(v => v.selling_price));
              const isLowStock = prod.variants.some(v => v.stock_quantity <= v.min_limit);
              const hasMultiple = prod.variants.length > 1;

              return (
                <div
                  key={prod.product_id}
                  onClick={() => handleProductCardClick(prod)}
                  className={`glass-panel p-4 cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 transition-all flex flex-col justify-between relative group ${
                    isLowStock ? 'low-stock-row border-red-500/40' : ''
                  } ${totalStock === 0 ? 'opacity-40' : ''}`}
                >
                  <div>
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <span className="text-xs font-bold px-2.5 py-1 rounded bg-panel-accent text-muted">
                        {prod.category}
                      </span>
                      {hasMultiple && (
                        <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded">
                          {prod.variants.length} أنواع/منشأ
                        </span>
                      )}
                    </div>
                    
                    <h3 className="font-bold text-lg text-main group-hover:text-blue-500 transition-colors">
                      {prod.name}
                    </h3>

                    <p className="text-xs text-muted mt-2">
                      المنشأ المتاح: <span className="text-main font-semibold">
                        {prod.variants.map(v => v.origin.split(' ')[0]).join(' ، ')}
                      </span>
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-main flex justify-between items-center">
                    <div className="text-right">
                      <p className="text-xs text-muted">سعر البيع</p>
                      <p className="text-lg font-black text-emerald-500">
                        {hasMultiple && minPrice !== maxPrice ? (
                          `${minPrice} - ${maxPrice}`
                        ) : (
                          minPrice
                        )} <span className="text-xs font-normal">ج.م</span>
                      </p>
                    </div>
                    
                    <div className="text-left bg-main px-3 py-1.5 rounded-lg border border-main">
                      <p className="text-[10px] text-muted font-semibold">رصيد المخزن</p>
                      <p className="text-sm font-black text-main">
                        {totalStock} قطع
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Cart and Payment Checkout Panel (4 cols) */}
      <div className="lg:col-span-4 flex flex-col h-full bg-panel border border-main rounded-2xl overflow-hidden p-4">
        
        {/* Suspended Carts Widget */}
        {suspendedInvoices.length > 0 && (
          <div className="bg-amber-500/5 border border-amber-500/20 p-3 rounded-2xl mb-3 space-y-2 select-none animate-fade-in">
            <h4 className="font-bold text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1.5 animate-pulse">
              <Bookmark className="w-4 h-4" />
              فواتير معلقة بالانتظار ({suspendedInvoices.length})
            </h4>
            <div className="max-h-[90px] overflow-y-auto space-y-1.5 scrollbar-thin">
              {suspendedInvoices.map(item => (
                <div key={item.id} className="flex justify-between items-center bg-main p-2 rounded-xl border border-main text-[11px] font-semibold text-main">
                  <span className="truncate max-w-[140px]" title={item.customerName}>{item.customerName}</span>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleResumeInvoice(item)}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-2.5 py-1 rounded-lg text-[9px]"
                    >
                      استعادة
                    </button>
                    <button
                      onClick={() => handleDeleteSuspended(item.id)}
                      className="text-rose-500 hover:text-rose-600 font-black px-1.5"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cart Title */}
        <div className="flex justify-between items-center pb-3 border-b border-main">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-500" />
            <h2 className="font-bold text-lg">سلة الفاتورة</h2>
          </div>
          <span className="bg-main text-main text-xs px-2.5 py-1 rounded-full font-bold border border-main">
            {cart.reduce((s, i) => s + i.quantitySelected, 0)} أصناف
          </span>
        </div>

        {/* Cart Item Rows */}
        <div className="flex-1 overflow-y-auto my-3 pr-1 space-y-3">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted text-sm">
              <ShoppingCart className="w-12 h-12 stroke-[1] mb-2 opacity-50 text-muted" />
              سلة المشتريات فارغة
              <span className="text-xs text-slate-500 mt-1">اختر صنفاً وميزاته للبدء</span>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.id} className="bg-panel-accent border border-main p-3 rounded-xl flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm text-main truncate">{item.product_name}</h4>
                  <p className="text-xs text-muted truncate">{item.origin} - {item.specification || 'عام'}</p>
                  <p className="text-sm font-black text-emerald-500 mt-1">{(item.selling_price * item.quantitySelected).toFixed(0)} ج.م</p>
                </div>
                
                {/* Quantity Controls */}
                <div className="flex items-center gap-1 bg-main rounded-lg p-1 border border-main">
                  <button
                    onClick={() => updateCartQty(item.id, item.quantitySelected - 1)}
                    className="p-1 text-muted hover:text-main transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-8 text-center text-sm font-bold text-main">
                    {item.quantitySelected}
                  </span>
                  <button
                    onClick={() => updateCartQty(item.id, item.quantitySelected + 1)}
                    className="p-1 text-muted hover:text-main transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <button
                  onClick={() => removeFromCart(item.id)}
                  className="text-muted hover:text-rose-500 transition-colors p-1.5"
                >
                  <Trash2 className="w-4.5 h-4.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Input Details */}
        <div className="space-y-3 pt-3 border-t border-main">
          {/* Customer Name + Credit Customer Dropdown */}
          <div>
            <label className="block text-xs text-muted mb-1 font-bold">
              اسم العميل
              {selectedCreditCustomerId && (
                <span className="mr-2 text-indigo-400 font-bold text-[10px]">✓ عميل آجل مربوط</span>
              )}
            </label>
            <div className="relative">
              <User className="absolute right-3 top-2.5 w-4.5 h-4.5 text-muted" />
              <input
                ref={customerInputRef}
                type="text"
                className={`w-full bg-input-field text-main placeholder-slate-400 dark:placeholder-slate-650 rounded-xl py-1.5 pr-9 pl-3 text-right focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm border ${selectedCreditCustomerId ? 'border-indigo-500/60' : 'border-main'}`}
                placeholder="اسم العميل أو ابحث في قائمة عملاء الآجل..."
                value={customerName}
                onFocus={() => { setShowCustomerDropdown(true); loadCreditCustomers(); }}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setSelectedCreditCustomerId(null);
                  setShowCustomerDropdown(true);
                }}
              />
              {selectedCreditCustomerId && (
                <button
                  onClick={() => { setSelectedCreditCustomerId(null); setCustomerName(''); }}
                  className="absolute left-2 top-2.5 text-muted hover:text-rose-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              {/* Dropdown */}
              {showCustomerDropdown && (
                <div
                  ref={customerDropdownRef}
                  className="absolute top-full mt-1 left-0 right-0 bg-panel border border-indigo-500/30 rounded-xl shadow-2xl z-50 max-h-48 overflow-y-auto"
                >
                  {creditCustomers.length === 0 ? (
                    <div className="text-center py-3 text-muted text-xs">لا يوجد عملاء آجل مسجلون</div>
                  ) : (
                    creditCustomers
                      .filter(c => !customerName || c.name.toLowerCase().includes(customerName.toLowerCase()) || (c.phone || '').includes(customerName))
                      .map(cust => (
                        <div
                          key={cust.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setCustomerName(cust.name);
                            setSelectedCreditCustomerId(cust.id);
                            setShowCustomerDropdown(false);
                          }}
                          className="flex justify-between items-center px-3 py-2 hover:bg-indigo-500/10 cursor-pointer border-b border-main last:border-0 transition-colors"
                        >
                          <div>
                            <div className="text-xs font-bold text-main">{cust.name}</div>
                            {cust.phone && <div className="text-[10px] text-muted">{cust.phone}</div>}
                          </div>
                          <div className={`text-[10px] font-black font-mono ${cust.total_debt > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {cust.total_debt > 0 ? `${cust.total_debt.toLocaleString()} ج.م دين` : '✓ مسدد'}
                          </div>
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>
          </div>


          {/* Discount Field */}
          <div>
            <label className="block text-xs text-muted mb-1 font-bold">خصم الفاتورة (ج.م)</label>
            <input
              type="number"
              min="0"
              className="w-full bg-input-field text-main rounded-xl py-1.5 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm border border-main font-mono"
              placeholder="0"
              value={discount || ''}
              onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
            />
          </div>

          {/* Payment Method Selector */}
          <div>
            <label className="block text-xs text-muted mb-1.5 font-bold">طريقة الدفع</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('CASH')}
                className={`py-2 rounded-xl text-[10px] font-bold transition-all border flex flex-col items-center justify-center gap-1 ${
                  paymentMethod === 'CASH'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500 shadow-sm'
                    : 'bg-main text-muted border-main hover:text-main'
                }`}
              >
                <Banknote className="w-4 h-4" />
                نقدي / كاش
              </button>
              
              <button
                type="button"
                onClick={() => setPaymentMethod('VODAFONE_CASH')}
                className={`py-2 rounded-xl text-[10px] font-bold transition-all border flex flex-col items-center justify-center gap-1 ${
                  paymentMethod === 'VODAFONE_CASH'
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-455 border-rose-500 shadow-sm'
                    : 'bg-main text-muted border-main hover:text-main'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                فودافون كاش
              </button>

              <button
                type="button"
                onClick={() => {
                  setPaymentMethod('DEBT');
                  loadCreditCustomers();
                  // auto focus customer field to select customer
                  customerInputRef.current?.focus();
                }}
                className={`py-2 rounded-xl text-[10px] font-bold transition-all border flex flex-col items-center justify-center gap-1 ${
                  paymentMethod === 'DEBT'
                    ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500 shadow-sm'
                    : 'bg-main text-muted border-main hover:text-main'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                آجل / دين
              </button>
            </div>
          </div>

          {/* Target Vodafone Cash Number */}
          {paymentMethod === 'VODAFONE_CASH' && (
            <div className="bg-rose-500/5 p-3 rounded-2xl border border-rose-500/10 space-y-2 animate-fade-in select-none">
              <label className="block text-xs text-rose-600 dark:text-rose-400 font-bold">اختر رقم فودافون كاش الذي استلمت عليه التحويل *</label>
              <select
                className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-right focus:outline-none text-xs font-mono font-bold cursor-pointer"
                value={selectedVodafoneNumber}
                onChange={(e) => setSelectedVodafoneNumber(e.target.value)}
              >
                {vCashNumbers.map((num, idx) => (
                  <option key={idx} value={num}>{num}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Calculations and Checkout Action */}
        <div className="mt-4 pt-3 border-t border-main space-y-2.5">
          <div className="flex justify-between text-sm text-muted">
            <span>الإجمالي الفرعي:</span>
            <span className="font-mono">{getSubtotal().toFixed(0)} ج.م</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-sm text-rose-500 font-bold">
              <span>الخصم:</span>
              <span className="font-mono">-{discount.toFixed(0)} ج.م</span>
            </div>
          )}
          <div className="flex justify-between items-center text-lg font-black pt-1">
            <span className="text-main">الإجمالي النهائي:</span>
            <span className="text-emerald-500 text-2xl font-mono">{getTotal().toFixed(0)} ج.م</span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <button
              onClick={handleHoldInvoice}
              disabled={cart.length === 0}
              className="bg-main hover:bg-panel-hover border border-main font-bold py-3.5 rounded-xl transition-all text-main flex items-center justify-center gap-1.5 text-xs active:scale-95 disabled:opacity-40"
              title="تعليق السلة لخدمة عميل آخر بالانتظار"
            >
              <Bookmark className="w-4 h-4 text-amber-500" />
              تعليق الفاتورة [F4]
            </button>

            {/* Checkout + print toggle */}
            <div className="flex gap-1">
              <button
                onClick={handleCheckout}
                disabled={cart.length === 0}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-205 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-650 disabled:cursor-not-allowed font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-1.5 text-white shadow-md text-xs active:scale-95"
              >
                {autoPrint ? <Printer className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
                {autoPrint ? 'دفع وطباعة [F2]' : 'دفع فقط [F2]'}
              </button>
              <button
                onClick={toggleAutoPrint}
                title={autoPrint ? 'الطباعة التلقائية مفعّلة — اضغط لإيقافها' : 'الطباعة التلقائية موقوفة — اضغط لتفعيلها'}
                className={`px-2.5 rounded-xl border-2 transition-all active:scale-95 flex flex-col items-center justify-center gap-0.5 ${
                  autoPrint
                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400 hover:bg-emerald-600/30'
                    : 'bg-slate-500/20 border-slate-500 text-slate-400 hover:bg-slate-500/30'
                }`}
              >
                {autoPrint
                  ? <Printer className="w-4 h-4" />
                  : <span className="relative flex items-center justify-center w-4 h-4">
                      <Printer className="w-4 h-4" />
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="block w-5 h-0.5 bg-current rotate-45 rounded-full opacity-80" />
                      </span>
                    </span>
                }
                <span className="text-[8px] font-bold leading-none">{autoPrint ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>
          <div className="flex justify-between text-[9px] text-muted px-1 mt-1 font-bold select-none">
            <span>[F1] تركيز البحث</span>
            <span>[F5] إفراغ السلة</span>
          </div>
        </div>
      </div>

      {/* Variant Picker Modal */}
      {pickerProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-xl space-y-4 shadow-2xl animate-fade-in text-main">
            <div className="flex justify-between items-center pb-2 border-b border-main">
              <div>
                <span className="text-[10px] bg-main border border-main text-muted px-2 py-0.5 rounded font-bold">تحديد بديل قطعة الغيار</span>
                <h3 className="font-bold text-lg text-main mt-1">
                  {pickerProduct.name}
                </h3>
              </div>
              <button onClick={() => setPickerProduct(null)} className="text-muted hover:text-main">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto max-h-[350px] pr-1">
              {pickerProduct.variants.map(variant => {
                const inCartItem = cart.find(c => c.id === variant.id);
                const available = variant.stock_quantity - (inCartItem?.quantitySelected || 0);
                const isLow = variant.stock_quantity <= variant.min_limit;

                return (
                  <div
                    key={variant.id}
                    onClick={() => {
                      if (available > 0) {
                        addToCart(variant);
                        setPickerProduct(null);
                        playSound('scan');
                        showTemporaryMessage(`تمت إضافة البديل: ${pickerProduct.name} (${variant.origin})`, 'success');
                      } else {
                        playSound('error');
                        showTemporaryMessage('لا يتوفر مخزون كافٍ لهذا البديل!', 'error');
                      }
                    }}
                    className={`p-4 border rounded-2xl cursor-pointer hover:bg-panel-hover transition-all flex justify-between items-center ${
                      isLow ? 'bg-rose-500/5 border-rose-500/20' : 'bg-panel-accent border-main'
                    } ${available === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-base text-main">{variant.origin}</span>
                        {isLow && (
                          <span className="text-[9px] font-bold text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/10 animate-pulse">
                            مخزون حرج ({variant.stock_quantity})
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted">المواصفة: {variant.specification || 'عام'}</p>
                      
                      {variant.compatibility && variant.compatibility.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {variant.compatibility.map((c, i) => (
                            <span key={i} className="text-[9px] px-1.5 py-0.5 bg-main text-muted rounded border border-main">
                              {c.car_make} {c.car_model} ({c.year_start}-{c.year_end})
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="text-left flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-[10px] text-muted">سعر البيع</p>
                        <p className="text-lg font-black text-emerald-500">{variant.selling_price} <span className="text-xs font-normal">ج.م</span></p>
                      </div>
                      <ChevronLeft className="w-5 h-5 text-muted" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Reusable Premium React Confirm Modal Overlay */}
      {confirmConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-sm space-y-4 text-center shadow-2xl">
            <div className="text-lg font-bold text-main">تأكيد الإجراء</div>
            <p className="text-xs text-muted leading-relaxed">{confirmConfig.message}</p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  confirmConfig.onConfirm();
                  setConfirmConfig(null);
                }}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all active:scale-95 shadow-md"
              >
                تأكيد ومتابعة
              </button>
              <button
                onClick={() => setConfirmConfig(null)}
                className="flex-1 bg-main hover:bg-panel-hover text-muted border border-main font-bold py-2.5 rounded-xl text-xs transition-all active:scale-95"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
