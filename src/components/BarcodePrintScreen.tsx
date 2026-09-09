import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Printer, Search, RefreshCw, Tag, ChevronDown, ChevronUp, Plus, Minus, Settings, Eye, Code, Check, AlertCircle, Save } from 'lucide-react';
import { dbClient } from '../database/dbClient';
import JsBarcode from 'jsbarcode';

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

// Helper to convert mm to Dots at 203 DPI (8 dots/mm)
const mmToDots = (mm: number) => Math.round((mm * 203) / 25.4);

// ── TSPL Builder for Binary Stream Generation ─────────────────────────────
class TSPLBuilder {
  private chunks: Array<Uint8Array | string> = [];

  addCommand(cmd: string | Uint8Array) {
    this.chunks.push(cmd);
  }

  addBitmap(x: number, y: number, widthBytes: number, heightPixels: number, mode: number, data: Uint8Array) {
    this.chunks.push(`BITMAP ${x},${y},${widthBytes},${heightPixels},${mode},`);
    this.chunks.push(data);
    this.chunks.push('\n');
  }

  compile(): Uint8Array {
    let totalLength = 0;
    const processedChunks = this.chunks.map(chunk => {
      if (typeof chunk === 'string') {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(chunk);
        totalLength += bytes.length;
        return bytes;
      } else {
        totalLength += chunk.length;
        return chunk;
      }
    });

    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of processedChunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

// Convert HTML5 2D Canvas to 1-Bit Packed Monochrome Bitmap for TSPL BITMAP
function canvasToMonochromeBitmap(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array(0);
  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const rgba = imgData.data;

  const widthBytes = Math.ceil(w / 8);
  const packed = new Uint8Array(widthBytes * h);
  packed.fill(255); // Initialize to 0xFF (all white / no heat)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const a = rgba[idx + 3];

      // Threshold: pixels with alpha < 128 are white, else test brightness
      const isBlack = (a < 128) ? false : ((0.299 * r + 0.587 * g + 0.114 * b) < 180);

      if (isBlack) {
        const byteIdx = y * widthBytes + Math.floor(x / 8);
        const bitIdx = x % 8;
        packed[byteIdx] &= ~(1 << (7 - bitIdx)); // Clear the bit to 0 (black ink)
      }
    }
  }
  return packed;
}

