// ==================================================================================
// GATEWAY CLOUD MONITORING APPLICATION LOGIC (Vanilla JS + Supabase SDK)
// ==================================================================================

// Default Fallback Credentials
const DEFAULT_URL = "https://yxbazuscpyyfzerhflau.supabase.co";
const DEFAULT_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4YmF6dXNjcHl5ZnplcmhmbGF1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzUyMDI3NiwiZXhwIjoyMDk5MDk2Mjc2fQ.H8IbRO5dOAxQuH3qtz-4toYgGeNsbbz-_pUO781cYNE";

// *** Renamed from 'supabase' to 'sbClient' to avoid conflict with window.supabase CDN global ***
let sbClient = null;

// Global cached state
let dbData = {
  sales: [],
  saleItems: [],
  products: [],
  variants: [],
  suppliers: [],
  supplierDebts: [],
  users: [],
  logs: []
};

let activeTab = 'analytics';
let revenueChart = null;
let paymentChart = null;

// ==================================================================================
// 1. APPLICATION INIT
// ==================================================================================
window.addEventListener('DOMContentLoaded', () => {
  // Theme check
  updateThemeIcon();

  const sUrl = localStorage.getItem('supabase_url_2') || DEFAULT_URL;
  const sKey = localStorage.getItem('supabase_anon_key_2') || DEFAULT_KEY;

  const urlInput = document.getElementById('setup-url');
  const keyInput = document.getElementById('setup-key');
  if (urlInput) urlInput.value = sUrl;
  if (keyInput) keyInput.value = sKey;

  if (sUrl && sKey) {
    try {
      sbClient = window.supabase.createClient(sUrl, sKey);
      localStorage.setItem('supabase_url_2', sUrl);
      localStorage.setItem('supabase_anon_key_2', sKey);
      checkSession();
    } catch (err) {
      console.error("Initialization error:", err);
      showSetupScreen();
    }
  } else {
    showSetupScreen();
  }

  const setupForm = document.getElementById('setup-form');
  const loginForm = document.getElementById('login-form');
  if (setupForm) setupForm.addEventListener('submit', handleSetupSubmit);
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

  // Auto-refresh every 30 seconds when logged in
  setInterval(() => {
    if (sbClient && document.getElementById('main-app') && !document.getElementById('main-app').classList.contains('hidden')) {
      fetchDatabaseData();
    }
  }, 30000);
});

// ==================================================================================
// Theme Switching Logic
// ==================================================================================
function toggleTheme() {
  const html = document.documentElement;
  if (html.classList.contains('dark')) {
    html.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  } else {
    html.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  }
  updateThemeIcon();
  
  // Re-render charts to adjust text/grid colors dynamically
  if (dbData.sales.length > 0) {
    compileAnalytics();
  }
}

function updateThemeIcon() {
  const isDark = document.documentElement.classList.contains('dark');
  const sunIcon = document.getElementById('theme-sun');
  const moonIcon = document.getElementById('theme-moon');
  if (sunIcon && moonIcon) {
    if (isDark) {
      sunIcon.classList.remove('hidden');
      moonIcon.classList.add('hidden');
    } else {
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    }
  }
}

// ==================================================================================
// 2. SETUP CONTROLLER
// ==================================================================================
function showSetupScreen() {
  document.getElementById('setup-screen').classList.remove('hidden');
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-app').classList.add('hidden');
}

function handleSetupSubmit(e) {
  e.preventDefault();
  const url = document.getElementById('setup-url').value.trim();
  const key = document.getElementById('setup-key').value.trim();
  if (url && key) {
    localStorage.setItem('supabase_url_2', url);
    localStorage.setItem('supabase_anon_key_2', key);
    window.location.reload();
  }
}

// ==================================================================================
// 3. SESSION MANAGER
// ==================================================================================
function checkSession() {
  document.getElementById('setup-screen').classList.add('hidden');
  const sessionRaw = localStorage.getItem('admin_session_2');
  if (sessionRaw) {
    try {
      const session = JSON.parse(sessionRaw);
      if (session && session.loggedIn) {
        showMainApp(session.username);
        return;
      }
    } catch (e) {
      localStorage.removeItem('admin_session_2');
    }
  }
  showLoginScreen();
}

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('main-app').classList.add('hidden');
}

