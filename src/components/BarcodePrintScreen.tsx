import React, { useState, useEffect, useRef } from 'react';
import { Printer, Search, RefreshCw, Tag, ChevronDown, ChevronUp, Plus, Minus } from 'lucide-react';
import { dbClient } from '../database/dbClient';

interface Variant {
  id: string;
  product_id: string;
  product_name: string;
  origin: string;
  specification?: string;
  sku_barcode: string;
  stock_quantity: number;
  selling_price: number;
  cost_price: number;
  category?: string;
}

interface GroupedProduct {
  id: string;
  name: string;
  category: string;
  variants: Variant[];
}

interface BarcodePrintScreenProps {
  storeSettings: Record<string, string>;
}

// Supported label sizes: [widthMM, heightMM, label]
const LABEL_SIZES = [
  { label: '58×30 مم (رول ضيق)', w: 58, h: 30 },
  { label: '58×40 مم', w: 58, h: 40 },
  { label: '80×30 مم (رول عريض)', w: 80, h: 30 },
  { label: '80×40 مم', w: 80, h: 40 },
  { label: '100×50 مم', w: 100, h: 50 },
  { label: '50×25 مم (ملصق صغير)', w: 50, h: 25 },
  { label: '38×25 مم (مقسم صيدليات 12.5×38 مم)', w: 38, h: 25 },
  { label: '38×25 مم (محلات)', w: 38, h: 25 },
  { label: '50×25 مم (محلات)', w: 50, h: 25 },
  { label: '60×40 مم (موازين)', w: 60, h: 40 },
  { label: '40×50 مم (تسعير)', w: 40, h: 50 },
];

