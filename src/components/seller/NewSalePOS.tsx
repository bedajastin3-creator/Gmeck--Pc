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
  X,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Loader2,
  TrendingUp,
  Mic,
  Square,
  Calendar,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SalesService } from '../../services/salesService';
import { Product, PaymentMethod } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { ProductImageViewerModal } from '../common/ProductImageViewerModal';
import { VoiceSaleService, VoiceSaleResult, VoiceSaleItem } from '../../services/voiceSaleService';
import { VoiceSalePreview } from '../VoiceSalePreview';
import { CloudflareApi } from '../../services/cloudflareApi';

const PAGE_SIZE = 15;

// ─────────────────────────────────────────────────────────────
// Unit helpers — detect if a product is sold by decimal measure
// ─────────────────────────────────────────────────────────────
const DECIMAL_UNIT_REGEX = /(kg|kilogram|g\b|gram|liter|litre|^l$|\bl\b|ml|milliliter|millilitre|meter|mita|metre|^m$|\bm\b|sentimita|cm|oz|lb)/i;

const isDecimalUnit = (unit?: string): boolean => {
  if (!unit) return false;
  return DECIMAL_UNIT_REGEX.test(unit.trim());
};

const minQtyForUnit = (unit?: string): number => (isDecimalUnit(unit) ? 0.01 : 1);
const stepSizeForUnit = (unit?: string): number => (isDecimalUnit(unit) ? 0.25 : 1);
const round3 = (n: number): number => Number(n.toFixed(3));

const getLocalTodayYMD = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatSaleDateChip = (ymd: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
};