function showMainApp(username) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  const nameEl = document.getElementById('user-display-name');
  if (nameEl) nameEl.textContent = username;
  fetchDatabaseData();
}

// ==================================================================================
// 4. LOGIN HANDLER
// ==================================================================================
async function handleLoginSubmit(e) {
  e.preventDefault();
  const userField = document.getElementById('login-username').value.trim();
  const passField = document.getElementById('login-password').value;
  const submitBtn = document.getElementById('login-submit');
  const errDiv = document.getElementById('login-error');
  const errText = document.getElementById('login-error-text');

  if (errDiv) errDiv.classList.add('hidden');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري التحقق من الصلاحيات...'; }

  try {
    let isAuthenticated = false;

    if (sbClient) {
      const { data, error } = await sbClient
        .from('cashier_users')
        .select('id, username, role')
        .eq('username', userField)
        .eq('password_hash', passField)
        .eq('role', 'ADMIN');

      if (!error && data && data.length > 0) isAuthenticated = true;
    }

    // Local fallback check
    if (!isAuthenticated) {
      if (userField === 'admin' && passField === 'admin123') {
        isAuthenticated = true;
      }
    }

    if (isAuthenticated) {
      const session = { loggedIn: true, username: userField, loginTime: new Date().toISOString() };
      localStorage.setItem('admin_session_2', JSON.stringify(session));
      showMainApp(userField);
    } else {
      if (errText) errText.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب لا يملك صلاحية ADMIN سحابياً.';
      if (errDiv) errDiv.classList.remove('hidden');
    }
  } catch (err) {
    console.error(err);
    if (errText) errText.textContent = 'حدث خطأ بالشبكة، يرجى تفعيل مفاتيح CORS أو مراجعة إعدادات الجدول.';
    if (errDiv) errDiv.classList.remove('hidden');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'تسجيل الدخول الآمن'; }
  }
}

function handleLogout() {
  localStorage.removeItem('admin_session_2');
  showLoginScreen();
}

// ==================================================================================
// 5. DATABASE DATA FETCHING
// ==================================================================================
async function fetchDatabaseData() {
  if (!sbClient) { showSetupScreen(); return; }

  const loader = document.getElementById('loading-overlay');
  const tabContent = document.getElementById('tab-content');

  if (loader) loader.classList.remove('hidden');
  if (tabContent) tabContent.classList.add('opacity-30', 'pointer-events-none');

  try {
    const [
      salesRes, itemsRes, prodsRes, varsRes,
      supsRes, debtsRes, usersRes, logsRes
    ] = await Promise.all([
      sbClient.from('sales').select('*').order('created_at', { ascending: false }),
      sbClient.from('sale_items').select('*'),
      sbClient.from('products').select('*'),
      sbClient.from('product_variants').select('*'),
      sbClient.from('suppliers').select('*').order('name', { ascending: true }),
      sbClient.from('supplier_debts').select('*').order('created_at', { ascending: false }),
      sbClient.from('cashier_users').select('id, username, role, phone, created_at').order('created_at', { ascending: true }),
      sbClient.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(200)
    ]);

    dbData.sales = salesRes.data || [];
    dbData.saleItems = itemsRes.data || [];
    dbData.products = prodsRes.data || [];
    dbData.variants = varsRes.data || [];
    dbData.suppliers = supsRes.data || [];
    dbData.supplierDebts = debtsRes.data || [];
    dbData.users = usersRes.data || [];
    dbData.logs = logsRes.data || [];

    // Update connection status badge
    const statusBadge = document.getElementById('connection-badge');
    if (statusBadge) {
      statusBadge.textContent = '🟢 متصل بالسحابة';
      statusBadge.className = 'text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full';
    }

    compileAnalytics();
    renderInventoryTable();
    renderInvoicesTable();
    renderSuppliersList();
    renderUsersTable();
    renderActivityLogsTable();

  } catch (err) {
    console.error("Supabase sync loading error:", err);
    const statusBadge = document.getElementById('connection-badge');
    if (statusBadge) {
      statusBadge.textContent = '🔴 خطأ في الاتصال';
      statusBadge.className = 'text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full';
    }
  } finally {
    if (loader) loader.classList.add('hidden');
    if (tabContent) tabContent.classList.remove('opacity-30', 'pointer-events-none');
  }
}

