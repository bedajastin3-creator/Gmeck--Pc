import React, { useState } from 'react';
import {
  Boxes,
  AlertTriangle,
  PackageX,
  DollarSign,
  ArrowUpDown,
  History,
  X,
  Search,
  CheckCircle2,
  Calendar,
  Printer,
  Store,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { InventoryService } from '../../services/inventoryService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { Product } from '../../types';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { ProductImageViewerModal } from '../common/ProductImageViewerModal';

const PAGE_SIZE = 10;

export const AdminInventory: React.FC = () => {
  const { currentUser, dbState, addToast, selectedShopId } = useApp();
  const [activeTab, setActiveTabState] = useState<'stock' | 'movements' | 'losses'>('stock');
  const [searchQuery, setSearchQuery] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState('ALL');
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  // Collapse state per shop
  const [collapsedShops, setCollapsedShops] = useState<Set<string>>(new Set());

  // Pagination state per shop
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [loadingShops, setLoadingShops] = useState<Set<string>>(new Set());

  // Low stock filter toggle
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);

  // Loss report filters
  const [lossPeriod, setLossPeriod] = useState<'today' | 'week' | 'month' | 'all'>('month');
  const [lossTypeFilter, setLossTypeFilter] = useState('ALL');

  // Stock Adjustment Modal
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [adjustmentCategory, setAdjustmentCategory] = useState<'DAMAGED' | 'BROKEN' | 'EXPIRED' | 'LOST' | 'CORRECTION' | 'RESTOCK'>('DAMAGED');
  const [adjustmentType, setAdjustmentType] = useState<'IN' | 'OUT' | 'SET'>('OUT');
  const [quantityInput, setQuantityInput] = useState('0');
  const [reasonInput, setReasonInput] = useState('');
  const [modalError, setModalError] = useState('');

  if (!currentUser) return null;
  if (currentUser.role !== 'ADMIN' && !currentUser.permissions?.canManageInventory) return null;

  const settings = dbState.settings;
  const shops = dbState.shops || [];
  const valuation = InventoryService.getInventoryValuation(selectedShopId, currentUser);
  const allMovements = InventoryService.getMovementHistory(
    {
      shopId: selectedShopId === 'ALL' ? undefined : selectedShopId,
      search: searchQuery,
    },
    currentUser
  );

  const movements = allMovements.filter(m => {
    if (movementTypeFilter === 'ALL') return true;
    return m.type === movementTypeFilter;
  });

  const products = dbState.products.filter(p => {
    const matchesShop = selectedShopId === 'ALL' || p.shopId === selectedShopId;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    const matchesLowFilter = !showLowStockOnly || p.currentStock <= p.minStock;
    return matchesShop && matchesSearch && matchesLowFilter;
  });

  // Group products by shop
  const groupedByShop = shops
    .map(shop => ({
      shop,
      products: products.filter(p => p.shopId === shop.id),
    }))
    .filter(group => group.products.length > 0);

  const productsWithNoShop = products.filter(
    p => !shops.some(s => s.id === p.shopId)
  );

  // Global low stock products (across all shops)
  const allLowStockProducts = dbState.products.filter(
    p => p.status === 'ACTIVE' && p.currentStock <= p.minStock
  );

  const toggleShopCollapse = (shopId: string) => {
    setCollapsedShops(prev => {
      const next = new Set(prev);
      if (next.has(shopId)) next.delete(shopId);
      else next.add(shopId);
      return next;
    });
  };

  // ==============================
  // PAGINATION HELPERS
  // ==============================
  const getVisibleCount = (shopId: string): number => {
    return visibleCounts[shopId] ?? PAGE_SIZE;
  };

  const handleSeeMore = (shopId: string) => {
    setLoadingShops(prev => new Set(prev).add(shopId));
    setTimeout(() => {
      setVisibleCounts(prev => ({
        ...prev,
        [shopId]: (prev[shopId] ?? PAGE_SIZE) + PAGE_SIZE,
      }));
      setLoadingShops(prev => {
        const next = new Set(prev);
        next.delete(shopId);
        return next;
      });
    }, 300);
  };

  const handleSeeLess = (shopId: string) => {
    setVisibleCounts(prev => ({
      ...prev,
      [shopId]: PAGE_SIZE,
    }));
  };

  const selectedProduct = dbState.products.find(p => p.id === selectedProductId);
  const inputQty = parseInt(quantityInput, 10) || 0;
  const calculatedLossValue = selectedProduct ? (inputQty * (selectedProduct.purchasePrice || 0)) : 0;

  const lossMovements = (dbState.movements || []).filter(m =>
    ['DAMAGED', 'BROKEN', 'EXPIRED', 'LOST'].includes(m.type)
  );

  const filteredLosses = lossMovements.filter(m => {
    const date = new Date(m.createdAt);
    const now = new Date();

    if (lossPeriod === 'today') {
      if (date.toDateString() !== now.toDateString()) return false;
    } else if (lossPeriod === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 86400000);
      if (date < weekAgo) return false;
    } else if (lossPeriod === 'month') {
      if (date.getMonth() !== now.getMonth() || date.getFullYear() !== now.getFullYear()) return false;
    }

    if (lossTypeFilter !== 'ALL' && m.type !== lossTypeFilter) return false;
    return true;
  });

  const totalLossValue = filteredLosses.reduce((sum, m) => sum + (m.costValue || 0), 0);
  const totalLossUnits = filteredLosses.reduce((sum, m) => sum + Math.abs(m.changeQty), 0);

  const handleAdjustStock = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');

    const targetProduct = dbState.products.find(p => p.id === selectedProductId);
    if (!targetProduct) {
      setModalError('Please select a valid product.');
      return;
    }

    const qty = parseInt(quantityInput, 10) || 0;
    if (qty <= 0) {
      setModalError('Quantity must be greater than 0.');
      return;
    }

    let delta = 0;
    if (adjustmentType === 'IN') delta = qty;
    else if (adjustmentType === 'OUT') delta = -qty;
    else if (adjustmentType === 'SET') delta = qty - targetProduct.currentStock;

    const finalReason = reasonInput.trim()
      ? `[${adjustmentCategory}] ${reasonInput.trim()}`
      : `[${adjustmentCategory}] Stock adjustment`;

    const res = InventoryService.adjustStock(
      selectedProductId,
      targetProduct.currentStock + delta,
      finalReason,
      currentUser,
      adjustmentCategory
    );

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Stock Adjustment Logged',
        description: `Inventory for '${targetProduct.name}' updated (${delta > 0 ? '+' : ''}${delta} ${targetProduct.unit}).`,
      });
      setIsAdjustModalOpen(false);
      setSelectedProductId('');
      setReasonInput('');
      setQuantityInput('0');
    } else {
      setModalError(res.error || 'Failed to adjust stock.');
    }
  };

  // ==============================
  // PRINT LOW STOCK PDF
  // ==============================
  const handlePrintLowStockReport = () => {
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) {
      addToast({
        type: 'error',
        title: 'Popup Blocked',
        description: 'Please allow popups to print the report.',
      });
      return;
    }

    const lowStockByShop = shops
      .map(shop => ({
        shop,
        products: allLowStockProducts.filter(p => p.shopId === shop.id),
      }))
      .filter(g => g.products.length > 0);

    const totalUnitsNeeded = allLowStockProducts.reduce(
      (sum, p) => sum + Math.max(0, p.minStock - p.currentStock),
      0
    );

    const estimatedRestockCost = allLowStockProducts.reduce(
      (sum, p) => sum + Math.max(0, p.minStock - p.currentStock) * p.purchasePrice,
      0
    );

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Low Stock Report - ${settings.businessName}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Tahoma, sans-serif; padding: 30px; color: #1e293b; background: #fff; }

          .header { text-align: center; margin-bottom: 25px; border-bottom: 3px double #f59e0b; padding-bottom: 20px; }
          .header h1 { font-size: 26px; color: #b45309; margin-bottom: 6px; }
          .header .company { font-size: 14px; color: #475569; }
          .header .meta { font-size: 12px; color: #64748b; margin-top: 10px; }

          .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 25px; }
          .summary-card { padding: 16px; border-radius: 10px; text-align: center; color: #fff; }
          .summary-card.count { background: linear-gradient(135deg, #f59e0b, #d97706); }
          .summary-card.units { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }
          .summary-card.cost { background: linear-gradient(135deg, #dc2626, #991b1b); }
          .summary-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.95; }
          .summary-card .value { font-size: 22px; font-weight: bold; margin-top: 6px; }

          .shop-section { margin-bottom: 25px; page-break-inside: avoid; }
          .shop-header {
            display: flex; justify-content: space-between; align-items: center;
            padding: 12px 16px; background: #1e293b; color: #fff;
            border-radius: 8px 8px 0 0;
          }
          .shop-header h2 { font-size: 15px; font-weight: bold; }
          .shop-header .shop-stats { font-size: 11px; opacity: 0.85; }

          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          thead { background: #f1f5f9; color: #334155; }
          th { padding: 10px 8px; text-align: left; font-weight: 600; border-bottom: 2px solid #cbd5e1; }
          td { padding: 9px 8px; border-bottom: 1px solid #e2e8f0; }
          tr:nth-child(even) { background: #f8fafc; }

          .sku { font-family: 'Courier New', monospace; font-size: 10px; color: #475569; }
          .stock-current { font-weight: bold; color: #dc2626; font-family: 'Courier New', monospace; }
          .stock-min { color: #475569; font-family: 'Courier New', monospace; }
          .stock-needed { font-weight: bold; color: #b45309; font-family: 'Courier New', monospace; }
          .cost { text-align: right; font-family: 'Courier New', monospace; font-weight: bold; color: #dc2626; }
          .product-name { font-weight: 600; color: #1e293b; }

          .footer {
            text-align: center; margin-top: 30px; padding-top: 15px;
            border-top: 2px solid #e2e8f0; font-size: 11px; color: #94a3b8;
          }

          .badge {
            display: inline-block; padding: 2px 7px; border-radius: 4px;
            font-size: 9px; font-weight: bold;
          }
          .badge.critical { background: #fee2e2; color: #991b1b; }
          .badge.warning { background: #fef3c7; color: #92400e; }

          .empty-state {
            text-align: center; padding: 40px; color: #64748b;
            background: #f8fafc; border-radius: 8px;
          }

          @media print {
            body { padding: 0; }
            .shop-section { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📦 Low Stock & Restock Report</h1>
          <div class="company">${settings.businessName}</div>
          <div class="meta">
            Generated: ${new Date().toLocaleString()}<br>
            Report covers: <strong>All Shops Combined</strong>
          </div>
        </div>

        <div class="summary-grid">
          <div class="summary-card count">
            <div class="label">Low Stock Items</div>
            <div class="value">${allLowStockProducts.length}</div>
          </div>
          <div class="summary-card units">
            <div class="label">Units To Restock</div>
            <div class="value">${totalUnitsNeeded}</div>
          </div>
          <div class="summary-card cost">
            <div class="label">Estimated Restock Cost</div>
            <div class="value">${settings.currencySymbol} ${estimatedRestockCost.toLocaleString()}</div>
          </div>
        </div>

        ${
          lowStockByShop.length === 0
            ? `<div class="empty-state">
                <h3 style="color:#16a34a; margin-bottom:8px;">✅ All Good!</h3>
                <p>No low stock items found across any shop.</p>
              </div>`
            : lowStockByShop.map(group => `
              <div class="shop-section">
                <div class="shop-header">
                  <h2>🏪 ${group.shop.name}</h2>
                  <span class="shop-stats">
                    Code: ${group.shop.code || 'UNIT'} • ${group.products.length} ${group.products.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Product Name</th>
                      <th>SKU</th>
                      <th style="text-align:center;">Current Stock</th>
                      <th style="text-align:center;">Min Level</th>
                      <th style="text-align:center;">Units Needed</th>
                      <th style="text-align:right;">Cost / Unit</th>
                      <th style="text-align:right;">Restock Cost</th>
                      <th style="text-align:center;">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${group.products.map(p => {
                      const unitsNeeded = Math.max(0, p.minStock - p.currentStock);
                      const restockCost = unitsNeeded * p.purchasePrice;
                      const isCritical = p.currentStock <= 0;
                      return `
                        <tr>
                          <td class="product-name">${p.name}</td>
                          <td class="sku">${p.sku}</td>
                          <td style="text-align:center;" class="stock-current">${p.currentStock} ${p.unit}</td>
                          <td style="text-align:center;" class="stock-min">${p.minStock} ${p.unit}</td>
                          <td style="text-align:center;" class="stock-needed">${unitsNeeded}</td>
                          <td class="cost" style="color:#475569;">${settings.currencySymbol} ${p.purchasePrice.toLocaleString()}</td>
                          <td class="cost">${settings.currencySymbol} ${restockCost.toLocaleString()}</td>
                          <td style="text-align:center;">
                            <span class="badge ${isCritical ? 'critical' : 'warning'}">
                              ${isCritical ? 'OUT' : 'LOW'}
                            </span>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `).join('')
        }

        <div class="footer">
          ${settings.businessName} • ${settings.address || ''}<br>
          Phone: ${settings.phone || 'N/A'} • This report was auto-generated by the Gmeck Company Limited system
        </div>

        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();

    addToast({
      type: 'success',
      title: 'Low Stock Report',
      description: `Print dialog opened with ${allLowStockProducts.length} low stock items.`,
    });
  };

  // Print Loss Report
  const handlePrintLossReport = () => {
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) return;

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Stock Loss Report</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', sans-serif; padding: 30px; color: #1e293b; }
          .header { text-align: center; margin-bottom: 25px; border-bottom: 3px double #dc2626; padding-bottom: 20px; }
          .header h1 { font-size: 24px; color: #dc2626; }
          .header .meta { font-size: 12px; color: #64748b; margin-top: 8px; }
          .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px; }
          .summary-card { padding: 15px; border-radius: 8px; text-align: center; color: #fff; }
          .summary-card.total-value { background: linear-gradient(135deg, #dc2626, #991b1b); }
          .summary-card.total-units { background: linear-gradient(135deg, #f59e0b, #d97706); }
          .summary-card.count { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }
          .summary-card .label { font-size: 11px; text-transform: uppercase; }
          .summary-card .value { font-size: 20px; font-weight: bold; margin-top: 5px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          thead { background: #1e293b; color: #fff; }
          th { padding: 10px; text-align: left; }
          td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
          tr:nth-child(even) { background: #fef2f2; }
          .loss-type { color: #dc2626; font-weight: bold; }
          .footer { text-align: center; margin-top: 20px; font-size: 11px; color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📦 Stock Loss Report</h1>
          <div class="meta">Period: ${lossPeriod.toUpperCase()} | Generated: ${new Date().toLocaleString()}</div>
        </div>
        <div class="summary">
          <div class="summary-card total-value">
            <div class="label">Total Loss Value</div>
            <div class="value">${settings.currencySymbol} ${totalLossValue.toLocaleString()}</div>
          </div>
          <div class="summary-card total-units">
            <div class="label">Total Units Lost</div>
            <div class="value">${totalLossUnits}</div>
          </div>
          <div class="summary-card count">
            <div class="label">Loss Records</div>
            <div class="value">${filteredLosses.length}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Type</th>
              <th>Qty Lost</th>
              <th>Loss Value</th>
              <th>Reason</th>
              <th>Recorded By</th>
            </tr>
          </thead>
          <tbody>
            ${filteredLosses.map(m => `
              <tr>
                <td>${formatDateTime(m.createdAt)}</td>
                <td><strong>${m.productName}</strong></td>
                <td class="loss-type">${m.type}</td>
                <td>${Math.abs(m.changeQty)}</td>
                <td>${settings.currencySymbol} ${(m.costValue || 0).toLocaleString()}</td>
                <td>${m.reason}</td>
                <td>${m.userName}</td>
              </tr>
            `).join('') || '<tr><td colspan="7" style="text-align:center;">No loss records found</td></tr>'}
          </tbody>
        </table>
        <div class="footer">${settings.businessName} - Stock Loss Report</div>
        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
  };

  // ==============================
  // SHARED: RENDER PRODUCT TABLE ROW
  // ==============================
  const renderStockRow = (p: Product) => {
    const isLow = p.currentStock <= p.minStock;
    const isOut = p.currentStock <= 0;

    return (
      <tr key={p.id} className="hover:bg-slate-850/60 transition">
        <td className="py-3 px-4 font-mono text-slate-400">{p.sku}</td>
        <td className="py-3 px-4 font-semibold text-white">
          <div className="flex items-center gap-2.5">
            <ProductThumbnail product={p} size="sm" onClick={() => { setViewingProduct(p); setIsViewerOpen(true); }} />
            <span className="truncate">{p.name}</span>
          </div>
        </td>
        <td className="py-3 px-4 text-center">
          <span className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
            isOut ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
            : isLow ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
            : 'bg-emerald-500/15 text-emerald-300'
          }`}>
            {p.currentStock} {p.unit}
          </span>
        </td>
        <td className="py-3 px-4 text-center font-mono text-slate-400">{p.minStock} {p.unit}</td>
        <td className="py-3 px-4 text-right font-mono text-slate-400">{formatCurrency(p.purchasePrice, settings.currencySymbol)}</td>
        <td className="py-3 px-4 text-right font-mono text-purple-300 font-medium">{formatCurrency(p.currentStock * p.purchasePrice, settings.currencySymbol)}</td>
        <td className="py-3 px-4 text-right font-mono text-emerald-400 font-bold">{formatCurrency(p.currentStock * p.sellingPrice, settings.currencySymbol)}</td>
        <td className="py-3 px-4 text-right">
          <button
            onClick={() => { setSelectedProductId(p.id); setQuantityInput('0'); setAdjustmentType('OUT'); setIsAdjustModalOpen(true); }}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition"
          >
            Adjust
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div id="admin-inventory-view" className="flex-1 p-6 bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Inventory & Stock Control</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Monitor real-time warehouse stock, track losses, and perform stock adjustments
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePrintLowStockReport}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs shadow-lg transition"
            title="Download PDF list of all low-stock products across every shop"
          >
            <Printer className="w-4 h-4" />
            <span>Low Stock Report (PDF)</span>
            {allLowStockProducts.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[10px] font-bold">
                {allLowStockProducts.length}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              setSelectedProductId(dbState.products[0]?.id || '');
              setQuantityInput('0');
              setAdjustmentType('OUT');
              setAdjustmentCategory('DAMAGED');
              setIsAdjustModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg transition"
          >
            <ArrowUpDown className="w-4 h-4" />
            <span>Manual Stock Adjustment</span>
          </button>
        </div>
      </div>

      {/* Valuation & Stock Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total SKUs</span>
            <Boxes className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">{valuation.totalProducts}</div>
          <p className="text-[11px] text-slate-400 mt-1">{valuation.totalUnitsInStock} total units in stock</p>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Low / Out of Stock</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-300 font-mono">
            {valuation.lowStockCount}{' '}
            <span className="text-sm font-normal text-rose-400">({valuation.outOfStockCount} zero)</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Requires procurement restock</p>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Stock Valuation (Cost)</span>
            <DollarSign className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-purple-300 font-mono">
            {formatCurrency(valuation.totalCostValue, settings.currencySymbol)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Total invested capital at purchase</p>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Retail Valuation</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 font-mono">
            {formatCurrency(valuation.totalRetailValue, settings.currencySymbol)}
          </div>
          <p className="text-[11px] text-emerald-400/80 mt-1">
            Potential margin: +{formatCurrency(valuation.potentialProfit, settings.currencySymbol)}
          </p>
        </div>
      </div>

      {/* Sub-view Switcher Tabs */}
      <div className="flex items-center gap-2 mb-5 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTabState('stock')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
            activeTab === 'stock' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Boxes className="w-4 h-4" />
          <span>Live Stock Table</span>
        </button>

        <button
          onClick={() => setActiveTabState('movements')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
            activeTab === 'movements' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Movement Log ({movements.length})</span>
        </button>

        <button
          onClick={() => setActiveTabState('losses')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
            activeTab === 'losses' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <PackageX className="w-4 h-4" />
          <span>Loss Report ({lossMovements.length})</span>
        </button>
      </div>

      {/* Tab 1: Live Stock Table (Grouped by Shop) */}
      {activeTab === 'stock' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search product stock..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={() => setShowLowStockOnly(!showLowStockOnly)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition ${
                showLowStockOnly
                  ? 'bg-amber-600 text-white border-amber-500'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Low Stock Only</span>
              {allLowStockProducts.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  showLowStockOnly ? 'bg-white/20' : 'bg-amber-500/20 text-amber-300'
                }`}>
                  {allLowStockProducts.length}
                </span>
              )}
            </button>
          </div>

          {/* Grouped by Shop */}
          {products.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl py-16 text-center text-slate-500">
              <Boxes className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">
                {showLowStockOnly
                  ? 'No low stock items match your search.'
                  : 'No products match your search.'}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {groupedByShop.map(({ shop, products: shopProducts }) => {
                const isCollapsed = collapsedShops.has(shop.id);
                const shopLowStock = shopProducts.filter(
                  p => p.status === 'ACTIVE' && p.currentStock <= p.minStock
                ).length;
                const shopValue = shopProducts.reduce(
                  (sum, p) => sum + p.currentStock * p.purchasePrice,
                  0
                );

                // Pagination
                const visibleCount = getVisibleCount(shop.id);
                const visibleProducts = shopProducts.slice(0, visibleCount);
                const hasMore = shopProducts.length > visibleCount;
                const remaining = shopProducts.length - visibleCount;
                const isLoading = loadingShops.has(shop.id);

                return (
                  <div
                    key={shop.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg"
                  >
                    {/* Shop Header */}
                    <button
                      onClick={() => toggleShopCollapse(shop.id)}
                      className="w-full flex items-center justify-between gap-3 px-5 py-4 bg-slate-900/80 hover:bg-slate-800/60 active:bg-slate-800 transition border-b border-slate-800"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                          <Store className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 text-left">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-bold text-white truncate">
                              {shop.name}
                            </h3>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                              {shop.code || 'UNIT'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {shopProducts.length}{' '}
                            {shopProducts.length === 1 ? 'SKU' : 'SKUs'} •{' '}
                            Stock Value: {formatCurrency(shopValue, settings.currencySymbol)}
                            {shopLowStock > 0 && (
                              <span className="text-amber-400 ml-1">
                                • {shopLowStock} low stock
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {shopLowStock > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-bold border border-amber-500/30">
                            ⚠ {shopLowStock} Low
                          </span>
                        )}
                        {isCollapsed ? (
                          <ChevronRight className="w-5 h-5 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {/* Stock Table */}
                    {!isCollapsed && (
                      <div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                                <th className="py-3 px-4 font-semibold">SKU</th>
                                <th className="py-3 px-4 font-semibold">Product Name</th>
                                <th className="py-3 px-4 text-center font-semibold">Current Stock</th>
                                <th className="py-3 px-4 text-center font-semibold">Min Threshold</th>
                                <th className="py-3 px-4 text-right font-semibold">Cost / Unit</th>
                                <th className="py-3 px-4 text-right font-semibold">Total Cost Value</th>
                                <th className="py-3 px-4 text-right font-semibold">Retail Value</th>
                                <th className="py-3 px-4 text-right font-semibold">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {visibleProducts.map(renderStockRow)}
                            </tbody>
                          </table>
                        </div>

                        {/* Pagination Footer */}
                        {shopProducts.length > PAGE_SIZE && (
                          <div className="px-5 py-3 border-t border-slate-800/60 bg-slate-950/30 flex items-center justify-between gap-3">
                            <div className="text-[11px] text-slate-500">
                              Showing{' '}
                              <span className="text-slate-300 font-semibold">
                                {Math.min(visibleCount, shopProducts.length)}
                              </span>{' '}
                              of{' '}
                              <span className="text-slate-300 font-semibold">
                                {shopProducts.length}
                              </span>{' '}
                              products
                            </div>
                            <div className="flex items-center gap-2">
                              {visibleCount > PAGE_SIZE && (
                                <button
                                  onClick={() => handleSeeLess(shop.id)}
                                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                                >
                                  Show Less
                                </button>
                              )}
                              {hasMore && (
                                <button
                                  onClick={() => handleSeeMore(shop.id)}
                                  disabled={isLoading}
                                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold shadow transition disabled:opacity-60 disabled:cursor-wait"
                                >
                                  {isLoading ? (
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
                    )}
                  </div>
                );
              })}

              {/* Unassigned Products */}
              {productsWithNoShop.length > 0 && (
                <div className="bg-slate-900 border border-amber-800/40 rounded-2xl overflow-hidden shadow-lg">
                  <div className="flex items-center gap-3 px-5 py-4 bg-amber-950/20 border-b border-amber-800/40">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                    <div>
                      <h3 className="text-base font-bold text-white">Unassigned Products</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {productsWithNoShop.length} products have an invalid shop
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                          <th className="py-3 px-4 font-semibold">SKU</th>
                          <th className="py-3 px-4 font-semibold">Product Name</th>
                          <th className="py-3 px-4 text-center font-semibold">Current Stock</th>
                          <th className="py-3 px-4 text-center font-semibold">Min Threshold</th>
                          <th className="py-3 px-4 text-right font-semibold">Cost / Unit</th>
                          <th className="py-3 px-4 text-right font-semibold">Total Cost Value</th>
                          <th className="py-3 px-4 text-right font-semibold">Retail Value</th>
                          <th className="py-3 px-4 text-right font-semibold">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {productsWithNoShop.map(renderStockRow)}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Movement Log */}
      {activeTab === 'movements' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <select
              value={movementTypeFilter}
              onChange={e => setMovementTypeFilter(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">All Movement Types</option>
              <option value="DAMAGED">💥 Damaged Stock</option>
              <option value="BROKEN">🔨 Broken Stock</option>
              <option value="EXPIRED">⏳ Expired Items</option>
              <option value="LOST">🔍 Lost / Missing</option>
              <option value="CORRECTION">⚖️ Count Corrections</option>
              <option value="RESTOCK">📦 Restock Adjustments</option>
              <option value="SALE">🛒 Sales (Decrements)</option>
              <option value="PURCHASE">🚚 Purchases / Stock In</option>
              <option value="RETURN">↩️ Returns / Restocks</option>
            </select>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                  <th className="py-3 px-4 font-semibold">Timestamp</th>
                  <th className="py-3 px-4 font-semibold">Product</th>
                  <th className="py-3 px-4 font-semibold">Type</th>
                  <th className="py-3 px-4 text-center font-semibold">Delta</th>
                  <th className="py-3 px-4 text-center font-semibold">Before</th>
                  <th className="py-3 px-4 text-center font-semibold">After</th>
                  <th className="py-3 px-4 text-right font-semibold">Loss Value</th>
                  <th className="py-3 px-4 font-semibold">Reason</th>
                  <th className="py-3 px-4 font-semibold">User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {movements.map(m => {
                  const isPositive = m.changeQty > 0;
                  const isLossType = ['DAMAGED', 'BROKEN', 'EXPIRED', 'LOST'].includes(m.type);

                  return (
                    <tr key={m.id} className="hover:bg-slate-850/60 transition">
                      <td className="py-3 px-4 text-slate-400 font-mono">{formatDateTime(m.createdAt)}</td>
                      <td className="py-3 px-4 font-medium text-white">{m.productName}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isLossType ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-slate-800 text-slate-300'}`}>
                          {m.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold">
                        <span className={isPositive ? 'text-emerald-400' : 'text-rose-400'}>
                          {isPositive ? `+${m.changeQty}` : m.changeQty}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-slate-400">{m.previousQty}</td>
                      <td className="py-3 px-4 text-center font-mono text-white font-semibold">{m.newQty}</td>
                      <td className="py-3 px-4 text-right font-mono font-medium">
                        {m.costValue !== undefined ? (
                          <span className={isLossType ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                            {formatCurrency(m.costValue, settings.currencySymbol)}
                          </span>
                        ) : <span className="text-slate-600">-</span>}
                      </td>
                      <td className="py-3 px-4 text-slate-300 max-w-[200px] truncate">{m.reason}</td>
                      <td className="py-3 px-4 text-slate-400">{m.userName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Loss Report */}
      {activeTab === 'losses' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-400">Period:</span>
              <div className="flex gap-1">
                {[
                  { id: 'today', label: 'Today' },
                  { id: 'week', label: 'This Week' },
                  { id: 'month', label: 'This Month' },
                  { id: 'all', label: 'All Time' },
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setLossPeriod(p.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      lossPeriod === p.id ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={lossTypeFilter}
                onChange={e => setLossTypeFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
              >
                <option value="ALL">All Loss Types</option>
                <option value="DAMAGED">💥 Damaged</option>
                <option value="BROKEN">🔨 Broken</option>
                <option value="EXPIRED">⏳ Expired</option>
                <option value="LOST">🔍 Lost</option>
              </select>

              <button
                onClick={handlePrintLossReport}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Report</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] text-slate-400 uppercase block mb-1">Total Loss Value</span>
              <span className="text-xl font-bold text-rose-400 font-mono">{formatCurrency(totalLossValue, settings.currencySymbol)}</span>
            </div>
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] text-slate-400 uppercase block mb-1">Units Lost</span>
              <span className="text-xl font-bold text-amber-400 font-mono">{totalLossUnits}</span>
            </div>
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] text-slate-400 uppercase block mb-1">Loss Records</span>
              <span className="text-xl font-bold text-purple-400 font-mono">{filteredLosses.length}</span>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4 text-center">Qty Lost</th>
                  <th className="py-3 px-4 text-right">Loss Value</th>
                  <th className="py-3 px-4">Reason</th>
                  <th className="py-3 px-4">Recorded By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredLosses.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">No loss records for this period.</td>
                  </tr>
                ) : (
                  filteredLosses.map(m => (
                    <tr key={m.id} className="hover:bg-slate-850/60">
                      <td className="py-3 px-4 text-slate-400 font-mono">{formatDateTime(m.createdAt)}</td>
                      <td className="py-3 px-4 font-semibold text-white">{m.productName}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] font-bold">
                          {m.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-rose-400">{Math.abs(m.changeQty)}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-rose-400">{formatCurrency(m.costValue || 0, settings.currencySymbol)}</td>
                      <td className="py-3 px-4 text-slate-300 max-w-[200px] truncate">{m.reason}</td>
                      <td className="py-3 px-4 text-slate-400">{m.userName}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual Stock Adjustment Modal */}
      {isAdjustModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Stock Adjustment & Loss Tracking</h3>
              </div>
              <button onClick={() => setIsAdjustModalOpen(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">{modalError}</div>
            )}

            <form onSubmit={handleAdjustStock} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Select Product *</label>
                <select
                  value={selectedProductId}
                  onChange={e => setSelectedProductId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Choose Product --</option>
                  {dbState.products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Current: {p.currentStock} {p.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Adjustment Reason Category *</label>
                <select
                  value={adjustmentCategory}
                  onChange={e => {
                    const cat = e.target.value as any;
                    setAdjustmentCategory(cat);
                    if (['DAMAGED', 'BROKEN', 'EXPIRED', 'LOST'].includes(cat)) {
                      setAdjustmentType('OUT');
                    } else if (cat === 'RESTOCK') {
                      setAdjustmentType('IN');
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="DAMAGED">💥 Damaged Goods</option>
                  <option value="BROKEN">🔨 Broken Items</option>
                  <option value="EXPIRED">⏳ Expired Products</option>
                  <option value="LOST">🔍 Lost / Missing Stock</option>
                  <option value="CORRECTION">⚖️ Count Correction</option>
                  <option value="RESTOCK">📦 Restock</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Adjustment Action</label>
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => setAdjustmentType('IN')}
                    className={`py-2 rounded-lg font-semibold transition ${adjustmentType === 'IN' ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-400 border border-slate-800'}`}>
                    + Add Stock
                  </button>
                  <button type="button" onClick={() => setAdjustmentType('OUT')}
                    className={`py-2 rounded-lg font-semibold transition ${adjustmentType === 'OUT' ? 'bg-rose-600 text-white' : 'bg-slate-950 text-slate-400 border border-slate-800'}`}>
                    - Deduct Stock
                  </button>
                  <button type="button" onClick={() => setAdjustmentType('SET')}
                    className={`py-2 rounded-lg font-semibold transition ${adjustmentType === 'SET' ? 'bg-blue-600 text-white' : 'bg-slate-950 text-slate-400 border border-slate-800'}`}>
                    = Set Exact
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  {adjustmentType === 'SET' ? 'New Exact Stock Level' : 'Quantity Units'}
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={quantityInput}
                  onChange={e => setQuantityInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {selectedProduct && adjustmentType === 'OUT' && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs space-y-1">
                  <div className="flex justify-between text-rose-300 font-medium">
                    <span>Estimated Loss:</span>
                    <span className="font-bold font-mono">{formatCurrency(calculatedLossValue, settings.currencySymbol)}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-medium mb-1">Notes (Optional)</label>
                <textarea
                  rows={2}
                  value={reasonInput}
                  onChange={e => setReasonInput(e.target.value)}
                  placeholder="e.g. Broken in shipment..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button type="button" onClick={() => setIsAdjustModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition">Cancel</button>
                <button type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow transition">Apply Adjustment</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ProductImageViewerModal
        product={viewingProduct}
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        currencySymbol={settings.currencySymbol}
      />
    </div>
  );
};
