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
  deleteVariant: (variantId, userId, username) => 
    ipcRenderer.invoke('delete-variant', { variantId, userId, username }),
  deleteSupplier: (supplierId, userId, username) => 
    ipcRenderer.invoke('delete-supplier', { supplierId, userId, username }),
  deleteSale: (saleId, userId, username) => 
    ipcRenderer.invoke('delete-sale', { saleId, userId, username }),
  updateSaleDiscount: (saleId, newDiscount, userId, username, reason) => 
    ipcRenderer.invoke('update-sale-discount', { saleId, newDiscount, userId, username, reason }),
  resetAllInvoicesAndAccounts: (userId, username) => 
    ipcRenderer.invoke('reset-all-invoices-and-accounts', { userId, username }),

  // Log user operations
  logActivity: (userId, username, action, details) => 
    ipcRenderer.invoke('log-activity', { userId, username, action, details }),

  // Hardware POS Thermal Printer
  printReceipt: (receiptData) => ipcRenderer.invoke('print-receipt', receiptData),
  printBarcodes: (barcodeData) => ipcRenderer.invoke('print-barcodes', barcodeData),
  openPrintLogsFolder: () => ipcRenderer.invoke('open-print-logs-folder'),
  getSystemPrinters: () => ipcRenderer.invoke('get-system-printers'),

  // Full DB snapshot for complete cloud re-sync
  getFullSnapshot: () => ipcRenderer.invoke('get-full-snapshot'),

  // Barcode config file R/W
  getBarcodeConfig: () => ipcRenderer.invoke('get-barcode-config'),
  saveBarcodeConfig: (config) => ipcRenderer.invoke('save-barcode-config', config),

  // Listen for barcode scan events (if main process hooks it, optional)
  onBarcodeScanned: (callback) => {
    const listener = (event, barcode) => callback(barcode);
    ipcRenderer.on('barcode-scanned', listener);
    return () => ipcRenderer.removeListener('barcode-scanned', listener);
  }
});