// ==================================================================================
// 6. TAB CONTROLLER
// ==================================================================================
function switchTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll('section[id^="screen-"]').forEach(sec => sec.classList.add('hidden'));
  const screen = document.getElementById(`screen-${tabId}`);
  if (screen) screen.classList.remove('hidden');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.className = "tab-btn px-4 py-2 rounded-lg text-xs font-bold transition-all text-slate-400 hover:text-slate-200";
  });
  const activeBtn = document.getElementById(`btn-${tabId}`);
  if (activeBtn) activeBtn.className = "tab-btn px-4 py-2 rounded-lg text-xs font-bold transition-all bg-blue-600 text-white shadow-md";

  document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
    btn.className = "mobile-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-slate-400";
  });
  const mActiveBtn = document.getElementById(`m-btn-${tabId}`);
  if (mActiveBtn) mActiveBtn.className = "mobile-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-blue-600 text-white";

  if (tabId === 'suppliers' && dbData.suppliers.length > 0) {
    selectSupplier(dbData.suppliers[0].id);
  }
}

// ==================================================================================
// 7. ANALYTICS METRIC BUILDER
// ==================================================================================
function compileAnalytics() {
  let totalRevenue = 0, totalCost = 0, cashSales = 0, vodaSales = 0;

  dbData.sales.forEach(sale => {
    totalRevenue += (sale.final_amount || 0);
    const isVoda = sale.payment_method === 'CARD' || (sale.customer_name && sale.customer_name.includes('فودافون كاش'));
    if (isVoda) vodaSales += (sale.final_amount || 0);
    else cashSales += (sale.final_amount || 0);
  });

  dbData.saleItems.forEach(item => {
    totalCost += ((item.cost_price || 0) * (item.quantity || 0));
  });

  const netProfit = totalRevenue - totalCost;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
  set('stat-revenue', `${totalRevenue.toLocaleString('ar-EG')} <span class="text-xs font-normal">ج.م</span>`);
  set('stat-cost', `${totalCost.toLocaleString('ar-EG')} <span class="text-xs font-normal">ج.م</span>`);
  set('stat-profit', `${netProfit.toLocaleString('ar-EG')} <span class="text-xs font-normal">ج.م</span>`);
  set('stat-invoices', dbData.sales.length);

  const cashEl = document.getElementById('cash-payment-val');
  const vodaEl = document.getElementById('voda-payment-val');
  if (cashEl) cashEl.textContent = `${cashSales.toLocaleString('ar-EG')} ج.م`;
  if (vodaEl) vodaEl.textContent = `${vodaSales.toLocaleString('ar-EG')} ج.م`;

  renderChartGraphics(cashSales, vodaSales);

  // Top 5 selling items
  const itemMap = {};
  dbData.saleItems.forEach(item => {
    const vId = item.variant_id || 'unknown';
    if (!itemMap[vId]) itemMap[vId] = { name: item.name || 'غير معروف', origin: item.origin || '', qty: 0, revenue: 0 };
    itemMap[vId].qty += (item.quantity || 0);
    itemMap[vId].revenue += (item.total_price || 0);
  });

  const sortedTop = Object.values(itemMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const topItemsTbody = document.getElementById('top-items-tbody');
  if (topItemsTbody) {
    topItemsTbody.innerHTML = sortedTop.length === 0
      ? '<tr><td colspan="3" class="py-6 text-center text-slate-500">لا توجد مبيعات مسجلة لعرض تحليلات الأصناف.</td></tr>'
      : sortedTop.map(item => `
          <tr class="hover:bg-slate-900/40">
            <td class="py-3 px-4 font-bold text-slate-200">${item.name} <span class="text-[10px] text-slate-400 font-normal">(${item.origin})</span></td>
            <td class="py-3 px-4 text-center text-blue-400 font-black">${item.qty} قطع</td>
            <td class="py-3 px-4 text-left text-emerald-500 font-black">${item.revenue.toLocaleString('ar-EG')} ج.م</td>
          </tr>`).join('');
  }

  // Recent 5 invoices
  const recentList = document.getElementById('recent-invoices-list');
  if (recentList) {
    const topRecent = dbData.sales.slice(0, 5);
    recentList.innerHTML = topRecent.length === 0
      ? '<p class="text-xs text-slate-500 text-center py-6">لا توجد فواتير مبيعات سحابية.</p>'
      : topRecent.map(sale => {
          const dateStr = sale.created_at ? new Date(sale.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '';
          return `
            <div class="bg-slate-900/60 border border-slate-800 p-2.5 rounded-xl flex justify-between items-center text-xs">
              <div>
                <span class="font-bold text-white">${sale.invoice_number}</span>
                <p class="text-[9px] text-slate-400 mt-1 truncate max-w-[170px]">${sale.customer_name || 'عميل نقدي'}</p>
              </div>
              <div class="text-left shrink-0">
                <span class="font-black text-emerald-500">${(sale.final_amount || 0).toFixed(0)} ج.م</span>
                <p class="text-[8px] text-slate-400 font-mono mt-0.5">${dateStr}</p>
              </div>
            </div>`;
        }).join('');
  }
}

// ==================================================================================
// 8. CHARTS
// ==================================================================================
function renderChartGraphics(cashAmt, vodaAmt) {
  const isDark = document.documentElement.classList.contains('dark');
  const textColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)';
  const panelBgColor = isDark ? '#0f172a' : '#ffffff';

  const ctxPay = document.getElementById('payment-chart');
  if (ctxPay) {
    if (paymentChart) paymentChart.destroy();
    paymentChart = new Chart(ctxPay.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['نقدي / كاش', 'فودافون كاش'],
        datasets: [{ data: [cashAmt, vodaAmt], backgroundColor: ['#10b981', '#f43f5e'], borderWidth: 2, borderColor: panelBgColor }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '70%' }
    });
  }

  const ctxRev = document.getElementById('revenue-chart');
  if (ctxRev) {
    if (revenueChart) revenueChart.destroy();
    const dateMap = {};
    dbData.sales.forEach(sale => {
      if (!sale.created_at) return;
      const d = sale.created_at.substring(0, 10);
      dateMap[d] = (dateMap[d] || 0) + (sale.final_amount || 0);
    });
    const sortedDates = Object.keys(dateMap).sort();
    revenueChart = new Chart(ctxRev.getContext('2d'), {
      type: 'line',
      data: {
        labels: sortedDates.length > 0 ? sortedDates.map(d => { const p = d.split('-'); return `${p[2]}/${p[1]}`; }) : ['اليوم'],
        datasets: [{
          label: 'الإيرادات اليومية',
          data: sortedDates.length > 0 ? sortedDates.map(d => dateMap[d]) : [0],
          borderColor: '#3b82f6', backgroundColor: isDark ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)',
          borderWidth: 3, fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: '#2563eb'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Cairo', size: 9 } } },
          x: { grid: { display: false }, ticks: { color: textColor, font: { family: 'Cairo', size: 9 } } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }
}

// ==================================================================================
// 9. INVENTORY TABLE
// ==================================================================================
function renderInventoryTable(filterTerm = '') {
  const tbody = document.getElementById('inventory-tbody');
  if (!tbody) return;

  const term = filterTerm.toLowerCase();
  const filtered = dbData.variants.filter(v => {
    const prod = dbData.products.find(p => p.id === v.product_id) || {};
    const name = (v.product_name || prod.name || '').toLowerCase();
    return name.includes(term) || (v.sku_barcode || '').toLowerCase().includes(term)
      || (v.origin || '').toLowerCase().includes(term) || (v.specification || '').toLowerCase().includes(term);
  });

  tbody.innerHTML = filtered.length === 0
    ? '<tr><td colspan="8" class="py-8 text-center text-slate-500">لا توجد قطع غيار مطابقة للبحث.</td></tr>'
    : filtered.map(v => {
        const prod = dbData.products.find(p => p.id === v.product_id) || {};
        const isLow = (v.stock_quantity || 0) <= (v.min_limit || 0);
        return `
          <tr class="${isLow ? 'low-stock-row' : 'hover:bg-slate-900/40'} transition-all">
            <td class="py-4 px-6 font-bold text-white">
              <div>${v.product_name || prod.name || 'غير معروف'}</div>
              <div class="text-[10px] text-slate-400 font-mono mt-1">${v.sku_barcode || ''}</div>
            </td>
            <td class="py-4 px-6 text-slate-300 font-bold">${v.category || prod.category || 'عام'}</td>
            <td class="py-4 px-6 font-bold text-slate-200">${v.origin || ''}</td>
            <td class="py-4 px-6 text-slate-400 font-semibold">${v.specification || 'عام'}</td>
            <td class="py-4 px-6 text-center">
              <span class="px-3 py-1 rounded-full text-xs font-black border ${isLow ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'}">
                ${v.stock_quantity} قطع
              </span>
            </td>
            <td class="py-4 px-6 font-mono text-slate-400">${(v.cost_price || 0).toFixed(0)} ج.م</td>
            <td class="py-4 px-6 font-mono font-black text-emerald-500">${(v.selling_price || 0).toFixed(0)} ج.م</td>
            <td class="py-4 px-6 text-center">
              <button onclick="deleteProductFromWeb('${v.product_id}', '${v.id}')" class="bg-rose-600/10 hover:bg-rose-600/20 text-rose-500 hover:text-rose-400 border border-rose-500/20 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all">
                حذف الصنف
              </button>
            </td>
          </tr>`;
      }).join('');
}

function filterInventory() {
  const term = document.getElementById('inventory-search');
  if (term) renderInventoryTable(term.value);
}

// ==================================================================================
// 10. INVOICES TABLE
// ==================================================================================
function renderInvoicesTable(filterTerm = '') {
  const tbody = document.getElementById('invoices-tbody');
  if (!tbody) return;

  const term = filterTerm.toLowerCase();
  const filtered = dbData.sales.filter(s =>
    (s.invoice_number || '').toLowerCase().includes(term) ||
    (s.cashier_name || '').toLowerCase().includes(term) ||
    (s.customer_name || '').toLowerCase().includes(term)
  );

  tbody.innerHTML = filtered.length === 0
    ? '<tr><td colspan="7" class="py-8 text-center text-slate-500">لا توجد فواتير مطابقة.</td></tr>'
    : filtered.map(s => {
        const dateStr = s.created_at ? new Date(s.created_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : 'غير محدد';
        const isVoda = s.payment_method === 'CARD' || (s.customer_name && s.customer_name.includes('فودافون كاش'));
        return `
          <tr class="hover:bg-slate-900/40">
            <td class="py-4 px-6 font-black text-white font-mono select-all">${s.invoice_number}</td>
            <td class="py-4 px-6 font-mono text-slate-400 text-[11px]">${dateStr}</td>
            <td class="py-4 px-6 text-slate-200 font-bold">${s.cashier_name || ''}</td>
            <td class="py-4 px-6 text-slate-300 font-semibold truncate max-w-[200px]" title="${s.customer_name || 'عميل نقدي'}">${s.customer_name || 'عميل نقدي'}</td>
            <td class="py-4 px-6 text-center">
              <span class="px-2.5 py-1 rounded-xl text-[10px] font-bold ${isVoda ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'}">
                ${isVoda ? 'فودافون كاش' : 'نقدي / كاش'}
              </span>
            </td>
            <td class="py-4 px-6 text-left font-mono font-black text-emerald-500 text-sm">${(s.final_amount || 0).toLocaleString('ar-EG')} ج.م</td>
            <td class="py-4 px-6 text-center flex items-center justify-center gap-1.5">
              <button onclick="viewInvoiceReceipt('${s.id}')" class="bg-blue-600/10 hover:bg-blue-600/20 text-blue-500 hover:text-blue-400 border border-blue-500/20 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all">
                عرض التفاصيل
              </button>
              <button onclick="deleteInvoice('${s.id}')" class="bg-rose-600/10 hover:bg-rose-600/20 text-rose-500 hover:text-rose-400 border border-rose-500/20 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all">
                حذف
              </button>
            </td>
          </tr>`;
      }).join('');
}

function filterInvoices() {
  const el = document.getElementById('invoices-search');
  if (el) renderInvoicesTable(el.value);
}

// ==================================================================================
// 11. SUPPLIERS LEDGER
// ==================================================================================
function renderSuppliersList(filterTerm = '') {
  const container = document.getElementById('suppliers-list-container');
  if (!container) return;

  const term = filterTerm.toLowerCase();
  const filtered = dbData.suppliers.filter(s =>
    s.name.toLowerCase().includes(term) || (s.phone || '').toLowerCase().includes(term)
  );

  container.innerHTML = filtered.length === 0
    ? '<p class="text-xs text-slate-500 text-center py-8">لا يوجد موردين.</p>'
    : filtered.map(s => `
        <div onclick="selectSupplier('${s.id}')" id="sup-item-${s.id}" class="supplier-item p-3.5 rounded-xl border border-slate-800 bg-slate-950/45 hover:bg-slate-900 cursor-pointer transition-all flex justify-between items-center select-none">
          <div>
            <h4 class="font-bold text-xs text-white">${s.name}</h4>
            <p class="text-[10px] text-slate-400 font-mono mt-1">الهاتف: ${s.phone || 'غير مسجل'}</p>
          </div>
          <div class="text-left shrink-0 flex items-center gap-2">
            <div>
              <span class="px-2 py-0.5 rounded text-[10px] font-black border ${s.current_debt > 0 ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'}">
                ${(s.current_debt || 0).toLocaleString('ar-EG')} ج.م
              </span>
              <p class="text-[8px] text-slate-400 font-bold mt-1.5">مجموع الديون</p>
            </div>
            <button onclick="event.stopPropagation(); deleteSupplierFromWeb('${s.id}')" class="bg-rose-600/10 hover:bg-rose-600/20 text-rose-550 p-1.5 rounded-lg border border-rose-500/20 transition-all active:scale-95 shrink-0" title="حذف المورد">
              🗑️
            </button>
          </div>
        </div>`).join('');
}

function filterSuppliers() {
  const el = document.getElementById('suppliers-search');
  if (el) renderSuppliersList(el.value);
}

function selectSupplier(supId) {
  document.querySelectorAll('.supplier-item').forEach(el => {
    el.classList.remove('border-blue-500', 'bg-slate-900', 'shadow-md');
    el.classList.add('border-slate-800', 'bg-slate-950/45');
  });
  const activeItem = document.getElementById(`sup-item-${supId}`);
  if (activeItem) {
    activeItem.classList.remove('border-slate-800', 'bg-slate-950/45');
    activeItem.classList.add('border-blue-500', 'bg-slate-900', 'shadow-md');
  }

  const supplier = dbData.suppliers.find(s => s.id === supId);
  if (!supplier) return;

  const titleEl = document.getElementById('selected-supplier-title');
  if (titleEl) titleEl.textContent = `${supplier.name} (الدين الجاري: ${(supplier.current_debt || 0).toLocaleString('ar-EG')} ج.م)`;

  const debts = dbData.supplierDebts.filter(d => d.supplier_id === supId);
  const tbody = document.getElementById('supplier-debts-tbody');
  if (!tbody) return;

  tbody.innerHTML = debts.length === 0
    ? '<tr><td colspan="5" class="py-12 text-center text-slate-500">لا توجد حركات ديون مسجلة.</td></tr>'
    : debts.map(d => {
        const dateStr = d.created_at ? new Date(d.created_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : 'غير محدد';
        const typeLabel = d.transaction_type === 'PURCHASE_DEBT' ? 'شراء آجل' : d.transaction_type === 'PAYMENT' ? 'سداد نقدي' : 'تسوية دين';
        const typeClass = d.transaction_type === 'PURCHASE_DEBT' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' : d.transaction_type === 'PAYMENT' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-blue-500/10 text-blue-500 border-blue-500/20';
        return `
          <tr class="hover:bg-slate-900/40">
            <td class="py-3 px-4 font-mono text-[10px] text-slate-400">${dateStr}</td>
            <td class="py-3 px-4 text-center"><span class="px-2 py-0.5 rounded text-[9px] font-bold border ${typeClass}">${typeLabel}</span></td>
            <td class="py-3 px-4 text-left font-mono font-bold text-white">${(d.amount || 0).toLocaleString('ar-EG')} ج.م</td>
            <td class="py-3 px-4 text-left font-mono font-black text-slate-300">${(d.new_debt || 0).toLocaleString('ar-EG')} ج.م</td>
            <td class="py-3 px-4 text-slate-400 max-w-xs truncate" title="${d.notes || ''}">${d.notes || '---'}</td>
          </tr>`;
      }).join('');
}

// ==================================================================================
// 12. USERS TABLE
// ==================================================================================
function renderUsersTable() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  tbody.innerHTML = dbData.users.length === 0
    ? '<tr><td colspan="4" class="py-8 text-center text-slate-500">لا توجد حسابات مستخدمين مسجلة في السحابة.</td></tr>'
    : dbData.users.map(u => {
        const dateStr = u.created_at ? new Date(u.created_at).toLocaleDateString('ar-EG') : '';
        return `
          <tr class="hover:bg-slate-900/40">
            <td class="py-3 px-6 font-bold text-white">${u.username}</td>
            <td class="py-3 px-6 text-center">
              <span class="px-2.5 py-1 rounded-full text-[10px] font-bold border ${u.role === 'ADMIN' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}">
                ${u.role === 'ADMIN' ? 'مدير' : 'كاشير'}
              </span>
            </td>
            <td class="py-3 px-6 font-mono text-slate-400 text-xs">${u.phone || 'غير مسجل'}</td>
            <td class="py-3 px-6 text-slate-500 text-xs font-mono">${dateStr}</td>
          </tr>`;
      }).join('');
}

// ==================================================================================
// 13. ACTIVITY LOGS
// ==================================================================================
function renderActivityLogsTable(filterTerm = '') {
  const tbody = document.getElementById('logs-tbody');
  if (!tbody) return;

  const term = filterTerm.toLowerCase();
  const filtered = dbData.logs.filter(log =>
    (log.username || '').toLowerCase().includes(term) ||
    (log.action || '').toLowerCase().includes(term) ||
    (log.details || '').toLowerCase().includes(term)
  );

  tbody.innerHTML = filtered.length === 0
    ? '<tr><td colspan="4" class="py-8 text-center text-slate-500">لا توجد سجلات تتبع مطابقة.</td></tr>'
    : filtered.map(log => {
        const actionClass =
          log.action === 'SALE_COMPLETED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
          log.action === 'ITEM_DELETED_FROM_CART' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
          log.action === 'DRAWER_OPENED' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
          log.action === 'INVENTORY_ADJUSTMENT' ? 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20' :
          log.action === 'BACKUP_COMPLETED' ? 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20' :
          'bg-slate-800 text-slate-400 border-slate-700';
        return `
          <tr class="hover:bg-slate-900/40">
            <td class="py-3 px-6 font-mono text-[10px] text-slate-400 select-all">${log.created_at || 'غير متوفر'}</td>
            <td class="py-3 px-6 font-bold text-white">${log.username || ''}</td>
            <td class="py-3 px-6"><span class="px-2 py-0.5 rounded text-[10px] font-bold border ${actionClass}">${log.action}</span></td>
            <td class="py-3 px-6 text-slate-400 max-w-sm truncate" title="${log.details || ''}">${log.details || ''}</td>
          </tr>`;
      }).join('');
}

function filterLogs() {
  const el = document.getElementById('logs-search');
  if (el) renderActivityLogsTable(el.value);
}

// ==================================================================================
// 14. INVOICE RECEIPT MODAL
// ==================================================================================
function viewInvoiceReceipt(saleId) {
  const sale = dbData.sales.find(s => s.id === saleId);
  if (!sale) return;

  const items = dbData.saleItems.filter(item => item.sale_id === saleId);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('modal-invoice-num', sale.invoice_number);
  set('modal-ticket-num', sale.invoice_number);
  set('modal-ticket-cashier', sale.cashier_name || '');
  set('modal-ticket-customer', sale.customer_name || 'عميل نقدي');
  set('modal-ticket-date', sale.created_at ? new Date(sale.created_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : 'غير محدد');

  const itemsTbody = document.getElementById('modal-ticket-items');
  if (itemsTbody) {
    let subtotal = 0;
    itemsTbody.innerHTML = items.map(item => {
      subtotal += (item.total_price || 0);
      return `
        <tr class="border-b border-slate-150">
          <td class="py-1 text-slate-900 text-right">
            <div>${item.name || ''}</div>
            <div class="text-[7.5px] opacity-60">${item.origin || ''}</div>
          </td>
          <td class="py-1 text-center font-mono text-slate-800">${item.quantity}</td>
          <td class="py-1 text-left font-mono font-bold text-slate-900">${(item.total_price || 0).toFixed(0)} ج.م</td>
        </tr>`;
    }).join('');

    set('modal-ticket-subtotal', `${subtotal.toFixed(0)} ج.م`);
    set('modal-ticket-discount', `-${(sale.discount || 0).toFixed(0)} ج.م`);
    set('modal-ticket-total', `${(sale.final_amount || 0).toFixed(0)} ج.م`);
  }

  const modal = document.getElementById('receipt-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeReceiptModal() {
  const modal = document.getElementById('receipt-modal');
  if (modal) modal.classList.add('hidden');
}

// ==================================================================================
// 15. DELETE ACTIONS (WEB-DASHBOARD CONTROLLER)
// ==================================================================================
async function deleteInvoice(invoiceId) {
  if (!confirm("هل أنت متأكد من رغبتك في مسح هذه الفاتورة نهائياً من السحابة؟")) return;
  try {
    const { error } = await sbClient.from('sales').delete().eq('id', invoiceId);
    if (error) throw error;
    alert("تم مسح الفاتورة بنجاح من السحابة!");
    fetchDatabaseData();
  } catch (err) {
    console.error(err);
    alert("فشل مسح الفاتورة: " + err.message);
  }
}

async function deleteProductFromWeb(productId, variantId) {
  if (!confirm("هل أنت متأكد من رغبتك في مسح هذا الفرع/الصنف بالكامل من السحابة؟")) return;
  try {
    // 1. Detach from sale_items to satisfy foreign key constraints
    const { error: detachErr } = await sbClient.from('sale_items').update({ variant_id: null }).eq('variant_id', variantId);
    if (detachErr) console.warn("Failed to detach variant in sale_items:", detachErr.message);

    // 2. Delete product variant compatibility entries
    const { error: compErr } = await sbClient.from('product_compatibility').delete().eq('variant_id', variantId);
    if (compErr) console.warn("Failed to delete compatibilities:", compErr.message);

    // 3. Delete the variant
    const { error: varErr } = await sbClient.from('product_variants').delete().eq('id', variantId);
    if (varErr) throw varErr;

    // 4. Check if product has any other variants remaining
    const { data: otherVars } = await sbClient.from('product_variants').select('id').eq('product_id', productId);
    if (!otherVars || otherVars.length === 0) {
      // Delete the empty parent product container
      const { error: prodErr } = await sbClient.from('products').delete().eq('id', productId);
      if (prodErr) console.warn("Failed to delete empty product container:", prodErr.message);
    }

    alert("تم مسح الصنف بنجاح من السحابة!");
    fetchDatabaseData();
  } catch (err) {
    console.error(err);
    alert("فشل مسح الصنف: " + err.message);
  }
}

async function deleteSupplierFromWeb(supplierId) {
  if (!confirm("هل أنت متأكد من رغبتك في مسح هذا المورد وديونه بالكامل من السحابة؟")) return;
  try {
    // Delete debts transactions first
    const { error: debtErr } = await sbClient.from('supplier_debts').delete().eq('supplier_id', supplierId);
    if (debtErr) console.warn("Failed to delete supplier debts:", debtErr.message);

    // Delete supplier row
    const { error } = await sbClient.from('suppliers').delete().eq('id', supplierId);
    if (error) throw error;

    alert("تم مسح المورد بنجاح من السحابة!");
    fetchDatabaseData();
  } catch (err) {
    console.error(err);
    alert("فشل مسح المورد: " + err.message);
  }
}
