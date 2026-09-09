-- ==================================================================================
-- SUPABASE POSTGRESQL SCHEMA FOR AUTO PARTS CASHIER & INVENTORY SYSTEM
-- ==================================================================================
-- INSTRUCTIONS:
-- 1. Log in to your Supabase Dashboard (https://supabase.com).
-- 2. Go to your Project -> SQL Editor.
-- 3. Click "New Query", paste the entire contents of this file, and click "Run".
-- ==================================================================================

-- 1. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    min_limit_general INTEGER DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. PRODUCT VARIANTS TABLE
CREATE TABLE IF NOT EXISTS product_variants (
    id TEXT PRIMARY KEY,
    product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
    origin TEXT NOT NULL,
    specification TEXT,
    cost_price NUMERIC(12, 2) NOT NULL,
    selling_price NUMERIC(12, 2) NOT NULL,
    stock_quantity INTEGER NOT NULL,
    min_limit INTEGER NOT NULL,
    sku_barcode TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. PRODUCT COMPATIBILITY TABLE
CREATE TABLE IF NOT EXISTS product_compatibility (
    id TEXT PRIMARY KEY,
    variant_id TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
    car_make TEXT NOT NULL,
    car_model TEXT NOT NULL,
    year_start INTEGER NOT NULL,
    year_end INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 4. SALES TABLE
CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    invoice_number TEXT UNIQUE NOT NULL,
    cashier_id TEXT,
    cashier_name TEXT NOT NULL,
    customer_name TEXT,
    total_amount NUMERIC(12, 2) NOT NULL,
    discount NUMERIC(12, 2) DEFAULT 0,
    final_amount NUMERIC(12, 2) NOT NULL,
    payment_method TEXT CHECK (payment_method IN ('CASH', 'CARD', 'DEBT')) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 5. SALE ITEMS TABLE
CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT REFERENCES sales(id) ON DELETE CASCADE,
    variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    origin TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    cost_price NUMERIC(12, 2) NOT NULL,
    total_price NUMERIC(12, 2) NOT NULL
);

-- 6. SUPPLIERS TABLE
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    current_debt NUMERIC(12, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 7. SUPPLIER DEBTS TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS supplier_debts (
    id TEXT PRIMARY KEY,
    supplier_id TEXT REFERENCES suppliers(id) ON DELETE CASCADE,
    transaction_type TEXT CHECK (transaction_type IN ('PURCHASE_DEBT', 'PAYMENT', 'SETTLEMENT')) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    previous_debt NUMERIC(12, 2) NOT NULL,
    new_debt NUMERIC(12, 2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 8. CASHIER USERS TABLE
CREATE TABLE IF NOT EXISTS cashier_users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT CHECK (role IN ('ADMIN', 'CASHIER')) NOT NULL,
    phone TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 9. AUDIT ACTIVITY LOGS TABLE
CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- ==================================================================================
-- ROW LEVEL SECURITY (RLS) CONFIGURATION
-- Disabling RLS allows the frontend client and offline app to query tables immediately.
-- ==================================================================================
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_compatibility DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers DISABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_debts DISABLE ROW LEVEL SECURITY;
ALTER TABLE cashier_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;

-- Seed default admin account
INSERT INTO cashier_users (id, username, password_hash, role, phone)
VALUES ('u1_custom', 'احمد مجدي', 'admin123', 'ADMIN', '01022222222')
ON CONFLICT (username) DO NOTHING;
