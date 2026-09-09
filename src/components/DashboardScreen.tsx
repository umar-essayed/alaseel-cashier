import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Wifi, WifiOff, Send, Database, Layers, CheckCircle2, ShieldAlert, TrendingUp, DollarSign, Percent, BarChart3, Activity, AlertTriangle, UploadCloud } from 'lucide-react';
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
  const [searchRefundQuery, setSearchRefundQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [selectedInvoiceItems, setSelectedInvoiceItems] = useState<any[]>([]);
  
  // Refund logs state
  const [ledgerTab, setLedgerTab] = useState<'sales' | 'refunds'>('sales');
  const [refundLogs, setRefundLogs] = useState<any[]>([]);

  const loadRefundLogs = async () => {
    try {
      const logs = await (window as any).api.getRefundLogs();
      setRefundLogs(logs || []);
    } catch (e) {
      console.error('Failed to load refund logs:', e);
    }
  };

  const openInvoicesLedger = async () => {
    try {
      const sales = await dbClient.dbQuery('SELECT * FROM sales ORDER BY created_at DESC');
      setAllSales(sales || []);
      await loadRefundLogs();
      setShowInvoicesLedger(true);
      setSelectedInvoice(null);
      setSelectedInvoiceItems([]);
      setLedgerTab('sales');
    } catch (e) {
      console.error('Failed to load sales ledger:', e);
    }
  };

  const handleSelectInvoice = async (invoice: any) => {
    setSelectedInvoice(invoice);
    setRefundConfirmConfig(null);
    try {
      const items = await dbClient.dbQuery('SELECT * FROM sale_items WHERE sale_id = ?', [invoice.id]);
      setSelectedInvoiceItems(items || []);
    } catch (e) {
      console.error('Failed to load sale items:', e);
    }
  };

  // ── Discount Edit State & Handlers ─────────────────────────────────────
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountVal, setDiscountVal] = useState<number>(0);
  const [discountSaving, setDiscountSaving] = useState(false);

  const openDiscountModal = (invoice: any) => {
    setDiscountVal(invoice.discount || 0);
    setDiscountModalOpen(true);
  };

  const handleSaveDiscount = async () => {
    if (!selectedInvoice) return;
    const num = Number(discountVal);
    if (isNaN(num) || num < 0) {
      showAlert('يرجى إدخال قيمة خصم صحيحة وغير سالبة.', 'warning');
      return;
    }
    if (num > selectedInvoice.total_amount) {
      showAlert(`قيمة الخصم (${num} ج.م) لا يمكن أن تتجاوز إجمالي الفاتورة (${selectedInvoice.total_amount} ج.م).`, 'error');
      return;
    }

    setDiscountSaving(true);
    try {
      const res = await dbClient.updateInvoiceDiscount(selectedInvoice.id, num, currentUsername);
      if (res.success) {
        showAlert(`✅ تم تعديل خصم الفاتورة ${selectedInvoice.invoice_number} بنجاح إلى ${num} ج.م`, 'success');
        setDiscountModalOpen(false);
        await refreshInvoiceAfterRefund(selectedInvoice.id);
      }
    } catch (err: any) {
      showAlert(`❌ فشل تعديل الخصم: ${err?.message || 'خطأ غير معروف'}`, 'error');
    } finally {
      setDiscountSaving(false);
    }
  };

  const handleReprintInvoice = async (invoice: any, items: any[]) => {
    try {
      const res = await dbClient.printReceipt({
        storeName: storeSettings.store_name || 'الأصيل لقطع الغيار',
        phone: storeSettings.store_phone || '',
        invoiceNumber: invoice.invoice_number,
        cashierName: invoice.cashier_name,
        customerName: invoice.customer_name || 'عميل نقدي',
        items: items.map(i => ({
          name: i.name,
          origin: i.origin,
          qty: i.quantity,
          price: i.unit_price,
          total: i.total_price
        })),
        totalAmount: invoice.total_amount,
        discount: invoice.discount,
        finalAmount: invoice.final_amount,
        paymentMethod: invoice.payment_method === 'CARD' ? 'فودافون كاش' : invoice.payment_method === 'DEBT' ? 'آجل' : 'كاش نقدي',
        headerMsg: storeSettings.invoice_header || 'مرحباً بكم في محلات الأصيل لقطع الغيار',
        footerMsg: storeSettings.invoice_footer || 'الفاتورة صالحة للمرتجع خلال 14 يوماً مع العبوة الأصلية',
        qrCodeData: `INV:${invoice.invoice_number}|AMT:${invoice.final_amount}`
      });
      if (res.success) {
        showAlert('🖨️ تم إرسال أمر طباعة الفاتورة المحدثة بنجاح إلى الطابعة.', 'success');
      } else {
        showAlert(res.error || 'فشل إرسال أمر الطباعة', 'warning');
      }
    } catch (e: any) {
      showAlert(`خطأ أثناء الطباعة: ${e.message}`, 'error');
    }
  };

  // ── Refund State & Handlers ──────────────────────────────────────────────
  const [refundConfirmConfig, setRefundConfirmConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [refundLoading, setRefundLoading] = useState(false);
  const [partialRefundQty, setPartialRefundQty] = useState<Record<string, number>>({});

  const refreshInvoiceAfterRefund = async (invoiceId: string) => {
    try {
      const sales = await dbClient.dbQuery('SELECT * FROM sales ORDER BY created_at DESC');
      setAllSales(sales || []);
      const updatedInvoice = (sales || []).find((s: any) => s.id === invoiceId);
      if (updatedInvoice) {
        setSelectedInvoice(updatedInvoice);
        const items = await dbClient.dbQuery('SELECT * FROM sale_items WHERE sale_id = ?', [invoiceId]);
        setSelectedInvoiceItems(items || []);
      }
      await loadRefundLogs();
      loadAnalyticsData();
      onRefreshData();
    } catch (e) {
      console.error('Failed to refresh after refund:', e);
    }
  };

  const handlePartialRefund = (item: any) => {
    const qty = partialRefundQty[item.id] || 1;
    if (qty <= 0 || qty > item.quantity) {
      showAlert(`الكمية المرتجعة يجب أن تكون بين 1 و ${item.quantity}`, 'error');
      return;
    }
    setRefundConfirmConfig({
      title: 'تأكيد المرتجع الجزئي',
      message: `هل تريد إرجاع ${qty} قطعة من "${item.name}"؟ سيتم إرجاع الكمية للمخزن وتعديل قيمة الفاتورة.`,
      onConfirm: async () => {
        setRefundLoading(true);
        try {
          await (window as any).api.refundSaleItem(item.id, qty, currentUsername);
          showAlert(`✅ تم مرتجع ${qty} قطعة من "${item.name}" بنجاح وإضافتها للمخزن`, 'success');
          await refreshInvoiceAfterRefund(item.sale_id);
        } catch (e: any) {
          showAlert(`❌ فشل المرتجع: ${e?.message || 'خطأ غير معروف'}`, 'error');
        } finally {
          setRefundLoading(false);
          setRefundConfirmConfig(null);
        }
      }
    });
  };

  const handleFullRefund = (invoice: any) => {
    setRefundConfirmConfig({
      title: 'تأكيد المرتجع الكامل',
      message: `هل تريد إرجاع الفاتورة رقم "${invoice.invoice_number}" بالكامل؟ سيتم إرجاع جميع الأصناف للمخزن وتصفير قيمة الفاتورة.`,
      onConfirm: async () => {
        setRefundLoading(true);
        try {
          await (window as any).api.refundWholeSale(invoice.id, currentUsername);
          showAlert(`✅ تم مرتجع الفاتورة ${invoice.invoice_number} بالكامل بنجاح وإضافة جميع الأصناف للمخزن`, 'success');
          await refreshInvoiceAfterRefund(invoice.id);
        } catch (e: any) {
          showAlert(`❌ فشل المرتجع: ${e?.message || 'خطأ غير معروف'}`, 'error');
        } finally {
          setRefundLoading(false);
          setRefundConfirmConfig(null);
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
    dailySales: 0,
    totalStockCost: 0,
    totalEnteredCost: 0,
    totalEnteredQty: 0
  });

  const [topItems, setTopItems] = useState<Array<{ name: string; origin: string; qty: number; revenue: number }>>([]);
  const [recentSales, setRecentSales] = useState<any[]>([]);

  // Raw datasets for interactive charts (matching alaseel_dashboard_final_mobile_prices.html)
  const [chartSales, setChartSales] = useState<any[]>([]);
  const [chartSaleItems, setChartSaleItems] = useState<any[]>([]);
  const [chartVariants, setChartVariants] = useState<any[]>([]);
  const [chartPeriod, setChartPeriod] = useState<'7' | '30' | '90' | 'all'>('7');
  const [chartPaymentMethod, setChartPaymentMethod] = useState<string>('');

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

      const salesList = sales || [];
      const itemsList = saleItems || [];
      const varList = variants || [];

      // 1. Core Calculations
      let totalRevenue = 0;
      let totalCost = 0;
      let cashSales = 0;
      let vodaSales = 0;
      let dailySales = 0;

      const localTodayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

      salesList.forEach((s: any) => {
        totalRevenue += s.final_amount;
        
        // Calculate today's sales
        if (s.created_at && s.created_at.startsWith(localTodayStr)) {
          dailySales += s.final_amount;
        }

        // Detect Vodafone Cash transactions (mapped to 'CARD' in DB or containing vodafone cash tag)
        const isVodafone = s.payment_method === 'CARD' || (s.customer_name && s.customer_name.includes('فودافون كاش'));
        if (isVodafone) {
          vodaSales += s.final_amount;
        } else {
          cashSales += s.final_amount;
        }
      });

      itemsList.forEach((item: any) => {
        totalCost += (item.cost_price * item.quantity);
      });

      const netProfit = totalRevenue - totalCost;
      const profitMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;

      // Exact calculation from alaseel_dashboard_final_mobile_prices.html:
      // إجمالي تكلفة البضاعة الداخلة = المخزون الحالي بالتكلفة + تكلفة ما تم بيعه
      const currentStockCost = varList.reduce((sum: number, v: any) => sum + (Number(v.stock_quantity) || 0) * (Number(v.cost_price) || 0), 0);
      const totalEnteredCost = currentStockCost + totalCost;
      const totalEnteredQty = varList.reduce((sum: number, v: any) => sum + (Number(v.stock_quantity) || 0), 0) + itemsList.reduce((sum: number, i: any) => sum + (Number(i.quantity) || 0), 0);

      setChartSales(salesList);
      setChartSaleItems(itemsList);
      setChartVariants(varList);

      setMetrics({
        totalSales: totalRevenue,
        totalCost,
        netProfit,
        profitMargin,
        invoicesCount: salesList.length,
        cashSales,
        vodaSales,
        dailySales,
        totalStockCost: currentStockCost,
        totalEnteredCost,
        totalEnteredQty
      });

      // 2. Top Selling Items Compilation
      const itemGroups: Record<string, { name: string; origin: string; qty: number; revenue: number }> = {};
      itemsList.forEach((item: any) => {
        const vId = item.variant_id;
        const matchedVar = varList.find(v => v.id === vId);
        const name = item.name || matchedVar?.product_name || 'قطعة غيار';
        const origin = item.origin || matchedVar?.origin || 'غير محدد';

        if (!itemGroups[vId]) {
          itemGroups[vId] = { name, origin, qty: 0, revenue: 0 };
        }
        itemGroups[vId].qty += item.quantity;
        itemGroups[vId].revenue += item.total_price;
      });

      const sortedItems = Object.values(itemGroups)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5); // top 5 items
      setTopItems(sortedItems);

      // 3. Recent Transactions
      setRecentSales(salesList.slice(0, 5));

    } catch (e) {
      console.error('Failed to compile analytics:', e);
    }
  };

  // Filtered sales for the charts (matching alaseel_dashboard_final_mobile_prices.html)
  const filteredSalesForChart = useMemo(() => {
    let list = chartSales.filter(s => !chartPaymentMethod || s.payment_method === chartPaymentMethod);
    if (chartPeriod !== 'all') {
      const days = Number(chartPeriod);
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      from.setDate(from.getDate() - days + 1);
      list = list.filter(s => new Date(s.created_at) >= from);
    }
    return list;
  }, [chartSales, chartPeriod, chartPaymentMethod]);

  // Daily Sales & Profits trend data
  const salesChartData = useMemo(() => {
    const daysCount = chartPeriod === '7' ? 7 : chartPeriod === '30' ? 30 : chartPeriod === '90' ? 90 : 30;
    const now = new Date();
    const result: Array<{ dateKey: string; label: string; sales: number; profit: number; cogs: number }> = [];

    const itemCostBySaleId: Record<string, number> = {};
    chartSaleItems.forEach((it: any) => {
      if (!itemCostBySaleId[it.sale_id]) itemCostBySaleId[it.sale_id] = 0;
      itemCostBySaleId[it.sale_id] += (Number(it.cost_price) || 0) * (Number(it.quantity) || 0);
    });

    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const dateKey = d.toLocaleDateString('en-CA');
      const label = d.toLocaleDateString('ar-EG', { weekday: daysCount <= 7 ? 'short' : undefined, day: 'numeric', month: 'numeric' });

      const daySales = filteredSalesForChart.filter(s => s.created_at && s.created_at.startsWith(dateKey));
      const daySalesTotal = daySales.reduce((sum, s) => sum + (Number(s.final_amount) || 0), 0);
      const dayCostTotal = daySales.reduce((sum, s) => sum + (itemCostBySaleId[s.id] || 0), 0);
      const dayProfit = daySalesTotal - dayCostTotal;

      result.push({
        dateKey,
        label,
        sales: daySalesTotal,
        profit: dayProfit,
        cogs: dayCostTotal
      });
    }

    const maxVal = Math.max(...result.map(r => Math.max(r.sales, r.profit, 100)));
    const totalSalesPeriod = result.reduce((sum, r) => sum + r.sales, 0);
    const totalProfitPeriod = result.reduce((sum, r) => sum + r.profit, 0);

    return { points: result, maxVal, totalSalesPeriod, totalProfitPeriod };
  }, [filteredSalesForChart, chartSaleItems, chartPeriod]);

  // Category distribution data (matching alaseel_dashboard_final_mobile_prices.html)
  const categoryChartData = useMemo(() => {
    const catMap: Record<string, number> = {};
    chartVariants.forEach((v: any) => {
      const cat = v.category || 'غير مصنف';
      const val = (Number(v.stock_quantity) || 0) * (Number(v.selling_price) || 0);
      catMap[cat] = (catMap[cat] || 0) + val;
    });

    const entries = Object.entries(catMap)
      .map(([name, value]) => ({ name, value }))
      .filter(x => x.value > 0)
      .sort((a, b) => b.value - a.value);

    const totalVal = entries.reduce((sum, x) => sum + x.value, 0);
    const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b', '#f97316'];

    return {
      entries: entries.slice(0, 7).map((e, idx) => ({
        ...e,
        color: colors[idx % colors.length],
        percent: totalVal > 0 ? ((e.value / totalVal) * 100).toFixed(1) : '0'
      })),
      totalVal
    };
  }, [chartVariants]);

  useEffect(() => {
    loadAnalyticsData();
  }, [syncQueueCount]);

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

          } else if (item.table_name === 'products_delete') {
            const { error: delErr } = await supabase.from('products').delete().eq('id', payload.id);
            if (delErr) throw delErr;

          } else if (item.table_name === 'product_variants_delete') {
            const { error: delErr } = await supabase.from('product_variants').delete().eq('id', payload.id);
            if (delErr) throw delErr;
            if (payload.deleteProduct) {
              const { error: pDelErr } = await supabase.from('products').delete().eq('id', payload.product_id);
              if (pDelErr) throw pDelErr;
            }

          } else if (item.table_name === 'suppliers_delete') {
            const { error: delErr } = await supabase.from('suppliers').delete().eq('id', payload.id);
            if (delErr) throw delErr;

          } else if (item.table_name === 'credit_customers_delete') {
            const { error: delErr } = await supabase.from('credit_customers').delete().eq('id', payload.id);
            if (delErr) throw delErr;
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
      case 'products_delete': return 'حذف صنف من المخزن';
      case 'product_variants_delete': return 'حذف متغير/منشأ قطعة غيار';
      case 'suppliers_delete': return 'حذف مورد نهائياً';
      case 'credit_customers_delete': return 'حذف عميل آجل نهائياً';
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
      if (item.table_name.endsWith('_delete')) {
        return `إجراء حذف نهائي للمعرف: ${payload.id}`;
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


      {/* Analytics statistics cards grid (matching alaseel_dashboard_final_mobile_prices.html) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {/* Daily Sales Card */}
        <div className="glass-panel p-3.5 bg-panel border-main flex items-center gap-3 border-r-4 border-r-blue-500">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
            <DollarSign className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <p className="text-[10px] text-muted font-bold">مبيعات اليوم</p>
            <p className="text-lg font-black text-blue-500 mt-0.5">{metrics.dailySales.toLocaleString()} <span className="text-[10px] font-normal">ج.م</span></p>
          </div>
        </div>

        <div className="glass-panel p-3.5 bg-panel border-main flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted font-bold">إجمالي المبيعات</p>
            <p className="text-lg font-black text-main mt-0.5">{metrics.totalSales.toLocaleString()} <span className="text-[10px] font-normal">ج.م</span></p>
            <p className="text-[9px] text-muted font-mono">{metrics.invoicesCount} فاتورة</p>
          </div>
        </div>

        <div className="glass-panel p-3.5 bg-panel border-main flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted font-bold">تكلفة المباع</p>
            <p className="text-lg font-black text-main mt-0.5">{metrics.totalCost.toLocaleString()} <span className="text-[10px] font-normal">ج.م</span></p>
            <p className="text-[9px] text-muted">تكلفة القطع المباعة</p>
          </div>
        </div>

        <div className="glass-panel p-3.5 bg-panel border-main flex items-center gap-3 border-l-4 border-l-emerald-500">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted font-bold">صافي الأرباح</p>
            <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5">{metrics.netProfit.toLocaleString()} <span className="text-[10px] font-normal">ج.م</span></p>
            <p className="text-[9px] text-emerald-600/80 font-bold">هامش: {metrics.profitMargin}%</p>
          </div>
        </div>

        <div className="glass-panel p-3.5 bg-panel border-main flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500 shrink-0">
            <Percent className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted font-bold">هامش الربح</p>
            <p className="text-lg font-black text-purple-500 mt-0.5">{metrics.profitMargin}%</p>
            <p className="text-[9px] text-muted">الربح ÷ المبيعات</p>
          </div>
        </div>

        {/* Total Warehouse Entered Cost Card (Matching alaseel_dashboard_final_mobile_prices.html red card) */}
        <div className="glass-panel p-3.5 bg-panel border-main flex items-center gap-3 border-l-4 border-l-rose-500">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500 shrink-0">
            <span className="text-lg font-black">▣</span>
          </div>
          <div>
            <p className="text-[10px] text-rose-600 dark:text-rose-400 font-extrabold">إجمالي تكلفة البضاعة الداخلة</p>
            <p className="text-lg font-black text-rose-600 dark:text-rose-400 mt-0.5">{metrics.totalEnteredCost.toLocaleString()} <span className="text-[10px] font-normal">ج.م</span></p>
            <p className="text-[8px] text-muted leading-tight">المخزون الحالي بالتكلفة + تكلفة ما تم بيعه</p>
          </div>
        </div>
      </div>

      {/* ── Interactive Charts Section (matching alaseel_dashboard_final_mobile_prices.html) ── */}
      <div className="space-y-4">
        {/* Filter controls row */}
        <div className="glass-panel p-3.5 bg-panel border-main flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted">الفترة الزمنية للرسم:</span>
            <div className="flex gap-1 bg-main p-1 rounded-xl border border-main">
              {(['7', '30', '90', 'all'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setChartPeriod(p)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    chartPeriod === p
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-muted hover:text-main'
                  }`}
                >
                  {p === '7' ? 'آخر 7 أيام' : p === '30' ? 'آخر 30 يوم' : p === '90' ? 'آخر 90 يوم' : 'كل الفترات'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted">طريقة الدفع:</span>
            <select
              value={chartPaymentMethod}
              onChange={e => setChartPaymentMethod(e.target.value)}
              className="bg-main border border-main text-main text-xs font-bold rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">كل طرق الدفع</option>
              <option value="CASH">نقدي (كاش)</option>
              <option value="CARD">فودافون كاش / بطاقة</option>
              <option value="DEBT">آجل / دين</option>
            </select>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Sales & Profits Trend Chart (8 cols) */}
          <div className="lg:col-span-8 glass-panel p-5 bg-panel border-main space-y-4">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
              <div>
                <h3 className="font-bold text-base text-main flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-500" />
                  منحنى المبيعات والأرباح
                </h3>
                <p className="text-[11px] text-muted mt-0.5">
                  تتبع يومي دقيق لصافي المبيعات والأرباح الفعلية بعد خصم تكلفة البضاعة
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span>
                  <span className="font-bold text-main">المبيعات: {salesChartData.totalSalesPeriod.toLocaleString()} ج.م</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">الأرباح: {salesChartData.totalProfitPeriod.toLocaleString()} ج.م</span>
                </div>
              </div>
            </div>

            {/* SVG Interactive Line / Area Chart */}
            <div className="w-full h-64 relative bg-main/40 rounded-2xl p-4 border border-main flex flex-col justify-end">
              {salesChartData.points.length === 0 || salesChartData.totalSalesPeriod === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-muted font-bold">
                  لا توجد مبيعات مسجلة في هذه الفترة المحددة
                </div>
              ) : (
                <svg className="w-full h-full overflow-visible" viewBox="0 0 800 200" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                    </linearGradient>
                    <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Guide lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => (
                    <line
                      key={idx}
                      x1="0"
                      y1={200 - pct * 180}
                      x2="800"
                      y2={200 - pct * 180}
                      stroke="currentColor"
                      strokeOpacity="0.07"
                      strokeDasharray="4 4"
                    />
                  ))}

                  {/* Generate path curves */}
                  {(() => {
                    const pts = salesChartData.points;
                    const max = Math.max(salesChartData.maxVal, 1);
                    const n = pts.length;
                    const getX = (i: number) => (n <= 1 ? 400 : (i / (n - 1)) * 780 + 10);
                    const getY = (val: number) => 190 - (Math.max(0, val) / max) * 160;

                    let salesPath = `M ${getX(0)} ${getY(pts[0].sales)}`;
                    let profitPath = `M ${getX(0)} ${getY(pts[0].profit)}`;

                    for (let i = 1; i < n; i++) {
                      const prevX = getX(i - 1);
                      const prevY_s = getY(pts[i - 1].sales);
                      const curX = getX(i);
                      const curY_s = getY(pts[i].sales);
                      const cpX1 = prevX + (curX - prevX) / 2;
                      salesPath += ` C ${cpX1} ${prevY_s}, ${cpX1} ${curY_s}, ${curX} ${curY_s}`;

                      const prevY_p = getY(pts[i - 1].profit);
                      const curY_p = getY(pts[i].profit);
                      profitPath += ` C ${cpX1} ${prevY_p}, ${cpX1} ${curY_p}, ${curX} ${curY_p}`;
                    }

                    const salesArea = `${salesPath} L ${getX(n - 1)} 190 L ${getX(0)} 190 Z`;
                    const profitArea = `${profitPath} L ${getX(n - 1)} 190 L ${getX(0)} 190 Z`;

                    return (
                      <>
                        <path d={salesArea} fill="url(#salesGrad)" />
                        <path d={salesPath} fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
                        <path d={profitArea} fill="url(#profitGrad)" />
                        <path d={profitPath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />

                        {pts.map((pt, i) => (
                          <g key={i}>
                            <circle cx={getX(i)} cy={getY(pt.sales)} r="3.5" fill="#3b82f6" stroke="#fff" strokeWidth="1.5">
                              <title>{`${pt.label} | مبيعات: ${pt.sales.toLocaleString()} ج.م`}</title>
                            </circle>
                            <circle cx={getX(i)} cy={getY(pt.profit)} r="3" fill="#10b981" stroke="#fff" strokeWidth="1.5">
                              <title>{`${pt.label} | ربح: ${pt.profit.toLocaleString()} ج.م`}</title>
                            </circle>
                          </g>
                        ))}
                      </>
                    );
                  })()}
                </svg>
              )}
            </div>

            {/* X-Axis labels */}
            <div className="flex justify-between text-[10px] text-muted font-mono px-2">
              {salesChartData.points
                .filter((_, idx, arr) => arr.length <= 10 || idx % Math.ceil(arr.length / 8) === 0 || idx === arr.length - 1)
                .map((pt, idx) => (
                  <span key={idx}>{pt.label}</span>
                ))}
            </div>
          </div>

          {/* Category Distribution Doughnut Chart (4 cols) */}
          <div className="lg:col-span-4 glass-panel p-5 bg-panel border-main space-y-4 flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-base text-main flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-500" />
                قيمة المخزون حسب الفئة
              </h3>
              <p className="text-[11px] text-muted mt-0.5">
                توزيع استثمارات بضاعة المحل بسعر البيع
              </p>
            </div>

            {/* Doughnut SVG */}
            <div className="relative flex items-center justify-center my-2">
              <svg className="w-40 h-40 transform -rotate-90" viewBox="0 0 100 100">
                {(() => {
                  const total = categoryChartData.totalVal || 1;
                  let accumulatedPercent = 0;
                  return categoryChartData.entries.map((cat, idx) => {
                    const strokePercent = (cat.value / total) * 100;
                    const strokeDasharray = `${strokePercent} ${100 - strokePercent}`;
                    const strokeDashoffset = -accumulatedPercent;
                    accumulatedPercent += strokePercent;
                    return (
                      <circle
                        key={idx}
                        cx="50"
                        cy="50"
                        r="35"
                        fill="transparent"
                        stroke={cat.color}
                        strokeWidth="14"
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                        pathLength="100"
                        className="transition-all duration-500 hover:opacity-80"
                      />
                    );
                  });
                })()}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                <span className="text-[9px] text-muted font-bold">إجمالي البيع</span>
                <span className="font-mono font-black text-sm text-main">
                  {Math.round(categoryChartData.totalVal).toLocaleString()}
                </span>
                <span className="text-[8px] text-muted">ج.م</span>
              </div>
            </div>

            {/* Category legend list */}
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {categoryChartData.entries.map((cat, idx) => (
                <div key={idx} className="flex justify-between items-center text-xs py-1 border-b border-main/50 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }}></span>
                    <span className="font-bold text-main truncate max-w-[120px]">{cat.name}</span>
                  </div>
                  <div className="text-left font-mono">
                    <span className="font-bold text-main">{cat.value.toLocaleString()} ج.م</span>
                    <span className="text-[10px] text-muted mr-1.5">({cat.percent}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Breakdown split layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: Top selling items and Payment methods (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Top Selling Items */}
          <div className="glass-panel p-5 bg-panel border-main space-y-4">
            <h3 className="font-bold text-base text-main flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-500" />
              القطع الأكثر مبيعاً وطلباً بالمحل (Top Selling)
            </h3>
            
            <div className="border border-main rounded-xl overflow-hidden bg-main">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-panel-accent text-muted border-b border-main text-xs font-bold uppercase tracking-wider">
                    <th className="py-3 px-4">اسم قطعة الغيار (المنشأ)</th>
                    <th className="py-3 px-4 text-center">الكمية المباعة</th>
                    <th className="py-3 px-4 text-left">قيمة المبيعات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-main text-main font-semibold">
                  {topItems.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-slate-500">لا توجد مبيعات مسجلة لعرض تحليلات الأصناف حالياً.</td>
                    </tr>
                  ) : (
                    topItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-panel-hover/50">
                        <td className="py-3.5 px-4 font-bold text-main">{item.name} <span className="text-[10px] text-muted font-normal">({item.origin})</span></td>
                        <td className="py-3.5 px-4 text-center text-blue-600 dark:text-blue-400 font-black">{item.qty} قطع</td>
                        <td className="py-3.5 px-4 text-left text-emerald-500 font-black">{item.revenue.toLocaleString()} ج.م</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment Methods breakdown */}
          <div className="glass-panel p-5 bg-panel border-main space-y-4">
            <h3 className="font-bold text-base text-main">توزيع المبيعات حسب طريقة الدفع</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {/* Cash vs Vodafone cash visual comparison */}
              <div className="space-y-4">
                {/* Cash */}
                <div>
                  <div className="flex justify-between text-xs text-muted mb-1 font-bold">
                    <span>نقدي / كاش</span>
                    <span className="text-main font-black">{metrics.cashSales.toLocaleString()} ج.م ({metrics.totalSales > 0 ? Math.round((metrics.cashSales / metrics.totalSales) * 100) : 0}%)</span>
                  </div>
                  <div className="w-full bg-main h-3 rounded-full overflow-hidden border border-main">
                    <div className="bg-emerald-500 h-full transition-all" style={{ width: `${metrics.totalSales > 0 ? (metrics.cashSales / metrics.totalSales) * 100 : 0}%` }}></div>
                  </div>
                </div>

                {/* Vodafone Cash */}
                <div>
                  <div className="flex justify-between text-xs text-muted mb-1 font-bold">
                    <span>فودافون كاش</span>
                    <span className="text-main font-black">{metrics.vodaSales.toLocaleString()} ج.م ({metrics.totalSales > 0 ? Math.round((metrics.vodaSales / metrics.totalSales) * 100) : 0}%)</span>
                  </div>
                  <div className="w-full bg-main h-3 rounded-full overflow-hidden border border-main">
                    <div className="bg-rose-500 h-full transition-all" style={{ width: `${metrics.totalSales > 0 ? (metrics.vodaSales / metrics.totalSales) * 100 : 0}%` }}></div>
                  </div>
                </div>
              </div>

              {/* General Insights */}
              <div className="bg-panel-accent p-4 rounded-xl border border-main space-y-2 text-xs text-muted leading-relaxed">
                <p className="font-bold text-main">💡 نظرة تحليلية سريعة:</p>
                <p>
                  إجمالي الفواتير المحررة بالمحل يبلغ <span className="font-bold text-main">{metrics.invoicesCount} فواتير</span>. 
                  مبيعات الكاش النقدي تشكل النسبة الكبرى، تليها التحويلات الإلكترونية المستلمة عبر أرقام فودافون كاش المعتمدة بالمحل.
                </p>
              </div>
            </div>
          </div>

        </div>

        {/* Right: Recent transactions & Sync monitoring queue (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Recent Invoices list */}
          <div className="glass-panel p-4 bg-panel border-main flex flex-col h-[280px] overflow-hidden">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-main">
              <h3 className="font-bold text-xs text-main font-bold">آخر 5 فواتير مبيعات صادرة</h3>
              <button
                type="button"
                onClick={openInvoicesLedger}
                className="text-[10px] text-blue-500 hover:text-blue-400 font-bold active:scale-95 transition-all select-none"
              >
                عرض كل الفواتير
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {recentSales.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">لا توجد فواتير مبيعات مسجلة اليوم.</p>
              ) : (
                recentSales.map((sale, idx) => (
                  <div key={idx} className="bg-panel-accent border border-main p-2.5 rounded-xl flex justify-between items-center text-xs">
                    <div>
                      <span className="font-bold text-main">{sale.invoice_number}</span>
                      <p className="text-[10px] text-muted mt-1 truncate max-w-[150px]">{sale.customer_name}</p>
                    </div>
                    <span className="font-black text-emerald-500">{sale.final_amount.toFixed(0)} ج.م</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Sync status log */}
          <div className="glass-panel p-4 bg-panel border-main flex flex-col h-[280px] overflow-hidden">
            <h3 className="font-bold text-xs text-main mb-3 pb-2 border-b border-main flex justify-between items-center">
              <span>طابور المزامنة السحابية</span>
              {syncQueue.length > 0 && <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>}
            </h3>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 text-xs">
              {syncQueue.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-1" />
                  <p className="text-[11px] font-bold">جميع الحركات مزامنة وآمنة سحابياً</p>
                </div>
              ) : (
                syncQueue.map(item => (
                  <div key={item.id} className="bg-panel-accent border border-main p-2.5 rounded-xl space-y-1">
                    <div className="flex justify-between items-center font-bold">
                      <span className="text-main">{getArabicTableName(item.table_name)}</span>
                      {item.status === 'failed' ? (
                        <span className="text-[9px] bg-rose-500/10 text-rose-500 px-1.5 py-0.5 rounded border border-rose-500/10" title={item.error_message || ''}>فشلت</span>
                      ) : (
                        <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded border border-amber-500/10">معلقة</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted">{getBusinessDetails(item)}</p>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>

      {/* Sync Logging details section */}
      {syncing && (
        <div className="glass-panel p-4 bg-blue-600/10 border-blue-500/20 text-blue-600 dark:text-blue-400 font-mono text-xs animate-pulse">
          ⏳ {progressMsg}
        </div>
      )}

      {/* Detailed Invoices Ledger Modal */}
      {showInvoicesLedger && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6 z-40 animate-fade-in text-main">
          <div className="bg-panel border border-main rounded-3xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden shadow-2xl relative">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-main flex justify-between items-center bg-panel-accent">
              <div>
                <h3 className="font-extrabold text-base text-main">سجل الفواتير والمبيعات التفصيلي (محلي)</h3>
                <p className="text-[10px] text-muted mt-0.5">البحث والمراجعة التفصيلية لكافة عمليات البيع بالمحل دون طباعة</p>
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

            {/* Tab Selector */}
            <div className="flex bg-panel border-b border-main px-5 py-2 gap-2 select-none shrink-0">
              <button
                type="button"
                onClick={() => setLedgerTab('sales')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  ledgerTab === 'sales'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-muted hover:text-main bg-main'
                }`}
              >
                📝 سجل فواتير المبيعات
              </button>
              <button
                type="button"
                onClick={() => setLedgerTab('refunds')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  ledgerTab === 'refunds'
                    ? 'bg-rose-600 text-white shadow-md'
                    : 'text-muted hover:text-main bg-main'
                }`}
              >
                ↩️ سجل المرتجعات التفصيلي ({refundLogs.length})
              </button>
            </div>

            {ledgerTab === 'sales' ? (
              /* Modal Main Content Split (Sales Invoices Ledger) */
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
                            <div className="text-[10px] text-muted mt-1">العميل: {sale.customer_name || 'نقدي'} | الكاشير: {sale.cashier_name}</div>
                          </div>
                          <div className="text-left font-black text-emerald-500 font-mono text-xs">
                            {sale.final_amount.toLocaleString()} ج.م
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
                          <span className="text-muted">طريقة الدفع:</span>
                          <span className="font-bold text-blue-500">
                            {selectedInvoice.payment_method === 'CARD' ? 'فودافون كاش' : selectedInvoice.payment_method === 'DEBT' ? 'آجل / دين' : 'كاش نقدي'}
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
                              <th className="py-2.5 px-3 text-center">مرتجع</th>
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
                                <td className="py-2.5 px-3 text-left text-emerald-500 font-bold font-mono">{item.total_price.toLocaleString()} ج.م</td>
                                <td className="py-2 px-2">
                                  <div className="flex items-center gap-1 justify-center">
                                    <input
                                      type="number"
                                      min={1}
                                      max={item.quantity}
                                      value={partialRefundQty[item.id] ?? 1}
                                      onChange={e => setPartialRefundQty(prev => ({ ...prev, [item.id]: parseInt(e.target.value) || 1 }))}
                                      className="w-12 bg-input-field border border-main text-main rounded-lg text-center py-1 text-[10px]"
                                    />
                                    <button
                                      onClick={() => handlePartialRefund(item)}
                                      className="bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 rounded-lg px-2 py-1 text-[10px] font-bold transition-all whitespace-nowrap"
                                    >
                                      ↩️ رجّع
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Totals panel */}
                      <div className="bg-panel border border-main p-4 rounded-2xl space-y-2 text-xs font-mono font-semibold">
                        <div className="flex justify-between">
                          <span className="text-muted">الإجمالي الفرعي:</span>
                          <span className="text-main">{(selectedInvoice.total_amount || 0).toLocaleString()} ج.م</span>
                        </div>
                        <div className="flex justify-between items-center text-rose-500 font-bold">
                          <div className="flex items-center gap-2">
                            <span>الخصم المطبق:</span>
                            <button
                              onClick={() => openDiscountModal(selectedInvoice)}
                              className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/30 px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1 font-sans cursor-pointer"
                              title="تعديل خصم الفاتورة بعد البيع"
                            >
                              🏷️ تعديل الخصم
                            </button>
                          </div>
                          <span>-{(selectedInvoice.discount || 0).toLocaleString()} ج.م</span>
                        </div>
                        <div className="flex justify-between text-sm font-black text-emerald-600 dark:text-emerald-400 border-t border-dashed border-main pt-2">
                          <span>الصافي النهائي:</span>
                          <span>{selectedInvoice.final_amount.toLocaleString()} ج.م</span>
                        </div>
                        
                        {/* Action buttons */}
                        <div className="grid grid-cols-2 gap-2 mt-2 pt-1 font-sans">
                          <button
                            onClick={() => openDiscountModal(selectedInvoice)}
                            className="py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/30 font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5"
                          >
                            🏷️ تعديل الخصم
                          </button>
                          <button
                            onClick={() => handleReprintInvoice(selectedInvoice, selectedInvoiceItems)}
                            className="py-2 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 text-blue-500 border border-blue-500/30 font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5"
                          >
                            🖨️ طباعة إيصال
                          </button>
                        </div>

                        {selectedInvoiceItems.length > 0 && (
                          <button
                            onClick={() => handleFullRefund(selectedInvoice)}
                            className="w-full mt-1 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 font-bold text-xs transition-all active:scale-95 font-sans"
                          >
                            ↩️ مرتجع كامل للفاتورة بالكامل
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-center space-y-2">
                      <Activity className="w-12 h-12 text-slate-400 animate-pulse" />
                      <p className="text-xs font-bold">يرجى تحديد فاتورة من القائمة الجانبية لعرض بنودها وتفاصيلها المالية بالكامل.</p>
                    </div>
                  )}
                </div>

              </div>
            ) : (
              /* Refunds Log View (Tab 2) */
              <div className="flex-1 flex flex-col p-5 overflow-hidden space-y-4">
                
                {/* Stats & Search header row */}
                <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
                  <div className="flex items-center gap-4">
                    <div className="bg-rose-500/10 border border-rose-500/20 px-4 py-2 rounded-xl text-center">
                      <div className="text-[10px] text-muted mb-0.5">إجمالي المبالغ المستردة</div>
                      <div className="font-black text-rose-400 font-mono text-sm">
                        {refundLogs
                          .filter(log => !searchRefundQuery || (log.name || '').toLowerCase().includes(searchRefundQuery.toLowerCase()) || (log.invoice_number || '').toLowerCase().includes(searchRefundQuery.toLowerCase()))
                          .reduce((sum, log) => sum + (log.refund_amount || 0), 0)
                          .toLocaleString()} ج.م
                      </div>
                    </div>
                    <div className="bg-panel-accent border border-main px-4 py-2 rounded-xl text-center">
                      <div className="text-[10px] text-muted mb-0.5">عدد حركات الارتجاع</div>
                      <div className="font-black text-main font-mono text-sm">
                        {refundLogs.filter(log => !searchRefundQuery || (log.name || '').toLowerCase().includes(searchRefundQuery.toLowerCase()) || (log.invoice_number || '').toLowerCase().includes(searchRefundQuery.toLowerCase())).length} حركة
                      </div>
                    </div>
                  </div>

                  <input
                    type="text"
                    placeholder="ابحث باسم الصنف أو رقم الفاتورة..."
                    className="bg-main border border-main text-main rounded-xl py-2 px-4 text-right focus:outline-none focus:ring-2 focus:ring-rose-500 text-xs font-bold w-full md:w-64"
                    value={searchRefundQuery}
                    onChange={(e) => setSearchRefundQuery(e.target.value)}
                  />
                </div>

                {/* Table list */}
                <div className="flex-1 overflow-y-auto border border-main rounded-2xl bg-main">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-panel-accent border-b border-main text-muted font-bold sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-3">رقم الفاتورة</th>
                        <th className="py-2.5 px-3">اسم القطعة والمنشأ</th>
                        <th className="py-2.5 px-3 text-center">الكمية المرتجعة</th>
                        <th className="py-2.5 px-3 text-left">المبلغ المسترد</th>
                        <th className="py-2.5 px-3 text-center">الكاشير</th>
                        <th className="py-2.5 px-3 text-center">تاريخ المرتجع</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-main text-main font-semibold">
                      {refundLogs.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-slate-500 font-bold">لا توجد حركات مرتجعة مسجلة في النظام حالياً.</td>
                        </tr>
                      ) : (
                        refundLogs
                          .filter(log => !searchRefundQuery || (log.name || '').toLowerCase().includes(searchRefundQuery.toLowerCase()) || (log.invoice_number || '').toLowerCase().includes(searchRefundQuery.toLowerCase()))
                          .map((log) => (
                            <tr key={log.id} className="hover:bg-panel-hover/30">
                              <td className="py-3 px-3 font-mono text-blue-500 font-bold">{log.invoice_number}</td>
                              <td className="py-3 px-3">
                                <div>{log.name}</div>
                                <div className="text-[9px] text-muted font-normal">{log.origin}</div>
                              </td>
                              <td className="py-3 px-3 text-center font-mono font-bold text-rose-500">
                                {log.quantity}
                              </td>
                              <td className="py-3 px-3 text-left font-black font-mono text-rose-500">
                                {log.refund_amount.toLocaleString()} ج.م
                              </td>
                              <td className="py-3 px-3 text-center text-muted text-[10px]">
                                {log.cashier_name}
                              </td>
                              <td className="py-3 px-3 text-center text-muted text-[10px] font-mono">
                                {new Date(log.created_at).toLocaleString('ar-EG')}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>

              </div>
            )}

          </div>
        </div>
      )}

      {/* Custom Reusable React Alert Modal Overlay */}
      {alertConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-sm space-y-4 text-center shadow-2xl text-main">
            <div className={`text-lg font-bold ${alertConfig.type === 'error' ? 'text-rose-500' : alertConfig.type === 'warning' ? 'text-amber-500' : 'text-emerald-500'}`}>
              {alertConfig.type === 'error' ? '❌ خطأ' : alertConfig.type === 'warning' ? '⚠️ تحذير' : '✅ نجاح'}
            </div>
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

      {/* Refund Confirmation Modal */}
      {refundConfirmConfig && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-fade-in">
          <div className="bg-panel border border-rose-500/40 rounded-3xl p-6 w-full max-w-md space-y-5 shadow-2xl text-main">
            <div className="text-center space-y-2">
              <div className="text-3xl">↩️</div>
              <h4 className="font-extrabold text-base text-rose-400">{refundConfirmConfig.title}</h4>
              <p className="text-xs text-muted leading-relaxed">{refundConfirmConfig.message}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setRefundConfirmConfig(null)}
                disabled={refundLoading}
                className="py-2.5 rounded-xl bg-panel-accent border border-main text-muted hover:text-main text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                onClick={() => refundConfirmConfig.onConfirm()}
                disabled={refundLoading}
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all active:scale-95 shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {refundLoading ? (
                  <><span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full"></span> جاري التنفيذ...</>
                ) : (
                  '✅ نعم، تأكيد المرتجع'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Discount Edit Modal */}
      {discountModalOpen && selectedInvoice && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[70] animate-fade-in">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-md space-y-5 shadow-2xl text-main font-sans">
            <div className="flex justify-between items-center border-b border-main pb-3">
              <h4 className="font-extrabold text-base flex items-center gap-2">
                <span className="text-xl">🏷️</span> تعديل خصم الفاتورة بعد التسليم
              </h4>
              <button
                onClick={() => setDiscountModalOpen(false)}
                className="text-muted hover:text-main text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="bg-panel-accent border border-main p-3.5 rounded-2xl space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">رقم الفاتورة:</span>
                <span className="font-mono font-bold text-main">{selectedInvoice.invoice_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">العميل:</span>
                <span className="font-bold text-main">{selectedInvoice.customer_name || 'عميل نقدي'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">طريقة الدفع:</span>
                <span className="font-bold text-blue-500">
                  {selectedInvoice.payment_method === 'CARD' ? 'فودافون كاش' : selectedInvoice.payment_method === 'DEBT' ? 'آجل / دين' : 'كاش نقدي'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">إجمالي الفاتورة الأصلي:</span>
                <span className="font-mono font-bold text-blue-500">{(selectedInvoice.total_amount || 0).toLocaleString()} ج.م</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">الخصم المطبق حالياً:</span>
                <span className="font-mono font-bold text-rose-500">{(selectedInvoice.discount || 0).toLocaleString()} ج.م</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-muted block">
                قيمة الخصم الجديد المراد تطبيقه (ج.م):
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={selectedInvoice.total_amount}
                  value={discountVal}
                  onChange={(e) => setDiscountVal(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-input-field border border-main rounded-xl py-2.5 px-4 text-left font-mono font-black text-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="0"
                />
                <span className="absolute right-3 top-3 text-xs text-muted font-bold pointer-events-none">ج.م</span>
              </div>
              <p className="text-[10px] text-muted">
                الحد الأقصى للخصم هو إجمالي الفاتورة ({(selectedInvoice.total_amount || 0).toLocaleString()} ج.م).
              </p>
            </div>

            {/* Live Preview of New Net Amount */}
            <div className="bg-emerald-500/10 border border-emerald-500/20 p-3.5 rounded-2xl flex justify-between items-center text-xs">
              <span className="font-bold text-emerald-600 dark:text-emerald-400">الصافي الجديد بعد الخصم:</span>
              <span className="font-mono font-black text-lg text-emerald-600 dark:text-emerald-400">
                {Math.max(0, (selectedInvoice.total_amount || 0) - (Number(discountVal) || 0)).toLocaleString()} ج.م
              </span>
            </div>

            {selectedInvoice.payment_method === 'DEBT' && (
              <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl text-[11px] text-amber-500 flex items-center gap-2">
                <span>ℹ️</span>
                <span>هذه الفاتورة آجل على حساب عميل. سيتم تعديل مديونية العميل تلقائياً بمقدار فرق الخصم.</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={() => setDiscountModalOpen(false)}
                disabled={discountSaving}
                className="py-2.5 rounded-xl bg-panel-accent border border-main text-muted hover:text-main text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                onClick={handleSaveDiscount}
                disabled={discountSaving}
                className="py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all active:scale-95 shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {discountSaving ? (
                  <><span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full"></span> جاري الحفظ...</>
                ) : (
                  '💾 حفظ وتطبيق الخصم'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