// Draw label canvas dynamically
function drawLabelCanvas(
  canvas: HTMLCanvasElement,
  label: { name: string; origin: string; barcode: string; price: number },
  config: any,
  storeName: string,
  isForPrint: boolean
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  // 1. Fill white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  const marginLeft = mmToDots(config.marginLeft);
  const marginRight = mmToDots(config.marginRight);
  const marginTop = mmToDots(config.marginTop);
  const marginBottom = mmToDots(config.marginBottom);

  // 2. Draw guidelines if it's for screen preview, NOT for print spooler
  if (!isForPrint) {
    // Printable Area Margins (Red Dashed Box)
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(marginLeft, marginTop, w - marginLeft - marginRight, h - marginTop - marginBottom);
    ctx.setLineDash([]);

    // Gridlines (2mm spacing)
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.08)';
    ctx.lineWidth = 0.5;
    const gridStep = mmToDots(2); // 2mm grid
    for (let x = gridStep; x < w; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = gridStep; y < h; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  // 3. Draw Store Name
  if (config.showStoreName !== false) {
    ctx.fillStyle = '#000000';
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.font = `bold ${config.storeFontSize}px "Segoe UI", "Tahoma", "Arial", sans-serif`;
    ctx.fillText(storeName, mmToDots(config.storeX || (config.widthMm / 2)), mmToDots(config.storeY));
  }

  // 4. Draw Product Name
  if (config.showProductName !== false) {
    ctx.fillStyle = '#000000';
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.font = `bold ${config.nameFontSize}px "Segoe UI", "Tahoma", "Arial", sans-serif`;
    ctx.fillText(label.name, mmToDots(config.nameX || (config.widthMm / 2)), mmToDots(config.nameY));
  }

  // 5. Draw Origin
  if (config.showOrigin !== false) {
    ctx.fillStyle = '#000000';
    ctx.direction = 'rtl';
    ctx.font = `${config.originFontSize}px "Segoe UI", "Tahoma", "Arial", sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(`المنشأ: ${label.origin}`, mmToDots(config.originX || (config.widthMm - 10)), mmToDots(config.originY));
  }

  // 6. Draw Price
  if (config.showPrice !== false) {
    ctx.fillStyle = '#000000';
    ctx.direction = 'rtl';
    ctx.font = `black ${config.priceFontSize}px "Segoe UI", "Tahoma", "Arial", sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`السعر: ${label.price.toFixed(0)} ج.م`, mmToDots(config.priceX || 10), mmToDots(config.priceY));
  }

  // 7. Render Barcode preview on screen (Native print renders via BARCODE command)
  if (!isForPrint && config.showBarcode !== false) {
    const barcodeX = mmToDots(config.barcodeX);
    const barcodeY = mmToDots(config.barcodeY);
    const barcodeHeight = config.scaleHeight; // in dots
    
    let actualWidth = w - marginLeft - marginRight;
    let actualHeight = barcodeHeight + (config.showText ? 15 : 0);

    try {
      // Draw actual scannable barcode onto temporary canvas
      const tempCanvas = document.createElement('canvas');
      JsBarcode(tempCanvas, label.barcode, {
        format: 'CODE128',
        width: config.scaleWidth,
        height: barcodeHeight,
        displayValue: config.showText,
        fontSize: 10,
        margin: 0
      });
      actualWidth = tempCanvas.width;
      actualHeight = tempCanvas.height;
      ctx.drawImage(tempCanvas, barcodeX, barcodeY, actualWidth, actualHeight);
    } catch (e) {
      // Fallback dummy lines if JsBarcode fails to load
      drawDummyBarcode(ctx, barcodeX, barcodeY, actualWidth, barcodeHeight);
      if (config.showText) {
        ctx.fillStyle = '#000000';
        ctx.font = `10px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(label.barcode, barcodeX + actualWidth / 2, barcodeY + barcodeHeight + 12);
      }
    }
  }

  // 8. Draw vector editor dashed bounding boxes in screen preview mode (WYSIWYG visual helper)
  if (!isForPrint) {
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);

    // Store Name box
    if (config.showStoreName !== false) {
      ctx.strokeRect(mmToDots(config.storeX || (config.widthMm / 2)) - 70, mmToDots(config.storeY) - 13, 140, 18);
    }
    // Product Name box
    if (config.showProductName !== false) {
      ctx.strokeRect(mmToDots(config.nameX || (config.widthMm / 2)) - 80, mmToDots(config.nameY) - 13, 160, 18);
    }
    // Origin box
    if (config.showOrigin !== false) {
      ctx.strokeRect(mmToDots(config.originX || (config.widthMm - 10)) - 60, mmToDots(config.originY) - 11, 65, 15);
    }
    // Price box
    if (config.showPrice !== false) {
      ctx.strokeRect(mmToDots(config.priceX || 10) - 10, mmToDots(config.priceY) - 11, 80, 15);
    }
    // Barcode box
    if (config.showBarcode !== false) {
      const barcodeX = mmToDots(config.barcodeX);
      const barcodeY = mmToDots(config.barcodeY);
      const barcodeHeight = config.scaleHeight; // in dots
      
      let actualWidth = w - marginLeft - marginRight;
      let actualHeight = barcodeHeight + (config.showText ? 15 : 0);
      try {
        const tempCanvas = document.createElement('canvas');
        JsBarcode(tempCanvas, label.barcode, {
          format: 'CODE128',
          width: config.scaleWidth,
          height: barcodeHeight,
          displayValue: config.showText,
          fontSize: 10,
          margin: 0
        });
        actualWidth = tempCanvas.width;
        actualHeight = tempCanvas.height;
      } catch (e) {}
      ctx.strokeRect(barcodeX, barcodeY, actualWidth, actualHeight);
    }

    ctx.setLineDash([]); // Reset
  }
}

// Fallback dummy barcode drawer
function drawDummyBarcode(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.save();
  ctx.fillStyle = '#000000';
  const numBars = 35;
  const barWidth = width / numBars;
  for (let i = 0; i < numBars; i++) {
    if (i % 2 === 0 || i % 7 === 3) {
      ctx.fillRect(x + i * barWidth, y, barWidth * 0.7, height);
    }
  }
  ctx.restore();
}

// Compile multiple labels into one single high-speed TSPL binary payload
function compileMultipleLabelsToTSPL(
  labelsToPrint: Array<{ name: string; origin: string; barcode: string; price: number }>,
  config: any,
  storeName: string
): Uint8Array {
  const builder = new TSPLBuilder();

  const wMm = config.widthMm;
  const hMm = config.heightMm;
  const wDots = mmToDots(wMm);
  const hDots = mmToDots(hMm);
  const widthBytes = Math.ceil(wDots / 8);

  // Set sizing parameters once for the whole printing job
  builder.addCommand(`SIZE ${wMm} mm, ${hMm} mm\n`);
  builder.addCommand(`GAP ${config.gap} mm, 0 mm\n`);
  builder.addCommand(`DIRECTION 1\n`);

  labelsToPrint.forEach(lbl => {
    builder.addCommand(`CLS\n`);

    // Render text canvas for this specific label (isForPrint = true, no margins/helpers)
    const textCanvas = document.createElement('canvas');
    textCanvas.width = wDots;
    textCanvas.height = hDots;
    drawLabelCanvas(textCanvas, lbl, config, storeName, true);

    // Append BITMAP command containing the rendered text bytes
    const bitmapData = canvasToMonochromeBitmap(textCanvas);
    builder.addCommand(`BITMAP 0,0,${widthBytes},${hDots},0,`);
    builder.addCommand(bitmapData);
    builder.addCommand('\n');

    // Append native sub-pixel accurate BARCODE command
    if (config.showBarcode !== false) {
      const barcodeX = mmToDots(config.barcodeX);
      const barcodeY = mmToDots(config.barcodeY);
      const barcodeHeight = config.scaleHeight; // height in dots
      const narrow = config.scaleWidth; // narrow bar width in dots
      const wide = Math.max(config.scaleWidth * 2, config.scaleWidth * 3); // wide bar ratio

      builder.addCommand(
        `BARCODE ${barcodeX},${barcodeY},"128",${barcodeHeight},${config.showText ? 1 : 0},0,${narrow},${wide},"${lbl.barcode}"\n`
      );
    }

    // Spool and print this page
    builder.addCommand(`PRINT 1,1\n`);
  });

  return builder.compile();
}

// Convert Uint8Array buffer to Base64 string for IPC transmission
function arrayBufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  const len = buffer.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return window.btoa(binary);
}

interface BarcodeConfigType {
  widthMm: number;
  heightMm: number;
  gap: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  barcodeX: number;
  barcodeY: number;
  scaleWidth: number;
  scaleHeight: number;
  showText: boolean;
  storeFontSize: number;
  nameFontSize: number;
  originFontSize: number;
  priceFontSize: number;
  storeX: number;
  nameX: number;
  originX: number;
  priceX: number;
  storeY: number;
  nameY: number;
  originY: number;
  priceY: number;
  
  showStoreName?: boolean;
  showProductName?: boolean;
  showBarcode?: boolean;
  showPrice?: boolean;
  showOrigin?: boolean;
}

export const BarcodePrintScreen: React.FC<BarcodePrintScreenProps> = ({ storeSettings }) => {
  const [groupedProducts, setGroupedProducts] = useState<GroupedProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Advanced Designer and Hardware Config State (fully custom metrics in mm and dots)
  const [barcodeConfig, setBarcodeConfig] = useState<BarcodeConfigType>({
    widthMm: 42.5,
    heightMm: 25,
    gap: 1.0,
    marginTop: 0.6,
    marginBottom: 0.5,
    marginLeft: 0.4,
    marginRight: 0.5,
    
    // Barcode settings
    barcodeX: 9.7,         // in mm
    barcodeY: 11.1,         // in mm
    scaleWidth: 2,         // narrow bar size (dots)
    scaleHeight: 49,       // barcode height (dots)
    showText: true,
    
    // Typography settings
    storeFontSize: 22,     // px
    nameFontSize: 20,      // px
    originFontSize: 16,    // px
    priceFontSize: 23,     // px
 
    // X Coordinates in mm
    storeX: 20.6,          
    nameX: 20.7,           
    originX: 30.5,
    priceX: 4.8,
 
    // Layout Y coordinates in mm
    storeY: 5.4,
    nameY: 9.2,
    originY: 23.1,
    priceY: 20.3,

    showStoreName: true,
    showProductName: true,
    showBarcode: true,
    showPrice: true,
    showOrigin: true,
  });

  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printDone, setPrintDone] = useState(false);
  const [showTsplModal, setShowTsplModal] = useState(false);
  
  // Editor security lock and reset states
  const [isEditorLocked, setIsEditorLocked] = useState(true);
  const [resetSuccessNotification, setResetSuccessNotification] = useState(false);
  const [alertConfig, setAlertConfig] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  const showAlert = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setAlertConfig({ message, type });
  };

  const handleResetToRecommended = () => {
    const recommended = {
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
    setBarcodeConfig(recommended);
    setResetSuccessNotification(true);
    setTimeout(() => setResetSuccessNotification(false), 3000);
  };

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const [draggedElement, setDraggedElement] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, elemX: 0, elemY: 0 });

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isEditorLocked) return; // Prevent drag clicks when locked
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    
    // Calculate click coordinates in canvas dot units (203 DPI)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;
    
    const w = canvas.width;
    
    const inBox = (cx: number, cy: number, x1: number, y1: number, x2: number, y2: number) => {
      return cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2;
    };
    
    // 1. Store Name box check
    const storeX = mmToDots(barcodeConfig.storeX || (barcodeConfig.widthMm / 2));
    const storeY = mmToDots(barcodeConfig.storeY);
    if (inBox(clickX, clickY, storeX - 70, storeY - 15, storeX + 70, storeY + 5)) {
      setDraggedElement('store');
      setDragStart({ x: e.clientX, y: e.clientY, elemX: barcodeConfig.storeX || (barcodeConfig.widthMm / 2), elemY: barcodeConfig.storeY });
      return;
    }
    
    // 2. Product Name box check
    const nameX = mmToDots(barcodeConfig.nameX || (barcodeConfig.widthMm / 2));
    const nameY = mmToDots(barcodeConfig.nameY);
    if (inBox(clickX, clickY, nameX - 80, nameY - 15, nameX + 80, nameY + 5)) {
      setDraggedElement('name');
      setDragStart({ x: e.clientX, y: e.clientY, elemX: barcodeConfig.nameX || (barcodeConfig.widthMm / 2), elemY: barcodeConfig.nameY });
      return;
    }
    
    // 3. Barcode box check
    const barcodeX = mmToDots(barcodeConfig.barcodeX);
    const barcodeY = mmToDots(barcodeConfig.barcodeY);
    
    // Dynamically calculate exact JsBarcode width for click detection
    let barcodeWidth = w - mmToDots(barcodeConfig.marginLeft) - mmToDots(barcodeConfig.marginRight);
    let barcodeHeight = barcodeConfig.scaleHeight + (barcodeConfig.showText ? 15 : 0);
    try {
      const tempCanvas = document.createElement('canvas');
      JsBarcode(tempCanvas, currentPreviewItem.barcode || '000000', {
        format: 'CODE128',
        width: barcodeConfig.scaleWidth,
        height: barcodeConfig.scaleHeight,
        displayValue: barcodeConfig.showText,
        fontSize: 10,
        margin: 0
      });
      barcodeWidth = tempCanvas.width;
      barcodeHeight = tempCanvas.height;
    } catch (e) {}

    if (inBox(clickX, clickY, barcodeX, barcodeY, barcodeX + barcodeWidth, barcodeY + barcodeHeight)) {
      setDraggedElement('barcode');
      setDragStart({ x: e.clientX, y: e.clientY, elemX: barcodeConfig.barcodeX, elemY: barcodeConfig.barcodeY });
      return;
    }
    
    // 4. Origin box check
    const originX = mmToDots(barcodeConfig.originX || (barcodeConfig.widthMm - 10));
    const originY = mmToDots(barcodeConfig.originY);
    if (inBox(clickX, clickY, originX - 60, originY - 15, originX + 20, originY + 5)) {
      setDraggedElement('origin');
      setDragStart({ x: e.clientX, y: e.clientY, elemX: barcodeConfig.originX || (barcodeConfig.widthMm - 10), elemY: barcodeConfig.originY });
      return;
    }
    
    // 5. Price box check
    const priceX = mmToDots(barcodeConfig.priceX || 10);
    const priceY = mmToDots(barcodeConfig.priceY);
    if (inBox(clickX, clickY, priceX - 20, priceY - 15, priceX + 80, priceY + 5)) {
      setDraggedElement('price');
      setDragStart({ x: e.clientX, y: e.clientY, elemX: barcodeConfig.priceX || 10, elemY: barcodeConfig.priceY });
      return;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggedElement) return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const dotsPerPixelX = canvas.width / rect.width;
    const dotsPerPixelY = canvas.height / rect.height;
    
    const deltaX = (e.clientX - dragStart.x) * dotsPerPixelX;
    const deltaY = (e.clientY - dragStart.y) * dotsPerPixelY;
    
    const dotsToMm = (dots: number) => (dots * 25.4) / 203;
    const deltaMmX = dotsToMm(deltaX);
    const deltaMmY = dotsToMm(deltaY);
    
    setBarcodeConfig(prev => {
      const next = { ...prev };
      if (draggedElement === 'store') {
        next.storeX = Math.round((dragStart.elemX + deltaMmX) * 10) / 10;
        next.storeY = Math.round((dragStart.elemY + deltaMmY) * 10) / 10;
      } else if (draggedElement === 'name') {
        next.nameX = Math.round((dragStart.elemX + deltaMmX) * 10) / 10;
        next.nameY = Math.round((dragStart.elemY + deltaMmY) * 10) / 10;
      } else if (draggedElement === 'barcode') {
        next.barcodeX = Math.round((dragStart.elemX + deltaMmX) * 10) / 10;
        next.barcodeY = Math.round((dragStart.elemY + deltaMmY) * 10) / 10;
      } else if (draggedElement === 'origin') {
        next.originX = Math.round((dragStart.elemX + deltaMmX) * 10) / 10;
        next.originY = Math.round((dragStart.elemY + deltaMmY) * 10) / 10;
      } else if (draggedElement === 'price') {
        next.priceX = Math.round((dragStart.elemX + deltaMmX) * 10) / 10;
        next.priceY = Math.round((dragStart.elemY + deltaMmY) * 10) / 10;
      }
      return next;
    });
  };

  const handleMouseUp = () => {
    setDraggedElement(null);
  };

  const [saveSuccessNotification, setSaveSuccessNotification] = useState(false);

  const loadBarcodeConfig = async () => {
    try {
      // 1. Try loading from localStorage first for instant page transitions
      const localCached = localStorage.getItem('barcodes_designer_config');
      if (localCached) {
        setBarcodeConfig(JSON.parse(localCached));
      }

      // 2. Fetch from main process configuration file (persistent on disk)
      const res = await (window as any).api.getBarcodeConfig();
      if (res.success && res.config) {
        setBarcodeConfig(prev => {
          const merged = { ...prev, ...res.config };
          localStorage.setItem('barcodes_designer_config', JSON.stringify(merged));
          return merged;
        });
      }
    } catch (err) {
      console.error('Failed to load advanced barcode settings:', err);
    }
  };

  // Autosave barcodeConfig changes on any edit with a 400ms debounce
  useEffect(() => {
    const saveTimeout = setTimeout(async () => {
      try {
        localStorage.setItem('barcodes_designer_config', JSON.stringify(barcodeConfig));
        await (window as any).api.saveBarcodeConfig(barcodeConfig);
      } catch (err) {
        console.error('Autosave barcode config failed:', err);
      }
    }, 400);

    return () => clearTimeout(saveTimeout);
  }, [barcodeConfig]);

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

  // Flattened print queue for individual previews and batched jobs
  const printQueue = useMemo(() => {
    const queue: Array<{ name: string; origin: string; barcode: string; price: number; variantId: string }> = [];
    selectedEntries.forEach(([variantId, qty]) => {
      const v = getVariantById(variantId);
      if (!v) return;
      for (let i = 0; i < qty; i++) {
        queue.push({
          name: v.product_name || 'قطعة غيار',
          origin: v.origin,
          barcode: v.sku_barcode,
          price: v.selling_price,
          variantId
        });
      }
    });
    return queue;
  }, [selectedVariants, groupedProducts]);

  // Adjust preview index bounds when queue changes
  useEffect(() => {
    if (activePreviewIndex >= printQueue.length && printQueue.length > 0) {
      setActivePreviewIndex(printQueue.length - 1);
    }
  }, [printQueue, activePreviewIndex]);

  // Draw the label to screen preview canvas on any designer settings change
  const currentPreviewItem = printQueue[activePreviewIndex] || {
    name: 'تيل فرامل ألماني',
    origin: 'ألماني',
    barcode: '4000123456',
    price: 650
  };

  const renderScreenPreview = () => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    // Canvas size in pixels is set exactly to dot count at 203 DPI
    const wDots = mmToDots(barcodeConfig.widthMm);
    const hDots = mmToDots(barcodeConfig.heightMm);

    canvas.width = wDots;
    canvas.height = hDots;

    drawLabelCanvas(canvas, currentPreviewItem, barcodeConfig, storeSettings.store_name || 'الأصيل لقطع الغيار', false);
  };

  useEffect(() => {
    renderScreenPreview();
  }, [barcodeConfig, activePreviewIndex, printQueue, storeSettings]);

  // ── High Speed Direct TSPL Print via Python Server ──────────────────────
  const handleDirectTsplPrint = async () => {
    if (printQueue.length === 0) return;
    setIsPrinting(true);
    try {
      // 1. Compile all labels in printQueue to binary TSPL
      const binaryPayload = compileMultipleLabelsToTSPL(
        printQueue,
        barcodeConfig,
        storeSettings.store_name || 'الأصيل لقطع الغيار'
      );

      // 2. Convert raw bytes to Base64 string for IPC bridge
      const base64Tspl = arrayBufferToBase64(binaryPayload);

      // 3. Send to Printer (using auto-detected thermal printer)
      const res = await (window as any).api.printRawTspl('', base64Tspl);

      if (res.success) {
        setPrintDone(true);
        setTimeout(() => setPrintDone(false), 3000);
      } else {
        showAlert(`فشلت الطباعة: ${res.error || 'خطأ غير معروف في طابعة الباركود'}`, 'error');
      }
    } catch (err: any) {
      console.error('TSPL Direct Print failed:', err);
      showAlert(`فشلت عملية إرسال أمر الطباعة: ${err.message || err}`, 'error');
    } finally {
      setIsPrinting(false);
    }
  };

  // Compile TSPL instructions into string for debugging modal
  const compiledTsplCodeString = useMemo(() => {
    const wMm = barcodeConfig.widthMm;
    const hMm = barcodeConfig.heightMm;
    const wDots = mmToDots(wMm);
    const hDots = mmToDots(hMm);
    const widthBytes = Math.ceil(wDots / 8);

    const barcodeX = mmToDots(barcodeConfig.barcodeX);
    const barcodeY = mmToDots(barcodeConfig.barcodeY);
    const narrow = barcodeConfig.scaleWidth;
    const wide = narrow * 3;

    return `SIZE ${wMm} mm, ${hMm} mm
GAP ${barcodeConfig.gap} mm, 0 mm
DIRECTION 1
CLS
BITMAP 0,0,${widthBytes},${hDots},0,[BINARY_TEXT_BITMAP_DATA_BYTES...]
BARCODE ${barcodeX},${barcodeY},"128",${barcodeConfig.scaleHeight},1,0,${narrow},${wide},"${currentPreviewItem.barcode}"
PRINT 1,1`;
  }, [barcodeConfig, currentPreviewItem]);

  const handleSaveConfig = async () => {
    try {
      const res = await (window as any).api.saveBarcodeConfig(barcodeConfig);
      if (res.success) {
        setSaveSuccessNotification(true);
        setTimeout(() => setSaveSuccessNotification(false), 3500);
      } else {
        showAlert('فشل حفظ الإعدادات على القرص الصلب', 'error');
      }
    } catch (err) {
      console.error('Failed to save config file:', err);
      showAlert('حدث خطأ أثناء الاتصال بالنظام لحفظ الملف', 'error');
    }
  };

  const clearAll = () => setSelectedVariants({});

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden text-main">
      {/* ── Top Header ─────────────────────────────────────────────────── */}
      <div className="shrink-0 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-main flex items-center gap-2">
            <Tag className="w-5.5 h-5.5 text-violet-500" />
            محرك تصميم وطباعة الملصقات (TSPL Label Engine)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">صمم ملصق الباركود الخاص بك بالمليمتر، وشاهد المعاينة والشبكة لحظياً، واطبع بضغطة زر</p>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveConfig}
            className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-all px-3.5 py-2 bg-panel border border-main rounded-xl hover:bg-panel-hover"
          >
            <Settings className="w-4 h-4 text-violet-500" />
            حفظ تصميم الملصق كافتراضي
          </button>
        </div>
      </div>

      {/* ── Main Layout (3-Column Interface) ──────────────────────────── */}
      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        
        {/* ── Column 1: Product Selector (300px) ──────────────────────── */}
        <div className="w-[300px] shrink-0 flex flex-col gap-3 bg-panel border border-main rounded-2xl p-4 overflow-hidden">
          <h3 className="font-bold text-sm text-main flex items-center gap-2">
            <Search className="w-4 h-4 text-blue-500" />
            البحث واختيار الصنف
          </h3>
          
          <div className="relative shrink-0">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="ابحث بالاسم، الباركود..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-input-field border border-main text-main placeholder-muted text-xs pr-10 pl-4 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-violet-500 font-bold"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted text-xs gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-violet-500" /> جاري تحميل الأصناف...
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-slate-500 text-xs">لا توجد منتجات مطابقة</div>
            ) : (
              filteredProducts.map(product => (
                <div key={product.id} className="bg-panel-accent border border-main rounded-xl overflow-hidden">
                  <div
                    className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-main/30 transition-all select-none"
                    onClick={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-main truncate leading-tight">{product.name}</p>
                      <p className="text-[10px] text-muted font-bold mt-0.5">{product.category} · {product.variants.length} بدائل</p>
                    </div>
                    {expandedProduct === product.id ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
                  </div>

                  {expandedProduct === product.id && (
                    <div className="border-t border-main bg-panel divide-y divide-main">
                      {product.variants.map(v => {
                        const qty = selectedVariants[v.id] || 0;
                        return (
                          <div key={v.id} className="p-2.5 space-y-2 hover:bg-panel-hover transition-all">
                            <div className="flex justify-between items-start gap-1">
                              <div className="min-w-0">
                                <span className="text-[10px] font-black bg-panel-accent border border-main text-main px-1.5 py-0.5 rounded">{v.origin}</span>
                                <p className="font-mono text-[9px] text-slate-400 mt-1 select-all">{v.sku_barcode}</p>
                              </div>
                              <span className="text-xs font-black text-emerald-500 shrink-0">{v.selling_price.toFixed(0)} ج.م</span>
                            </div>

                            {/* Quantity Controls */}
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-slate-500">رصيد: {v.stock_quantity}</span>
                              <div className="flex items-center gap-1.5 scale-90 origin-left">
                                <button
                                  onClick={() => setQty(v.id, qty - 1)}
                                  className="w-6 h-6 rounded-lg bg-panel-accent border border-main flex items-center justify-center text-muted hover:text-rose-500 hover:border-rose-500/30 transition-all"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  max="9999"
                                  value={qty === 0 ? '' : qty}
                                  onChange={e => setQty(v.id, parseInt(e.target.value) || 0)}
                                  placeholder="0"
                                  className="w-10 text-center text-xs font-black bg-panel border border-main text-main rounded-lg py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
                                />
                                <button
                                  onClick={() => setQty(v.id, qty + 1)}
                                  className="w-6 h-6 rounded-lg bg-panel-accent border border-main flex items-center justify-center text-muted hover:text-emerald-500 hover:border-emerald-500/30 transition-all"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
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

        {/* ── Column 2: WYSIWYG Real-time Preview Panel (Flex-1) ────────── */}
        <div className="flex-1 flex flex-col gap-3 bg-panel border border-main rounded-2xl p-4 overflow-hidden relative">
          <div className="flex justify-between items-center pb-2 border-b border-main">
            <h3 className="font-bold text-sm text-main flex items-center gap-2">
              <Eye className="w-4 h-4 text-violet-500" />
              لوحة المعاينة التفاعلية بالمليمتر (Real-time Preview)
            </h3>
            {printQueue.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted">ملصق رقم {activePreviewIndex + 1} من {printQueue.length}</span>
                <div className="flex gap-1">
                  <button
                    disabled={activePreviewIndex === 0}
                    onClick={() => setActivePreviewIndex(prev => prev - 1)}
                    className="px-2 py-1 rounded bg-panel-accent border border-main text-[10px] text-main disabled:opacity-40"
                  >السابق</button>
                  <button
                    disabled={activePreviewIndex >= printQueue.length - 1}
                    onClick={() => setActivePreviewIndex(prev => prev + 1)}
                    className="px-2 py-1 rounded bg-panel-accent border border-main text-[10px] text-main disabled:opacity-40"
                  >التالي</button>
                </div>
              </div>
            )}
          </div>

          {/* Preview Label Box Area */}
          <div className="flex-1 flex items-center justify-center bg-panel-accent rounded-xl p-6 overflow-auto select-none">
            <div className="relative flex flex-col items-center">
              {/* Size Indicators (Top & Right Ruler) */}
              <div className="absolute -top-7 left-0 right-0 text-center text-[10px] text-slate-500 font-bold border-b border-dashed border-slate-500/30 pb-0.5">
                {barcodeConfig.widthMm} مم
              </div>
              <div className="absolute -left-9 top-0 bottom-0 flex items-center text-[10px] text-slate-500 font-bold border-r border-dashed border-slate-500/30 pr-1.5 writing-mode-vertical">
                {barcodeConfig.heightMm} مم
              </div>

              {/* The Physical Label Border simulation container */}
              <div 
                className="bg-white border border-slate-300 shadow-2xl overflow-hidden"
                style={{
                  width: `${barcodeConfig.widthMm * 6}px`, // Scaled up 6x for crisp screen view
                  height: `${barcodeConfig.heightMm * 6}px`
                }}
              >
                <canvas 
                  ref={previewCanvasRef} 
                  className={`w-full h-full object-contain block ${draggedElement ? 'cursor-grabbing' : 'cursor-grab'}`}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                />
              </div>
            </div>
          </div>

          {/* Queue summary at bottom */}
          <div className="flex items-center justify-between p-3 bg-panel-accent border border-main rounded-xl text-xs">
            <div>
              <span className="font-bold">المجموع الكلي: </span>
              <span className="font-black text-violet-500 text-sm">{totalLabels}</span> ملصق باركود جاهز للطباعة.
            </div>
            {printQueue.length > 0 && (
              <button onClick={clearAll} className="text-rose-500 hover:text-rose-400 font-bold">إفراغ القائمة</button>
            )}
          </div>
        </div>

        {/* ── Column 3: Design Inspector / Control Settings (320px) ────── */}
        <div className="w-[320px] shrink-0 flex flex-col gap-3 bg-panel border border-main rounded-2xl p-4 overflow-y-auto">
          <div className="pb-2 border-b border-main flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-sm text-main flex items-center gap-2">
                <Settings className="w-4 h-4 text-blue-500" />
                مفتش الأبعاد والتصميم
              </h3>
              <button
                onClick={() => setIsEditorLocked(prev => !prev)}
                className={`flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-xl transition-all duration-200 ${
                  isEditorLocked
                    ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 border border-rose-500/40'
                    : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/40'
                }`}
              >
                {isEditorLocked ? '🔒 مقفل' : '🔓 تعديل حر'}
              </button>
            </div>
            <button
              onClick={handleResetToRecommended}
              className="w-full flex items-center justify-center gap-2 text-xs font-bold py-1.5 rounded-xl bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/40 transition-all duration-200"
            >
              🔄 إعادة ضبط المقاسات للافتراضية الموصى بها
            </button>
            {resetSuccessNotification && (
              <div className="text-center text-xs text-emerald-400 font-bold animate-pulse">
                ✅ تم إعادة الضبط للمقاسات الموصى بها
              </div>
            )}
            {!isEditorLocked && (
              <div className="text-center text-[10px] text-amber-400 bg-amber-500/10 rounded-lg py-1 border border-amber-500/20">
                ⚠️ وضع التعديل الحر مفعّل — اسحب العناصر في المعاينة لتغيير مواضعها
              </div>
            )}
            {isEditorLocked && (
              <div className="text-center text-[10px] text-slate-400 bg-slate-500/10 rounded-lg py-1 border border-slate-500/20">
                🔒 المعاينة والتصميم مقفلان — افتح وضع التعديل للتخصيص
              </div>
            )}
          </div>

          {/* Size parameters */}
          <div className={`space-y-3 transition-opacity duration-200 ${isEditorLocked ? 'opacity-40 pointer-events-none select-none' : 'opacity-100'}`}>
            <p className="text-xs font-black text-violet-500 border-b border-main pb-1">📐 أبعاد الملصق (بالمليمتر)</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-muted mb-1">عرض الملصق (Width)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-3 text-center text-xs font-bold"
                  value={barcodeConfig.widthMm}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, widthMm: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">ارتفاع الملصق (Height)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-3 text-center text-xs font-bold"
                  value={barcodeConfig.heightMm}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, heightMm: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-muted mb-1">الفجوة البينية (Gap)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-3 text-center text-xs font-bold"
                  value={barcodeConfig.gap}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, gap: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">الهامش العلوي (Top Margin)</label>
                <input
                  type="number"
                  step="0.1"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-3 text-center text-xs font-bold"
                  value={barcodeConfig.marginTop}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, marginTop: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-muted mb-1">الهامش الأيمن (Right Margin)</label>
                <input
                  type="number"
                  step="0.1"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-3 text-center text-xs font-bold"
                  value={barcodeConfig.marginRight}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, marginRight: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">الهامش الأيسر (Left Margin)</label>
                <input
                  type="number"
                  step="0.1"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-3 text-center text-xs font-bold"
                  value={barcodeConfig.marginLeft}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, marginLeft: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>

          {/* Element Visibility Toggles */}
          <div className="space-y-3 pt-2">
            <p className="text-xs font-black text-violet-500 border-b border-main pb-1">👁️ إخفاء/إظهار عناصر الملصق</p>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-bold text-main">
              <div className="flex items-center gap-2 select-none">
                <input
                  type="checkbox"
                  id="showStoreName"
                  checked={barcodeConfig.showStoreName !== false}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, showStoreName: e.target.checked }))}
                  className="w-4 h-4 text-violet-600 border-main rounded focus:ring-violet-500 cursor-pointer"
                />
                <label htmlFor="showStoreName" className="cursor-pointer">اسم المحل</label>
              </div>
              <div className="flex items-center gap-2 select-none">
                <input
                  type="checkbox"
                  id="showProductName"
                  checked={barcodeConfig.showProductName !== false}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, showProductName: e.target.checked }))}
                  className="w-4 h-4 text-violet-600 border-main rounded focus:ring-violet-500 cursor-pointer"
                />
                <label htmlFor="showProductName" className="cursor-pointer">اسم المنتج</label>
              </div>
              <div className="flex items-center gap-2 select-none">
                <input
                  type="checkbox"
                  id="showBarcode"
                  checked={barcodeConfig.showBarcode !== false}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, showBarcode: e.target.checked }))}
                  className="w-4 h-4 text-violet-600 border-main rounded focus:ring-violet-500 cursor-pointer"
                />
                <label htmlFor="showBarcode" className="cursor-pointer">خطوط الباركود</label>
              </div>
              <div className="flex items-center gap-2 select-none">
                <input
                  type="checkbox"
                  id="showPrice"
                  checked={barcodeConfig.showPrice !== false}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, showPrice: e.target.checked }))}
                  className="w-4 h-4 text-violet-600 border-main rounded focus:ring-violet-500 cursor-pointer"
                />
                <label htmlFor="showPrice" className="cursor-pointer">السعر</label>
              </div>
              <div className="flex items-center gap-2 select-none col-span-2">
                <input
                  type="checkbox"
                  id="showOrigin"
                  checked={barcodeConfig.showOrigin !== false}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, showOrigin: e.target.checked }))}
                  className="w-4 h-4 text-violet-600 border-main rounded focus:ring-violet-500 cursor-pointer"
                />
                <label htmlFor="showOrigin" className="cursor-pointer">بلد المنشأ</label>
              </div>
            </div>
          </div>

          {/* Barcode customization */}
          <div className="space-y-3 pt-2">
            <p className="text-xs font-black text-violet-500 border-b border-main pb-1">🏷️ إعدادات الباركود (Barcode Command)</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-muted mb-1">موضع الباركود X (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-3 text-center text-xs font-bold"
                  value={barcodeConfig.barcodeX}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, barcodeX: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">موضع الباركود Y (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-3 text-center text-xs font-bold"
                  value={barcodeConfig.barcodeY}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, barcodeY: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-muted mb-1">عرض شريط الخط (Dots)</label>
                <select
                  className="w-full bg-input-field border border-main text-main rounded-xl py-1.5 px-3 text-center text-xs font-bold"
                  value={barcodeConfig.scaleWidth}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, scaleWidth: parseInt(e.target.value) || 2 }))}
                >
                  <option value={1}>1 Dot (ضيق جداً)</option>
                  <option value={2}>2 Dots (عادي - 203 DPI)</option>
                  <option value={3}>3 Dots (عريض - 300 DPI)</option>
                  <option value={4}>4 Dots (عريض جداً)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">ارتفاع الخط (Barcode Height)</label>
                <input
                  type="number"
                  step="2"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-3 text-center text-xs font-bold"
                  value={barcodeConfig.scaleHeight}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, scaleHeight: parseInt(e.target.value) || 40 }))}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1 select-none">
              <input
                type="checkbox"
                id="showCodeText"
                checked={barcodeConfig.showText}
                onChange={e => setBarcodeConfig(prev => ({ ...prev, showText: e.target.checked }))}
                className="w-4 h-4 text-violet-600 border-main rounded focus:ring-violet-500 cursor-pointer"
              />
              <label htmlFor="showCodeText" className="text-[11px] font-bold text-main cursor-pointer">إظهار أرقام الباركود أسفل الملصق</label>
            </div>
          </div>

          {/* Typography layout */}
          <div className="space-y-3 pt-2">
            <p className="text-xs font-black text-violet-500 border-b border-main pb-1">✍️ حجم الخطوط وموضع النصوص</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-muted mb-1">خط المحل (px)</label>
                <input
                  type="number"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-2 text-center text-xs font-bold"
                  value={barcodeConfig.storeFontSize}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, storeFontSize: parseInt(e.target.value) || 12 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">موضع X (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-2 text-center text-xs font-bold"
                  value={barcodeConfig.storeX}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, storeX: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">موضع Y (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-2 text-center text-xs font-bold"
                  value={barcodeConfig.storeY}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, storeY: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-muted mb-1">خط الاسم (px)</label>
                <input
                  type="number"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-2 text-center text-xs font-bold"
                  value={barcodeConfig.nameFontSize}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, nameFontSize: parseInt(e.target.value) || 12 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">موضع X (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-2 text-center text-xs font-bold"
                  value={barcodeConfig.nameX}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, nameX: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">موضع Y (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-2 text-center text-xs font-bold"
                  value={barcodeConfig.nameY}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, nameY: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-muted mb-1">خط السعر (px)</label>
                <input
                  type="number"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-2 text-center text-xs font-bold"
                  value={barcodeConfig.priceFontSize}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, priceFontSize: parseInt(e.target.value) || 12 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">موضع X (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-2 text-center text-xs font-bold"
                  value={barcodeConfig.priceX}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, priceX: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">موضع Y (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-2 text-center text-xs font-bold"
                  value={barcodeConfig.priceY}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, priceY: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-muted mb-1">خط المنشأ (px)</label>
                <input
                  type="number"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-2 text-center text-xs font-bold"
                  value={barcodeConfig.originFontSize}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, originFontSize: parseInt(e.target.value) || 12 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">موضع X (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-2 text-center text-xs font-bold"
                  value={barcodeConfig.originX}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, originX: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] text-muted mb-1">موضع Y (mm)</label>
                <input
                  type="number"
                  step="0.5"
                  className="w-full bg-input-field text-main border border-main rounded-xl py-1.5 px-2 text-center text-xs font-bold"
                  value={barcodeConfig.originY}
                  onChange={e => setBarcodeConfig(prev => ({ ...prev, originY: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 pt-3 border-t border-main mt-auto shrink-0">
            {/* PRIMARY: TSPL Raw direct print */}
            <button
              onClick={handleDirectTsplPrint}
              disabled={printQueue.length === 0 || isPrinting}
              className={`w-full font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm shadow-lg active:scale-[0.98] ${
                printDone
                  ? 'bg-emerald-600 text-white'
                  : 'bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-500 text-white'
              }`}
            >
              <Printer className="w-4.5 h-4.5" />
              {isPrinting ? 'جاري الإرسال للطابعة...' : printDone ? '✅ تمت الطباعة بنجاح!' : `طباعة فورية (${totalLabels} ملصق)`}
            </button>

            {/* SECONDARY: View TSPL source */}
            <button
              onClick={() => setShowTsplModal(true)}
              className="w-full bg-panel border border-main hover:border-violet-500/40 text-slate-300 hover:text-white font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-2 text-xs"
            >
              <Code className="w-4 h-4 text-violet-500" />
              معاينة كود TSPL المتولد
            </button>

            {/* TERTIARY: Save settings */}
            <button
              onClick={handleSaveConfig}
              className={`w-full border font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-2 text-xs ${
                saveSuccessNotification
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : 'bg-panel border-main hover:border-emerald-500/40 text-slate-300 hover:text-white'
              }`}
            >
              <Save className="w-4 h-4 text-emerald-500" />
              {saveSuccessNotification ? 'تم حفظ الإعدادات كافتراضي!' : 'حفظ التصميم كافتراضي'}
            </button>
          </div>
        </div>
      </div>

      {/* ── TSPL Code Preview Modal ─────────────────────────────────────── */}
      {showTsplModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in text-main">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-2xl space-y-4 shadow-2xl flex flex-col h-[500px]">
            <div className="flex justify-between items-center pb-2 border-b border-main shrink-0">
              <div>
                <span className="text-[10px] bg-main border border-main text-muted px-2 py-0.5 rounded font-bold">TSPL Compiler Raw Output</span>
                <h3 className="font-bold text-base text-main mt-1">كود أوامر TSPL المتولد للملصق النشط</h3>
              </div>
              <button 
                onClick={() => setShowTsplModal(false)}
                className="text-slate-400 hover:text-white transition-all text-sm font-bold bg-panel-accent border border-main px-3 py-1.5 rounded-lg"
              >
                إغلاق النافذة
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-black/35 rounded-2xl p-4 font-mono text-xs text-emerald-400 border border-main leading-relaxed select-all">
              <pre>{compiledTsplCodeString}</pre>
            </div>
            
            <div className="flex items-center gap-2 text-[10px] text-slate-400 bg-violet-500/5 border border-violet-500/10 p-3 rounded-xl shrink-0">
              <AlertCircle className="w-4 h-4 text-violet-500 shrink-0" />
              ملاحظة: يتم دمج النصوص العربية والأسعار وصورة الخلفية كصورة ثنائية بترميز BITMAP في خادم بايثون، بينما يتم توليد الباركود ككود BARCODE برمجي منفصل لضمان استغلال الدقة الفرعية لرأس الطباعة.
            </div>
          </div>
        </div>
      )}

      {/* Custom Reusable React Alert Modal Overlay */}
      {alertConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-sm space-y-4 text-center shadow-2xl">
            <div className="text-lg font-bold text-main">إشعار النظام</div>
            <p className="text-xs text-muted leading-relaxed">{alertConfig.message}</p>
            <button
              onClick={() => setAlertConfig(null)}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all active:scale-95 shadow-md"
            >
              موافق / إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
