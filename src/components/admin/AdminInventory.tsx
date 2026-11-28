import React, { useEffect, useState } from 'react';
import {
  Boxes,
  AlertTriangle,
  PackageX,
  DollarSign,
  ArrowUpDown,
  History,
  X,
  Search,
  Printer,
  Calendar,
  Store,
  ChevronDown,
  ChevronRight,
  Loader2,
  Layers,
  ArrowLeft,
  Warehouse,
  FileText,
  FileSpreadsheet,
  Download,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { InventoryService } from '../../services/inventoryService';
import { ExcelExportService } from '../../services/excelExportService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  downloadMovementsReportPdf,
  printMovementsReportPdf,
} from '../../utils/movementsPrint';
import {
  downloadInventoryReportPdf,
  downloadLossReportPdf,
  downloadLowStockReportPdf,
  printInventoryReportPdf,
  printLossReportPdf,
  printLowStockReportPdf,
  InventoryExportMeta,
  InventoryExportRow,
  InventoryExportScope,
} from '../../utils/pdfExport';
import { Product } from '../../types';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { ProductImageViewerModal } from '../common/ProductImageViewerModal';
import {
  getAdminManagedShops,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../../utils/permissions';
import { AdminAdjustInventory } from './AdminAdjustInventory';
import { AdminAdjustmentList } from './AdminAdjustmentList';

const PAGE_SIZE = 10;

type ShopLocationFilter = 'ALL' | 'SHOP' | 'STORE';
type MovementPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'CUSTOM';

const formatDateYMD = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const computeMovementDateRange = (
  period: MovementPeriod,
  now: Date = new Date()
): { start: string; end: string } | null => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (period === 'DAY') {
    const ymd = formatDateYMD(today);
    return { start: ymd, end: ymd };
  }
  if (period === 'WEEK') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start: formatDateYMD(start), end: formatDateYMD(today) };
  }
  if (period === 'MONTH') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: formatDateYMD(start), end: formatDateYMD(today) };
  }
  return null;
};

