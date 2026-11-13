import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Truck,
  Plus,
  Trash2,
  Calendar,
  DollarSign,
  Search,
  CheckCircle,
  X,
  AlertCircle,
  FileText,
  Pencil,
  Package,
  Check,
  ChevronDown,
  Loader2,
  ArrowLeft,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PurchaseService } from '../../services/purchaseService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import type { Purchase } from '../../types';

const PAGE_SIZE = 15;

// Minimum number of products shown in the dropdown before any search
const MIN_PRODUCTS_SHOWN = 6;

interface PurchaseItemInput {
  productId: string;
  quantity: number | string;
  unitCost: number | string;
}

// ─────────────────────────────────────────────────────────────
// Inline ProductSearchSelect — used per line-item row
// Search box stays pinned at top; results list scrolls below.
// Always shows at least MIN_PRODUCTS_SHOWN products by default.
// ─────────────────────────────────────────────────────────────
interface ProductLike {
  id: string;
  name: string;
  sku: string;
  currentStock: number;
  unit: string;
  purchasePrice?: number;
  sellingPrice?: number;
}

const ProductSearchSelect: React.FC<{
  products: ProductLike[];
  value: string;
  onChange: (productId: string) => void;
  currencySymbol?: string;
  placeholder?: string;
}> = ({ products, value, onChange, currencySymbol = 'TSh', placeholder = 'Search name or SKU...' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedProduct = useMemo(
    () => products.find(p => p.id === value),
    [products, value]
  );

  // Filtered results: when no query, show at least MIN_PRODUCTS_SHOWN products
  // (or everything, capped at 100). When there is a query, apply token match.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Always show at least MIN_PRODUCTS_SHOWN (up to 100) so the user can browse
      const min = Math.max(MIN_PRODUCTS_SHOWN, MIN_PRODUCTS_SHOWN);
      return products.slice(0, Math.max(min, Math.min(products.length, 100)));
    }
    const tokens = q.split(/\s+/);
    return products
      .filter(p => {
        const hay = `${p.name} ${p.sku}`.toLowerCase();
        return tokens.every(t => hay.includes(t));
      })
      .slice(0, 100);
  }, [products, query]);

  useEffect(() => { setHighlightIdx(0); }, [query, isOpen]);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlightIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 30);
    else setQuery('');
  }, [isOpen]);

  const handleSelect = (productId: string) => {
    onChange(productId);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlightIdx]) handleSelect(filtered[highlightIdx].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 bg-slate-900 border rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
          isOpen ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-slate-800 hover:border-slate-700'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0 flex-1">
          <Package className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          {selectedProduct ? (
            <span className="min-w-0">
              <span className="block text-white font-medium truncate leading-tight">
                {selectedProduct.name}
              </span>
              <span className="block text-[10px] text-slate-500 font-mono leading-tight mt-0.5">
                {selectedProduct.sku} • Stock: {selectedProduct.currentStock} {selectedProduct.unit}
              </span>
            </span>
          ) : (
            <span className="text-slate-500 truncate">Select a product...</span>
          )}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className="absolute z-50 mt-1 left-0 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-[440px] max-w-[calc(100vw-4rem)] flex flex-col animate-in fade-in slide-in-from-top-1"
        >
          {/* Pinned search header — always visible, never overlaps the list */}
          <div className="p-2.5 border-b border-slate-800 shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              {query
                ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'} — scroll to see more`
                : `Showing first ${filtered.length} of ${products.length} — type to search`}
            </p>
          </div>

          {/* Scrollable results — fixed height so at least MIN_PRODUCTS_SHOWN visible */}
          <div
            ref={listRef}
            className="overflow-y-auto"
            style={{ maxHeight: '320px' }}
          >
            {filtered.length === 0 ? (
              <div className="p-6 text-center">
                <Package className="w-7 h-7 mx-auto text-slate-600 mb-2" />
                <p className="text-xs text-slate-500">No products match "{query}"</p>
                <p className="text-[10px] text-slate-600 mt-1">Try a shorter search or check the SKU</p>
              </div>
            ) : (
              filtered.map((p, idx) => {
                const isSelected = p.id === value;
                const isHighlighted = idx === highlightIdx;
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-idx={idx}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    onClick={() => handleSelect(p.id)}
                    className={`w-full text-left px-3 py-2 border-b border-slate-800/40 last:border-b-0 transition flex items-center gap-2 ${
                      isHighlighted ? 'bg-slate-800/60' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-white truncate">{p.name}</span>
                        {isSelected && <Check className="w-3 h-3 text-blue-400 shrink-0" />}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-500 font-mono">
                        <span>{p.sku}</span>
                        <span className={p.currentStock <= 0 ? 'text-rose-400' : ''}>
                          Stock: {p.currentStock} {p.unit}
                        </span>
                        {p.purchasePrice !== undefined && p.purchasePrice !== null && (
                          <span className="text-amber-400/80">
                            Cost: {formatCurrency(p.purchasePrice, currencySymbol)}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer hint */}
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-slate-800 bg-slate-950/60 text-[10px] text-slate-500 shrink-0">
            <span>↑↓ navigate • Enter select • Esc close</span>
            <span>{products.length} products</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────
export const AdminPurchases: React.FC = () => {
  const { currentUser, dbState, addToast, selectedShopId, currentShop } = useApp();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination state
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Purchase Form state
  const [purchaseShopId, setPurchaseShopId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'PAID' | 'PARTIAL' | 'UNPAID'>('PAID');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<PurchaseItemInput[]>([]);
  const [formError, setFormError] = useState('');

  if (!currentUser) return null;

  const canRecordPurchase = true;
  const settings = dbState.settings;
  const isSeller = currentUser.role === 'SELLER';

  const availableShops = dbState.shops.filter(s => {
    if (currentUser.role === 'ADMIN') return true;
    const assigned = currentUser.assignedShopIds || [];
    return assigned.length === 0 || assigned.includes(s.id);
  });

  const activeShopId =
    purchaseShopId ||
    currentShop?.id ||
    (selectedShopId !== 'ALL' ? selectedShopId : '') ||
    availableShops[0]?.id ||
    '';

  const shopProducts = dbState.products.filter(
    p => !purchaseShopId || purchaseShopId === 'ALL' || p.shopId === purchaseShopId
  );

  // ✅ 1. Fetch + filter by search (UNCHANGED behavior)
  // ✅ 2. Sort newest → oldest (newest first)
  const purchases = useMemo(() => {
    const filtered = PurchaseService.getPurchases(
      {
        shopId: isSeller
          ? (currentShop?.id || selectedShopId)
          : (selectedShopId === 'ALL' ? undefined : selectedShopId),
      },
      currentUser
    ).filter(purchase => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      if (purchase.supplierName.toLowerCase().includes(q)) return true;
      if (purchase.purchaseNumber.toLowerCase().includes(q)) return true;
      if (purchase.invoiceNumber && purchase.invoiceNumber.toLowerCase().includes(q)) return true;
      if (
        (purchase.items || []).some(
          item =>
            item.productName.toLowerCase().includes(q) ||
            item.productId.toLowerCase().includes(q)
        )
      )
        return true;
      if (purchase.shopName && purchase.shopName.toLowerCase().includes(q)) return true;
      return false;
    });

    // Sort: newest first (top) → oldest (bottom)
    return [...filtered].sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return db - da;
    });
  }, [dbState.purchases, searchQuery, selectedShopId, currentShop, currentUser, isSeller]);

  // Reset pagination when search or shop changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, selectedShopId]);

  // Visible slice
  const visiblePurchases = purchases.slice(0, visibleCount);
  const hasMore = purchases.length > visibleCount;
  const remaining = purchases.length - visibleCount;

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

  const openNewPurchaseModal = () => {
    const targetShop =
      currentShop?.id ||
      (selectedShopId !== 'ALL' ? selectedShopId : availableShops[0]?.id) ||
      '';
    setPurchaseShopId(targetShop);
    setSupplierName('');
    setInvoiceNumber('');
    setPaymentStatus('PAID');
    setNotes('');
    setIsEditMode(false);
    setEditingPurchase(null);

    const prodList = dbState.products.filter(p => p.shopId === targetShop);
    const initialProd = prodList[0] || dbState.products[0];

    setItems([
      {
        productId: initialProd?.id || '',
        quantity: '',
        unitCost: initialProd?.purchasePrice ? initialProd.purchasePrice.toString() : '',
      },
    ]);
    setFormError('');
    setIsModalOpen(true);
  };

  const openEditPurchase = (purchase: Purchase) => {
    setEditingPurchase(purchase);
    setIsEditMode(true);
    setPurchaseShopId(purchase.shopId);
    setSupplierName(purchase.supplierName);
    setInvoiceNumber(purchase.invoiceNumber || '');
    setPaymentStatus(purchase.paymentStatus);
    setNotes(purchase.notes || '');

    setItems(
      (purchase.items || []).map(item => ({
        productId: item.productId,
        quantity: item.quantity.toString(),
        unitCost: item.unitCost.toString(),
      }))
    );

    setFormError('');
    setIsModalOpen(true);
  };

  const addItemRow = () => {
    const prodList = dbState.products.filter(p => !purchaseShopId || p.shopId === purchaseShopId);
    const prod = prodList[0] || dbState.products[0];
    setItems(prev => [
      ...prev,
      {
        productId: prod?.id || '',
        quantity: '',
        unitCost: prod?.purchasePrice ? prod.purchasePrice.toString() : '',
      },
    ]);
  };

  const removeItemRow = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const updateItemRow = (idx: number, field: keyof PurchaseItemInput, value: any) => {
    setItems(prev =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        if (field === 'productId') {
          const matched = dbState.products.find(p => p.id === value);
          return {
            ...item,
            productId: value,
            unitCost:
              matched?.purchasePrice !== undefined && matched?.purchasePrice !== null
                ? matched.purchasePrice.toString()
                : '',
          };
        }
        return { ...item, [field]: value };
      })
    );
  };

  const calculatedTotal = items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity as string) || 0;
    const cost = parseFloat(item.unitCost as string) || 0;
    return sum + qty * cost;
  }, 0);

  const handleSavePurchase = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (items.length === 0) {
      setFormError('Please add at least one line item.');
      return;
    }

    const finalItems = items.map(item => ({
      productId: item.productId,
      quantity: parseFloat(item.quantity as string) || 0,
      unitCost: parseFloat(item.unitCost as string) || 0,
    }));

    for (const item of finalItems) {
      if (item.quantity <= 0) {
        setFormError('Quantity must be greater than 0 for all items.');
        return;
      }
      if (item.unitCost <= 0) {
        setFormError('Unit cost must be greater than 0 for all items.');
        return;
      }
      if (!item.productId) {
        setFormError('Please select a product for all items.');
        return;
      }
    }

    const finalSupplierName = supplierName.trim() || 'Walk-in Supplier';

    if (editingPurchase) {
      const res = PurchaseService.updatePurchase(
        editingPurchase.id,
        {
          supplierName: finalSupplierName,
          invoiceNumber: invoiceNumber.trim() || undefined,
          paymentStatus,
          notes,
          items: finalItems,
        },
        currentUser
      );

      if (res.success) {
        addToast({
          type: 'success',
          title: 'Purchase Updated',
          description: `Purchase ${editingPurchase.purchaseNumber || editingPurchase.id} updated. Stock recalculated.`,
        });
        setIsModalOpen(false);
        setEditingPurchase(null);
        setIsEditMode(false);
      } else {
        setFormError(res.error || 'Failed to update purchase.');
      }
    } else {
      const res = PurchaseService.createPurchase(
        {
          shopId: purchaseShopId || availableShops[0]?.id || '',
          supplierName: finalSupplierName,
          invoiceNumber: invoiceNumber.trim() || undefined,
          items: finalItems,
          paymentStatus,
          notes,
        },
        currentUser
      );

      if (res.success) {
        addToast({
          type: 'success',
          title: 'Purchase Recorded & Stock Ingested',
          description: `Order from ${finalSupplierName} recorded. Product inventories were automatically restocked.`,
        });
        setIsModalOpen(false);
      } else {
        setFormError(res.error || 'Failed to record purchase.');
      }
    }
  };

  // ─────────────────────────────────────────────────────────────
  // FULL-SCREEN Record Stock In / Purchase Page
  // Renders in place of the list view when isModalOpen is true.
  // ─────────────────────────────────────────────────────────────
  if (isModalOpen && canRecordPurchase) {
    return (
      <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
        {/* Full-screen header bar */}
        <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => {
                setIsModalOpen(false);
                setEditingPurchase(null);
                setIsEditMode(false);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>

            <div className="flex items-center gap-2 min-w-0">
              {isEditMode ? (
                <Pencil className="w-5 h-5 text-amber-400 shrink-0" />
              ) : (
                <Truck className="w-5 h-5 text-blue-400 shrink-0" />
              )}
              <div className="min-w-0">
                <h2 className="text-base font-bold text-white truncate">
                  {editingPurchase
                    ? 'Edit Purchase / Correct Quantity'
                    : 'Record Stock In / Purchase'}
                </h2>
                <p className="text-[11px] text-slate-400 truncate">
                  {isEditMode
                    ? 'Update line items — stock is automatically recalculated'
                    : 'Log a supplier delivery and restock inventory automatically'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:block text-right mr-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Total Purchase Cost
              </div>
              <div className="text-lg font-extrabold font-mono text-emerald-400">
                {formatCurrency(calculatedTotal, settings.currencySymbol)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsModalOpen(false);
                setEditingPurchase(null);
                setIsEditMode(false);
              }}
              className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-6">
            {formError && (
              <div className="mb-5 p-3.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSavePurchase} className="space-y-6 text-xs">
              {/* Section: Purchase details */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h3 className="text-[11px] uppercase tracking-wider text-slate-400 font-bold mb-4">
                  Purchase Details
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {!isEditMode && (
                    <div className="md:col-span-2">
                      <label className="block text-slate-300 font-medium mb-1.5">
                        Target Shop / Unit *
                      </label>
                      <select
                        value={purchaseShopId}
                        onChange={e => setPurchaseShopId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {availableShops.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.code || 'UNIT'})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-slate-300 font-medium mb-1.5">
                      Supplier / Vendor Name (Optional)
                    </label>
                    <input
                      type="text"
                      value={supplierName}
                      onChange={e => setSupplierName(e.target.value)}
                      placeholder="e.g. Apex Hardware Distro"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1.5">
                      Vendor Invoice # (Optional)
                    </label>
                    <input
                      type="text"
                      value={invoiceNumber}
                      onChange={e => setInvoiceNumber(e.target.value)}
                      placeholder="e.g. INV-98442"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Section: Line items */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                    {isEditMode ? 'Correct Item Quantities / Costs' : 'Received Inventory Items'}
                  </h3>
                  <button
                    type="button"
                    onClick={addItemRow}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 font-semibold text-[11px] transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Item</span>
                  </button>
                </div>

                {isEditMode && (
                  <div className="mb-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      Changing quantities will recalculate stock. The system will reverse old
                      quantities and apply new ones.
                    </span>
                  </div>
                )}

                {/* Column headers for clarity */}
                <div className="hidden md:grid grid-cols-[1fr_100px_130px_120px_40px] gap-2 px-2.5 pb-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-800 mb-2">
                  <div>Product</div>
                  <div className="text-center">Quantity</div>
                  <div className="text-center">Unit Cost</div>
                  <div className="text-right">Line Total</div>
                  <div></div>
                </div>

                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 grid grid-cols-1 md:grid-cols-[1fr_100px_130px_120px_40px] gap-2 items-center"
                    >
                      <div className="min-w-0">
                        <ProductSearchSelect
                          products={shopProducts.length > 0 ? shopProducts : dbState.products}
                          value={item.productId}
                          onChange={productId => updateItemRow(idx, 'productId', productId)}
                          currencySymbol={settings.currencySymbol}
                          placeholder="Search name or SKU..."
                        />
                      </div>

                      <div className="md:w-full">
                        <input
                          type="number"
                          min="0"
                          value={item.quantity}
                          onChange={e => updateItemRow(idx, 'quantity', e.target.value)}
                          placeholder="Qty"
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-2 text-white font-mono text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div className="md:w-full">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.unitCost}
                          onChange={e => updateItemRow(idx, 'unitCost', e.target.value)}
                          placeholder="Cost"
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-2 text-white font-mono text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div className="text-right font-mono font-bold text-white text-sm px-1">
                        {formatCurrency(
                          (parseFloat(item.quantity as string) || 0) *
                            (parseFloat(item.unitCost as string) || 0),
                          settings.currencySymbol
                        )}
                      </div>

                      <div className="flex justify-end md:justify-center">
                        {items.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeItemRow(idx)}
                            className="text-slate-500 hover:text-rose-400 p-1.5 rounded hover:bg-slate-800 transition"
                            title="Remove item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <div className="w-7" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section: Payment & notes */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h3 className="text-[11px] uppercase tracking-wider text-slate-400 font-bold mb-4">
                  Payment & Notes
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1.5">Payment Status</label>
                    <select
                      value={paymentStatus}
                      onChange={e => setPaymentStatus(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="PAID">Paid in Full</option>
                      <option value="PARTIAL">Partially Paid</option>
                      <option value="UNPAID">Pending / On Credit</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1.5">Notes</label>
                    <input
                      type="text"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="e.g. Delivered by freight truck"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Sticky action footer */}
              <div className="sticky bottom-0 -mx-6 px-6 py-4 bg-slate-900/95 backdrop-blur border-t border-slate-800 flex items-center justify-between gap-3">
                <div className="text-xs">
                  <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">
                    Total Purchase Cost
                  </div>
                  <div className="text-xl font-extrabold font-mono text-white">
                    {formatCurrency(calculatedTotal, settings.currencySymbol)}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      setEditingPurchase(null);
                      setIsEditMode(false);
                    }}
                    className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow transition flex items-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>
                      {editingPurchase ? 'Update Purchase & Recalculate Stock' : 'Record & Ingest Stock'}
                    </span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // LIST VIEW (purchases table) — unchanged
  // ─────────────────────────────────────────────────────────────
  return (
    <div id="admin-purchases-view" className="flex-1 p-6 bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Supplier Purchases & Stock In</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Log procurement orders, record cost of goods, and automatically increase inventory counts
          </p>
        </div>

        {canRecordPurchase && (
          <button
            id="new-purchase-btn"
            onClick={openNewPurchaseModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg transition"
          >
            <Plus className="w-4 h-4" />
            <span>Record Supplier Purchase</span>
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 mb-5 flex items-center justify-between gap-3 text-xs">
        <div className="relative max-w-md flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by supplier, product, or invoice #..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="text-slate-400 font-medium">
          Total Purchase Orders: <span className="text-white font-bold">{purchases.length}</span>
        </div>
      </div>

      {/* Purchases Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                <th className="py-3 px-4 font-semibold">Date</th>
                <th className="py-3 px-4 font-semibold">Supplier Name</th>
                <th className="py-3 px-4 font-semibold">Invoice / Ref #</th>
                <th className="py-3 px-4 font-semibold">Items Received</th>
                <th className="py-3 px-4 font-semibold">Payment Status</th>
                <th className="py-3 px-4 text-right font-semibold">Total Cost</th>
                {canRecordPurchase && (
                  <th className="py-3 px-4 text-right font-semibold">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={canRecordPurchase ? 7 : 6} className="py-10 text-center text-slate-500">
                    <Truck className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p>No supplier purchases recorded yet.</p>
                  </td>
                </tr>
              ) : (
                visiblePurchases.map(purchase => (
                  <tr key={purchase.id} className="hover:bg-slate-850/60 transition">
                    <td className="py-3.5 px-4 text-slate-400 font-mono">
                      {formatDateTime(purchase.createdAt)}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">{purchase.supplierName}</td>
                    <td className="py-3.5 px-4 font-mono text-slate-400">
                      {purchase.invoiceNumber || '—'}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      <div>{(purchase.items || []).length} items</div>
                      <div className="text-[10px] text-slate-500 truncate max-w-xs">
                        {(purchase.items || []).map(i => `${i.quantity}x ${i.productName}`).join(', ')}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          purchase.paymentStatus === 'PAID'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {purchase.paymentStatus}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-white text-sm">
                      {formatCurrency(purchase.totalAmount, settings.currencySymbol)}
                    </td>
                    {canRecordPurchase && (
                      <td className="py-3.5 px-4 text-right space-x-1.5">
                        <button
                          onClick={() => openEditPurchase(purchase)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition"
                        >
                          <Pencil className="w-3 h-3 inline mr-1" />
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {purchases.length > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-slate-800/60 bg-slate-950/30 flex items-center justify-between gap-3">
            <div className="text-[11px] text-slate-500">
              Showing{' '}
              <span className="text-slate-300 font-semibold">
                {Math.min(visibleCount, purchases.length)}
              </span>{' '}
              of{' '}
              <span className="text-slate-300 font-semibold">{purchases.length}</span>{' '}
              purchase orders
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
                      <span>Loading...</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>
                        See More ({Math.min(PAGE_SIZE, remaining)} of {remaining})
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
