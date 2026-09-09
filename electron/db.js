const path = require('path');
const fs = require('fs');

let db;
let isFallback = false;
let fallbackStore = {};

const dbPath = path.join(
  process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME, 'Library/Preferences') : path.join(process.env.HOME, '.config')),
  'auto-parts-cashier',
  'database.sqlite'
);

// Ensure directory exists
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// Try initializing better-sqlite3
try {
  const Database = require('better-sqlite3');
  db = new Database(dbPath, { verbose: console.log });
  console.log('SQLite database initialized successfully at:', dbPath);
} catch (err) {
  console.error('Failed to load better-sqlite3. Using memory-backed fallback database for development.', err);
  isFallback = true;
  initializeFallbackStore();
}

function initializeFallbackStore() {
  const fallbackPath = path.join(dir, 'fallback_db.json');
  if (fs.existsSync(fallbackPath)) {
    try {
      fallbackStore = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
      console.log('Loaded fallback database from file:', fallbackPath);
      return;
    } catch (e) {
      console.error('Failed to parse fallback JSON database, resetting.', e);
    }
  }

  // Schema structure for fallback mode
  fallbackStore = {
    products: [],
    product_variants: [],
    product_compatibility: [],
    suppliers: [],
    supplier_debts: [],
    sync_queue: [],
    sales: [],
    sale_items: [],
    activity_logs: [],
    settings: {},
    cashier_users: []
  };
  saveFallbackStore();
}