export const AdminInventory: React.FC = () => {
  const {
    currentUser,
    dbState,
    addToast,
    selectedShopId,
    inventoryFilter,
    setInventoryFilter,
    inventoryNavTick,
  } = useApp();
  const [activeTab, setActiveTabState] = useState<'stock' | 'movements' | 'losses'>('stock');
  const [searchQuery, setSearchQuery] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState('ALL');
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  // Per-shop inventory filter override (defaults to active menu inventoryFilter: ALL / SHOP / STORE)
  const [shopLocationFilters, setShopLocationFilters] = useState<
    Record<string, ShopLocationFilter>
  >({});

  // Full-screen Movements filters (default: Month, expand step: 10)
  const [movementPeriod, setMovementPeriod] = useState<MovementPeriod>('MONTH');
  const [movementStartDate, setMovementStartDate] = useState(
    () => computeMovementDateRange('MONTH')!.start
  );
  const [movementEndDate, setMovementEndDate] = useState(
    () => computeMovementDateRange('MONTH')!.end
  );
  const [movementsVisibleCount, setMovementsVisibleCount] = useState(PAGE_SIZE);

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
  const [selectedAdjustLocationKey, setSelectedAdjustLocationKey] = useState('');
  const [adjustmentCategory, setAdjustmentCategory] = useState<
    'DAMAGED' | 'BROKEN' | 'EXPIRED' | 'LOST' | 'CORRECTION' | 'RESTOCK'
  >('DAMAGED');
  const [adjustmentType, setAdjustmentType] = useState<'IN' | 'OUT' | 'SET'>('OUT');
  const [quantityInput, setQuantityInput] = useState('0');
  const [reasonInput, setReasonInput] = useState('');
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    if (movementPeriod === 'CUSTOM') return;
    const range = computeMovementDateRange(movementPeriod);
    if (range) {
      setMovementStartDate(range.start);
      setMovementEndDate(range.end);
    }
  }, [movementPeriod]);

  useEffect(() => {
    setMovementsVisibleCount(PAGE_SIZE);
  }, [
    movementPeriod,
    movementStartDate,
    movementEndDate,
    movementTypeFilter,
    searchQuery,
    selectedShopId,
  ]);

  // Reset per-shop overrides and open stock view whenever user selects All / Shop / Store Products from menu
  useEffect(() => {
    setShopLocationFilters({});
    setVisibleCounts({});
    setActiveTabState('stock');
  }, [inventoryFilter, inventoryNavTick]);

  if (!currentUser) return null;
  if (!hasAdminAccess(currentUser) && !currentUser.permissions?.canManageInventory) return null;

  if (inventoryFilter === 'ADJUST') {
    return <AdminAdjustInventory />;
  }
  if (inventoryFilter === 'ADJUSTMENT_LIST') {
    return <AdminAdjustmentList />;
  }

  const baseInventoryScope: ShopLocationFilter =
    inventoryFilter === 'SHOP' || inventoryFilter === 'STORE' ? inventoryFilter : 'ALL';

  const platformAdmin = isPlatformAdmin(currentUser);
  const shopAdmin = isShopAdmin(currentUser);
  const settings = dbState.settings;
  const allShops = dbState.shops || [];
  const shops = platformAdmin
    ? allShops
    : shopAdmin
      ? getAdminManagedShops(currentUser, allShops)
      : allShops.filter(s => (currentUser.assignedShopIds || []).includes(s.id));
  const visibleShopIdSet = new Set(shops.map(s => s.id));
  const visibleProducts = (dbState.products || []).filter(
    p => platformAdmin || (!!p.shopId && visibleShopIdSet.has(p.shopId))
  );
  const visibleProductIds = new Set(visibleProducts.map(p => p.id));

  const allStoresList = dbState.stores || [];
  const floorStoreIdSet = new Set(
    allStoresList.filter(st => st.isShopFloor).map(st => st.id)
  );
  const warehouseStoresByShop = new Map<string, typeof allStoresList>();
  for (const st of allStoresList) {
    if (st.isShopFloor) continue;
    const arr = warehouseStoresByShop.get(st.shopId) || [];
    arr.push(st);
    warehouseStoresByShop.set(st.shopId, arr);
  }
  for (const arr of warehouseStoresByShop.values()) {
    arr.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
      return (a.createdAt || '').localeCompare(b.createdAt || '') || a.name.localeCompare(b.name);
    });
  }

  // Track historical shop-floor & warehouse-store presence so 0-qty products still appear in their locations
  const shopFloorHistoryProductIds = new Set<string>();
  const warehouseHistoryStoreIdsByProduct = new Map<string, Set<string>>();

  for (const m of dbState.movements || []) {
    if (!m.productId) continue;
    if (m.storeId && !floorStoreIdSet.has(m.storeId)) {
      if (m.type === 'STORE_TRANSFER' || m.type === 'INITIAL_STOCK' || m.type === 'PURCHASE' || m.type === 'ADJUSTMENT') {
        let set = warehouseHistoryStoreIdsByProduct.get(m.productId);
        if (!set) {
          set = new Set<string>();
          warehouseHistoryStoreIdsByProduct.set(m.productId, set);
        }
        set.add(m.storeId);
      }
    } else if (!m.storeId || floorStoreIdSet.has(m.storeId)) {
      shopFloorHistoryProductIds.add(m.productId);
    }
  }

  for (const pur of dbState.purchases || []) {
    for (const item of pur.items || []) {
      if (!item.productId) continue;
      if (pur.storeId && !floorStoreIdSet.has(pur.storeId)) {
        let set = warehouseHistoryStoreIdsByProduct.get(item.productId);
        if (!set) {
          set = new Set<string>();
          warehouseHistoryStoreIdsByProduct.set(item.productId, set);
        }
        set.add(pur.storeId);
      } else {
        shopFloorHistoryProductIds.add(item.productId);
      }
    }
  }

  for (const tr of dbState.stockTransfers || []) {
    if (tr.status !== 'COMPLETED') continue;
    for (const item of tr.items || []) {
      if (tr.destType === 'SHOP') {
        shopFloorHistoryProductIds.add(item.destProductId || item.productId);
      }
      if (tr.sourceType === 'SHOP') {
        shopFloorHistoryProductIds.add(item.productId);
      }
      if (tr.destType === 'STORE' && tr.destId && !floorStoreIdSet.has(tr.destId)) {
        const pid = item.destProductId || item.productId;
        let set = warehouseHistoryStoreIdsByProduct.get(pid);
        if (!set) {
          set = new Set<string>();
          warehouseHistoryStoreIdsByProduct.set(pid, set);
        }
        set.add(tr.destId);
      }
      if (tr.sourceType === 'STORE' && tr.sourceId && !floorStoreIdSet.has(tr.sourceId)) {
        let set = warehouseHistoryStoreIdsByProduct.get(item.productId);
        if (!set) {
          set = new Set<string>();
          warehouseHistoryStoreIdsByProduct.set(item.productId, set);
        }
        set.add(tr.sourceId);
      }
    }
  }

  type AdjustmentLocationOption = {
    key: string;
    type: 'SHOP' | 'STORE';
    storeId?: string;
    label: string;
    shortLabel: string;
    currentQty: number;
  };

  const getProductStoreQty = (p: Product): number => {
    if (typeof p.storeStock === 'number' && Number.isFinite(p.storeStock)) {
      return Math.max(0, p.storeStock);
    }
    if (p.storeStocks) {
      return Object.entries(p.storeStocks).reduce(
        (sum, [sid, q]) =>
          floorStoreIdSet.has(sid) ? sum : sum + Math.max(0, Number(q || 0)),
        0
      );
    }
    return 0;
  };

  const getWarehouseLocationsForProduct = (p: Product): AdjustmentLocationOption[] => {
    const shopWarehouses = warehouseStoresByShop.get(p.shopId) || [];
    if (shopWarehouses.length === 0) return [];
    const shopWarehouseIdSet = new Set(shopWarehouses.map(s => s.id));

    const mappedWarehouseSum = Object.entries(p.storeStocks || {}).reduce(
      (sum, [sid, q]) => (shopWarehouseIdSet.has(sid) ? sum + Math.max(0, Number(q || 0)) : sum),
      0
    );
    const rawStoreStock = Math.max(0, Number(p.storeStock || 0));
    const historyStores = warehouseHistoryStoreIdsByProduct.get(p.id);
    const results: AdjustmentLocationOption[] = [];

    for (const st of shopWarehouses) {
      const hasStockKey = Boolean(p.storeStocks && st.id in p.storeStocks);
      const hasDetailKey = Boolean(p.storeDetails && st.id in p.storeDetails);
      const isPrimaryStore = p.storeId === st.id;
      const isLegacyFallback =
        mappedWarehouseSum === 0 &&
        rawStoreStock > 0 &&
        ((p.storeId && shopWarehouseIdSet.has(p.storeId) && p.storeId === st.id) ||
          (!p.storeId && shopWarehouses[0]?.id === st.id));
      const hasHistoryHere = Boolean(historyStores?.has(st.id));

      if (!hasStockKey && !hasDetailKey && !isPrimaryStore && !isLegacyFallback && !hasHistoryHere) {
        continue;
      }

      let qtyHere = 0;
      if (hasStockKey) {
        qtyHere = Math.max(0, Number(p.storeStocks![st.id] || 0));
      } else if (hasDetailKey) {
        qtyHere = Math.max(0, Number(p.storeDetails![st.id]?.quantity || 0));
      } else if (isLegacyFallback) {
        qtyHere = rawStoreStock;
      }

      results.push({
        key: `STORE:${st.id}`,
        type: 'STORE',
        storeId: st.id,
        label: `Store: ${st.name}${st.location ? ` (${st.location})` : ''}`,
        shortLabel: st.name,
        currentQty: qtyHere,
      });
    }

    return results;
  };

  const hasAssignedWarehouseStore = (p: Product): boolean => {
    if (getWarehouseLocationsForProduct(p).length > 0) return true;
    if (getProductStoreQty(p) > 0) return true;
    if (p.storeId && !floorStoreIdSet.has(p.storeId)) return true;
    if (p.storeStocks && Object.keys(p.storeStocks).some(sid => !floorStoreIdSet.has(sid))) {
      return true;
    }
    if (p.storeDetails && Object.keys(p.storeDetails).some(sid => !floorStoreIdSet.has(sid))) {
      return true;
    }
    return false;
  };

  const hasAssignedShopFloor = (p: Product): boolean => {
    if (Math.max(0, Number(p.currentStock || 0)) > 0) return true;
    if (p.customFields?.assignedShopFloor) return true;
    if (p.storeStocks && Object.keys(p.storeStocks).some(sid => floorStoreIdSet.has(sid))) {
      return true;
    }
    if (p.storeDetails && Object.keys(p.storeDetails).some(sid => floorStoreIdSet.has(sid))) {
      return true;
    }
    if ((p.historicalUnitsSold || 0) > 0) return true;
    if (shopFloorHistoryProductIds.has(p.id)) return true;
    // Any product not assigned to any warehouse store belongs to the Shop even when stock is 0
    if (!hasAssignedWarehouseStore(p)) return true;
    return false;
  };

  const getProductAdjustmentLocations = (p: Product | undefined): AdjustmentLocationOption[] => {
    if (!p) return [];
    const shopObj = allShops.find(s => s.id === p.shopId);
    const locations: AdjustmentLocationOption[] = [];
    const warehouseLocations = getWarehouseLocationsForProduct(p);

    if (hasAssignedShopFloor(p) || warehouseLocations.length === 0) {
      locations.push({
        key: 'SHOP',
        type: 'SHOP',
        label: shopObj ? `Shop: ${shopObj.name}` : 'Shop Floor',
        shortLabel: shopObj ? `${shopObj.name} (Shop)` : 'Shop',
        currentQty: Math.max(0, Number(p.currentStock || 0)),
      });
    }

    for (const wl of warehouseLocations) {
      locations.push(wl);
    }

    return locations;
  };

  const getShopLocationFilter = (shopId: string): ShopLocationFilter =>
    shopLocationFilters[shopId] ?? baseInventoryScope;

  const handleSetShopLocationFilter = (shopId: string, next: ShopLocationFilter) => {
    setShopLocationFilters(prev => ({
      ...prev,
      [shopId]: next,
    }));
    setVisibleCounts(prev => ({
      ...prev,
      [shopId]: PAGE_SIZE,
    }));
  };

  const handleSetGlobalInventoryScope = (next: ShopLocationFilter) => {
    setInventoryFilter(next);
    setShopLocationFilters({});
    setVisibleCounts({});
  };

  // Location-aware valuation for top KPI cards (updates dynamically when switching All / Shop / Store)
  const scopedValuationProducts = visibleProducts.filter(
    p => selectedShopId === 'ALL' || p.shopId === selectedShopId
  );

  const activeScopeSet = new Set<ShopLocationFilter>();
  const valuation = scopedValuationProducts.reduce(
    (acc, p) => {
      const hasValidShop = !!p.shopId && visibleShopIdSet.has(p.shopId);
      const locFilter: ShopLocationFilter = hasValidShop
        ? getShopLocationFilter(p.shopId)
        : baseInventoryScope;
      activeScopeSet.add(locFilter);

      const shopQty = Math.max(0, Number(p.currentStock || 0));
      const storeQty = getProductStoreQty(p);
      const activeQty =
        locFilter === 'SHOP'
          ? shopQty
          : locFilter === 'STORE'
            ? storeQty
            : shopQty + storeQty;

      const matchesLocation =
        locFilter === 'SHOP'
          ? hasAssignedShopFloor(p)
          : locFilter === 'STORE'
            ? hasAssignedWarehouseStore(p)
            : true;

      if (matchesLocation) {
        acc.totalProducts += 1;
      }

      acc.totalUnitsInStock += activeQty;
      const cost = activeQty * (p.purchasePrice || 0);
      const retail = activeQty * (p.sellingPrice || 0);
      acc.totalCostValue += cost;
      acc.totalRetailValue += retail;

      if (p.status === 'ACTIVE') {
        if (activeQty <= 0) {
          acc.outOfStockCount += 1;
        } else if (activeQty <= p.minStock) {
          acc.lowStockCount += 1;
        }
      }

      return acc;
    },
    {
      totalProducts: 0,
      totalUnitsInStock: 0,
      totalCostValue: 0,
      totalRetailValue: 0,
      potentialProfit: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
    }
  );
  valuation.totalCostValue = Number(valuation.totalCostValue.toFixed(2));
  valuation.totalRetailValue = Number(valuation.totalRetailValue.toFixed(2));
  valuation.potentialProfit = Number(
    (valuation.totalRetailValue - valuation.totalCostValue).toFixed(2)
  );

  const activeValuationScope: ShopLocationFilter | 'MIXED' =
    activeScopeSet.size === 1
      ? Array.from(activeScopeSet)[0]
      : activeScopeSet.size > 1
        ? 'MIXED'
        : baseInventoryScope;

  const valuationScopeLabel =
    activeValuationScope === 'SHOP'
      ? 'Shop stock only'
      : activeValuationScope === 'STORE'
        ? 'Store stock only'
        : activeValuationScope === 'MIXED'
          ? 'Filtered (Shop / Store)'
          : 'All (Shop + Store)';

  const valuationScopeColorClass =
    activeValuationScope === 'SHOP'
      ? 'text-emerald-400/90'
      : activeValuationScope === 'STORE'
        ? 'text-indigo-400/90'
        : activeValuationScope === 'MIXED'
          ? 'text-blue-400/90'
          : 'text-slate-400';

  // Exclude transfers from Movements — transfers are tracked exclusively in Stores & Transfers -> List
  const allMovements = InventoryService.getMovementHistory(
    {
      shopId: selectedShopId === 'ALL' ? undefined : selectedShopId,
      search: searchQuery,
    },
    currentUser
  ).filter(m => m.type !== 'STORE_TRANSFER');

  const movementsInPeriod = allMovements.filter(m => {
    const parsed = new Date(m.createdAt);
    if (Number.isNaN(parsed.getTime())) return false;
    const ymd = formatDateYMD(parsed);
    if (movementStartDate && ymd < movementStartDate) return false;
    if (movementEndDate && ymd > movementEndDate) return false;
    return true;
  });

  const movements = movementsInPeriod.filter(m => {
    if (movementTypeFilter === 'ALL') return true;
    return m.type === movementTypeFilter;
  });

  const products = visibleProducts.filter(p => {
    const matchesShop = selectedShopId === 'ALL' || p.shopId === selectedShopId;
    const q = searchQuery.toLowerCase().trim();
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const cf = p.customFields;
    const hay = [
      p.name,
      p.variation || '',
      p.sku || '',
      p.barcode || '',
      cf?.field1 || '',
      cf?.field2 || '',
      cf?.field3 || '',
      cf?.field4 || '',
    ]
      .join(' ')
      .toLowerCase();
    const matchesSearch = tokens.length === 0 || tokens.every(t => hay.includes(t));

    const hasValidShop = !!p.shopId && visibleShopIdSet.has(p.shopId);
    const locFilter: ShopLocationFilter = hasValidShop
      ? getShopLocationFilter(p.shopId)
      : baseInventoryScope;
    const shopQty = Math.max(0, Number(p.currentStock || 0));
    const storeQty = getProductStoreQty(p);
    const activeQty =
      locFilter === 'SHOP' ? shopQty : locFilter === 'STORE' ? storeQty : shopQty + storeQty;
    const matchesLowFilter = !showLowStockOnly || activeQty <= p.minStock;
    return matchesShop && matchesSearch && matchesLowFilter;
  });

  // Group products by shop
  const groupedByShop = shops
    .map(shop => ({
      shop,
      products: products.filter(p => p.shopId === shop.id),
    }))
    .filter(group => group.products.length > 0);

  const productsWithNoShop = platformAdmin
    ? products.filter(p => !shops.some(s => s.id === p.shopId))
    : [];

  // Low stock products (scoped to visible/managed shops)
  const allLowStockProducts = visibleProducts.filter(
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

  const selectedProduct = visibleProducts.find(p => p.id === selectedProductId);
  const selectedProductLocations = getProductAdjustmentLocations(selectedProduct);
  const selectedAdjustLocation =
    selectedProductLocations.length === 1
      ? selectedProductLocations[0]
      : selectedProductLocations.find(loc => loc.key === selectedAdjustLocationKey);
  const inputQty = parseInt(quantityInput, 10) || 0;
  const calculatedLossValue = selectedProduct ? inputQty * (selectedProduct.purchasePrice || 0) : 0;

  const openAdjustModalForProduct = (productId: string, preferredMode?: ShopLocationFilter) => {
    const targetProd = visibleProducts.find(p => p.id === productId);
    const locs = getProductAdjustmentLocations(targetProd);
    let nextLocKey = locs.length === 1 ? locs[0].key : '';
    if (!nextLocKey && preferredMode === 'STORE') {
      nextLocKey = locs.find(l => l.type === 'STORE')?.key || '';
    } else if (!nextLocKey && preferredMode === 'SHOP') {
      nextLocKey = locs.find(l => l.type === 'SHOP')?.key || '';
    }
    setSelectedProductId(productId);
    setSelectedAdjustLocationKey(nextLocKey);
    setQuantityInput('0');
    setAdjustmentType('OUT');
    setAdjustmentCategory('DAMAGED');
    setReasonInput('');
    setModalError('');
    setIsAdjustModalOpen(true);
  };

  const handleSelectAdjustProduct = (productId: string) => {
    const targetProd = visibleProducts.find(p => p.id === productId);
    const locs = getProductAdjustmentLocations(targetProd);
    setSelectedProductId(productId);
    setSelectedAdjustLocationKey(locs.length === 1 ? locs[0].key : '');
    setModalError('');
  };

  // Loss movements (scoped to visible/managed shops)
  const lossMovements = (dbState.movements || []).filter(
    m =>
      ['DAMAGED', 'BROKEN', 'EXPIRED', 'LOST'].includes(m.type) &&
      (platformAdmin || (m.shopId ? visibleShopIdSet.has(m.shopId) : visibleProductIds.has(m.productId)))
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

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');

    const targetProduct = visibleProducts.find(p => p.id === selectedProductId);
    if (!targetProduct) {
      setModalError('Please select a valid product.');
      return;
    }

    const locs = getProductAdjustmentLocations(targetProduct);
    const targetLocation =
      locs.length === 1 ? locs[0] : locs.find(loc => loc.key === selectedAdjustLocationKey);
    if (!targetLocation) {
      setModalError('Please select which location to apply this stock adjustment to.');
      return;
    }

    const qty = parseInt(quantityInput, 10);
    if (!Number.isFinite(qty) || (adjustmentType === 'SET' ? qty < 0 : qty <= 0)) {
      setModalError(
        adjustmentType === 'SET'
          ? 'Exact stock level must be 0 or greater.'
          : 'Quantity must be greater than 0.'
      );
      return;
    }

    const baseQty = targetLocation.currentQty;
    let newQty = baseQty;
    if (adjustmentType === 'IN') {
      newQty = baseQty + qty;
    } else if (adjustmentType === 'OUT') {
      if (qty > baseQty) {
        setModalError(
          `Cannot deduct ${qty} ${targetProduct.unit}; only ${baseQty} ${targetProduct.unit} available in ${targetLocation.shortLabel}.`
        );
        return;
      }
      newQty = baseQty - qty;
    } else if (adjustmentType === 'SET') {
      newQty = qty;
    }

    const delta = newQty - baseQty;

    const finalReason = reasonInput.trim()
      ? `[${adjustmentCategory}] ${reasonInput.trim()}`
      : `[${adjustmentCategory}] Stock adjustment`;

    const res = await InventoryService.adjustStock(
      selectedProductId,
      newQty,
      finalReason,
      currentUser,
      adjustmentCategory,
      targetLocation.type === 'STORE' ? targetLocation.storeId : undefined
    );

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Stock Adjustment Logged',
        description: `Inventory for '${targetProduct.name}' in ${targetLocation.shortLabel} updated (${delta > 0 ? '+' : ''}${delta} ${targetProduct.unit}).`,
      });
      setIsAdjustModalOpen(false);
      setSelectedProductId('');
      setSelectedAdjustLocationKey('');
      setReasonInput('');
      setQuantityInput('0');
    } else {
      setModalError(res.error || 'Failed to adjust stock.');
    }
  };

  // ==============================
  // DOWNLOAD INVENTORY PDF & EXCEL (Respects All / Shop / Store selection)
  // ==============================
  const buildWarehouseBreakdown = (p: Product): string => {
    const allStores = dbState.stores || [];
    const shopStores = allStores.filter(st => st.shopId === p.shopId && !st.isShopFloor);
    const parts: string[] = [];

    if (p.storeStocks && Object.keys(p.storeStocks).length > 0) {
      Object.entries(p.storeStocks).forEach(([sid, qty]) => {
        if (floorStoreIdSet.has(sid)) return;
        const n = Math.max(0, Number(qty || 0));
        const hasDetail = Boolean(p.storeDetails?.[sid]);
        if (n <= 0 && !hasDetail) return;
        const st = allStores.find(s => s.id === sid);
        parts.push(`${st?.name || 'Store'}: ${n}`);
      });
    }

    if (parts.length === 0) {
      const fallbackQty = getProductStoreQty(p);
      if (fallbackQty > 0 || (p.storeId && !floorStoreIdSet.has(p.storeId))) {
        const matchedStore =
          (p.storeId ? shopStores.find(s => s.id === p.storeId) : undefined) || shopStores[0];
        parts.push(`${matchedStore?.name || 'Main Store'}: ${fallbackQty}`);
      }
    }

    return parts.join(', ');
  };

  const buildInventoryExportPayload = (
    targetShopId?: string
  ): { rows: InventoryExportRow[]; meta: InventoryExportMeta } => {
    const rows: InventoryExportRow[] = [];
    const scopesUsed = new Set<ShopLocationFilter>();

    const appendProductRow = (p: Product, shopName: string, mode: ShopLocationFilter) => {
      const shopQty = Math.max(0, Number(p.currentStock || 0));
      const storeQty = getProductStoreQty(p);

      if (mode === 'SHOP' && !hasAssignedShopFloor(p)) {
        return;
      }
      if (mode === 'STORE' && !hasAssignedWarehouseStore(p)) {
        return;
      }

      const activeQty =
        mode === 'SHOP' ? shopQty : mode === 'STORE' ? storeQty : shopQty + storeQty;
      const buyPrice = Number(p.purchasePrice || 0);
      const sellPrice = Number(p.sellingPrice || 0);
      const buyValue = Number((activeQty * buyPrice).toFixed(2));
      const sellValue = Number((activeQty * sellPrice).toFixed(2));
      const potentialProfit = Number((sellValue - buyValue).toFixed(2));

      let status: InventoryExportRow['status'] = 'IN STOCK';
      if (p.status !== 'ACTIVE') {
        status = 'INACTIVE';
      } else if (activeQty <= 0) {
        status = 'OUT OF STOCK';
      } else if (activeQty <= Number(p.minStock || 0)) {
        status = 'LOW STOCK';
      }

      scopesUsed.add(mode);
      rows.push({
        shopName,
        productName: p.name || 'Unnamed Product',
        variation: p.variation || '',
        sku: p.sku || '',
        unit: p.unit || 'pcs',
        shopQty,
        storeQty,
        totalQty: shopQty + storeQty,
        activeQty,
        rowScope: mode,
        minStock: Number(p.minStock || 0),
        purchasePrice: buyPrice,
        sellingPrice: sellPrice,
        buyValue,
        sellValue,
        potentialProfit,
        storeBreakdown: buildWarehouseBreakdown(p),
        status,
      });
    };

    if (targetShopId) {
      const targetGroup = groupedByShop.find(g => g.shop.id === targetShopId);
      const shopObj = targetGroup?.shop || shops.find(s => s.id === targetShopId);
      const mode = getShopLocationFilter(targetShopId);
      scopesUsed.add(mode);

      if (targetGroup) {
        targetGroup.products.forEach(p => appendProductRow(p, targetGroup.shop.name, mode));
      }

      return {
        rows,
        meta: {
          scope: mode,
          shopLabel: shopObj?.name || 'Shop',
          searchQuery,
          lowStockOnly: showLowStockOnly,
        },
      };
    }

    // Global export across all currently visible shops (respecting selectedShopId + per-shop All/Shop/Store)
    groupedByShop.forEach(({ shop, products: shopProducts }) => {
      const mode = getShopLocationFilter(shop.id);
      scopesUsed.add(mode);
      shopProducts.forEach(p => appendProductRow(p, shop.name, mode));
    });

    if (productsWithNoShop.length > 0) {
      scopesUsed.add(baseInventoryScope);
      productsWithNoShop.forEach(p => appendProductRow(p, 'Unassigned', baseInventoryScope));
    }

    const resolvedScope: InventoryExportScope =
      scopesUsed.size === 1
        ? Array.from(scopesUsed)[0]
        : scopesUsed.size > 1
          ? 'MIXED'
          : activeValuationScope;

    const selectedShopObj =
      selectedShopId !== 'ALL' ? shops.find(s => s.id === selectedShopId) : undefined;
    const shopLabel = selectedShopObj
      ? selectedShopObj.name
      : shopAdmin && !platformAdmin
        ? shops.length === 1
          ? shops[0].name
          : 'Managed Shops'
        : 'All Shops';

    return {
      rows,
      meta: {
        scope: resolvedScope,
        shopLabel,
        searchQuery,
        lowStockOnly: showLowStockOnly,
      },
    };
  };

  const getScopeShortText = (scope: InventoryExportScope): string => {
    if (scope === 'SHOP') return 'Shop';
    if (scope === 'STORE') return 'Store';
    if (scope === 'MIXED') return 'Filtered';
    return 'All';
  };

  const handlePrintInventoryPdf = async (targetShopId?: string) => {
    const key = `print:${targetShopId || 'ALL'}`;
    if (exportingKey) return;
    setExportingKey(key);
    try {
      const { rows, meta } = buildInventoryExportPayload(targetShopId);
      if (rows.length === 0) {
        addToast({
          type: 'warning',
          title: 'Nothing to Print',
          description: `No ${getScopeShortText(meta.scope).toLowerCase()} inventory items match your current selection.`,
        });
        return;
      }

      const res = await printInventoryReportPdf(rows, settings, meta);
      if (res.ok) {
        addToast({
          type: 'success',
          title:
            res.mode === 'fallback_download'
              ? `Opened ${getScopeShortText(meta.scope)} Inventory PDF`
              : 'Print Dialog Opened',
          description:
            res.mode === 'fallback_download'
              ? 'Use the printer option in your PDF viewer to print.'
              : `Ready to print ${rows.length} product(s) for ${meta.shopLabel} (${getScopeShortText(meta.scope)}).`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'Print Failed',
          description: res.error || 'Could not open print dialog on this device.',
        });
      }
    } finally {
      setExportingKey(null);
    }
  };

  const handleDownloadInventoryPdf = async (targetShopId?: string) => {
    const key = `pdf:${targetShopId || 'ALL'}`;
    if (exportingKey) return;
    setExportingKey(key);
    try {
      const { rows, meta } = buildInventoryExportPayload(targetShopId);
      if (rows.length === 0) {
        addToast({
          type: 'warning',
          title: 'Nothing to Export',
          description: `No ${getScopeShortText(meta.scope).toLowerCase()} inventory items match your current selection.`,
        });
        return;
      }

      const ok = await downloadInventoryReportPdf(rows, settings, meta);
      if (ok) {
        addToast({
          type: 'success',
          title: `${getScopeShortText(meta.scope)} Inventory PDF Downloaded`,
          description: `Exported ${rows.length} product(s) for ${meta.shopLabel} (${getScopeShortText(meta.scope)}).`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'PDF Export Failed',
          description: 'Could not save inventory PDF report on this device.',
        });
      }
    } finally {
      setExportingKey(null);
    }
  };

  const handleDownloadInventoryExcel = async (targetShopId?: string) => {
    const key = `excel:${targetShopId || 'ALL'}`;
    if (exportingKey) return;
    setExportingKey(key);
    try {
      const { rows, meta } = buildInventoryExportPayload(targetShopId);
      if (rows.length === 0) {
        addToast({
          type: 'warning',
          title: 'Nothing to Export',
          description: `No ${getScopeShortText(meta.scope).toLowerCase()} inventory items match your current selection.`,
        });
        return;
      }

      const res = await ExcelExportService.exportInventoryReport(rows, settings, meta);
      if (res.success) {
        addToast({
          type: 'success',
          title: `${getScopeShortText(meta.scope)} Inventory Excel Downloaded`,
          description: `Saved ${res.fileName} with ${res.rowCount || rows.length} product(s).`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'Excel Export Failed',
          description: res.error || 'Could not save inventory Excel file on this device.',
        });
      }
    } finally {
      setExportingKey(null);
    }
  };

  // ==============================
  // PRINT & DOWNLOAD LOW STOCK PDF
  // ==============================
  const getLowStockScopeLabel = () =>
    shopAdmin && !platformAdmin
      ? shops.length === 1
        ? shops[0].name
        : 'Managed Shops'
      : 'All Shops Combined';

  const handleDownloadLowStockReport = async () => {
    if (exportingKey) return;
    setExportingKey('lowstock:pdf');
    try {
      const ok = await downloadLowStockReportPdf(
        allLowStockProducts,
        shops,
        settings,
        getLowStockScopeLabel()
      );
      if (ok) {
        addToast({
          type: 'success',
          title: 'Low Stock PDF Downloaded',
          description: `Saved PDF with ${allLowStockProducts.length} low stock item(s) to Downloads.`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'PDF Export Failed',
          description: 'Could not save low stock PDF report on this device.',
        });
      }
    } finally {
      setExportingKey(null);
    }
  };

  const handlePrintLowStockReport = async () => {
    if (exportingKey) return;
    setExportingKey('lowstock:print');
    try {
      const res = await printLowStockReportPdf(
        allLowStockProducts,
        shops,
        settings,
        getLowStockScopeLabel()
      );
      if (res.ok) {
        addToast({
          type: 'success',
          title:
            res.mode === 'fallback_download'
              ? 'Opened Low Stock PDF'
              : 'Print Dialog Opened',
          description:
            res.mode === 'fallback_download'
              ? 'Use the printer option in your PDF viewer to print.'
              : `Ready to print ${allLowStockProducts.length} low stock item(s).`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'Print Failed',
          description: res.error || 'Could not open print dialog on this device.',
        });
      }
    } finally {
      setExportingKey(null);
    }
  };

  // Print & Download Stock Loss Report PDF
  const handleDownloadLossReport = async () => {
    if (exportingKey) return;
    setExportingKey('loss:pdf');
    try {
      const ok = await downloadLossReportPdf(filteredLosses, settings, {
        periodLabel: lossPeriod.toUpperCase(),
        totalLossValue,
        totalLossUnits,
      });
      if (ok) {
        addToast({
          type: 'success',
          title: 'Loss Report PDF Downloaded',
          description: `Saved PDF with ${filteredLosses.length} loss record(s) to Downloads.`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'PDF Export Failed',
          description: 'Could not save stock loss PDF report on this device.',
        });
      }
    } finally {
      setExportingKey(null);
    }
  };

  const handlePrintLossReport = async () => {
    if (exportingKey) return;
    setExportingKey('loss:print');
    try {
      const res = await printLossReportPdf(filteredLosses, settings, {
        periodLabel: lossPeriod.toUpperCase(),
        totalLossValue,
        totalLossUnits,
      });
      if (res.ok) {
        addToast({
          type: 'success',
          title:
            res.mode === 'fallback_download'
              ? 'Opened Loss Report PDF'
              : 'Print Dialog Opened',
          description:
            res.mode === 'fallback_download'
              ? 'Use the printer option in your PDF viewer to print.'
              : `Ready to print ${filteredLosses.length} loss record(s).`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'Print Failed',
          description: res.error || 'Could not open print dialog on this device.',
        });
      }
    } finally {
      setExportingKey(null);
    }
  };

  // Print & Download Full-Screen Movements Report PDF
  const buildMovementsPdfMeta = () => {
    const periodLabel =
      movementPeriod === 'DAY'
        ? `Day (${movementStartDate})`
        : movementPeriod === 'WEEK'
          ? `Week (${movementStartDate} -> ${movementEndDate})`
          : movementPeriod === 'MONTH'
            ? `Month (${movementStartDate} -> ${movementEndDate})`
            : `Custom (${movementStartDate || '...'} -> ${movementEndDate || '...'})`;

    const typeLabel =
      movementTypeFilter === 'ALL' ? 'All Movement Types (No Transfers)' : movementTypeFilter;
    const shopObj = selectedShopId !== 'ALL' ? shops.find(s => s.id === selectedShopId) : undefined;
    const shopLabel = shopObj
      ? shopObj.name
      : shopAdmin && !platformAdmin
        ? shops.length === 1
          ? shops[0].name
          : 'Managed Shops'
        : 'All Shops';

    return { periodLabel, typeLabel, shopLabel };
  };

  const handleDownloadMovementsReport = async () => {
    if (exportingKey) return;
    setExportingKey('movements:pdf');
    try {
      const ok = await downloadMovementsReportPdf(
        movements,
        settings,
        buildMovementsPdfMeta()
      );
      if (ok) {
        addToast({
          type: 'success',
          title: 'Movements PDF Downloaded',
          description: `Saved PDF with ${movements.length} movement record(s) to Downloads.`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'PDF Export Failed',
          description: 'Could not save movements PDF report on this device.',
        });
      }
    } finally {
      setExportingKey(null);
    }
  };

  const handlePrintMovementsReport = async () => {
    if (exportingKey) return;
    setExportingKey('movements:print');
    try {
      const res = await printMovementsReportPdf(
        movements,
        settings,
        buildMovementsPdfMeta()
      );
      if (res.ok) {
        addToast({
          type: 'success',
          title:
            res.mode === 'fallback_download'
              ? 'Opened Movements PDF'
              : 'Print Dialog Opened',
          description:
            res.mode === 'fallback_download'
              ? 'Use the printer option in your PDF viewer to print.'
              : `Ready to print ${movements.length} movement record(s).`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'Print Failed',
          description: res.error || 'Could not open print dialog on this device.',
        });
      }
    } finally {
      setExportingKey(null);
    }
  };

  // ==============================
  // STOCK ROW (Desktop Table) & CARD (Mobile)
  // ==============================
  const renderStockRow = (p: Product, mode: ShopLocationFilter = 'ALL') => {
    const shopQty = Math.max(0, Number(p.currentStock || 0));
    const storeQty = getProductStoreQty(p);
    const displayQty = mode === 'STORE' ? storeQty : mode === 'SHOP' ? shopQty : shopQty + storeQty;
    const isLow = mode !== 'STORE' && shopQty <= p.minStock;
    const isOut = displayQty <= 0;

    const unitBuyPrice = Number(p.purchasePrice || 0);
    const unitSellingPrice = Number(p.sellingPrice || 0);
    const totalBuyVal = displayQty * unitBuyPrice;
    const totalSellVal = displayQty * unitSellingPrice;

    const warehouseStoreEntries = p.storeStocks
      ? Object.entries(p.storeStocks).filter(
          ([sid, q]) => !floorStoreIdSet.has(sid) && (Number(q || 0) > 0 || Boolean(p.storeDetails?.[sid]))
        )
      : [];

    return (
      <tr key={p.id} className="hover:bg-slate-850/60 transition">
        <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">{p.sku}</td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <ProductThumbnail
              product={p}
              size="sm"
              onClick={() => {
                setViewingProduct(p);
                setIsViewerOpen(true);
              }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-white truncate">{p.name}</span>
                {p.variation && (
                  <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/25 text-[9px] font-semibold inline-flex items-center gap-0.5">
                    <Layers className="w-2.5 h-2.5" />
                    {p.variation}
                  </span>
                )}
              </div>
              {mode !== 'SHOP' && warehouseStoreEntries.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1 text-[9px]">
                  {warehouseStoreEntries.map(([sid, qty]) => {
                    const st = (dbState.stores || []).find(s => s.id === sid);
                    return (
                      <span
                        key={sid}
                        className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300 font-mono"
                      >
                        {st?.name || 'Store'}: {qty}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="py-3 px-4 text-center">
          <div className="inline-flex flex-col items-center gap-0.5">
            <span
              className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] ${
                mode === 'STORE'
                  ? isOut
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  : isOut
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : isLow
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-emerald-500/15 text-emerald-300'
              }`}
            >
              {mode === 'ALL' ? `${shopQty} Shop` : `${displayQty} ${p.unit}`}
            </span>
            {mode === 'ALL' && storeQty > 0 && (
              <span className="font-mono text-[10px] text-indigo-300">
                + {storeQty} Store
              </span>
            )}
          </div>
        </td>
        <td className="py-3 px-4 text-center font-mono text-slate-400">
          {p.minStock} {p.unit}
        </td>
        <td className="py-3 px-4 text-right font-mono text-slate-300">
          {formatCurrency(unitBuyPrice, settings.currencySymbol)}
        </td>
        <td className="py-3 px-4 text-right font-mono text-emerald-300">
          {formatCurrency(unitSellingPrice, settings.currencySymbol)}
        </td>
        <td className="py-3 px-4 text-right font-mono text-purple-300 font-medium">
          {formatCurrency(totalBuyVal, settings.currencySymbol)}
        </td>
        <td className="py-3 px-4 text-right font-mono text-emerald-400 font-bold">
          {formatCurrency(totalSellVal, settings.currencySymbol)}
        </td>
        <td className="py-3 px-4 text-right">
          <button
            onClick={() => openAdjustModalForProduct(p.id, mode)}
            className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 text-[11px] font-semibold transition"
          >
            Adjust
          </button>
        </td>
      </tr>
    );
  };

  const renderStockCard = (p: Product, mode: ShopLocationFilter = 'ALL') => {
    const shopQty = Math.max(0, Number(p.currentStock || 0));
    const storeQty = getProductStoreQty(p);
    const displayQty = mode === 'STORE' ? storeQty : shopQty;
    const isLow = mode !== 'STORE' && shopQty <= p.minStock;
    const isOut = displayQty <= 0;

    const unitBuyPrice = Number(p.purchasePrice || 0);
    const unitSellingPrice = Number(p.sellingPrice || 0);

    const warehouseStoreEntries = p.storeStocks
      ? Object.entries(p.storeStocks).filter(([sid]) => !floorStoreIdSet.has(sid))
      : [];

    const stockLabel =
      mode === 'SHOP'
        ? 'Shop'
        : mode === 'STORE'
          ? 'Store'
          : storeQty > 0
            ? 'Shop / Store'
            : 'Shop';

    return (
      <div key={p.id} className="p-3.5 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <ProductThumbnail
              product={p}
              size="sm"
              onClick={() => {
                setViewingProduct(p);
                setIsViewerOpen(true);
              }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h4 className="font-bold text-xs text-white truncate">{p.name}</h4>
                {p.variation && (
                  <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/25 text-[9px] font-semibold inline-flex items-center gap-0.5">
                    <Layers className="w-2.5 h-2.5" />
                    {p.variation}
                  </span>
                )}
              </div>
              <p className="text-[10px] font-mono text-slate-400 mt-0.5">SKU: {p.sku}</p>
            </div>
          </div>

          <button
            onClick={() => openAdjustModalForProduct(p.id, mode)}
            className="px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600 active:bg-blue-700 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-semibold shrink-0 transition"
          >
            Adjust
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
            <div className="text-[9px] text-slate-400">{stockLabel}</div>
            <div
              className={`font-mono text-[11px] font-bold ${
                mode === 'STORE'
                  ? isOut
                    ? 'text-rose-400'
                    : 'text-blue-400'
                  : isOut
                    ? 'text-rose-400'
                    : isLow
                      ? 'text-amber-300'
                      : 'text-emerald-400'
              }`}
            >
              {displayQty} {p.unit}
            </div>
            {mode === 'ALL' && storeQty > 0 && (
              <div className="font-mono text-[10px] text-blue-400 mt-0.5">
                Store: {storeQty} {p.unit}
              </div>
            )}
          </div>
          <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
            <div className="text-[9px] text-slate-400">Buy Price</div>
            <div className="font-mono text-[11px] text-purple-300 font-medium truncate">
              {formatCurrency(unitBuyPrice, settings.currencySymbol)}
            </div>
          </div>
          <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
            <div className="text-[9px] text-slate-400">Selling Price</div>
            <div className="font-mono text-[11px] text-emerald-400 font-bold truncate">
              {formatCurrency(unitSellingPrice, settings.currencySymbol)}
            </div>
          </div>
        </div>

        {mode !== 'SHOP' && warehouseStoreEntries.length > 0 && (
          <div className="flex flex-wrap gap-1 text-[10px]">
            {warehouseStoreEntries.map(([sid, qty]) => {
              const st = (dbState.stores || []).find(s => s.id === sid);
              return (
                <span
                  key={sid}
                  className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300 font-mono"
                >
                  {st?.name || 'Store'}: {qty}
                </span>
              );
            })}
          </div>
        )}

        {((p.historicalUnitsSold || 0) > 0 ||
          (p.historicalUnitsTransferred || 0) > 0 ||
          (p.historicalUnitsAdjusted || 0) > 0) && (
          <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-amber-950/20 border border-amber-500/20 text-[10px] text-amber-200/90">
            <span className="inline-flex items-center gap-1">
              <History className="w-3 h-3 text-amber-400" />
              {p.historicalNote || 'Historical date unavailable'}
            </span>
            <span className="font-mono">
              Sold: {p.historicalUnitsSold || 0} · Trf: {p.historicalUnitsTransferred || 0} · Adj:{' '}
              {p.historicalUnitsAdjusted || 0}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      id="admin-inventory-view"
      className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-6"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 mb-5 pb-4 border-b border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              {activeValuationScope === 'SHOP'
                ? 'Shop Inventory'
                : activeValuationScope === 'STORE'
                  ? 'Store Inventory'
                  : 'All Inventories'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Monitor real-time stock levels, buying &amp; selling prices, losses, and adjustments
            </p>
          </div>

          {/* Global Scope Selector: All / Shop / Store */}
          <div className="grid grid-cols-3 gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs font-semibold shrink-0">
            <button
              type="button"
              onClick={() => handleSetGlobalInventoryScope('ALL')}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeValuationScope === 'ALL'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => handleSetGlobalInventoryScope('SHOP')}
              className={`flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg transition ${
                activeValuationScope === 'SHOP'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span>Shop</span>
            </button>
            <button
              type="button"
              onClick={() => handleSetGlobalInventoryScope('STORE')}
              className={`flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg transition ${
                activeValuationScope === 'STORE'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Warehouse className="w-3.5 h-3.5" />
              <span>Store</span>
            </button>
          </div>
        </div>

        {/* Action Toolbar: Print / PDF / Excel / Low Stock / Manual Stock Adjustment */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <button
            type="button"
            disabled={exportingKey !== null}
            onClick={() => handlePrintInventoryPdf()}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/35 text-indigo-300 hover:text-white disabled:opacity-60 font-semibold text-xs shadow transition"
          >
            {exportingKey === 'print:ALL' ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Printer className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate">
              Print ({getScopeShortText(activeValuationScope)})
            </span>
          </button>

          <button
            type="button"
            disabled={exportingKey !== null}
            onClick={() => handleDownloadInventoryPdf()}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:opacity-60 text-white font-semibold text-xs shadow-lg transition"
          >
            {exportingKey === 'pdf:ALL' ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Download className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate">
              Download PDF ({getScopeShortText(activeValuationScope)})
            </span>
          </button>

          <button
            type="button"
            disabled={exportingKey !== null}
            onClick={() => handleDownloadInventoryExcel()}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-xs shadow-lg transition"
          >
            {exportingKey === 'excel:ALL' ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate">
              Excel ({getScopeShortText(activeValuationScope)})
            </span>
          </button>

          <button
            type="button"
            disabled={exportingKey !== null}
            onClick={handlePrintLowStockReport}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-600/20 hover:bg-amber-600 border border-amber-500/35 text-amber-300 hover:text-white disabled:opacity-60 font-semibold text-xs shadow transition"
          >
            {exportingKey === 'lowstock:print' ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Printer className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate">Print Low Stock</span>
          </button>

          <button
            type="button"
            disabled={exportingKey !== null}
            onClick={handleDownloadLowStockReport}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 disabled:opacity-60 text-white font-semibold text-xs shadow-lg transition"
          >
            {exportingKey === 'lowstock:pdf' ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Download className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate">Low Stock PDF</span>
            {allLowStockProducts.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[10px] font-bold">
                {allLowStockProducts.length}
              </span>
            )}
          </button>

          <button
            id="stock-adjust-btn"
            onClick={() => {
              openAdjustModalForProduct(
                visibleProducts[0]?.id || '',
                activeValuationScope === 'MIXED' ? 'ALL' : activeValuationScope
              );
            }}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs shadow-lg transition"
          >
            <ArrowUpDown className="w-4 h-4 shrink-0" />
            <span className="truncate">Manual Adjust</span>
          </button>
        </div>
      </div>

      {/* Valuation & Stock Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 mb-5">
        <div className="p-3 sm:p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider">
              Total SKUs
            </span>
            <Boxes className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400" />
          </div>
          <div className="text-lg sm:text-2xl font-bold text-white font-mono">
            {valuation.totalProducts}
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 truncate">
            {valuation.totalUnitsInStock.toLocaleString()} total units
          </p>
        </div>

        <div className="p-3 sm:p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider">
              Low / Out
            </span>
            <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" />
          </div>
          <div className="text-lg sm:text-2xl font-bold text-amber-300 font-mono">
            {valuation.lowStockCount}{' '}
            <span className="text-[10px] sm:text-sm font-normal text-rose-400">
              ({valuation.outOfStockCount} zero)
            </span>
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 truncate">
            {activeValuationScope === 'SHOP'
              ? 'Shop stock status'
              : activeValuationScope === 'STORE'
                ? 'Store stock status'
                : 'Needs restock'}
          </p>
        </div>

        <div className="p-3 sm:p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider">
              Buy Price Total
            </span>
            <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-400" />
          </div>
          <div className="text-sm sm:text-xl font-bold text-purple-300 font-mono truncate">
            {formatCurrency(valuation.totalCostValue, settings.currencySymbol)}
          </div>
          <p className={`text-[10px] sm:text-[11px] mt-0.5 truncate font-medium ${valuationScopeColorClass}`}>
            {valuationScopeLabel}
          </p>
        </div>

        <div className="p-3 sm:p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider">
              Selling Price Total
            </span>
            <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
          </div>
          <div className="text-sm sm:text-xl font-bold text-emerald-400 font-mono truncate">
            {formatCurrency(valuation.totalRetailValue, settings.currencySymbol)}
          </div>
          <p className="text-[10px] sm:text-[11px] text-emerald-400/80 mt-0.5 truncate">
            +{formatCurrency(valuation.potentialProfit, settings.currencySymbol)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 sm:gap-2 mb-4 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTabState('stock')}
          className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
            activeTab === 'stock'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 active:bg-slate-800'
          }`}
        >
          <Boxes className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>Stock</span>
        </button>

        <button
          onClick={() => setActiveTabState('movements')}
          className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
            activeTab === 'movements'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 active:bg-slate-800'
          }`}
        >
          <History className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>Movements ({movements.length})</span>
        </button>

        <button
          onClick={() => setActiveTabState('losses')}
          className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
            activeTab === 'losses'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 active:bg-slate-800'
          }`}
        >
          <PackageX className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>Losses ({lossMovements.length})</span>
        </button>
      </div>

      {/* TAB 1: Live Stock (Grouped by Shop) */}
      {activeTab === 'stock' && (
        <div className="space-y-4">
          {/* Search + Low Stock filter */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="relative flex-1 max-w-md">
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
              className={`flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border transition ${
                showLowStockOnly
                  ? 'bg-amber-600 text-white border-amber-500'
                  : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Low Stock Only</span>
              {allLowStockProducts.length > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    showLowStockOnly ? 'bg-white/20' : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {allLowStockProducts.length}
                </span>
              )}
            </button>
          </div>

          {/* Grouped by Shop */}
          {products.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl py-12 text-center text-slate-500">
              <Boxes className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-xs sm:text-sm">
                {showLowStockOnly
                  ? 'No low stock items match your search.'
                  : 'No products match your search.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedByShop.map(({ shop, products: shopProducts }) => {
                const isCollapsed = collapsedShops.has(shop.id);
                const locationFilter = getShopLocationFilter(shop.id);

                // Filter per shop: ALL (default), SHOP (shop inventory only), STORE (store inventory only)
                const filteredShopProducts = shopProducts.filter(p => {
                  if (locationFilter === 'SHOP') {
                    return hasAssignedShopFloor(p);
                  }
                  if (locationFilter === 'STORE') {
                    return hasAssignedWarehouseStore(p);
                  }
                  return true;
                });

                const shopLowStock = filteredShopProducts.filter(p => {
                  if (p.status !== 'ACTIVE') return false;
                  const shopQty = Math.max(0, Number(p.currentStock || 0));
                  const storeQty = getProductStoreQty(p);
                  const qty =
                    locationFilter === 'SHOP'
                      ? shopQty
                      : locationFilter === 'STORE'
                        ? storeQty
                        : shopQty + storeQty;
                  return qty <= p.minStock;
                }).length;

                // Total Cost & Total Retail Value across all items matching the shop filter
                const totalShopCost = filteredShopProducts.reduce((sum, p) => {
                  const shopQty = Math.max(0, Number(p.currentStock || 0));
                  const storeQty = getProductStoreQty(p);
                  const qty =
                    locationFilter === 'SHOP'
                      ? shopQty
                      : locationFilter === 'STORE'
                        ? storeQty
                        : shopQty + storeQty;
                  return sum + qty * (p.purchasePrice || 0);
                }, 0);

                const totalShopRetail = filteredShopProducts.reduce((sum, p) => {
                  const shopQty = Math.max(0, Number(p.currentStock || 0));
                  const storeQty = getProductStoreQty(p);
                  const qty =
                    locationFilter === 'SHOP'
                      ? shopQty
                      : locationFilter === 'STORE'
                        ? storeQty
                        : shopQty + storeQty;
                  return sum + qty * (p.sellingPrice || 0);
                }, 0);

                const totalShopUnits = filteredShopProducts.reduce((sum, p) => {
                  const shopQty = Math.max(0, Number(p.currentStock || 0));
                  const storeQty = getProductStoreQty(p);
                  const qty =
                    locationFilter === 'SHOP'
                      ? shopQty
                      : locationFilter === 'STORE'
                        ? storeQty
                        : shopQty + storeQty;
                  return sum + qty;
                }, 0);

                const headerStockValue = totalShopCost;

                // Pagination
                const visibleCount = getVisibleCount(shop.id);
                const visibleShopProducts = filteredShopProducts.slice(0, visibleCount);
                const hasMore = filteredShopProducts.length > visibleCount;
                const remaining = filteredShopProducts.length - visibleCount;
                const isLoading = loadingShops.has(shop.id);

                return (
                  <div
                    key={shop.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg"
                  >
                    {/* Shop Header */}
                    <button
                      type="button"
                      onClick={() => toggleShopCollapse(shop.id)}
                      className="w-full flex items-center justify-between gap-3 p-3.5 sm:px-5 sm:py-4 bg-slate-900/80 hover:bg-slate-800/60 active:bg-slate-800 transition border-b border-slate-800"
                    >
                      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                          <Store className="w-4 h-4 sm:w-5 sm:h-5" />
                        </div>
                        <div className="min-w-0 text-left">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h3 className="text-sm sm:text-base font-bold text-white truncate">
                              {shop.name}
                            </h3>
                            <span className="px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                              {shop.code || 'UNIT'}
                            </span>
                          </div>
                          <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                            {filteredShopProducts.length}{' '}
                            {filteredShopProducts.length === 1 ? 'SKU' : 'SKUs'} • Stock:{' '}
                            {formatCurrency(headerStockValue, settings.currencySymbol)}
                            {shopLowStock > 0 && (
                              <span className="text-amber-400 ml-1">
                                • {shopLowStock} low
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {shopLowStock > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[9px] sm:text-[10px] font-bold border border-amber-500/30">
                            ⚠ {shopLowStock}
                          </span>
                        )}
                        {isCollapsed ? (
                          <ChevronRight className="w-5 h-5 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {!isCollapsed && (
                      <>
                        {/* Per-Shop Location Filter (All / Shop / Store) + Per-Shop PDF & Excel Downloads */}
                        <div className="px-3.5 sm:px-5 py-2.5 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                              Inventory View
                            </span>
                            <div className="grid grid-cols-3 gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 text-[11px] font-semibold">
                              <button
                                type="button"
                                onClick={() => handleSetShopLocationFilter(shop.id, 'ALL')}
                                className={`px-2.5 py-1.5 rounded-lg transition ${
                                  locationFilter === 'ALL'
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                              >
                                All
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSetShopLocationFilter(shop.id, 'SHOP')}
                                className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg transition ${
                                  locationFilter === 'SHOP'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                              >
                                <Store className="w-3 h-3" />
                                <span>Shop</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSetShopLocationFilter(shop.id, 'STORE')}
                                className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg transition ${
                                  locationFilter === 'STORE'
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                              >
                                <Warehouse className="w-3 h-3" />
                                <span>Store</span>
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={exportingKey !== null || filteredShopProducts.length === 0}
                              onClick={() => handlePrintInventoryPdf(shop.id)}
                              title={`Print ${shop.name} (${getScopeShortText(locationFilter)}) PDF`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 disabled:opacity-40 text-[11px] font-semibold transition"
                            >
                              {exportingKey === `print:${shop.id}` ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Printer className="w-3 h-3" />
                              )}
                              <span>Print</span>
                            </button>
                            <button
                              type="button"
                              disabled={exportingKey !== null || filteredShopProducts.length === 0}
                              onClick={() => handleDownloadInventoryPdf(shop.id)}
                              title={`Download ${shop.name} (${getScopeShortText(locationFilter)}) PDF`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 disabled:opacity-40 text-[11px] font-semibold transition"
                            >
                              {exportingKey === `pdf:${shop.id}` ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Download className="w-3 h-3" />
                              )}
                              <span>PDF</span>
                            </button>
                            <button
                              type="button"
                              disabled={exportingKey !== null || filteredShopProducts.length === 0}
                              onClick={() => handleDownloadInventoryExcel(shop.id)}
                              title={`Download ${shop.name} (${getScopeShortText(locationFilter)}) Excel`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 disabled:opacity-40 text-[11px] font-semibold transition"
                            >
                              {exportingKey === `excel:${shop.id}` ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <FileSpreadsheet className="w-3 h-3" />
                              )}
                              <span>Excel</span>
                            </button>
                          </div>
                        </div>

                        {filteredShopProducts.length === 0 ? (
                          <div className="py-8 px-4 text-center text-xs text-slate-500">
                            No{' '}
                            {locationFilter === 'SHOP'
                              ? 'shop'
                              : locationFilter === 'STORE'
                                ? 'store'
                                : ''}{' '}
                            inventory items found in {shop.name}.
                          </div>
                        ) : (
                          <>
                            {/* Desktop Table */}
                            <div className="hidden md:block overflow-x-auto">
                              <table className="w-full text-left text-xs">
                                <thead>
                                  <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                                    <th className="py-3 px-4 font-semibold">SKU</th>
                                    <th className="py-3 px-4 font-semibold">Product Name</th>
                                    <th className="py-3 px-4 text-center font-semibold">
                                      {locationFilter === 'STORE'
                                        ? 'Store Stock'
                                        : locationFilter === 'SHOP'
                                          ? 'Shop Stock'
                                          : 'Stock'}
                                    </th>
                                    <th className="py-3 px-4 text-center font-semibold">Min Level</th>
                                    <th className="py-3 px-4 text-right font-semibold">Buy / Unit</th>
                                    <th className="py-3 px-4 text-right font-semibold">Sell / Unit</th>
                                    <th className="py-3 px-4 text-right font-semibold">Buy Total</th>
                                    <th className="py-3 px-4 text-right font-semibold">Sell Total</th>
                                    <th className="py-3 px-4 text-right font-semibold">Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/60">
                                  {visibleShopProducts.map(p => renderStockRow(p, locationFilter))}
                                </tbody>
                              </table>
                            </div>

                            {/* Mobile Cards */}
                            <div className="md:hidden divide-y divide-slate-800/80">
                              {visibleShopProducts.map(p => renderStockCard(p, locationFilter))}
                            </div>
                          </>
                        )}

                        {/* Shop Total Cost & Retail Value */}
                        <div className="px-3.5 sm:px-5 py-3 bg-slate-950/75 border-t border-slate-800/90 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-semibold uppercase tracking-wider">
                              {locationFilter === 'SHOP'
                                ? 'Shop Total Valuation'
                                : locationFilter === 'STORE'
                                  ? 'Store Total Valuation'
                                  : 'Total Valuation (Shop + Store)'}
                            </span>
                            <span className="font-mono tabular-nums text-slate-300">
                              {totalShopUnits.toLocaleString()} units
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 sm:px-3.5 py-2">
                              <div className="text-[9px] text-slate-400 uppercase font-semibold">
                                Total Buy Price
                              </div>
                              <div className="text-xs sm:text-sm font-bold font-mono tabular-nums text-purple-300 mt-0.5 truncate">
                                {formatCurrency(totalShopCost, settings.currencySymbol)}
                              </div>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 sm:px-3.5 py-2 text-right">
                              <div className="text-[9px] text-slate-400 uppercase font-semibold">
                                Total Selling Price
                              </div>
                              <div className="text-xs sm:text-sm font-bold font-mono tabular-nums text-emerald-400 mt-0.5 truncate">
                                {formatCurrency(totalShopRetail, settings.currencySymbol)}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Pagination Footer */}
                        {filteredShopProducts.length > PAGE_SIZE && (
                          <div className="p-3 sm:px-5 bg-slate-950/40 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div className="text-[10px] sm:text-[11px] text-slate-500 text-center sm:text-left">
                              Showing{' '}
                              <span className="text-slate-300 font-semibold">
                                {Math.min(visibleCount, filteredShopProducts.length)}
                              </span>{' '}
                              of{' '}
                              <span className="text-slate-300 font-semibold">
                                {filteredShopProducts.length}
                              </span>{' '}
                              products
                            </div>
                            <div className="flex items-center gap-2">
                              {visibleCount > PAGE_SIZE && (
                                <button
                                  type="button"
                                  onClick={() => handleSeeLess(shop.id)}
                                  className="flex-1 sm:flex-none px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 text-[11px] font-semibold transition"
                                >
                                  Show Less
                                </button>
                              )}
                              {hasMore && (
                                <button
                                  type="button"
                                  onClick={() => handleSeeMore(shop.id)}
                                  disabled={isLoading}
                                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-[11px] font-semibold shadow transition disabled:opacity-60 disabled:cursor-wait"
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
                                        See More ({Math.min(PAGE_SIZE, remaining)})
                                      </span>
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
                );
              })}

              {/* Unassigned Products */}
              {productsWithNoShop.length > 0 && (
                <div className="bg-slate-900 border border-amber-800/40 rounded-2xl overflow-hidden shadow-lg">
                  <div className="flex items-center gap-2.5 p-3.5 sm:px-5 sm:py-4 bg-amber-950/20 border-b border-amber-800/40">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-white">
                        Unassigned Products
                      </h3>
                      <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                        {productsWithNoShop.length} products have an invalid shop
                      </p>
                    </div>
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                          <th className="py-3 px-4 font-semibold">SKU</th>
                          <th className="py-3 px-4 font-semibold">Product Name</th>
                          <th className="py-3 px-4 text-center font-semibold">Stock</th>
                          <th className="py-3 px-4 text-center font-semibold">Min Level</th>
                          <th className="py-3 px-4 text-right font-semibold">Buy / Unit</th>
                          <th className="py-3 px-4 text-right font-semibold">Sell / Unit</th>
                          <th className="py-3 px-4 text-right font-semibold">Buy Total</th>
                          <th className="py-3 px-4 text-right font-semibold">Sell Total</th>
                          <th className="py-3 px-4 text-right font-semibold">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {productsWithNoShop.map(p => renderStockRow(p, 'ALL'))}
                      </tbody>
                    </table>
                  </div>
                  <div className="md:hidden divide-y divide-slate-800/80">
                    {productsWithNoShop.map(p => renderStockCard(p, 'ALL'))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: FULL-SCREEN MOVEMENTS PAGE (Transfers excluded, Day/Week/Month/Custom default Month, Print PDF, 10-item expand) */}
      {activeTab === 'movements' && (() => {
        const visibleMovements = movements.slice(0, movementsVisibleCount);
        const remainingMovements = Math.max(0, movements.length - movementsVisibleCount);
        const totalInUnits = movements.reduce(
          (sum, m) => (m.changeQty > 0 ? sum + m.changeQty : sum),
          0
        );
        const totalOutUnits = movements.reduce(
          (sum, m) => (m.changeQty < 0 ? sum + Math.abs(m.changeQty) : sum),
          0
        );
        const totalCostImpact = movements.reduce(
          (sum, m) => sum + Number(m.costValue || 0),
          0
        );

        return (
          <div className="fixed inset-0 z-40 bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
            {/* Full-Screen Sticky Top Bar */}
            <div className="px-4 sm:px-6 py-3.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setActiveTabState('stock')}
                  aria-label="Back to Inventory"
                  className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
                    Stock Movements
                  </h2>
                  <p className="text-[11px] text-slate-400 truncate">
                    Damaged, broken, expired, lost, sales, purchases &amp; adjustments (transfers excluded)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={exportingKey !== null}
                  onClick={handlePrintMovementsReport}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/35 text-indigo-300 hover:text-white disabled:opacity-50 text-xs font-semibold shadow transition shrink-0"
                >
                  {exportingKey === 'movements:print' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Printer className="w-4 h-4" />
                  )}
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  disabled={exportingKey !== null}
                  onClick={handleDownloadMovementsReport}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-lg transition shrink-0"
                >
                  {exportingKey === 'movements:pdf' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>Download PDF</span>
                </button>
              </div>
            </div>

            {/* Full-Screen Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-3.5 sm:p-6 pb-20 space-y-4">
              {/* Period Filter: Day / Week / Month (Default) / Custom + Type + Search */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-blue-400" />
                    <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                      Period Filter
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">
                    {movementStartDate === movementEndDate
                      ? movementStartDate
                      : `${movementStartDate || '...'} → ${movementEndDate || '...'}`}{' '}
                    · <strong className="text-white">{movements.length.toLocaleString()}</strong>{' '}
                    record{movements.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {(
                    [
                      {
                        id: 'DAY',
                        label: 'Day',
                        activeClass:
                          'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/30',
                        idleClass:
                          'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20',
                      },
                      {
                        id: 'WEEK',
                        label: 'Week',
                        activeClass:
                          'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-500/30',
                        idleClass:
                          'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20',
                      },
                      {
                        id: 'MONTH',
                        label: 'Month',
                        activeClass:
                          'bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-500/30',
                        idleClass:
                          'bg-violet-500/10 border-violet-500/30 text-violet-300 hover:bg-violet-500/20',
                      },
                      {
                        id: 'CUSTOM',
                        label: 'Custom',
                        activeClass:
                          'bg-amber-500 border-amber-400 text-white shadow-md shadow-amber-500/30',
                        idleClass:
                          'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20',
                      },
                    ] as const
                  ).map(preset => {
                    const isActive = movementPeriod === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setMovementPeriod(preset.id)}
                        className={`py-2 rounded-lg border text-[11px] font-semibold transition active:scale-95 ${
                          isActive ? preset.activeClass : preset.idleClass
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                {movementPeriod === 'CUSTOM' && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">From</label>
                      <input
                        type="date"
                        value={movementStartDate}
                        onChange={e => setMovementStartDate(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white w-full focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">To</label>
                      <input
                        type="date"
                        value={movementEndDate}
                        onChange={e => setMovementEndDate(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white w-full focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-800/80">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search product, reason, user, or shop..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <select
                    value={movementTypeFilter}
                    onChange={e => setMovementTypeFilter(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="ALL">All Movement Types</option>
                    <option value="DAMAGED">💥 Damaged Stock</option>
                    <option value="BROKEN">🔨 Broken Stock</option>
                    <option value="EXPIRED">⏳ Expired Items</option>
                    <option value="LOST">🔍 Lost / Missing</option>
                    <option value="CORRECTION">⚖️ Count Corrections</option>
                    <option value="RESTOCK">📦 Restock Adjustments</option>
                    <option value="ADJUSTMENT">🔧 Manual Adjustments</option>
                    <option value="SALE">🛒 Sales (Decrements)</option>
                    <option value="PURCHASE">🚚 Purchases / Stock In</option>
                    <option value="RETURN">↩️ Returns / Restocks</option>
                  </select>
                </div>
              </div>

              {/* KPI Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Records</div>
                  <div className="text-base font-bold text-white font-mono tabular-nums mt-0.5">
                    {movements.length.toLocaleString()}
                  </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Added (+)</div>
                  <div className="text-base font-bold text-emerald-400 font-mono tabular-nums mt-0.5">
                    +{totalInUnits.toLocaleString()}
                  </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">
                    Deducted (-)
                  </div>
                  <div className="text-base font-bold text-rose-400 font-mono tabular-nums mt-0.5">
                    -{totalOutUnits.toLocaleString()}
                  </div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">
                    Cost Impact
                  </div>
                  <div className="text-sm font-bold text-purple-300 font-mono tabular-nums mt-0.5 truncate">
                    {formatCurrency(totalCostImpact, settings.currencySymbol)}
                  </div>
                </div>
              </div>

              {/* Movements List (Capped at 10 initially + See More / Expand by 10) */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                {movements.length === 0 ? (
                  <div className="py-12 text-center text-slate-500">
                    <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-xs">No movements found for this period and filter.</p>
                  </div>
                ) : (
                  <>
                    {/* Desktop Movements Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                            <th className="py-3 px-4 font-semibold">Timestamp</th>
                            <th className="py-3 px-4 font-semibold">Product</th>
                            <th className="py-3 px-4 font-semibold">Shop</th>
                            <th className="py-3 px-4 font-semibold">Type</th>
                            <th className="py-3 px-4 text-center font-semibold">Delta</th>
                            <th className="py-3 px-4 text-center font-semibold">Before</th>
                            <th className="py-3 px-4 text-center font-semibold">After</th>
                            <th className="py-3 px-4 text-right font-semibold">Cost Impact</th>
                            <th className="py-3 px-4 font-semibold">Reason</th>
                            <th className="py-3 px-4 font-semibold">User</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {visibleMovements.map(m => {
                            const isPositive = m.changeQty > 0;
                            const isLossType = ['DAMAGED', 'BROKEN', 'EXPIRED', 'LOST'].includes(
                              m.type
                            );
                            return (
                              <tr key={m.id} className="hover:bg-slate-850/60 transition">
                                <td className="py-3 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                                  {formatDateTime(m.createdAt)}
                                </td>
                                <td className="py-3 px-4 font-medium text-white">
                                  {m.productName}
                                </td>
                                <td className="py-3 px-4 text-slate-400 text-[11px]">
                                  {m.shopName || 'Shop'}
                                </td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      isLossType
                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                        : 'bg-slate-800 text-slate-300'
                                    }`}
                                  >
                                    {m.type}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-center font-mono font-bold">
                                  <span
                                    className={isPositive ? 'text-emerald-400' : 'text-rose-400'}
                                  >
                                    {isPositive ? `+${m.changeQty}` : m.changeQty}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-center font-mono text-slate-400">
                                  {m.previousQty}
                                </td>
                                <td className="py-3 px-4 text-center font-mono text-white font-semibold">
                                  {m.newQty}
                                </td>
                                <td
                                  className={`py-3 px-4 text-right font-mono font-semibold ${
                                    isLossType ? 'text-rose-400' : 'text-slate-300'
                                  }`}
                                >
                                  {m.costValue !== undefined
                                    ? formatCurrency(m.costValue, settings.currencySymbol)
                                    : '-'}
                                </td>
                                <td className="py-3 px-4 text-slate-400 max-w-xs truncate">
                                  {m.reason || '-'}
                                </td>
                                <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                                  {m.userName}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Movements Cards */}
                    <div className="md:hidden divide-y divide-slate-800/80">
                      {visibleMovements.map(m => {
                        const isPositive = m.changeQty > 0;
                        const isLossType = ['DAMAGED', 'BROKEN', 'EXPIRED', 'LOST'].includes(
                          m.type
                        );

                        return (
                          <div key={m.id} className="p-3.5 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <h4 className="font-bold text-xs text-white truncate">
                                  {m.productName}
                                </h4>
                                <p className="text-[10px] font-mono text-slate-400">
                                  {formatDateTime(m.createdAt)}
                                  {m.shopName ? ` · ${m.shopName}` : ''}
                                </p>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                  isLossType
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {m.type}
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-xs py-1">
                              <div className="text-slate-400 text-[11px]">
                                Qty:{' '}
                                <strong
                                  className={isPositive ? 'text-emerald-400' : 'text-rose-400'}
                                >
                                  {isPositive ? `+${m.changeQty}` : m.changeQty}
                                </strong>{' '}
                                ({m.previousQty} → {m.newQty})
                              </div>
                              {m.costValue !== undefined && (
                                <div
                                  className={`font-mono text-[11px] font-semibold ${
                                    isLossType ? 'text-rose-400' : 'text-slate-300'
                                  }`}
                                >
                                  {formatCurrency(m.costValue, settings.currencySymbol)}
                                </div>
                              )}
                            </div>

                            {m.reason && (
                              <p className="text-[11px] text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                                {m.reason}
                              </p>
                            )}
                            <div className="text-[10px] text-slate-500 text-right">
                              By {m.userName}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Expand / Pagination Footer (10 items per page) */}
                    {movements.length > PAGE_SIZE && (
                      <div className="p-3 sm:px-5 bg-slate-950/50 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="text-[10px] sm:text-[11px] text-slate-500 text-center sm:text-left">
                          Showing{' '}
                          <span className="text-slate-300 font-semibold">
                            {Math.min(movementsVisibleCount, movements.length)}
                          </span>{' '}
                          of{' '}
                          <span className="text-slate-300 font-semibold">{movements.length}</span>{' '}
                          movements
                        </div>
                        <div className="flex items-center gap-2">
                          {movementsVisibleCount > PAGE_SIZE && (
                            <button
                              type="button"
                              onClick={() => setMovementsVisibleCount(PAGE_SIZE)}
                              className="flex-1 sm:flex-none px-3 py-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition"
                            >
                              Show Less
                            </button>
                          )}
                          {remainingMovements > 0 && (
                            <button
                              type="button"
                              onClick={() => setMovementsVisibleCount(v => v + PAGE_SIZE)}
                              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold shadow transition"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                              <span>See More ({Math.min(PAGE_SIZE, remainingMovements)})</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* TAB 3: Loss Report */}
      {activeTab === 'losses' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-xs text-slate-400 shrink-0">Period:</span>
              <div className="flex gap-1 overflow-x-auto flex-1">
                {[
                  { id: 'today', label: 'Today' },
                  { id: 'week', label: 'Week' },
                  { id: 'month', label: 'Month' },
                  { id: 'all', label: 'All' },
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setLossPeriod(p.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                      lossPeriod === p.id
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-white active:bg-slate-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={lossTypeFilter}
                onChange={e => setLossTypeFilter(e.target.value)}
                className="flex-1 sm:flex-none bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
              >
                <option value="ALL">All Loss Types</option>
                <option value="DAMAGED">💥 Damaged</option>
                <option value="BROKEN">🔨 Broken</option>
                <option value="EXPIRED">⏳ Expired</option>
                <option value="LOST">🔍 Lost</option>
              </select>

              <button
                type="button"
                disabled={exportingKey !== null}
                onClick={handlePrintLossReport}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/35 text-indigo-300 hover:text-white disabled:opacity-50 text-xs font-semibold transition shrink-0"
              >
                {exportingKey === 'loss:print' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Printer className="w-3.5 h-3.5" />
                )}
                <span>Print</span>
              </button>

              <button
                type="button"
                disabled={exportingKey !== null}
                onClick={handleDownloadLossReport}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold transition shrink-0"
              >
                {exportingKey === 'loss:pdf' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>Download PDF</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
            <div className="p-3 sm:p-4 bg-slate-900 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] sm:text-xs text-slate-400 uppercase block mb-1">
                Loss Value
              </span>
              <span className="text-sm sm:text-xl font-bold text-rose-400 font-mono truncate block">
                {formatCurrency(totalLossValue, settings.currencySymbol)}
              </span>
            </div>
            <div className="p-3 sm:p-4 bg-slate-900 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] sm:text-xs text-slate-400 uppercase block mb-1">
                Units
              </span>
              <span className="text-sm sm:text-xl font-bold text-amber-400 font-mono">
                {totalLossUnits}
              </span>
            </div>
            <div className="p-3 sm:p-4 bg-slate-900 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] sm:text-xs text-slate-400 uppercase block mb-1">
                Records
              </span>
              <span className="text-sm sm:text-xl font-bold text-purple-400 font-mono">
                {filteredLosses.length}
              </span>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            {filteredLosses.length === 0 ? (
              <div className="py-12 text-center text-slate-500">
                <PackageX className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-xs sm:text-sm">No loss records for this period.</p>
              </div>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                        <th className="py-3 px-4 font-semibold">Date</th>
                        <th className="py-3 px-4 font-semibold">Product</th>
                        <th className="py-3 px-4 font-semibold">Type</th>
                        <th className="py-3 px-4 text-center font-semibold">Qty Lost</th>
                        <th className="py-3 px-4 text-right font-semibold">Loss Value</th>
                        <th className="py-3 px-4 font-semibold">Reason</th>
                        <th className="py-3 px-4 font-semibold">Recorded By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filteredLosses.map(m => (
                        <tr key={m.id} className="hover:bg-slate-850/60 transition">
                          <td className="py-3 px-4 font-mono text-slate-400 text-[11px] whitespace-nowrap">
                            {formatDateTime(m.createdAt)}
                          </td>
                          <td className="py-3 px-4 font-semibold text-white">{m.productName}</td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] font-bold">
                              {m.type}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center font-mono font-bold text-rose-400">
                            {Math.abs(m.changeQty)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-rose-400">
                            {formatCurrency(m.costValue || 0, settings.currencySymbol)}
                          </td>
                          <td className="py-3 px-4 text-slate-400 max-w-xs truncate">
                            {m.reason || '-'}
                          </td>
                          <td className="py-3 px-4 text-slate-400">{m.userName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden divide-y divide-slate-800/80">
                  {filteredLosses.map(m => (
                    <div key={m.id} className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-xs text-white truncate">{m.productName}</h4>
                          <p className="text-[10px] font-mono text-slate-400">
                            {formatDateTime(m.createdAt)}
                          </p>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] font-bold shrink-0">
                          {m.type}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs pt-1">
                        <span className="text-slate-400 text-[11px]">
                          Qty Lost:{' '}
                          <strong className="text-rose-400 font-mono">
                            {Math.abs(m.changeQty)}
                          </strong>
                        </span>
                        <span className="font-mono font-bold text-rose-400 text-xs">
                          {formatCurrency(m.costValue || 0, settings.currencySymbol)}
                        </span>
                      </div>
                      {m.reason && (
                        <p className="text-[11px] text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                          {m.reason}
                        </p>
                      )}
                      <div className="text-[10px] text-slate-500 text-right">By {m.userName}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Manual Stock Adjustment Modal */}
      {isAdjustModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Stock Adjustment</h3>
              </div>
              <button
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                {modalError}
              </div>
            )}

            <form onSubmit={handleAdjustStock} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Select Product *</label>
                <select
                  value={selectedProductId}
                  onChange={e => handleSelectAdjustProduct(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Choose Product --</option>
                  {visibleProducts.map(p => {
                    const sQty = getProductStoreQty(p);
                    const hasStore = hasAssignedWarehouseStore(p);
                    const stockSummary = hasStore
                      ? `Shop: ${p.currentStock}, Store: ${sQty} ${p.unit}`
                      : `Current: ${p.currentStock} ${p.unit}`;
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.variation ? ` (${p.variation})` : ''} — {stockSummary}
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedProduct && selectedProductLocations.length > 1 && (
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Adjustment Location *
                  </label>
                  <select
                    id="stock-adjust-location-select"
                    value={selectedAdjustLocationKey}
                    onChange={e => {
                      setSelectedAdjustLocationKey(e.target.value);
                      setModalError('');
                    }}
                    required
                    className="w-full bg-slate-950 border border-blue-500/40 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">-- Select Location --</option>
                    {selectedProductLocations.map(loc => (
                      <option key={loc.key} value={loc.key}>
                        {loc.label} (Current: {loc.currentQty} {selectedProduct.unit})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">
                    This product exists in {selectedProductLocations.length} locations. Select which
                    location to adjust.
                  </p>
                </div>
              )}

              {selectedProduct && selectedAdjustLocation && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px]">
                  <span className="text-slate-400">
                    Current Stock ({selectedAdjustLocation.shortLabel}):
                  </span>
                  <span className="font-mono font-bold text-white">
                    {selectedAdjustLocation.currentQty} {selectedProduct.unit}
                  </span>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Adjustment Reason Category *
                </label>
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
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                  <button
                    type="button"
                    onClick={() => setAdjustmentType('IN')}
                    className={`py-2.5 rounded-lg font-semibold transition text-[11px] ${
                      adjustmentType === 'IN'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-950 text-slate-400 border border-slate-800 active:bg-slate-800'
                    }`}
                  >
                    + Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustmentType('OUT')}
                    className={`py-2.5 rounded-lg font-semibold transition text-[11px] ${
                      adjustmentType === 'OUT'
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-950 text-slate-400 border border-slate-800 active:bg-slate-800'
                    }`}
                  >
                    − Deduct
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustmentType('SET')}
                    className={`py-2.5 rounded-lg font-semibold transition text-[11px] ${
                      adjustmentType === 'SET'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-950 text-slate-400 border border-slate-800 active:bg-slate-800'
                    }`}
                  >
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
                  inputMode="numeric"
                  min="0"
                  required
                  value={quantityInput}
                  onChange={e => setQuantityInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {selectedProduct && adjustmentType === 'OUT' && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs space-y-1">
                  <div className="flex justify-between text-rose-300 font-medium">
                    <span>Estimated Loss:</span>
                    <span className="font-bold font-mono">
                      {formatCurrency(calculatedLossValue, settings.currencySymbol)}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    At cost {formatCurrency(selectedProduct.purchasePrice, settings.currencySymbol)}
                    /unit
                  </p>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-medium mb-1">Notes (Optional)</label>
                <textarea
                  rows={2}
                  value={reasonInput}
                  onChange={e => setReasonInput(e.target.value)}
                  placeholder="e.g. Broken in shipment..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow transition"
                >
                  Apply Adjustment
                </button>
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
