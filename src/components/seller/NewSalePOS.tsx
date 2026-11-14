import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Search,
  Barcode,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  DollarSign,
  CreditCard,
  Smartphone,
  Landmark,
  Layers,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  Loader2,
  TrendingUp,
  Mic,
  Square,
  X,
  Sparkles,
  Keyboard,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SalesService } from '../../services/salesService';
import { Product, PaymentMethod } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { ProductImageViewerModal } from '../common/ProductImageViewerModal';
import { VoiceSaleService, VoiceSaleResult, VoiceSaleItem } from '../../services/voiceSaleService';
import { VoiceSalePreview } from '../VoiceSalePreview';

const PAGE_SIZE = 20;

interface CartItem {
  product: Product;
  quantity: number | string;
  unitPrice: number | string;
  discount: number;
}

// ─────────────────────────────────────────────────────────────
// Unit helpers
// ─────────────────────────────────────────────────────────────
const DECIMAL_UNIT_REGEX = /(kg|kilogram|g\b|gram|liter|litre|^l$|\bl\b|ml|milliliter|millilitre|meter|mita|metre|^m$|\bm\b|sentimita|cm|oz|lb)/i;

const isDecimalUnit = (unit?: string): boolean => {
  if (!unit) return false;
  return DECIMAL_UNIT_REGEX.test(unit.trim());
};

const minQtyForUnit = (unit?: string): number => (isDecimalUnit(unit) ? 0.01 : 1);
const stepSizeForUnit = (unit?: string): number => (isDecimalUnit(unit) ? 0.25 : 1);
const round3 = (n: number): number => Number(n.toFixed(3));

