const { app, BrowserWindow, ipcMain, shell, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { initDb, handlers } = require('./db');
const { PosPrinter } = require('electron-pos-printer');

let printServerProc = null;

// No-op since we now use native PowerShell direct raw printing (no Python dependency)
function startPrintServer() {
  console.log('[Print Server] Using native PowerShell spooler engine (no Python server required).');
}

// Helper to write raw bytes to a named Windows printer via native PowerShell script
function printRawBufferViaPowershell(resolvedPrinter, buffer) {
  return new Promise((resolve, reject) => {
    try {
      const tempFilePath = path.join(app.getPath('temp'), `print_job_${Date.now()}_${Math.floor(Math.random() * 1000)}.bin`);
      fs.writeFileSync(tempFilePath, buffer);

      const scriptPath = app.isPackaged
        ? path.join(process.resourcesPath, 'print_raw.ps1')
        : path.join(__dirname, '../print_raw.ps1');

      const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        '-PrinterName', resolvedPrinter,
        '-FilePath', tempFilePath
      ]);

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', (data) => stdout += data.toString());
      ps.stderr.on('data', (data) => stderr += data.toString());

      ps.on('close', (code) => {
        if (code === 0 && stdout.includes('Success')) {
          resolve({ success: true });
        } else {
          const errorMsg = stderr || stdout || `Powershell process exited with code ${code}`;
          reject(new Error(errorMsg));
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Helper to render HTML to raw monochrome bitmap and send to Windows Spooler via PowerShell
async function printRawImageViaPowershell(htmlContent, type, printerName, widthMm, heightMm, widthPx, heightPx) {
  return new Promise((resolve, reject) => {
    let offscreenWindow = new BrowserWindow({
      width: widthPx,
      height: heightPx || 800,
      show: false,
      focusable: false,
      webPreferences: {
        offscreen: true
      }
    });

    const base64Html = Buffer.from(htmlContent).toString('base64');
    offscreenWindow.loadURL(`data:text/html;charset=utf-8;base64,${base64Html}`);

    offscreenWindow.webContents.once('did-finish-load', async () => {
      try {
        let finalHeight = heightPx;
        if (!finalHeight) {
          // If height is not fixed (like dynamic receipts), read scrollHeight
          const scrollHeight = await offscreenWindow.webContents.executeJavaScript('document.body.scrollHeight');
          finalHeight = scrollHeight + 15;
          offscreenWindow.setBounds({ x: 0, y: 0, width: widthPx, height: finalHeight });
          // Wait short delay for reflow
          await new Promise(r => setTimeout(r, 150));
        }

        const image = await offscreenWindow.webContents.capturePage();
        const rgba = image.getBitmap();
        const size = image.getSize();
        const w = size.width;
        const h = size.height;

        const widthBytes = Math.ceil(w / 8);
        const packed = Buffer.alloc(widthBytes * h, 255); // Initialize to 0xFF (all white / no ink)

        // Convert RGBA to 1-bit black/white
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const r = rgba[idx + 2];
            const g = rgba[idx + 1];
            const b = rgba[idx + 0];
            const a = rgba[idx + 3];

            // Threshold: pixels with alpha < 50 are considered white
            const isBlack = (a < 50) ? false : ((0.299 * r + 0.587 * g + 0.114 * b) < 180);

            if (isBlack) {
              const byteIdx = y * widthBytes + Math.floor(x / 8);
              const bitIdx = x % 8;
              packed[byteIdx] &= ~(1 << (7 - bitIdx)); // Clear the bit to 0 (black ink)
            }
          }
        }

        // Construct raw printer buffer depending on type
        let payload;
        if (type === 'escpos') {
          const xL = widthBytes % 256;
          const xH = Math.floor(widthBytes / 256);
          const yL = h % 256;
          const yH = Math.floor(h / 256);

          const header = Buffer.from([29, 118, 48, 0, xL, xH, yL, yH]);
          const cut = Buffer.from([29, 86, 66, 0]);
          payload = Buffer.concat([header, packed, cut]);
        } else if (type === 'tspl') {
          const header = Buffer.from(`SIZE ${widthMm} mm, ${heightMm} mm\r\nGAP 2 mm, 0 mm\r\nDIRECTION 1\r\nCLS\r\nBITMAP 0,0,${widthBytes},${h},0,`);
          const footer = Buffer.from(`\r\nPRINT 1,1\r\n`);
          payload = Buffer.concat([header, packed, footer]);
        } else {
          payload = packed;
        }

        // Resolve printer name
        let resolvedPrinter = printerName;
        if (!resolvedPrinter) {
          resolvedPrinter = await autoDetectLabelPrinter();
        }

        const printResult = await printRawBufferViaPowershell(resolvedPrinter, payload);
        resolve(printResult);

      } catch (err) {
        reject(err);
      } finally {
        if (offscreenWindow && !offscreenWindow.isDestroyed()) {
          offscreenWindow.destroy();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.focus();
        }
      }
    });
  });
}

// Use userData directory for writable storage (works both in dev and packaged .asar builds)
const getPrintLogsDir = () => {
  const dir = path.join(app.getPath('userData'), 'print_logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};
// Initialize lazily after app is ready
let printLogsDir = null;

let mainWindow;

function createWindow() {
  // Robust icon path resolution with multiple fallbacks
  let iconPath = path.join(__dirname, '../logo.png');
  if (!fs.existsSync(iconPath)) {
    iconPath = path.join(process.resourcesPath, 'logo.png');
  }
  if (!fs.existsSync(iconPath) && app.isPackaged) {
    iconPath = path.join(process.resourcesPath, 'app/logo.png');
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'نظام الكاشير والمخازن لقطع غيار السيارات',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true
  });

  // Check if we are in development mode
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  if (isDev) {
    // Load Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Load production built index.html
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize database when app starts
app.whenReady().then(() => {
  // Initialize printLogsDir after app is ready (so app.getPath works)
  printLogsDir = getPrintLogsDir();
  initDb();
  startPrintServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (printServerProc) {
    printServerProc.kill();
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (printServerProc) {
    printServerProc.kill();
  }
});

// Configure IPC Handlers for database queries
ipcMain.handle('db-query', async (event, sql, params) => {
  return handlers.query(sql, params);
});

ipcMain.handle('get-variants', async () => {
  return handlers.getVariantsWithProductDetails();
});

ipcMain.handle('checkout', async (event, saleData) => {
  return handlers.checkout(saleData);
});

ipcMain.handle('refund-sale-item', async (event, data) => {
  const { saleItemId, refundQty, cashierName } = data;
  return handlers.refundSaleItem(saleItemId, refundQty, cashierName);
});

ipcMain.handle('refund-whole-sale', async (event, data) => {
  const { saleId, cashierName } = data;
  return handlers.refundWholeSale(saleId, cashierName);
});

ipcMain.handle('update-invoice-discount', async (event, data) => {
  const { saleId, newDiscount, cashierName } = data;
  return handlers.updateInvoiceDiscount(saleId, newDiscount, cashierName);
});

ipcMain.handle('add-supplier-debt', async (event, data) => {
  const { supplierId, type, amount, notes, userId, username } = data;
  return handlers.addSupplierDebtTransaction(supplierId, type, amount, notes, userId, username);
});

ipcMain.handle('update-variant-stock', async (event, data) => {
  const { variantId, quantity, userId, username, reason } = data;
  return handlers.updateVariantStock(variantId, quantity, userId, username, reason);
});

ipcMain.handle('edit-variant', async (event, data) => {
  const { variantData, userId, username } = data;
  return handlers.editVariant(variantData, userId, username);
});

ipcMain.handle('add-product', async (event, data) => {
  const { productData, userId, username } = data;
  return handlers.addProduct(productData, userId, username);
});

// Credit Customers
ipcMain.handle('get-credit-customers', async () => {
  return handlers.getCreditCustomers();
});
ipcMain.handle('save-credit-customer', async (event, data) => {
  return handlers.saveCreditCustomer(data);
});
ipcMain.handle('delete-credit-customer', async (event, customerId) => {
  return handlers.deleteCreditCustomer(customerId);
});
ipcMain.handle('add-customer-payment', async (event, data) => {
  const { customerId, amount, notes, cashierName } = data;
  return handlers.addCustomerPayment(customerId, amount, notes, cashierName);
});
ipcMain.handle('get-customer-details', async (event, customerId) => {
  return handlers.getCustomerDetails(customerId);
});
ipcMain.handle('update-customer-debt', async (event, data) => {
  const { customerId, additionalAmount } = data;
  return handlers.updateCustomerDebt(customerId, additionalAmount);
});
ipcMain.handle('get-refund-logs', async () => {
  return handlers.getRefundLogs();
});

// Delete Product & Variant
ipcMain.handle('delete-product', async (event, productId) => {
  return handlers.deleteProduct(productId);
});
ipcMain.handle('delete-variant', async (event, variantId) => {
  return handlers.deleteVariant(variantId);
});

// Delete Supplier
ipcMain.handle('delete-supplier', async (event, supplierId) => {
  return handlers.deleteSupplier(supplierId);
});

// Reset Database (with automatic backup to Desktop first)
ipcMain.handle('reset-all-invoices', async (event, cashierName) => {
  try {
    const desktopDir = app.getPath('desktop');
    const dbModule = require('./db');
    const isFallback = dbModule.isFallback;
    const ext = isFallback ? 'json' : 'sqlite';
    const backupFilename = `الأصيل_نسخة_تلقائية_قبل_التصفير_${Date.now()}.${ext}`;
    const autoSavePath = path.join(desktopDir, backupFilename);
    
    // Copy current DB to Desktop for safety
    const activePath = isFallback ? path.join(path.dirname(dbModule.dbPath), 'fallback_db.json') : dbModule.dbPath;
    if (fs.existsSync(activePath)) {
      fs.copyFileSync(activePath, autoSavePath);
    }
    
    // Perform database reset
    const result = handlers.resetAllInvoices(cashierName);
    return { success: true, savedPath: autoSavePath };
  } catch (err) {
    console.error('Reset database failed:', err);
    return { success: false, error: err.message };
  }
});

// Download full backup manually
ipcMain.handle('download-db-backup', async () => {
  try {
    const dbModule = require('./db');
    const isFallback = dbModule.isFallback;
    const dbPath = dbModule.dbPath;
    const activePath = isFallback ? path.join(path.dirname(dbPath), 'fallback_db.json') : dbPath;
    
    if (!fs.existsSync(activePath)) {
      return { success: false, error: 'Database file not found on disk.' };
    }
    
    const defaultFilename = isFallback ? `fallback_db_backup_${Date.now()}.json` : `database_backup_${Date.now()}.sqlite`;
    
    const result = dialog.showSaveDialogSync(mainWindow, {
      title: 'حفظ نسخة احتياطية من قاعدة البيانات',
      defaultPath: path.join(app.getPath('downloads'), defaultFilename),
      filters: [
        { name: isFallback ? 'JSON Database' : 'SQLite Database', extensions: [isFallback ? 'json' : 'sqlite'] }
      ]
    });
    
    if (!result) return { success: false, error: 'CANCELED' };
    
    fs.copyFileSync(activePath, result);
    return { success: true, savedPath: result };
  } catch (e) {
    console.error('Failed to export backup:', e);
    return { success: false, error: e.message || 'Unknown export error.' };
  }
});


ipcMain.handle('open-print-logs-folder', async () => {
  try {
    shell.openPath(printLogsDir);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
});

ipcMain.handle('save-user', async (event, userData) => {
  return handlers.saveUser(userData);
});

ipcMain.handle('delete-user', async (event, userId) => {
  return handlers.deleteUser(userId);
});

ipcMain.handle('get-system-printers', async () => {
  try {
    if (!mainWindow) return [];
    return await mainWindow.webContents.getPrintersAsync();
  } catch (e) {
    console.error('Failed to query system printers:', e);
    return [];
  }
});

// Settings & Logs handlers
ipcMain.handle('get-settings', async () => {
  return handlers.getSettings();
});

ipcMain.handle('save-setting', async (event, data) => {
  return handlers.saveSetting(data.key, data.value);
});

ipcMain.handle('log-activity', async (event, data) => {
  return handlers.logActivity(data.userId, data.username, data.action, data.details);
});

ipcMain.handle('get-sync-queue', async () => {
  return handlers.getSyncQueue();
});

ipcMain.handle('mark-as-synced', async (event, queueIds) => {
  return handlers.markAsSynced(queueIds);
});

ipcMain.handle('mark-as-failed', async (event, data) => {
  return handlers.markAsFailed(data.queueId, data.errorMsg);
});

ipcMain.handle('get-db-backup-file', async () => {
  try {
    const dbModule = require('./db');
    const fs = require('fs');
    const path = require('path');

    const isFallback = dbModule.isFallback;
    const dbPath = dbModule.dbPath;

    const activePath = isFallback ? path.join(path.dirname(dbPath), 'fallback_db.json') : dbPath;
    if (fs.existsSync(activePath)) {
      const buffer = fs.readFileSync(activePath);
      return {
        success: true,
        filename: isFallback ? `fallback_db_${Date.now()}.json` : `database_${Date.now()}.sqlite`,
        data: new Uint8Array(buffer)
      };
    }
    return { success: false, error: 'Database file not found on disk.' };
  } catch (e) {
    console.error('Failed to read database file for backup:', e);
    return { success: false, error: e.message || 'Unknown read error.' };
  }
});

// Offscreen browser screenshot helper to save thermal print replicas as PNG images
async function savePrintReplicaAsImage(htmlContent, filename) {
  return new Promise((resolve) => {
    let offscreenWindow = new BrowserWindow({
      width: 320,
      height: 800,
      show: false,
      focusable: false, // Ensure background window never steals focus from the parent
      webPreferences: {
        offscreen: true
      }
    });

    const base64Html = Buffer.from(htmlContent).toString('base64');
    offscreenWindow.loadURL(`data:text/html;charset=utf-8;base64,${base64Html}`);

    offscreenWindow.webContents.once('did-finish-load', async () => {
      try {
        // Query content scrollHeight
        const height = await offscreenWindow.webContents.executeJavaScript('document.body.scrollHeight');
        
        // Resize window to capture full height
        offscreenWindow.setBounds({ x: 0, y: 0, width: 320, height: height + 30 });

        // Wait short delay for render reflow
        await new Promise(r => setTimeout(r, 250));

        // Capture page as NativeImage
        const image = await offscreenWindow.webContents.capturePage();
        const pngBuffer = image.toPNG();

        const destPath = path.join(printLogsDir, filename);
        fs.writeFileSync(destPath, pngBuffer);
        console.log(`Saved screenshot image replica to print_logs: ${filename}`);
      } catch (err) {
        console.error('Error capturing page replica as image:', err);
      } finally {
        if (offscreenWindow && !offscreenWindow.isDestroyed()) {
          offscreenWindow.destroy();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.focus();
        }
        resolve();
      }
    });
  });
}

// Hardware Thermal Print Handler using electron-pos-printer
ipcMain.handle('print-receipt', async (event, receiptData) => {
  const printData = [
    {
      type: 'text',
      value: receiptData.storeName,
      style: { fontWeight: "800", textAlign: 'center', fontSize: '22px', fontFamily: 'Cairo, sans-serif', marginBottom: '4px' }
    },
    {
      type: 'text',
      value: `الهاتف: ${receiptData.phone}`,
      style: { textAlign: 'center', fontSize: '13px', fontFamily: 'Cairo, sans-serif', marginBottom: '8px' }
    },
    {
      type: 'text',
      value: receiptData.headerMsg || '',
      style: { textAlign: 'center', fontSize: '11px', fontFamily: 'Cairo, sans-serif', color: '#333', marginBottom: '8px' }
    },
    {
      type: 'text',
      value: '----------------------------------------------',
      style: { textAlign: 'center', fontSize: '11px' }
    },
    {
      type: 'text',
      value: `الفاتورة: ${receiptData.invoiceNumber}\nالتاريخ: ${new Date().toLocaleString('ar-EG')}\nالكاشير: ${receiptData.cashierName}\nالعميل: ${receiptData.customerName || 'عميل نقدي'}`,
      style: { textAlign: 'right', fontSize: '12px', fontFamily: 'Cairo, sans-serif', lineHeight: '18px', marginBottom: '8px' }
    },
    {
      type: 'text',
      value: '----------------------------------------------',
      style: { textAlign: 'center', fontSize: '11px' }
    }
  ];

  // Map items to table format (80mm width layout)
  const tableHeader = ['الأصناف والمنشأ', 'العدد', 'السعر', 'الإجمالي'];
  const tableBody = receiptData.items.map(item => [
    `${item.name}\n(${item.origin})`,
    `${item.qty}`,
    `${item.price.toFixed(0)}`,
    `${item.total.toFixed(0)}`
  ]);

  printData.push({
    type: 'table',
    tableHeader: tableHeader,
    tableBody: tableBody,
    tableFooter: ['', '', 'الإجمالي:', `${receiptData.totalAmount.toFixed(0)} ج.م`],
    style: { 
      fontSize: '11px', 
      fontFamily: 'Cairo, sans-serif',
      border: '0px',
      marginBottom: '8px'
    }
  });

  if (receiptData.discount > 0) {
    printData.push({
      type: 'text',
      value: `الخصم: -${receiptData.discount.toFixed(0)} ج.م`,
      style: { textAlign: 'left', fontSize: '12px', fontWeight: '700', fontFamily: 'Cairo, sans-serif' }
    });
  }

  printData.push({
    type: 'text',
    value: `المجموع الصافي: ${receiptData.finalAmount.toFixed(0)} ج.م`,
    style: { textAlign: 'left', fontSize: '15px', fontWeight: '800', fontFamily: 'Cairo, sans-serif', marginBottom: '8px' }
  });

  printData.push({
    type: 'text',
    value: `طريقة الدفع: ${
      receiptData.paymentMethod === 'CASH' ? 'نقدي' : receiptData.paymentMethod === 'CARD' ? 'فيزا/شبكة' : 'أجل'
    }`,
    style: { textAlign: 'right', fontSize: '12px', fontFamily: 'Cairo, sans-serif', marginBottom: '8px' }
  });

  printData.push({
    type: 'text',
    value: '----------------------------------------------',
    style: { textAlign: 'center', fontSize: '11px' }
  });

  // Embed QR Code for Returns / Verification
  printData.push({
    type: 'qrCode',
    value: receiptData.qrCodeData || receiptData.invoiceNumber,
    width: 110,
    height: 110,
    position: 'center',
    style: { marginBottom: '8px' }
  });

  printData.push({
    type: 'text',
    value: receiptData.footerMsg || '',
    style: { textAlign: 'center', fontSize: '11px', fontFamily: 'Cairo, sans-serif', color: '#333', marginTop: '6px' }
  });

  let printerName = '';
  let paperWidth = '80mm';
  try {
    const settings = await handlers.getSettings();
    printerName = settings.selected_printer_name || '';
    paperWidth = settings.receipt_paper_width || '80mm';
  } catch (err) {
    console.error('Failed to get printer setting:', err);
  }

  let logoBase64 = '';
  try {
    const logoPath = path.join(__dirname, '../logo-without-bg.png');
    if (fs.existsSync(logoPath)) {
      logoBase64 = fs.readFileSync(logoPath, 'base64');
    }
  } catch (err) {
    console.error('Failed to read logo base64:', err);
  }

  // Generate HTML log replica
  const htmlContent = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
  <title>فاتورة رقم ${receiptData.invoiceNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 100%;
      margin: 0;
      padding: 6px;
      font-family: 'Cairo', Arial, sans-serif;
      color: #000;
      background: #fff;
      font-size: 13px;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .bold { font-weight: bold; }
    .title { font-size: 20px; font-weight: 900; margin-bottom: 5px; }
    .subtitle { font-size: 12px; margin-bottom: 6px; }
    .divider { border-top: 1px dashed #000; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 5px 0; vertical-align: top; }
    th { border-bottom: 1px solid #000; }
    .footer { font-size: 12px; margin-top: 15px; color: #333; }
  </style>
</head>
<body>
  ${logoBase64 ? `<div class="text-center" style="margin-bottom: 8px;"><img src="data:image/png;base64,${logoBase64}" style="max-height: 60px; object-fit: contain;" /></div>` : ''}
  <div class="text-center">
    <div class="title">${receiptData.storeName}</div>
    <div class="subtitle">الهاتف: ${receiptData.phone}</div>
    <div class="subtitle">${receiptData.headerMsg || ''}</div>
  </div>
  <div class="divider"></div>
  <div class="text-right" style="line-height: 1.5;">
    <div><b>رقم الفاتورة:</b> ${receiptData.invoiceNumber}</div>
    <div><b>التاريخ:</b> ${new Date().toLocaleString('ar-EG')}</div>
    <div><b>الكاشير:</b> ${receiptData.cashierName}</div>
    <div><b>العميل:</b> ${receiptData.customerName || 'عميل نقدي'}</div>
  </div>
  <div class="divider"></div>
  <table>
    <thead>
      <tr>
        <th class="text-right">الأصناف والمنشأ</th>
        <th class="text-center" style="width: 30px;">ق</th>
        <th class="text-left" style="width: 50px;">سعر</th>
        <th class="text-left" style="width: 55px;">إجمالي</th>
      </tr>
    </thead>
    <tbody>
      ${receiptData.items.map(item => `
        <tr>
          <td class="text-right">${item.name}<br><small style="color:#555;">(${item.origin})</small></td>
          <td class="text-center">${item.qty}</td>
          <td class="text-left">${item.price.toFixed(0)}</td>
          <td class="text-left">${item.total.toFixed(0)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div class="divider"></div>
  <div style="line-height: 1.5;">
    <div style="display: flex; justify-content: space-between;">
      <span>الإجمالي:</span>
      <span>${receiptData.totalAmount.toFixed(0)} ج.م</span>
    </div>
    ${receiptData.discount > 0 ? `
    <div style="display: flex; justify-content: space-between; color: #ff0000;">
      <span>الخصم:</span>
      <span>-${receiptData.discount.toFixed(0)} ج.م</span>
    </div>` : ''}
    <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 15px; margin-top: 5px;">
      <span>المجموع الصافي:</span>
      <span>${receiptData.finalAmount.toFixed(0)} ج.م</span>
    </div>
  </div>
  <div class="divider"></div>
  <div class="text-right">
    <b>طريقة الدفع:</b> ${receiptData.paymentMethod === 'CASH' ? 'نقدي' : receiptData.paymentMethod === 'CARD' ? 'فيزا/شبكة' : 'أجل'}
  </div>
  <div class="text-center" style="margin-top: 15px;">
    <div style="display:inline-block; border:1px solid #000; padding:10px; font-family:monospace; font-size:8px; background:#eee;">
      [رمز QR للفاتورة]<br>${receiptData.qrCodeData || receiptData.invoiceNumber}
    </div>
  </div>
  <div class="text-center footer">
    ${receiptData.footerMsg || ''}
  </div>
</body>
</html>`;

  // Capture offscreen PNG image simulation replica instead of HTML file
  savePrintReplicaAsImage(htmlContent, `invoice_${receiptData.invoiceNumber}.png`);

  // Direct print via native PowerShell direct print engine
  const widthPx = paperWidth === '58mm' ? 384 : 576;
  const widthMm = paperWidth === '58mm' ? 58 : 80;
  
  printRawImageViaPowershell(htmlContent, 'escpos', printerName, widthMm, 0, widthPx, 0)
    .then(() => console.log('PowerShell ESC/POS print job sent.'))
    .catch((err) => console.error('PowerShell ESC/POS print failed:', err));

  return { success: true };
});

// Periodic Report Printer
ipcMain.handle('print-report', async (event, reportData) => {
  const { fromDate, toDate, totalInvoices, totalRevenue, totalDiscounts, totalCost, totalProfit, invoices, itemSummaries } = reportData;

  const printData = [
    {
      type: 'text',
      value: 'تقرير المبيعات والنشاط المالي',
      style: { fontWeight: "800", textAlign: 'center', fontSize: '18px', fontFamily: 'Cairo, sans-serif', marginBottom: '4px' }
    },
    {
      type: 'text',
      value: `الفترة من: ${fromDate} إلى: ${toDate}`,
      style: { textAlign: 'center', fontSize: '12px', fontFamily: 'Cairo, sans-serif', marginBottom: '8px' }
    },
    {
      type: 'text',
      value: '----------------------------------------------',
      style: { textAlign: 'center', fontSize: '11px' }
    },
    {
      type: 'text',
      value: `عدد الفواتير المصدرة: ${totalInvoices} فواتير\nإجمالي المبيعات: ${totalRevenue.toFixed(0)} ج.م\nإجمالي الخصومات: ${totalDiscounts.toFixed(0)} ج.م\nتكلفة البضاعة: ${totalCost.toFixed(0)} ج.م`,
      style: { textAlign: 'right', fontSize: '12px', fontFamily: 'Cairo, sans-serif', lineHeight: '18px', marginBottom: '6px' }
    },
    {
      type: 'text',
      value: `صافي الأرباح المحققة: ${totalProfit.toFixed(0)} ج.م`,
      style: { textAlign: 'right', fontSize: '14px', fontWeight: '800', fontFamily: 'Cairo, sans-serif', color: 'green', marginBottom: '8px' }
    },
    {
      type: 'text',
      value: '----------------------------------------------',
      style: { textAlign: 'center', fontSize: '11px' }
    },
    {
      type: 'text',
      value: 'سجل الفواتير التفصيلي',
      style: { textAlign: 'center', fontWeight: '750', fontSize: '12px', fontFamily: 'Cairo, sans-serif', marginBottom: '6px' }
    }
  ];

  const invHeaders = ['رقم الفاتورة', 'العميل', 'المبلغ الصافي'];
  const invBody = invoices.map(i => [
    i.invoice_number,
    i.customer_name || 'نقدي',
    `${i.final_amount.toFixed(0)} ج.م`
  ]);
  printData.push({
    type: 'table',
    tableHeader: invHeaders,
    tableBody: invBody,
    style: { fontSize: '10px', fontFamily: 'Cairo, sans-serif', marginBottom: '8px' }
  });

  printData.push({
    type: 'text',
    value: '----------------------------------------------',
    style: { textAlign: 'center', fontSize: '11px' }
  });

  printData.push({
    type: 'text',
    value: 'مبيعات الأصناف الأكثر طلباً',
    style: { textAlign: 'center', fontWeight: '750', fontSize: '12px', fontFamily: 'Cairo, sans-serif', marginBottom: '6px' }
  });

  const itemBody = itemSummaries.map(item => [
    `${item.name}\n(${item.origin})`,
    `${item.qty}`,
    `${item.totalValue.toFixed(0)} ج.م`
  ]);
  printData.push({
    type: 'table',
    tableHeader: ['الصنف (المنشأ)', 'الكمية', 'الإجمالي'],
    tableBody: itemBody,
    style: { fontSize: '10px', fontFamily: 'Cairo, sans-serif', marginBottom: '8px' }
  });

  printData.push({
    type: 'text',
    value: '----------------------------------------------',
    style: { textAlign: 'center', fontSize: '11px' }
  });

  printData.push({
    type: 'text',
    value: `تم تصدير وحفظ التقرير بنجاح\nتاريخ الحفظ: ${new Date().toLocaleString('ar-EG')}`,
    style: { textAlign: 'center', fontSize: '10px', fontFamily: 'Cairo, sans-serif', color: '#333' }
  });

  let printerName = '';
  try {
    const settings = await handlers.getSettings();
    printerName = settings.selected_printer_name || '';
  } catch (err) {
    console.error('Failed to get printer setting:', err);
  }

  let logoBase64 = '';
  try {
    const logoPath = path.join(__dirname, '../logo-without-bg.png');
    if (fs.existsSync(logoPath)) {
      logoBase64 = fs.readFileSync(logoPath, 'base64');
    }
  } catch (err) {
    console.error('Failed to read logo base64:', err);
  }

  // Generate HTML for png screenshot capture
  const htmlContent = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
  <title>تقرير مبيعات الفترة من ${fromDate} إلى ${toDate}</title>
  <style>
    body {
      width: 290px;
      margin: 0;
      padding: 10px;
      font-family: 'Cairo', system-ui, -apple-system, sans-serif;
      color: #000;
      background: #fff;
      font-size: 11px;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .bold { font-weight: bold; }
    .title { font-size: 16px; font-weight: 900; margin-bottom: 5px; }
    .subtitle { font-size: 11px; margin-bottom: 8px; }
    .divider { border-top: 1px dashed #000; margin: 10px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td { padding: 4px 0; vertical-align: top; }
    th { border-bottom: 1px solid #000; }
  </style>
</head>
<body>
  ${logoBase64 ? `<div class="text-center" style="margin-bottom: 8px;"><img src="data:image/png;base64,${logoBase64}" style="max-height: 55px; object-fit: contain;" /></div>` : ''}
  <div class="text-center">
    <div class="title">تقرير المبيعات والنشاط المالي</div>
    <div class="subtitle">الفترة من: ${fromDate}<br>إلى تاريخ: ${toDate}</div>
  </div>
  <div class="divider"></div>
  <div style="line-height: 1.5;">
    <div><b>عدد الفواتير المصدرة:</b> ${totalInvoices} فواتير</div>
    <div><b>إجمالي المبيعات:</b> ${totalRevenue.toFixed(0)} ج.م</div>
    <div><b>إجمالي الخصومات:</b> ${totalDiscounts.toFixed(0)} ج.م</div>
    <div><b>تكلفة البضاعة:</b> ${totalCost.toFixed(0)} ج.م</div>
    <div style="font-size:12px; font-weight:bold; color:green; margin-top:3px;"><b>صافي الأرباح المحققة:</b> ${totalProfit.toFixed(0)} ج.م</div>
  </div>
  <div class="divider"></div>
  <div class="text-center bold" style="margin-bottom:5px;">سجل الفواتير التفصيلي</div>
  <table>
    <thead>
      <tr>
        <th class="text-right">رقم الفاتورة</th>
        <th class="text-center">العميل</th>
        <th class="text-left">الصافي</th>
      </tr>
    </thead>
    <tbody>
      ${invoices.map(i => `
        <tr>
          <td class="text-right">${i.invoice_number}</td>
          <td class="text-center">${i.customer_name || 'نقدي'}</td>
          <td class="text-left">${i.final_amount.toFixed(0)} ج.م</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div class="divider"></div>
  <div class="text-center bold" style="margin-bottom:5px;">مبيعات الأصناف الأكثر طلباً</div>
  <table>
    <thead>
      <tr>
        <th class="text-right">الصنف (المنشأ)</th>
        <th class="text-center" style="width: 40px;">الكمية</th>
        <th class="text-left" style="width: 60px;">الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      ${itemSummaries.map(item => `
        <tr>
          <td class="text-right">${item.name} (${item.origin})</td>
          <td class="text-center">${item.qty}</td>
          <td class="text-left">${item.totalValue.toFixed(0)} ج.م</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  <div class="divider"></div>
  <div class="text-center" style="font-size:9px; color:#555; margin-top:10px;">
    تم تصدير وحفظ التقرير بنجاح<br>تاريخ الحفظ: ${new Date().toLocaleString('ar-EG')}
  </div>
</body>
</html>`;

  // Capture offscreen PNG image simulation replica instead of HTML file
  const reportFilename = `report_${fromDate.replace(/\//g, '-')}_to_${toDate.replace(/\//g, '-')}.png`;
  savePrintReplicaAsImage(htmlContent, reportFilename);

  // Direct print via native PowerShell direct print engine (always 80mm for reports)
  printRawImageViaPowershell(htmlContent, 'escpos', printerName, 80, 0, 576, 0)
    .then(() => console.log('PowerShell ESC/POS report print job sent.'))
    .catch((err) => console.error('PowerShell ESC/POS report print failed:', err));

  return { success: true };
});

// Helper to manage advanced barcode settings in a JSON file
const getBarcodeSettingsPath = () => path.join(app.getPath('userData'), 'barcode_settings.json');

const getBarcodeConfigHelper = () => {
  const cfgPath = getBarcodeSettingsPath();
  const defaults = {
    widthMm: 42.5,
    heightMm: 25,
    gap: 1.0,
    marginTop: 0.6,
    marginBottom: 0.5,
    marginLeft: 0.4,
    marginRight: 0.5,
    barcodeX: 9.7,
    barcodeY: 11.1,
    scaleWidth: 2,
    scaleHeight: 49,
    showText: true,
    storeFontSize: 22,
    nameFontSize: 20,
    originFontSize: 16,
    priceFontSize: 23,
    storeY: 5.4,
    nameY: 9.2,
    originY: 23.1,
    priceY: 20.3,
    widthIn: 2.28,
    heightIn: 1.18,
    fontSize: 10,
    storeX: 20.6,
    nameX: 20.7,
    originX: 30.5,
    priceX: 4.8,
    showPrice: false,
    showStoreName: true,
    showProductName: true,
    showBarcode: true,
    showOrigin: true
  };
  try {
    if (fs.existsSync(cfgPath)) {
      const content = fs.readFileSync(cfgPath, 'utf8');
      return { ...defaults, ...JSON.parse(content) };
    } else {
      fs.writeFileSync(cfgPath, JSON.stringify(defaults, null, 2), 'utf8');
      return defaults;
    }
  } catch (err) {
    console.error('Failed to read barcode settings file:', err);
    return defaults;
  }
};

// ── Barcode Config IPC Handlers ─────────────────────────────────────────────
ipcMain.handle('get-barcode-config', async () => {
  return { success: true, config: getBarcodeConfigHelper() };
});

ipcMain.handle('save-barcode-config', async (event, config) => {
  try {
    const cfgPath = getBarcodeSettingsPath();
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Failed to save barcode settings file:', err);
    return { success: false, error: err.message };
  }
});

// High-speed direct TSPL raw print handler using native PowerShell
ipcMain.handle('print-raw-tspl', async (event, data) => {
  const { printerName, base64Tspl } = data;
  
  let resolvedPrinter = printerName;
  if (!resolvedPrinter) {
    resolvedPrinter = await autoDetectLabelPrinter();
  }
  
  const rawBuffer = Buffer.from(base64Tspl, 'base64');
  return await printRawBufferViaPowershell(resolvedPrinter, rawBuffer);
});

// ── Direct Barcode Label Printer ─────────────────────────────────────────────
// Auto-detect the best matching thermal label printer from system list
const autoDetectLabelPrinter = async (customPrinterName) => {
  if (customPrinterName) return customPrinterName;
  try {
    const settings = await handlers.getSettings();
    if (settings.selected_printer_name) return settings.selected_printer_name;
  } catch (err) {}

  if (!mainWindow) return '';
  try {
    const list = await mainWindow.webContents.getPrintersAsync();
    const keywords = ['xprinter', 'tsc', 'zebra', 'gprinter', 'label', 'barcode', 'thermal', 'xp-'];
    for (const kw of keywords) {
      const match = list.find(p => p.name.toLowerCase().includes(kw));
      if (match) {
        console.log(`[Barcode] Auto-detected printer matching '${kw}': ${match.name}`);
        return match.name;
      }
    }
    const defaultPrinter = list.find(p => p.isDefault);
    if (defaultPrinter) return defaultPrinter.name;
    if (list.length > 0) return list[0].name;
  } catch (e) {
    console.error('Failed to auto-detect printer:', e);
  }
  return '';
};

// ── Direct Barcode Label Printer ─────────────────────────────────────────────
// Prints barcode labels directly to thermal printer (no browser dialog)
// Uses a hidden window to render with JsBarcode and calls webContents.print()
// Also saves a visual PNG preview to print_logs for verification
ipcMain.handle('print-barcodes', async (event, barcodeData) => {
  const { labels } = barcodeData;
  const cfg = getBarcodeConfigHelper();

  // Get printer settings and store name (with auto-detection)
  let printerName = await autoDetectLabelPrinter(barcodeData.printerName);
  let storeName = barcodeData.storeName || 'الأصيل لقطع الغيار';
  try {
    const settings = await handlers.getSettings();
    if (!barcodeData.storeName && settings.store_name) {
      storeName = settings.store_name;
    }
  } catch (err) {
    console.error('Failed to get barcode settings:', err);
  }

  const widthPx = Math.round(cfg.widthMm * 8); // 8 dots per mm (203 dpi)
  const heightPx = Math.round(cfg.heightMm * 8);

  console.log(`[Barcode] Printing ${labels.length} labels individually via Python...`);

  // Loop through and print each label one-by-one to prevent overlaps
  for (const lbl of labels) {
    const singleHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #fff;
      font-family: Arial, sans-serif;
      direction: rtl;
      margin: 0;
      padding: 0;
      width: ${cfg.widthMm}mm;
      height: ${cfg.heightMm}mm;
    }
    .label {
      width: ${cfg.widthMm}mm;
      height: ${cfg.heightMm}mm;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #fff;
    }
    .label-inner {
      width: calc(100% - ${Number(cfg.marginLeft) + Number(cfg.marginRight)}mm);
      height: calc(100% - ${Number(cfg.marginTop) + Number(cfg.marginBottom)}mm);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.6mm;
      overflow: hidden;
      box-sizing: border-box;
    }
    .lname {
      font-size: ${cfg.fontSize}px;
      font-weight: bold;
      text-align: center;
      line-height: 1.1;
      width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lorigin {
      font-size: ${cfg.originFontSize}px;
      color: #555;
      text-align: center;
      width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 0.2mm;
    }
    .barcode-img {
      max-width: 100% !important;
      max-height: 50% !important;
      width: auto !important;
      height: auto !important;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .lstore {
      font-size: ${Math.max(6, cfg.fontSize - 1)}px;
      font-weight: 800;
      text-align: center;
      width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 0.5mm;
      color: #000;
    }
  </style>
</head>
<body>
  <div class="label">
    <div class="label-inner">
      <div class="lname">${lbl.name || ''}</div>
      ${lbl.origin ? `<div class="lorigin">(${lbl.origin})</div>` : ''}
      <img id="bc" class="barcode-img">
      <div class="lstore">${storeName}</div>
    </div>
  </div>
  <script>
    try {
      JsBarcode('#bc', "${String(lbl.barcode || '000000')}", {
        format: 'CODE128',
        width: ${cfg.scaleWidth},
        height: ${cfg.scaleHeight},
        displayValue: ${cfg.showText},
        fontSize: ${cfg.fontSize - 1},
        margin: 0,
        background: '#fff',
        lineColor: '#000'
      });
    } catch(e) {
      document.getElementById('bc').outerHTML = '<div style="font-size:7px;font-family:monospace;text-align:center">${lbl.barcode}</div>';
    }
  </script>
</body>
</html>`;

    try {
      // Print this label using TSPL (standard label printer language)
      await printRawImageViaPowershell(singleHtml, 'tspl', printerName, cfg.widthMm, cfg.heightMm, widthPx, heightPx);
      console.log(`[Barcode] Label printed successfully via PowerShell print engine: ${lbl.barcode}`);
    } catch (err) {
      console.error(`[Barcode] Failed to print label via PowerShell print engine: ${lbl.barcode}`, err);
    }
  }

  return { success: true };
});

// ── Full DB Snapshot for complete cloud re-sync ──────────────────────────────
ipcMain.handle('get-full-snapshot', async () => {
  try {
    return { success: true, data: handlers.getFullSnapshot() };
  } catch (e) {
    console.error('[FullSnapshot] Error:', e);
    return { success: false, error: e.message };
  }
});