const formatSaleDateFull = (ymd: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

interface CartItem {
  product: Product;
  quantity: number | string;
  unitPrice: number | string;
  discount: number;
}

export const NewSalePOS: React.FC = () => {
  const { currentUser, dbState, addToast, showReceipt, selectedShopId, currentShop, availableShops } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [showMobileBarcode, setShowMobileBarcode] = useState(false);
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [overallDiscount, setOverallDiscount] = useState<number>(0);
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [saleNotes, setSaleNotes] = useState<string>('');
  const [assistantName, setAssistantName] = useState<string>('');
  const [assistantNameError, setAssistantNameError] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  // Sale Date — always defaults to Today; seller can switch to a previous date to record missed sales
  const todayYMD = getLocalTodayYMD();
  const [saleDate, setSaleDate] = useState<string>(() => getLocalTodayYMD());
  const isBackdatedSale = Boolean(saleDate && saleDate < todayYMD);

  const handleSaleDateChange = (raw: string) => {
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      setSaleDate(todayYMD);
      return;
    }
    if (raw > todayYMD) {
      addToast({
        type: 'warning',
        title: 'Future Date Not Allowed',
        description: 'You can only select today or a previous date.',
      });
      setSaleDate(todayYMD);
      return;
    }
    setSaleDate(raw);
  };

  // Voice sale state
  const [isRecording, setIsRecording] = useState(false);
  const [isParsingVoice, setIsParsingVoice] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<VoiceSaleResult | null>(null);
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Quick-add search directly inside/above Cart
  const [cartSearchQuery, setCartSearchQuery] = useState('');
  const [cartSearchVisibleCount, setCartSearchVisibleCount] = useState(PAGE_SIZE);
  const cartListRef = useRef<HTMLDivElement>(null);
  const cartSearchInputRef = useRef<HTMLInputElement>(null);
  const assistantInputRef = useRef<HTMLInputElement>(null);

  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const settings = dbState.settings;

  const targetShopId =
    currentShop?.id ||
    (selectedShopId !== 'ALL' ? selectedShopId : '') ||
    availableShops[0]?.id ||
    dbState.shops[0]?.id ||
    '';

  const products = useMemo(() => {
    return dbState.products.filter(
      p => p.status === 'ACTIVE' && (!targetShopId || p.shopId === targetShopId || !p.shopId)
    );
  }, [dbState.products, targetShopId]);

  // ─────────────────────────────────────────────────────────────
  // MOST-SELLING RANK MAP
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
  // FILTER + SORT (Only show if there is a search query!)
  // ─────────────────────────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    // If search is empty, return empty array (hide all products)
    if (!q) return [];

    const filtered = products.filter(p => {
      const matchesCategory = selectedCategory === 'ALL' || p.categoryId === selectedCategory;
      const matchesSearch =
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        (p.variation && p.variation.toLowerCase().includes(q));
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

  // Reset pagination on search/category change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, selectedCategory]);

  // Quick-add search results for the search bar above the cart
  const cartSearchResults = useMemo(() => {
    const q = cartSearchQuery.toLowerCase().trim();
    if (!q) return [];

    const matched = products.filter(p => {
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        (p.variation && p.variation.toLowerCase().includes(q))
      );
    });

    return [...matched].sort((a, b) => {
      const aSales = salesCountMap.get(a.id) || 0;
      const bSales = salesCountMap.get(b.id) || 0;
      if (bSales !== aSales) return bSales - aSales;
      if (b.currentStock !== a.currentStock) return b.currentStock - a.currentStock;
      return a.name.localeCompare(b.name);
    });
  }, [products, cartSearchQuery, salesCountMap]);

  useEffect(() => {
    setCartSearchVisibleCount(PAGE_SIZE);
  }, [cartSearchQuery]);

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

  const handleSeeLess = () => {
    setVisibleCount(PAGE_SIZE);
  };

  // ─────────────────────────────────────────────────────────────
  // Numeric coercion helpers — DECIMAL-AWARE
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

  const subtotal = useMemo(() => {
    return cart.reduce(
      (sum, item) => sum + qtyNum(item.quantity) * priceNum(item.unitPrice) - item.discount,
      0
    );
  }, [cart]);

  const totalItemsCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + qtyNum(item.quantity), 0);
  }, [cart]);

  // Clean display label — shows decimals only when a measured product is present
  const cartItemsLabel = useMemo(() => {
    const hasDecimal = cart.some(i => isDecimalUnit(i.product.unit));
    if (hasDecimal) return Number(totalItemsCount.toFixed(2)).toString();
    return totalItemsCount.toString();
  }, [cart, totalItemsCount]);

  const totalAmount = useMemo(() => {
    const discounted = Math.max(0, subtotal - overallDiscount);
    return Number(discounted.toFixed(2));
  }, [subtotal, overallDiscount]);

  const parsedTender = parseFloat(amountReceived);
  const hasWrittenTender = amountReceived.trim() !== '' && Number.isFinite(parsedTender) && parsedTender >= 0;
  const tenderValue = hasWrittenTender ? parsedTender : totalAmount;

  useEffect(() => {
    if (paymentMethod === 'CASH') {
      setAmountReceived(totalAmount > 0 ? String(Number(totalAmount.toFixed(2))) : '');
    }
  }, [totalAmount, paymentMethod]);

  // ─────────────────────────────────────────────────────────────
  // Add Product to Cart — seeds 0.25 for decimal units, 1 for pieces
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

    // Auto-open the cart on smaller viewports so the seller doesn't have to tap manually
    if (window.innerWidth < 1024) {
      setIsMobileCartOpen(true);
    }

    // Clear searches after adding so seller can immediately search for the next item
    setSearchQuery('');
    setCartSearchQuery('');

    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      const step = stepSizeForUnit(product.unit);

      window.setTimeout(() => {
        if (cartListRef.current) {
          cartListRef.current.scrollTo({
            top: 0,
            behavior: 'smooth',
          });
        }
      }, 60);

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
        const updatedItem = { ...existing, quantity: nextQty };
        return [updatedItem, ...prev.filter(item => item.product.id !== product.id)];
      }

      const initialQty = isDecimalUnit(product.unit) ? 0.25 : 1;

      return [
        {
          product,
          quantity: initialQty,
          unitPrice: product.sellingPrice,
          discount: 0,
        },
        ...prev,
      ];
    });
  };

  // ─────────────────────────────────────────────────────────────
  // Voice → Cart batch add
  // ─────────────────────────────────────────────────────────────
  const addDraftToCart = (items: VoiceSaleItem[]) => {
    const warnings: string[] = [];

    setCart(prev => {
      const next = [...prev];

      for (const it of items) {
        const product = it.productId
          ? products.find(p => p.id === it.productId)
          : products.find(
              p => p.name.toLowerCase() === (it.productName ?? '').toLowerCase()
            );

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
          const capped = Math.min(merged, product.currentStock);
          const updatedItem = {
            ...next[existingIdx],
            quantity: capped,
            unitPrice: it.unitPrice ?? next[existingIdx].unitPrice,
          };
          next.splice(existingIdx, 1);
          next.unshift(updatedItem);
        } else {
          next.unshift({
            product,
            quantity: round3(safeQty),
            unitPrice: it.unitPrice ?? product.sellingPrice,
            discount: 0,
          });
        }
      }

      return next;
    });

    window.setTimeout(() => {
      if (cartListRef.current) {
        cartListRef.current.scrollTo({
          top: 0,
          behavior: 'smooth',
        });
      }
    }, 60);

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
          const authToken =
            (CloudflareApi as any).getToken?.() ??
            (currentUser as any)?.token ??
            (currentUser as any)?.apiToken ??
            (currentUser as any)?.id ??
            'session';

          const result = await VoiceSaleService.parseAudio(
            blob,
            targetShopId || null,
            authToken
          );

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
            description:
              result.transcript.length > 90
                ? result.transcript.slice(0, 90) + '…'
                : result.transcript,
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

  const updateUnitPrice = (productId: string, rawValue: string) => {
    if (rawValue === '') {
      setCart(prev =>
        prev.map(i => (i.product.id === productId ? { ...i, unitPrice: '' } : i))
      );
      return;
    }

    let cleaned = rawValue.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      cleaned = parts[0] + '.' + parts.slice(1).join('');
    }
    if (cleaned.length > 1 && cleaned[0] === '0' && cleaned[1] !== '.') {
      cleaned = cleaned.replace(/^0+/, '');
      if (cleaned === '') cleaned = '0';
    }

    setCart(prev =>
      prev.map(i => (i.product.id === productId ? { ...i, unitPrice: cleaned } : i))
    );
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

  // ─────────────────────────────────────────────────────────────
  // Quantity handling — DECIMAL-AWARE
  // ─────────────────────────────────────────────────────────────
  const updateQuantity = (productId: string, rawValue: string) => {
    const item = cart.find(i => i.product.id === productId);
    if (!item) return;

    if (rawValue === '') {
      setCart(prev =>
        prev.map(i => (i.product.id === productId ? { ...i, quantity: '' } : i))
      );
      return;
    }

    if (rawValue === '.' || rawValue.endsWith('.')) {
      if (/^\d*\.?\d*$/.test(rawValue)) {
        setCart(prev =>
          prev.map(i => (i.product.id === productId ? { ...i, quantity: rawValue } : i))
        );
      }
      return;
    }

    if (!/^\d*\.?\d*$/.test(rawValue)) return;

    const parsed = parseFloat(rawValue);
    if (!Number.isFinite(parsed)) {
      setCart(prev =>
        prev.map(i => (i.product.id === productId ? { ...i, quantity: rawValue } : i))
      );
      return;
    }

    const minQty = minQtyForUnit(item.product.unit);
    let nextQty = parsed;

    if (nextQty < minQty) {
      setCart(prev =>
        prev.map(i => (i.product.id === productId ? { ...i, quantity: rawValue } : i))
      );
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

    setCart(prev =>
      prev.map(i => (i.product.id === productId ? { ...i, quantity: String(nextQty === parsed ? rawValue : nextQty) } : i))
    );
  };

  const handleQuantityBlur = (productId: string) => {
    setCart(prev =>
      prev.map(i => {
        if (i.product.id !== productId) return i;
        const minQty = minQtyForUnit(i.product.unit);
        const n = qtyNum(i.quantity);
        const safe = n < minQty ? minQty : n;
        return { ...i, quantity: round3(safe) };
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

  const clearCart = useCallback(() => {
    setCart([]);
    setOverallDiscount(0);
    setAmountReceived('');
    setSaleNotes('');
    setAssistantName('');
    setAssistantNameError(false);
    setCartSearchQuery('');
    setIsMobileCartOpen(false);
  }, []);

  const handleCartSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setCartSearchQuery('');
      return;
    }
    if (e.key === 'Enter' && cartSearchQuery.trim()) {
      e.preventDefault();
      const q = cartSearchQuery.trim().toLowerCase();
      const exact = products.find(
        p =>
          p.currentStock > 0 &&
          (p.barcode.toLowerCase() === q || p.sku.toLowerCase() === q)
      );
      if (exact) {
        addToCart(exact);
        return;
      }
      const inStockMatches = cartSearchResults.filter(p => p.currentStock > 0);
      if (inStockMatches.length === 1) {
        addToCart(inStockMatches[0]);
      }
    }
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    const scanned = products.find(
      p =>
        p.barcode === barcodeInput.trim() ||
        p.sku.toLowerCase() === barcodeInput.trim().toLowerCase()
    );

    if (scanned) {
      addToCart(scanned);
      setBarcodeInput('');
      addToast({
        type: 'info',
        title: 'Item Added',
        description: `${scanned.name} added to cart.`,
      });
    } else {
      addToast({
        type: 'error',
        title: 'Barcode Not Found',
        description: `No active product found for barcode '${barcodeInput}'.`,
      });
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Complete Sale
  // ─────────────────────────────────────────────────────────────
  const handleCompleteSale = useCallback(() => {
    if (!currentUser) return;

    if (cart.length === 0) {
      addToast({
        type: 'warning',
        title: 'Cart is Empty',
        description: 'Please add items to cart before completing sale.',
      });
      return;
    }

    if (Boolean(settings.enableSalesAssistant) && !assistantName.trim()) {
      setAssistantNameError(true);
      assistantInputRef.current?.focus();
      assistantInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      addToast({
        type: 'error',
        title: 'Jina la Muuzaji Linahitajika',
        description: 'Tafadhali jaza Jina la Muuzaji kabla ya kukamilisha mauzo.',
      });
      return;
    }

    const invalid = cart.find(i => {
      const q = qtyNum(i.quantity);
      return q < minQtyForUnit(i.product.unit);
    });
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

    // Accept whatever amount is written — never return change and never refuse below selling price
    const tender =
      paymentMethod === 'CASH'
        ? hasWrittenTender
          ? parsedTender
          : totalAmount
        : totalAmount;

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
        assistantName: settings.enableSalesAssistant
          ? assistantName.trim() || undefined
          : undefined,
        saleDate: saleDate || todayYMD,
      },
      currentUser
    );

    setIsProcessing(false);

    if (result.success && result.sale) {
      addToast({
        type: 'success',
        title: isBackdatedSale
          ? `Sale Recorded (${formatSaleDateFull(saleDate)})`
          : 'Sale Completed Successfully',
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
  }, [
    currentUser,
    cart,
    settings.enableSalesAssistant,
    assistantName,
    paymentMethod,
    hasWrittenTender,
    parsedTender,
    totalAmount,
    targetShopId,
    dbState.shops,
    overallDiscount,
    saleNotes,
    saleDate,
    todayYMD,
    isBackdatedSale,
    addToast,
    showReceipt,
    clearCart,
  ]);

  // ─────────────────────────────────────────────────────────────
  // PC keyboard shortcuts
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

      // Ctrl/Cmd + Enter — complete sale when VoiceSalePreview modal is not open
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !voiceDraft) {
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

  // Cart Items Component
  const renderCartItemsAndCheckout = () => {
    const isSearchingInCart = cartSearchQuery.trim().length > 0;
    const visibleCartSearchMatches = cartSearchResults.slice(0, cartSearchVisibleCount);
    const hasMoreCartMatches = cartSearchResults.length > cartSearchVisibleCount;

    return (
      <div className="flex flex-col h-full justify-between overflow-hidden bg-slate-900">
        {/* Cart Header */}
        <div className="p-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Cart ({cartItemsLabel} Items)
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {cart.length > 0 && (
              <button
                id="clear-cart-btn"
                onClick={clearCart}
                className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 font-medium transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
            <button
              onClick={() => {
                setCartSearchQuery('');
                setIsMobileCartOpen(false);
              }}
              className="lg:hidden p-1 rounded-lg text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick-Add Product Search Bar Above Cart */}
        <div className="px-3 py-2.5 bg-slate-950/90 border-b border-slate-800/90 shrink-0 space-y-2">
          <div className="flex items-center gap-1.5">
            <div className="relative flex items-center flex-1 min-w-0">
              <Search className="w-4 h-4 text-blue-400 absolute left-3 pointer-events-none" />
              <input
                ref={cartSearchInputRef}
                id="pos-cart-quick-search"
                type="text"
                value={cartSearchQuery}
                onChange={e => setCartSearchQuery(e.target.value)}
                onKeyDown={handleCartSearchKeyDown}
                placeholder="Tafuta kuongeza bidhaa nyingine (jina, SKU)..."
                className="w-full bg-slate-900 border border-slate-700/90 hover:border-slate-600 focus:border-blue-500 rounded-xl pl-9 pr-9 py-2.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition shadow-inner"
              />
              {cartSearchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setCartSearchQuery('');
                    cartSearchInputRef.current?.focus();
                  }}
                  aria-label="Clear product search"
                  className="absolute right-2.5 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Calendar Date Picker on Cart Search Bar */}
            <label
              title={
                isBackdatedSale
                  ? `Recording sale for ${formatSaleDateFull(saleDate)} (tap to change)`
                  : 'Sale Date: Today (tap to record a previous date)'
              }
              className={`relative shrink-0 inline-flex items-center gap-1.5 px-2.5 py-2.5 rounded-xl border text-[11px] font-semibold cursor-pointer select-none transition active:scale-95 ${
                isBackdatedSale
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 ring-1 ring-amber-500/30'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-700/90 text-slate-300'
              }`}
            >
              <Calendar className={`w-4 h-4 shrink-0 ${isBackdatedSale ? 'text-amber-300' : 'text-blue-400'}`} />
              <span className="whitespace-nowrap">
                {isBackdatedSale ? formatSaleDateChip(saleDate) : 'Today'}
              </span>
              <input
                type="date"
                value={saleDate}
                max={todayYMD}
                onClick={e => {
                  try {
                    (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
                  } catch {
                    // Ignore browsers that open picker natively or disallow programmatic showPicker
                  }
                }}
                onChange={e => handleSaleDateChange(e.target.value)}
                aria-label="Select sale date"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </label>
          </div>

          {isBackdatedSale && (
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-200 text-[11px]">
              <span className="flex items-center gap-1.5 min-w-0 truncate">
                <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">
                  Previous date: <strong className="text-amber-100">{formatSaleDateFull(saleDate)}</strong>
                </span>
              </span>
              <button
                type="button"
                onClick={() => setSaleDate(todayYMD)}
                className="shrink-0 px-2 py-0.5 rounded-md bg-amber-500/25 hover:bg-amber-500/40 text-amber-100 font-semibold text-[10px] transition"
              >
                Today
              </button>
            </div>
          )}
          {isSearchingInCart && (
            <div className="flex items-center justify-between mt-1.5 px-0.5 text-[10px] text-slate-400">
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>
                  <strong className="text-slate-200">{cartSearchResults.length}</strong>{' '}
                  {cartSearchResults.length === 1 ? 'product' : 'products'} found — tap to add
                </span>
              </span>
              <button
                type="button"
                onClick={() => setCartSearchQuery('')}
                className="text-blue-400 hover:text-blue-300 font-semibold"
              >
                Back to Cart ({cart.length})
              </button>
            </div>
          )}
        </div>

        {/* Inline Search Results OR Cart Items List */}
        {isSearchingInCart ? (
          <div className="flex-1 p-3 overflow-y-auto space-y-2 bg-slate-950/60">
            {cartSearchResults.length === 0 ? (
              <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-center p-6 text-slate-500">
                <Layers className="w-9 h-9 mb-2 opacity-40" />
                <p className="text-xs font-semibold text-slate-300">Hakuna bidhaa inayolingana</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Jaribu jina lingine, SKU au barcode.
                </p>
              </div>
            ) : (
              <>
                {visibleCartSearchMatches.map(product => {
                  const isOutOfStock = product.currentStock <= 0;
                  const isLowStock =
                    product.currentStock > 0 && product.currentStock <= product.minStock;
                  const existingInCart = cart.find(c => c.product.id === product.id);
                  const decimalUnit = isDecimalUnit(product.unit);

                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={isOutOfStock}
                      onClick={() => !isOutOfStock && addToCart(product)}
                      className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2.5 active:scale-[0.99] ${
                        isOutOfStock
                          ? 'bg-slate-900/40 border-slate-800/60 opacity-50 cursor-not-allowed'
                          : existingInCart
                            ? 'bg-blue-950/30 border-blue-500/40 hover:border-blue-400 shadow-sm'
                            : 'bg-slate-900 border-slate-800 hover:border-blue-500/60 hover:bg-slate-800/80 shadow-sm'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <ProductThumbnail product={product} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-white truncate">
                              {product.name}
                            </span>
                            {existingInCart && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold shrink-0">
                                In Cart: {existingInCart.quantity}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                            <span className="font-mono text-[10px]">{product.sku}</span>
                            <span className="text-slate-600">•</span>
                            <span
                              className={
                                isOutOfStock
                                  ? 'text-rose-400 font-bold'
                                  : isLowStock
                                    ? 'text-amber-400 font-bold'
                                    : 'text-slate-400'
                              }
                            >
                              {isOutOfStock
                                ? 'Out of Stock'
                                : `${product.currentStock} ${product.unit} left`}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <div className="text-xs font-bold text-emerald-400 font-mono">
                            {formatCurrency(product.sellingPrice, settings.currencySymbol)}
                          </div>
                          {decimalUnit && (
                            <div className="text-[9px] text-slate-500">per {product.unit}</div>
                          )}
                        </div>
                        <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm">
                          <Plus className="w-4 h-4" />
                        </div>
                      </div>
                    </button>
                  );
                })}

                {hasMoreCartMatches && (
                  <button
                    type="button"
                    onClick={() => setCartSearchVisibleCount(prev => prev + PAGE_SIZE)}
                    className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition flex items-center justify-center gap-1.5"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span>
                      Show More ({cartSearchResults.length - cartSearchVisibleCount} remaining)
                    </span>
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          /* Cart Items List */
          <div ref={cartListRef} className="flex-1 p-3 overflow-y-auto space-y-2.5">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                <ShoppingCart className="w-12 h-12 mb-3 text-slate-700" />
                <p className="text-sm font-semibold text-slate-400">Cart is Empty</p>
                <p className="text-xs text-slate-600 mt-1">
                  Search or scan products above to begin.
                </p>
              </div>
            ) : (
              cart.map(item => {
                const referencePrice =
                  item.product.proposedSellingPrice || item.product.sellingPrice || 0;
                const sellingRef = item.product.sellingPrice || 0;
                const unitPriceNum = priceNum(item.unitPrice);
                const isBelowReference =
                  unitPriceNum > 0 &&
                  ((referencePrice > 0 && unitPriceNum < referencePrice) ||
                    (sellingRef > 0 && unitPriceNum < sellingRef));
                const decimalUnit = isDecimalUnit(item.product.unit);

                return (
                  <div
                    key={item.product.id}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-2 transition shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
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
                            <h5 className="text-xs font-semibold text-white truncate">{item.product.name}</h5>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                              {item.product.sku}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                            <span className="font-semibold text-emerald-400 font-mono">
                              Total: {formatCurrency(qtyNum(item.quantity) * priceNum(item.unitPrice) - item.discount, settings.currencySymbol)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => removeFromCart(item.product.id)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 shrink-0 transition"
                        title="Remove item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-900">
                      <div className="flex items-center gap-1.5">
                        <label className="text-[10px] text-slate-400">Bei:</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={item.unitPrice}
                          onChange={e => updateUnitPrice(item.product.id, e.target.value)}
                          onBlur={() => handlePriceBlur(item.product.id)}
                          onFocus={e => e.target.select()}
                          className={`w-20 bg-slate-900 border rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:ring-1 ${
                            isBelowReference
                              ? 'border-rose-500/60 focus:ring-rose-500'
                              : 'border-slate-800 focus:ring-blue-500'
                          }`}
                        />
                      </div>

                      <div className="flex items-center gap-1">
                        <label className="text-[10px] text-slate-400">Idadi:</label>
                        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
                          <button
                            type="button"
                            onClick={() => stepQuantity(item.product.id, -1)}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 active:scale-95 transition"
                          >
                            <Minus className="w-3.5 h-3.5" />
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
                            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 active:scale-95 transition"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono min-w-[24px]">
                          {item.product.unit}
                        </span>
                      </div>
                    </div>

                    {decimalUnit && (
                      <div className="text-[10px] text-slate-500 italic">
                        Selling by measure — enter decimal quantity (e.g., 0.25, 1.5)
                      </div>
                    )}

                    {isBelowReference && (
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-rose-400 bg-rose-500/10 px-2 py-1 rounded border border-rose-500/25 mt-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span>Unauza chini ya Bei elekezi</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Checkout Panel (stays visible; compact on mobile while typing in search so results have full room above keyboard) */}
        {(() => {
          const isAssistantEnabled = Boolean(settings.enableSalesAssistant);
          const isAssistantMissing = isAssistantEnabled && !assistantName.trim();
          const hasValidItems =
            cart.length > 0 &&
            cart.every(
              i =>
                qtyNum(i.quantity) >= minQtyForUnit(i.product.unit) &&
                priceNum(i.unitPrice) > 0
            );
          const isCheckoutReady = hasValidItems && !isAssistantMissing && !isProcessing;
          const isTenderBelowTotal =
            paymentMethod === 'CASH' &&
            hasWrittenTender &&
            totalAmount > 0 &&
            tenderValue < totalAmount;

          return (
            <div className={`p-3 sm:p-3.5 bg-slate-950 border-t border-slate-800 space-y-2.5 safe-bottom ${isSearchingInCart ? 'hidden lg:block' : ''}`}>
              {isAssistantEnabled && (
                <div>
                  <label
                    htmlFor="pos-assistant-name-input"
                    className={`block text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider mb-1 ${
                      assistantNameError && isAssistantMissing ? 'text-rose-400' : 'text-slate-400'
                    }`}
                  >
                    Jina la Muuzaji <span className="text-rose-400">*</span>
                  </label>
                  <input
                    ref={assistantInputRef}
                    id="pos-assistant-name-input"
                    type="text"
                    value={assistantName}
                    onChange={e => {
                      setAssistantName(e.target.value);
                      if (assistantNameError && e.target.value.trim()) {
                        setAssistantNameError(false);
                      }
                    }}
                    placeholder="Jina la Muuzaji..."
                    autoComplete="off"
                    className={`w-full rounded-lg px-3 py-2 text-xs text-white focus:outline-none transition ${
                      assistantNameError && isAssistantMissing
                        ? 'bg-rose-950/30 border border-rose-500 ring-2 ring-rose-500/40 placeholder-rose-300/70 focus:ring-rose-500'
                        : 'bg-slate-900 border border-slate-800 placeholder-slate-500 focus:ring-1 focus:ring-blue-500'
                    }`}
                  />
                  {assistantNameError && isAssistantMissing && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Tafadhali jaza Jina la Muuzaji kabla ya kukamilisha mauzo.</span>
                    </p>
                  )}
                </div>
              )}

              <div>
                <span className="block text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Njia ya Malipo
                </span>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { id: 'CASH', label: 'Cash', icon: DollarSign },
                    { id: 'MOBILE_MONEY', label: 'M-Pesa', icon: Smartphone },
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
                        className={`flex flex-col items-center justify-center py-2 rounded-lg text-[10px] font-semibold border transition active:scale-95 ${
                          active
                            ? 'bg-blue-600 border-blue-500 text-white shadow-sm'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 mb-0.5" />
                        <span className="truncate">{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {paymentMethod === 'CASH' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 text-[11px]">Pesa Iliyopokelewa</span>
                    <span className="text-slate-500 text-[9px]">Auto-filled with total</span>
                  </div>

                  <input
                    id="tender-amount-input"
                    type="number"
                    step="any"
                    min="0"
                    value={amountReceived}
                    onChange={e => setAmountReceived(e.target.value)}
                    className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-sm font-mono font-bold text-white focus:outline-none focus:ring-1 ${
                      isTenderBelowTotal
                        ? 'border-amber-500/60 focus:ring-amber-500'
                        : 'border-slate-800 focus:ring-blue-500'
                    }`}
                  />

                  {isTenderBelowTotal && (
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-300 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/30">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>Pesa iliyopokelewa ipo chini ya jumla — mauzo yatakubaliwa.</span>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 space-y-1 text-xs">
                <div className="flex justify-between text-slate-400 text-[11px]">
                  <span>Jumla Ndogo (Subtotal)</span>
                  <span className="font-mono">{formatCurrency(subtotal, settings.currencySymbol)}</span>
                </div>
                {overallDiscount > 0 && (
                  <div className="flex justify-between text-amber-400 text-[11px]">
                    <span>Punguzo (Discount)</span>
                    <span className="font-mono">-{formatCurrency(overallDiscount, settings.currencySymbol)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm sm:text-base font-extrabold text-white pt-1.5 border-t border-slate-800">
                  <span>JUMLA KUU</span>
                  <span className="text-emerald-400 font-mono">
                    {formatCurrency(totalAmount, settings.currencySymbol)}
                  </span>
                </div>
              </div>

              <button
                id="complete-sale-btn"
                onClick={handleCompleteSale}
                disabled={cart.length === 0 || isProcessing}
                title="Kamilisha Mauzo (Ctrl+Enter)"
                className={`w-full py-3 rounded-xl font-bold text-sm shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 ${
                  isCheckoutReady
                    ? isBackdatedSale
                      ? 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white shadow-amber-600/25'
                      : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-blue-600/25'
                    : assistantNameError && isAssistantMissing
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/25'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                }`}
              >
                <CheckCircle className="w-5 h-5" />
                <span>
                  {isBackdatedSale
                    ? `Kamilisha Mauzo (${formatSaleDateChip(saleDate)} • ${formatCurrency(totalAmount, settings.currencySymbol)})`
                    : `Kamilisha Mauzo (${formatCurrency(totalAmount, settings.currencySymbol)})`}
                </span>
              </button>
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <div id="pos-terminal" className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-slate-950 text-slate-100 select-none relative">
      {/* Left / Main: Product Catalog & Search */}
      <div className="flex-1 flex flex-col border-r border-slate-800 overflow-hidden">
        <div className="p-2.5 sm:p-3.5 bg-slate-900 border-b border-slate-800 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                ref={searchInputRef}
                id="pos-search-input"
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Tafuta bidhaa kwa jina au SKU..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Sale Date Calendar Picker (Defaults to Today; allows switching to a previous date) */}
            <label
              id="pos-sale-date-picker"
              title={
                isBackdatedSale
                  ? `Sale date: ${formatSaleDateFull(saleDate)} (tap to change)`
                  : 'Sale date: Today (tap to add previous-date sales)'
              }
              className={`relative shrink-0 inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer select-none transition active:scale-95 ${
                isBackdatedSale
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 ring-1 ring-amber-500/30 shadow-sm shadow-amber-500/20'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
            >
              <Calendar className={`w-4 h-4 shrink-0 ${isBackdatedSale ? 'text-amber-300' : 'text-blue-400'}`} />
              <span className="hidden sm:inline whitespace-nowrap">
                {isBackdatedSale ? formatSaleDateChip(saleDate) : 'Today'}
              </span>
              {isBackdatedSale && (
                <span className="sm:hidden text-[11px] whitespace-nowrap">
                  {formatSaleDateChip(saleDate)}
                </span>
              )}
              <input
                type="date"
                value={saleDate}
                max={todayYMD}
                onClick={e => {
                  try {
                    (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
                  } catch {
                    // Ignore browsers that open picker natively or disallow programmatic showPicker
                  }
                }}
                onChange={e => handleSaleDateChange(e.target.value)}
                aria-label="Sale date"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </label>

            {/* Voice Sale mic button */}
            <button
              type="button"
              onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
              disabled={isParsingVoice}
              title={isRecording ? 'Stop recording (F2)' : 'Speak the sale (F2)'}
              className={`p-2 rounded-xl border transition active:scale-95 disabled:opacity-50 shrink-0 ${
                isRecording
                  ? 'bg-blue-500 border-blue-300 text-white animate-pulse ring-2 ring-blue-400/50 shadow-lg shadow-blue-500/30'
                  : 'bg-blue-600 hover:bg-blue-500 border-blue-500 text-white shadow-sm shadow-blue-500/20'
              }`}
            >
              {isParsingVoice ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isRecording ? (
                <Square className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={() => setShowMobileBarcode(!showMobileBarcode)}
              className="lg:hidden p-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:text-white"
              title="Barcode Scanner"
            >
              <Barcode className="w-4 h-4" />
            </button>

            <form onSubmit={handleBarcodeSubmit} className="hidden lg:flex relative w-48">
              <Barcode className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                ref={barcodeInputRef}
                id="pos-barcode-input"
                type="text"
                value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                placeholder="Scan barcode [Enter]"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </form>
          </div>

          {/* Backdated Sale Notice Banner */}
          {isBackdatedSale && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-200 text-xs animate-in fade-in">
              <div className="flex items-center gap-2 min-w-0">
                <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="truncate">
                  Recording sales for previous date:{' '}
                  <strong className="text-amber-100">{formatSaleDateFull(saleDate)}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSaleDate(todayYMD)}
                className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/25 hover:bg-amber-500/40 text-amber-100 text-[11px] font-semibold transition"
              >
                Back to Today
              </button>
            </div>
          )}

          {showMobileBarcode && (
            <form onSubmit={handleBarcodeSubmit} className="lg:hidden flex items-center gap-2 animate-in fade-in">
              <div className="relative flex-1">
                <Barcode className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={barcodeInput}
                  onChange={e => setBarcodeInput(e.target.value)}
                  placeholder="Andika au scan barcode..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white"
                  autoFocus
                />
              </div>
              <button type="submit" className="px-3 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-xl">
                Scan
              </button>
            </form>
          )}

          {/* Voice warning banner */}
          {voiceWarning && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] animate-in fade-in">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="flex-1">{voiceWarning}</span>
              <button
                onClick={() => setVoiceWarning(null)}
                className="text-amber-400 hover:text-amber-200 shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 text-xs">
            <button
              onClick={() => setSelectedCategory('ALL')}
              className={`px-3 py-1.5 rounded-xl whitespace-nowrap text-xs font-semibold transition active:scale-95 ${
                selectedCategory === 'ALL'
                  ? 'bg-blue-600 text-white shadow'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
            >
              Makundi Yote ({products.length})
            </button>
            {categories.map(cat => {
              const count = products.filter(p => p.categoryId === cat.id).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-xl whitespace-nowrap text-xs font-semibold transition active:scale-95 ${
                    selectedCategory === cat.id
                      ? 'bg-blue-600 text-white shadow'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {cat.name} ({count})
                </button>
              );
            })}
          </div>

          {/* Result count hint */}
          {searchQuery && filteredProducts.length > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="truncate">
                Found{' '}
                <span className="text-slate-300 font-semibold">{filteredProducts.length}</span> matches for "{searchQuery}"
              </span>
            </div>
          )}
        </div>

        {/* Product List (Only shows when searching) */}
        <div className="flex-1 p-2.5 sm:p-4 overflow-y-auto pb-24 lg:pb-4">
          {!searchQuery ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500 opacity-60">
              <Search className="w-12 h-12 mb-3 text-slate-700" />
              <p className="text-sm font-medium text-slate-400">Search for a product to start</p>
              <p className="text-xs text-slate-600 mt-1 max-w-[250px]">
                Type a name or SKU above, or use the mic to speak the sale.
              </p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
              <Layers className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm font-medium text-slate-400">Hakuna bidhaa inayolingana</p>
              <p className="text-xs text-slate-600 mt-1">Jaribu neno lingine au tumia barcode.</p>
            </div>
          ) : (
            <>
              <div className="space-y-2 max-w-2xl mx-auto">
                {visibleProducts.map(product => {
                  const isOutOfStock = product.currentStock <= 0;
                  const isLowStock = product.currentStock > 0 && product.currentStock <= product.minStock;
                  const unitsSold = salesCountMap.get(product.id) || 0;
                  const decimalUnit = isDecimalUnit(product.unit);

                  return (
                    <div
                      key={product.id}
                      id={`pos-product-${product.id}`}
                      onClick={() => !isOutOfStock && addToCart(product)}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 group cursor-pointer active:scale-[0.99] ${
                        isOutOfStock
                          ? 'bg-slate-900/40 border-slate-800/60 opacity-50'
                          : 'bg-slate-900 border-slate-800 hover:border-blue-500/50 hover:bg-slate-850 shadow-sm'
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <ProductThumbnail
                          product={product}
                          size="sm"
                          onClick={() => { setViewingProduct(product); setIsViewerOpen(true); }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-semibold text-white truncate">{product.name}</h4>
                            {unitsSold > 0 && (
                              <span
                                className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-bold shrink-0"
                                title={`${unitsSold} units sold`}
                              >
                                🔥 {Number(unitsSold.toFixed(2))}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap">
                            <span className="font-mono">{product.sku}</span>
                            <span className="text-slate-600">•</span>
                            <span className={isOutOfStock ? 'text-rose-400 font-bold' : isLowStock ? 'text-amber-400 font-bold' : ''}>
                              {isOutOfStock ? 'Out of Stock' : `${product.currentStock} ${product.unit} left`}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <span className="text-sm font-bold text-emerald-400 font-mono">
                            {formatCurrency(product.sellingPrice, settings.currencySymbol)}
                          </span>
                          {decimalUnit && (
                            <div className="text-[9px] text-slate-500 font-normal">per {product.unit}</div>
                          )}
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-blue-600/20 group-hover:bg-blue-600 flex items-center justify-center text-blue-300 group-hover:text-white transition">
                          <Plus className="w-4 h-4" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* See More / See Less Footer */}
              {filteredProducts.length > PAGE_SIZE && (
                <div className="mt-4 pt-4 border-t border-slate-800/60 max-w-2xl mx-auto flex items-center justify-between">
                  <div className="text-[11px] text-slate-500">
                    Showing {Math.min(visibleCount, filteredProducts.length)} of {filteredProducts.length}
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
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow transition disabled:opacity-60"
                      >
                        {isLoadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        <span>More</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Floating Bottom Cart Bar for Narrow/Mobile Viewports */}
      {cart.length > 0 && (
        <div className="lg:hidden fixed bottom-14 left-2 right-2 z-30 animate-in slide-in-from-bottom-3 duration-200">
          <button
            id="mobile-view-cart-sticky-bar"
            onClick={() => setIsMobileCartOpen(true)}
            className="w-full p-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-2xl flex items-center justify-between font-semibold text-xs border border-blue-400/30 active:scale-95"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center font-mono font-bold">
                {cartItemsLabel}
              </div>
              <div className="text-left">
                <div className="text-[11px] text-blue-100">Kikapu cha Mauzo</div>
                <div className="text-sm font-extrabold font-mono text-white">
                  {formatCurrency(totalAmount, settings.currencySymbol)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 bg-white/20 px-3 py-1.5 rounded-xl text-xs font-bold">
              <span>Lipia Sasa</span>
              <ChevronUp className="w-4 h-4" />
            </div>
          </button>
        </div>
      )}

      {/* Mobile Cart & Checkout Bottom Sheet Modal */}
      {isMobileCartOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="fixed inset-0"
            onClick={() => {
              setCartSearchQuery('');
              setIsMobileCartOpen(false);
            }}
          />
          <div className="relative bg-slate-900 border-t border-slate-800 rounded-t-3xl h-[92vh] flex flex-col shadow-2xl z-10 overflow-hidden">
            <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto my-2 shrink-0" />
            {renderCartItemsAndCheckout()}
          </div>
        </div>
      )}

      {/* Desktop Right Sidebar Cart & Checkout */}
      <div className="hidden lg:flex w-[400px] xl:w-[440px] bg-slate-900 flex-col justify-between shrink-0 overflow-hidden border-l border-slate-800">
        {renderCartItemsAndCheckout()}
      </div>

      {/* Product Image Gallery / Viewer Modal */}
      <ProductImageViewerModal
        product={viewingProduct}
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        currencySymbol={settings.currencySymbol}
      />

      {/* Voice Sale Preview Modal */}
      {voiceDraft && (
        <VoiceSalePreview
          result={voiceDraft}
          defaultPaymentMethod={paymentMethod}
          currencySymbol={settings.currencySymbol}
          onCancel={() => setVoiceDraft(null)}
          onConfirm={async payload => {
            if (!currentUser) return;
            if (Boolean(settings.enableSalesAssistant) && !assistantName.trim()) {
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
              setPaymentMethod(payload.paymentMethod as PaymentMethod);
              setVoiceDraft(null);
              if (window.innerWidth < 1024) setIsMobileCartOpen(true);
              setAssistantNameError(true);
              window.setTimeout(() => {
                assistantInputRef.current?.focus();
                assistantInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 120);
              addToast({
                type: 'error',
                title: 'Jina la Muuzaji Linahitajika',
                description: 'Tafadhali jaza Jina la Muuzaji kabla ya kukamilisha mauzo.',
              });
              return;
            }

            const salePayload = {
              shopId: targetShopId === 'ALL' ? (dbState.shops[0]?.id || '') : (targetShopId || dbState.shops[0]?.id || ''),
              items: payload.items.map(i => ({
                productId: i.productId,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                discount: 0,
              })),
              paymentMethod: payload.paymentMethod as PaymentMethod,
              discount: 0,
              amountReceived: payload.items.reduce((sum, i) => sum + (i.unitPrice * i.quantity), 0),
              notes: 'Voice AI Sale',
              assistantName: settings.enableSalesAssistant
                ? assistantName.trim() || undefined
                : undefined,
              saleDate: saleDate || todayYMD,
            };

            setIsProcessing(true);

            const result = SalesService.createSale(salePayload, currentUser);

            setIsProcessing(false);
            setVoiceDraft(null);

            if (result.success && result.sale) {
              addToast({
                type: 'success',
                title: isBackdatedSale
                  ? `Sale Recorded (${formatSaleDateFull(saleDate)})`
                  : 'Sale Completed Successfully',
                description: `Receipt #${result.sale.receiptNumber} generated via Voice AI.`,
              });
              showReceipt(result.sale);
              clearCart();
            } else {
              addToast({
                type: 'error',
                title: 'Voice Sale Failed',
                description: result.error || 'Could not complete transaction.',
              });
            }
          }}
        />
      )}
    </div>
  );
};
