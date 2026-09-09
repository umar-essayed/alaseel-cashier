import { ProductVariant, Sale, Supplier, SupplierDebtTransaction, SyncQueueItem, ActivityLog } from '../types';

// Check if running inside Electron
const isElectron = typeof window !== 'undefined' && window.api !== undefined;

// Mock database storage in case we run in a normal web browser for development/testing
const getLocalStorageData = <T>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue;
  const stored = localStorage.getItem(`mock_db_${key}`);
  return stored ? JSON.parse(stored) : defaultValue;
};

const setLocalStorageData = <T>(key: string, data: T): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`mock_db_${key}`, JSON.stringify(data));
};

// Initialize Mock Data if needed
const initMockDB = () => {
  const settings = getLocalStorageData('settings', {
    store_name: 'الأصيل لقطع الغيار',
    store_phone: '01012345678',
    store_logo: '',
    invoice_header: 'مرحباً بكم في محلات الأصيل لقطع الغيار - ثقة وأمان',
    invoice_footer: 'الفاتورة صالحة للمرتجع خلال 14 يوماً مع وجود العبوة الأصلية'
  });

  const variants = getLocalStorageData<ProductVariant[]>('variants', [
    { id: 'v1', product_id: 'p1', origin: 'ألماني (Original)', specification: 'سيراميك - أداء رياضي', cost_price: 450, selling_price: 650, stock_quantity: 8, min_limit: 3, sku_barcode: '4000123456', created_at: new Date().toISOString(), product_name: 'تيل فرامل أمامي', category: 'فرامل' },
    { id: 'v2', product_id: 'p1', origin: 'صيني (درجة أولى)', specification: 'عادي - متانة ممتازة', cost_price: 180, selling_price: 280, stock_quantity: 20, min_limit: 5, sku_barcode: '6900123456', created_at: new Date().toISOString(), product_name: 'تيل فرامل أمامي', category: 'فرامل' },
    { id: 'v3', product_id: 'p1', origin: 'كوري (مستورد)', specification: 'نصف معدني', cost_price: 300, selling_price: 420, stock_quantity: 2, min_limit: 4, sku_barcode: '8800123456', created_at: new Date().toISOString(), product_name: 'تيل فرامل أمامي', category: 'فرامل' },
    { id: 'v4', product_id: 'p2', origin: 'ألماني (Monroe)', specification: 'غاز وضغط زيت مشترك', cost_price: 1200, selling_price: 1600, stock_quantity: 6, min_limit: 2, sku_barcode: '4000789012', created_at: new Date().toISOString(), product_name: 'مساعدين خلفي', category: 'عفشة وتعليق' },
    { id: 'v5', product_id: 'p2', origin: 'ياباني (KYB)', specification: 'ضغط زيت فقط', cost_price: 950, selling_price: 1300, stock_quantity: 1, min_limit: 2, sku_barcode: '4900789012', created_at: new Date().toISOString(), product_name: 'مساعدين خلفي', category: 'عفشة وتعليق' },
    { id: 'v6', product_id: 'p3', origin: 'صيني (براند)', specification: 'فلتر كرتوني مقاوم للحرارة', cost_price: 50, selling_price: 90, stock_quantity: 35, min_limit: 10, sku_barcode: '6900789012', created_at: new Date().toISOString(), product_name: 'فلتر زيت محرك', category: 'فلاتر وزيوت' }
  ]);

  const suppliers = getLocalStorageData<Supplier[]>('suppliers', [
    { id: 's1', name: 'البشبيشي للمستورد', phone: '01223344556', email: 'bishbishy@parts.com', address: 'شبرا، القاهرة', current_debt: 15000, created_at: new Date().toISOString() },
    { id: 's2', name: 'النور لقطع غيار الألماني', phone: '01122334455', email: 'elnoor@germanparts.com', address: 'الدقي، الجيزة', current_debt: 0, created_at: new Date().toISOString() }
  ]);

  const debts = getLocalStorageData<SupplierDebtTransaction[]>('debts', [
    { id: 'd1', supplier_id: 's1', transaction_type: 'PURCHASE_DEBT', amount: 15000, previous_debt: 0, new_debt: 15000, notes: 'شراء بضاعة أول المدة - تيل مكابح ومساعدين', created_at: new Date().toISOString() }
  ]);

  const logs = getLocalStorageData<ActivityLog[]>('logs', []);
  const syncQueue = getLocalStorageData<SyncQueueItem[]>('syncQueue', []);

  setLocalStorageData('settings', settings);
  setLocalStorageData('variants', variants);
  setLocalStorageData('suppliers', suppliers);
  setLocalStorageData('debts', debts);
  setLocalStorageData('logs', logs);
  setLocalStorageData('syncQueue', syncQueue);
};

