import React, { useState, useEffect, useMemo } from 'react';
import { 
  RefreshCw, Wifi, WifiOff, Send, Database, Layers, CheckCircle2, ShieldAlert, 
  TrendingUp, DollarSign, Percent, BarChart3, Activity, AlertTriangle, UploadCloud, 
  Trash2, Printer, X, Calendar, Filter, ArrowUpRight, ArrowDownRight, PackageCheck
} from 'lucide-react';
import { dbClient } from '../database/dbClient';
import { SyncQueueItem } from '../types';
import { createClient } from '@supabase/supabase-js';

interface DashboardScreenProps {
  currentUserId: string;
  currentUsername: string;
  syncQueueCount: number;
  storeSettings: Record<string, string>;
  onRefreshData: () => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  currentUserId,
  currentUsername,
  syncQueueCount,
  storeSettings,
  onRefreshData
}) => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [fullSyncing, setFullSyncing] = useState(false);
  const [fullSyncMsg, setFullSyncMsg] = useState('');

  // Custom alert overlay
  const [alertConfig, setAlertConfig] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const showAlert = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setAlertConfig({ message, type });
  };

  // Invoices history ledger states (for viewing all invoices with details on local app)
  const [showInvoicesLedger, setShowInvoicesLedger] = useState(false);
  const [allSales, setAllSales] = useState<any[]>([]);
  const [searchInvoiceQuery, setSearchInvoiceQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [selectedInvoiceItems, setSelectedInvoiceItems] = useState<any[]>([]);
  const [confirmConfig, setConfirmConfig] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // Edit Discount Modal States
  const [editDiscountModal, setEditDiscountModal] = useState(false);
  const [newDiscountValue, setNewDiscountValue] = useState(0);
  const [discountReason, setDiscountReason] = useState('');

  // Filters (Period & Payment Method matching alaseel_dashboard_final_mobile_prices.html)
  const [periodFilter, setPeriodFilter] = useState<'7' | '30' | '90' | 'all'>('7');
  const [paymentFilter, setPaymentFilter] = useState<string>('');

  const openInvoicesLedger = async () => {
    try {
      const sales = await dbClient.dbQuery('SELECT * FROM sales ORDER BY created_at DESC');
      setAllSales(sales || []);
      setShowInvoicesLedger(true);
      setSelectedInvoice(null);
      setSelectedInvoiceItems([]);
    } catch (e) {
      console.error('Failed to load sales ledger:', e);
    }
  };

  const handleSelectInvoice = async (invoice: any) => {
    setSelectedInvoice(invoice);
    try {
      const items = await dbClient.dbQuery('SELECT * FROM sale_items WHERE sale_id = ?', [invoice.id]);
      setSelectedInvoiceItems(items || []);
    } catch (e) {
      console.error('Failed to load sale items:', e);
    }
  };

  const handleOpenEditDiscount = () => {
    if (!selectedInvoice) return;
    setNewDiscountValue(selectedInvoice.discount || 0);
    setDiscountReason('');
    setEditDiscountModal(true);
  };

  const handleSaveDiscount = async () => {
    if (!selectedInvoice) return;
    try {
      const res = await dbClient.updateSaleDiscount(
        selectedInvoice.id,
        newDiscountValue,
        currentUserId,
        currentUsername,
        discountReason
      );

      if (res.success) {
        showAlert(`✅ تم تعديل الخصم على الفاتورة بنجاح! الصافي الجديد: ${res.newFinalAmount.toLocaleString()} ج.م`, 'success');
        setEditDiscountModal(false);

        const updatedInvoice = {
          ...selectedInvoice,
          discount: res.newDiscount,
          final_amount: res.newFinalAmount
        };
        setSelectedInvoice(updatedInvoice);
        setAllSales(prev => prev.map(s => s.id === selectedInvoice.id ? updatedInvoice : s));

        loadAnalyticsData();
        onRefreshData();
      }
    } catch (e: any) {
      console.error(e);
      showAlert(`❌ فشل تعديل الخصم: ${e.message || 'خطأ غير معروف'}`, 'error');
    }
  };

  const handleReprintReceipt = async () => {
    if (!selectedInvoice) {
      showAlert('يرجى اختيار الفاتورة أولاً.', 'warning');
      return;
    }

    try {
      if (typeof window !== 'undefined' && window.api?.printReceipt) {
        await window.api.printReceipt({
          storeName: storeSettings.store_name || 'الأصيل لقطع الغيار',
          phone: storeSettings.store_phone || '01012345678',
          invoiceNumber: selectedInvoice.invoice_number,
          cashierName: selectedInvoice.cashier_name || currentUsername,
          customerName: selectedInvoice.customer_name || 'عميل نقدي',
          items: (selectedInvoiceItems || []).map(item => ({
            name: item.name || 'قطعة غيار',
            origin: item.origin || 'غير محدد',
            qty: item.quantity,
            price: item.unit_price,
            total: item.total_price
          })),
          totalAmount: Number(selectedInvoice.total_amount) || 0,
          discount: Number(selectedInvoice.discount) || 0,
          finalAmount: Number(selectedInvoice.final_amount) || 0,
          paymentMethod: selectedInvoice.payment_method || 'CASH',
          headerMsg: storeSettings.invoice_header || '',
          footerMsg: storeSettings.invoice_footer || '',
          qrCodeData: selectedInvoice.invoice_number
        });
        showAlert('🖨️ تم إرسال أمر إعادة طباعة الفاتورة إلى الطابعة الحرارية بنجاح!', 'success');
      } else {
        showAlert('إعادة الطباعة المباشرة متاحة فقط عبر تطبيق الديسكتوب.', 'warning');
      }
    } catch (err: any) {
      console.error('Reprint error:', err);
      showAlert(`فشل في الطباعة: ${err.message || 'خطأ غير معروف'}`, 'error');
    }
  };

  const handleDeleteInvoice = async (saleId: string) => {
    setConfirmConfig({
      message: 'هل أنت متأكد من حذف هذه الفاتورة نهائياً؟ سيتم إرجاع كميات جميع البنود إلى المخزن وإعادة حساب الحركات المالية.',
      onConfirm: async () => {
        try {
          const res = await dbClient.deleteSale(saleId, currentUserId, currentUsername);
          if (res.success) {
            showAlert('تم حذف الفاتورة بنجاح وإعادة البضاعة للمخزن', 'success');
            setSelectedInvoice(null);
            setSelectedInvoiceItems([]);
            // Refresh sales list
            const sales = await dbClient.dbQuery('SELECT * FROM sales ORDER BY created_at DESC');
            setAllSales(sales || []);
            onRefreshData();
          }
        } catch (e: any) {
          console.error(e);
          showAlert(`فشل حذف الفاتورة: ${e.message || 'خطأ غير معروف'}`, 'error');
        }
      }
    });
  };

  // Dashboard Analytics States
  const [metrics, setMetrics] = useState({
    totalSales: 0,
    totalCost: 0,
    netProfit: 0,
    profitMargin: 0,
    invoicesCount: 0,
    cashSales: 0,
    vodaSales: 0,
    debtSales: 0,
    totalEnteredStockCost: 0,
    currentStockCost: 0
  });

  const [topItems, setTopItems] = useState<Array<{ name: string; origin: string; qty: number; revenue: number }>>([]);
  const [topProfitItems, setTopProfitItems] = useState<Array<{ name: string; origin: string; profit: number; revenue: number }>>([]);
  const [stockAlertsList, setStockAlertsList] = useState<any[]>([]);
  const [dailyChartPoints, setDailyChartPoints] = useState<Array<{ label: string; dateKey: string; sales: number; profit: number }>>([]);
  const [categoryChartPoints, setCategoryChartPoints] = useState<Array<{ category: string; value: number; percent: number }>>([]);
  const [recentSales, setRecentSales] = useState<any[]>([]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadAnalyticsData = async () => {
    try {
      const queue = await dbClient.getSyncQueue();
      setSyncQueue(queue);

      // Query core sales data
      const sales = await dbClient.dbQuery('SELECT * FROM sales ORDER BY created_at DESC');
      const saleItems = await dbClient.dbQuery('SELECT * FROM sale_items');
      const variants = await dbClient.getVariants();

      const salesList: any[] = sales || [];
      const itemsList: any[] = saleItems || [];
      const varList: any[] = variants || [];

      // 1. Filter sales by payment method & period
      let filtered = salesList;
      if (paymentFilter) {
        filtered = filtered.filter(s => s.payment_method === paymentFilter);
      }
      if (periodFilter !== 'all') {
        const days = Number(periodFilter);
        const fromDate = new Date();
        fromDate.setHours(0, 0, 0, 0);
        fromDate.setDate(fromDate.getDate() - days + 1);
        filtered = filtered.filter(s => new Date(s.created_at) >= fromDate);
      }

      const filteredSet = new Set(filtered.map(s => s.id));
      const filteredItems = itemsList.filter(i => filteredSet.has(i.sale_id));

      // Financials for filtered period
      let totalRevenue = 0;
      let cashSales = 0;
      let vodaSales = 0;
      let debtSales = 0;

      filtered.forEach(s => {
        const amount = Number(s.final_amount) || 0;
        totalRevenue += amount;
        if (s.payment_method === 'CARD' || (s.customer_name && s.customer_name.includes('فودافون'))) {
          vodaSales += amount;
        } else if (s.payment_method === 'DEBT') {
          debtSales += amount;
        } else {
          cashSales += amount;
        }
      });

      let totalCost = 0;
      filteredItems.forEach(item => {
        totalCost += (Number(item.cost_price) || 0) * (Number(item.quantity) || 0);
      });

      const netProfit = totalRevenue - totalCost;
      const profitMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;

      // Warehouse Stock Values: All time entered cost
      // Matches HTML: currentStockCost + all-time cost of what was sold
      const currentStockCost = varList.reduce((sum, v) => sum + (Number(v.stock_quantity) || 0) * (Number(v.cost_price) || 0), 0);
      const allTimeSoldCost = itemsList.reduce((sum, i) => sum + (Number(i.cost_price) || 0) * (Number(i.quantity) || 0), 0);
      const totalEnteredStockCost = currentStockCost + allTimeSoldCost;

      setMetrics({
        totalSales: totalRevenue,
        totalCost,
        netProfit,
        profitMargin,
        invoicesCount: filtered.length,
        cashSales,
        vodaSales,
        debtSales,
        totalEnteredStockCost,
        currentStockCost
      });

      // 2. Top Selling & Top Profitable items in filtered period
      const itemGroups: Record<string, { name: string; origin: string; qty: number; revenue: number; cost: number }> = {};
      filteredItems.forEach(item => {
        const k = item.variant_id || item.name;
        const matchedVar = varList.find(v => v.id === item.variant_id);
        const name = item.name || matchedVar?.product_name || 'قطعة غيار';
        const origin = item.origin || matchedVar?.origin || 'غير محدد';
        const q = Number(item.quantity) || 0;
        const rev = Number(item.total_price) || (Number(item.unit_price) || 0) * q;
        const cost = (Number(item.cost_price) || 0) * q;

        if (!itemGroups[k]) {
          itemGroups[k] = { name, origin, qty: 0, revenue: 0, cost: 0 };
        }
        itemGroups[k].qty += q;
        itemGroups[k].revenue += rev;
        itemGroups[k].cost += cost;
      });

      const topByQty = Object.values(itemGroups)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);
      setTopItems(topByQty);

      const topByProfit = Object.values(itemGroups)
        .map(i => ({ name: i.name, origin: i.origin, profit: i.revenue - i.cost, revenue: i.revenue }))
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 5);
      setTopProfitItems(topByProfit);

      // 3. Low stock alerts (variants <= min_limit)
      const alerts = varList
        .filter(v => Number(v.stock_quantity || 0) <= Number(v.min_limit || 0))
        .sort((a, b) => Number(a.stock_quantity) - Number(b.stock_quantity))
        .slice(0, 5);
      setStockAlertsList(alerts);

      // 4. Daily chart points for filtered period
      const daysCount = periodFilter === '7' ? 7 : periodFilter === '30' ? 30 : periodFilter === '90' ? 90 : 7;
      const dailyPoints: Array<{ label: string; dateKey: string; sales: number; profit: number }> = [];
      const now = new Date();

      for (let i = daysCount - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        const dateKey = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric' });

        const daySales = filtered.filter(s => String(s.created_at).slice(0, 10) === dateKey);
        const dayRevenue = daySales.reduce((acc, s) => acc + (Number(s.final_amount) || 0), 0);
        const daySaleIds = new Set(daySales.map(s => s.id));
        const dayCost = filteredItems
          .filter(it => daySaleIds.has(it.sale_id))
          .reduce((acc, it) => acc + (Number(it.cost_price) || 0) * (Number(it.quantity) || 0), 0);
        const dayProfit = dayRevenue - dayCost;

        dailyPoints.push({ label, dateKey, sales: dayRevenue, profit: dayProfit });
      }
      setDailyChartPoints(dailyPoints);

      // 5. Category breakdown
      const catMap: Record<string, number> = {};
      varList.forEach(v => {
        const cat = v.category || 'عام';
        const val = (Number(v.stock_quantity) || 0) * (Number(v.selling_price) || 0);
        catMap[cat] = (catMap[cat] || 0) + val;
      });
      const totalCatVal = Object.values(catMap).reduce((a, b) => a + b, 0);
      const catList = Object.entries(catMap)
        .map(([category, value]) => ({
          category,
          value,
          percent: totalCatVal > 0 ? Math.round((value / totalCatVal) * 100) : 0
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);
      setCategoryChartPoints(catList);

      // 6. Recent sales
      setRecentSales(filtered.slice(0, 6));

    } catch (e) {
      console.error('Failed to compile analytics:', e);
    }
  };

  useEffect(() => {
    loadAnalyticsData();
  }, [syncQueueCount, periodFilter, paymentFilter]);

  const isSupabaseConfigured = useMemo(() => {
    return !!(storeSettings.supabase_url && storeSettings.supabase_anon_key);
  }, [storeSettings]);

  const triggerSyncSync = async () => {
    if (syncQueue.length === 0) {
      showAlert('جميع البيانات المحلية متطابقة تماماً ومرفوعة سحابياً.', 'success');
      return;
    }

    const sUrl = storeSettings.supabase_url || '';
    const sKey = storeSettings.supabase_anon_key || '';

    if (!sUrl || !sKey) {
      showAlert('المزامنة السحابية غير مهيأة! يرجى إدخال رابط قاعدة البيانات ومفتاح الوصول (Supabase) في صفحة الإعدادات أولاً.', 'warning');
      return;
    }

    if (!isOnline) {
      showAlert('تعذر الاتصال بالشبكة! يرجى التحقق من اتصال الإنترنت بالمحل والمحاولة مجدداً.', 'warning');
      return;
    }

    setSyncing(true);
    setProgressMsg('تأمين الاتصال المشفر مع السيرفر السحابي Supabase...');

    try {
      const supabase = createClient(sUrl, sKey);
      
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < syncQueue.length; i++) {
        const item = syncQueue[i];
        setProgressMsg(`جاري مزامنة الحركة ${i + 1} من ${syncQueue.length} (${getArabicTableName(item.table_name)})...`);

        try {
          const payload = JSON.parse(item.data);
          
          if (item.table_name === 'sales') {
            const saleObj = payload.sale || payload;
            const itemsList = payload.items || [];

            const { error: saleErr } = await supabase.from('sales').upsert(saleObj);
            if (saleErr) throw saleErr;

            if (itemsList.length > 0) {
              const { error: itemsErr } = await supabase
                .from('sale_items')
                .upsert(itemsList.map((x: any) => ({ ...x, sale_id: saleObj.id })));
              if (itemsErr) throw itemsErr;
            }

          } else if (item.table_name === 'suppliers') {
            if (payload.supplier) {
              const { error: supErr } = await supabase.from('suppliers').upsert(payload.supplier);
              if (supErr) throw supErr;
            } else if (payload.supplier_id) {
              const { error: supErr } = await supabase.from('suppliers').upsert({ id: payload.supplier_id, current_debt: payload.current_debt });
              if (supErr) throw supErr;
            }

            if (payload.transaction) {
              const { error: txErr } = await supabase.from('supplier_debts').upsert(payload.transaction);
              if (txErr) throw txErr;
            }

          } else if (item.table_name === 'products') {
            if (payload.product) {
              const { error: prodErr } = await supabase.from('products').upsert(payload.product);
              if (prodErr) throw prodErr;
            }
            if (payload.variant) {
              const { error: varErr } = await supabase.from('product_variants').upsert(payload.variant);
              if (varErr) throw varErr;
            }
            if (payload.compatibility && payload.compatibility.length > 0) {
              const compatList = payload.compatibility.map((c: any) => ({
                variant_id: payload.variant.id,
                car_make: c.carMake || c.car_make,
                car_model: c.carModel || c.car_model,
                year_start: Number(c.yearStart || c.year_start),
                year_end: Number(c.yearEnd || c.year_end)
              }));
              const { error: compErr } = await supabase.from('product_compatibility').upsert(compatList);
              if (compErr) throw compErr;
            }

          } else if (item.table_name === 'product_variants') {
            const { error: varErr } = await supabase.from('product_variants').upsert(payload);
            if (varErr) throw varErr;
          }

          // Mark as synced locally
          await dbClient.markAsSynced([item.id]);
          successCount++;

        } catch (err: any) {
          console.error(`Error syncing item ${item.id}:`, err);
          failCount++;
          await dbClient.markAsFailed(item.id, err.message || 'Supabase upload error');
        }
      }

      if (successCount > 0) {
        await dbClient.logActivity(
          currentUserId,
          currentUsername,
          'SYNC_COMPLETED',
          `يدوي: تم مزامنة ترحيل ${successCount} حركة سحابية بنجاح إلى Supabase.`
        );
        localStorage.setItem('last_successful_sync_time', new Date().toISOString());
      }

      if (failCount === 0) {
        setProgressMsg('تمت المزامنة وحفظ نسخة احتياطية سحابية آمنة بنجاح!');
        showAlert(`تم ترحيل ومزامنة جميع البيانات المعلقة (${successCount}) بنجاح إلى قاعدة بيانات Supabase.`, 'success');
      } else {
        setProgressMsg(`اكتمل الترحيل الجزئي. حركات ناجحة: ${successCount}، حركات فاشلة: ${failCount}`);
        showAlert(`اكتملت المزامنة بوجود أخطاء. حركات ناجحة: ${successCount}، حركات فاشلة: ${failCount}. تحقق من هيكل الجداول بقاعدة بيانات Supabase.`, 'warning');
      }

      setTimeout(() => {
        setSyncing(false);
        setProgressMsg('');
        loadAnalyticsData();
        onRefreshData();
      }, 2000);

    } catch (err: any) {
      console.error(err);
      setProgressMsg('فشل الاتصال بـ Supabase. تحقق من الإعدادات والإنترنت.');
      showAlert('فشل الاتصال بقاعدة بيانات Supabase السحابية. يرجى مراجعة إعدادات الرابط والمفتاح.', 'error');
      setTimeout(() => setSyncing(false), 3000);
    }
  };

  const getArabicTableName = (tbl: string) => {
    switch (tbl) {
      case 'sales': return 'فاتورة مبيعات محلية';
      case 'suppliers': return 'حركة ديون/حساب مورد';
      case 'product_variants': return 'تعديل مخزون قطعة غيار';
      case 'products': return 'تكويد صنف جديد بالمخزن';
      default: return tbl;
    }
  };

  const getBusinessDetails = (item: SyncQueueItem) => {
    try {
      const payload = JSON.parse(item.data);
      if (item.table_name === 'sales') {
        const inv = payload.sale?.invoice_number || payload.invoice_number || '';
        const amt = payload.sale?.final_amount || payload.final_amount || 0;
        return `فاتورة مبيعات رقم ${inv} بمبلغ ${amt} ج.م`;
      }
      if (item.table_name === 'suppliers') {
        const name = payload.supplier?.name || '';
        const amt = payload.transaction?.amount || 0;
        return `مورد: ${name} (حركة بقيمة ${amt} ج.م)`;
      }
      if (item.table_name === 'product_variants') {
        const qty = payload.stock_quantity || 0;
        return `تعديل رصيد الصنف لتصبح الكمية ${qty}`;
      }
      return 'تحديث بيانات النظام';
    } catch {
      return 'عملية فنية داخلية بقاعدة البيانات';
    }
  };

  // ── Full re-sync: upsert ALL local tables to Supabase ──────────────────────
  const handleFullSync = async () => {
    const sUrl = storeSettings.supabase_url || '';
    const sKey = storeSettings.supabase_anon_key || '';
    if (!sUrl || !sKey) {
      showAlert('يرجى إدخال بيانات Supabase في الإعدادات أولاً.', 'warning');
      return;
    }
    setFullSyncing(true);
    setFullSyncMsg('جاري جلب قاعدة البيانات المحلية الكاملة...');
    try {
      const snapRes = await dbClient.getFullSnapshot();
      if (!snapRes.success || !snapRes.data) {
        showAlert('فشل قراءة قاعدة البيانات المحلية: ' + (snapRes.error || 'خطأ غير معروف'), 'error');
        return;
      }
      const snap = snapRes.data;
      const supabase = createClient(sUrl, sKey);

      const batchUpsert = async (tableName: string, rows: any[], prepFn?: (r: any) => any) => {
        if (!rows || rows.length === 0) return;
        const prepared = rows.map(prepFn || ((r: any) => r));
        const chunkSize = 100;
        for (let i = 0; i < prepared.length; i += chunkSize) {
          const chunk = prepared.slice(i, i + chunkSize);
          const { error } = await supabase.from(tableName).upsert(chunk, { onConflict: 'id' });
          if (error) console.error(`[FullSync] ${tableName} chunk error:`, error.message);
        }
      };

      setFullSyncMsg('جاري مزامنة المنتجات...');
      await batchUpsert('products', snap.products);

      setFullSyncMsg('جاري مزامنة المتغيرات والمخزون...');
      await batchUpsert('product_variants', snap.product_variants, (v: any) => ({
        id: v.id,
        product_id: v.product_id,
        origin: v.origin || '',
        specification: v.specification || '',
        cost_price: v.cost_price || 0,
        selling_price: v.selling_price || 0,
        stock_quantity: v.stock_quantity || 0,
        min_limit: v.min_limit || 0,
        sku_barcode: v.sku_barcode || '',
        created_at: v.created_at
      }));

      setFullSyncMsg('جاري مزامنة التوافقات...');
      await batchUpsert('product_compatibility', snap.product_compatibility);

      setFullSyncMsg('جاري مزامنة الموردين...');
      await batchUpsert('suppliers', snap.suppliers, (s: any) => ({
        id: s.id,
        name: s.name || '',
        phone: s.phone || '',
        email: s.email || null,
        address: s.address || null,
        current_debt: s.current_debt || 0,
        created_at: s.created_at
      }));

      setFullSyncMsg('جاري مزامنة حركات الديون...');
      await batchUpsert('supplier_debts', snap.supplier_debts, (d: any) => ({
        id: d.id,
        supplier_id: d.supplier_id,
        transaction_type: d.transaction_type,
        amount: d.amount || 0,
        previous_debt: d.previous_debt || 0,
        new_debt: d.new_debt || 0,
        notes: d.notes || null,
        created_at: d.created_at
      }));

      setFullSyncMsg('جاري مزامنة المستخدمين...');
      await batchUpsert('cashier_users', snap.cashier_users, (u: any) => ({
        id: u.id,
        username: u.username || '',
        password_hash: u.password_hash || '',
        role: u.role || 'CASHIER',
        phone: u.phone || null,
        created_at: u.created_at
      }));

      setFullSyncMsg('جاري مزامنة فواتير المبيعات...');
      await batchUpsert('sales', snap.sales, (s: any) => ({
        id: s.id,
        invoice_number: s.invoice_number || '',
        cashier_id: s.cashier_id || '',
        cashier_name: s.cashier_name || '',
        customer_name: s.customer_name || null,
        total_amount: s.total_amount || 0,
        discount: s.discount || 0,
        final_amount: s.final_amount || 0,
        payment_method: s.payment_method || 'CASH',
        created_at: s.created_at
      }));

      setFullSyncMsg('جاري مزامنة بنود الفواتير...');
      await batchUpsert('sale_items', snap.sale_items, (i: any) => ({
        id: i.id,
        sale_id: i.sale_id,
        variant_id: i.variant_id,
        name: i.name || 'قطعة غيار',
        origin: i.origin || 'غير محدد',
        quantity: i.quantity || 1,
        unit_price: i.unit_price || 0,
        cost_price: i.cost_price || 0,
        total_price: i.total_price || 0
      }));

      setFullSyncMsg('جاري مزامنة سجل النشاط...');
      await batchUpsert('activity_logs', snap.activity_logs, (l: any) => ({
        id: l.id,
        user_id: l.user_id,
        username: l.username || '',
        action: l.action || '',
        details: l.details || '',
        created_at: l.created_at
      }));

      const totals = [
        snap.products.length, snap.product_variants.length, snap.suppliers.length,
        snap.sales.length, snap.sale_items.length, snap.cashier_users.length
      ].reduce((a, b) => a + b, 0);

      setFullSyncMsg(`✅ اكتملت المزامنة الشاملة! ${totals} سجل موزع على جميع الجداول.`);
      showAlert(`تمت المزامنة الشاملة لقاعدة البيانات الكاملة! ${snap.sales.length} فاتورة · ${snap.products.length} منتج · ${snap.product_variants.length} متغير · ${snap.suppliers.length} مورد.`, 'success');
      await dbClient.logActivity(currentUserId, currentUsername, 'FULL_SYNC', `مزامنة شاملة يدوية لقاعدة البيانات: ${totals} سجل كامل`);
      loadAnalyticsData();
      onRefreshData();
    } catch (err: any) {
      console.error('[FullSync] Error:', err);
      showAlert('فشلت المزامنة الشاملة: ' + (err.message || 'خطأ غير معروف'), 'error');
      setFullSyncMsg('فشل في المزامنة الشاملة');
    } finally {
      setTimeout(() => { setFullSyncing(false); setFullSyncMsg(''); }, 4000);
    }
  };



  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-100px)] overflow-y-auto text-main select-none pr-1">
      
      {/* Banner status */}
      <div className="glass-panel p-4 flex flex-col md:flex-row items-center justify-between gap-4 bg-panel border-main border-l-4 border-l-blue-500">
        <div className="flex items-center gap-3">
          {!isSupabaseConfigured ? (
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
              <ShieldAlert className="w-6 h-6 animate-pulse" />
            </div>
          ) : isOnline ? (
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Wifi className="w-6 h-6 animate-pulse" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500">
              <WifiOff className="w-6 h-6" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-main">لوحة تحليلات مبيعات المحل ومزامنة السحابة</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                !isSupabaseConfigured
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : isOnline
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-455'
              }`}>
                {!isSupabaseConfigured
                  ? 'المزامنة السحابية غير مهيأة'
                  : isOnline
                  ? 'الاتصال بالسيرفر السحابي نشط'
                  : 'وضع العمل المحلي المؤقت (أوفلاين)'}
              </span>
            </div>
            <p className="text-[11px] text-muted mt-1">
              {!isSupabaseConfigured
                ? 'يرجى تهيئة رابط ومفتاح الوصول الخاص بـ Supabase من صفحة الإعدادات لتفعيل الحفظ الاحتياطي التلقائي وسحابية البيانات.'
                : 'تحليل شامل لأداء مبيعات قطع غيار السيارات ومتابعة المزامنة لترحيل المعلقات الناتجة عن انقطاع الإنترنت.'}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 w-full md:w-auto">
          <div className="flex gap-2">
            <button
              onClick={triggerSyncSync}
              disabled={syncing || syncQueue.length === 0}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md active:scale-95 text-xs"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              ترحيل المعلقات ({syncQueue.length})
            </button>

            <button
              onClick={handleFullSync}
              disabled={fullSyncing || syncing}
              title="مزامنة شاملة لكل قاعدة البيانات من يوم التأسيس حتى الآن"
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md active:scale-95 text-xs"
            >
              <UploadCloud className={`w-4 h-4 ${fullSyncing ? 'animate-bounce' : ''}`} />
              {fullSyncing ? 'جاري المزامنة الشاملة...' : 'مزامنة شاملة كاملة'}
            </button>
          </div>

          {/* Full sync progress message */}
          {fullSyncMsg && (
            <div className="text-[10px] text-emerald-500 font-bold text-center animate-pulse bg-emerald-500/10 rounded-lg py-1 px-2">
              {fullSyncMsg}
            </div>
          )}
        </div>
      </div>


      {/* Filter and Period Controls matching alaseel_dashboard_final_mobile_prices.html */}
      <div className="glass-panel p-4 bg-panel border-main flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-bold text-muted">الفترة:</span>
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value as any)}
              className="bg-input-field border border-main text-main text-xs font-bold rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="7">آخر 7 أيام</option>
              <option value="30">آخر 30 يوم</option>
              <option value="90">آخر 90 يوم</option>
              <option value="all">كل الفترات السابقة</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-indigo-500" />
            <span className="text-xs font-bold text-muted">الدفع:</span>
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              className="bg-input-field border border-main text-main text-xs font-bold rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">جميع طرق الدفع</option>
              <option value="CASH">نقدي / كاش</option>
              <option value="CARD">فودافون كاش / بطاقة</option>
              <option value="DEBT">آجل (ديون عملاء)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={openInvoicesLedger}
            className="bg-main hover:bg-panel-hover border border-main text-main font-bold py-2 px-4 rounded-xl text-xs flex items-center gap-1.5 transition-all active:scale-95 shadow-sm"
          >
            <Layers className="w-4 h-4 text-blue-500" />
            سجل الفواتير التفصيلي وتعديل الخصومات
          </button>
        </div>
      </div>

      {/* Primary Analytics Stats Cards Grid (Matching alaseel_dashboard_final_mobile_prices.html) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Total Net Sales */}
        <div className="glass-panel p-5 bg-panel border-main flex items-center justify-between border-l-4 border-l-blue-500 shadow-sm">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted font-bold mb-1">
              <span>إجمالي المبيعات</span>
              <span className="text-[10px] text-blue-500 font-normal">({metrics.invoicesCount} فاتورة)</span>
            </div>
            <p className="text-2xl font-black text-main">{metrics.totalSales.toLocaleString()} <span className="text-xs font-normal text-muted">ج.م</span></p>
            <p className="text-[10px] text-muted mt-1">الصافي المحصل بعد الخصم</p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500">
            <DollarSign className="w-6 h-6" />
          </div>
        </div>

        {/* 2. COGS (Cost of Goods Sold) */}
        <div className="glass-panel p-5 bg-panel border-main flex items-center justify-between border-l-4 border-l-amber-500 shadow-sm">
          <div>
            <p className="text-xs text-muted font-bold mb-1">تكلفة البضاعة المباعة</p>
            <p className="text-2xl font-black text-main">{metrics.totalCost.toLocaleString()} <span className="text-xs font-normal text-muted">ج.م</span></p>
            <p className="text-[10px] text-muted mt-1">تكلفة القطع المباعة في الفترة</p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500">
            <BarChart3 className="w-6 h-6" />
          </div>
        </div>

        {/* 3. Net Profit */}
        <div className="glass-panel p-5 bg-panel border-main flex items-center justify-between border-l-4 border-l-emerald-500 shadow-sm">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted font-bold mb-1">
              <span>صافي الأرباح المحققة</span>
              <span className="text-[10px] text-emerald-500 font-black">({metrics.profitMargin}%)</span>
            </div>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{metrics.netProfit.toLocaleString()} <span className="text-xs font-normal text-muted">ج.م</span></p>
            <p className="text-[10px] text-muted mt-1">المبيعات − التكلفة</p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>

        {/* 4. Total Inbound Stock Cost (What entered warehouse) */}
        <div className="glass-panel p-5 bg-panel border-main flex items-center justify-between border-l-4 border-l-rose-500 shadow-sm">
          <div>
            <p className="text-xs text-muted font-bold mb-1">إجمالي تكلفة البضاعة الداخلة</p>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-455">{metrics.totalEnteredStockCost.toLocaleString()} <span className="text-xs font-normal text-muted">ج.م</span></p>
            <p className="text-[10px] text-muted mt-1 truncate max-w-[200px]" title="المخزون الحالي بالتكلفة + تكلفة ما تم بيعه">
              المخزون بالتكلفة + تكلفة ما بيع
            </p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-rose-500/10 flex items-center justify-center text-rose-500">
            <PackageCheck className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Interactive Charts Section (Sales/Profit Line & Category Doughnut) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Sales & Profit Line Chart (8 cols) */}
        <div className="lg:col-span-8 glass-panel p-5 bg-panel border-main space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-extrabold text-sm text-main">منحنى المبيعات والأرباح اليومية</h3>
              <p className="text-[10px] text-muted">مقارنة حركة الإيرادات اليومية بصافي الأرباح المحققة خلال الفترة</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-bold">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                <span>المبيعات</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                <span>الأرباح</span>
              </div>
            </div>
          </div>

          {/* SVG Visual Trend Chart */}
          <div className="h-64 w-full relative flex flex-col justify-end pt-6 pb-2">
            {dailyChartPoints.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted">لا توجد بيانات كافية للرسم البياني في الفترة المحددة.</div>
            ) : (() => {
              const maxVal = Math.max(...dailyChartPoints.map(p => Math.max(p.sales, p.profit, 100)));
              return (
                <div className="h-full flex items-end justify-between gap-2 px-2 pt-4 border-b border-main">
                  {dailyChartPoints.map((pt, idx) => {
                    const salesHeight = Math.max(4, Math.round((pt.sales / maxVal) * 180));
                    const profitHeight = Math.max(4, Math.round((pt.profit / maxVal) * 180));
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center gap-1 group relative h-full justify-end">
                        {/* Tooltip on hover */}
                        <div className="absolute -top-12 bg-black/90 text-white text-[10px] py-1 px-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 whitespace-nowrap shadow-lg">
                          <div>{pt.label} ({pt.dateKey})</div>
                          <div className="text-blue-300">مبيعات: {pt.sales.toLocaleString()} ج.م</div>
                          <div className="text-emerald-300">أرباح: {pt.profit.toLocaleString()} ج.م</div>
                        </div>

                        {/* Bars / Column Pair */}
                        <div className="w-full flex justify-center items-end gap-1">
                          <div
                            style={{ height: `${salesHeight}px` }}
                            className="w-3 sm:w-4 bg-blue-500/80 hover:bg-blue-500 rounded-t-md transition-all shadow-sm"
                            title={`مبيعات: ${pt.sales} ج.م`}
                          ></div>
                          <div
                            style={{ height: `${profitHeight}px` }}
                            className="w-3 sm:w-4 bg-emerald-500/80 hover:bg-emerald-500 rounded-t-md transition-all shadow-sm"
                            title={`أرباح: ${pt.profit} ج.م`}
                          ></div>
                        </div>

                        {/* Label */}
                        <span className="text-[10px] text-muted font-bold truncate max-w-[45px] mt-1">{pt.label}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Right: Category Distribution (4 cols) */}
        <div className="lg:col-span-4 glass-panel p-5 bg-panel border-main space-y-4 flex flex-col justify-between">
          <div>
            <h3 className="font-extrabold text-sm text-main">قيمة المخزون حسب الفئات</h3>
            <p className="text-[10px] text-muted">توزيع قيمة البضاعة المتاحة بسعر البيع</p>
          </div>

          {/* Category bars breakdown */}
          <div className="space-y-3 flex-1 flex flex-col justify-center">
            {categoryChartPoints.length === 0 ? (
              <p className="text-xs text-muted text-center py-8">لا توجد أصناف مسجلة.</p>
            ) : (
              categoryChartPoints.map((cat, idx) => {
                const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-indigo-500', 'bg-amber-500', 'bg-purple-500', 'bg-rose-500'];
                const color = colors[idx % colors.length];
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-main">{cat.category}</span>
                      <span className="text-muted font-mono">{cat.value.toLocaleString()} ج.م ({cat.percent}%)</span>
                    </div>
                    <div className="w-full bg-main h-2.5 rounded-full overflow-hidden border border-main">
                      <div className={`${color} h-full transition-all`} style={{ width: `${cat.percent}%` }}></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Grid 3: Top Selling, Top Profitable, and Low Stock Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Top Selling By Quantity */}
        <div className="glass-panel p-5 bg-panel border-main space-y-3">
          <div className="flex justify-between items-center pb-2 border-b border-main">
            <h3 className="font-bold text-xs text-main flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-blue-500" />
              الأكثر مبيعاً (بالكمية)
            </h3>
            <span className="text-[10px] text-muted font-bold">ضمن الفترة</span>
          </div>

          <div className="space-y-2 text-xs">
            {topItems.length === 0 ? (
              <p className="text-muted text-center py-6 text-[11px]">لا توجد مبيعات مسجلة في هذه الفترة.</p>
            ) : (
              topItems.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center py-1.5 border-b border-main/50 last:border-0">
                  <div>
                    <div className="font-bold text-main">{item.name}</div>
                    <div className="text-[10px] text-muted font-normal">{item.origin}</div>
                  </div>
                  <span className="font-mono font-black text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md text-xs">
                    {item.qty} قطعة
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top Profitable */}
        <div className="glass-panel p-5 bg-panel border-main space-y-3">
          <div className="flex justify-between items-center pb-2 border-b border-main">
            <h3 className="font-bold text-xs text-main flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              الأعلى ربحاً (صافي الربح)
            </h3>
            <span className="text-[10px] text-muted font-bold">ضمن الفترة</span>
          </div>

          <div className="space-y-2 text-xs">
            {topProfitItems.length === 0 ? (
              <p className="text-muted text-center py-6 text-[11px]">لا توجد بيانات أرباح في هذه الفترة.</p>
            ) : (
              topProfitItems.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center py-1.5 border-b border-main/50 last:border-0">
                  <div>
                    <div className="font-bold text-main">{item.name}</div>
                    <div className="text-[10px] text-muted font-normal">{item.origin}</div>
                  </div>
                  <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md text-xs">
                    +{item.profit.toLocaleString()} ج.م
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Stock Alerts (Critically Low) */}
        <div className="glass-panel p-5 bg-panel border-main space-y-3">
          <div className="flex justify-between items-center pb-2 border-b border-main">
            <h3 className="font-bold text-xs text-rose-500 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-500" />
              تنبيهات المخزون الحرِج
            </h3>
            <span className="text-[10px] text-muted font-bold">حد الطلب</span>
          </div>

          <div className="space-y-2 text-xs">
            {stockAlertsList.length === 0 ? (
              <p className="text-emerald-500 text-center py-6 text-[11px] font-bold">المخزون مستقر بالكامل ✓</p>
            ) : (
              stockAlertsList.map((v, idx) => (
                <div key={idx} className="flex justify-between items-center py-1.5 border-b border-main/50 last:border-0">
                  <div>
                    <div className="font-bold text-main">{v.product_name}</div>
                    <div className="text-[10px] text-muted font-normal">{v.origin}</div>
                  </div>
                  <span className={`font-mono font-black px-2 py-0.5 rounded-md text-xs ${
                    v.stock_quantity === 0 ? 'bg-rose-600 text-white animate-pulse' : 'bg-rose-500/10 text-rose-500'
                  }`}>
                    {v.stock_quantity} / {v.min_limit} وحدة
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Recent Invoices & Sync Status Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Recent Invoices (8 cols) */}
        <div className="lg:col-span-8 glass-panel p-5 bg-panel border-main space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-sm text-main">آخر الفواتير الصادرة</h3>
            <button
              onClick={openInvoicesLedger}
              className="text-xs text-blue-500 hover:text-blue-400 font-bold"
            >
              عرض سجل الفواتير كاملاً وتعديل الخصومات ←
            </button>
          </div>

          <div className="border border-main rounded-xl overflow-hidden bg-main">
            <table className="w-full text-right border-collapse text-xs">
              <thead>
                <tr className="bg-panel-accent text-muted border-b border-main text-xs font-bold">
                  <th className="py-2.5 px-3">رقم الفاتورة</th>
                  <th className="py-2.5 px-3">العميل</th>
                  <th className="py-2.5 px-3">الدفع</th>
                  <th className="py-2.5 px-3 text-left">الإجمالي</th>
                  <th className="py-2.5 px-3 text-left">الخصم</th>
                  <th className="py-2.5 px-3 text-left">الصافي</th>
                  <th className="py-2.5 px-3 text-center">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-main text-main font-semibold">
                {recentSales.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted">لا توجد فواتير في الفترة المحددة.</td>
                  </tr>
                ) : (
                  recentSales.map((s, idx) => (
                    <tr key={idx} className="hover:bg-panel-hover/50">
                      <td className="py-2.5 px-3 font-mono font-bold">{s.invoice_number}</td>
                      <td className="py-2.5 px-3 text-muted">{s.customer_name || 'عميل نقدي'}</td>
                      <td className="py-2.5 px-3">
                        <span className="text-[10px] bg-panel px-2 py-0.5 rounded border border-main">
                          {s.payment_method === 'CARD' ? 'فودافون كاش' : s.payment_method === 'DEBT' ? 'آجل' : 'نقدي'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-left font-mono">{(Number(s.total_amount) || 0).toLocaleString()} ج.م</td>
                      <td className="py-2.5 px-3 text-left font-mono text-rose-500">
                        {Number(s.discount) > 0 ? `-${Number(s.discount).toLocaleString()} ج.م` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-left font-mono font-black text-emerald-500">
                        {(Number(s.final_amount) || 0).toLocaleString()} ج.م
                      </td>
                      <td className="py-2.5 px-3 text-center text-[10px] text-muted">
                        {new Date(s.created_at).toLocaleDateString('ar-EG')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sync Status Queue (4 cols) */}
        <div className="lg:col-span-4 glass-panel p-5 bg-panel border-main space-y-3 flex flex-col h-[320px]">
          <div className="flex justify-between items-center pb-2 border-b border-main">
            <h3 className="font-bold text-xs text-main flex items-center gap-1.5">
              <span>طابور المزامنة السحابية</span>
              {syncQueue.length > 0 && <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>}
            </h3>
            <span className="text-[10px] text-muted font-bold">{syncQueue.length} معلقة</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
            {syncQueue.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-1" />
                <p className="text-[11px] font-bold">جميع الحركات مزامنة ومحفوظة سحابياً</p>
              </div>
            ) : (
              syncQueue.map(item => (
                <div key={item.id} className="bg-panel-accent border border-main p-2.5 rounded-xl space-y-1">
                  <div className="flex justify-between items-center font-bold">
                    <span className="text-[11px] text-blue-500">{getArabicTableName(item.table_name)}</span>
                    <span className="text-[9px] bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded font-mono uppercase">{item.operation}</span>
                  </div>
                  <div className="text-[10px] text-muted font-mono truncate">معرف: {item.record_id}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Invoices History Ledger Modal */}
      {showInvoicesLedger && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-6 z-50 animate-fade-in text-main select-text">
          <div className="bg-panel border border-main rounded-3xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-main flex justify-between items-center bg-panel-accent">
              <div>
                <h3 className="font-extrabold text-base text-main">سجل الفواتير والمبيعات التفصيلي وتعديل الخصومات</h3>
                <p className="text-[10px] text-muted mt-0.5">البحث والمراجعة التفصيلية وتعديل الخصم وإعادة الطباعة لأي فاتورة سابقة</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowInvoicesLedger(false);
                  setSelectedInvoice(null);
                  setSelectedInvoiceItems([]);
                }}
                className="bg-main border border-main text-muted hover:text-main px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95"
              >
                إغلاق
              </button>
            </div>

            {/* Modal Main Content Split */}
            <div className="flex-1 flex overflow-hidden divide-x divide-x-reverse divide-main">
              
              {/* Left Column: Search & Invoices List */}
              <div className="w-1/2 flex flex-col p-5 overflow-hidden">
                <div className="mb-4">
                  <input
                    type="text"
                    placeholder="ابحث برقم الفاتورة أو العميل..."
                    className="w-full bg-main border border-main text-main rounded-xl py-2.5 px-4 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs font-bold"
                    value={searchInvoiceQuery}
                    onChange={(e) => setSearchInvoiceQuery(e.target.value)}
                  />
                </div>

                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                  {allSales
                    .filter((sale: any) => {
                      const num = (sale.invoice_number || '').toLowerCase();
                      const cust = (sale.customer_name || '').toLowerCase();
                      const term = searchInvoiceQuery.toLowerCase();
                      return num.includes(term) || cust.includes(term);
                    })
                    .map((sale: any) => (
                      <div
                        key={sale.id}
                        onClick={() => handleSelectInvoice(sale)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all flex justify-between items-center ${
                          selectedInvoice?.id === sale.id
                            ? 'border-blue-500 bg-blue-600/5'
                            : 'border-main bg-panel-accent hover:border-slate-400 dark:hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="font-extrabold text-xs text-main">{sale.invoice_number}</div>
                          <div className="text-[10px] text-muted mt-1">
                            العميل: {sale.customer_name || 'عميل نقدي'} | الكاشير: {sale.cashier_name}
                          </div>
                          {Number(sale.discount) > 0 && (
                            <span className="inline-block mt-1 text-[9px] bg-rose-500/10 text-rose-500 px-1.5 py-0.5 rounded font-bold">
                              خصم: -{Number(sale.discount).toLocaleString()} ج.م
                            </span>
                          )}
                        </div>
                        <div className="text-left font-black text-emerald-500 font-mono text-xs">
                          {Number(sale.final_amount).toLocaleString()} ج.م
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Right Column: Selected Invoice Items Detail View */}
              <div className="w-1/2 p-5 flex flex-col overflow-hidden bg-panel-accent/40">
                {selectedInvoice ? (
                  <div className="flex-1 flex flex-col overflow-hidden space-y-4">
                    {/* Invoice header info */}
                    <div className="bg-panel border border-main p-4 rounded-2xl space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted">رقم الفاتورة:</span>
                        <span className="font-mono font-black text-main text-sm">{selectedInvoice.invoice_number}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted">تاريخ البيع:</span>
                        <span className="font-mono text-main">{new Date(selectedInvoice.created_at).toLocaleString('ar-EG')}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted">العميل:</span>
                        <span className="font-bold text-main">{selectedInvoice.customer_name || 'عميل نقدي'}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted">طريقة الدفع:</span>
                        <span className="font-bold text-blue-500">
                          {selectedInvoice.payment_method === 'CARD' ? 'فودافون كاش' : selectedInvoice.payment_method === 'DEBT' ? 'آجل (دين)' : 'كاش نقدي'}
                        </span>
                      </div>
                    </div>

                    {/* Invoice items list */}
                    <div className="flex-1 overflow-y-auto border border-main rounded-2xl bg-main">
                      <table className="w-full text-right text-xs">
                        <thead>
                          <tr className="bg-panel-accent text-muted border-b border-main font-bold">
                            <th className="py-2.5 px-3">اسم القطعة (المنشأ)</th>
                            <th className="py-2.5 px-3 text-center">الكمية</th>
                            <th className="py-2.5 px-3 text-left">الإجمالي</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-main text-main font-semibold">
                          {selectedInvoiceItems.map((item: any) => (
                            <tr key={item.id} className="hover:bg-panel-hover/40">
                              <td className="py-2.5 px-3">
                                <div>{item.name}</div>
                                <div className="text-[9px] text-muted font-normal">{item.origin}</div>
                              </td>
                              <td className="py-2.5 px-3 text-center text-blue-500 font-bold font-mono">{item.quantity}</td>
                              <td className="py-2.5 px-3 text-left text-emerald-500 font-bold font-mono">{Number(item.total_price).toLocaleString()} ج.م</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Totals panel */}
                    <div className="bg-panel border border-main p-4 rounded-2xl space-y-2 text-xs font-mono font-semibold">
                      <div className="flex justify-between">
                        <span className="text-muted">الإجمالي الفرعي:</span>
                        <span className="text-main">{(Number(selectedInvoice.total_amount) || 0).toLocaleString()} ج.م</span>
                      </div>
                      <div className="flex justify-between text-rose-500 font-bold">
                        <span>الخصم المطبق:</span>
                        <span>-{(Number(selectedInvoice.discount) || 0).toLocaleString()} ج.م</span>
                      </div>
                      <div className="flex justify-between text-sm font-black text-emerald-600 dark:text-emerald-400 border-t border-dashed border-main pt-2">
                        <span>الصافي النهائي:</span>
                        <span>{Number(selectedInvoice.final_amount).toLocaleString()} ج.م</span>
                      </div>
                    </div>

                    {/* Action buttons: Edit Discount & Reprint & Delete */}
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <button
                        onClick={handleOpenEditDiscount}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 shadow-md"
                      >
                        <Percent className="w-4 h-4" />
                        تعديل الخصم بعد التسليم
                      </button>

                      <button
                        onClick={handleReprintReceipt}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 shadow-md"
                      >
                        <Printer className="w-4 h-4" />
                        إعادة طباعة الفاتورة
                      </button>
                    </div>

                    <button
                      onClick={() => handleDeleteInvoice(selectedInvoice.id)}
                      className="w-full bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white border border-rose-500/20 font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 mt-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      حذف وإلغاء هذه الفاتورة نهائياً وإرجاع البضاعة
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-center space-y-2">
                    <Activity className="w-12 h-12 text-slate-400 animate-pulse" />
                    <p className="text-xs font-bold">يرجى تحديد فاتورة من القائمة الجانبية لعرض بنودها وتفاصيلها وتعديل خصمها.</p>
                  </div>
                )}
              </div>

            </div>

          </div>
        </div>
      )}

      {/* Edit Discount Modal */}
      {editDiscountModal && selectedInvoice && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in text-main">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-main pb-3">
              <div>
                <h3 className="text-base font-extrabold text-main">تعديل الخصم على الفاتورة</h3>
                <p className="text-[11px] text-muted">فاتورة رقم: {selectedInvoice.invoice_number}</p>
              </div>
              <button
                onClick={() => setEditDiscountModal(false)}
                className="text-muted hover:text-main p-1.5 rounded-lg bg-main"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-main border border-main p-3 rounded-xl flex justify-between items-center">
                <span className="text-muted font-bold">إجمالي الفاتورة قبل الخصم:</span>
                <span className="font-mono font-black text-sm text-main">{Number(selectedInvoice.total_amount).toLocaleString()} ج.م</span>
              </div>

              <div className="bg-main border border-main p-3 rounded-xl flex justify-between items-center">
                <span className="text-muted font-bold">الخصم الحالي المسجل:</span>
                <span className="font-mono font-bold text-rose-500">{Number(selectedInvoice.discount || 0).toLocaleString()} ج.م</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-main mb-1">
                  قيمة الخصم الجديدة (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  max={selectedInvoice.total_amount}
                  value={newDiscountValue}
                  onChange={(e) => setNewDiscountValue(Math.max(0, Number(e.target.value)))}
                  className="w-full bg-input-field border border-main text-main font-mono font-black text-lg py-2 px-3 rounded-xl text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-muted mb-1">
                  سبب تعديل الخصم (اختياري للتوثيق):
                </label>
                <input
                  type="text"
                  placeholder="مثال: اتفاق مع العميل بعد الفاتورة، خصم خاص..."
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  className="w-full bg-input-field border border-main text-main text-xs py-2 px-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Dynamic preview of new final amount */}
              <div className="bg-emerald-500/10 border border-emerald-500/30 p-3.5 rounded-2xl flex justify-between items-center">
                <div>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">الصافي الجديد بعد التعديل:</span>
                  <p className="text-[10px] text-muted">المبلغ المطلوب تحصيله من العميل</p>
                </div>
                <span className="font-mono font-black text-lg text-emerald-600 dark:text-emerald-400">
                  {Math.max(0, Number(selectedInvoice.total_amount) - newDiscountValue).toLocaleString()} ج.م
                </span>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSaveDiscount}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all active:scale-95 shadow-md flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                حفظ وتطبيق الخصم
              </button>
              <button
                onClick={() => setEditDiscountModal(false)}
                className="bg-main hover:bg-panel-hover text-muted border border-main font-bold py-2.5 px-4 rounded-xl text-xs transition-all active:scale-95"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal Overlay */}
      {confirmConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in text-main">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-sm space-y-4 text-center shadow-2xl">
            <div className="text-lg font-bold text-main">تأكيد الإجراء</div>
            <p className="text-xs text-muted leading-relaxed">{confirmConfig.message}</p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  confirmConfig.onConfirm();
                  setConfirmConfig(null);
                }}
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all active:scale-95 shadow-md"
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

      {/* Alert Modal Overlay */}
      {alertConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-sm space-y-4 text-center shadow-2xl text-main">
            <div className="text-lg font-bold">إشعار</div>
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
