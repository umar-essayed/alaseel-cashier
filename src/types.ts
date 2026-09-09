export interface Product {
  id: string;
  name: string;
  category: string;
  min_limit_general: number;
  created_at: string;
}

export interface Compatibility {
  car_make: string;
  car_model: string;
  year_start: number;
  year_end: number;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  origin: string;
  specification: string;
  cost_price: number;
  selling_price: number;
  stock_quantity: number;
  min_limit: number; // S_min
  sku_barcode: string;
  created_at: string;
  // Joins
  product_name?: string;
  category?: string;
  compatibility?: Compatibility[];
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  current_debt: number;
  created_at: string;
}

export interface SupplierDebtTransaction {
  id: string;
  supplier_id: string;
  transaction_type: 'PURCHASE_DEBT' | 'PAYMENT' | 'SETTLEMENT';
  amount: number;
  previous_debt: number;
  new_debt: number;
  notes: string;
  created_at: string;
}

export interface SyncQueueItem {
  id: string;
  table_name: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  record_id: string;
  data: string; // JSON string
  status: 'pending' | 'synced' | 'failed';
  error_message?: string;
  created_at: string;
}

export interface SaleItem {
  variant_id: string;
  name: string; // join info
  origin: string; // join info
  quantity: number;
  unit_price: number;
  cost_price: number;
  total_price: number;
}

export interface Sale {
  id: string;
  invoice_number: string;
  cashier_id: string;
  cashier_name: string;
  customer_name: string;
  total_amount: number;
  discount: number;
  final_amount: number;
  payment_method: 'CASH' | 'CARD' | 'DEBT';
  items: SaleItem[];
}

export interface ActivityLog {
  id: string;
  user_id: string;
  username: string;
  action: string;
  details: string;
  created_at: string;
}

export interface StoreSettings {
  store_name?: string;
  store_phone?: string;
  store_logo?: string;
  invoice_header?: string;
  invoice_footer?: string;
}

export interface CashierUser {
  id: string;
  username: string;
  role: 'ADMIN' | 'CASHIER';
}

declare global {
  interface Window {
    api: {
      dbQuery: (sql: string, params?: unknown[]) => Promise<any>;
      getVariants: () => Promise<ProductVariant[]>;
      checkout: (saleData: Sale) => Promise<{ success: boolean; invoice_number: string }>;
      addSupplierDebt: (
        supplierId: string,
        type: 'PURCHASE_DEBT' | 'PAYMENT' | 'SETTLEMENT',
        amount: number,
        notes: string,
        userId: string,
        username: string
      ) => Promise<{ success: boolean; newDebt: number }>;
      updateVariantStock: (
        variantId: string,
        quantity: number,
        userId: string,
        username: string,
        reason: string
      ) => Promise<{ success: boolean }>;
      editVariant: (
        variantData: Partial<ProductVariant>,
        userId: string,
        username: string
      ) => Promise<{ success: boolean }>;
      deleteVariant: (variantId: string, userId: string, username: string) => Promise<{ success: boolean }>;
      deleteSupplier: (supplierId: string, userId: string, username: string) => Promise<{ success: boolean }>;
      deleteSale: (saleId: string, userId: string, username: string) => Promise<{ success: boolean }>;
      updateSaleDiscount: (
        saleId: string,
        newDiscount: number,
        userId: string,
        username: string,
        reason?: string
      ) => Promise<{ success: boolean; newDiscount: number; newFinalAmount: number }>;
      resetAllInvoicesAndAccounts: (userId: string, username: string) => Promise<{ success: boolean }>;
      getSyncQueue: () => Promise<SyncQueueItem[]>;
      markAsSynced: (queueIds: string[]) => Promise<boolean>;
      markAsFailed: (queueId: string, errorMsg: string) => Promise<boolean>;
      getSettings: () => Promise<Record<string, string>>;
      saveSetting: (key: string, value: string) => Promise<boolean>;
      logActivity: (userId: string, username: string, action: string, details: string) => Promise<boolean>;
      printReceipt: (receiptData: {
        storeName: string;
        phone: string;
        invoiceNumber: string;
        cashierName: string;
        customerName: string;
        items: Array<{ name: string; origin: string; qty: number; price: number; total: number }>;
        totalAmount: number;
        discount: number;
        finalAmount: number;
        paymentMethod: string;
        headerMsg: string;
        footerMsg: string;
        qrCodeData?: string;
      }) => Promise<{ success: boolean; error?: string; simulatedReceipt?: any }>;
      onBarcodeScanned: (callback: (barcode: string) => void) => () => void;
    };
  }
}