export const BarcodePrintScreen: React.FC<BarcodePrintScreenProps> = ({ storeSettings }) => {
  const [groupedProducts, setGroupedProducts] = useState<GroupedProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Advanced Barcode settings state
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
      console.error('Failed to load advanced barcode settings:', err);
    }
  };

  const [isPrinting, setIsPrinting] = useState(false);
  const [printDone, setPrintDone] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
    loadBarcodeConfig();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const variants = await dbClient.getVariants();
      const productMap: Record<string, GroupedProduct> = {};
      variants.forEach((v: any) => {
        if (!productMap[v.product_id]) {
          productMap[v.product_id] = {
            id: v.product_id,
            name: v.product_name || 'منتج بدون اسم',
            category: v.category || 'عام',
            variants: []
          };
        }
        productMap[v.product_id].variants.push(v);
      });
      setGroupedProducts(Object.values(productMap));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = groupedProducts.filter(p => {
    const term = searchTerm.toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      p.category.toLowerCase().includes(term) ||
      p.variants.some(v =>
        v.sku_barcode.includes(term) ||
        v.origin.toLowerCase().includes(term) ||
        (v.specification || '').toLowerCase().includes(term)
      )
    );
  });

  const setQty = (variantId: string, qty: number) => {
    setSelectedVariants(prev => {
      if (qty <= 0) {
        const next = { ...prev };
        delete next[variantId];
        return next;
      }
      return { ...prev, [variantId]: Math.min(qty, 9999) };
    });
  };

  const getVariantById = (id: string): Variant | undefined => {
    for (const p of groupedProducts) {
      const v = p.variants.find(v => v.id === id);
      if (v) return v;
    }
  };

  const totalLabels = Object.values(selectedVariants).reduce((a, b) => a + b, 0);
  const selectedEntries = Object.entries(selectedVariants).filter(([, qty]) => qty > 0);

  // ── Direct thermal print via Electron IPC ───────────────────────────────
  const handlePrint = async () => {
    if (selectedEntries.length === 0) return;
    setIsPrinting(true);
    try {
      const labels: Array<{ name: string; origin: string; barcode: string; price: number }> = [];
      selectedEntries.forEach(([variantId, qty]) => {
        const v = getVariantById(variantId);
        if (!v) return;
        for (let i = 0; i < qty; i++) {
          labels.push({
            name: v.product_name || 'قطعة غيار',
            origin: v.origin,
            barcode: v.sku_barcode,
            price: v.selling_price
          });
        }
      });

      const result = await (window as any).api.printBarcodes({
        labels,
        storeName: storeSettings.store_name || 'الأصيل لقطع الغيار'
      });

      if (result.success) {
        setPrintDone(true);
        setTimeout(() => setPrintDone(false), 3000);
      }
    } catch (err) {
      console.error('Barcode print failed:', err);
    } finally {
      setIsPrinting(false);
    }
  };

  // ── Print preview in a browser window (fallback / extra) ───────────────────
  const handleBrowserPrint = () => {
    if (selectedEntries.length === 0) return;
    const labels: Array<{ name: string; origin: string; barcode: string; price: number }> = [];
    selectedEntries.forEach(([variantId, qty]) => {
      const v = getVariantById(variantId);
      if (!v) return;
      for (let i = 0; i < qty; i++) {
        labels.push({ name: v.product_name || 'قطعة غيار', origin: v.origin, barcode: v.sku_barcode, price: v.selling_price });
      }
    });

    const wMm = barcodeConfig.widthMm;
    const hMm = barcodeConfig.heightMm;

    const htmlContent = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>طباعة باركود الأصناف</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #fff;
      font-family: Arial, sans-serif;
      direction: rtl;
      margin: 0;
      padding: 0;
      width: ${barcodeConfig.widthMm}mm;
    }
    .page {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .label {
      width: ${barcodeConfig.widthMm}mm;
      height: ${barcodeConfig.heightMm}mm;
      border: 0.2mm dashed #ccc;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      page-break-after: always;
      page-break-inside: avoid;
      background: #fff;
    }
    .label-inner {
      width: calc(100% - ${Number(barcodeConfig.marginLeft) + Number(barcodeConfig.marginRight)}mm);
      height: calc(100% - ${Number(barcodeConfig.marginTop) + Number(barcodeConfig.marginBottom)}mm);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.6mm;
      overflow: hidden;
      box-sizing: border-box;
    }
    .label-name {
      font-size: ${barcodeConfig.fontSize}px;
      font-weight: bold;
      text-align: center;
      line-height: 1.1;
      width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .label-origin {
      font-size: ${barcodeConfig.originFontSize}px;
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
    .label-store {
      font-size: ${Math.max(6, barcodeConfig.fontSize - 1)}px;
      font-weight: 800;
      text-align: center;
      width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 0.5mm;
      color: #000;
    }
    @media print {
      @page {
        size: ${barcodeConfig.widthMm}mm ${barcodeConfig.heightMm}mm;
        margin: 0;
      }
      body {
        margin: 0;
      }
      .label {
        border: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="page" id="labels"></div>
  <script>
    const labels = ${JSON.stringify(labels)};
    const container = document.getElementById('labels');
    const storeName = "${storeSettings.store_name || 'الأصيل لقطع الغيار'}";
    labels.forEach((lbl, idx) => {
      const div = document.createElement('div');
      div.className = 'label';
      div.innerHTML = \`
        <div class="label-inner">
          <div class="label-name">\${lbl.name}</div>
          <div class="label-origin">(\${lbl.origin})</div>
          <img id="bc_\${idx}" class="barcode-img">
          <div class="label-store">\${storeName}</div>
        </div>
      \`;
      container.appendChild(div);
    });
    // Render barcodes
    labels.forEach((lbl, idx) => {
      try {
        JsBarcode('#bc_' + idx, lbl.barcode, {
          format: 'CODE128',
          width: ${barcodeConfig.scaleWidth},
          height: ${barcodeConfig.scaleHeight},
          displayValue: ${barcodeConfig.showText},
          fontSize: ${barcodeConfig.fontSize - 1},
          margin: 0,
          background: '#fff',
          lineColor: '#000'
        });
      } catch(e) {
        document.getElementById('bc_' + idx).outerHTML = '<div style="font-size:7px;font-family:monospace;text-align:center">' + lbl.barcode + '</div>';
      }
    });
    setTimeout(() => window.print(), 600);
  <\/script>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (win) {
      win.document.write(htmlContent);
      win.document.close();
    }
  };

  const selectAllVariants = (product: GroupedProduct) => {
    const updates: Record<string, number> = {};
    product.variants.forEach(v => { updates[v.id] = v.stock_quantity > 0 ? v.stock_quantity : 1; });
    setSelectedVariants(prev => ({ ...prev, ...updates }));
  };

  const clearAll = () => setSelectedVariants({});

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-lg font-black text-main flex items-center gap-2">
            <Tag className="w-5 h-5 text-violet-500" />
            طباعة باركود الأصناف
          </h2>
          <p className="text-xs text-muted mt-0.5">اختر المنتجات والكميات ثم اطبع الملصقات مباشرة على طابعة الباركود</p>
        </div>

        {/* Active size display */}
        <div className="flex items-center gap-2 select-none">
          <span className="text-xs text-muted font-bold">المقاس النشط:</span>
          <span className="text-xs font-black bg-violet-500/10 text-violet-400 border border-violet-500/20 px-3 py-1.5 rounded-xl">
            {barcodeConfig.widthMm} × {barcodeConfig.heightMm} مم ({barcodeConfig.widthIn}" × {barcodeConfig.heightIn}")
          </span>
        </div>
      </div>

      {/* ── Main Grid ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">

        {/* ── Left: Product Browser ─────────────────────────────────── */}
        <div className="flex-1 flex flex-col gap-3 overflow-hidden">
          {/* Search */}
          <div className="relative shrink-0">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="ابحث باسم المنتج، البار كود، المنشأ..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-panel border border-main text-main placeholder-muted text-sm pr-10 pl-4 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {/* Refresh */}
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={loadData} className="flex items-center gap-1.5 text-xs text-muted hover:text-main transition-all px-3 py-1.5 bg-panel border border-main rounded-lg">
              <RefreshCw className="w-3.5 h-3.5" /> تحديث القائمة
            </button>
            <span className="text-xs text-muted">{filteredProducts.length} منتج</span>
          </div>

          {/* Products List */}
          <div className="flex-1 overflow-y-auto space-y-2 pb-2">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted text-sm">
                <RefreshCw className="w-5 h-5 animate-spin ml-2" /> جاري التحميل...
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted text-sm">لا توجد منتجات مطابقة</div>
            ) : (
              filteredProducts.map(product => (
                <div key={product.id} className="bg-panel border border-main rounded-2xl overflow-hidden">
                  {/* Product Header */}
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-main/40 transition-all select-none"
                    onClick={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                        <Tag className="w-4 h-4 text-violet-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-main truncate">{product.name}</p>
                        <p className="text-[10px] text-muted font-semibold">{product.category} · {product.variants.length} متغير</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {product.variants.some(v => selectedVariants[v.id] > 0) && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-violet-500/10 text-violet-500 border border-violet-500/20">
                          {product.variants.reduce((s, v) => s + (selectedVariants[v.id] || 0), 0)} ملصق
                        </span>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); selectAllVariants(product); }}
                        className="text-[10px] font-bold text-blue-500 hover:text-blue-400 px-2 py-1 rounded-lg hover:bg-blue-500/10 transition-all"
                      >
                        اختيار الكل
                      </button>
                      {expandedProduct === product.id ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
                    </div>
                  </div>

                  {/* Variants */}
                  {expandedProduct === product.id && (
                    <div className="border-t border-main divide-y divide-main">
                      {product.variants.map(v => {
                        const qty = selectedVariants[v.id] || 0;
                        return (
                          <div key={v.id} className="flex items-center justify-between px-4 py-3 hover:bg-main/30 transition-all">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-main">{v.origin}</span>
                                {v.specification && <span className="text-[10px] text-muted bg-main px-1.5 py-0.5 rounded">{v.specification}</span>}
                              </div>
                              <div className="flex items-center gap-3 mt-1">
                                <span className="font-mono text-[10px] text-muted select-all">{v.sku_barcode}</span>
                                <span className="text-[10px] text-emerald-500 font-bold">{v.selling_price.toFixed(0)} ج.م</span>
                                <span className="text-[10px] text-muted">مخزون: {v.stock_quantity}</span>
                              </div>
                            </div>

                            {/* Quantity controls */}
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => setQty(v.id, qty - 1)}
                                className="w-7 h-7 rounded-lg bg-main border border-main flex items-center justify-center text-muted hover:text-rose-500 hover:border-rose-500/30 transition-all active:scale-90"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <input
                                type="number"
                                min="0"
                                max="9999"
                                value={qty === 0 ? '' : qty}
                                onChange={e => setQty(v.id, parseInt(e.target.value) || 0)}
                                placeholder="0"
                                className="w-14 text-center text-sm font-black bg-panel border border-main text-main rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-violet-500"
                              />
                              <button
                                onClick={() => setQty(v.id, qty + 1)}
                                className="w-7 h-7 rounded-lg bg-main border border-main flex items-center justify-center text-muted hover:text-emerald-500 hover:border-emerald-500/30 transition-all active:scale-90"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right: Print Summary Panel ────────────────────────────── */}
        <div className="w-72 shrink-0 flex flex-col gap-3">
          {/* Summary Header */}
          <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-black text-violet-500">قائمة الطباعة</span>
              {selectedEntries.length > 0 && (
                <button onClick={clearAll} className="text-[10px] font-bold text-rose-500 hover:text-rose-400 transition-all">مسح الكل</button>
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-main">{totalLabels}</span>
              <span className="text-sm text-muted font-bold">ملصق باركود</span>
            </div>
            <p className="text-[10px] text-muted mt-1">{selectedEntries.length} متغير مختار</p>
          </div>

          {/* Label size info */}
          <div className="bg-panel border border-main rounded-xl p-3 text-center select-none">
            <p className="text-[10px] text-muted font-bold mb-1">المقاس النشط من ملف الإعدادات</p>
            <p className="text-sm font-black text-main">{barcodeConfig.widthMm}×{barcodeConfig.heightMm} مم</p>
            <p className="text-[10px] text-violet-500 mt-0.5">{barcodeConfig.widthIn}" × {barcodeConfig.heightIn}" بوصة</p>
          </div>

          {/* Selected items list */}
          {selectedEntries.length > 0 && (
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {selectedEntries.map(([variantId, qty]) => {
                const v = getVariantById(variantId);
                if (!v) return null;
                return (
                  <div key={variantId} className="bg-panel border border-main rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-main truncate">{v.product_name}</p>
                      <p className="text-[10px] text-muted">{v.origin} · <span className="font-mono">{v.sku_barcode}</span></p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-sm font-black text-violet-500">×{qty}</span>
                      <button
                        onClick={() => setQty(variantId, 0)}
                        className="w-5 h-5 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center text-[10px] font-black hover:bg-rose-500/20 transition-all"
                      >✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedEntries.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-center p-4">
              <div>
                <Tag className="w-10 h-10 text-muted mx-auto mb-2 opacity-40" />
                <p className="text-xs text-muted">اختر متغيرات من القائمة ستظهر هنا</p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 shrink-0">
            {/* PRIMARY: Direct thermal print */}
            <button
              onClick={handlePrint}
              disabled={selectedEntries.length === 0 || isPrinting}
              className={`w-full font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-sm shadow-md active:scale-98 ${
                printDone
                  ? 'bg-emerald-600 text-white'
                  : 'bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-500 text-white'
              }`}
            >
              <Printer className="w-4 h-4" />
              {isPrinting ? 'جاري الإرسال للطابعة...' : printDone ? '✅ تمت الطباعة!' : `طباعة ${totalLabels} ملصق حرارياً`}
            </button>

            {/* SECONDARY: Browser preview */}
            <button
              onClick={handleBrowserPrint}
              disabled={selectedEntries.length === 0}
              className="w-full bg-panel border border-main hover:border-violet-500/40 text-muted hover:text-violet-400 font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-2 text-xs"
            >
              <Tag className="w-3.5 h-3.5" />
              معاينة الباركود في المتصفح
            </button>
            <p className="text-[10px] text-muted text-center">الطباعة مباشرة للطابعة الحرارية · الصورة تُحفظ في print_logs</p>
          </div>
        </div>
      </div>

      {/* Hidden print ref */}
      <div ref={printRef} className="hidden" />
    </div>
  );
};