export const NewSalePOS: React.FC = () => {
  const { currentUser, dbState, addToast, showReceipt, sellerColor, selectedShopId, currentShop } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [overallDiscount, setOverallDiscount] = useState<number>(0);
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [saleNotes, setSaleNotes] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const [isParsingVoice, setIsParsingVoice] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<VoiceSaleResult | null>(null);
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const settings = dbState.settings;

  const targetShopId = currentShop?.id || (selectedShopId !== 'ALL' ? selectedShopId : '') || (dbState.shops[0]?.id || '');

  const products = useMemo(() => {
    return dbState.products.filter(
      p => p.status === 'ACTIVE' && (!targetShopId || p.shopId === targetShopId || !p.shopId)
    );
  }, [dbState.products, targetShopId]);

  // ─────────────────────────────────────────────────────────────
  // Most-selling map
  // ─────────────────────────────────────────────────────────────
  const salesCountMap = useMemo(() => {
    const map = new Map<string, number>();
    const sales = dbState.sales || [];
    for (const sale of sales) {
      if (sale.status !== 'COMPLETED') continue;
      if (targetShopId && sale.shopId !== targetShopId) continue;
      for (const item of sale.items || []) {
        map.set(item.productId, (map.get(item.productId) || 0) + (item.quantity || 0));
      }
    }
    return map;
  }, [dbState.sales, targetShopId]);

  const categories = useMemo(() => {
    const all = dbState.categories || [];
    if (targetShopId === 'ALL') return all;
    return all.filter(c => c.shopId === targetShopId);
  }, [dbState.categories, targetShopId]);

  // ─────────────────────────────────────────────────────────────
  // Filter + sort
  // ─────────────────────────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    const filtered = products.filter(p => {
      const matchesCategory = selectedCategory === 'ALL' || p.categoryId === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });

    return [...filtered].sort((a, b) => {
      const aSales = salesCountMap.get(a.id) || 0;
      const bSales = salesCountMap.get(b.id) || 0;
      if (bSales !== aSales) return bSales - aSales;
      if (b.currentStock !== a.currentStock) return b.currentStock - a.currentStock;
      return a.name.localeCompare(b.name);
    });
  }, [products, selectedCategory, searchQuery, salesCountMap]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, selectedCategory]);

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const hasMore = filteredProducts.length > visibleCount;
  const remaining = filteredProducts.length - visibleCount;

  const handleSeeMore = () => {
    setIsLoadingMore(true);
    setTimeout(() => {
      setVisibleCount(prev => prev + PAGE_SIZE);
      setIsLoadingMore(false);
    }, 300);
  };

  const handleSeeLess = () => setVisibleCount(PAGE_SIZE);

  // ─────────────────────────────────────────────────────────────
  // Numeric coercion
  // ─────────────────────────────────────────────────────────────
  const qtyNum = (q: number | string): number => {
    if (typeof q === 'number') return Number.isFinite(q) ? q : 0;
    const parsed = parseFloat(q);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const priceNum = (p: number | string): number => {
    if (typeof p === 'number') return Number.isFinite(p) ? p : 0;
    const parsed = parseFloat(p);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + qtyNum(item.quantity) * priceNum(item.unitPrice) - item.discount, 0),
    [cart]
  );

  const totalAmount = useMemo(() => {
    const discounted = Math.max(0, subtotal - overallDiscount);
    return Number(discounted.toFixed(2));
  }, [subtotal, overallDiscount]);

  const tenderValue = parseFloat(amountReceived) || 0;
  const changeAmount = paymentMethod === 'CASH' ? Math.max(0, tenderValue - totalAmount) : 0;

  useEffect(() => {
    if (paymentMethod === 'CASH') setAmountReceived(totalAmount.toFixed(2));
  }, [totalAmount, paymentMethod]);

  const cartItemCountLabel = useMemo(() => {
    const totalQty = cart.reduce((s, i) => s + qtyNum(i.quantity), 0);
    const hasDecimal = cart.some(i => isDecimalUnit(i.product.unit));
    return hasDecimal ? Number(totalQty.toFixed(2)).toString() : totalQty.toString();
  }, [cart]);

  // ─────────────────────────────────────────────────────────────
  // Cart ops
  // ─────────────────────────────────────────────────────────────
  const addToCart = (product: Product) => {
    if (product.currentStock <= 0) {
      addToast({
        type: 'warning',
        title: 'Out of Stock',
        description: `${product.name} is currently out of stock.`,
      });
      return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      const step = stepSizeForUnit(product.unit);

      if (existing) {
        const currentQty = qtyNum(existing.quantity);
        const nextQty = round3(currentQty + step);
        if (nextQty > product.currentStock) {
          addToast({
            type: 'warning',
            title: 'Stock Limit Reached',
            description: `Only ${product.currentStock} ${product.unit} available in inventory.`,
          });
          return prev;
        }
        return prev.map(item =>
          item.product.id === product.id ? { ...item, quantity: nextQty } : item
        );
      }

      const initialQty = isDecimalUnit(product.unit) ? 0.25 : 1;
      return [...prev, { product, quantity: initialQty, unitPrice: product.sellingPrice, discount: 0 }];
    });
  };

  // Voice → cart merge
  const addDraftToCart = (items: VoiceSaleItem[]) => {
    const warnings: string[] = [];

    setCart(prev => {
      const next = [...prev];
      for (const it of items) {
        const product = it.productId
          ? products.find(p => p.id === it.productId)
          : products.find(p => p.name.toLowerCase() === (it.productName ?? '').toLowerCase());

        if (!product) {
          warnings.push(`"${it.productName ?? 'item'}" not found — skipped`);
          continue;
        }
        if (product.currentStock <= 0) {
          warnings.push(`"${product.name}" is out of stock`);
          continue;
        }

        const minQty = minQtyForUnit(product.unit);
        const requested = it.quantity > 0 ? it.quantity : 1;
        const safeQty = Math.min(Math.max(requested, minQty), product.currentStock);
        if (safeQty < requested) {
          warnings.push(
            `Only ${product.currentStock} ${product.unit} of ${product.name} in stock (asked ${requested})`
          );
        }

        const existingIdx = next.findIndex(c => c.product.id === product.id);
        if (existingIdx >= 0) {
          const merged = round3(qtyNum(next[existingIdx].quantity) + safeQty);
          next[existingIdx] = {
            ...next[existingIdx],
            quantity: Math.min(merged, product.currentStock),
            unitPrice: it.unitPrice ?? next[existingIdx].unitPrice,
          };
        } else {
          next.push({
            product,
            quantity: round3(safeQty),
            unitPrice: it.unitPrice ?? product.sellingPrice,
            discount: 0,
          });
        }
      }
      return next;
    });

    if (warnings.length) {
      setVoiceWarning(warnings.join(' • '));
      setTimeout(() => setVoiceWarning(null), 6000);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Voice recording
  // ─────────────────────────────────────────────────────────────
  const startVoiceRecording = async () => {
    setVoiceWarning(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];

      rec.ondataavailable = e => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size === 0) {
          addToast({ type: 'warning', title: 'No audio captured' });
          return;
        }

        setIsParsingVoice(true);
        try {
          const result = await VoiceSaleService.parseAudio(blob, targetShopId || null);
          if (!result.draft.items.length) {
            addToast({
              type: 'error',
              title: 'Could not understand',
              description: 'Try again and mention the product name and price.',
            });
            return;
          }
          addToast({
            type: 'info',
            title: 'Voice sale parsed',
            description: result.transcript.length > 90 ? result.transcript.slice(0, 90) + '…' : result.transcript,
          });
          setVoiceDraft(result);
        } catch (err: any) {
          addToast({
            type: 'error',
            title: 'Voice processing failed',
            description: err.message ?? 'Please try again.',
          });
        } finally {
          setIsParsingVoice(false);
        }
      };

      rec.start();
      recorderRef.current = rec;
      setIsRecording(true);
    } catch {
      addToast({
        type: 'error',
        title: 'Microphone blocked',
        description: 'Grant microphone permission to use voice sales.',
      });
    }
  };

  const stopVoiceRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setIsRecording(false);
  };

  // ─────────────────────────────────────────────────────────────
  // Price + qty inputs
  // ─────────────────────────────────────────────────────────────
  const updateUnitPrice = (productId: string, rawValue: string) => {
    if (rawValue === '') {
      setCart(prev => prev.map(i => (i.product.id === productId ? { ...i, unitPrice: '' } : i)));
      return;
    }
    const parsed = parseFloat(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setCart(prev => prev.map(i => (i.product.id === productId ? { ...i, unitPrice: rawValue } : i)));
      return;
    }
    setCart(prev => prev.map(i => (i.product.id === productId ? { ...i, unitPrice: rawValue } : i)));
  };

  const handlePriceBlur = (productId: string) => {
    setCart(prev =>
      prev.map(i => {
        if (i.product.id !== productId) return i;
        const n = priceNum(i.unitPrice);
        if (i.unitPrice === '' || n <= 0) {
          return { ...i, unitPrice: i.product.sellingPrice };
        }
        return { ...i, unitPrice: n };
      })
    );
  };

  const updateQuantity = (productId: string, rawValue: string) => {
    const item = cart.find(i => i.product.id === productId);
    if (!item) return;

    if (rawValue === '') {
      setCart(prev => prev.map(i => (i.product.id === productId ? { ...i, quantity: '' } : i)));
      return;
    }
    if (rawValue === '.' || rawValue.endsWith('.')) {
      if (/^\d*\.?\d*$/.test(rawValue)) {
        setCart(prev => prev.map(i => (i.product.id === productId ? { ...i, quantity: rawValue } : i)));
      }
      return;
    }
    if (!/^\d*\.?\d*$/.test(rawValue)) return;

    const parsed = parseFloat(rawValue);
    if (!Number.isFinite(parsed)) {
      setCart(prev => prev.map(i => (i.product.id === productId ? { ...i, quantity: rawValue } : i)));
      return;
    }

    const minQty = minQtyForUnit(item.product.unit);
    let nextQty = parsed;

    if (nextQty < minQty) {
      setCart(prev => prev.map(i => (i.product.id === productId ? { ...i, quantity: rawValue } : i)));
      return;
    }
    if (nextQty > item.product.currentStock) {
      addToast({
        type: 'warning',
        title: 'Stock Exceeded',
        description: `Max stock for this item is ${item.product.currentStock} ${item.product.unit}.`,
      });
      nextQty = item.product.currentStock;
    }
    setCart(prev => prev.map(i => (i.product.id === productId ? { ...i, quantity: rawValue } : i)));
  };

  const handleQuantityBlur = (productId: string) => {
    setCart(prev =>
      prev.map(i => {
        if (i.product.id !== productId) return i;
        const minQty = minQtyForUnit(i.product.unit);
        const n = qtyNum(i.quantity);
        return { ...i, quantity: round3(n < minQty ? minQty : n) };
      })
    );
  };

  const stepQuantity = (productId: string, delta: number) => {
    const item = cart.find(i => i.product.id === productId);
    if (!item) return;
    const step = stepSizeForUnit(item.product.unit);
    const minQty = minQtyForUnit(item.product.unit);
    const current = qtyNum(item.quantity) || minQty;
    const next = Math.max(minQty, round3(current + delta * step));
    updateQuantity(productId, String(next));
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(i => i.product.id !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setOverallDiscount(0);
    setAmountReceived('');
    setSaleNotes('');
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    const scanned = products.find(
      p => p.barcode === barcodeInput.trim() || p.sku.toLowerCase() === barcodeInput.trim().toLowerCase()
    );

    if (scanned) {
      addToCart(scanned);
      setBarcodeInput('');
      addToast({ type: 'info', title: 'Item Added', description: `${scanned.name} added to cart.` });
    } else {
      addToast({
        type: 'error',
        title: 'Barcode Not Found',
        description: `No active product found for barcode '${barcodeInput}'.`,
      });
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Complete sale
  // ─────────────────────────────────────────────────────────────
  const handleCompleteSale = useCallback(() => {
    if (!currentUser) return;

    if (cart.length === 0) {
      addToast({ type: 'warning', title: 'Cart is Empty', description: 'Please add items to cart before completing sale.' });
      return;
    }

    const invalid = cart.find(i => qtyNum(i.quantity) < minQtyForUnit(i.product.unit));
    if (invalid) {
      addToast({
        type: 'error',
        title: 'Invalid Quantity',
        description: `Please set a valid quantity for ${invalid.product.name} (min ${minQtyForUnit(invalid.product.unit)} ${invalid.product.unit}).`,
      });
      return;
    }

    const invalidPrice = cart.find(i => priceNum(i.unitPrice) <= 0);
    if (invalidPrice) {
      addToast({
        type: 'error',
        title: 'Invalid Price',
        description: `Please set a price greater than 0 for ${invalidPrice.product.name}.`,
      });
      return;
    }

    const tender = paymentMethod === 'CASH' ? (parseFloat(amountReceived) || 0) : totalAmount;
    if (paymentMethod === 'CASH' && tender < totalAmount) {
      addToast({
        type: 'error',
        title: 'Insufficient Payment',
        description: `Tendered cash (${formatCurrency(tender, settings.currencySymbol)}) is less than total due (${formatCurrency(totalAmount, settings.currencySymbol)}).`,
      });
      return;
    }

    setIsProcessing(true);
    const result = SalesService.createSale(
      {
        shopId: targetShopId === 'ALL' ? (dbState.shops[0]?.id || '') : (targetShopId || dbState.shops[0]?.id || ''),
        items: cart.map(i => ({
          productId: i.product.id,
          quantity: qtyNum(i.quantity),
          unitPrice: priceNum(i.unitPrice),
          discount: i.discount,
        })),
        paymentMethod,
        discount: overallDiscount,
        amountReceived: tender,
        notes: saleNotes,
      },
      currentUser
    );
    setIsProcessing(false);

    if (result.success && result.sale) {
      addToast({
        type: 'success',
        title: 'Sale Completed Successfully',
        description: `Receipt #${result.sale.receiptNumber} generated. Inventory updated.`,
      });
      showReceipt(result.sale);
      clearCart();
    } else {
      addToast({
        type: 'error',
        title: 'Sale Failed',
        description: result.error || 'Could not complete transaction.',
      });
    }
  }, [currentUser, cart, paymentMethod, amountReceived, totalAmount, overallDiscount, saleNotes, targetShopId, dbState.shops, settings.currencySymbol, addToast, showReceipt]);

  // ─────────────────────────────────────────────────────────────
  // PC keyboard shortcuts
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing in inputs
      const target = e.target as HTMLElement;
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName);

      // Ctrl/Cmd + K — focus search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Ctrl/Cmd + B — focus barcode
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        barcodeInputRef.current?.focus();
        return;
      }

      // Ctrl/Cmd + Enter — complete sale (works even mid-input)
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleCompleteSale();
        return;
      }

      // Esc — close preview / clear search
      if (e.key === 'Escape') {
        if (voiceDraft) { setVoiceDraft(null); return; }
        if (isViewerOpen) { setIsViewerOpen(false); return; }
        if (!isInput && searchQuery) setSearchQuery('');
        return;
      }

      // F2 — start/stop voice recording
      if (e.key === 'F2') {
        e.preventDefault();
        if (isRecording) stopVoiceRecording();
        else if (!isParsingVoice) startVoiceRecording();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleCompleteSale, voiceDraft, isViewerOpen, searchQuery, isRecording, isParsingVoice]);

  return (
    <div id="pos-terminal" className="flex-1 flex overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Left: catalog */}
      <div className="flex-1 flex flex-col border-r border-slate-800 overflow-hidden min-w-0">
        {/* Toolbar */}
        <div className="p-4 bg-slate-900 border-b border-slate-800 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                ref={searchInputRef}
                id="pos-search-input"
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search products by name, SKU or keyword…  (Ctrl+K)"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-20 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition"
              />
              <kbd className="hidden xl:inline-flex absolute right-2.5 top-2 px-2 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-900 border border-slate-700 rounded">
                Ctrl K
              </kbd>
            </div>

            {/* Voice mic */}
            <button
              type="button"
              onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
              disabled={isParsingVoice}
              title={isRecording ? 'Stop recording (F2)' : 'Voice sale (F2)'}
              className={`relative h-11 px-3.5 rounded-xl border text-sm font-semibold flex items-center gap-2 transition shrink-0 disabled:opacity-50 ${
                isRecording
                  ? 'bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-500/20 animate-pulse'
                  : isParsingVoice
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:border-blue-500/50'
              }`}
            >
              {isParsingVoice ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="hidden lg:inline">Parsing…</span>
                </>
              ) : isRecording ? (
                <>
                  <Square className="w-4 h-4" />
                  <span className="hidden lg:inline">Stop</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" />
                  <span className="hidden lg:inline">Voice</span>
                </>
              )}
            </button>

            <form onSubmit={handleBarcodeSubmit} className="relative w-64 hidden md:block">
              <Barcode className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                ref={barcodeInputRef}
                id="pos-barcode-input"
                type="text"
                value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                placeholder="Scan barcode [Enter]"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition"
              />
              <kbd className="hidden xl:inline-flex absolute right-2.5 top-2 px-2 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-900 border border-slate-700 rounded">
                Ctrl B
              </kbd>
            </form>
          </div>

          {/* Category chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-thin">
            <button
              onClick={() => setSelectedCategory('ALL')}
              className={`px-3.5 py-1.5 rounded-full whitespace-nowrap text-xs font-semibold transition ${
                selectedCategory === 'ALL'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
            >
              All Categories ({products.length})
            </button>
            {categories.map(cat => {
              const count = products.filter(p => p.categoryId === cat.id).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3.5 py-1.5 rounded-full whitespace-nowrap text-xs font-semibold transition ${
                    selectedCategory === cat.id
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {cat.name} ({count})
                </button>
              );
            })}
          </div>

          {/* Voice warning banner */}
          {voiceWarning && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs animate-in fade-in">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="flex-1">{voiceWarning}</span>
              <button onClick={() => setVoiceWarning(null)} className="text-amber-400 hover:text-amber-200 shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Result count */}
          {filteredProducts.length > 0 && (
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-emerald-400" />
                Showing{' '}
                <span className="text-slate-300 font-semibold">{Math.min(visibleCount, filteredProducts.length)}</span>{' '}
                of <span className="text-slate-300 font-semibold">{filteredProducts.length}</span>{' '}
                {searchQuery ? 'matching products' : '(top sellers first)'}
              </span>
              <span className="hidden xl:flex items-center gap-1 text-[10px] text-slate-600">
                <Keyboard className="w-3 h-3" />
                Ctrl+Enter = complete sale · F2 = voice
              </span>
            </div>
          )}
        </div>

        {/* Product grid */}
        <div className="flex-1 p-4 overflow-y-auto">
          {filteredProducts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
              <Layers className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm font-medium text-slate-400">No products match your search</p>
              <p className="text-xs text-slate-600 mt-1">Try another category or scan a barcode.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3">
                {visibleProducts.map(product => {
                  const isOutOfStock = product.currentStock <= 0;
                  const isLowStock = product.currentStock > 0 && product.currentStock <= product.minStock;
                  const unitsSold = salesCountMap.get(product.id) || 0;
                  const decimalUnit = isDecimalUnit(product.unit);

                  return (
                    <div
                      key={product.id}
                      id={`pos-product-${product.id}`}
                      className={`p-3 rounded-xl border transition-all flex flex-col justify-between h-40 relative overflow-hidden group active:scale-[0.99] ${
                        isOutOfStock
                          ? 'bg-slate-900/40 border-slate-800/60 opacity-50'
                          : 'bg-slate-900 border-slate-800 hover:border-blue-500/60 hover:bg-slate-850 hover:shadow-xl hover:shadow-blue-500/5 cursor-pointer'
                      }`}
                      onClick={() => !isOutOfStock && addToCart(product)}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-1 mb-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className="text-[10px] font-mono text-slate-400 truncate">{product.sku}</span>
                            {unitsSold > 0 && (
                              <span
                                className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-bold shrink-0"
                                title={`${unitsSold} units sold historically`}
                              >
                                🔥 {Number(unitsSold.toFixed(2))}
                              </span>
                            )}
                          </div>
                          {isOutOfStock ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 shrink-0">
                              Out
                            </span>
                          ) : isLowStock ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-semibold shrink-0">
                              {product.currentStock} {product.unit}
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 shrink-0">
                              {product.currentStock} {product.unit}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <ProductThumbnail
                            product={product}
                            size="sm"
                            onClick={e => {
                              e?.stopPropagation?.();
                              setViewingProduct(product);
                              setIsViewerOpen(true);
                            }}
                          />
                          <h4 className="text-sm font-semibold text-white line-clamp-2 flex-1 min-w-0 group-hover:text-blue-300 transition" title={product.name}>
                            {product.name}
                          </h4>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/60">
                        <span className="text-sm font-bold text-emerald-400 font-mono">
                          {formatCurrency(product.sellingPrice, settings.currencySymbol)}
                          {decimalUnit && <span className="text-[10px] text-slate-500 font-normal"> /{product.unit}</span>}
                        </span>
                        <button
                          type="button"
                          disabled={isOutOfStock}
                          onClick={e => {
                            e.stopPropagation();
                            addToCart(product);
                          }}
                          className="w-7 h-7 rounded-lg bg-blue-600/20 hover:bg-blue-600 group-hover:bg-blue-600 text-blue-300 group-hover:text-white flex items-center justify-center transition disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Add to cart"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {filteredProducts.length > PAGE_SIZE && (
                <div className="mt-5 pt-5 border-t border-slate-800/60 flex items-center justify-between gap-3">
                  <div className="text-[11px] text-slate-500">
                    Showing{' '}
                    <span className="text-slate-300 font-semibold">{Math.min(visibleCount, filteredProducts.length)}</span>{' '}
                    of <span className="text-slate-300 font-semibold">{filteredProducts.length}</span> products
                  </div>
                  <div className="flex items-center gap-2">
                    {visibleCount > PAGE_SIZE && (
                      <button
                        onClick={handleSeeLess}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                      >
                        Show Less
                      </button>
                    )}
                    {hasMore && (
                      <button
                        onClick={handleSeeMore}
                        disabled={isLoadingMore}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold shadow transition disabled:opacity-60 disabled:cursor-wait"
                      >
                        {isLoadingMore ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Loading…</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            <span>See More ({Math.min(PAGE_SIZE, remaining)} of {remaining})</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right: cart sidebar */}
      <div className="w-[440px] xl:w-[480px] bg-slate-900 flex flex-col shrink-0 overflow-hidden border-l border-slate-800">
        <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Active Sale Cart ({cartItemCountLabel} items)
            </h3>
          </div>
          {cart.length > 0 && (
            <button
              id="clear-cart-btn"
              onClick={clearCart}
              className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 font-medium transition"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>

        <div className="flex-1 p-3 overflow-y-auto space-y-2">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
              <ShoppingCart className="w-12 h-12 mb-3 text-slate-700" />
              <p className="text-sm font-semibold text-slate-400">Cart is Empty</p>
              <p className="text-xs text-slate-600 mt-1">Click products, scan barcodes, or use the mic to begin.</p>
            </div>
          ) : (
            cart.map(item => {
              const referencePrice = item.product.proposedSellingPrice || item.product.sellingPrice || 0;
              const unitPriceNum = priceNum(item.unitPrice);
              const isBelowReference = referencePrice > 0 && unitPriceNum > 0 && unitPriceNum < referencePrice;
              const decimalUnit = isDecimalUnit(item.product.unit);

              return (
                <div key={item.product.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5 transition">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <ProductThumbnail
                        product={item.product}
                        size="sm"
                        onClick={() => {
                          setViewingProduct(item.product);
                          setIsViewerOpen(true);
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h5 className="text-sm font-semibold text-white truncate">{item.product.name}</h5>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                            {item.product.sku}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          <span className="font-semibold text-emerald-400 font-mono">
                            {formatCurrency(qtyNum(item.quantity) * priceNum(item.unitPrice) - item.discount, settings.currencySymbol)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.product.id)}
                      className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-950/30 shrink-0 transition"
                      title="Remove item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-900">
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10px] text-slate-400">Price:</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.unitPrice}
                        onChange={e => updateUnitPrice(item.product.id, e.target.value)}
                        onBlur={() => handlePriceBlur(item.product.id)}
                        onFocus={e => e.target.select()}
                        className={`w-24 bg-slate-900 border rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:ring-1 ${
                          isBelowReference
                            ? 'border-rose-500/60 focus:ring-rose-500'
                            : 'border-slate-800 focus:ring-blue-500'
                        }`}
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-slate-400">Qty:</label>
                      <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
                        <button
                          type="button"
                          onClick={() => stepQuantity(item.product.id, -1)}
                          className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={item.quantity}
                          onChange={e => updateQuantity(item.product.id, e.target.value)}
                          onBlur={() => handleQuantityBlur(item.product.id)}
                          onFocus={e => e.target.select()}
                          className="w-14 bg-slate-950 border border-slate-700 rounded text-center text-xs font-bold text-white font-mono py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => stepQuantity(item.product.id, 1)}
                          className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono min-w-[28px]">{item.product.unit}</span>
                    </div>
                  </div>

                  {decimalUnit && (
                    <div className="text-[10px] text-slate-500 italic">
                      Sold by measure — decimal quantity allowed (e.g., 0.25, 1.5)
                    </div>
                  )}

                  {isBelowReference && (
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-rose-400 bg-rose-500/10 px-2 py-1 rounded border border-rose-500/25">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>Selling below reference price</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-3">
          <div>
            <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Payment Method
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { id: 'CASH', label: 'Cash', icon: DollarSign },
                { id: 'MOBILE_MONEY', label: 'Mobile', icon: Smartphone },
                { id: 'CARD', label: 'Card', icon: CreditCard },
                { id: 'BANK', label: 'Bank', icon: Landmark },
              ].map(m => {
                const Icon = m.icon;
                const active = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
                    id={`pay-method-${m.id}`}
                    type="button"
                    onClick={() => setPaymentMethod(m.id as PaymentMethod)}
                    className={`flex flex-col items-center justify-center py-2 rounded-lg text-[11px] font-semibold border transition ${
                      active
                        ? 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/20'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 mb-0.5" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {paymentMethod === 'CASH' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Amount Tendered</span>
                <span className="text-slate-500 text-[10px]">Auto-filled</span>
              </div>
              <input
                id="tender-amount-input"
                type="number"
                step="0.01"
                min="0"
                value={amountReceived}
                onChange={e => setAmountReceived(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-base font-mono font-bold text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {changeAmount > 0 && (
                <div className="flex justify-between items-center px-2.5 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs">
                  <span className="text-emerald-400 font-medium">Change to Return:</span>
                  <span className="text-emerald-300 font-bold font-mono text-sm">
                    {formatCurrency(changeAmount, settings.currencySymbol)}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-1 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal</span>
              <span className="font-mono">{formatCurrency(subtotal, settings.currencySymbol)}</span>
            </div>
            {overallDiscount > 0 && (
              <div className="flex justify-between text-amber-400">
                <span>Discount</span>
                <span className="font-mono">-{formatCurrency(overallDiscount, settings.currencySymbol)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-extrabold text-white pt-2 border-t border-slate-800">
              <span>TOTAL DUE</span>
              <span className="text-emerald-400 font-mono">{formatCurrency(totalAmount, settings.currencySymbol)}</span>
            </div>
          </div>

          <button
            id="complete-sale-btn"
            onClick={handleCompleteSale}
            disabled={cart.length === 0 || isProcessing}
            className="w-full py-3 rounded-xl font-bold text-sm text-white shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
            style={{ backgroundColor: sellerColor.primary }}
            title="Complete Sale (Ctrl+Enter)"
          >
            <CheckCircle className="w-5 h-5" />
            <span>Complete Sale ({formatCurrency(totalAmount, settings.currencySymbol)})</span>
          </button>
        </div>
      </div>

      <ProductImageViewerModal
        product={viewingProduct}
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        currencySymbol={settings.currencySymbol}
      />

      {voiceDraft && (
        <VoiceSalePreview
          result={voiceDraft}
          defaultPaymentMethod={paymentMethod}
          currencySymbol={settings.currencySymbol}
          onCancel={() => setVoiceDraft(null)}
          onConfirm={async payload => {
            addDraftToCart(
              payload.items.map(i => ({
                productId: i.productId,
                productName: null,
                quantity: i.quantity,
                unit: null,
                unitPrice: i.unitPrice,
                inStock: true,
                stockQty: 0,
                attributes: {},
              }))
            );
            if (payload.paymentMethod) setPaymentMethod(payload.paymentMethod as PaymentMethod);
            setVoiceDraft(null);
            addToast({
              type: 'success',
              title: 'Added to cart',
              description: 'Review the cart and click Complete Sale to finish.',
            });
          }}
        />
      )}
    </div>
  );
};
