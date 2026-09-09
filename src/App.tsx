import React, { useState, useEffect } from 'react';
import { LayoutGrid, ShoppingCart, Boxes, Users2, Settings, Wifi, WifiOff, AlertTriangle, User, LogOut, Sun, Moon, Tag } from 'lucide-react';
import { dbClient } from './database/dbClient';
import { createClient } from '@supabase/supabase-js';
import { CashierScreen } from './components/CashierScreen';
import { InventoryScreen } from './components/InventoryScreen';
import { SuppliersScreen } from './components/SuppliersScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { DashboardScreen } from './components/DashboardScreen';
import { LoginScreen } from './components/LoginScreen';
import { BarcodePrintScreen } from './components/BarcodePrintScreen';
import { CashierUser } from './types';

type Tab = 'cashier' | 'inventory' | 'suppliers' | 'settings' | 'dashboard' | 'barcode';

export default function App() {
  const [currentUser, setCurrentUser] = useState<CashierUser | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('cashier');
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  
  // Theme state: 'light' | 'dark'
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (typeof window !== 'undefined' && localStorage.getItem('theme') as 'light' | 'dark') || 'dark'
  );

  // App-wide state
  const [storeSettings, setStoreSettings] = useState<Record<string, string>>({});
  const [lowStockWarningCount, setLowStockWarningCount] = useState(0);
  const [syncQueueCount, setSyncQueueCount] = useState(0);
  const [isSyncDelayed, setIsSyncDelayed] = useState(false);
  const isSyncingRef = React.useRef(false);

  // Apply theme class to HTML element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Network monitor
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

  // Fetch critical app metrics
  const refreshGlobalMetrics = async () => {
    try {
      // 1. Get settings
      const settings = await dbClient.getSettings();
      setStoreSettings(settings);

      // 2. Count low stock items
      const variants = await dbClient.getVariants();
      const lowStockCount = variants.filter(v => v.stock_quantity <= v.min_limit).length;
      setLowStockWarningCount(lowStockCount);

      // 3. Count sync items
      const queue = await dbClient.getSyncQueue();
      setSyncQueueCount(queue.length);

      // 4. Delay check (warning banner for 5 days delayed sync)
      const oldestPending = queue.reduce((oldest: any, item: any) => {
        if (!item.created_at) return oldest;
        if (!oldest || !oldest.created_at) return item;
        return new Date(item.created_at) < new Date(oldest.created_at) ? item : oldest;
      }, null);

      if (oldestPending && oldestPending.created_at) {
        const diffMs = Date.now() - new Date(oldestPending.created_at).getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        setIsSyncDelayed(diffDays > 5);
      } else {
        setIsSyncDelayed(false);
      }

      // 5. Automatic Instant Background Cloud Sync
      const sUrl = settings.supabase_url || '';
      const sKey = settings.supabase_anon_key || '';
      
      if (sUrl && sKey && queue.length > 0 && navigator.onLine && !isSyncingRef.current) {
        isSyncingRef.current = true;
        console.log(`[Auto-Sync] Found ${queue.length} pending local records. Syncing to Supabase...`);
        
        const supabase = createClient(sUrl, sKey);

        let successCount = 0;
        for (const item of queue) {
          try {
            const payload = JSON.parse(item.data);
            console.log(`[Auto-Sync] Processing: table=${item.table_name} op=${item.operation} id=${item.id}`);

            // ── SALES ──────────────────────────────────────────────────────────
            if (item.table_name === 'sales') {
              const saleObj = payload.sale || payload;
              const itemsList: any[] = payload.items || [];

              // Ensure all required fields are present
              const saleRow = {
                id: saleObj.id,
                invoice_number: saleObj.invoice_number,
                cashier_id: saleObj.cashier_id || null,
                cashier_name: saleObj.cashier_name || saleObj.cashier_id || 'كاشير',
                customer_name: saleObj.customer_name || null,
                total_amount: Number(saleObj.total_amount) || 0,
                discount: Number(saleObj.discount) || 0,
                final_amount: Number(saleObj.final_amount) || 0,
                payment_method: saleObj.payment_method || 'CASH',
                created_at: saleObj.created_at || new Date().toISOString()
              };

              const { error: saleErr } = await supabase.from('sales').upsert(saleRow, { onConflict: 'id' });
              if (saleErr) throw new Error(`sales upsert: ${saleErr.message}`);

              // Insert sale items — each item needs id, name, origin
              if (itemsList.length > 0) {
                const saleItemRows = itemsList.map((x: any, idx: number) => ({
                  id: x.id || `item_${saleObj.id}_${idx}`,
                  sale_id: saleObj.id,
                  variant_id: x.variant_id || null,
                  name: x.name || x.product_name || 'قطعة غيار',
                  origin: x.origin || 'غير محدد',
                  quantity: Number(x.quantity) || 1,
                  unit_price: Number(x.unit_price) || 0,
                  cost_price: Number(x.cost_price) || 0,
                  total_price: Number(x.total_price) || Number(x.unit_price) * Number(x.quantity) || 0
                }));
                const { error: itemsErr } = await supabase.from('sale_items').upsert(saleItemRows, { onConflict: 'id' });
                if (itemsErr) throw new Error(`sale_items upsert: ${itemsErr.message}`);
              }

            // ── SUPPLIERS ──────────────────────────────────────────────────────
            } else if (item.table_name === 'suppliers') {
              const supObj = payload.supplier || payload;
              if (supObj && supObj.id && supObj.name) {
                const supRow = {
                  id: supObj.id,
                  name: supObj.name,
                  phone: supObj.phone || null,
                  email: supObj.email || null,
                  address: supObj.address || null,
                  current_debt: Number(supObj.current_debt) || 0,
                  created_at: supObj.created_at || new Date().toISOString()
                };
                const { error: supErr } = await supabase.from('suppliers').upsert(supRow, { onConflict: 'id' });
                if (supErr) throw new Error(`suppliers upsert: ${supErr.message}`);
              }

              if (payload.transaction) {
                const tx = payload.transaction;
                const txRow = {
                  id: tx.id,
                  supplier_id: tx.supplier_id,
                  transaction_type: tx.transaction_type,
                  amount: Number(tx.amount) || 0,
                  previous_debt: Number(tx.previous_debt) || 0,
                  new_debt: Number(tx.new_debt) || 0,
                  notes: tx.notes || null,
                  created_at: tx.created_at || new Date().toISOString()
                };
                const { error: txErr } = await supabase.from('supplier_debts').upsert(txRow, { onConflict: 'id' });
                if (txErr) throw new Error(`supplier_debts upsert: ${txErr.message}`);
              }

            // ── PRODUCTS ───────────────────────────────────────────────────────
            } else if (item.table_name === 'products') {
              if (payload.product) {
                const p = payload.product;
                const { error: prodErr } = await supabase.from('products').upsert({
                  id: p.id, name: p.name, category: p.category || 'عام',
                  min_limit_general: Number(p.min_limit_general) || 5,
                  created_at: p.created_at || new Date().toISOString()
                }, { onConflict: 'id' });
                if (prodErr) throw new Error(`products upsert: ${prodErr.message}`);
              }
              if (payload.variant) {
                const v = payload.variant;
                const { error: varErr } = await supabase.from('product_variants').upsert({
                  id: v.id, product_id: v.product_id, origin: v.origin,
                  specification: v.specification || null,
                  cost_price: Number(v.cost_price) || 0,
                  selling_price: Number(v.selling_price) || 0,
                  stock_quantity: Number(v.stock_quantity) || 0,
                  min_limit: Number(v.min_limit) || 3,
                  sku_barcode: v.sku_barcode,
                  created_at: v.created_at || new Date().toISOString()
                }, { onConflict: 'id' });
                if (varErr) throw new Error(`product_variants upsert: ${varErr.message}`);
              }
              if (payload.compatibility && payload.compatibility.length > 0) {
                const compatList = payload.compatibility.map((c: any, idx: number) => ({
                  id: c.id || `comp_${payload.variant?.id || 'x'}_${idx}`,
                  variant_id: payload.variant?.id,
                  car_make: c.carMake || c.car_make || '',
                  car_model: c.carModel || c.car_model || '',
                  year_start: Number(c.yearStart || c.year_start) || 0,
                  year_end: Number(c.yearEnd || c.year_end) || 0,
                  created_at: c.created_at || new Date().toISOString()
                }));
                const { error: compErr } = await supabase.from('product_compatibility').upsert(compatList, { onConflict: 'id' });
                if (compErr) throw new Error(`product_compatibility upsert: ${compErr.message}`);
              }

            // ── PRODUCT VARIANTS (stock update) ───────────────────────────────
            } else if (item.table_name === 'product_variants') {
              const v = payload;
              const { error: varErr } = await supabase.from('product_variants').upsert({
                id: v.id, product_id: v.product_id, origin: v.origin,
                specification: v.specification || null,
                cost_price: Number(v.cost_price) || 0,
                selling_price: Number(v.selling_price) || 0,
                stock_quantity: Number(v.stock_quantity) || 0,
                min_limit: Number(v.min_limit) || 3,
                sku_barcode: v.sku_barcode,
              }, { onConflict: 'id' });
              if (varErr) throw new Error(`product_variants (update) upsert: ${varErr.message}`);

            // ── CASHIER USERS ──────────────────────────────────────────────────
            } else if (item.table_name === 'cashier_users') {
              const u = payload;
              const { error: userErr } = await supabase.from('cashier_users').upsert({
                id: u.id, username: u.username, password_hash: u.password_hash,
                role: u.role || 'CASHIER', phone: u.phone || null,
                created_at: u.created_at || new Date().toISOString()
              }, { onConflict: 'id' });
              if (userErr) throw new Error(`cashier_users upsert: ${userErr.message}`);

            // ── CASHIER USERS DELETE ───────────────────────────────────────────
            } else if (item.table_name === 'cashier_users_delete') {
              const { error: delErr } = await supabase.from('cashier_users').delete().eq('id', payload.id);
              if (delErr) throw new Error(`cashier_users delete: ${delErr.message}`);

            // ── PRODUCT VARIANTS DELETE ───────────────────────────────────────
            } else if (item.table_name === 'product_variants_delete') {
              const { error: delErr } = await supabase.from('product_variants').delete().eq('id', payload.id);
              if (delErr) throw new Error(`product_variants delete: ${delErr.message}`);

            // ── PRODUCTS DELETE ───────────────────────────────────────────────
            } else if (item.table_name === 'products_delete') {
              const { error: delErr } = await supabase.from('products').delete().eq('id', payload.id);
              if (delErr) throw new Error(`products delete: ${delErr.message}`);

            // ── SUPPLIERS DELETE ──────────────────────────────────────────────
            } else if (item.table_name === 'suppliers_delete') {
              const { error: delErr } = await supabase.from('suppliers').delete().eq('id', payload.id);
              if (delErr) throw new Error(`suppliers delete: ${delErr.message}`);

            // ── SALES DELETE ──────────────────────────────────────────────────
            } else if (item.table_name === 'sales_delete') {
              const { error: delErr } = await supabase.from('sales').delete().eq('id', payload.id);
              if (delErr) throw new Error(`sales delete: ${delErr.message}`);

            // ── RESET ALL ─────────────────────────────────────────────────────
            } else if (item.table_name === 'reset_all') {
              const { error: err1 } = await supabase.from('sales').delete().neq('id', 'dummy');
              const { error: err2 } = await supabase.from('supplier_debts').delete().neq('id', 'dummy');
              const { error: err3 } = await supabase.from('suppliers').update({ current_debt: 0 }).neq('id', 'dummy');
              if (err1 || err2 || err3) {
                throw new Error(`reset_all error: ${err1?.message || err2?.message || err3?.message}`);
              }

            // ── ACTIVITY LOGS ──────────────────────────────────────────────────
            } else if (item.table_name === 'activity_logs') {
              const log = payload;
              const { error: logErr } = await supabase.from('activity_logs').upsert({
                id: log.id, user_id: log.user_id || null,
                username: log.username || 'system', action: log.action,
                details: log.details || null,
                created_at: log.created_at || new Date().toISOString()
              }, { onConflict: 'id' });
              if (logErr) throw new Error(`activity_logs upsert: ${logErr.message}`);

            } else {
              console.warn(`[Auto-Sync] Unknown table_name: ${item.table_name} — skipping`);
            }

            await dbClient.markAsSynced([item.id]);
            successCount++;
            console.log(`[Auto-Sync] ✅ Synced: ${item.table_name} (${item.id})`);
          } catch (err: any) {
            console.error(`[Auto-Sync] ❌ Error syncing item ${item.id} (${item.table_name}):`, err.message || err);
            await dbClient.markAsFailed(item.id, err.message || 'Auto-Sync Error');
          }
        }
        
        console.log(`[Auto-Sync] Sync run done. ✅ ${successCount}/${queue.length}`);
        isSyncingRef.current = false;
        
        // Refresh local count after sync run
        const updatedQueue = await dbClient.getSyncQueue();
        setSyncQueueCount(updatedQueue.length);
      }

      // 6. Automatic Scheduled Database File Backup (Friday or every 7 days)
      if (sUrl && sKey && navigator.onLine) {
        const lastBackup = localStorage.getItem('last_backup_time');
        const diffMs = Date.now() - (lastBackup ? new Date(lastBackup).getTime() : 0);
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        
        const isFriday = new Date().getDay() === 5;
        const backupToday = lastBackup && new Date(lastBackup).toDateString() === new Date().toDateString();

        if (!lastBackup || diffDays >= 7 || (isFriday && !backupToday)) {
          console.log('[Auto-Backup] Scheduled backup trigger active...');
          const supabaseBackup = createClient(sUrl, sKey);
          
          const fileRes = await dbClient.getDbBackupFile();
          if (fileRes.success && fileRes.data && fileRes.filename) {
            await supabaseBackup.storage.createBucket('backups', { public: false }).catch(() => {});
            
            const { error: uploadErr } = await supabaseBackup.storage
              .from('backups')
              .upload(`auto_${fileRes.filename}`, fileRes.data, {
                contentType: 'application/octet-stream',
                upsert: true
              });

            if (!uploadErr) {
              localStorage.setItem('last_backup_time', new Date().toISOString());
              await dbClient.logActivity(
                'SYSTEM',
                'Auto-Backup',
                'BACKUP_COMPLETED',
                `سحابي تلقائي: تم رفع نسخة احتياطية كاملة من قاعدة البيانات باسم auto_${fileRes.filename}`
              );
              console.log('[Auto-Backup] Database file backup uploaded successfully.');
            } else {
              console.error('[Auto-Backup] Upload error:', uploadErr);
            }
          } else {
            console.error('[Auto-Backup] Failed to read db file:', fileRes.error);
          }
        }
      }
    } catch (e) {
      console.error('Error refreshing app metrics:', e);
      isSyncingRef.current = false;
    }
  };

  useEffect(() => {
    refreshGlobalMetrics();
    const interval = setInterval(refreshGlobalMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    if (currentUser) {
      await dbClient.logActivity(currentUser.id, currentUser.username, 'USER_LOGOUT', `تسجيل خروج المستخدم: ${currentUser.username}`);
    }
    setCurrentUser(null);
    setActiveTab('cashier'); // reset default
  };

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Render Login if no active user session
  if (!currentUser) {
    return <LoginScreen onLoginSuccess={setCurrentUser} storeSettings={storeSettings} />;
  }

  // Tab rendering helper
  const renderTabContent = () => {
    switch (activeTab) {
      case 'cashier':
        return (
          <CashierScreen
            currentUserId={currentUser.id}
            currentUsername={currentUser.username}
            storeSettings={storeSettings}
            onRefreshData={refreshGlobalMetrics}
          />
        );
      case 'inventory':
        if (currentUser.role !== 'ADMIN') return <div className="text-center py-12 text-slate-500">غير مصرح لك بدخول هذه الشاشة.</div>;
        return (
          <InventoryScreen
            currentUserId={currentUser.id}
            currentUsername={currentUser.username}
            onRefreshData={refreshGlobalMetrics}
          />
        );
      case 'suppliers':
        if (currentUser.role !== 'ADMIN') return <div className="text-center py-12 text-slate-500">غير مصرح لك بدخول هذه الشاشة.</div>;
        return (
          <SuppliersScreen
            currentUserId={currentUser.id}
            currentUsername={currentUser.username}
            onRefreshData={refreshGlobalMetrics}
          />
        );
      case 'barcode':
        if (currentUser.role !== 'ADMIN') return <div className="text-center py-12 text-slate-500">غير مصرح لك بدخول هذه الشاشة.</div>;
        return <BarcodePrintScreen storeSettings={storeSettings} />;
      case 'settings':
        if (currentUser.role !== 'ADMIN') return <div className="text-center py-12 text-slate-500">غير مصرح لك بدخول هذه الشاشة.</div>;
        return (
          <SettingsScreen
            currentUserId={currentUser.id}
            currentUsername={currentUser.username}
            storeSettings={storeSettings}
            onSaveSettings={(newSettings) => {
              setStoreSettings(newSettings);
              refreshGlobalMetrics();
            }}
          />
        );
      case 'dashboard':
        return (
          <DashboardScreen
            currentUserId={currentUser.id}
            currentUsername={currentUser.username}
            syncQueueCount={syncQueueCount}
            storeSettings={storeSettings}
            onRefreshData={refreshGlobalMetrics}
          />
        );
    }
  };

  const isAdmin = currentUser.role === 'ADMIN';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-main text-main font-sans rtl-grid select-none">
      {/* Delayed Sync Warning Banner */}
      {isSyncDelayed && (
        <div className="bg-amber-600 dark:bg-amber-700 text-white font-bold text-center py-2.5 px-4 text-xs flex items-center justify-center gap-2 select-none shadow-md shrink-0 z-30 border-b border-amber-500/20">
          <AlertTriangle className="w-4.5 h-4.5 text-white animate-pulse" />
          <span>تنبيه هام: توجد بيانات محلية بالمخزن لم يتم رفعها سحابياً منذ أكثر من 5 أيام! يرجى تشغيل الإنترنت فوراً لمزامنة البيانات وتجنب فقدانها.</span>
        </div>
      )}

      {/* Top Header Navigation bar */}
      <header className="h-16 bg-panel border-b border-main px-6 flex items-center justify-between z-20 shrink-0 shadow-sm">
        {/* Right side: Shop Logo / Brand info */}
        <div className="flex items-center gap-3">
          <img src="logo-without-bg.png" alt="الأصيل" className="w-10 h-10 object-contain" />
          <div>
            <h1 className="font-extrabold text-base tracking-tight text-main">
              {storeSettings.store_name || 'الأصيل لقطع الغيار'}
            </h1>
            <p className="text-[10px] text-muted font-semibold">حساب مبيعات ومخازن ذكي</p>
          </div>
        </div>

        {/* Center Tab buttons (Filtered based on Role) */}
        <nav className="flex items-center gap-1 bg-main p-1 rounded-xl border border-main">
          <button
            onClick={() => setActiveTab('cashier')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'cashier'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-muted hover:text-main'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            شاشة الكاشير
          </button>
          
          {/* Hide Inventory from normal Cashier role */}
          {isAdmin && (
            <button
              onClick={() => setActiveTab('inventory')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all relative ${
                activeTab === 'inventory'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-muted hover:text-main'
              }`}
            >
              <Boxes className="w-4 h-4" />
              إدارة المخزن
              {lowStockWarningCount > 0 && (
                <span className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-rose-600 text-white rounded-full flex items-center justify-center text-[9px] font-black border-2 border-main animate-bounce">
                  {lowStockWarningCount}
                </span>
              )}
            </button>
          )}

          {/* Hide Suppliers Ledger from normal Cashier role */}
          {isAdmin && (
            <button
              onClick={() => setActiveTab('suppliers')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'suppliers'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-muted hover:text-main'
              }`}
            >
              <Users2 className="w-4 h-4" />
              ديون الموردين
            </button>
          )}

          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all relative ${
              activeTab === 'dashboard'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-muted hover:text-main'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            التحليلات والمزامنة
            {syncQueueCount > 0 && (
              <span className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-amber-600 text-white rounded-full flex items-center justify-center text-[9px] font-black border-2 border-main animate-pulse">
                {syncQueueCount}
              </span>
            )}
          </button>

          {/* Barcode Printing */}
          {isAdmin && (
            <button
              onClick={() => setActiveTab('barcode')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'barcode'
                  ? 'bg-violet-600 text-white shadow-md'
                  : 'text-muted hover:text-main'
              }`}
            >
              <Tag className="w-4 h-4" />
              طباعة الباركود
            </button>
          )}

          {/* Hide settings from normal Cashier role */}
          {isAdmin && (
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'settings'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-muted hover:text-main'
              }`}
            >
              <Settings className="w-4 h-4" />
              الإعدادات والأرشيف
            </button>
          )}
        </nav>

        {/* Left side: Theme switch, Network status, Active user profile & Logout */}
        <div className="flex items-center gap-3">
          {/* Global Critical stock warning alert badge */}
          {isAdmin && lowStockWarningCount > 0 && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-500 dark:text-rose-400 text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 animate-pulse">
              <AlertTriangle className="w-4 h-4 text-rose-500" />
              <span>مخزون حرج! ({lowStockWarningCount})</span>
            </div>
          )}

          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-xl bg-main border border-main text-muted hover:text-main transition-all active:scale-95"
            title={theme === 'dark' ? 'التحول للمظهر المضيء' : 'التحول للمظهر الداكن'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-blue-600" />}
          </button>

          {/* Network Indicator */}
          <div className="flex items-center gap-1 bg-main px-3 py-1.5 rounded-xl border border-main">
            {isOnline ? (
              <>
                <Wifi className="w-4 h-4 text-emerald-500 animate-pulse" />
                <span className="text-[10px] font-bold text-emerald-500">سحابي</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-rose-500" />
                <span className="text-[10px] font-bold text-rose-500">محلي</span>
              </>
            )}
          </div>

          {/* Cashier profile display & logout action */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-main border border-main px-3 py-1 rounded-xl">
              <div className="text-left">
                <p className="text-[9px] text-muted font-bold">
                  {currentUser.role === 'ADMIN' ? 'مسؤول سوبر' : 'كاشير مبيعات'}
                </p>
                <p className="text-xs font-bold text-main">{currentUser.username}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-panel border border-main flex items-center justify-center text-muted">
                <User className="w-4 h-4" />
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="p-2.5 rounded-xl bg-panel border border-main text-muted hover:text-rose-500 hover:border-rose-500/30 transition-all active:scale-95"
              title="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Tab View container */}
      <main className="flex-1 p-6 overflow-hidden bg-main">
        {renderTabContent()}
      </main>
    </div>
  );
}
