import React, { useState, useEffect } from 'react';
import { Save, ShieldAlert, KeyRound, Search, RefreshCw, FileText, Printer, FolderOpen, Calendar, Plus, Edit2, Trash2, CheckCircle2 } from 'lucide-react';
import { dbClient } from '../database/dbClient';
import { ActivityLog } from '../types';

interface SettingsScreenProps {
  currentUserId: string;
  currentUsername: string;
  storeSettings: Record<string, string>;
  onSaveSettings: (settings: Record<string, string>) => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  currentUserId,
  currentUsername,
  storeSettings,
  onSaveSettings
}) => {
  const [storeName, setStoreName] = useState(storeSettings.store_name || '');
  const [storePhone, setStorePhone] = useState(storeSettings.store_phone || '');
  const [invoiceHeader, setInvoiceHeader] = useState(storeSettings.invoice_header || '');
  const [invoiceFooter, setInvoiceFooter] = useState(storeSettings.invoice_footer || '');
  const [vodafoneNumbers, setVodafoneNumbers] = useState(storeSettings.vodafone_cash_numbers || '01011111111,01022222222');
  const [supabaseUrl, setSupabaseUrl] = useState(storeSettings.supabase_url || '');
  const [supabaseKey, setSupabaseKey] = useState(storeSettings.supabase_anon_key || '');
  // Paper sizes
  const [receiptPaperWidth, setReceiptPaperWidth] = useState<'58mm' | '80mm'>(
    (storeSettings.receipt_paper_width as '58mm' | '80mm') || '80mm'
  );
  const [barcodeLabelSize, setBarcodeLabelSize] = useState(
    storeSettings.barcode_label_size || '58×30 مم (رول ضيق)'
  );

  // Advanced Barcode Settings states
  const [barcodeConfig, setBarcodeConfig] = useState({
    widthIn: 2.28,
    heightIn: 1.18,
    widthMm: 58,
    heightMm: 30,
    marginTop: 0.5,
    marginBottom: 0.5,
    marginLeft: 0.5,
    marginRight: 0.5,
    gap: 1.0,
    scaleWidth: 1.5,
    scaleHeight: 35,
    fontSize: 10,
    originFontSize: 8,
    showText: true
  });

  const loadBarcodeConfig = async () => {
    try {
      const res = await (window as any).api.getBarcodeConfig();
      if (res.success && res.config) {
        setBarcodeConfig(res.config);
      }
    } catch (err) {
      console.error('Failed to load barcode config:', err);
    }
  };

  useEffect(() => {
    loadBarcodeConfig();
  }, []);

  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logSearch, setLogSearch] = useState('');
  const [logActionFilter, setLogActionFilter] = useState('ALL');

  const [users, setUsers] = useState<Array<{ id: string; username: string; role: string; phone?: string; created_at: string; password_hash?: string }>>([]);

  // Reusable custom React Alert/Confirm overlays
  const [alertConfig, setAlertConfig] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const showAlert = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setAlertConfig({ message, type });
  };

  const showConfirm = (message: string, onConfirm: () => void) => {
    setConfirmConfig({ message, onConfirm });
  };

  // User Manager Form state
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userFormName, setUserFormName] = useState('');
  const [userFormPhone, setUserFormPhone] = useState('');
  const [userFormPassword, setUserFormPassword] = useState('');
  const [userFormRole, setUserFormRole] = useState<'CASHIER' | 'ADMIN'>('CASHIER');

  // Report Date Range states
  const getTodayISO = () => new Date().toISOString().substring(0, 10);
  const [reportFrom, setReportFrom] = useState(getTodayISO());
  const [reportTo, setReportTo] = useState(getTodayISO());
  const [printingReport, setPrintingReport] = useState(false);

  const [systemPrinters, setSystemPrinters] = useState<any[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState(storeSettings.selected_printer_name || '');

  const [resetPassword, setResetPassword] = useState('');
  const [showResetModal, setShowResetModal] = useState(false);

  const handleDownloadLocalBackup = async () => {
    try {
      const res = await (window as any).api.getDbBackupFile();
      if (res.success && res.data) {
        const blob = new Blob([res.data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Log backup activity
        await dbClient.logActivity(
          currentUserId,
          currentUsername,
          'BACKUP_DOWNLOADED',
          `تنزيل نسخة احتياطية محلية باسم: ${res.filename}`
        );
        showAlert('✅ تم تنزيل النسخة الاحتياطية بنجاح وحفظها على جهازك!', 'success');
        return true;
      } else {
        showAlert(`فشل تنزيل النسخة الاحتياطية: ${res.error || 'خطأ غير معروف'}`, 'error');
        return false;
      }
    } catch (e: any) {
      showAlert(`خطأ: ${e.message}`, 'error');
      return false;
    }
  };

  const executeSystemReset = async () => {
    if (!resetPassword) {
      showAlert('يرجى كتابة كلمة المرور للتأكيد!', 'error');
      return;
    }

    try {
      const usersList = await dbClient.dbQuery('SELECT role, password_hash FROM cashier_users WHERE id = ?', [currentUserId]);
      if (!usersList || usersList.length === 0) {
        showAlert('المستخدم الحالي غير موجود بقاعدة البيانات!', 'error');
        return;
      }
      
      const user = usersList[0];
      if (user.role !== 'ADMIN') {
        showAlert('عذراً، هذا الإجراء يتطلب صلاحيات الأدمن!', 'error');
        return;
      }

      if (resetPassword !== user.password_hash) {
        showAlert('كلمة المرور غير صحيحة!', 'error');
        return;
      }

      // Automatically download backup first
      showAlert('جاري تنزيل نسخة احتياطية من النظام تلقائياً قبل التصفير...', 'warning');
      const backupSuccess = await handleDownloadLocalBackup();
      if (!backupSuccess) {
        showAlert('فشلت عملية تنزيل النسخة الاحتياطية! تم إلغاء تصفير النظام للأمان.', 'error');
        return;
      }

      const res = await dbClient.resetAllInvoicesAndAccounts(currentUserId, currentUsername);
      if (res.success) {
        showAlert('✅ تم تصفير جميع الفواتير وحسابات الموردين وتصفير الحسابات بنجاح!', 'success');
        setShowResetModal(false);
        setResetPassword('');
        onSaveSettings(storeSettings);
      } else {
        showAlert('فشلت عملية تصفير النظام!', 'error');
      }
    } catch (e: any) {
      console.error(e);
      showAlert(`حدث خطأ أثناء التصفير: ${e.message}`, 'error');
    }
  };

  const [isBackingUp, setIsBackingUp] = useState(false);
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(localStorage.getItem('last_backup_time'));

  const handleManualBackup = async () => {
    const sUrl = supabaseUrl || storeSettings.supabase_url || '';
    const sKey = supabaseKey || storeSettings.supabase_anon_key || '';
    if (!sUrl || !sKey) {
      showAlert('يرجى حفظ بيانات Supabase أولاً قبل رفع النسخة الاحتياطية.', 'error');
      return;
    }
    setIsBackingUp(true);
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(sUrl, sKey);
      const fileRes = await dbClient.getDbBackupFile();
      if (!fileRes.success || !fileRes.data || !fileRes.filename) {
        showAlert(`فشل قراءة ملف قاعدة البيانات: ${fileRes.error || 'خطأ غير معروف'}`, 'error');
        return;
      }
      await supabase.storage.createBucket('backups', { public: false }).catch(() => {});
      const { error: uploadErr } = await supabase.storage
        .from('backups')
        .upload(`manual_${fileRes.filename}`, fileRes.data, {
          contentType: 'application/octet-stream',
          upsert: true
        });
      if (uploadErr) {
        showAlert(`فشل رفع النسخة الاحتياطية: ${uploadErr.message}`, 'error');
        return;
      }
      const backupTime = new Date().toISOString();
      localStorage.setItem('last_backup_time', backupTime);
      setLastBackupTime(backupTime);
      await dbClient.logActivity(
        currentUserId,
        currentUsername,
        'BACKUP_COMPLETED',
        `يدوي: تم رفع نسخة احتياطية كاملة باسم manual_${fileRes.filename}`
      );
      showAlert('✅ تم رفع النسخة الاحتياطية بنجاح إلى Supabase Storage!', 'success');
    } catch (e: any) {
      showAlert(`خطأ: ${e.message}`, 'error');
    } finally {
      setIsBackingUp(false);
    }
  };

  const loadLogs = async () => {
    setLoadingLogs(true);
    try {
      const data = await dbClient.getActivityLogs();
      setLogs(data);
    } catch (e) {
      console.error('Failed to load logs:', e);
    } finally {
      setLoadingLogs(false);
    }
  };

  const loadUsers = async () => {
    try {
      const dbUsers = await dbClient.dbQuery('SELECT id, username, role, phone, created_at, password_hash FROM cashier_users');
      if (dbUsers && dbUsers.length > 0) {
        setUsers(dbUsers);
      } else {
        setUsers([
          { id: 'u1', username: 'admin', role: 'ADMIN', phone: '01011111111', created_at: new Date().toISOString(), password_hash: 'admin123' },
          { id: 'u1_custom', username: 'احمد مجدي', role: 'ADMIN', phone: '01022222222', created_at: new Date().toISOString(), password_hash: 'admin123' },
          { id: 'u2', username: 'cashier', role: 'CASHIER', phone: '01033333333', created_at: new Date().toISOString(), password_hash: 'cashier123' }
        ]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadPrinters = async () => {
    try {
      const list = await dbClient.getSystemPrinters();
      setSystemPrinters(list || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadLogs();
    loadUsers();
    loadPrinters();
  }, []);

  const handleSaveStoreSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await dbClient.saveSetting('store_name', storeName);
      await dbClient.saveSetting('store_phone', storePhone);
      await dbClient.saveSetting('invoice_header', invoiceHeader);
      await dbClient.saveSetting('invoice_footer', invoiceFooter);
      await dbClient.saveSetting('vodafone_cash_numbers', vodafoneNumbers);
      await dbClient.saveSetting('selected_printer_name', selectedPrinter);
      await dbClient.saveSetting('supabase_url', supabaseUrl);
      await dbClient.saveSetting('supabase_anon_key', supabaseKey);
      await dbClient.saveSetting('receipt_paper_width', receiptPaperWidth);
      await dbClient.saveSetting('barcode_label_size', barcodeLabelSize);

      // Save Advanced Barcode Settings File
      await (window as any).api.saveBarcodeConfig(barcodeConfig);

      await dbClient.logActivity(
        currentUserId,
        currentUsername,
        'SETTINGS_UPDATED',
        `تحديث إعدادات الفاتورة والمحل (الاسم الجديد: ${storeName}) وطابعة الفواتير المحددة: ${selectedPrinter || 'تلقائي'}`
      );

      onSaveSettings({
        store_name: storeName,
        store_phone: storePhone,
        invoice_header: invoiceHeader,
        invoice_footer: invoiceFooter,
        vodafone_cash_numbers: vodafoneNumbers,
        selected_printer_name: selectedPrinter,
        supabase_url: supabaseUrl,
        supabase_anon_key: supabaseKey,
        receipt_paper_width: receiptPaperWidth,
        barcode_label_size: barcodeLabelSize
      });

      showAlert('تم حفظ إعدادات المحل والطباعة وأرقام فودافون كاش بنجاح!', 'success');
      loadLogs();
    } catch (err) {
      console.error(err);
      showAlert('فشل في حفظ إعدادات النظام.', 'error');
    }
  };

  // User Administration Save (Add/Edit)
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userFormName || !userFormPassword) {
      showAlert('الرجاء تعبئة الحقول الأساسية: الاسم وكلمة المرور', 'warning');
      return;
    }

    const userId = editingUserId || 'user_' + Math.random().toString(36).substr(2, 9);
    try {
      const res = await dbClient.saveUser({
        id: userId,
        username: userFormName,
        password_hash: userFormPassword,
        role: userFormRole,
        phone: userFormPhone
      });

      if (res.success) {
        showAlert(editingUserId ? 'تم تحديث بيانات المستخدم بنجاح.' : 'تم تسجيل المستخدم الجديد بنجاح.', 'success');
        resetUserForm();
        loadUsers();
        loadLogs();
      } else {
        showAlert(res.error || 'خطأ في حفظ المستخدم', 'error');
      }
    } catch (err) {
      console.error(err);
      showAlert('حدث خطأ غير متوقع أثناء حفظ المستخدم.', 'error');
    }
  };

  // Delete Cashier User
  const handleDeleteUser = async (userId: string, username: string) => {
    if (username === 'admin' || username === 'احمد مجدي') {
      showAlert('لا يمكن حذف حساب المسؤول الرئيسي المحمي!', 'warning');
      return;
    }

    showConfirm(`هل أنت متأكد من حذف مستخدم الكاشير: "${username}" بالكامل؟`, async () => {
      try {
        const res = await dbClient.deleteUser(userId);
        if (res.success) {
          showAlert('تم حذف المستخدم بنجاح.', 'success');
          loadUsers();
          loadLogs();
        } else {
          showAlert(res.error || 'فشل في حذف المستخدم', 'error');
        }
      } catch (err) {
        console.error(err);
        showAlert('خطأ أثناء عملية الحذف', 'error');
      }
    });
  };

  // Edit User details pre-fill
  const handleEditClick = (user: typeof users[0]) => {
    if (user.username === 'admin' || user.username === 'احمد مجدي') {
      showAlert('المسؤول الرئيسي محمي ومحفوظ بنظام الديسكتوب التلقائي!', 'warning');
      return;
    }
    setEditingUserId(user.id);
    setUserFormName(user.username);
    setUserFormPhone(user.phone || '');
    setUserFormPassword(user.password_hash || '');
    setUserFormRole(user.role as 'CASHIER' | 'ADMIN');
  };

  const resetUserForm = () => {
    setEditingUserId(null);
    setUserFormName('');
    setUserFormPhone('');
    setUserFormPassword('');
    setUserFormRole('CASHIER');
  };

  const applyPreset = (preset: 'today' | 'yesterday' | 'week' | 'month') => {
    const today = new Date();
    const from = new Date();

    if (preset === 'today') {
      // both today
    } else if (preset === 'yesterday') {
      from.setDate(today.getDate() - 1);
      today.setDate(today.getDate() - 1);
    } else if (preset === 'week') {
      from.setDate(today.getDate() - 7);
    } else if (preset === 'month') {
      from.setMonth(today.getMonth() - 1);
    }

    setReportFrom(from.toISOString().substring(0, 10));
    setReportTo(today.toISOString().substring(0, 10));
  };

  const handlePrintPeriodReport = async () => {
    setPrintingReport(true);
    try {
      const allSales = await dbClient.dbQuery('SELECT * FROM sales');
      const allItems = await dbClient.dbQuery('SELECT * FROM sale_items');
      const variants = await dbClient.getVariants();

      const filteredSales = (allSales || []).filter((s: any) => {
        const dateStr = (s.created_at || '').substring(0, 10);
        return dateStr >= reportFrom && dateStr <= reportTo;
      });

      if (filteredSales.length === 0) {
        showAlert('لا توجد مبيعات مسجلة في هذه الفترة المحددة!', 'warning');
        setPrintingReport(false);
        return;
      }

      const saleIds = filteredSales.map((s: any) => s.id);
      const filteredItems = (allItems || []).filter((item: any) => saleIds.includes(item.sale_id));

      let totalRevenue = 0;
      let totalDiscounts = 0;
      let totalCost = 0;

      filteredSales.forEach((s: any) => {
        totalRevenue += s.final_amount;
        totalDiscounts += (s.discount || 0);
      });

      filteredItems.forEach((item: any) => {
        totalCost += (item.cost_price * item.quantity);
      });

      const totalProfit = totalRevenue - totalCost;

      const groupedItemsMap: Record<string, { name: string; origin: string; qty: number; totalValue: number }> = {};
      filteredItems.forEach((item: any) => {
        const vId = item.variant_id;
        const matchedVar = variants.find(v => v.id === vId);
        const name = item.name || matchedVar?.product_name || 'قطعة غيار';
        const origin = item.origin || matchedVar?.origin || 'غير محدد';
        
        if (!groupedItemsMap[vId]) {
          groupedItemsMap[vId] = { name, origin, qty: 0, totalValue: 0 };
        }
        groupedItemsMap[vId].qty += item.quantity;
        groupedItemsMap[vId].totalValue += item.total_price;
      });

      const itemSummaries = Object.values(groupedItemsMap).sort((a, b) => b.qty - a.qty);

      const res = await dbClient.printReport({
        fromDate: reportFrom,
        toDate: reportTo,
        totalInvoices: filteredSales.length,
        totalRevenue,
        totalDiscounts,
        totalCost,
        totalProfit,
        invoices: filteredSales,
        itemSummaries
      });

      if (res.success) {
        await dbClient.logActivity(
          currentUserId,
          currentUsername,
          'REPORT_PRINTED',
          `طباعة تقرير مبيعات الفترة من ${reportFrom} إلى ${reportTo} - صافي أرباح: ${totalProfit} ج.م`
        );
        showAlert('تم إرسال التقرير المالي الممتد للطابعة وحفظ نسخة محاكاة PNG بنجاح!', 'success');
        loadLogs();
      }
    } catch (err) {
      console.error(err);
      showAlert('خطأ أثناء سحب البيانات وتجهيز التقرير المالي.', 'error');
    } finally {
      setPrintingReport(false);
    }
  };

  const handleOpenLogsFolder = async () => {
    const opened = await dbClient.openPrintLogsFolder();
    if (!opened) {
      showAlert('المجلد متاح بداخل مسار المشروع باسم "print_logs"', 'success');
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch =
      log.username.toLowerCase().includes(logSearch.toLowerCase()) ||
      log.action.toLowerCase().includes(logSearch.toLowerCase()) ||
      (log.details || '').toLowerCase().includes(logSearch.toLowerCase());

    const matchesAction = logActionFilter === 'ALL' || log.action === logActionFilter;

    return matchesSearch && matchesAction;
  });

  const uniqueActions = Array.from(new Set(logs.map(l => l.action)));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 h-[calc(100vh-100px)] overflow-hidden text-main">
      
      {/* Configure Meta Settings (5 cols) */}
      <div className="xl:col-span-5 flex flex-col gap-6 h-full overflow-y-auto pr-1">
        
        {/* Period reports printer widget */}
        <div className="glass-panel p-5 bg-panel border-main border-r-4 border-r-blue-500">
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-main justify-between">
            <div className="flex items-center gap-2">
              <Printer className="w-5 h-5 text-blue-500" />
              <h2 className="font-bold text-lg text-main">تقارير المبيعات الحرارية والأرشيف</h2>
            </div>
            
            <button
              onClick={handleOpenLogsFolder}
              className="bg-main hover:bg-panel-hover border border-main text-muted hover:text-main px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
            >
              <FolderOpen className="w-4 h-4 text-blue-500" />
              أرشيف صور الفواتير
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-muted mb-2 font-bold">تحديد فترة مبيعات سريعة</label>
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  onClick={() => applyPreset('today')}
                  className="bg-main hover:bg-panel-hover border border-main text-main text-xs font-bold py-2 rounded-lg transition-all"
                >
                  اليوم
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('yesterday')}
                  className="bg-main hover:bg-panel-hover border border-main text-main text-xs font-bold py-2 rounded-lg transition-all"
                >
                  أمس
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('week')}
                  className="bg-main hover:bg-panel-hover border border-main text-main text-xs font-bold py-2 rounded-lg transition-all"
                >
                  أسبوع
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('month')}
                  className="bg-main hover:bg-panel-hover border border-main text-main text-xs font-bold py-2 rounded-lg transition-all"
                >
                  شهر
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted mb-1 font-bold">من تاريخ</label>
                <div className="relative">
                  <Calendar className="absolute right-2.5 top-2.5 w-4 h-4 text-muted" />
                  <input
                    type="date"
                    className="w-full bg-input-field text-main rounded-xl py-2 pr-9 pl-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs border border-main font-mono cursor-pointer"
                    value={reportFrom}
                    onChange={(e) => setReportFrom(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-muted mb-1 font-bold">إلى تاريخ</label>
                <div className="relative">
                  <Calendar className="absolute right-2.5 top-2.5 w-4 h-4 text-muted" />
                  <input
                    type="date"
                    className="w-full bg-input-field text-main rounded-xl py-2 pr-9 pl-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs border border-main font-mono cursor-pointer"
                    value={reportTo}
                    onChange={(e) => setReportTo(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handlePrintPeriodReport}
              disabled={printingReport}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-sm shadow-md active:scale-98"
            >
              <Printer className="w-5 h-5" />
              {printingReport ? 'جاري تجهيز وطباعة التقرير...' : 'طباعة تقرير مبيعات الفترة حرارياً'}
            </button>
          </div>
        </div>

        {/* Invoice template settings & Vodafone cash */}
        <div className="glass-panel p-5 bg-panel border-main">
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-main">
            <FileText className="w-5 h-5 text-blue-500" />
            <h2 className="font-bold text-lg text-main">إعدادات ترويسة المحل والشبكات</h2>
          </div>

          <form onSubmit={handleSaveStoreSettings} className="space-y-4">
            <div>
              <label className="block text-xs text-muted mb-1 font-bold">اسم المحل / الشركة</label>
              <input
                type="text"
                required
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold border border-main"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 font-bold">أرقام التواصل والهاتف</label>
              <input
                type="text"
                required
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono border border-main"
                value={storePhone}
                onChange={(e) => setStorePhone(e.target.value)}
              />
            </div>

            {/* Vodafone Cash accepted transfer numbers */}
            <div>
              <label className="block text-xs text-muted mb-1 font-bold">أرقام فودافون كاش المعتمدة للتحويل (مفصولة بفاصلة)</label>
              <input
                type="text"
                required
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono border border-main"
                placeholder="01011111111,01022222222"
                value={vodafoneNumbers}
                onChange={(e) => setVodafoneNumbers(e.target.value)}
              />
            </div>

            {/* Default System Printer Selector */}
            <div>
              <label className="block text-xs text-muted mb-1 font-bold">طابعة الفواتير والتقارير الحرارية الافتراضية</label>
              <select
                className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm cursor-pointer font-bold"
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
              >
                <option value="">طابعة النظام الافتراضية (Default Printer)</option>
                {systemPrinters.map((p, idx) => (
                  <option key={idx} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Backup & Reset Sections */}
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 space-y-3 col-span-1 md:col-span-2">
              <p className="text-xs font-black text-blue-500 flex items-center gap-1.5">💾 النسخ الاحتياطي وإدارة الملفات المحلية</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={handleDownloadLocalBackup}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-xl text-xs transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <FolderOpen className="w-4 h-4" />
                  تنزيل نسخة احتياطية من النظام بالكامل (.sqlite / .json)
                </button>
                <button
                  type="button"
                  onClick={handleManualBackup}
                  disabled={isBackingUp}
                  className="flex-1 bg-indigo-650 hover:bg-indigo-600 text-white font-bold py-3 px-4 rounded-xl text-xs transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4" />
                  {isBackingUp ? 'جاري الرفع للـ Cloud...' : 'رفع نسخة احتياطية سحابية لـ Supabase'}
                </button>
              </div>
              <p className="text-[10px] text-muted leading-relaxed">
                يُنصح بتنزيل نسخة احتياطية دورية وحفظها على جهاز الكمبيوتر أو قرص خارجي لضمان عدم فقدان البيانات تحت أي ظرف.
              </p>
            </div>

            <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4 space-y-3 col-span-1 md:col-span-2">
              <p className="text-xs font-black text-rose-500 flex items-center gap-1.5">⚠️ تصفير قاعدة البيانات وإلغاء العمليات</p>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-right">
                  <p className="text-xs font-bold text-main">مسح وتصفير كافة فواتير المبيعات والحسابات</p>
                  <p className="text-[10px] text-muted mt-0.5">سيتم حذف الفواتير بالكامل وتصفير مديونيات الموردين وحسابات الأجل بعد تنزيل نسخة احتياطية تلقائياً.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowResetModal(true)}
                  className="bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 px-5 rounded-xl text-xs transition-all active:scale-95 flex items-center gap-1.5 shadow-sm shrink-0"
                >
                  <ShieldAlert className="w-4.5 h-4.5" />
                  تصفير الفواتير والحسابات
                </button>
              </div>
            </div>


            {/* Supabase URL */}

            <div>
              <label className="block text-xs text-muted mb-1 font-bold flex items-center justify-between">
                <span>رابط قاعدة البيانات السحابية (Supabase URL)</span>
                {supabaseUrl ? <span className="text-[9px] text-emerald-500 font-bold">مُدخل</span> : <span className="text-[9px] text-amber-500 font-bold">مطلوب للمزامنة السحابية</span>}
              </label>
              <input
                type="text"
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs font-mono border border-main"
                placeholder="https://your-project.supabase.co"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
              />
            </div>

            {/* Supabase Anon Key */}
            <div>
              <label className="block text-xs text-muted mb-1 font-bold flex items-center justify-between">
                <span>مفتاح الوصول السحابي (Supabase Anon Key)</span>
                {supabaseKey ? <span className="text-[9px] text-emerald-500 font-bold">مُدخل</span> : <span className="text-[9px] text-amber-500 font-bold">مطلوب للمزامنة السحابية</span>}
              </label>
              <input
                type="password"
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs font-mono border border-main"
                placeholder="eyJhbGciOi..."
                value={supabaseKey}
                onChange={(e) => setSupabaseKey(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 font-bold">ترويسة الفاتورة (Header Msg)</label>
              <textarea
                rows={2}
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm border border-main"
                placeholder="مرحباً بكم..."
                value={invoiceHeader}
                onChange={(e) => setInvoiceHeader(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 font-bold">تذييل الفاتورة (Footer Msg)</label>
              <textarea
                rows={2}
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm border border-main"
                placeholder="شروط المرتجع..."
                value={invoiceFooter}
                onChange={(e) => setInvoiceFooter(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-1 shadow-md active:scale-98 text-sm"
            >
              <Save className="w-4.5 h-4.5" />
              حفظ وتطبيق إعدادات المحل
            </button>
          </form>

          {/* Manual Cloud Backup */}
          <div className="mt-5 pt-4 border-t border-main">
            <div className="flex items-start gap-3 p-4 rounded-xl" style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <div className="flex-1">
                <p className="font-bold text-sm text-main mb-0.5">☁️ النسخ الاحتياطي السحابي</p>
                <p className="text-xs text-muted leading-relaxed">
                  يتم النسخ الاحتياطي التلقائي كل يوم جمعة أو بعد مرور 7 أيام عند الاتصال.
                </p>
                {lastBackupTime && (
                  <p className="text-[10px] text-emerald-400 mt-1.5 font-bold">
                    ✅ آخر نسخة: {new Date(lastBackupTime).toLocaleString('ar-EG')}
                  </p>
                )}
                {!lastBackupTime && (
                  <p className="text-[10px] text-amber-400 mt-1.5 font-bold">⚠️ لم يتم رفع أي نسخة بعد</p>
                )}
              </div>
              <button
                onClick={handleManualBackup}
                disabled={isBackingUp}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
                style={{ background: isBackingUp ? '#334155' : 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
              >
                <RefreshCw className={`w-4 h-4 ${isBackingUp ? 'animate-spin' : ''}`} />
                {isBackingUp ? 'جاري الرفع...' : 'رفع نسخة يدوياً'}
              </button>
            </div>
          </div>
        </div>

        {/* User Account Controls */}
        <div className="glass-panel p-5 bg-panel border-main">
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-main justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-blue-500" />
              <h2 className="font-bold text-lg text-main">إدارة المستخدمين والكاشيرات</h2>
            </div>
            {editingUserId && (
              <button
                onClick={resetUserForm}
                className="text-xs font-bold text-rose-500 hover:underline"
              >
                إلغاء التعديل
              </button>
            )}
          </div>

          {/* User Form */}
          <form onSubmit={handleSaveUser} className="space-y-3 bg-panel-accent p-3 border border-main rounded-xl mb-4">
            <h3 className="text-xs font-bold text-main">{editingUserId ? 'تعديل مستخدم كاشير' : 'إضافة وتكويد كاشير جديد'}</h3>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                required
                placeholder="اسم الكاشير (الدخول)"
                className="bg-input-field text-main border border-main rounded-lg p-2 text-xs text-right focus:outline-none"
                value={userFormName}
                onChange={(e) => setUserFormName(e.target.value)}
              />
              <input
                type="text"
                placeholder="رقم الهاتف"
                className="bg-input-field text-main border border-main rounded-lg p-2 text-xs text-right focus:outline-none font-mono"
                value={userFormPhone}
                onChange={(e) => setUserFormPhone(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="password"
                required
                placeholder="كلمة المرور"
                className="bg-input-field text-main border border-main rounded-lg p-2 text-xs text-right focus:outline-none"
                value={userFormPassword}
                onChange={(e) => setUserFormPassword(e.target.value)}
              />
              <select
                className="bg-input-field text-main border border-main rounded-lg p-2 text-xs text-right focus:outline-none cursor-pointer"
                value={userFormRole}
                onChange={(e) => setUserFormRole(e.target.value as 'CASHIER' | 'ADMIN')}
              >
                <option value="CASHIER">كاشير بيع</option>
                <option value="ADMIN">مدير النظام</option>
              </select>
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-1"
            >
              <Plus className="w-4 h-4" />
              {editingUserId ? 'تحديث بيانات الكاشير' : 'تأسيس الكاشير في النظام'}
            </button>
          </form>

          {/* User List */}
          <div className="space-y-2">
            {users.map(user => {
              const isProtected = user.username === 'admin' || user.username === 'احمد مجدي';
              return (
                <div key={user.id} className="bg-panel-accent border border-main p-3 rounded-xl flex justify-between items-center text-xs">
                  <div>
                    <span className="font-bold text-main">{user.username}</span>
                    <p className="text-[10px] text-muted mt-1">الهاتف: {user.phone || 'غير مسجل'}</p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      user.role === 'ADMIN' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' : 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
                    }`}>
                      {user.role === 'ADMIN' ? 'مسؤول النظام' : 'كاشير مبيعات'}
                    </span>

                    {!isProtected ? (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => handleEditClick(user)}
                          className="p-1 hover:bg-panel rounded text-blue-500 transition-colors"
                          title="تعديل الحساب"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(user.id, user.username)}
                          className="p-1 hover:bg-panel rounded text-rose-500 transition-colors"
                          title="حذف الكاشير"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-[9px] text-muted font-bold px-1.5 py-0.5 bg-main border border-main rounded select-none">محمي</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Activity logs visual audit trail */}
      <div className="xl:col-span-7 flex flex-col h-full bg-panel border border-main rounded-2xl p-4 overflow-hidden">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-4 pb-3 border-b border-main">
          <div className="flex items-center gap-2 self-start md:self-auto">
            <ShieldAlert className="w-5 h-5 text-rose-500" />
            <div>
              <h2 className="font-bold text-lg text-main">سجل التتبع الصارم للحركات</h2>
              <p className="text-[10px] text-muted">مراقبة الأحداث والعمليات لمنع التلاعب</p>
            </div>
          </div>

          <button
            onClick={loadLogs}
            disabled={loadingLogs}
            className="bg-main hover:bg-panel-hover text-muted p-2 rounded-xl transition-all border border-main disabled:opacity-50"
            title="تحديث السجلات"
          >
            <RefreshCw className={`w-4 h-4 ${loadingLogs ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div className="relative">
            <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-muted">
              <Search className="w-4 h-4" />
            </span>
            <input
              type="text"
              className="w-full bg-input-field border border-main text-main placeholder-slate-400 dark:placeholder-slate-650 rounded-xl py-2 pr-9 pl-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
              placeholder="البحث باسم الكاشير، نوع العملية..."
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
            />
          </div>

          <div>
            <select
              className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs cursor-pointer"
              value={logActionFilter}
              onChange={(e) => setLogActionFilter(e.target.value)}
            >
              <option value="ALL">جميع العمليات والأحداث</option>
              {uniqueActions.map((act, idx) => (
                <option key={idx} value={act}>{act}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto border border-main rounded-xl bg-main">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-panel-accent text-muted text-xs font-bold border-b border-main sticky top-0 z-10">
                <th className="py-3 px-4">التاريخ والملي ثانية</th>
                <th className="py-3 px-4">المستخدم</th>
                <th className="py-3 px-4">الحدث الرئيسي</th>
                <th className="py-3 px-4">التفاصيل الكاملة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-main text-xs font-medium">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-500">
                    لا توجد سجلات تتبع مطابقة لفلترة البحث الحالية.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-panel-hover/40">
                    <td className="py-3 px-4 font-mono text-[10px] text-muted select-all">
                      {log.created_at}
                    </td>
                    <td className="py-3 px-4 font-bold text-main">
                      {log.username}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.action === 'SALE_COMPLETED' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' :
                        log.action === 'ITEM_DELETED_FROM_CART' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-455 border border-rose-500/20' :
                        log.action === 'DRAWER_OPENED' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' :
                        log.action === 'INVENTORY_ADJUSTMENT' ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20' :
                        'bg-slate-500/10 text-slate-600'
                      }`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-main max-w-sm" title={log.details}>
                      {log.details}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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

      {/* Custom Reusable React Confirm Modal Overlay */}
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

      {/* System Reset Password Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-sm space-y-4 text-center shadow-2xl text-main">
            <div className="text-lg font-bold text-rose-500">تأكيد تصفير النظام</div>
            <p className="text-xs text-muted leading-relaxed">
              تحذير: سيتم مسح جميع الفواتير والمبيعات وحركات ديون الموردين وتصفير الحسابات بالكامل. هذا الإجراء يتطلب صلاحيات الأدمن وكلمة المرور الخاصة بك.
            </p>
            <div>
              <label className="block text-xs text-muted mb-1 text-right font-bold">كلمة المرور الخاصة بك للتأكيد *</label>
              <input
                type="password"
                className="w-full bg-input-field text-main rounded-xl py-2.5 px-3 text-right focus:outline-none focus:ring-2 focus:ring-rose-500 border border-main text-sm"
                placeholder="أدخل كلمة مرور الحساب الحالي"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={executeSystemReset}
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all active:scale-95 shadow-md"
              >
                تأكيد وبدء التصفير
              </button>
              <button
                onClick={() => {
                  setShowResetModal(false);
                  setResetPassword('');
                }}
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