if (!isElectron) {
  initMockDB();
}

export const dbClient = {
  isElectron,

  // Exec raw SQL queries in Electron (SQLite) or return mocks in Browser
  async dbQuery(sql: string, params: unknown[] = []): Promise<any> {
    if (isElectron) {
      return await window.api.dbQuery(sql, params);
    } else {
      console.warn(`Simulating SQL query in Browser: ${sql}`);
      const sqlLower = sql.toLowerCase();
      if (sqlLower.includes('from sales')) {
        return getLocalStorageData('sales', []);
      }
      if (sqlLower.includes('from sync_queue')) {
        return getLocalStorageData('syncQueue', []).filter((q: any) => q.status === 'pending');
      }
      if (sqlLower.includes('from cashier_users')) {
        return getLocalStorageData('users', [
          { id: 'u1', username: 'admin', role: 'ADMIN', created_at: new Date().toISOString() },
          { id: 'u2', username: 'cashier', role: 'CASHIER', created_at: new Date().toISOString() }
        ]);
      }
      return [];
    }
  },

  // Fetch all products/variants
  async getVariants(): Promise<ProductVariant[]> {
    if (isElectron) {
      return await window.api.getVariants();
    } else {
      return getLocalStorageData<ProductVariant[]>('variants', []);
    }
  },

  // Checkout sale
  async checkout(saleData: Sale, cashierName: string): Promise<{ success: boolean; invoice_number: string; simulatedReceipt?: any }> {
    if (isElectron) {
      return await window.api.checkout(saleData);
    } else {
      const variants = getLocalStorageData<ProductVariant[]>('variants', []);
      
      // Update stocks
      saleData.items.forEach(item => {
        const v = variants.find(x => x.id === item.variant_id);
        if (v) {
          v.stock_quantity = Math.max(0, v.stock_quantity - item.quantity);
        }
      });
      setLocalStorageData('variants', variants);

      // Save Sale & Sync Queue (Mocked)
      const syncQueue = getLocalStorageData<SyncQueueItem[]>('syncQueue', []);
      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      syncQueue.push({
        id: syncId,
        table_name: 'sales',
        operation: 'INSERT',
        record_id: saleData.id,
        data: JSON.stringify(saleData),
        status: 'pending',
        created_at: new Date().toISOString()
      });
      setLocalStorageData('syncQueue', syncQueue);

      // Log activity
      const logs = getLocalStorageData<ActivityLog[]>('logs', []);
      logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: saleData.cashier_id,
        username: cashierName,
        action: 'SALE_COMPLETED',
        details: `فاتورة رقم ${saleData.invoice_number} بقيمة إجمالية ${saleData.final_amount} ج.م دفع ${saleData.payment_method}`,
        created_at: new Date().toISOString()
      });
      setLocalStorageData('logs', logs);

      return { success: true, invoice_number: saleData.invoice_number };
    }
  },

  // Add Supplier Debt Transaction
  async addSupplierDebt(
    supplierId: string,
    type: 'PURCHASE_DEBT' | 'PAYMENT' | 'SETTLEMENT',
    amount: number,
    notes: string,
    userId: string,
    username: string
  ): Promise<{ success: boolean; newDebt: number }> {
    if (isElectron) {
      return await window.api.addSupplierDebt(supplierId, type, amount, notes, userId, username);
    } else {
      const suppliers = getLocalStorageData<Supplier[]>('suppliers', []);
      const supplier = suppliers.find(s => s.id === supplierId);
      if (!supplier) throw new Error('Supplier not found');

      const prevDebt = supplier.current_debt;
      let newDebt = prevDebt;

      if (type === 'PURCHASE_DEBT') {
        newDebt += amount;
      } else if (type === 'PAYMENT') {
        newDebt -= amount;
      } else if (type === 'SETTLEMENT') {
        newDebt = 0;
      }

      supplier.current_debt = newDebt;
      setLocalStorageData('suppliers', suppliers);

      const debts = getLocalStorageData<SupplierDebtTransaction[]>('debts', []);
      const transactionId = 'debt_' + Math.random().toString(36).substr(2, 9);
      const actualAmount = type === 'SETTLEMENT' ? prevDebt : amount;
      
      const debtTx: SupplierDebtTransaction = {
        id: transactionId,
        supplier_id: supplierId,
        transaction_type: type,
        amount: actualAmount,
        previous_debt: prevDebt,
        new_debt: newDebt,
        notes,
        created_at: new Date().toISOString()
      };
      debts.push(debtTx);
      setLocalStorageData('debts', debts);

      // Queue for sync
      const syncQueue = getLocalStorageData<SyncQueueItem[]>('syncQueue', []);
      syncQueue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'suppliers',
        operation: 'UPDATE',
        record_id: supplierId,
        data: JSON.stringify({ supplier, transaction: debtTx }),
        status: 'pending',
        created_at: new Date().toISOString()
      });
      setLocalStorageData('syncQueue', syncQueue);

      // Log activity
      const logs = getLocalStorageData<ActivityLog[]>('logs', []);
      logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: type === 'SETTLEMENT' ? 'DEBT_SETTLEMENT' : 'DEBT_TRANSACTION',
        details: `حركة دين على المورد ${supplier.name}: نوع (${type}) قيمة (${actualAmount}) ج.م. الدين الجديد: ${newDebt}`,
        created_at: new Date().toISOString()
      });
      setLocalStorageData('logs', logs);

      return { success: true, newDebt };
    }
  },

  // Edit stock manually
  async updateVariantStock(variantId: string, quantity: number, userId: string, username: string, reason: string): Promise<{ success: boolean }> {
    if (isElectron) {
      return await window.api.updateVariantStock(variantId, quantity, userId, username, reason);
    } else {
      const variants = getLocalStorageData<ProductVariant[]>('variants', []);
      const variant = variants.find(v => v.id === variantId);
      if (!variant) throw new Error('Variant not found');
      const oldQty = variant.stock_quantity;
      variant.stock_quantity = quantity;
      setLocalStorageData('variants', variants);

      const syncQueue = getLocalStorageData<SyncQueueItem[]>('syncQueue', []);
      syncQueue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'product_variants',
        operation: 'UPDATE',
        record_id: variantId,
        data: JSON.stringify({ id: variantId, stock_quantity: quantity }),
        status: 'pending',
        created_at: new Date().toISOString()
      });
      setLocalStorageData('syncQueue', syncQueue);

      const logs = getLocalStorageData<ActivityLog[]>('logs', []);
      logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: 'INVENTORY_ADJUSTMENT',
        details: `تعديل مخزون الصنف (البادكود: ${variant.sku_barcode}) من ${oldQty} إلى ${quantity}. السبب: ${reason}`,
        created_at: new Date().toISOString()
      });
      setLocalStorageData('logs', logs);

      return { success: true };
    }
  },

  // Edit Variant values
  async editVariant(variantData: Partial<ProductVariant>, userId: string, username: string): Promise<{ success: boolean }> {
    if (isElectron) {
      return await window.api.editVariant(variantData, userId, username);
    } else {
      const variants = getLocalStorageData<ProductVariant[]>('variants', []);
      const index = variants.findIndex(v => v.id === variantData.id);
      if (index === -1) throw new Error('Variant not found');
      
      variants[index] = { ...variants[index], ...variantData } as ProductVariant;
      setLocalStorageData('variants', variants);

      const syncQueue = getLocalStorageData<SyncQueueItem[]>('syncQueue', []);
      syncQueue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'product_variants',
        operation: 'UPDATE',
        record_id: variantData.id!,
        data: JSON.stringify(variantData),
        status: 'pending',
        created_at: new Date().toISOString()
      });
      setLocalStorageData('syncQueue', syncQueue);

      const logs = getLocalStorageData<ActivityLog[]>('logs', []);
      logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: 'VARIANT_UPDATED',
        details: `تعديل بيانات المتغير (الباركود: ${variantData.sku_barcode}) - السعر: ${variantData.selling_price}`,
        created_at: new Date().toISOString()
      });
      setLocalStorageData('logs', logs);

      return { success: true };
    }
  },

  // Delete product variant
  async deleteVariant(variantId: string, userId: string, username: string): Promise<{ success: boolean }> {
    if (isElectron) {
      return await window.api.deleteVariant(variantId, userId, username);
    } else {
      const variants = getLocalStorageData<ProductVariant[]>('variants', []);
      const matched = variants.find(v => v.id === variantId);
      if (!matched) throw new Error('Variant not found');
      
      const newVariants = variants.filter(v => v.id !== variantId);
      setLocalStorageData('variants', newVariants);

      // Check if product has other variants
      const productVariantsCount = newVariants.filter(v => v.product_id === matched.product_id).length;
      if (productVariantsCount === 0) {
        const products = getLocalStorageData<any[]>('products', []);
        setLocalStorageData('products', products.filter(p => p.id !== matched.product_id));
        
        // Sync queue for product delete
        const queue = getLocalStorageData<any[]>('syncQueue', []);
        queue.push({
          id: 'sync_' + Math.random().toString(36).substr(2, 9),
          table_name: 'products_delete',
          operation: 'DELETE',
          record_id: matched.product_id,
          data: JSON.stringify({ id: matched.product_id }),
          status: 'pending',
          created_at: new Date().toISOString()
        });
        setLocalStorageData('syncQueue', queue);
      }

      // Sync queue for variant delete
      const syncQueue = getLocalStorageData<SyncQueueItem[]>('syncQueue', []);
      syncQueue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'product_variants_delete',
        operation: 'DELETE',
        record_id: variantId,
        data: JSON.stringify({ id: variantId }),
        status: 'pending',
        created_at: new Date().toISOString()
      });
      setLocalStorageData('syncQueue', syncQueue);

      const logs = getLocalStorageData<ActivityLog[]>('logs', []);
      logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: 'VARIANT_DELETED',
        details: `حذف الصنف (الباركود: ${matched.sku_barcode}) نهائياً من المخزن.`,
        created_at: new Date().toISOString()
      });
      setLocalStorageData('logs', logs);

      return { success: true };
    }
  },

  // Delete Supplier
  async deleteSupplier(supplierId: string, userId: string, username: string): Promise<{ success: boolean }> {
    if (isElectron) {
      return await window.api.deleteSupplier(supplierId, userId, username);
    } else {
      const suppliers = getLocalStorageData<Supplier[]>('suppliers', []);
      const matched = suppliers.find(s => s.id === supplierId);
      if (!matched) throw new Error('Supplier not found');

      setLocalStorageData('suppliers', suppliers.filter(s => s.id !== supplierId));
      
      const debts = getLocalStorageData<SupplierDebtTransaction[]>('debts', []);
      setLocalStorageData('debts', debts.filter(d => d.supplier_id !== supplierId));

      const syncQueue = getLocalStorageData<SyncQueueItem[]>('syncQueue', []);
      syncQueue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'suppliers_delete',
        operation: 'DELETE',
        record_id: supplierId,
        data: JSON.stringify({ id: supplierId }),
        status: 'pending',
        created_at: new Date().toISOString()
      });
      setLocalStorageData('syncQueue', syncQueue);

      const logs = getLocalStorageData<ActivityLog[]>('logs', []);
      logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: 'SUPPLIER_DELETED',
        details: `حذف المورد ${matched.name} نهائياً وحذف جميع حركات ديونه.`,
        created_at: new Date().toISOString()
      });
      setLocalStorageData('logs', logs);

      return { success: true };
    }
  },

  // Delete Sale (invoice)
  async deleteSale(saleId: string, userId: string, username: string): Promise<{ success: boolean }> {
    if (isElectron) {
      return await window.api.deleteSale(saleId, userId, username);
    } else {
      const sales = getLocalStorageData<any[]>('sales', []);
      const matched = sales.find(s => s.id === saleId);
      if (!matched) throw new Error('Sale not found');

      const saleItems = getLocalStorageData<any[]>('saleItems', []);
      const items = saleItems.filter(item => item.sale_id === saleId);
      const variants = getLocalStorageData<ProductVariant[]>('variants', []);
      
      items.forEach(item => {
        const variant = variants.find(v => v.id === item.variant_id);
        if (variant) {
          variant.stock_quantity += item.quantity;
        }
      });
      setLocalStorageData('variants', variants);

      setLocalStorageData('sales', sales.filter(s => s.id !== saleId));
      setLocalStorageData('saleItems', saleItems.filter(item => item.sale_id !== saleId));

      const syncQueue = getLocalStorageData<SyncQueueItem[]>('syncQueue', []);
      syncQueue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'sales_delete',
        operation: 'DELETE',
        record_id: saleId,
        data: JSON.stringify({ id: saleId }),
        status: 'pending',
        created_at: new Date().toISOString()
      });
      setLocalStorageData('syncQueue', syncQueue);

      const logs = getLocalStorageData<ActivityLog[]>('logs', []);
      logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: 'SALE_DELETED',
        details: `حذف الفاتورة رقم ${matched.invoice_number} لـ ${matched.customer_name || 'عميل نقدي'} وإرجاع الكميات للمخزن.`,
        created_at: new Date().toISOString()
      });
      setLocalStorageData('logs', logs);

      return { success: true };
    }
  },

  // Update discount on finalized sale
  async updateSaleDiscount(
    saleId: string,
    newDiscount: number,
    userId: string,
    username: string,
    reason: string = ''
  ): Promise<{ success: boolean; newDiscount: number; newFinalAmount: number }> {
    if (isElectron) {
      return await window.api.updateSaleDiscount(saleId, newDiscount, userId, username, reason);
    } else {
      const sales = getLocalStorageData<any[]>('sales', []);
      const matched = sales.find(s => s.id === saleId);
      if (!matched) throw new Error('الفاتورة غير موجودة');

      const discountNum = Math.max(0, Number(newDiscount) || 0);
      const totalAmount = Number(matched.total_amount) || 0;
      if (discountNum > totalAmount) {
        throw new Error(`قيمة الخصم (${discountNum}) أكبر من إجمالي الفاتورة (${totalAmount})`);
      }

      const oldDiscount = Number(matched.discount) || 0;
      const newFinalAmount = Math.max(0, totalAmount - discountNum);

      matched.discount = discountNum;
      matched.final_amount = newFinalAmount;
      setLocalStorageData('sales', sales);

      const syncQueue = getLocalStorageData<SyncQueueItem[]>('syncQueue', []);
      syncQueue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'sales',
        operation: 'UPDATE',
        record_id: saleId,
        data: JSON.stringify({ sale: matched }),
        status: 'pending',
        created_at: new Date().toISOString()
      });
      setLocalStorageData('syncQueue', syncQueue);

      const logs = getLocalStorageData<ActivityLog[]>('logs', []);
      logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: 'SALE_DISCOUNT_UPDATED',
        details: `تعديل خصم الفاتورة رقم ${matched.invoice_number} من ${oldDiscount} ج.م إلى ${discountNum} ج.م (الصافي الجديد: ${newFinalAmount} ج.م). ${reason ? 'السبب: ' + reason : ''}`,
        created_at: new Date().toISOString()
      });
      setLocalStorageData('logs', logs);

      return { success: true, newDiscount: discountNum, newFinalAmount };
    }
  },

  // Reset all invoices & accounts
  async resetAllInvoicesAndAccounts(userId: string, username: string): Promise<{ success: boolean }> {
    if (isElectron) {
      return await window.api.resetAllInvoicesAndAccounts(userId, username);
    } else {
      setLocalStorageData('sales', []);
      setLocalStorageData('saleItems', []);
      setLocalStorageData('debts', []);
      
      const suppliers = getLocalStorageData<Supplier[]>('suppliers', []);
      suppliers.forEach(s => {
        s.current_debt = 0;
      });
      setLocalStorageData('suppliers', suppliers);

      const syncQueue = getLocalStorageData<SyncQueueItem[]>('syncQueue', []);
      syncQueue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'reset_all',
        operation: 'DELETE',
        record_id: 'all',
        data: JSON.stringify({ reset: true }),
        status: 'pending',
        created_at: new Date().toISOString()
      });
      setLocalStorageData('syncQueue', syncQueue);

      const logs = getLocalStorageData<ActivityLog[]>('logs', []);
      logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: 'SYSTEM_RESET',
        details: 'تم تصفير جميع الفواتير والحسابات وحسابات الموردين بالكامل.',
        created_at: new Date().toISOString()
      });
      setLocalStorageData('logs', logs);

      return { success: true };
    }
  },

  // Sync operations
  async getSyncQueue(): Promise<SyncQueueItem[]> {
    if (isElectron) {
      return await window.api.getSyncQueue();
    } else {
      return getLocalStorageData<SyncQueueItem[]>('syncQueue', []).filter(q => q.status === 'pending');
    }
  },

  async markAsSynced(queueIds: string[]): Promise<boolean> {
    if (isElectron) {
      return await window.api.markAsSynced(queueIds);
    } else {
      const syncQueue = getLocalStorageData<SyncQueueItem[]>('syncQueue', []);
      syncQueue.forEach(q => {
        if (queueIds.includes(q.id)) {
          q.status = 'synced';
        }
      });
      setLocalStorageData('syncQueue', syncQueue);
      return true;
    }
  },

  async markAsFailed(queueId: string, errorMsg: string): Promise<boolean> {
    if (isElectron) {
      return await window.api.markAsFailed(queueId, errorMsg);
    } else {
      const syncQueue = getLocalStorageData<SyncQueueItem[]>('syncQueue', []);
      const q = syncQueue.find(x => x.id === queueId);
      if (q) {
        q.status = 'failed';
        q.error_message = errorMsg;
      }
      setLocalStorageData('syncQueue', syncQueue);
      return true;
    }
  },

  // Settings
  async getSettings(): Promise<Record<string, string>> {
    if (isElectron) {
      return await window.api.getSettings();
    } else {
      return getLocalStorageData<Record<string, string>>('settings', {});
    }
  },

  async saveSetting(key: string, value: string): Promise<boolean> {
    if (isElectron) {
      return await window.api.saveSetting(key, value);
    } else {
      const settings = getLocalStorageData<Record<string, string>>('settings', {});
      settings[key] = value;
      setLocalStorageData('settings', settings);
      return true;
    }
  },

  // Logs
  async getActivityLogs(): Promise<ActivityLog[]> {
    if (isElectron) {
      return await window.api.dbQuery('SELECT * FROM activity_logs ORDER BY created_at DESC');
    } else {
      return getLocalStorageData<ActivityLog[]>('logs', []).sort((a,b) => b.created_at.localeCompare(a.created_at));
    }
  },

  async logActivity(userId: string, username: string, action: string, details: string): Promise<boolean> {
    if (isElectron) {
      return await window.api.logActivity(userId, username, action, details);
    } else {
      const logs = getLocalStorageData<ActivityLog[]>('logs', []);
      logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action,
        details,
        created_at: new Date().toISOString()
      });
      setLocalStorageData('logs', logs);
      return true;
    }
  },

  // Fetch Suppliers
  async getSuppliers(): Promise<Supplier[]> {
    if (isElectron) {
      return await window.api.dbQuery('SELECT * FROM suppliers');
    } else {
      return getLocalStorageData<Supplier[]>('suppliers', []);
    }
  },

  // Fetch Supplier Debt Transactions
  async getSupplierDebts(supplierId: string): Promise<SupplierDebtTransaction[]> {
    if (isElectron) {
      return await window.api.dbQuery('SELECT * FROM supplier_debts WHERE supplier_id = ? ORDER BY created_at DESC', [supplierId]);
    } else {
      const debts = getLocalStorageData<SupplierDebtTransaction[]>('debts', []);
      return debts.filter(d => d.supplier_id === supplierId).sort((a,b) => b.created_at.localeCompare(a.created_at));
    }
  },

  // Hardware POS print
  async printReceipt(receiptData: Parameters<typeof window.api.printReceipt>[0]) {
    if (isElectron) {
      return await window.api.printReceipt(receiptData);
    } else {
      console.log('--- Simulated Receipt (Browser Fallback) ---');
      console.log(`Store: ${receiptData.storeName}`);
      console.log(`Phone: ${receiptData.phone}`);
      console.log(`Invoice: ${receiptData.invoiceNumber}`);
      console.log('Items:');
      receiptData.items.forEach(item => {
        console.log(` - ${item.name} (${item.origin}) x${item.qty} | Price: ${item.price} | Total: ${item.total}`);
      });
      console.log(`Total: ${receiptData.totalAmount} | Net: ${receiptData.finalAmount}`);
      console.log(`QR Code Content: ${receiptData.qrCodeData}`);
      console.log('-------------------------------------------');
      return { success: false, error: 'Cannot trigger local POS printer outside of Electron wrapper.' };
    }
  },

  // Add Product & Variant & Compatibility
  async addProduct(
    data: {
      productName: string;
      category: string;
      origin: string;
      specification: string;
      costPrice: number;
      sellingPrice: number;
      stockQuantity: number;
      minLimit: number;
      barcode: string;
      compatibility: Array<{ carMake: string; carModel: string; yearStart: number; yearEnd: number }>;
    },
    userId: string,
    username: string
  ): Promise<{ success: boolean }> {
    const ts = new Date().toISOString();
    const productId = 'prod_' + Math.random().toString(36).substr(2, 9);
    const variantId = 'var_' + Math.random().toString(36).substr(2, 9);

    if (isElectron) {
      return (window as any).api.addProduct(data, userId, username);
    } else {
      const prods = getLocalStorageData<any[]>('products', []);
      const variants = getLocalStorageData<any[]>('variants', []);
      const comps = getLocalStorageData<any[]>('compatibility', []);

      let activeProdId = productId;
      const existing = prods.find(p => p.name === data.productName && p.category === data.category);
      if (existing) {
        activeProdId = existing.id;
      } else {
        prods.push({ id: productId, name: data.productName, category: data.category, min_limit_general: 5, created_at: ts });
        setLocalStorageData('products', prods);
      }

      const newVar = {
        id: variantId,
        product_id: activeProdId,
        origin: data.origin,
        specification: data.specification,
        cost_price: data.costPrice,
        selling_price: data.sellingPrice,
        stock_quantity: data.stockQuantity,
        min_limit: data.minLimit,
        sku_barcode: data.barcode,
        created_at: ts,
        product_name: data.productName,
        category: data.category,
        compatibility: data.compatibility.map(c => ({
          car_make: c.carMake,
          car_model: c.carModel,
          year_start: c.yearStart,
          year_end: c.yearEnd
        }))
      };

      variants.push(newVar);
      setLocalStorageData('variants', variants);

      data.compatibility.forEach(c => {
        comps.push({
          id: 'comp_' + Math.random().toString(36).substr(2, 9),
          variant_id: variantId,
          car_make: c.carMake,
          car_model: c.carModel,
          year_start: c.yearStart,
          year_end: c.yearEnd,
          created_at: ts
        });
      });
      setLocalStorageData('compatibility', comps);

      const logs = getLocalStorageData<any[]>('logs', []);
      logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: 'PRODUCT_ADDED',
        details: `تكويد وإضافة قطعة جديدة: ${data.productName} (${data.origin}) باركود: ${data.barcode}`,
        created_at: ts
      });
      setLocalStorageData('logs', logs);

      const queue = getLocalStorageData<any[]>('syncQueue', []);
      queue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'products',
        operation: 'INSERT',
        record_id: variantId,
        data: JSON.stringify({ productName: data.productName, barcode: data.barcode }),
        status: 'pending',
        created_at: ts
      });
      setLocalStorageData('syncQueue', queue);

      return { success: true };
    }
  },

  async printReport(reportData: any): Promise<{ success: boolean }> {
    if (isElectron) {
      return (window as any).api.printReport(reportData);
    } else {
      console.log('SIMULATING PRINT REPORT IN BROWSER:', reportData);
      return { success: true };
    }
  },

  async openPrintLogsFolder(): Promise<boolean> {
    if (isElectron) {
      return (window as any).api.openPrintLogsFolder();
    }
    return false;
  },

  async saveUser(userData: any): Promise<{ success: boolean; error?: string }> {
    if (isElectron) {
      return (window as any).api.saveUser(userData);
    } else {
      const users = getLocalStorageData<any[]>('cashier_users', []);
      const idx = users.findIndex(u => u.id === userData.id);
      if (idx !== -1) {
        if (users[idx].username === 'admin' || users[idx].username === 'احمد مجدي') {
          return { success: false, error: 'Cannot modify primary Admin' };
        }
        users[idx] = { ...users[idx], ...userData };
      } else {
        users.push({ ...userData, created_at: new Date().toISOString() });
      }
      setLocalStorageData('cashier_users', users);
      return { success: true };
    }
  },

  async deleteUser(userId: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron) {
      return (window as any).api.deleteUser(userId);
    } else {
      const users = getLocalStorageData<any[]>('cashier_users', []);
      const matched = users.find(u => u.id === userId);
      if (matched && (matched.username === 'admin' || matched.username === 'احمد مجدي')) {
        return { success: false, error: 'Cannot delete primary Admin' };
      }
      const filtered = users.filter(u => u.id !== userId);
      setLocalStorageData('cashier_users', filtered);
      return { success: true };
    }
  },

  async getSystemPrinters(): Promise<any[]> {
    if (isElectron) {
      return (window as any).api.getSystemPrinters();
    }
    return [
      { name: 'طابعة تجريبية افتراضية 80مم' },
      { name: 'Xprinter XP-80C' },
      { name: 'Microsoft Print to PDF' }
    ];
  },

  async getDbBackupFile(): Promise<{ success: boolean; filename?: string; data?: Uint8Array; error?: string }> {
    if (isElectron) {
      return (window as any).api.getDbBackupFile();
    }
    return { success: false, error: 'Database file backup is only supported in Desktop client mode.' };
  },

  // Direct thermal barcode printing + PNG image save
  async printBarcodes(barcodeData: {
    labels: Array<{ name: string; origin: string; barcode: string; price?: number }>;
    labelWidthMm: number;
    labelHeightMm: number;
    storeName?: string;
    printerName?: string;
  }): Promise<{ success: boolean; previewFilename?: string }> {
    if (isElectron) {
      return (window as any).api.printBarcodes(barcodeData);
    }
    console.log('[Browser] Simulating barcode print:', barcodeData.labels.length, 'labels');
    return { success: true };
  },

  // Full DB snapshot — all tables — for complete cloud re-sync
  async getFullSnapshot(): Promise<{ success: boolean; data?: any; error?: string }> {
    if (isElectron) {
      return (window as any).api.getFullSnapshot();
    }
    return { success: false, error: 'Full snapshot only available in Electron mode.' };
  }
};