function saveFallbackStore() {
  if (!isFallback) return;
  const fallbackPath = path.join(dir, 'fallback_db.json');
  try {
    fs.writeFileSync(fallbackPath, JSON.stringify(fallbackStore, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving fallback database:', e);
  }
}

// Create database tables
function initDb() {
  if (isFallback) {
    console.log('Configuring schema in fallback memory database...');
    if (fallbackStore.settings) {
      if (!fallbackStore.settings.store_name || fallbackStore.settings.store_name === 'البرنس' || fallbackStore.settings.store_name === 'البرنس لقطع الغيار') {
        fallbackStore.settings.store_name = 'الأصيل لقطع الغيار';
      }
      if (!fallbackStore.settings.invoice_header || fallbackStore.settings.invoice_header.includes('البرنس')) {
        fallbackStore.settings.invoice_header = 'مرحباً بكم في محلات الأصيل لقطع الغيار - ثقة وأمان';
      }
    }
    // Seed default data if empty
    if (fallbackStore.cashier_users.length === 0) {
      seedFallbackData();
    }
    return;
  }

  // Create tables using SQLite
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      min_limit_general INTEGER DEFAULT 5,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      origin TEXT NOT NULL,
      specification TEXT,
      cost_price REAL NOT NULL,
      selling_price REAL NOT NULL,
      stock_quantity INTEGER NOT NULL,
      min_limit INTEGER DEFAULT 3,
      sku_barcode TEXT UNIQUE NOT NULL,
      created_at TEXT,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_compatibility (
      id TEXT PRIMARY KEY,
      variant_id TEXT,
      car_make TEXT NOT NULL,
      car_model TEXT NOT NULL,
      year_start INTEGER,
      year_end INTEGER,
      created_at TEXT,
      FOREIGN KEY(variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      current_debt REAL DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS supplier_debts (
      id TEXT PRIMARY KEY,
      supplier_id TEXT,
      transaction_type TEXT CHECK(transaction_type IN ('PURCHASE_DEBT', 'PAYMENT', 'SETTLEMENT')),
      amount REAL NOT NULL,
      previous_debt REAL NOT NULL,
      new_debt REAL NOT NULL,
      notes TEXT,
      created_at TEXT,
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL,
      record_id TEXT NOT NULL,
      data TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      invoice_number TEXT UNIQUE NOT NULL,
      cashier_id TEXT,
      cashier_name TEXT,
      customer_name TEXT,
      total_amount REAL NOT NULL,
      discount REAL DEFAULT 0,
      final_amount REAL NOT NULL,
      payment_method TEXT CHECK(payment_method IN ('CASH', 'CARD', 'DEBT')),
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT,
      variant_id TEXT,
      name TEXT,
      origin TEXT,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      cost_price REAL NOT NULL,
      total_price REAL NOT NULL,
      FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY(variant_id) REFERENCES product_variants(id)
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS cashier_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT CHECK(role IN ('ADMIN', 'CASHIER')),
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS credit_customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      notes TEXT,
      total_debt REAL DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS customer_payments (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      amount REAL NOT NULL,
      notes TEXT,
      created_at TEXT,
      FOREIGN KEY(customer_id) REFERENCES credit_customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS refund_logs (
      id TEXT PRIMARY KEY,
      sale_id TEXT,
      invoice_number TEXT,
      variant_id TEXT,
      name TEXT,
      origin TEXT,
      quantity INTEGER,
      refund_amount REAL,
      cashier_name TEXT,
      created_at TEXT
    );
  `);

  // Run migrations to ensure columns exist in existing databases
  try {
    db.prepare('ALTER TABLE cashier_users ADD COLUMN phone TEXT').run();
  } catch (e) {}

  try {
    db.prepare('ALTER TABLE sales ADD COLUMN cashier_name TEXT').run();
  } catch (e) {}

  try {
    db.prepare('ALTER TABLE sale_items ADD COLUMN name TEXT').run();
  } catch (e) {}

  try {
    db.prepare('ALTER TABLE sale_items ADD COLUMN origin TEXT').run();
  } catch (e) {}

  try {
    db.prepare('ALTER TABLE sales ADD COLUMN credit_customer_id TEXT').run();
  } catch (e) {}


  // Seed default data if users table is empty
  const userCheck = db.prepare('SELECT count(*) as count FROM cashier_users').get();
  if (userCheck.count === 0) {
    seedSqliteData();
  }

  // Ensure settings are updated to "الأصيل لقطع الغيار" if they are currently set to "البرنس"
  try {
    const currentStoreName = db.prepare("SELECT value FROM settings WHERE key = 'store_name'").get();
    if (!currentStoreName || currentStoreName.value === 'البرنس' || currentStoreName.value === 'البرنس لقطع الغيار') {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('store_name', 'الأصيل لقطع الغيار')").run();
    }
    const currentHeader = db.prepare("SELECT value FROM settings WHERE key = 'invoice_header'").get();
    if (!currentHeader || currentHeader.value.includes('البرنس')) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('invoice_header', 'مرحباً بكم في محلات الأصيل لقطع الغيار - ثقة وأمان')").run();
    }
    // Delete default user 'احمد مجدي' if exists to clean up database
    try {
      db.prepare("DELETE FROM cashier_users WHERE username = 'احمد مجدي'").run();
    } catch (err) {}
  } catch (e) {
    console.error('Failed to update store name defaults:', e);
  }
}

function getTimestamp() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}.${ms}`;
}

function seedSqliteData() {
  console.log('Seeding default data into SQLite...');
  
  // Insert Settings
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('store_name', 'الأصيل لقطع الغيار');
  insertSetting.run('store_phone', '01012345678');
  insertSetting.run('store_logo', '');
  insertSetting.run('invoice_header', 'مرحباً بكم في محلات الأصيل لقطع الغيار - ثقة وأمان');
  insertSetting.run('invoice_footer', 'الفاتورة صالحة للمرتجع خلال 14 يوماً مع وجود العبوة الأصلية');
  insertSetting.run('vodafone_cash_numbers', '01011111111,01022222222');
  insertSetting.run('supabase_url', 'https://oplxmybjgesqyqywcwhl.supabase.co');
  insertSetting.run('supabase_anon_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wbHhteWJqZ2VzcXlxeXdjd2hsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzExMTE2NCwiZXhwIjoyMDk4Njg3MTY0fQ.wf1SILUM3EDMvhC2DV9a7i73-ok7vMUIZqo479dPgho');

  // Insert Default Cashier
  const insertUser = db.prepare('INSERT INTO cashier_users (id, username, password_hash, role, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  insertUser.run('u1', 'admin', 'admin123', 'ADMIN', '01011111111', getTimestamp());
  insertUser.run('u2', 'cashier', 'cashier123', 'CASHIER', '01033333333', getTimestamp());

  // Insert Default Suppliers
  const insertSupplier = db.prepare('INSERT INTO suppliers (id, name, phone, email, address, current_debt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertSupplier.run('s1', 'البشبيشي للمستورد', '01223344556', 'bishbishy@parts.com', 'شبرا، القاهرة', 15000, getTimestamp());
  insertSupplier.run('s2', 'النور لقطع غيار الألماني', '01122334455', 'elnoor@germanparts.com', 'الدقي، الجيزة', 0, getTimestamp());

  // Insert Initial Supplier Debt movement
  const insertDebt = db.prepare('INSERT INTO supplier_debts (id, supplier_id, transaction_type, amount, previous_debt, new_debt, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insertDebt.run('d1', 's1', 'PURCHASE_DEBT', 15000, 0, 15000, 'شراء بضاعة أول المدة - تيل مكابح ومساعدين', getTimestamp());

  // Insert Products
  const insertProduct = db.prepare('INSERT INTO products (id, name, category, min_limit_general, created_at) VALUES (?, ?, ?, ?, ?)');
  insertProduct.run('p1', 'تيل فرامل أمامي', 'فرامل', 5, getTimestamp());
  insertProduct.run('p2', 'مساعدين خلفي', 'عفشة وتعليق', 4, getTimestamp());
  insertProduct.run('p3', 'فلتر زيت محرك', 'فلاتر وزيوت', 10, getTimestamp());

  // Insert Product Variants
  const insertVariant = db.prepare('INSERT INTO product_variants (id, product_id, origin, specification, cost_price, selling_price, stock_quantity, min_limit, sku_barcode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  // Variants for front brake pad
  insertVariant.run('v1', 'p1', 'ألماني (Original)', 'سيراميك - أداء رياضي', 450, 650, 8, 3, '4000123456', getTimestamp());
  insertVariant.run('v2', 'p1', 'صيني (درجة أولى)', 'عادي - متانة ممتازة', 180, 280, 20, 5, '6900123456', getTimestamp());
  insertVariant.run('v3', 'p1', 'كوري (مستورد)', 'نصف معدني', 300, 420, 2, 4, '8800123456', getTimestamp()); // low stock!

  // Variants for shocks
  insertVariant.run('v4', 'p2', 'ألماني (Monroe)', 'غاز وضغط زيت مشترك', 1200, 1600, 6, 2, '4000789012', getTimestamp());
  insertVariant.run('v5', 'p2', 'ياباني (KYB)', 'ضغط زيت فقط', 950, 1300, 1, 2, '4900789012', getTimestamp()); // low stock!

  // Variants for oil filter
  insertVariant.run('v6', 'p3', 'صيني (براند)', 'فلتر كرتوني مقاوم للحرارة', 50, 90, 35, 10, '6900789012', getTimestamp());

  // Insert Compatibilities
  const insertComp = db.prepare('INSERT INTO product_compatibility (id, variant_id, car_make, car_model, year_start, year_end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertComp.run('c1', 'v1', 'Mercedes-Benz', 'C-Class W205', 2014, 2021, getTimestamp());
  insertComp.run('c2', 'v1', 'BMW', '3 Series F30', 2012, 2019, getTimestamp());
  
  insertComp.run('c3', 'v2', 'Toyota', 'Corolla', 2014, 2019, getTimestamp());
  insertComp.run('c4', 'v2', 'Hyundai', 'Elantra HD', 2008, 2020, getTimestamp());
  
  insertComp.run('c5', 'v4', 'Volkswagen', 'Golf MK7', 2013, 2020, getTimestamp());
  insertComp.run('c6', 'v5', 'Toyota', 'Yaris', 2015, 2022, getTimestamp());
}

function seedFallbackData() {
  console.log('Seeding default data into Memory Fallback...');
  fallbackStore.settings = {
    store_name: 'الأصيل لقطع الغيار',
    store_phone: '01012345678',
    store_logo: '',
    invoice_header: 'مرحباً بكم في محلات الأصيل لقطع الغيار - ثقة وأمان',
    invoice_footer: 'الفاتورة صالحة للمرتجع خلال 14 يوماً مع وجود العبوة الأصلية',
    vodafone_cash_numbers: '01011111111,01022222222',
    supabase_url: 'https://oplxmybjgesqyqywcwhl.supabase.co',
    supabase_anon_key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wbHhteWJqZ2VzcXlxeXdjd2hsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzExMTE2NCwiZXhwIjoyMDk4Njg3MTY0fQ.wf1SILUM3EDMvhC2DV9a7i73-ok7vMUIZqo479dPgho'
  };

  fallbackStore.cashier_users = [
    { id: 'u1', username: 'admin', password_hash: 'admin123', role: 'ADMIN', phone: '01011111111', created_at: getTimestamp() },
    { id: 'u2', username: 'cashier', password_hash: 'cashier123', role: 'CASHIER', phone: '01033333333', created_at: getTimestamp() }
  ];

  fallbackStore.suppliers = [
    { id: 's1', name: 'البشبيشي للمستورد', phone: '01223344556', email: 'bishbishy@parts.com', address: 'شبرا، القاهرة', current_debt: 15000, created_at: getTimestamp() },
    { id: 's2', name: 'النور لقطع غيار الألماني', phone: '01122334455', email: 'elnoor@germanparts.com', address: 'الدقي، الجيزة', current_debt: 0, created_at: getTimestamp() }
  ];

  fallbackStore.supplier_debts = [
    { id: 'd1', supplier_id: 's1', transaction_type: 'PURCHASE_DEBT', amount: 15000, previous_debt: 0, new_debt: 15000, notes: 'شراء بضاعة أول المدة - تيل مكابح ومساعدين', created_at: getTimestamp() }
  ];

  fallbackStore.products = [
    { id: 'p1', name: 'تيل فرامل أمامي', category: 'فرامل', min_limit_general: 5, created_at: getTimestamp() },
    { id: 'p2', name: 'مساعدين خلفي', category: 'عفشة وتعليق', min_limit_general: 4, created_at: getTimestamp() },
    { id: 'p3', name: 'فلتر زيت محرك', category: 'فلاتر وزيوت', min_limit_general: 10, created_at: getTimestamp() }
  ];

  fallbackStore.product_variants = [
    { id: 'v1', product_id: 'p1', origin: 'ألماني (Original)', specification: 'سيراميك - أداء رياضي', cost_price: 450, selling_price: 650, stock_quantity: 8, min_limit: 3, sku_barcode: '4000123456', created_at: getTimestamp() },
    { id: 'v2', product_id: 'p1', origin: 'صيني (درجة أولى)', specification: 'عادي - متانة ممتازة', cost_price: 180, selling_price: 280, stock_quantity: 20, min_limit: 5, sku_barcode: '6900123456', created_at: getTimestamp() },
    { id: 'v3', product_id: 'p1', origin: 'كوري (مستورد)', specification: 'نصف معدني', cost_price: 300, selling_price: 420, stock_quantity: 2, min_limit: 4, sku_barcode: '8800123456', created_at: getTimestamp() },
    { id: 'v4', product_id: 'p2', origin: 'ألماني (Monroe)', specification: 'غاز وضغط زيت مشترك', cost_price: 1200, selling_price: 1600, stock_quantity: 6, min_limit: 2, sku_barcode: '4000789012', created_at: getTimestamp() },
    { id: 'v5', product_id: 'p2', origin: 'ياباني (KYB)', specification: 'ضغط زيت فقط', cost_price: 950, selling_price: 1300, stock_quantity: 1, min_limit: 2, sku_barcode: '4900789012', created_at: getTimestamp() },
    { id: 'v6', product_id: 'p3', origin: 'صيني (براند)', specification: 'فلتر كرتوني مقاوم للحرارة', cost_price: 50, selling_price: 90, stock_quantity: 35, min_limit: 10, sku_barcode: '6900789012', created_at: getTimestamp() }
  ];

  fallbackStore.product_compatibility = [
    { id: 'c1', variant_id: 'v1', car_make: 'Mercedes-Benz', car_model: 'C-Class W205', year_start: 2014, year_end: 2021, created_at: getTimestamp() },
    { id: 'c2', variant_id: 'v1', car_make: 'BMW', car_model: '3 Series F30', year_start: 2012, year_end: 2019, created_at: getTimestamp() },
    { id: 'c3', variant_id: 'v2', car_make: 'Toyota', car_model: 'Corolla', year_start: 2014, year_end: 2019, created_at: getTimestamp() },
    { id: 'c4', variant_id: 'v2', car_make: 'Hyundai', car_model: 'Elantra HD', year_start: 2008, year_end: 2020, created_at: getTimestamp() },
    { id: 'c5', variant_id: 'v4', car_make: 'Volkswagen', car_model: 'Golf MK7', year_start: 2013, year_end: 2020, created_at: getTimestamp() },
    { id: 'c6', variant_id: 'v5', car_make: 'Toyota', car_model: 'Yaris', year_start: 2015, year_end: 2022, created_at: getTimestamp() }
  ];

  saveFallbackStore();
}

// IPC database operations handlers
const handlers = {
  // Query operations
  query: (sql, params = []) => {
    if (isFallback) {
      console.warn(`Query operation requested in fallback mode: ${sql}. Falling back to list scans.`);
      // Basic fallback routing based on typical table queries
      if (sql.includes('FROM products')) return fallbackStore.products;
      if (sql.includes('FROM product_variants')) {
        // Expand product name
        return fallbackStore.product_variants.map(v => {
          const prod = fallbackStore.products.find(p => p.id === v.product_id);
          return { ...v, product_name: prod ? prod.name : 'Unknown Product', product_category: prod ? prod.category : '' };
        });
      }
      if (sql.includes('INSERT INTO suppliers')) {
        const [id, name, phone, email, address, current_debt, created_at] = params;
        if (!fallbackStore.suppliers) fallbackStore.suppliers = [];
        fallbackStore.suppliers.push({ id, name, phone, email, address, current_debt: Number(current_debt) || 0, created_at });
        saveFallbackStore();
        return { success: true };
      }
      if (sql.includes('INSERT INTO supplier_debts')) {
        const [id, supplier_id, transaction_type, amount, previous_debt, new_debt, notes, created_at] = params;
        if (!fallbackStore.supplier_debts) fallbackStore.supplier_debts = [];
        fallbackStore.supplier_debts.push({ id, supplier_id, transaction_type, amount: Number(amount), previous_debt: Number(previous_debt), new_debt: Number(new_debt), notes, created_at });
        saveFallbackStore();
        return { success: true };
      }
      if (sql.includes('UPDATE suppliers SET current_debt')) {
        // UPDATE suppliers SET current_debt = ? WHERE id = ?
        const [debt, id] = params;
        const s = fallbackStore.suppliers.find(x => x.id === id);
        if (s) {
          s.current_debt = Number(debt);
          saveFallbackStore();
        }
        return { success: true };
      }
      if (sql.includes('FROM suppliers')) return fallbackStore.suppliers || [];
      if (sql.includes('FROM supplier_debts')) {
        const supId = params[0];
        return (fallbackStore.supplier_debts || []).filter(d => !supId || d.supplier_id === supId);
      }
      if (sql.includes('FROM activity_logs')) {
        return [...fallbackStore.activity_logs].sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
      if (sql.includes('FROM settings')) return Object.entries(fallbackStore.settings).map(([key, value]) => ({ key, value }));
      if (sql.includes('FROM sync_queue')) return fallbackStore.sync_queue;
      if (sql.includes('FROM sales')) return fallbackStore.sales;
      if (sql.includes('FROM sale_items')) return fallbackStore.sale_items;
      if (sql.includes('FROM cashier_users')) {
        if (params && params.length >= 2) {
          const u = params[0];
          const p = params[1];
          return fallbackStore.cashier_users.filter(x => x.username === u && x.password_hash === p);
        }
        return fallbackStore.cashier_users;
      }
      return [];
    }

    try {
      const stmt = db.prepare(sql);
      return sql.trim().toUpperCase().startsWith('SELECT') ? stmt.all(...params) : stmt.run(...params);
    } catch (e) {
      console.error('SQL Query Error:', e);
      throw e;
    }
  },

  // Log activities
  logActivity: (userId, username, action, details) => {
    const logId = 'log_' + Math.random().toString(36).substr(2, 9);
    const ts = getTimestamp();
    if (isFallback) {
      fallbackStore.activity_logs.push({ id: logId, user_id: userId, username, action, details, created_at: ts });
      saveFallbackStore();
      return true;
    }
    db.prepare('INSERT INTO activity_logs (id, user_id, username, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(logId, userId, username, action, details, ts);
    return true;
  },

  // Save Settings
  saveSetting: (key, value) => {
    if (isFallback) {
      fallbackStore.settings[key] = value;
      saveFallbackStore();
      return true;
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    return true;
  },

  // Load settings
  getSettings: () => {
    if (isFallback) {
      return fallbackStore.settings;
    }
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settingsObj = {};
    rows.forEach(r => { settingsObj[r.key] = r.value; });
    return settingsObj;
  },

  // Fetch all variants (with full information)
  getVariantsWithProductDetails: () => {
    if (isFallback) {
      return fallbackStore.product_variants.map(v => {
        const prod = fallbackStore.products.find(p => p.id === v.product_id) || {};
        const comps = fallbackStore.product_compatibility.filter(c => c.variant_id === v.id);
        return { ...v, product_name: prod.name || '', category: prod.category || '', compatibility: comps };
      });
    }

    const query = `
      SELECT v.*, p.name as product_name, p.category
      FROM product_variants v
      LEFT JOIN products p ON v.product_id = p.id
    `;
    const variants = db.prepare(query).all();
    const compStmt = db.prepare('SELECT car_make, car_model, year_start, year_end FROM product_compatibility WHERE variant_id = ?');
    return variants.map(v => ({ ...v, compatibility: compStmt.all(v.id) }));
  },

  // Process a sale (within a transaction)
  checkout: (saleData) => {
    const { id, invoice_number, cashier_id, cashier_name, customer_name, total_amount, discount, final_amount, payment_method, credit_customer_id, items } = saleData;
    const ts = getTimestamp();

    if (isFallback) {
      // 1. Insert Sale record — include cashier_name & credit_customer_id
      const sale = { id, invoice_number, cashier_id, cashier_name, customer_name, total_amount, discount, final_amount, payment_method, credit_customer_id: credit_customer_id || null, created_at: ts };
      fallbackStore.sales.push(sale);

      // Update customer debt if payment is DEBT
      if (payment_method === 'DEBT' && credit_customer_id) {
        if (!fallbackStore.credit_customers) fallbackStore.credit_customers = [];
        const cust = fallbackStore.credit_customers.find(c => c.id === credit_customer_id);
        if (cust) {
          cust.total_debt = (cust.total_debt || 0) + final_amount;
        }
      }

      // 2. Process Items — enrich with id, name, origin from variant
      const enrichedItems = items.map(item => {
        const variant = fallbackStore.product_variants.find(v => v.id === item.variant_id);
        const product = variant ? fallbackStore.products.find(p => p.id === variant.product_id) : null;
        const itemId = 'item_' + Math.random().toString(36).substr(2, 9);

        if (variant) variant.stock_quantity -= item.quantity;

        const enriched = {
          id: itemId,
          sale_id: id,
          variant_id: item.variant_id,
          name: item.name || (product ? product.name : 'قطعة غيار'),
          origin: item.origin || (variant ? variant.origin : 'غير محدد'),
          quantity: item.quantity,
          unit_price: item.unit_price,
          cost_price: item.cost_price,
          total_price: item.unit_price * item.quantity
        };
        fallbackStore.sale_items.push(enriched);
        return enriched;
      });

      // 3. Add to sync queue — enriched items with all required fields
      fallbackStore.sync_queue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'sales',
        operation: 'INSERT',
        record_id: id,
        data: JSON.stringify({ sale, items: enrichedItems }),
        status: 'pending',
        error_message: null,
        created_at: ts
      });

      // 4. Log activity
      fallbackStore.activity_logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: cashier_id,
        username: cashier_name,
        action: 'SALE_COMPLETED',
        details: `فاتورة رقم ${invoice_number} بقيمة إجمالية ${final_amount} ج.م دفع ${payment_method}`,
        created_at: ts
      });

      saveFallbackStore();
      return { success: true, invoice_number };
    }

    // SQLite Transaction
    const transaction = db.transaction(() => {
      // Insert Sale — include cashier_name & credit_customer_id columns
      db.prepare(`
        INSERT INTO sales (id, invoice_number, cashier_id, cashier_name, customer_name, total_amount, discount, final_amount, payment_method, credit_customer_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, invoice_number, cashier_id, cashier_name || '', customer_name, total_amount, discount, final_amount, payment_method, credit_customer_id || null, ts);

      // Update customer debt if payment is DEBT
      if (payment_method === 'DEBT' && credit_customer_id) {
        db.prepare('UPDATE credit_customers SET total_debt = total_debt + ? WHERE id = ?').run(final_amount, credit_customer_id);
      }

      // Process Items — enrich from variants table
      const insertItem = db.prepare(`
        INSERT INTO sale_items (id, sale_id, variant_id, name, origin, quantity, unit_price, cost_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateStock = db.prepare(`
        UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?
      `);
      const getVariant = db.prepare(`
        SELECT pv.origin, p.name as product_name
        FROM product_variants pv
        LEFT JOIN products p ON p.id = pv.product_id
        WHERE pv.id = ?
      `);

      const enrichedItems = items.map(item => {
        const itemId = 'item_' + Math.random().toString(36).substr(2, 9);
        const variantInfo = getVariant.get(item.variant_id) || {};
        const itemName = item.name || variantInfo.product_name || 'قطعة غيار';
        const itemOrigin = item.origin || variantInfo.origin || 'غير محدد';
        insertItem.run(itemId, id, item.variant_id, itemName, itemOrigin, item.quantity, item.unit_price, item.cost_price, item.unit_price * item.quantity);
        updateStock.run(item.quantity, item.variant_id);
        return { id: itemId, sale_id: id, variant_id: item.variant_id, name: itemName, origin: itemOrigin, quantity: item.quantity, unit_price: item.unit_price, cost_price: item.cost_price, total_price: item.unit_price * item.quantity };
      });

      // Add to Sync Queue — proper payload with enriched items
      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      const queueData = JSON.stringify({
        sale: { id, invoice_number, cashier_id, cashier_name: cashier_name || '', customer_name, total_amount, discount, final_amount, payment_method, credit_customer_id: credit_customer_id || null, created_at: ts },
        items: enrichedItems
      });
      db.prepare(`
        INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(syncId, 'sales', 'INSERT', id, queueData, 'pending', ts);

      // Log Activity
      const logId = 'log_' + Math.random().toString(36).substr(2, 9);
      db.prepare(`
        INSERT INTO activity_logs (id, user_id, username, action, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(logId, cashier_id, cashier_name, 'SALE_COMPLETED', `فاتورة رقم ${invoice_number} بقيمة إجمالية ${final_amount} ج.م دفع ${payment_method}`, ts);
    });

    try {
      transaction();
      return { success: true, invoice_number };
    } catch (e) {
      console.error('Checkout Transaction Failed:', e);
      throw e;
    }
  },

  // Supplier debt transactions (adds purchases or payments, updates supplier balance)
  addSupplierDebtTransaction: (supplierId, type, amount, notes, userId, username) => {
    const ts = getTimestamp();
    const transactionId = 'debt_' + Math.random().toString(36).substr(2, 9);

    if (isFallback) {
      const supplier = fallbackStore.suppliers.find(s => s.id === supplierId);
      if (!supplier) throw new Error('Supplier not found');

      const prevDebt = supplier.current_debt;
      let newDebt = prevDebt;

      if (type === 'PURCHASE_DEBT') {
        newDebt += amount;
      } else if (type === 'PAYMENT') {
        newDebt -= amount;
      } else if (type === 'SETTLEMENT') {
        newDebt = 0; // Settled to zero
      }

      supplier.current_debt = newDebt;

      const debtTx = {
        id: transactionId,
        supplier_id: supplierId,
        transaction_type: type,
        amount: type === 'SETTLEMENT' ? prevDebt : amount,
        previous_debt: prevDebt,
        new_debt: newDebt,
        notes,
        created_at: ts
      };
      fallbackStore.supplier_debts.push(debtTx);

      // Add sync queue
      fallbackStore.sync_queue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'suppliers',
        operation: 'UPDATE',
        record_id: supplierId,
        data: JSON.stringify({ supplier, transaction: debtTx }),
        status: 'pending',
        error_message: null,
        created_at: ts
      });

      // Log activity
      fallbackStore.activity_logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: type === 'SETTLEMENT' ? 'DEBT_SETTLEMENT' : 'DEBT_TRANSACTION',
        details: `حركة دين على المورد ${supplier.name}: نوع (${type}) قيمة (${type === 'SETTLEMENT' ? prevDebt : amount}) ج.م. الدين الجديد: ${newDebt}`,
        created_at: ts
      });

      saveFallbackStore();
      return { success: true, newDebt };
    }

    const transaction = db.transaction(() => {
      // 1. Get current supplier debt
      const supplier = db.prepare('SELECT name, current_debt FROM suppliers WHERE id = ?').get(supplierId);
      if (!supplier) throw new Error('المورد غير موجود');

      const prevDebt = supplier.current_debt;
      let newDebt = prevDebt;
      let actualAmount = amount;

      if (type === 'PURCHASE_DEBT') {
        newDebt += amount;
      } else if (type === 'PAYMENT') {
        newDebt -= amount;
      } else if (type === 'SETTLEMENT') {
        newDebt = 0;
        actualAmount = prevDebt; // Complete settlement amount is equal to previous debt
      }

      // 2. Update Supplier table
      db.prepare('UPDATE suppliers SET current_debt = ? WHERE id = ?').run(newDebt, supplierId);

      // 3. Insert into supplier_debts table
      db.prepare(`
        INSERT INTO supplier_debts (id, supplier_id, transaction_type, amount, previous_debt, new_debt, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(transactionId, supplierId, type, actualAmount, prevDebt, newDebt, notes, ts);

      // 4. Add to sync queue
      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      const queueData = JSON.stringify({
        supplier_id: supplierId,
        current_debt: newDebt,
        transaction: { id: transactionId, supplier_id: supplierId, transaction_type: type, amount: actualAmount, previous_debt: prevDebt, new_debt: newDebt, notes, created_at: ts }
      });
      db.prepare(`
        INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(syncId, 'suppliers', 'UPDATE', supplierId, queueData, 'pending', ts);

      // 5. Log activity
      const logId = 'log_' + Math.random().toString(36).substr(2, 9);
      db.prepare(`
        INSERT INTO activity_logs (id, user_id, username, action, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(logId, userId, username, type === 'SETTLEMENT' ? 'DEBT_SETTLEMENT' : 'DEBT_TRANSACTION', `حركة دين على المورد ${supplier.name}: نوع (${type}) قيمة (${actualAmount}) ج.م. الدين الجديد: ${newDebt}`, ts);
    });

    try {
      transaction();
      return { success: true, newDebt };
    } catch (e) {
      console.error('Debt Transaction Failed:', e);
      throw e;
    }
  },

  // Edit stock directly (for manual corrections)
  updateVariantStock: (variantId, quantity, userId, username, reason) => {
    const ts = getTimestamp();
    if (isFallback) {
      const variant = fallbackStore.product_variants.find(v => v.id === variantId);
      if (!variant) throw new Error('Variant not found');
      
      const oldQty = variant.stock_quantity;
      variant.stock_quantity = quantity;

      // Add to sync queue
      fallbackStore.sync_queue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'product_variants',
        operation: 'UPDATE',
        record_id: variantId,
        data: JSON.stringify(variant),
        status: 'pending',
        error_message: null,
        created_at: ts
      });

      // Log activity
      fallbackStore.activity_logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: 'INVENTORY_ADJUSTMENT',
        details: `تعديل مخزون الصنف (البادكود: ${variant.sku_barcode}) من ${oldQty} إلى ${quantity}. السبب: ${reason}`,
        created_at: ts
      });

      saveFallbackStore();
      return { success: true };
    }

    const transaction = db.transaction(() => {
      const variant = db.prepare('SELECT stock_quantity, sku_barcode FROM product_variants WHERE id = ?').get(variantId);
      if (!variant) throw new Error('الصنف غير موجود');

      // Update
      db.prepare('UPDATE product_variants SET stock_quantity = ? WHERE id = ?').run(quantity, variantId);

      // Sync
      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      const queueData = JSON.stringify({ id: variantId, stock_quantity: quantity });
      db.prepare(`
        INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(syncId, 'product_variants', 'UPDATE', variantId, queueData, 'pending', ts);

      // Log activity
      const logId = 'log_' + Math.random().toString(36).substr(2, 9);
      db.prepare(`
        INSERT INTO activity_logs (id, user_id, username, action, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(logId, userId, username, 'INVENTORY_ADJUSTMENT', `تعديل مخزون الصنف (البادكود: ${variant.sku_barcode}) من ${variant.stock_quantity} إلى ${quantity}. السبب: ${reason}`, ts);
    });

    try {
      transaction();
      return { success: true };
    } catch (e) {
      console.error('Inventory Update Failed:', e);
      throw e;
    }
  },

  // Edit variant values (prices, minimum limits, etc)
  editVariant: (variantData, userId, username) => {
    const { id, origin, specification, cost_price, selling_price, min_limit, sku_barcode } = variantData;
    const ts = getTimestamp();

    if (isFallback) {
      const variant = fallbackStore.product_variants.find(v => v.id === id);
      if (!variant) throw new Error('Variant not found');
      
      variant.origin = origin;
      variant.specification = specification;
      variant.cost_price = Number(cost_price);
      variant.selling_price = Number(selling_price);
      variant.min_limit = Number(min_limit);
      variant.sku_barcode = sku_barcode;

      fallbackStore.sync_queue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'product_variants',
        operation: 'UPDATE',
        record_id: id,
        data: JSON.stringify(variant),
        status: 'pending',
        created_at: ts
      });

      fallbackStore.activity_logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: 'VARIANT_UPDATED',
        details: `تعديل بيانات المتغير (الباركود: ${sku_barcode}) - السعر: ${selling_price}`,
        created_at: ts
      });

      saveFallbackStore();
      return { success: true };
    }

    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE product_variants 
        SET origin = ?, specification = ?, cost_price = ?, selling_price = ?, min_limit = ?, sku_barcode = ?
        WHERE id = ?
      `).run(origin, specification, cost_price, selling_price, min_limit, sku_barcode, id);

      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      const queueData = JSON.stringify({ id, origin, specification, cost_price, selling_price, min_limit, sku_barcode });
      db.prepare(`
        INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(syncId, 'product_variants', 'UPDATE', id, queueData, 'pending', ts);

      const logId = 'log_' + Math.random().toString(36).substr(2, 9);
      db.prepare(`
        INSERT INTO activity_logs (id, user_id, username, action, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(logId, userId, username, 'VARIANT_UPDATED', `تعديل بيانات المتغير (الباركود: ${sku_barcode}) - السعر: ${selling_price}`, ts);
    });

    try {
      transaction();
      return { success: true };
    } catch (e) {
      console.error('Variant Update Failed:', e);
      throw e;
    }
  },

  // Sync utilities
  getSyncQueue: () => {
    if (isFallback) {
      return fallbackStore.sync_queue.filter(q => q.status === 'pending');
    }
    return db.prepare("SELECT * FROM sync_queue WHERE status = 'pending'").all();
  },

  markAsSynced: (queueIds) => {
    if (isFallback) {
      fallbackStore.sync_queue.forEach(q => {
        if (queueIds.includes(q.id)) {
          q.status = 'synced';
        }
      });
      saveFallbackStore();
      return true;
    }

    const stmt = db.prepare("UPDATE sync_queue SET status = 'synced' WHERE id = ?");
    const transaction = db.transaction(() => {
      queueIds.forEach(id => stmt.run(id));
    });
    transaction();
    return true;
  },

  markAsFailed: (queueId, errorMessage) => {
    if (isFallback) {
      const q = fallbackStore.sync_queue.find(x => x.id === queueId);
      if (q) {
        q.status = 'failed';
        q.error_message = errorMessage;
      }
      saveFallbackStore();
      return true;
    }
    db.prepare("UPDATE sync_queue SET status = 'failed', error_message = ? WHERE id = ?").run(errorMessage, queueId);
    return true;
  },

  // Add new Product, Variant, and Compatibility
  addProduct: (productData, userId, username) => {
    const ts = getTimestamp();
    const productId = 'prod_' + Math.random().toString(36).substr(2, 9);
    const variantId = 'var_' + Math.random().toString(36).substr(2, 9);
    const { productName, category, origin, specification, costPrice, sellingPrice, stockQuantity, minLimit, barcode, compatibility } = productData;

    if (isFallback) {
      let activeProdId = productId;
      let existingProd = fallbackStore.products.find(p => p.name === productName && p.category === category);
      
      if (existingProd) {
        activeProdId = existingProd.id;
      } else {
        fallbackStore.products.push({
          id: productId,
          name: productName,
          category: category,
          min_limit_general: 5,
          created_at: ts
        });
      }

      fallbackStore.product_variants.push({
        id: variantId,
        product_id: activeProdId,
        origin: origin,
        specification: specification,
        cost_price: Number(costPrice),
        selling_price: Number(sellingPrice),
        stock_quantity: Number(stockQuantity),
        min_limit: Number(minLimit),
        sku_barcode: barcode,
        created_at: ts
      });

      compatibility.forEach(comp => {
        fallbackStore.product_compatibility.push({
          id: 'comp_' + Math.random().toString(36).substr(2, 9),
          variant_id: variantId,
          car_make: comp.carMake,
          car_model: comp.carModel,
          year_start: Number(comp.yearStart),
          year_end: Number(comp.yearEnd),
          created_at: ts
        });
      });

      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      fallbackStore.sync_queue.push({
        id: syncId,
        table_name: 'products',
        operation: 'INSERT',
        record_id: variantId,
        data: JSON.stringify({ productName, barcode }),
        status: 'pending',
        error_message: null,
        created_at: ts
      });

      fallbackStore.activity_logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: userId,
        username,
        action: 'PRODUCT_ADDED',
        details: `تكويد وإضافة قطعة جديدة: ${productName} (${origin}) باركود: ${barcode}`,
        created_at: ts
      });

      saveFallbackStore();
      return { success: true };
    }

    const transaction = db.transaction(() => {
      const existing = db.prepare('SELECT id FROM products WHERE name = ? AND category = ?').get(productName, category);
      let activeProdId = productId;

      if (existing) {
        activeProdId = existing.id;
      } else {
        db.prepare('INSERT INTO products (id, name, category, min_limit_general, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(productId, productName, category, 5, ts);
      }

      db.prepare(`
        INSERT INTO product_variants (id, product_id, origin, specification, cost_price, selling_price, stock_quantity, min_limit, sku_barcode, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(variantId, activeProdId, origin, specification, costPrice, sellingPrice, stockQuantity, minLimit, barcode, ts);

      const insertComp = db.prepare(`
        INSERT INTO product_compatibility (id, variant_id, car_make, car_model, year_start, year_end, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      compatibility.forEach(comp => {
        const compId = 'comp_' + Math.random().toString(36).substr(2, 9);
        insertComp.run(compId, variantId, comp.carMake, comp.carModel, comp.yearStart, comp.yearEnd, ts);
      });

      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      const queueData = JSON.stringify({
        product: { id: activeProdId, name: productName, category },
        variant: { id: variantId, origin, specification, cost_price: costPrice, selling_price: sellingPrice, stock_quantity: stockQuantity, min_limit: minLimit, sku_barcode: barcode },
        compatibility
      });
      db.prepare(`
        INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(syncId, 'products', 'INSERT', variantId, queueData, 'pending', ts);

      const logId = 'log_' + Math.random().toString(36).substr(2, 9);
      db.prepare(`
        INSERT INTO activity_logs (id, user_id, username, action, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(logId, userId, username, 'PRODUCT_ADDED', `تكويد وإضافة قطعة جديدة: ${productName} (${origin}) باركود: ${barcode}`, ts);
    });

    try {
      transaction();
      return { success: true };
    } catch (e) {
      console.error('Add Product Transaction Failed:', e);
      throw e;
    }
  },

  saveUser: (userData) => {
    const { id, username, password_hash, role, phone } = userData;
    const ts = getTimestamp();

    if (isFallback) {
      const idx = fallbackStore.cashier_users.findIndex(u => u.id === id);
      if (idx !== -1) {
        if (fallbackStore.cashier_users[idx].username === 'admin' || fallbackStore.cashier_users[idx].username === 'احمد مجدي') {
          return { success: false, error: 'Cannot modify primary Admin' };
        }
        fallbackStore.cashier_users[idx].username = username;
        fallbackStore.cashier_users[idx].password_hash = password_hash;
        fallbackStore.cashier_users[idx].role = role;
        fallbackStore.cashier_users[idx].phone = phone;
      } else {
        fallbackStore.cashier_users.push({ id, username, password_hash, role, phone, created_at: ts });
      }
      // Queue for cloud sync
      fallbackStore.sync_queue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'cashier_users',
        operation: 'UPSERT',
        record_id: id,
        data: JSON.stringify({ id, username, password_hash, role, phone }),
        status: 'pending',
        error_message: null,
        created_at: ts
      });
      saveFallbackStore();
      return { success: true };
    }

    try {
      const existing = db.prepare('SELECT username FROM cashier_users WHERE id = ?').get(id);
      if (existing) {
        if (existing.username === 'admin' || existing.username === 'احمد مجدي') {
          return { success: false, error: 'Cannot modify primary Admin' };
        }
        db.prepare('UPDATE cashier_users SET username = ?, password_hash = ?, role = ?, phone = ? WHERE id = ?')
          .run(username, password_hash, role, phone, id);
      } else {
        db.prepare('INSERT INTO cashier_users (id, username, password_hash, role, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, username, password_hash, role, phone, ts);
      }
      // Queue for cloud sync
      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      db.prepare(`INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(syncId, 'cashier_users', 'UPSERT', id, JSON.stringify({ id, username, password_hash, role, phone }), 'pending', ts);
      return { success: true };
    } catch (e) {
      console.error('Save User Failed:', e);
      throw e;
    }
  },

  deleteUser: (userId) => {
    const ts = getTimestamp();
    if (isFallback) {
      const matched = fallbackStore.cashier_users.find(u => u.id === userId);
      if (matched && (matched.username === 'admin' || matched.username === 'احمد مجدي')) {
        return { success: false, error: 'Cannot delete primary Admin' };
      }
      fallbackStore.cashier_users = fallbackStore.cashier_users.filter(u => u.id !== userId);
      // Queue delete for cloud sync
      fallbackStore.sync_queue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'cashier_users_delete',
        operation: 'DELETE',
        record_id: userId,
        data: JSON.stringify({ id: userId }),
        status: 'pending',
        error_message: null,
        created_at: ts
      });
      saveFallbackStore();
      return { success: true };
    }

    try {
      const matched = db.prepare('SELECT username FROM cashier_users WHERE id = ?').get(userId);
      if (matched && (matched.username === 'admin' || matched.username === 'احمد مجدي')) {
        return { success: false, error: 'Cannot delete primary Admin' };
      }
      db.prepare('DELETE FROM cashier_users WHERE id = ?').run(userId);
      // Queue delete for cloud sync
      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      db.prepare(`INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(syncId, 'cashier_users_delete', 'DELETE', userId, JSON.stringify({ id: userId }), 'pending', ts);
      return { success: true };
    } catch (e) {
      console.error('Delete User Failed:', e);
      throw e;
    }
  },

  // ── Full DB Snapshot for complete cloud re-sync ──────────────────────────
  getFullSnapshot: () => {
    if (isFallback) {
      return {
        products: fallbackStore.products || [],
        product_variants: fallbackStore.product_variants || [],
        product_compatibility: fallbackStore.product_compatibility || [],
        suppliers: fallbackStore.suppliers || [],
        supplier_debts: fallbackStore.supplier_debts || [],
        cashier_users: fallbackStore.cashier_users || [],
        sales: fallbackStore.sales || [],
        sale_items: fallbackStore.sale_items || [],
        activity_logs: fallbackStore.activity_logs || []
      };
    }
    return {
      products: db.prepare('SELECT * FROM products').all(),
      product_variants: db.prepare('SELECT * FROM product_variants').all(),
      product_compatibility: db.prepare('SELECT * FROM product_compatibility').all(),
      suppliers: db.prepare('SELECT * FROM suppliers').all(),
      supplier_debts: db.prepare('SELECT * FROM supplier_debts').all(),
      cashier_users: db.prepare('SELECT id, username, password_hash, role, phone, created_at FROM cashier_users').all(),
      sales: db.prepare('SELECT * FROM sales').all(),
      sale_items: db.prepare('SELECT * FROM sale_items').all(),
      activity_logs: db.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 5000').all()
    };
  },

  refundSaleItem: (saleItemId, refundQty, cashierName) => {
    const ts = getTimestamp();
    
    if (isFallback) {
      const item = fallbackStore.sale_items.find(x => x.id === saleItemId);
      if (!item) throw new Error('بند الفاتورة غير موجود');
      if (refundQty > item.quantity) throw new Error('الكمية المرتجعة أكبر من الكمية المباعة');

      const sale = fallbackStore.sales.find(x => x.id === item.sale_id);
      if (!sale) throw new Error('الفاتورة غير موجودة');

      const variant = fallbackStore.product_variants.find(x => x.id === item.variant_id);
      if (variant) {
        variant.stock_quantity += refundQty;
      }

      // Update item quantity
      item.quantity -= refundQty;
      item.total_price = item.quantity * item.unit_price;

      if (item.quantity === 0) {
        fallbackStore.sale_items = fallbackStore.sale_items.filter(x => x.id !== saleItemId);
      }

      // Re-calculate sale totals
      const remainingItems = fallbackStore.sale_items.filter(x => x.sale_id === sale.id);
      const newTotal = remainingItems.reduce((sum, x) => sum + x.total_price, 0);
      sale.total_amount = newTotal;
      sale.final_amount = Math.max(0, newTotal - sale.discount);

      // Queue syncs
      fallbackStore.sync_queue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'sales',
        operation: 'UPDATE',
        record_id: sale.id,
        data: JSON.stringify({ sale, items: remainingItems }),
        status: 'pending',
        error_message: null,
        created_at: ts
      });

      if (variant) {
        fallbackStore.sync_queue.push({
          id: 'sync_' + Math.random().toString(36).substr(2, 9),
          table_name: 'product_variants',
          operation: 'UPDATE',
          record_id: variant.id,
          data: JSON.stringify(variant),
          status: 'pending',
          error_message: null,
          created_at: ts
        });
      }

      // Log Activity
      fallbackStore.activity_logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: 'system',
        username: cashierName,
        action: 'SALE_ITEM_REFUNDED',
        details: `مرتجع جزئي لعدد ${refundQty} من صنف ${item.name} في الفاتورة ${sale.invoice_number}`,
        created_at: ts
      });

      // Save to refund_logs
      if (!fallbackStore.refund_logs) fallbackStore.refund_logs = [];
      fallbackStore.refund_logs.push({
        id: 'ref_' + Math.random().toString(36).substr(2, 9),
        sale_id: sale.id,
        invoice_number: sale.invoice_number,
        variant_id: item.variant_id,
        name: item.name,
        origin: item.origin,
        quantity: refundQty,
        refund_amount: refundQty * item.unit_price,
        cashier_name: cashierName,
        created_at: ts
      });

      saveFallbackStore();
      return { success: true };
    }

    // SQLite mode
    const transaction = db.transaction(() => {
      const item = db.prepare('SELECT * FROM sale_items WHERE id = ?').get(saleItemId);
      if (!item) throw new Error('بند الفاتورة غير موجود');
      if (refundQty > item.quantity) throw new Error('الكمية المرتجعة أكبر من الكمية المباعة');

      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(item.sale_id);
      if (!sale) throw new Error('الفاتورة غير موجودة');

      // Update variant stock
      db.prepare('UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?').run(refundQty, item.variant_id);

      // Update or delete sale item
      const newQty = item.quantity - refundQty;
      if (newQty === 0) {
        db.prepare('DELETE FROM sale_items WHERE id = ?').run(saleItemId);
      } else {
        db.prepare('UPDATE sale_items SET quantity = ?, total_price = ? WHERE id = ?').run(newQty, newQty * item.unit_price, saleItemId);
      }

      // Re-calculate sale totals
      const remaining = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
      const newTotal = remaining.reduce((sum, x) => sum + x.total_price, 0);
      const newFinal = Math.max(0, newTotal - sale.discount);

      db.prepare('UPDATE sales SET total_amount = ?, final_amount = ? WHERE id = ?').run(newTotal, newFinal, sale.id);

      // Queue syncs
      const syncId1 = 'sync_' + Math.random().toString(36).substr(2, 9);
      const updatedSale = { ...sale, total_amount: newTotal, final_amount: newFinal };
      db.prepare(`INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        syncId1,
        'sales',
        'UPDATE',
        sale.id,
        JSON.stringify({ sale: updatedSale, items: remaining }),
        'pending',
        ts
      );

      const syncId2 = 'sync_' + Math.random().toString(36).substr(2, 9);
      const variant = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(item.variant_id);
      if (variant) {
        db.prepare(`INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          syncId2,
          'product_variants',
          'UPDATE',
          variant.id,
          JSON.stringify(variant),
          'pending',
          ts
        );
      }

      // Log Activity
      const logId = 'log_' + Math.random().toString(36).substr(2, 9);
      db.prepare(`INSERT INTO activity_logs (id, user_id, username, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        logId,
        'system',
        cashierName,
        'SALE_ITEM_REFUNDED',
        `مرتجع جزئي لعدد ${refundQty} من صنف ${item.name} في الفاتورة ${sale.invoice_number}`,
        ts
      );

      // Save to refund_logs
      const refundLogId = 'ref_' + Math.random().toString(36).substr(2, 9);
      db.prepare(`
        INSERT INTO refund_logs (id, sale_id, invoice_number, variant_id, name, origin, quantity, refund_amount, cashier_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(refundLogId, sale.id, sale.invoice_number, item.variant_id, item.name, item.origin, refundQty, refundQty * item.unit_price, cashierName, ts);
    });

    try {
      transaction();
      return { success: true };
    } catch (e) {
      console.error('Refund Transaction Failed:', e);
      throw e;
    }
  },

  refundWholeSale: (saleId, cashierName) => {
    const ts = getTimestamp();

    if (isFallback) {
      const sale = fallbackStore.sales.find(x => x.id === saleId);
      if (!sale) throw new Error('الفاتورة غير موجودة');

      const items = fallbackStore.sale_items.filter(x => x.sale_id === saleId);

      // Restore stocks for all items
      items.forEach(item => {
        const variant = fallbackStore.product_variants.find(x => x.id === item.variant_id);
        if (variant) {
          variant.stock_quantity += item.quantity;
          
          fallbackStore.sync_queue.push({
            id: 'sync_' + Math.random().toString(36).substr(2, 9),
            table_name: 'product_variants',
            operation: 'UPDATE',
            record_id: variant.id,
            data: JSON.stringify(variant),
            status: 'pending',
            error_message: null,
            created_at: ts
          });
        }
      });

      // Clear/delete items
      fallbackStore.sale_items = fallbackStore.sale_items.filter(x => x.sale_id !== saleId);

      // Set sale to 0
      sale.total_amount = 0;
      sale.final_amount = 0;

      // Sync sale update
      fallbackStore.sync_queue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'sales',
        operation: 'UPDATE',
        record_id: sale.id,
        data: JSON.stringify({ sale, items: [] }),
        status: 'pending',
        error_message: null,
        created_at: ts
      });

      // Log activity
      fallbackStore.activity_logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: 'system',
        username: cashierName,
        action: 'SALE_REFUNDED',
        details: `مرتجع كامل للفاتورة رقم ${sale.invoice_number} بقيمة ${sale.final_amount} ج.م`,
        created_at: ts
      });

      // Save all to refund_logs
      if (!fallbackStore.refund_logs) fallbackStore.refund_logs = [];
      items.forEach(item => {
        fallbackStore.refund_logs.push({
          id: 'ref_' + Math.random().toString(36).substr(2, 9),
          sale_id: sale.id,
          invoice_number: sale.invoice_number,
          variant_id: item.variant_id,
          name: item.name,
          origin: item.origin,
          quantity: item.quantity,
          refund_amount: item.quantity * item.unit_price,
          cashier_name: cashierName,
          created_at: ts
        });
      });

      saveFallbackStore();
      return { success: true };
    }

    // SQLite mode
    const transaction = db.transaction(() => {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
      if (!sale) throw new Error('الفاتورة غير موجودة');

      const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);

      // Restore stocks and queue syncs
      items.forEach(item => {
        db.prepare('UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?').run(item.quantity, item.variant_id);
        
        const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
        const variant = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(item.variant_id);
        if (variant) {
          db.prepare(`INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
            syncId,
            'product_variants',
            'UPDATE',
            variant.id,
            JSON.stringify(variant),
            'pending',
            ts
          );
        }
      });

      // Delete items
      db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);

      // Set sale to 0
      db.prepare('UPDATE sales SET total_amount = 0, final_amount = 0 WHERE id = ?').run(saleId);

      // Sync sale update
      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      const updatedSale = { ...sale, total_amount: 0, final_amount: 0 };
      db.prepare(`INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        syncId,
        'sales',
        'UPDATE',
        sale.id,
        JSON.stringify({ sale: updatedSale, items: [] }),
        'pending',
        ts
      );

      // Log Activity
      const logId = 'log_' + Math.random().toString(36).substr(2, 9);
      db.prepare(`INSERT INTO activity_logs (id, user_id, username, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        logId,
        'system',
        cashierName,
        'SALE_REFUNDED',
        `مرتجع كامل للفاتورة رقم ${sale.invoice_number}`,
        ts
      );

      // Save all to refund_logs
      const insertRefund = db.prepare(`
        INSERT INTO refund_logs (id, sale_id, invoice_number, variant_id, name, origin, quantity, refund_amount, cashier_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      items.forEach(item => {
        const refundLogId = 'ref_' + Math.random().toString(36).substr(2, 9);
        insertRefund.run(refundLogId, sale.id, sale.invoice_number, item.variant_id, item.name, item.origin, item.quantity, item.quantity * item.unit_price, cashierName, ts);
      });
    });

    try {
      transaction();
      return { success: true };
    } catch (e) {
      console.error('Whole Refund Transaction Failed:', e);
      throw e;
    }
  },

  getRefundLogs: () => {
    if (isFallback) {
      return fallbackStore.refund_logs || [];
    }
    return db.prepare('SELECT * FROM refund_logs ORDER BY created_at DESC').all();
  },

  updateInvoiceDiscount: (saleId, newDiscount, cashierName) => {
    const ts = getTimestamp();
    newDiscount = Number(newDiscount) || 0;
    if (newDiscount < 0) throw new Error('قيمة الخصم لا يمكن أن تكون سالبة');

    if (isFallback) {
      const sale = fallbackStore.sales.find(x => x.id === saleId);
      if (!sale) throw new Error('الفاتورة غير موجودة');
      if (newDiscount > sale.total_amount) throw new Error('قيمة الخصم لا يمكن أن تتجاوز إجمالي الفاتورة');

      const oldDiscount = sale.discount || 0;
      const oldFinal = sale.final_amount;
      const newFinal = Math.max(0, sale.total_amount - newDiscount);
      const diff = oldFinal - newFinal;

      sale.discount = newDiscount;
      sale.final_amount = newFinal;

      if (sale.payment_method === 'DEBT' && sale.credit_customer_id && diff !== 0) {
        const cust = fallbackStore.credit_customers?.find(c => c.id === sale.credit_customer_id);
        if (cust) {
          cust.total_debt = Math.max(0, (cust.total_debt || 0) - diff);
          fallbackStore.sync_queue.push({
            id: 'sync_' + Math.random().toString(36).substr(2, 9),
            table_name: 'credit_customers',
            operation: 'UPDATE',
            record_id: cust.id,
            data: JSON.stringify(cust),
            status: 'pending',
            error_message: null,
            created_at: ts
          });
        }
      }

      const remainingItems = fallbackStore.sale_items.filter(x => x.sale_id === sale.id);
      fallbackStore.sync_queue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'sales',
        operation: 'UPDATE',
        record_id: sale.id,
        data: JSON.stringify({ sale, items: remainingItems }),
        status: 'pending',
        error_message: null,
        created_at: ts
      });

      fallbackStore.activity_logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: 'system',
        username: cashierName,
        action: 'INVOICE_DISCOUNT_UPDATED',
        details: `تعديل خصم الفاتورة ${sale.invoice_number} من ${oldDiscount} ج.م إلى ${newDiscount} ج.م (الصافي الجديد: ${newFinal} ج.م)`,
        created_at: ts
      });

      saveFallbackStore();
      return { success: true, updatedSale: sale };
    }

    // SQLite mode
    const transaction = db.transaction(() => {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
      if (!sale) throw new Error('الفاتورة غير موجودة');
      if (newDiscount > sale.total_amount) throw new Error('قيمة الخصم لا يمكن أن تتجاوز إجمالي الفاتورة');

      const oldDiscount = sale.discount || 0;
      const oldFinal = sale.final_amount;
      const newFinal = Math.max(0, sale.total_amount - newDiscount);
      const diff = oldFinal - newFinal;

      db.prepare('UPDATE sales SET discount = ?, final_amount = ? WHERE id = ?').run(newDiscount, newFinal, saleId);

      if (sale.payment_method === 'DEBT' && sale.credit_customer_id && diff !== 0) {
        db.prepare('UPDATE credit_customers SET total_debt = MAX(0, total_debt - ?) WHERE id = ?').run(diff, sale.credit_customer_id);
        const cust = db.prepare('SELECT * FROM credit_customers WHERE id = ?').get(sale.credit_customer_id);
        if (cust) {
          const syncCustId = 'sync_' + Math.random().toString(36).substr(2, 9);
          db.prepare(`INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
            syncCustId,
            'credit_customers',
            'UPDATE',
            cust.id,
            JSON.stringify(cust),
            'pending',
            ts
          );
        }
      }

      const remainingItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
      const updatedSale = { ...sale, discount: newDiscount, final_amount: newFinal };
      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      db.prepare(`INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        syncId,
        'sales',
        'UPDATE',
        sale.id,
        JSON.stringify({ sale: updatedSale, items: remainingItems }),
        'pending',
        ts
      );

      const logId = 'log_' + Math.random().toString(36).substr(2, 9);
      db.prepare(`INSERT INTO activity_logs (id, user_id, username, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
        logId,
        'system',
        cashierName,
        'INVOICE_DISCOUNT_UPDATED',
        `تعديل خصم الفاتورة ${sale.invoice_number} من ${oldDiscount} ج.م إلى ${newDiscount} ج.م (الصافي الجديد: ${newFinal} ج.م)`,
        ts
      );
    });

    transaction();
    const updatedSale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    return { success: true, updatedSale };
  },

  // ── Credit Customers ──────────────────────────────────────────────────────

  getCreditCustomers: () => {
    if (isFallback) {
      return fallbackStore.credit_customers || [];
    }
    return db.prepare('SELECT * FROM credit_customers ORDER BY name').all();
  },

  saveCreditCustomer: (customerData) => {
    const ts = getTimestamp();
    const { id, name, phone, address, notes } = customerData;
    const custId = id || ('cust_' + Math.random().toString(36).substr(2, 9));

    if (isFallback) {
      if (!fallbackStore.credit_customers) fallbackStore.credit_customers = [];
      const existingIdx = fallbackStore.credit_customers.findIndex(c => c.id === custId);
      if (existingIdx >= 0) {
        fallbackStore.credit_customers[existingIdx] = {
          ...fallbackStore.credit_customers[existingIdx],
          name, phone, address, notes
        };
      } else {
        fallbackStore.credit_customers.push({ id: custId, name, phone, address, notes, total_debt: 0, created_at: ts });
      }
      saveFallbackStore();
      return { success: true, id: custId };
    }

    try {
      const existing = db.prepare('SELECT id FROM credit_customers WHERE id = ?').get(custId);
      if (existing) {
        db.prepare('UPDATE credit_customers SET name=?, phone=?, address=?, notes=? WHERE id=?')
          .run(name, phone || null, address || null, notes || null, custId);
      } else {
        db.prepare('INSERT INTO credit_customers (id, name, phone, address, notes, total_debt, created_at) VALUES (?,?,?,?,?,0,?)')
          .run(custId, name, phone || null, address || null, notes || null, ts);
      }
      return { success: true, id: custId };
    } catch (e) {
      console.error('Save Credit Customer Failed:', e);
      throw e;
    }
  },

  deleteCreditCustomer: (customerId) => {
    const ts = getTimestamp();
    const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
    if (isFallback) {
      if (!fallbackStore.credit_customers) fallbackStore.credit_customers = [];
      fallbackStore.credit_customers = fallbackStore.credit_customers.filter(c => c.id !== customerId);
      if (fallbackStore.customer_payments) {
        fallbackStore.customer_payments = fallbackStore.customer_payments.filter(p => p.customer_id !== customerId);
      }
      fallbackStore.sync_queue.push({
        id: syncId,
        table_name: 'credit_customers_delete',
        operation: 'DELETE',
        record_id: customerId,
        data: JSON.stringify({ id: customerId }),
        status: 'pending',
        created_at: ts
      });
      saveFallbackStore();
      return { success: true };
    }
    try {
      db.prepare('DELETE FROM customer_payments WHERE customer_id = ?').run(customerId);
      db.prepare('DELETE FROM credit_customers WHERE id = ?').run(customerId);
      db.prepare('INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(syncId, 'credit_customers_delete', 'DELETE', customerId, JSON.stringify({ id: customerId }), 'pending', ts);
      return { success: true };
    } catch (e) {
      console.error('Delete Credit Customer Failed:', e);
      throw e;
    }
  },

  addCustomerPayment: (customerId, amount, notes, cashierName) => {
    const ts = getTimestamp();
    const payId = 'pay_' + Math.random().toString(36).substr(2, 9);

    if (isFallback) {
      if (!fallbackStore.credit_customers) fallbackStore.credit_customers = [];
      if (!fallbackStore.customer_payments) fallbackStore.customer_payments = [];
      const cust = fallbackStore.credit_customers.find(c => c.id === customerId);
      if (!cust) throw new Error('العميل غير موجود');
      cust.total_debt = Math.max(0, (cust.total_debt || 0) - amount);
      fallbackStore.customer_payments.push({ id: payId, customer_id: customerId, amount, notes: notes || '', created_at: ts });
      fallbackStore.activity_logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: 'system', username: cashierName,
        action: 'CUSTOMER_PAYMENT',
        details: `دفعة ${amount} ج.م من العميل ${cust.name}`,
        created_at: ts
      });
      saveFallbackStore();
      return { success: true };
    }

    const transaction = db.transaction(() => {
      const cust = db.prepare('SELECT * FROM credit_customers WHERE id = ?').get(customerId);
      if (!cust) throw new Error('العميل غير موجود');
      db.prepare('INSERT INTO customer_payments (id, customer_id, amount, notes, created_at) VALUES (?,?,?,?,?)')
        .run(payId, customerId, amount, notes || null, ts);
      db.prepare('UPDATE credit_customers SET total_debt = MAX(0, total_debt - ?) WHERE id = ?').run(amount, customerId);
      const logId = 'log_' + Math.random().toString(36).substr(2, 9);
      db.prepare('INSERT INTO activity_logs (id, user_id, username, action, details, created_at) VALUES (?,?,?,?,?,?)')
        .run(logId, 'system', cashierName, 'CUSTOMER_PAYMENT', `دفعة ${amount} ج.م من العميل ${cust.name}`, ts);
    });
    try {
      transaction();
      return { success: true };
    } catch (e) {
      console.error('Add Customer Payment Failed:', e);
      throw e;
    }
  },

  getCustomerDetails: (customerId) => {
    if (isFallback) {
      const cust = (fallbackStore.credit_customers || []).find(c => c.id === customerId);
      const payments = (fallbackStore.customer_payments || []).filter(p => p.customer_id === customerId);
      const sales = (fallbackStore.sales || []).filter(s => s.credit_customer_id === customerId);
      return { customer: cust, payments, sales };
    }
    const customer = db.prepare('SELECT * FROM credit_customers WHERE id = ?').get(customerId);
    const payments = db.prepare('SELECT * FROM customer_payments WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
    const sales = db.prepare('SELECT * FROM sales WHERE credit_customer_id = ? ORDER BY created_at DESC').all(customerId);
    return { customer, payments, sales };
  },

  updateCustomerDebt: (customerId, additionalAmount) => {
    // Called after a DEBT sale is made
    if (isFallback) {
      if (!fallbackStore.credit_customers) fallbackStore.credit_customers = [];
      const cust = fallbackStore.credit_customers.find(c => c.id === customerId);
      if (cust) {
        cust.total_debt = (cust.total_debt || 0) + additionalAmount;
        saveFallbackStore();
      }
      return { success: true };
    }
    try {
      db.prepare('UPDATE credit_customers SET total_debt = total_debt + ? WHERE id = ?').run(additionalAmount, customerId);
      return { success: true };
    } catch (e) {
      console.error('Update Customer Debt Failed:', e);
      throw e;
    }
  },

  deleteProduct: (productId) => {
    const ts = getTimestamp();
    if (isFallback) {
      const vars = (fallbackStore.product_variants || []).filter(v => v.product_id === productId);
      const varIds = vars.map(v => v.id);
      
      // Update fallback sale items to NULL variant_id for all these variants
      if (fallbackStore.sale_items) {
        fallbackStore.sale_items.forEach(item => {
          if (varIds.includes(item.variant_id)) {
            item.variant_id = null;
          }
        });
      }
      
      fallbackStore.products = (fallbackStore.products || []).filter(p => p.id !== productId);
      fallbackStore.product_variants = (fallbackStore.product_variants || []).filter(v => v.product_id !== productId);
      fallbackStore.product_compatibility = (fallbackStore.product_compatibility || []).filter(c => !varIds.includes(c.variant_id));
      
      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      fallbackStore.sync_queue.push({
        id: syncId,
        table_name: 'products_delete',
        operation: 'DELETE',
        record_id: productId,
        data: JSON.stringify({ id: productId }),
        status: 'pending',
        created_at: ts
      });
      saveFallbackStore();
      return { success: true };
    }
    
    const transaction = db.transaction(() => {
      const vars = db.prepare('SELECT id FROM product_variants WHERE product_id = ?').all(productId);
      const varIds = vars.map(v => v.id);
      
      if (varIds.length > 0) {
        const placeholders = varIds.map(() => '?').join(',');
        
        // Detach all variants from sale_items to satisfy foreign key constraints
        db.prepare(`UPDATE sale_items SET variant_id = NULL WHERE variant_id IN (${placeholders})`).run(...varIds);
        
        db.prepare(`DELETE FROM product_compatibility WHERE variant_id IN (${placeholders})`).run(...varIds);
        db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(productId);
      }
      db.prepare('DELETE FROM products WHERE id = ?').run(productId);
      
      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      db.prepare('INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(syncId, 'products_delete', 'DELETE', productId, JSON.stringify({ id: productId }), 'pending', ts);
    });
    
    try {
      transaction();
      return { success: true };
    } catch (e) {
      console.error('Delete Product Failed:', e);
      throw e;
    }
  },

  deleteVariant: (variantId) => {
    const ts = getTimestamp();
    if (isFallback) {
      const v = (fallbackStore.product_variants || []).find(v => v.id === variantId);
      if (!v) return { success: true };
      
      // Update fallback sale items to NULL variant_id
      if (fallbackStore.sale_items) {
        fallbackStore.sale_items.forEach(item => {
          if (item.variant_id === variantId) {
            item.variant_id = null;
          }
        });
      }

      fallbackStore.product_variants = (fallbackStore.product_variants || []).filter(varObj => varObj.id !== variantId);
      fallbackStore.product_compatibility = (fallbackStore.product_compatibility || []).filter(c => c.variant_id !== variantId);
      
      const hasMore = (fallbackStore.product_variants || []).some(varObj => varObj.product_id === v.product_id);
      if (!hasMore) {
        fallbackStore.products = (fallbackStore.products || []).filter(p => p.id !== v.product_id);
      }
      
      fallbackStore.sync_queue.push({
        id: 'sync_' + Math.random().toString(36).substr(2, 9),
        table_name: 'product_variants_delete',
        operation: 'DELETE',
        record_id: variantId,
        data: JSON.stringify({ id: variantId, product_id: v.product_id, deleteProduct: !hasMore }),
        status: 'pending',
        created_at: ts
      });
      saveFallbackStore();
      return { success: true };
    }
    
    const transaction = db.transaction(() => {
      const v = db.prepare('SELECT product_id FROM product_variants WHERE id = ?').get(variantId);
      if (!v) return { success: true };
      
      // Detach from sale_items to bypass foreign key constraint restrictions
      db.prepare('UPDATE sale_items SET variant_id = NULL WHERE variant_id = ?').run(variantId);
      
      db.prepare('DELETE FROM product_compatibility WHERE variant_id = ?').run(variantId);
      db.prepare('DELETE FROM product_variants WHERE id = ?').run(variantId);
      
      const hasMore = db.prepare('SELECT count(*) as count FROM product_variants WHERE product_id = ?').get(v.product_id).count > 0;
      if (!hasMore) {
        db.prepare('DELETE FROM products WHERE id = ?').run(v.product_id);
      }
      
      const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
      db.prepare('INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(syncId, 'product_variants_delete', 'DELETE', variantId, JSON.stringify({ id: variantId, product_id: v.product_id, deleteProduct: !hasMore }), 'pending', ts);
    });
    
    try {
      transaction();
      return { success: true };
    } catch (e) {
      console.error('Delete Variant Failed:', e);
      throw e;
    }
  },

  deleteSupplier: (supplierId) => {
    const ts = getTimestamp();
    const syncId = 'sync_' + Math.random().toString(36).substr(2, 9);
    if (isFallback) {
      fallbackStore.suppliers = (fallbackStore.suppliers || []).filter(s => s.id !== supplierId);
      fallbackStore.supplier_debts = (fallbackStore.supplier_debts || []).filter(d => d.supplier_id !== supplierId);
      fallbackStore.sync_queue.push({
        id: syncId,
        table_name: 'suppliers_delete',
        operation: 'DELETE',
        record_id: supplierId,
        data: JSON.stringify({ id: supplierId }),
        status: 'pending',
        created_at: ts
      });
      saveFallbackStore();
      return { success: true };
    }
    try {
      db.prepare('DELETE FROM supplier_debts WHERE supplier_id = ?').run(supplierId);
      db.prepare('DELETE FROM suppliers WHERE id = ?').run(supplierId);
      db.prepare('INSERT INTO sync_queue (id, table_name, operation, record_id, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(syncId, 'suppliers_delete', 'DELETE', supplierId, JSON.stringify({ id: supplierId }), 'pending', ts);
      return { success: true };
    } catch (e) {
      console.error('Delete Supplier Failed:', e);
      throw e;
    }
  },

  resetAllInvoices: (cashierName) => {
    const ts = getTimestamp();
    if (isFallback) {
      fallbackStore.sales = [];
      fallbackStore.sale_items = [];
      fallbackStore.refund_logs = [];
      fallbackStore.customer_payments = [];
      fallbackStore.supplier_debts = [];
      fallbackStore.sync_queue = [];
      
      if (fallbackStore.suppliers) {
        fallbackStore.suppliers.forEach(s => { s.current_debt = 0; });
      }
      if (fallbackStore.credit_customers) {
        fallbackStore.credit_customers.forEach(c => { c.total_debt = 0; });
      }
      
      fallbackStore.activity_logs.push({
        id: 'log_' + Math.random().toString(36).substr(2, 9),
        user_id: 'system',
        username: cashierName,
        action: 'DATABASE_RESET',
        details: 'تم تصفير جميع فواتير وحسابات النظام بالكامل بواسطة الأدمن.',
        created_at: ts
      });
      saveFallbackStore();
      return { success: true };
    }
    
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM sales;').run();
      db.prepare('DELETE FROM sale_items;').run();
      db.prepare('DELETE FROM refund_logs;').run();
      db.prepare('DELETE FROM customer_payments;').run();
      db.prepare('DELETE FROM supplier_debts;').run();
      db.prepare('DELETE FROM sync_queue;').run();
      db.prepare('UPDATE suppliers SET current_debt = 0;').run();
      db.prepare('UPDATE credit_customers SET total_debt = 0;').run();
      
      const logId = 'log_' + Math.random().toString(36).substr(2, 9);
      db.prepare('INSERT INTO activity_logs (id, user_id, username, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(logId, 'system', cashierName, 'DATABASE_RESET', 'تم تصفير جميع فواتير وحسابات النظام بالكامل بواسطة الأدمن.', ts);
    });
    
    try {
      transaction();
      return { success: true };
    } catch (e) {
      console.error('Reset Database Failed:', e);
      throw e;
    }
  }
};

module.exports = {
  initDb,
  handlers,
  isFallback,
  dbPath
};
