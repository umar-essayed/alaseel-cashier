const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // DB query general-purpose (R/W)
  dbQuery: (sql, params) => ipcRenderer.invoke('db-query', sql, params),

  // Database domain operations
  getVariants: () => ipcRenderer.invoke('get-variants'),
  checkout: (saleData) => ipcRenderer.invoke('checkout', saleData),
  addProduct: (productData, userId, username) => ipcRenderer.invoke('add-product', { productData, userId, username }),
  printReport: (reportData) => ipcRenderer.invoke('print-report', reportData),
  addSupplierDebt: (supplierId, type, amount, notes, userId, username) => 
    ipcRenderer.invoke('add-supplier-debt', { supplierId, type, amount, notes, userId, username }),
  updateVariantStock: (variantId, quantity, userId, username, reason) => 
    ipcRenderer.invoke('update-variant-stock', { variantId, quantity, userId, username, reason }),
  editVariant: (variantData, userId, username) => 
    ipcRenderer.invoke('edit-variant', { variantData, userId, username }),
  refundSaleItem: (saleItemId, refundQty, cashierName) => 
    ipcRenderer.invoke('refund-sale-item', { saleItemId, refundQty, cashierName }),
  refundWholeSale: (saleId, cashierName) => 
    ipcRenderer.invoke('refund-whole-sale', { saleId, cashierName }),
  updateInvoiceDiscount: (saleId, newDiscount, cashierName) =>
    ipcRenderer.invoke('update-invoice-discount', { saleId, newDiscount, cashierName }),

  // Sync operations
  getSyncQueue: () => ipcRenderer.invoke('get-sync-queue'),
  markAsSynced: (queueIds) => ipcRenderer.invoke('mark-as-synced', queueIds),
  markAsFailed: (queueId, errorMsg) => ipcRenderer.invoke('mark-as-failed', { queueId, errorMsg }),

  // System settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getDbBackupFile: () => ipcRenderer.invoke('get-db-backup-file'),
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', { key, value }),
  saveUser: (userData) => ipcRenderer.invoke('save-user', userData),
  deleteUser: (userId) => ipcRenderer.invoke('delete-user', userId),

  // Log user operations
  logActivity: (userId, username, action, details) => 
    ipcRenderer.invoke('log-activity', { userId, username, action, details }),

  // Hardware POS Thermal Printer
  printReceipt: (receiptData) => ipcRenderer.invoke('print-receipt', receiptData),
  printBarcodes: (barcodeData) => ipcRenderer.invoke('print-barcodes', barcodeData),
  printRawTspl: (printerName, base64Tspl) => ipcRenderer.invoke('print-raw-tspl', { printerName, base64Tspl }),
  openPrintLogsFolder: () => ipcRenderer.invoke('open-print-logs-folder'),
  getSystemPrinters: () => ipcRenderer.invoke('get-system-printers'),

  // Full DB snapshot for complete cloud re-sync
  getFullSnapshot: () => ipcRenderer.invoke('get-full-snapshot'),

  // Barcode config file R/W
  getBarcodeConfig: () => ipcRenderer.invoke('get-barcode-config'),
  saveBarcodeConfig: (config) => ipcRenderer.invoke('save-barcode-config', config),

  // Credit Customers
  getCreditCustomers: () => ipcRenderer.invoke('get-credit-customers'),
  saveCreditCustomer: (data) => ipcRenderer.invoke('save-credit-customer', data),
  deleteCreditCustomer: (customerId) => ipcRenderer.invoke('delete-credit-customer', customerId),
  addCustomerPayment: (customerId, amount, notes, cashierName) =>
    ipcRenderer.invoke('add-customer-payment', { customerId, amount, notes, cashierName }),
  getCustomerDetails: (customerId) => ipcRenderer.invoke('get-customer-details', customerId),
  updateCustomerDebt: (customerId, additionalAmount) =>
    ipcRenderer.invoke('update-customer-debt', { customerId, additionalAmount }),

  // Refund Logs
  getRefundLogs: () => ipcRenderer.invoke('get-refund-logs'),

  // Product & Variant Deletion
  deleteProduct: (productId) => ipcRenderer.invoke('delete-product', productId),
  deleteVariant: (variantId) => ipcRenderer.invoke('delete-variant', variantId),

  // Supplier Deletion
  deleteSupplier: (supplierId) => ipcRenderer.invoke('delete-supplier', supplierId),

  // DB Backup & Reset
  resetAllInvoices: (cashierName) => ipcRenderer.invoke('reset-all-invoices', cashierName),
  downloadDbBackup: () => ipcRenderer.invoke('download-db-backup'),

  // Listen for barcode scan events (if main process hooks it, optional)
  onBarcodeScanned: (callback) => {
    const listener = (event, barcode) => callback(barcode);
    ipcRenderer.on('barcode-scanned', listener);
    return () => ipcRenderer.removeListener('barcode-scanned', listener);
  }
});
