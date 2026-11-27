import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Warehouse,
  ArrowRightLeft,
  Plus,
  MapPin,
  Store as StoreIcon,
  AlertCircle,
  CheckCircle2,
  Package,
  Search,
  Edit3,
  Trash2,
  AlertTriangle,
  X,
  Layers,
  Tag,
  History,
  Eye,
  Upload,
  Download,
  FileSpreadsheet,
  RefreshCw,
  MoreVertical,
  ChevronDown,
  ChevronRight,
  Calendar,
  Printer,
  ArrowLeft,
  ClipboardList,
  Truck,
  FileText,
  Boxes,
  Loader2,
} from 'lucide-react';
import { useApp, StoresSubTab } from '../../context/AppContext';
import { StoreService } from '../../services/storeService';
import { ProductService } from '../../services/productService';
import { db } from '../../db/storage';
import { generateUUID } from '../../utils/crypto';
import {
  ExcelImportService,
  ExcelParseResult,
  ImportProgressInfo,
} from '../../services/excelImportService';
import { ImportProgressBar } from '../common/ImportProgressBar';
import { ExcelExportService } from '../../services/excelExportService';
import { formatCurrency } from '../../utils/formatters';
import {
  downloadStockTransferVoucher,
  printStockTransferVoucher,
} from '../../utils/transferPrint';
import {
  getAdminManagedShops,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../../utils/permissions';
import type {
  InventoryMovement,
  Product,
  ProductStoreStockDetail,
  StockTransfer,
  StockTransferLocationType,
  StockTransferStatus,
  Store,
} from '../../types';

const STORE_PAGE_SIZE = 15;

export type TransferDatePreset = 'TODAY' | 'WEEKLY' | 'MONTH' | 'CUSTOM';

export const formatDateYMD = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const computeTransferDatePresetRange = (
  preset: TransferDatePreset,
  now: Date = new Date()
): { start: string; end: string } | null => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (preset === 'TODAY') {
    return { start: formatDateYMD(today), end: formatDateYMD(today) };
  }
  if (preset === 'WEEKLY') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start: formatDateYMD(start), end: formatDateYMD(today) };
  }
  if (preset === 'MONTH') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: formatDateYMD(start), end: formatDateYMD(today) };
  }
  return null;
};

export const isYMDInDateRange = (
  ymd: string,
  startYMD: string,
  endYMD: string
): boolean => {
  const clean = (ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return false;
  if (startYMD && clean < startYMD) return false;
  if (endYMD && clean > endYMD) return false;
  return true;
};

export const encodeLocationKey = (
  type: StockTransferLocationType,
  id: string
): string => `${type}:${id}`;

export const decodeLocationKey = (
  key: string
): { type: StockTransferLocationType; id: string } | null => {
  if (!key || !key.includes(':')) return null;
  const sep = key.indexOf(':');
  const rawType = key.slice(0, sep);
  const id = key.slice(sep + 1);
  if ((rawType === 'STORE' || rawType === 'SHOP') && id) {
    return { type: rawType, id };
  }
  return null;
};

export const AdminStores: React.FC = () => {
  const {
    currentUser,
    dbState,
    addToast,
    selectedShopId,
    refreshStoresFromCloud,
    storesSubTab: activeSubTab,
    setStoresSubTab: setActiveSubTab,
    storesNavTick,
  } = useApp();

  const [isRefreshingStores, setIsRefreshingStores] = useState(false);
  const lastHandledNavTickRef = useRef<number>(storesNavTick);

  // Create Store Modal / Form state
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [storeName, setStoreName] = useState('');
  const [storeLocation, setStoreLocation] = useState('');
  const [storeShopId, setStoreShopId] = useState('');
  const [storeFormError, setStoreFormError] = useState('');

  // Store filter
  const [shopFilter, setShopFilter] = useState('ALL');
  const [storeSearch, setStoreSearch] = useState('');

  // Store Inventory Browser state (grouped by store, 15 per store + See More)
  const [selectedInventoryStoreId, setSelectedInventoryStoreId] = useState('ALL_COMBINED');
  const [invSearch, setInvSearch] = useState('');
  const [invCategoryFilter, setInvCategoryFilter] = useState('ALL');
  const [invStockedOnly, setInvStockedOnly] = useState(true);
  const [invVisibleCounts, setInvVisibleCounts] = useState<Record<string, number>>({});
  const [collapsedInvStores, setCollapsedInvStores] = useState<Record<string, boolean>>({});

  // Full-Page Stock Transfer Form state (Store->Shop, Store->Store same shop, Shop->Store)
  const [editingTransferId, setEditingTransferId] = useState<string | null>(null);
  const [transferDate, setTransferDate] = useState(() => formatDateYMD(new Date()));
  const [sourceLocationKey, setSourceLocationKey] = useState('');
  const [destLocationKey, setDestLocationKey] = useState('');
  const [selectedTransferMap, setSelectedTransferMap] = useState<Record<string, string>>({});
  const [selectedTransferOrder, setSelectedTransferOrder] = useState<string[]>([]);
  const [selectedPriceMap, setSelectedPriceMap] = useState<Record<string, string>>({});
  const [productSearch, setProductSearch] = useState('');
  const [transferVisibleLimit, setTransferVisibleLimit] = useState(STORE_PAGE_SIZE);
  const [selectedQueueFilter, setSelectedQueueFilter] = useState('');
  const [selectedQueueVisibleLimit, setSelectedQueueVisibleLimit] = useState(STORE_PAGE_SIZE);
  const [shippingCharges, setShippingCharges] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferStatus, setTransferStatus] = useState<StockTransferStatus>('COMPLETED');
  const [transferError, setTransferError] = useState('');
  const [transferProgressPct, setTransferProgressPct] = useState<number | null>(null);
  const transferProductSearchRef = useRef<HTMLInputElement>(null);

  // Transferred List full-page state (Today / Weekly / Month / Custom)
  const [transferDatePreset, setTransferDatePreset] = useState<TransferDatePreset>('TODAY');
  const [transferStartDate, setTransferStartDate] = useState(() => formatDateYMD(new Date()));
  const [transferEndDate, setTransferEndDate] = useState(() => formatDateYMD(new Date()));
  const [listLocationFilter, setListLocationFilter] = useState('ALL');
  const [listSearchQuery, setListSearchQuery] = useState('');
  const [listVisibleLimit, setListVisibleLimit] = useState(STORE_PAGE_SIZE);
  const [viewingTransferId, setViewingTransferId] = useState<string | null>(null);
  const [deletingTransfer, setDeletingTransfer] = useState<StockTransfer | null>(null);
  const [printingTransferId, setPrintingTransferId] = useState<string | null>(null);
  const [downloadingTransferId, setDownloadingTransferId] = useState<string | null>(null);

  const handlePrintTransfer = async (transfer: StockTransfer) => {
    if (printingTransferId) return;
    setPrintingTransferId(transfer.id);
    try {
      const res = await printStockTransferVoucher(transfer, settings);
      addToast(
        res.ok
          ? {
              type: 'success',
              title:
                res.mode === 'fallback_download'
                  ? 'Opened Transfer Voucher PDF'
                  : 'Print Dialog Opened',
              description:
                res.mode === 'fallback_download'
                  ? 'Use the printer option in your PDF viewer to print.'
                  : `Ready to print ${transfer.transferNumber}.`,
            }
          : {
              type: 'error',
              title: 'Print Failed',
              description: res.error || 'Could not open print dialog on this device.',
            }
      );
    } finally {
      setPrintingTransferId(null);
    }
  };

  const handleDownloadTransfer = async (transfer: StockTransfer) => {
    if (downloadingTransferId) return;
    setDownloadingTransferId(transfer.id);
    try {
      const ok = await downloadStockTransferVoucher(transfer, settings);
      addToast(
        ok
          ? {
              type: 'success',
              title: 'Transfer PDF Downloaded',
              description: `Saved stock_transfer_${transfer.transferNumber}.pdf to Downloads.`,
            }
          : {
              type: 'error',
              title: 'PDF Export Failed',
              description: 'Could not save transfer voucher PDF on this device.',
            }
      );
    } finally {
      setDownloadingTransferId(null);
    }
  };

  // Store Excel Import Modal state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importTargetStoreId, setImportTargetStoreId] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importParseResult, setImportParseResult] = useState<ExcelParseResult | null>(null);
  const [isParsingImport, setIsParsingImport] = useState(false);
  const [isCommittingImport, setIsCommittingImport] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressInfo | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  // Store Delete Confirmation state
  const [deletingStore, setDeletingStore] = useState<Store | null>(null);

  // Store Inventory Product Click / Press-and-Hold Action Menu state
  const [actionProduct, setActionProduct] = useState<Product | null>(null);
  const [actionStoreContext, setActionStoreContext] = useState<Store | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editProdName, setEditProdName] = useState('');
  const [editProdVariation, setEditProdVariation] = useState('');
  const [editProdSku, setEditProdSku] = useState('');
  const [editProdCategoryId, setEditProdCategoryId] = useState('');
  const [editProdPurchasePrice, setEditProdPurchasePrice] = useState('');
  const [editProdSellingPrice, setEditProdSellingPrice] = useState('');
  const [editProdUnit, setEditProdUnit] = useState('pcs');
  const [editProdMinStock, setEditProdMinStock] = useState('0');
  const [editProdFloorStock, setEditProdFloorStock] = useState('0');
  const [editProdStoreQtys, setEditProdStoreQtys] = useState<Record<string, string>>({});
  const [editProdError, setEditProdError] = useState('');
  const [isSavingProductEdit, setIsSavingProductEdit] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);

  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const transferDateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (transferDatePreset === 'CUSTOM') return;
    const range = computeTransferDatePresetRange(transferDatePreset);
    if (range) {
      setTransferStartDate(range.start);
      setTransferEndDate(range.end);
    }
  }, [transferDatePreset]);

  useEffect(() => {
    setInvVisibleCounts({});
  }, [invSearch, invCategoryFilter, selectedInventoryStoreId, invStockedOnly]);

  useEffect(() => {
    setListVisibleLimit(STORE_PAGE_SIZE);
  }, [transferDatePreset, transferStartDate, transferEndDate, listLocationFilter, listSearchQuery]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    setIsRefreshingStores(true);
    refreshStoresFromCloud(false)
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsRefreshingStores(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const handleManualRefreshStores = async () => {
    if (isRefreshingStores) return;
    setIsRefreshingStores(true);
    try {
      const res = await refreshStoresFromCloud(true);
      if (!res.success && res.error) {
        addToast({
          type: 'warning',
          title: 'Refresh Notice',
          description: res.error,
        });
      }
    } finally {
      setIsRefreshingStores(false);
    }
  };

  const settings = dbState.settings;
  const platformAdmin = isPlatformAdmin(currentUser);
  const shopAdmin = isShopAdmin(currentUser);
  const allShops = dbState.shops || [];

  const accessibleShops = useMemo(() => {
    return platformAdmin
      ? allShops
      : shopAdmin
        ? getAdminManagedShops(currentUser, allShops)
        : [];
  }, [allShops, currentUser, platformAdmin, shopAdmin]);

  const accessibleShopIdSet = useMemo(
    () => new Set(accessibleShops.map(s => s.id)),
    [accessibleShops]
  );

  const accessibleStores = useMemo(() => {
    return (dbState.stores || []).filter(
      st => platformAdmin || accessibleShopIdSet.has(st.shopId)
    );
  }, [dbState.stores, platformAdmin, accessibleShopIdSet]);

  const activeStores = useMemo(
    () => accessibleStores.filter(st => st.status === 'ACTIVE'),
    [accessibleStores]
  );

  const transferableStores = useMemo(
    () => activeStores.filter(st => !st.isShopFloor),
    [activeStores]
  );

  const accessibleCategories = useMemo(
    () =>
      (dbState.categories || []).filter(
        c => platformAdmin || accessibleShopIdSet.has(c.shopId)
      ),
    [dbState.categories, platformAdmin, accessibleShopIdSet]
  );

  const accessibleProducts = useMemo(
    () =>
      (dbState.products || []).filter(
        p => p.status !== 'INACTIVE' && (platformAdmin || accessibleShopIdSet.has(p.shopId))
      ),
    [dbState.products, platformAdmin, accessibleShopIdSet]
  );

  const productStoreQtyCache = useMemo(() => {
    const qtyMap = new Map<string, Record<string, number>>();
    let hasFallbackMultiStoreAttribution = false;

    const storesByShop = new Map<string, Store[]>();
    for (const st of accessibleStores) {
      const arr = storesByShop.get(st.shopId) || [];
      arr.push(st);
      storesByShop.set(st.shopId, arr);
    }

    const movementWeightsByProd = new Map<string, Map<string, number>>();
    for (const m of dbState.movements || []) {
      if (!m.productId || !m.storeId) continue;
      if (m.type === 'STORE_TRANSFER' || m.type === 'INITIAL_STOCK' || m.type === 'PURCHASE') {
        const delta = Math.abs(Number(m.newQty ?? m.changeQty ?? 0)) || 1;
        let storeMap = movementWeightsByProd.get(m.productId);
        if (!storeMap) {
          storeMap = new Map<string, number>();
          movementWeightsByProd.set(m.productId, storeMap);
        }
        storeMap.set(m.storeId, (storeMap.get(m.storeId) || 0) + delta);
      }
    }

    for (const pur of dbState.purchases || []) {
      if (!pur.storeId) continue;
      for (const item of pur.items || []) {
        if (!item.productId) continue;
        let storeMap = movementWeightsByProd.get(item.productId);
        if (!storeMap) {
          storeMap = new Map<string, number>();
          movementWeightsByProd.set(item.productId, storeMap);
        }
        storeMap.set(
          pur.storeId,
          (storeMap.get(pur.storeId) || 0) + Math.max(1, Number(item.quantity || 1))
        );
      }
    }

    for (const product of accessibleProducts) {
      const shopStores = storesByShop.get(product.shopId) || [];
      const shopStoreIds = new Set(shopStores.map(s => s.id));
      const floorStores = shopStores.filter(s => s.isShopFloor);
      const floorSet = new Set(floorStores.map(s => s.id));
      const warehouseStores = shopStores
        .filter(s => !s.isShopFloor)
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
          return (a.createdAt || '').localeCompare(b.createdAt || '');
        });

      const qtyByStore: Record<string, number> = {};

      // 1. Floor stores
      for (const fl of floorStores) {
        qtyByStore[fl.id] =
          product.storeStocks && product.storeStocks[fl.id] !== undefined
            ? Math.max(0, Number(product.storeStocks[fl.id] || 0))
            : Math.max(0, Number(product.currentStock || 0));
      }

      // 2. Explicit valid per-store stock mappings for this shop
      if (product.storeStocks) {
        for (const [sid, qty] of Object.entries(product.storeStocks)) {
          if (shopStoreIds.has(sid) && !floorSet.has(sid)) {
            qtyByStore[sid] = Math.max(0, Number(qty || 0));
          }
        }
      }

      // 3. Recover legacy / cloud-synced products that have aggregate storeStock > 0 without per-store breakdown
      const mappedWarehouseSum = warehouseStores.reduce(
        (sum, s) => sum + (qtyByStore[s.id] || 0),
        0
      );
      const rawStoreStock = Math.max(0, Number(product.storeStock || 0));

      if (mappedWarehouseSum === 0 && rawStoreStock > 0 && warehouseStores.length > 0) {
        const warehouseIdSet = new Set(warehouseStores.map(s => s.id));

        if (product.storeId && warehouseIdSet.has(product.storeId)) {
          qtyByStore[product.storeId] = rawStoreStock;
        } else {
          const weights = movementWeightsByProd.get(product.id);
          const matchedWeights: { storeId: string; weight: number }[] = [];
          if (weights) {
            for (const ws of warehouseStores) {
              const w = weights.get(ws.id) || 0;
              if (w > 0) matchedWeights.push({ storeId: ws.id, weight: w });
            }
          }

          if (matchedWeights.length === 1) {
            qtyByStore[matchedWeights[0].storeId] = rawStoreStock;
          } else if (matchedWeights.length > 1) {
            const totalW = matchedWeights.reduce((s, e) => s + e.weight, 0);
            let allocated = 0;
            matchedWeights.sort((a, b) => b.weight - a.weight);
            matchedWeights.forEach((entry, idx) => {
              if (idx === matchedWeights.length - 1) {
                qtyByStore[entry.storeId] = Math.max(0, rawStoreStock - allocated);
              } else {
                const share = Math.round((rawStoreStock * entry.weight) / totalW);
                qtyByStore[entry.storeId] = share;
                allocated += share;
              }
            });
          } else {
            qtyByStore[warehouseStores[0].id] = rawStoreStock;
            if (warehouseStores.length > 1) {
              hasFallbackMultiStoreAttribution = true;
            }
          }
        }
      }

      qtyMap.set(product.id, qtyByStore);
    }

    return { qtyMap, hasFallbackMultiStoreAttribution };
  }, [accessibleProducts, accessibleStores, dbState.movements, dbState.purchases]);

  const getProductQtyInStore = (product: Product, store: Store): number => {
    const cached = productStoreQtyCache.qtyMap.get(product.id);
    if (cached && cached[store.id] !== undefined) {
      return cached[store.id];
    }
    if (product.storeStocks && product.storeStocks[store.id] !== undefined) {
      return Number(product.storeStocks[store.id] || 0);
    }
    if (store.isShopFloor) {
      return Number(product.currentStock || 0);
    }
    return 0;
  };

  const getProductTotalTrackedUnits = (product: Product): number => {
    const shopStores = accessibleStores.filter(st => st.shopId === product.shopId);
    if (shopStores.length > 0) {
      const storeSum = shopStores.reduce(
        (sum, st) => sum + getProductQtyInStore(product, st),
        0
      );
      const hasFloorStore = shopStores.some(st => st.isShopFloor);
      return hasFloorStore ? storeSum : storeSum + Number(product.currentStock || 0);
    }
    return Number(product.currentStock || 0) + Number(product.storeStock || 0);
  };

  const filteredStores = useMemo(() => {
    return accessibleStores.filter(st => {
      if (shopFilter !== 'ALL' && st.shopId !== shopFilter) return false;
      if (storeSearch.trim()) {
        const q = storeSearch.trim().toLowerCase();
        const shopName = accessibleShops.find(s => s.id === st.shopId)?.name.toLowerCase() || '';
        return (
          st.name.toLowerCase().includes(q) ||
          (st.location || '').toLowerCase().includes(q) ||
          shopName.includes(q)
        );
      }
      return true;
    });
  }, [accessibleStores, shopFilter, storeSearch, accessibleShops]);

  const activeShops = useMemo(
    () => accessibleShops.filter(s => s.status === 'ACTIVE'),
    [accessibleShops]
  );

  // Source Location options: active warehouse stores + active shop floors (supports Store->Shop, Store->Store, Shop->Store)
  const sourceLocationOptions = useMemo(() => {
    const opts: {
      key: string;
      type: StockTransferLocationType;
      id: string;
      shopId: string;
      label: string;
      name: string;
      location?: string;
    }[] = [];

    for (const st of transferableStores) {
      const sh = accessibleShops.find(s => s.id === st.shopId);
      opts.push({
        key: encodeLocationKey('STORE', st.id),
        type: 'STORE',
        id: st.id,
        shopId: st.shopId,
        name: st.name,
        location: st.location || sh?.address || sh?.name,
        label: `Store: ${st.name} (${sh?.name || 'Shop'}${st.location ? ` · ${st.location}` : ''})`,
      });
    }

    for (const sh of activeShops) {
      if (transferableStores.some(st => st.shopId === sh.id) || activeShops.length > 1) {
        opts.push({
          key: encodeLocationKey('SHOP', sh.id),
          type: 'SHOP',
          id: sh.id,
          shopId: sh.id,
          name: `${sh.name} (Shop Floor)`,
          location: sh.address || sh.name,
          label: `Shop Floor: ${sh.name}${sh.address ? ` · ${sh.address}` : ''}`,
        });
      }
    }

    return opts;
  }, [transferableStores, accessibleShops, activeShops]);

  const effectiveSourceLocationKey =
    sourceLocationKey && sourceLocationOptions.some(o => o.key === sourceLocationKey)
      ? sourceLocationKey
      : '';

  const selectedSourceLocation = useMemo(
    () => sourceLocationOptions.find(o => o.key === effectiveSourceLocationKey),
    [sourceLocationOptions, effectiveSourceLocationKey]
  );

  const selectedSourceStore = useMemo(
    () =>
      selectedSourceLocation?.type === 'STORE'
        ? transferableStores.find(s => s.id === selectedSourceLocation.id)
        : undefined,
    [selectedSourceLocation, transferableStores]
  );

  // Destination Location options based on selected Location Source:
  // - If Source is STORE -> allows SHOP (same shop first, or other active shops) OR another STORE in SAME shop
  // - If Source is SHOP  -> allows STORE in SAME shop
  const destLocationOptions = useMemo(() => {
    if (!selectedSourceLocation) return [];
    const opts: {
      key: string;
      type: StockTransferLocationType;
      id: string;
      shopId: string;
      label: string;
      groupLabel: string;
      name: string;
      location?: string;
    }[] = [];

    if (selectedSourceLocation.type === 'STORE') {
      const sortedShops = [...activeShops].sort((a, b) => {
        if (a.id === selectedSourceLocation.shopId) return -1;
        if (b.id === selectedSourceLocation.shopId) return 1;
        return a.name.localeCompare(b.name);
      });
      for (const sh of sortedShops) {
        opts.push({
          key: encodeLocationKey('SHOP', sh.id),
          type: 'SHOP',
          id: sh.id,
          shopId: sh.id,
          name: `${sh.name} (Shop Floor)`,
          location: sh.address || sh.name,
          groupLabel: 'Shop Floor (Store → Shop)',
          label: `Shop: ${sh.name}${sh.id === selectedSourceLocation.shopId ? ' (Same Shop Floor)' : ''}${sh.address ? ` · ${sh.address}` : ''}`,
        });
      }

      const sameShopOtherStores = transferableStores.filter(
        st => st.shopId === selectedSourceLocation.shopId && st.id !== selectedSourceLocation.id
      );
      for (const st of sameShopOtherStores) {
        const sh = accessibleShops.find(s => s.id === st.shopId);
        opts.push({
          key: encodeLocationKey('STORE', st.id),
          type: 'STORE',
          id: st.id,
          shopId: st.shopId,
          name: st.name,
          location: st.location || sh?.address || sh?.name,
          groupLabel: 'Store in Same Shop (Store → Store)',
          label: `Store: ${st.name} (${sh?.name || 'Shop'}${st.location ? ` · ${st.location}` : ''})`,
        });
      }
    } else {
      const sameShopStores = transferableStores.filter(
        st => st.shopId === selectedSourceLocation.shopId
      );
      for (const st of sameShopStores) {
        const sh = accessibleShops.find(s => s.id === st.shopId);
        opts.push({
          key: encodeLocationKey('STORE', st.id),
          type: 'STORE',
          id: st.id,
          shopId: st.shopId,
          name: st.name,
          location: st.location || sh?.address || sh?.name,
          groupLabel: 'Warehouse Store (Shop → Store)',
          label: `Store: ${st.name} (${sh?.name || 'Shop'}${st.location ? ` · ${st.location}` : ''})`,
        });
      }

      const otherShops = activeShops
        .filter(sh => sh.id !== selectedSourceLocation.shopId)
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const sh of otherShops) {
        opts.push({
          key: encodeLocationKey('SHOP', sh.id),
          type: 'SHOP',
          id: sh.id,
          shopId: sh.id,
          name: `${sh.name} (Shop Floor)`,
          location: sh.address || sh.name,
          groupLabel: 'Other Shop Floor (Shop → Shop)',
          label: `Shop: ${sh.name}${sh.address ? ` · ${sh.address}` : ''}`,
        });
      }
    }

    return opts;
  }, [selectedSourceLocation, activeShops, transferableStores, accessibleShops]);

  const effectiveDestLocationKey =
    destLocationKey && destLocationOptions.some(o => o.key === destLocationKey)
      ? destLocationKey
      : '';

  const selectedDestLocation = useMemo(
    () => destLocationOptions.find(o => o.key === effectiveDestLocationKey),
    [destLocationOptions, effectiveDestLocationKey]
  );

  const productByIdMap = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of accessibleProducts) {
      map.set(p.id, p);
    }
    return map;
  }, [accessibleProducts]);

  const editingTransferRecord = useMemo(
    () =>
      editingTransferId
        ? (dbState.stockTransfers || []).find(t => t.id === editingTransferId)
        : undefined,
    [editingTransferId, dbState.stockTransfers]
  );

  // Available quantity at current Location Source (includes qty already held by editingTransferRecord if COMPLETED & same source)
  const getSourceAvailableQty = (product: Product): number => {
    if (!selectedSourceLocation) return 0;
    let baseAvail = 0;
    if (selectedSourceLocation.type === 'STORE' && selectedSourceStore) {
      baseAvail = getProductQtyInStore(product, selectedSourceStore);
    } else if (selectedSourceLocation.type === 'SHOP') {
      baseAvail = Math.max(0, Number(product.currentStock || 0));
    }

    if (
      editingTransferRecord &&
      editingTransferRecord.status === 'COMPLETED' &&
      editingTransferRecord.sourceType === selectedSourceLocation.type &&
      editingTransferRecord.sourceId === selectedSourceLocation.id
    ) {
      const prevItem = editingTransferRecord.items.find(it => it.productId === product.id);
      if (prevItem) {
        baseAvail += Number(prevItem.quantity || 0);
      }
    }
    return baseAvail;
  };

  // Search-only products actually in the selected Location From, plus info on matching products stored elsewhere
  const { storeScopedProducts, otherLocationSearchMatches } = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q || !selectedSourceLocation) {
      return {
        storeScopedProducts: [] as Product[],
        otherLocationSearchMatches: [] as {
          product: Product;
          stockedLocations: { label: string; qty: number; type: StockTransferLocationType }[];
          zeroLocations: string[];
          isOtherShop?: boolean;
          shopName?: string;
        }[],
      };
    }
    const tokens = q.split(/\s+/).filter(Boolean);

    const matchesQuery = (p: Product): boolean => {
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
      return tokens.every(t => hay.includes(t));
    };

    const inSource: Product[] = [];
    const sameShopElsewhere: {
      product: Product;
      stockedLocations: { label: string; qty: number; type: StockTransferLocationType }[];
      zeroLocations: string[];
      isOtherShop?: boolean;
      shopName?: string;
    }[] = [];
    const otherShopMatches: {
      product: Product;
      stockedLocations: { label: string; qty: number; type: StockTransferLocationType }[];
      zeroLocations: string[];
      isOtherShop?: boolean;
      shopName?: string;
    }[] = [];

    const collectOtherLocations = (p: Product) => {
      const stockedLocations: { label: string; qty: number; type: StockTransferLocationType }[] = [];
      const zeroLocations: string[] = [];
      const prodShop = accessibleShops.find(s => s.id === p.shopId);
      const shopLabel = prodShop ? `Shop (${prodShop.name})` : 'Shop';
      const isSameShop = p.shopId === selectedSourceLocation.shopId;

      if (!(isSameShop && selectedSourceLocation.type === 'SHOP')) {
        const floorQty = Math.max(0, Number(p.currentStock || 0));
        if (floorQty > 0) {
          stockedLocations.push({ label: shopLabel, qty: floorQty, type: 'SHOP' });
        }
      }

      const prodShopStores = transferableStores.filter(st => st.shopId === p.shopId);
      for (const st of prodShopStores) {
        if (isSameShop && selectedSourceLocation.type === 'STORE' && selectedSourceLocation.id === st.id) {
          continue;
        }
        const stQty = getProductQtyInStore(p, st);
        if (stQty > 0) {
          stockedLocations.push({ label: st.name, qty: stQty, type: 'STORE' });
        } else if (
          p.storeId === st.id ||
          Boolean(p.storeDetails?.[st.id]) ||
          (p.storeStocks && st.id in p.storeStocks)
        ) {
          zeroLocations.push(st.name);
        }
      }

      if (
        stockedLocations.length === 0 &&
        zeroLocations.length === 0 &&
        !(isSameShop && selectedSourceLocation.type === 'SHOP')
      ) {
        zeroLocations.push(shopLabel);
      }

      return { stockedLocations, zeroLocations, shopName: prodShop?.name };
    };

    for (const p of accessibleProducts) {
      if (!matchesQuery(p)) continue;

      if (p.shopId === selectedSourceLocation.shopId) {
        const qtyHere = getSourceAvailableQty(p);
        if (qtyHere > 0) {
          inSource.push(p);
        } else {
          const info = collectOtherLocations(p);
          sameShopElsewhere.push({
            product: p,
            stockedLocations: info.stockedLocations,
            zeroLocations: info.zeroLocations,
          });
        }
      } else {
        const info = collectOtherLocations(p);
        otherShopMatches.push({
          product: p,
          stockedLocations: info.stockedLocations,
          zeroLocations: info.zeroLocations,
          isOtherShop: true,
          shopName: info.shopName,
        });
      }
    }

    inSource.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 1 : 0;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
      const aQty = getSourceAvailableQty(a);
      const bQty = getSourceAvailableQty(b);
      if (bQty !== aQty) return bQty - aQty;
      return a.name.localeCompare(b.name);
    });

    const elsewhere = (sameShopElsewhere.length > 0 ? sameShopElsewhere : otherShopMatches).sort(
      (a, b) => {
        const aHasStock = a.stockedLocations.length > 0 ? 1 : 0;
        const bHasStock = b.stockedLocations.length > 0 ? 1 : 0;
        if (aHasStock !== bHasStock) return bHasStock - aHasStock;
        return a.product.name.localeCompare(b.product.name);
      }
    );

    return {
      storeScopedProducts: inSource,
      otherLocationSearchMatches: elsewhere,
    };
  }, [
    accessibleProducts,
    accessibleShops,
    selectedSourceLocation,
    selectedSourceStore,
    transferableStores,
    productSearch,
    productStoreQtyCache,
    editingTransferRecord,
  ]);

  const selectedTransferEntries = useMemo(() => {
    const entries: {
      product: Product;
      qtyStr: string;
      parsedQty: number;
      priceStr: string;
      parsedPrice: number;
      subtotal: number;
      available: number;
      isInvalidQty: boolean;
      isExceeding: boolean;
      isInvalidPrice: boolean;
    }[] = [];

    const orderSet = new Set(selectedTransferOrder);
    const orderedIds = [
      ...selectedTransferOrder.filter(id => id in selectedTransferMap),
      ...Object.keys(selectedTransferMap).filter(id => !orderSet.has(id)),
    ];

    for (const productId of orderedIds) {
      const rawQty = selectedTransferMap[productId];
      const qtyStr = typeof rawQty === 'string' ? rawQty : String(rawQty ?? '');
      const product = productByIdMap.get(productId);
      if (!product) continue;
      if (selectedSourceLocation && product.shopId !== selectedSourceLocation.shopId) continue;

      const available = getSourceAvailableQty(product);
      const isBlankQty = qtyStr.trim() === '';
      const parsedQty = isBlankQty ? NaN : Number(qtyStr);
      const defaultPrice = Number(product.sellingPrice || product.purchasePrice || 0);
      const priceStr =
        productId in selectedPriceMap ? selectedPriceMap[productId] : String(defaultPrice);
      const parsedPrice = Number(priceStr);
      const isInvalidPrice = !Number.isFinite(parsedPrice) || parsedPrice < 0;
      const safeQty = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 0;
      const safePrice = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0;
      const subtotal = Math.round(safeQty * safePrice * 100) / 100;

      const requiresStockCheck = transferStatus === 'COMPLETED';
      const isExceeding = requiresStockCheck && Number.isFinite(parsedQty) && parsedQty > available;
      const isInvalidQty = isBlankQty || !Number.isFinite(parsedQty) || parsedQty < 0;

      entries.push({
        product,
        qtyStr,
        parsedQty,
        priceStr,
        parsedPrice,
        subtotal,
        available,
        isInvalidQty,
        isExceeding,
        isInvalidPrice,
      });
    }
    return entries;
  }, [
    selectedTransferMap,
    selectedTransferOrder,
    selectedPriceMap,
    productByIdMap,
    selectedSourceLocation,
    selectedSourceStore,
    productStoreQtyCache,
    transferStatus,
    editingTransferRecord,
  ]);

  const transferSelectionSummary = useMemo(() => {
    let totalUnits = 0;
    let totalAmount = 0;
    let invalidCount = 0;
    let exceedingCount = 0;
    for (const entry of selectedTransferEntries) {
      if (entry.isExceeding) exceedingCount++;
      if (entry.isInvalidQty || entry.isExceeding || entry.isInvalidPrice) {
        invalidCount++;
      } else {
        totalUnits += entry.parsedQty;
        totalAmount += entry.subtotal;
      }
    }
    const shippingNum = Math.max(0, Number(shippingCharges || 0) || 0);
    return {
      selectedCount: selectedTransferEntries.length,
      totalUnits,
      totalAmount: Math.round(totalAmount * 100) / 100,
      shippingNum,
      grandTotal: Math.round((totalAmount + shippingNum) * 100) / 100,
      invalidCount,
      exceedingCount,
    };
  }, [selectedTransferEntries, shippingCharges]);

  // Consolidated Transfers List: combines persisted StockTransfers + any legacy STORE_TRANSFER movements grouped by referenceId
  const allTransfersConsolidated = useMemo(() => {
    const persisted = (dbState.stockTransfers || []).filter(
      t => platformAdmin || accessibleShopIdSet.has(t.sourceShopId) || accessibleShopIdSet.has(t.destShopId)
    );
    const persistedIds = new Set(persisted.map(t => t.id));

    const legacyGroups = new Map<string, InventoryMovement[]>();
    for (const m of dbState.movements || []) {
      if (m.type !== 'STORE_TRANSFER') continue;
      if (m.referenceId && persistedIds.has(m.referenceId)) continue;
      if (!platformAdmin && !accessibleShopIdSet.has(m.shopId)) continue;
      const gKey = m.referenceId || m.id;
      const arr = legacyGroups.get(gKey) || [];
      arr.push(m);
      legacyGroups.set(gKey, arr);
    }

    const legacyTransfers: (StockTransfer & { isLegacy?: boolean })[] = [];
    for (const [refId, mvList] of legacyGroups.entries()) {
      const byProd = new Map<string, InventoryMovement>();
      for (const m of mvList) {
        const existing = byProd.get(m.productId);
        if (!existing || (existing.changeQty > 0 && m.changeQty < 0)) {
          byProd.set(m.productId, m);
        }
      }
      const uniqueRows = Array.from(byProd.values());
      if (uniqueRows.length === 0) continue;

      const sample = uniqueRows[0];
      const st = sample.storeId
        ? accessibleStores.find(s => s.id === sample.storeId)
        : undefined;
      const sh = accessibleShops.find(s => s.id === sample.shopId);
      const createdIso = sample.createdAt || new Date().toISOString();

      let totalUnits = 0;
      let totalAmount = 0;
      const items = uniqueRows.map(m => {
        const prod = productByIdMap.get(m.productId);
        const qty = Math.abs(Number(m.changeQty || 0));
        const unitPrice = Number(prod?.sellingPrice || prod?.purchasePrice || 0);
        const subtotal = Math.round(qty * unitPrice * 100) / 100;
        totalUnits += qty;
        totalAmount += subtotal;
        return {
          id: m.id,
          productId: m.productId,
          productName: m.productName,
          variation: prod?.variation,
          sku: prod?.sku || 'SKU',
          unit: prod?.unit || 'pcs',
          quantity: qty,
          unitPrice,
          subtotal,
        };
      });

      legacyTransfers.push({
        id: refId,
        transferNumber: `TRF-LEG-${refId.slice(0, 4).toUpperCase()}`,
        transferDate: createdIso.slice(0, 10),
        sourceType: 'STORE',
        sourceId: sample.storeId || '',
        sourceName: st?.name || 'Warehouse Store',
        sourceLocation: st?.location || sh?.address || sh?.name,
        sourceShopId: st?.shopId || sample.shopId,
        sourceShopName: sh?.name || sample.shopName,
        destType: 'SHOP',
        destId: sample.shopId,
        destName: `${sh?.name || sample.shopName || 'Shop'} (Shop Floor)`,
        destLocation: sh?.address || sh?.name,
        destShopId: sample.shopId,
        destShopName: sh?.name || sample.shopName,
        status: 'COMPLETED',
        shippingCharges: 0,
        items,
        totalUnits,
        totalAmount: Math.round(totalAmount * 100) / 100,
        createdByUserId: sample.userId,
        createdByName: sample.userName,
        createdAt: createdIso,
        updatedAt: createdIso,
        isLegacy: true,
      });
    }

    return [...persisted, ...legacyTransfers].sort((a, b) => {
      const dateCmp = (b.transferDate || '').localeCompare(a.transferDate || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }, [
    dbState.stockTransfers,
    dbState.movements,
    platformAdmin,
    accessibleShopIdSet,
    accessibleStores,
    accessibleShops,
    productByIdMap,
  ]);

  const filteredTransferList = useMemo(() => {
    const q = listSearchQuery.trim().toLowerCase();
    return allTransfersConsolidated.filter(t => {
      if (!isYMDInDateRange(t.transferDate || t.createdAt, transferStartDate, transferEndDate)) {
        return false;
      }
      if (listLocationFilter !== 'ALL') {
        if (
          t.sourceId !== listLocationFilter &&
          t.destId !== listLocationFilter &&
          encodeLocationKey(t.sourceType, t.sourceId) !== listLocationFilter &&
          encodeLocationKey(t.destType, t.destId) !== listLocationFilter
        ) {
          return false;
        }
      }
      if (q) {
        const hitHeader =
          (t.transferNumber || '').toLowerCase().includes(q) ||
          (t.sourceName || '').toLowerCase().includes(q) ||
          (t.destName || '').toLowerCase().includes(q) ||
          (t.notice || '').toLowerCase().includes(q);
        const hitItem = (t.items || []).some(
          it =>
            it.productName.toLowerCase().includes(q) ||
            (it.sku || '').toLowerCase().includes(q)
        );
        if (!hitHeader && !hitItem) return false;
      }
      return true;
    });
  }, [
    allTransfersConsolidated,
    transferStartDate,
    transferEndDate,
    listLocationFilter,
    listSearchQuery,
  ]);

  const viewingTransfer = useMemo(
    () =>
      viewingTransferId
        ? allTransfersConsolidated.find(t => t.id === viewingTransferId)
        : undefined,
    [viewingTransferId, allTransfersConsolidated]
  );

  const totalStoreStockUnits = useMemo(() => {
    return accessibleProducts.reduce((sum, p) => sum + Number(p.storeStock || 0), 0);
  }, [accessibleProducts]);

  const productsInStoreCount = useMemo(() => {
    return accessibleProducts.filter(p => (p.storeStock || 0) > 0).length;
  }, [accessibleProducts]);

  const selectedInventoryStore = useMemo(
    () =>
      selectedInventoryStoreId === 'ALL_COMBINED'
        ? undefined
        : accessibleStores.find(st => st.id === selectedInventoryStoreId),
    [accessibleStores, selectedInventoryStoreId]
  );

  const inventoryStoreGroups = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    const matchesFilters = (p: Product): boolean => {
      if (invCategoryFilter !== 'ALL' && p.categoryId !== invCategoryFilter) {
        return false;
      }
      if (q) {
        const cf = p.customFields;
        const customMatch = cf
          ? [cf.field1, cf.field2, cf.field3, cf.field4].some(v =>
              (v || '').toLowerCase().includes(q)
            )
          : false;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.variation || '').toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q) ||
          customMatch
        );
      }
      return true;
    };

    const targetStores = selectedInventoryStore
      ? [selectedInventoryStore]
      : [...accessibleStores].sort((a, b) => {
          if (a.isShopFloor !== b.isShopFloor) return a.isShopFloor ? 1 : -1;
          if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
          return (a.createdAt || '').localeCompare(b.createdAt || '') || a.name.localeCompare(b.name);
        });

    const groups: {
      store: Store;
      shopName: string;
      products: Product[];
      totalUnits: number;
      totalCostValue: number;
      totalSaleValue: number;
    }[] = [];

    for (const st of targetStores) {
      const storeProducts = accessibleProducts
        .filter(p => {
          if (p.shopId !== st.shopId) return false;
          if (!matchesFilters(p)) return false;
          if (invStockedOnly) {
            const qtyHere = getProductQtyInStore(p, st);
            const hasDetailsHere = Boolean(
              p.storeDetails?.[st.id] ||
                (p.storeStocks && st.id in p.storeStocks) ||
                p.storeId === st.id
            );
            if (qtyHere <= 0 && !(q && hasDetailsHere) && !p.storeDetails?.[st.id]) return false;
          }
          return true;
        })
        .sort((a, b) => {
          const aq = getProductQtyInStore(a, st);
          const bq = getProductQtyInStore(b, st);
          if (bq !== aq) return bq - aq;
          return a.name.localeCompare(b.name);
        });

      if (!selectedInventoryStore && (q || invCategoryFilter !== 'ALL') && storeProducts.length === 0) {
        continue;
      }

      let totalUnits = 0;
      let totalCostValue = 0;
      let totalSaleValue = 0;

      for (const p of storeProducts) {
        const qty = getProductQtyInStore(p, st);
        const detail = p.storeDetails?.[st.id];
        totalUnits += qty;
        totalCostValue +=
          detail?.importedPurchaseValue !== undefined
            ? detail.importedPurchaseValue
            : qty * (p.purchasePrice || 0);
        totalSaleValue +=
          detail?.importedSaleValue !== undefined
            ? detail.importedSaleValue
            : qty * (p.sellingPrice || 0);
      }

      const shopName = accessibleShops.find(s => s.id === st.shopId)?.name || 'Shop';
      groups.push({
        store: st,
        shopName,
        products: storeProducts,
        totalUnits,
        totalCostValue,
        totalSaleValue,
      });
    }

    return groups;
  }, [
    accessibleProducts,
    accessibleStores,
    accessibleShops,
    selectedInventoryStore,
    invCategoryFilter,
    invStockedOnly,
    invSearch,
    productStoreQtyCache,
  ]);

  const inventoryProducts = useMemo(() => {
    const seen = new Set<string>();
    const list: Product[] = [];
    for (const g of inventoryStoreGroups) {
      for (const p of g.products) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          list.push(p);
        }
      }
    }
    return list;
  }, [inventoryStoreGroups]);

  const inventoryTotals = useMemo(() => {
    let totalUnits = 0;
    let totalCostValue = 0;
    let totalSaleValue = 0;

    for (const g of inventoryStoreGroups) {
      totalUnits += g.totalUnits;
      totalCostValue += g.totalCostValue;
      totalSaleValue += g.totalSaleValue;
    }

    return {
      skuCount: inventoryProducts.length,
      totalUnits,
      totalCostValue,
      totalSaleValue,
      potentialProfit: totalSaleValue - totalCostValue,
    };
  }, [inventoryStoreGroups, inventoryProducts]);

  const MAX_BATCH_TRANSFER_PRODUCTS = 1000;

  const openNewTransferForm = (_preferredStoreId?: string) => {
    void _preferredStoreId;
    setEditingTransferId(null);
    setTransferDate(formatDateYMD(new Date()));
    setSourceLocationKey('');
    setDestLocationKey('');
    setSelectedTransferMap({});
    setSelectedTransferOrder([]);
    setSelectedPriceMap({});
    setProductSearch('');
    setTransferVisibleLimit(STORE_PAGE_SIZE);
    setSelectedQueueFilter('');
    setSelectedQueueVisibleLimit(STORE_PAGE_SIZE);
    setShippingCharges('');
    setTransferNotes('');
    setTransferStatus('COMPLETED');
    setTransferError('');
    setTransferProgressPct(null);
    setActiveSubTab('transfer');
  };

  // Sync sidebar / sub-tab dropdown clicks
  useEffect(() => {
    if (storesNavTick === lastHandledNavTickRef.current) return;
    lastHandledNavTickRef.current = storesNavTick;
    if (activeSubTab === 'transfer') {
      openNewTransferForm();
    } else if (activeSubTab === 'list') {
      setListLocationFilter('ALL');
    }
  }, [storesNavTick, activeSubTab]);

  if (!currentUser || !hasAdminAccess(currentUser)) return null;

  // Modal handlers
  const openCreateStoreModal = () => {
    setEditingStore(null);
    setStoreName('');
    setStoreLocation('');
    const defaultShop =
      selectedShopId && selectedShopId !== 'ALL' && accessibleShopIdSet.has(selectedShopId)
        ? selectedShopId
        : accessibleShops[0]?.id || '';
    setStoreShopId(defaultShop);
    setStoreFormError('');
    setIsStoreModalOpen(true);
  };

  const openEditStoreModal = (store: Store) => {
    setEditingStore(store);
    setStoreName(store.name);
    setStoreLocation(store.location || '');
    setStoreShopId(store.shopId);
    setStoreFormError('');
    setIsStoreModalOpen(true);
  };

  const handleSaveStore = (e: React.FormEvent) => {
    e.preventDefault();
    setStoreFormError('');

    if (!storeName.trim()) {
      setStoreFormError('Store name is required.');
      return;
    }
    if (!storeShopId) {
      setStoreFormError('Please assign this store to a shop.');
      return;
    }

    const res = editingStore
      ? StoreService.updateStore(
          editingStore.id,
          {
            name: storeName.trim(),
            location: storeLocation.trim(),
            shopId: storeShopId,
          },
          currentUser
        )
      : StoreService.createStore(
          {
            name: storeName.trim(),
            location: storeLocation.trim() || undefined,
            shopId: storeShopId,
          },
          currentUser
        );

    if (res.success) {
      const assignedShop = accessibleShops.find(s => s.id === storeShopId);
      addToast({
        type: 'success',
        title: editingStore ? 'Store Updated' : 'Store Created',
        description: editingStore
          ? `Store "${storeName.trim()}" updated.`
          : `Store "${storeName.trim()}" assigned to ${assignedShop?.name || 'shop'} and queued for sync.`,
      });
      setIsStoreModalOpen(false);
    } else {
      setStoreFormError(res.error || 'Failed to save store.');
    }
  };

  const handleConfirmDeleteStore = (store: Store) => {
    const res = StoreService.deleteStore(store.id, currentUser);
    if (res.success) {
      if (selectedInventoryStoreId === store.id) {
        setSelectedInventoryStoreId('ALL_COMBINED');
      }
      if (sourceLocationKey === encodeLocationKey('STORE', store.id)) {
        setSourceLocationKey('');
      }
      if (importTargetStoreId === store.id) {
        setImportTargetStoreId('');
      }
      addToast({
        type: 'success',
        title: 'Store Deleted',
        description: `"${store.name}" has been deleted and queued for sync.`,
      });
      setDeletingStore(null);
    } else {
      addToast({
        type: 'error',
        title: 'Delete Failed',
        description: res.error || 'Could not delete store.',
      });
    }
  };

  const openEditTransferForm = (transfer: StockTransfer & { isLegacy?: boolean }) => {
    if (transfer.isLegacy) {
      addToast({
        type: 'warning',
        title: 'Legacy Record',
        description: 'Older pre-voucher transfer history cannot be edited directly. Create a new transfer instead.',
      });
      return;
    }
    setEditingTransferId(transfer.id);
    setTransferDate(transfer.transferDate || formatDateYMD(new Date()));
    setSourceLocationKey(encodeLocationKey(transfer.sourceType, transfer.sourceId));
    setDestLocationKey(encodeLocationKey(transfer.destType, transfer.destId));

    const qtyMap: Record<string, string> = {};
    const priceMap: Record<string, string> = {};
    for (const item of transfer.items || []) {
      qtyMap[item.productId] = String(item.quantity);
      priceMap[item.productId] = String(item.unitPrice);
    }
    setSelectedTransferMap(qtyMap);
    setSelectedTransferOrder(
      Array.from(new Set((transfer.items || []).map(item => item.productId)))
    );
    setSelectedPriceMap(priceMap);
    setProductSearch('');
    setTransferVisibleLimit(STORE_PAGE_SIZE);
    setSelectedQueueFilter('');
    setSelectedQueueVisibleLimit(STORE_PAGE_SIZE);
    setShippingCharges(transfer.shippingCharges > 0 ? String(transfer.shippingCharges) : '');
    setTransferNotes(transfer.notice || '');
    setTransferStatus(transfer.status);
    setTransferError('');
    setTransferProgressPct(null);
    setActiveSubTab('transfer');
  };

  const handleSourceLocationChange = (nextKey: string) => {
    setSourceLocationKey(nextKey);
    setDestLocationKey('');
    setSelectedTransferMap({});
    setSelectedTransferOrder([]);
    setSelectedPriceMap({});
    setProductSearch('');
    setTransferVisibleLimit(STORE_PAGE_SIZE);
    setSelectedQueueVisibleLimit(STORE_PAGE_SIZE);
    setTransferError('');
  };

  const handleAddTransferProduct = (product: Product) => {
    const available = getSourceAvailableQty(product);
    const defaultPrice = String(Number(product.sellingPrice || product.purchasePrice || 0));

    setTransferError('');

    if (product.id in selectedTransferMap) {
      const currentQty = Number(selectedTransferMap[product.id]) || 0;
      const nextQty = currentQty + 1;
      if (transferStatus === 'COMPLETED' && available <= 0) {
        addToast({
          type: 'info',
          title: 'Added with 0 Quantity',
          description: `"${product.name}" has 0 stock at ${selectedSourceLocation?.name || 'source'} and will be copied to the destination with 0 qty.`,
        });
        setProductSearch('');
        setTransferVisibleLimit(STORE_PAGE_SIZE);
        return;
      }
      if (transferStatus === 'COMPLETED' && nextQty > available) {
        addToast({
          type: 'warning',
          title: 'Stock Limit Reached',
          description: `Only ${available.toLocaleString()} ${product.unit} available for "${product.name}".`,
        });
        return;
      }
      setSelectedTransferMap(prev => ({
        ...prev,
        [product.id]: String(nextQty),
      }));
      setSelectedTransferOrder(prev => [product.id, ...prev.filter(id => id !== product.id)]);
    } else {
      if (Object.keys(selectedTransferMap).length >= MAX_BATCH_TRANSFER_PRODUCTS) {
        addToast({
          type: 'warning',
          title: 'Selection Limit Reached',
          description: `You can add up to ${MAX_BATCH_TRANSFER_PRODUCTS.toLocaleString()} products per transfer.`,
        });
        return;
      }
      setSelectedPriceMap(pm => ({
        ...pm,
        [product.id]: pm[product.id] ?? defaultPrice,
      }));
      setSelectedTransferMap(prev => ({
        ...prev,
        [product.id]: available > 0 ? '1' : '0',
      }));
      setSelectedTransferOrder(prev => [product.id, ...prev.filter(id => id !== product.id)]);
    }

    setProductSearch('');
    setTransferVisibleLimit(STORE_PAGE_SIZE);
  };

  const handleTransferSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setProductSearch('');
      return;
    }
    if (e.key === 'Enter' && productSearch.trim()) {
      e.preventDefault();
      const q = productSearch.trim().toLowerCase();
      const exact = storeScopedProducts.find(
        p =>
          (p.barcode || '').toLowerCase() === q ||
          (p.sku || '').toLowerCase() === q
      );
      if (exact) {
        handleAddTransferProduct(exact);
        return;
      }
      if (storeScopedProducts.length === 1) {
        handleAddTransferProduct(storeScopedProducts[0]);
      }
    }
  };

  const handleChangeSelectedTransferQty = (productId: string, nextVal: string) => {
    setTransferError('');
    setSelectedTransferMap(prev => ({
      ...prev,
      [productId]: nextVal,
    }));
  };

  const handleChangeSelectedTransferPrice = (productId: string, nextVal: string) => {
    setTransferError('');
    setSelectedPriceMap(prev => ({
      ...prev,
      [productId]: nextVal,
    }));
  };

  const handleSubmitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (transferProgressPct !== null) return;
    setTransferError('');

    const srcLoc = decodeLocationKey(effectiveSourceLocationKey);
    const dstLoc = decodeLocationKey(effectiveDestLocationKey);

    if (!transferDate) {
      setTransferError('Please select a transfer date.');
      return;
    }
    if (!srcLoc) {
      setTransferError('Please select a Location From.');
      return;
    }
    if (!dstLoc) {
      setTransferError('Please select a Location To.');
      return;
    }
    if (selectedTransferEntries.length === 0) {
      setTransferError('Search and add at least one product to transfer.');
      return;
    }
    if (selectedTransferEntries.length > MAX_BATCH_TRANSFER_PRODUCTS) {
      setTransferError(
        `Maximum ${MAX_BATCH_TRANSFER_PRODUCTS.toLocaleString()} products allowed per transfer.`
      );
      return;
    }

    const firstBad = selectedTransferEntries.find(
      entry => entry.isInvalidQty || entry.isExceeding || entry.isInvalidPrice
    );
    if (firstBad) {
      if (firstBad.isInvalidPrice) {
        setTransferError(`Enter a valid price (0 or greater) for "${firstBad.product.name}".`);
      } else if (firstBad.isExceeding) {
        setTransferError(
          firstBad.available <= 0
            ? `Only 0 ${firstBad.product.unit || 'pcs'} available for "${firstBad.product.name}". Enter 0 to copy it to the destination with 0 quantity.`
            : `Quantity for "${firstBad.product.name}" (${firstBad.parsedQty}) exceeds available stock (${firstBad.available} ${firstBad.product.unit || 'pcs'}).`
        );
      } else {
        setTransferError(
          `Enter a valid quantity (0 or greater) for "${firstBad.product.name}".`
        );
      }
      return;
    }

    const parsedShipping = Number(shippingCharges || 0);
    if (!Number.isFinite(parsedShipping) || parsedShipping < 0) {
      setTransferError('Shipping charges must be 0 or greater.');
      return;
    }

    setTransferProgressPct(22);
    await new Promise(resolve => window.setTimeout(resolve, 140));
    setTransferProgressPct(68);
    await new Promise(resolve => window.setTimeout(resolve, 160));

    const payload = {
      transferDate,
      sourceType: srcLoc.type,
      sourceId: srcLoc.id,
      destType: dstLoc.type,
      destId: dstLoc.id,
      items: selectedTransferEntries.map(entry => ({
        productId: entry.product.id,
        quantity: entry.parsedQty,
        unitPrice: entry.parsedPrice,
      })),
      shippingCharges: parsedShipping,
      notice: transferNotes.trim() || undefined,
      status: transferStatus,
    };

    const res = editingTransferId
      ? StoreService.updateStockTransfer(editingTransferId, payload, currentUser)
      : StoreService.executeStockTransfer(payload, currentUser);

    if (res.success && res.transfer) {
      setTransferProgressPct(100);
      await new Promise(resolve => window.setTimeout(resolve, 180));

      const t = res.transfer;
      addToast({
        type: 'success',
        title: editingTransferId
          ? 'Stock Transfer Updated'
          : t.status === 'COMPLETED'
            ? `${t.items.length.toLocaleString()} Product${t.items.length === 1 ? '' : 's'} Transferred`
            : 'Incomplete Transfer Saved',
        description: `${t.sourceName} → ${t.destName} (${t.totalUnits.toLocaleString()} units · ${formatCurrency(t.totalAmount, settings.currencySymbol)})`,
      });

      const wasEditing = Boolean(editingTransferId);
      setEditingTransferId(null);
      setSelectedTransferMap({});
      setSelectedTransferOrder([]);
      setSelectedPriceMap({});
      setProductSearch('');
      setSelectedQueueFilter('');
      setShippingCharges('');
      setTransferNotes('');
      setTransferError('');
      setTransferProgressPct(null);

      if (wasEditing) {
        setActiveSubTab('list');
      }
    } else {
      setTransferProgressPct(null);
      setTransferError(res.error || 'Transfer failed.');
    }
  };

  const handleConfirmDeleteTransfer = (transfer: StockTransfer & { isLegacy?: boolean }) => {
    if (transfer.isLegacy) {
      addToast({
        type: 'warning',
        title: 'Legacy Transfer History',
        description: 'Legacy inventory log entries from earlier versions cannot be deleted here.',
      });
      setDeletingTransfer(null);
      return;
    }

    const res = StoreService.deleteStockTransfer(transfer.id, currentUser);
    if (res.success) {
      addToast({
        type: 'success',
        title: 'Transfer Deleted',
        description: `${transfer.transferNumber} removed${
          transfer.status === 'COMPLETED' ? ' and stock restored to source location' : ''
        }.`,
      });
      if (viewingTransferId === transfer.id) {
        setViewingTransferId(null);
        setActiveSubTab('list');
      }
      setDeletingTransfer(null);
    } else {
      addToast({
        type: 'error',
        title: 'Delete Failed',
        description: res.error || 'Could not delete transfer record.',
      });
    }
  };

  // Store Excel Import / Export handlers
  const openImportModal = (preselectedStoreId?: string) => {
    const preferred =
      preselectedStoreId && activeStores.some(s => s.id === preselectedStoreId)
        ? preselectedStoreId
        : selectedInventoryStore && selectedInventoryStore.status === 'ACTIVE'
          ? selectedInventoryStore.id
          : activeStores[0]?.id || '';
    setImportTargetStoreId(preferred);
    setImportFile(null);
    setImportParseResult(null);
    setImportProgress(null);
    if (importFileInputRef.current) importFileInputRef.current.value = '';
    setIsImportModalOpen(true);
  };

  const handleStoreExcelFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!importTargetStoreId) {
      addToast({
        type: 'warning',
        title: 'Select Store First',
        description: 'Choose the destination store before selecting an Excel file.',
      });
      if (importFileInputRef.current) importFileInputRef.current.value = '';
      return;
    }

    setImportFile(file);
    setImportParseResult(null);
    setIsParsingImport(true);
    setImportProgress({
      stage: 'READING',
      percent: 2,
      processedRows: 0,
      totalRows: 0,
      message: `Opening "${file.name}"...`,
    });

    try {
      const result = await ExcelImportService.parseExcelFile(file, progress => {
        setImportProgress(progress);
      });
      setImportParseResult(result);

      if (result.errors.length > 0 && result.rows.length === 0) {
        addToast({
          type: 'error',
          title: 'Invalid Excel Format',
          description: result.errors[0]?.message || 'Could not read products from file.',
        });
      } else if (result.errors.length > 0) {
        addToast({
          type: 'warning',
          title: 'Validation Issues',
          description: `${result.rows.length.toLocaleString()} valid rows, ${result.errors.length.toLocaleString()} error(s).`,
        });
      } else {
        addToast({
          type: 'success',
          title: 'Excel Ready',
          description: `${result.rows.length.toLocaleString()} products ready to import.`,
        });
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Failed to Read File',
        description: err?.message || 'Unexpected error while reading spreadsheet.',
      });
    } finally {
      setIsParsingImport(false);
    }
  };

  const handleCommitStoreExcelImport = async () => {
    if (!importParseResult || importParseResult.rows.length === 0) return;

    const targetStore = activeStores.find(s => s.id === importTargetStoreId);
    if (!targetStore) {
      addToast({
        type: 'warning',
        title: 'Select Store First',
        description: 'Please select an active destination store.',
      });
      return;
    }

    setIsCommittingImport(true);
    setImportProgress({
      stage: 'SAVING',
      percent: 2,
      processedRows: 0,
      totalRows: importParseResult.rows.length,
      message: `Starting import of ${importParseResult.rows.length.toLocaleString()} products...`,
    });

    try {
      const res = await ExcelImportService.commitImportAsync(
        importParseResult.rows,
        targetStore.shopId,
        currentUser,
        targetStore.id,
        progress => {
          setImportProgress(progress);
        }
      );

      if (res.success) {
        const shopName = accessibleShops.find(s => s.id === targetStore.shopId)?.name || 'Shop';
        addToast({
          type: 'success',
          title: 'Store Import Successful',
          description: `${res.created.toLocaleString()} created, ${res.updated.toLocaleString()} updated in ${targetStore.name} (${shopName}).`,
        });
        setIsImportModalOpen(false);
        setImportFile(null);
        setImportParseResult(null);
        setImportProgress(null);
        if (importFileInputRef.current) importFileInputRef.current.value = '';
      } else {
        addToast({
          type: 'error',
          title: 'Import Completed with Errors',
          description: `${res.created.toLocaleString()} created, ${res.updated.toLocaleString()} updated, ${res.errors.length.toLocaleString()} error(s).`,
        });
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Import Failed',
        description: err?.message || 'Unexpected error while saving products.',
      });
    } finally {
      setIsCommittingImport(false);
    }
  };

  const handleExportStoreExcel = (store: Store, customProducts?: Product[]) => {
    const res = ExcelExportService.exportStoreProducts(store, customProducts);
    if (res.success) {
      addToast({
        type: 'success',
        title: 'Store Excel Exported',
        description: `${res.rowCount} products saved to ${res.fileName}`,
      });
    } else {
      addToast({
        type: 'warning',
        title: 'Nothing to Export',
        description: res.error || `No products available in ${store.name}.`,
      });
    }
  };

  const handleExportInventoryExcel = () => {
    if (selectedInventoryStore) {
      handleExportStoreExcel(selectedInventoryStore, inventoryProducts);
      return;
    }
    const res = ExcelExportService.exportCombinedStoresProducts(
      accessibleStores,
      inventoryProducts
    );
    if (res.success) {
      addToast({
        type: 'success',
        title: 'Inventory Exported',
        description: `${res.rowCount} products saved to ${res.fileName}`,
      });
    } else {
      addToast({
        type: 'warning',
        title: 'Nothing to Export',
        description: res.error || 'No products found to export.',
      });
    }
  };

  // Store Inventory Product Click / Hold Gesture & Action Handlers
  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleInventoryCardPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    product: Product,
    store: Store
  ) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };

    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      setActionStoreContext(store);
      setActionProduct(product);
    }, 420);
  };

  const handleInventoryCardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerStartRef.current || longPressTimerRef.current === null) return;
    const dx = Math.abs(e.clientX - pointerStartRef.current.x);
    const dy = Math.abs(e.clientY - pointerStartRef.current.y);
    if (dx > 10 || dy > 10) {
      clearLongPressTimer();
    }
  };

  const handleInventoryCardPointerEnd = () => {
    clearLongPressTimer();
    pointerStartRef.current = null;
  };

  const handleInventoryCardClick = (product: Product, store: Store) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    setActionStoreContext(store);
    setActionProduct(product);
  };

  const handleOpenEditProductFromAction = (product: Product) => {
    setActionProduct(null);
    setActionStoreContext(null);
    setEditingProduct(product);
    setEditProdName(product.name || '');
    setEditProdVariation(product.variation || '');
    setEditProdSku(product.sku || '');
    setEditProdCategoryId(product.categoryId || '');
    setEditProdPurchasePrice(String(product.purchasePrice ?? 0));
    setEditProdSellingPrice(String(product.sellingPrice ?? 0));
    setEditProdUnit(product.unit || 'pcs');
    setEditProdMinStock(String(product.minStock ?? 0));
    setEditProdFloorStock(String(product.currentStock ?? 0));

    const warehouseStoresInShop = accessibleStores.filter(
      st => st.shopId === product.shopId && !st.isShopFloor
    );
    const initialQtys: Record<string, string> = {};
    for (const st of warehouseStoresInShop) {
      initialQtys[st.id] = String(getProductQtyInStore(product, st));
    }
    setEditProdStoreQtys(initialQtys);
    setEditProdError('');
  };

  const handleSaveEditedProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setEditProdError('');

    const cleanName = editProdName.trim();
    const cleanSku = editProdSku.trim();
    const buyPrice = Number(editProdPurchasePrice);
    const sellPrice = Number(editProdSellingPrice);
    const minStk = Number(editProdMinStock);
    const floorStk = Number(editProdFloorStock);

    if (!cleanName) {
      setEditProdError('Product name is required.');
      return;
    }
    if (!cleanSku) {
      setEditProdError('SKU is required.');
      return;
    }
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      setEditProdError('Buying price must be 0 or greater.');
      return;
    }
    if (!Number.isFinite(sellPrice) || sellPrice < 0) {
      setEditProdError('Selling price must be 0 or greater.');
      return;
    }
    if (!Number.isFinite(floorStk) || floorStk < 0) {
      setEditProdError('Shop floor stock cannot be negative.');
      return;
    }

    const shopStores = accessibleStores.filter(st => st.shopId === editingProduct.shopId);
    const warehouseStoresInShop = shopStores.filter(st => !st.isShopFloor);
    const floorStoresInShop = shopStores.filter(st => st.isShopFloor);

    const nextStoreStocks: Record<string, number> = {
      ...(editingProduct.storeStocks || {}),
    };
    const nextStoreDetails: Record<string, ProductStoreStockDetail> = {
      ...(editingProduct.storeDetails || {}),
    };

    let nextStoreStockTotal = 0;
    let primaryStoreId = editingProduct.storeId;
    let maxStoreQty = -1;

    for (const st of warehouseStoresInShop) {
      const parsed = Number(editProdStoreQtys[st.id] ?? 0);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setEditProdError(`Quantity for "${st.name}" cannot be negative.`);
        return;
      }
      nextStoreStocks[st.id] = parsed;
      nextStoreStockTotal += parsed;
      if (parsed > maxStoreQty) {
        maxStoreQty = parsed;
        primaryStoreId = st.id;
      }

      const prevDetail = nextStoreDetails[st.id];
      nextStoreDetails[st.id] = {
        ...(prevDetail || {
          storeId: st.id,
          storeName: st.name,
          quantity: parsed,
          unitPurchasePrice: buyPrice,
          unitSellingPrice: sellPrice,
        }),
        storeId: st.id,
        storeName: st.name,
        quantity: parsed,
        unitPurchasePrice: buyPrice,
        unitSellingPrice: sellPrice,
        importedPurchaseValue: parsed * buyPrice,
        importedSaleValue: parsed * sellPrice,
        importedPotentialProfit: parsed * (sellPrice - buyPrice),
      };
    }

    for (const fl of floorStoresInShop) {
      nextStoreStocks[fl.id] = floorStk;
      const prevDetail = nextStoreDetails[fl.id];
      nextStoreDetails[fl.id] = {
        ...(prevDetail || {
          storeId: fl.id,
          storeName: fl.name,
          quantity: floorStk,
          unitPurchasePrice: buyPrice,
          unitSellingPrice: sellPrice,
        }),
        storeId: fl.id,
        storeName: fl.name,
        quantity: floorStk,
        unitPurchasePrice: buyPrice,
        unitSellingPrice: sellPrice,
        importedPurchaseValue: floorStk * buyPrice,
        importedSaleValue: floorStk * sellPrice,
        importedPotentialProfit: floorStk * (sellPrice - buyPrice),
      };
    }

    if (warehouseStoresInShop.length === 0) {
      nextStoreStockTotal = Math.max(0, Number(editingProduct.storeStock || 0));
    }

    setIsSavingProductEdit(true);
    try {
      const res = await ProductService.updateProduct(
        editingProduct.id,
        {
          name: cleanName,
          variation: editProdVariation.trim() || undefined,
          sku: cleanSku,
          categoryId: editProdCategoryId || editingProduct.categoryId,
          purchasePrice: buyPrice,
          sellingPrice: sellPrice,
          unit: editProdUnit.trim() || 'pcs',
          minStock: Number.isFinite(minStk) && minStk >= 0 ? minStk : 0,
          currentStock: floorStk,
          storeId: primaryStoreId,
          storeStock: nextStoreStockTotal,
          storeStocks: nextStoreStocks,
          storeDetails: nextStoreDetails,
        },
        currentUser
      );

      if (!res.success) {
        setEditProdError(res.error || 'Failed to update product.');
        return;
      }

      const oldTotal =
        Number(editingProduct.currentStock || 0) + Number(editingProduct.storeStock || 0);
      const newTotal = floorStk + nextStoreStockTotal;
      if (oldTotal !== newTotal) {
        const shopName = accessibleShops.find(s => s.id === editingProduct.shopId)?.name;
        const adjMovement: InventoryMovement = {
          id: generateUUID(),
          shopId: editingProduct.shopId,
          shopName,
          storeId: selectedInventoryStore?.id || primaryStoreId,
          productId: editingProduct.id,
          productName: cleanName,
          previousQty: oldTotal,
          changeQty: newTotal - oldTotal,
          newQty: newTotal,
          type: 'ADJUSTMENT',
          reason: `Manual edit in Stores Inventory${
            selectedInventoryStore ? ` (${selectedInventoryStore.name})` : ''
          }`,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: new Date().toISOString(),
        };
        db.saveMovements([adjMovement, ...db.getMovements()]);
      }

      addToast({
        type: 'success',
        title: 'Product Updated',
        description: `"${cleanName}" saved (${nextStoreStockTotal.toLocaleString()} in stores, ${floorStk.toLocaleString()} on floor).`,
      });
      setEditingProduct(null);
    } catch (err: any) {
      setEditProdError(err?.message || 'Unexpected error while saving product.');
    } finally {
      setIsSavingProductEdit(false);
    }
  };

  const handleOpenTransferFromAction = (product: Product) => {
    const activeWarehousesInShop = transferableStores.filter(s => s.shopId === product.shopId);
    if (activeWarehousesInShop.length === 0) {
      setActionProduct(null);
      setActionStoreContext(null);
      addToast({
        type: 'warning',
        title: 'No Warehouse Store',
        description:
          'Create an active warehouse store in this shop before transferring stock onto the shop floor.',
      });
      return;
    }

    const preferredStore = actionStoreContext || selectedInventoryStore;
    let bestStore =
      preferredStore &&
      preferredStore.shopId === product.shopId &&
      !preferredStore.isShopFloor &&
      preferredStore.status === 'ACTIVE'
        ? preferredStore
        : activeWarehousesInShop[0];

    if (
      !preferredStore ||
      preferredStore.isShopFloor ||
      preferredStore.shopId !== product.shopId
    ) {
      let bestQty = -1;
      for (const st of activeWarehousesInShop) {
        const q = getProductQtyInStore(product, st);
        if (q > bestQty) {
          bestQty = q;
          bestStore = st;
        }
      }
    }

    const availableHere = getProductQtyInStore(product, bestStore);
    setEditingTransferId(null);
    setTransferDate(formatDateYMD(new Date()));
    setSourceLocationKey(encodeLocationKey('STORE', bestStore.id));
    setDestLocationKey(encodeLocationKey('SHOP', product.shopId));
    setSelectedTransferMap({
      [product.id]: availableHere > 0 ? '1' : '0',
    });
    setSelectedTransferOrder([product.id]);
    setSelectedPriceMap({
      [product.id]: String(Number(product.sellingPrice || product.purchasePrice || 0)),
    });
    setShippingCharges('');
    setTransferNotes('');
    setTransferStatus('COMPLETED');
    setProductSearch('');
    setTransferVisibleLimit(STORE_PAGE_SIZE);
    setSelectedQueueVisibleLimit(STORE_PAGE_SIZE);
    setTransferError('');
    setTransferProgressPct(null);
    setActionProduct(null);
    setActionStoreContext(null);
    setActiveSubTab('transfer');
  };

  const handleConfirmDeleteProduct = () => {
    if (!deletingProduct) return;
    const res = ProductService.deleteProduct(deletingProduct.id, currentUser);
    if (res.success) {
      addToast({
        type: 'success',
        title: 'Product Deleted',
        description: `"${deletingProduct.name}" has been deleted and queued for sync.`,
      });
      if (deletingProduct.id in selectedTransferMap) {
        setSelectedTransferMap(prev => {
          const next = { ...prev };
          delete next[deletingProduct.id];
          return next;
        });
        setSelectedTransferOrder(prev => prev.filter(id => id !== deletingProduct.id));
      }
      setDeletingProduct(null);
    } else {
      addToast({
        type: 'error',
        title: 'Delete Failed',
        description: res.error || 'Could not delete product.',
      });
    }
  };

  const isFullPageTransferWorkspace =
    activeSubTab === 'transfer' ||
    activeSubTab === 'list' ||
    activeSubTab === 'transfer_view';

  const navSubTabs: { id: StoresSubTab; label: string; icon: React.ElementType }[] = [
    { id: 'stores', label: 'Stores Directory', icon: Warehouse },
    { id: 'inventory', label: 'Store Inventory', icon: Boxes },
    { id: 'transfer', label: 'Transfer Stock', icon: ArrowRightLeft },
    { id: 'list', label: 'Transferred List', icon: ClipboardList },
  ];

  return (
    <div
      id="admin-stores-view"
      className={`flex-1 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-6 ${
        activeSubTab === 'transfer' ? 'px-0 pt-3.5 sm:p-6' : 'p-3.5 sm:p-6'
      }`}
    >
      {/* Standard Stores / Inventory Header & Overview KPIs */}
      {!isFullPageTransferWorkspace && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-4 border-b border-slate-800">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                Stores &amp; Transfers
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Manage warehouse stores assigned to shops and transfer stock across stores &amp; shops
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleManualRefreshStores}
                disabled={isRefreshingStores}
                title="Refresh stores from database"
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs transition disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshingStores ? 'animate-spin' : ''}`} />
                <span>{isRefreshingStores ? 'Refreshing...' : 'Refresh'}</span>
              </button>

              <button
                type="button"
                onClick={() => openImportModal()}
                disabled={activeStores.length === 0}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-semibold text-xs transition disabled:opacity-45 disabled:cursor-not-allowed"
              >
                <Upload className="w-4 h-4" />
                <span>Import Excel</span>
              </button>

              <button
                id="create-store-btn"
                type="button"
                onClick={openCreateStoreModal}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create Store</span>
              </button>
            </div>
          </div>

          {/* Desktop / Tablet Sub-Tab Bar */}
          <div className="flex flex-wrap items-center gap-1.5 mb-5 p-1 bg-slate-900 border border-slate-800 rounded-xl w-fit">
            {navSubTabs.map(tab => {
              const TabIcon = tab.icon;
              const isTabActive = activeSubTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (tab.id === 'transfer') {
                      openNewTransferForm();
                    } else if (tab.id === 'list') {
                      setListLocationFilter('ALL');
                      setActiveSubTab('list');
                    } else {
                      setActiveSubTab(tab.id);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    isTabActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <TabIcon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  {tab.id === 'list' && allTransfersConsolidated.length > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 text-[10px] font-mono">
                      {allTransfersConsolidated.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Overview Metrics Row */}
          <div className="grid grid-cols-3 gap-2.5 sm:gap-4 mb-5">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4">
              <div className="text-[11px] text-slate-400 font-medium">Active Stores</div>
              <div className="text-lg sm:text-2xl font-bold text-white font-mono tabular-nums mt-1">
                {activeStores.length}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {accessibleShops.length} shop{accessibleShops.length === 1 ? '' : 's'}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4">
              <div className="text-[11px] text-slate-400 font-medium">Stocked SKUs</div>
              <div className="text-lg sm:text-2xl font-bold text-white font-mono tabular-nums mt-1">
                {productsInStoreCount}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">In warehouse</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4">
              <div className="text-[11px] text-slate-400 font-medium">Store Units</div>
              <div className="text-lg sm:text-2xl font-bold text-blue-400 font-mono tabular-nums mt-1">
                {totalStoreStockUnits.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Ready to transfer</div>
            </div>
          </div>
        </>
      )}

      {/* SUB-TAB 1: STORES DIRECTORY */}
      {activeSubTab === 'stores' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={storeSearch}
                onChange={e => setStoreSearch(e.target.value)}
                placeholder="Search store name, location, or shop..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <select
              value={shopFilter}
              onChange={e => setShopFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">
                {shopAdmin && !platformAdmin && accessibleShops.length === 1
                  ? accessibleShops[0].name
                  : 'All Assigned Shops'}
              </option>
              {(platformAdmin || accessibleShops.length > 1) &&
                accessibleShops.map(sh => (
                  <option key={sh.id} value={sh.id}>
                    {sh.name}
                  </option>
                ))}
            </select>
          </div>

          {filteredStores.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl py-14 px-4 text-center">
              <Warehouse className="w-10 h-10 mx-auto text-slate-600 mb-2.5" />
              <h3 className="text-sm font-semibold text-white">No Stores Created Yet</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Create warehouse stores and assign them to any shop. One shop can have multiple stores for separate storage locations.
              </p>
              <button
                type="button"
                onClick={openCreateStoreModal}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create First Store</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredStores.map(store => {
                const shop = accessibleShops.find(s => s.id === store.shopId);
                const storeStockedProducts = accessibleProducts.filter(
                  p => p.shopId === store.shopId && getProductQtyInStore(p, store) > 0
                );
                const storeTotalUnits = storeStockedProducts.reduce(
                  (sum, p) => sum + getProductQtyInStore(p, store),
                  0
                );
                const isActive = store.status === 'ACTIVE';

                return (
                  <div
                    key={store.id}
                    className={`bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 ${
                      !isActive ? 'opacity-65' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-slate-950 border border-slate-800 text-blue-400 flex items-center justify-center shrink-0">
                          <Warehouse className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h3 className="text-sm font-bold text-white truncate">
                              {store.name}
                            </h3>
                            {store.isShopFloor && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[9px] font-bold">
                                POS Floor
                              </span>
                            )}
                          </div>
                          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-400 mt-0.5">
                            <span className="inline-flex items-center gap-1 text-slate-300">
                              <StoreIcon className="w-3 h-3 text-slate-500" />
                              {shop?.name || 'Unknown Shop'}
                            </span>
                            {store.location && (
                              <span className="inline-flex items-center gap-1 text-slate-400">
                                <span>·</span>
                                <MapPin className="w-3 h-3 text-slate-500" />
                                {store.location}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`text-[11px] font-semibold ${
                          isActive ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                      <div>
                        <div className="text-[10px] text-slate-500">Store SKUs</div>
                        <div className="font-mono font-semibold text-white tabular-nums mt-0.5">
                          {storeStockedProducts.length}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">Total Units</div>
                        <div className="font-mono font-semibold text-blue-400 tabular-nums mt-0.5">
                          {storeTotalUnits.toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center flex-wrap gap-2 pt-1 border-t border-slate-800/80 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedInventoryStoreId(store.id);
                          setInvStockedOnly(true);
                          setActiveSubTab('inventory');
                        }}
                        className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 font-semibold transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View Inventory</span>
                      </button>
                      {isActive && (
                        <button
                          type="button"
                          onClick={() => openImportModal(store.id)}
                          className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/25 font-semibold transition"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Import</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleExportStoreExcel(store)}
                        className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export</span>
                      </button>
                      {isActive && !store.isShopFloor && (
                        <>
                          <button
                            type="button"
                            onClick={() => openNewTransferForm(store.id)}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 font-semibold transition"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            <span>Transfer</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setListLocationFilter(store.id);
                              setActiveSubTab('list');
                            }}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 border border-indigo-500/25 font-semibold transition"
                          >
                            <ClipboardList className="w-3.5 h-3.5" />
                            <span>List</span>
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditStoreModal(store)}
                        className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingStore(store)}
                        className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 font-semibold transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: STORE INVENTORY BROWSER */}
      {activeSubTab === 'inventory' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2.5 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
                  Select Store View
                </label>
                <select
                  value={selectedInventoryStoreId}
                  onChange={e => setSelectedInventoryStoreId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ALL_COMBINED">
                    All Stores (Grouped by Store)
                  </option>
                  {accessibleStores.map(st => {
                    const sh = accessibleShops.find(s => s.id === st.shopId);
                    return (
                      <option key={st.id} value={st.id}>
                        {st.name}
                        {st.isShopFloor ? ' (POS Floor)' : ''} — {sh?.name || 'Shop'}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
                  Category Filter
                </label>
                <select
                  value={invCategoryFilter}
                  onChange={e => setInvCategoryFilter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ALL">All Categories</option>
                  {accessibleCategories.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
                  Search Product / Variation / Custom Field
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={invSearch}
                    onChange={e => setInvSearch(e.target.value)}
                    placeholder="Name, SKU, variation, custom field..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/70">
              <div className="flex items-center gap-2 flex-wrap">
                {selectedInventoryStore ? (
                  <span className="text-[11px] text-slate-400">
                    Viewing{' '}
                    <strong className="text-white">{selectedInventoryStore.name}</strong>
                    {selectedInventoryStore.isShopFloor ? ' (POS Sellable Floor)' : ' (Warehouse)'}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400">
                    Grouped by store across {inventoryStoreGroups.length} store(s)
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setInvStockedOnly(v => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                    invStockedOnly
                      ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {invStockedOnly ? 'Stocked Here Only' : 'Show All Shop Items'}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openImportModal(selectedInventoryStore?.id)}
                  disabled={activeStores.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold transition disabled:opacity-45"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import Excel</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportInventoryExcel}
                  disabled={inventoryProducts.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-[11px] font-semibold transition disabled:opacity-45"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    Export Excel{selectedInventoryStore ? ` (${selectedInventoryStore.name})` : ''}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {productStoreQtyCache.hasFallbackMultiStoreAttribution && (
            <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl px-3.5 py-2.5 flex items-start gap-2.5 text-[11px] text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Some synced items did not have a per-store tag and are temporarily displayed under each shop&apos;s primary store so all units remain visible. Click or hold any product to <strong>Edit</strong> store quantities or <strong>Transfer</strong> stock.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">SKUs</div>
              <div className="text-base sm:text-lg font-bold text-white font-mono tabular-nums mt-0.5">
                {inventoryTotals.skuCount}
              </div>
              <div className="text-[10px] text-slate-500 font-mono tabular-nums">
                {inventoryTotals.totalUnits.toLocaleString()} units
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Cost Value</div>
              <div className="text-sm sm:text-base font-bold text-purple-300 font-mono tabular-nums mt-0.5 truncate">
                {formatCurrency(inventoryTotals.totalCostValue, settings.currencySymbol)}
              </div>
              <div className="text-[10px] text-slate-500">Purchase basis</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Sale Value</div>
              <div className="text-sm sm:text-base font-bold text-blue-300 font-mono tabular-nums mt-0.5 truncate">
                {formatCurrency(inventoryTotals.totalSaleValue, settings.currencySymbol)}
              </div>
              <div className="text-[10px] text-slate-500">Retail basis</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Potential Profit</div>
              <div className="text-sm sm:text-base font-bold text-emerald-400 font-mono tabular-nums mt-0.5 truncate">
                {formatCurrency(inventoryTotals.potentialProfit, settings.currencySymbol)}
              </div>
              <div className="text-[10px] text-slate-500">Est. margin</div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 px-0.5">
            <span>Tip: Click or press &amp; hold any product card to Edit, Transfer, or Delete.</span>
            <span className="font-mono tabular-nums text-slate-500">
              {inventoryStoreGroups.length} store{inventoryStoreGroups.length === 1 ? '' : 's'}
            </span>
          </div>

          {inventoryStoreGroups.length === 0 || inventoryProducts.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl py-12 px-4 text-center">
              <Package className="w-10 h-10 mx-auto text-slate-600 mb-2" />
              <p className="text-sm font-semibold text-white">No Products Found</p>
              <p className="text-xs text-slate-400 mt-1">
                Try clearing search/category filters or importing store stock via Excel.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {inventoryStoreGroups.map(group => {
                const { store: st, shopName, products: storeProducts } = group;
                const isCollapsed = !!collapsedInvStores[st.id];
                const visibleCount = invVisibleCounts[st.id] ?? STORE_PAGE_SIZE;
                const visibleProducts = storeProducts.slice(0, visibleCount);
                const remaining = Math.max(0, storeProducts.length - visibleCount);

                return (
                  <div
                    key={st.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedInvStores(prev => ({
                          ...prev,
                          [st.id]: !prev[st.id],
                        }))
                      }
                      className="w-full flex items-center justify-between gap-2.5 p-3.5 bg-slate-950/60 hover:bg-slate-900/90 border-b border-slate-800 transition text-left"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`p-2 rounded-xl border shrink-0 ${
                            st.isShopFloor
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                              : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                          }`}
                        >
                          {st.isShopFloor ? (
                            <StoreIcon className="w-4 h-4" />
                          ) : (
                            <Warehouse className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-white truncate">
                              {st.name} Inventory
                            </h3>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                st.isShopFloor
                                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                  : 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                              }`}
                            >
                              {st.isShopFloor ? 'Shop Floor' : 'Store'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {shopName}
                            {st.location ? ` · ${st.location}` : ''} ·{' '}
                            <span className="font-mono text-slate-300">
                              {storeProducts.length.toLocaleString()} SKU{storeProducts.length === 1 ? '' : 's'}
                            </span>{' '}
                            ·{' '}
                            <span className="font-mono text-blue-300 font-semibold">
                              {group.totalUnits.toLocaleString()} units
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="hidden sm:block text-right font-mono tabular-nums">
                          <div className="text-[10px] text-slate-400">Store Sale Value</div>
                          <div className="text-xs font-semibold text-emerald-400">
                            {formatCurrency(group.totalSaleValue, settings.currencySymbol)}
                          </div>
                        </div>
                        {isCollapsed ? (
                          <ChevronRight className="w-5 h-5 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {!isCollapsed && (
                      <>
                        {storeProducts.length === 0 ? (
                          <div className="py-8 px-4 text-center text-xs text-slate-500">
                            No stocked products in {st.name}.
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-800/80">
                            {visibleProducts.map(product => {
                              const cat = accessibleCategories.find(c => c.id === product.categoryId);
                              const storeQty = getProductQtyInStore(product, st);
                              const detail = product.storeDetails?.[st.id];
                              const costVal =
                                detail?.importedPurchaseValue !== undefined
                                  ? detail.importedPurchaseValue
                                  : storeQty * (product.purchasePrice || 0);
                              const saleVal =
                                detail?.importedSaleValue !== undefined
                                  ? detail.importedSaleValue
                                  : storeQty * (product.sellingPrice || 0);

                              const customEntries = product.customFields
                                ? [
                                    product.customFields.field1 && `CF1: ${product.customFields.field1}`,
                                    product.customFields.field2 && `CF2: ${product.customFields.field2}`,
                                    product.customFields.field3 && `CF3: ${product.customFields.field3}`,
                                    product.customFields.field4 && `CF4: ${product.customFields.field4}`,
                                  ].filter(Boolean) as string[]
                                : [];

                              const hasHistorical =
                                (product.historicalUnitsSold || 0) > 0 ||
                                (product.historicalUnitsTransferred || 0) > 0 ||
                                (product.historicalUnitsAdjusted || 0) > 0;

                              return (
                                <div
                                  key={`${st.id}-${product.id}`}
                                  role="button"
                                  tabIndex={0}
                                  onPointerDown={e => handleInventoryCardPointerDown(e, product, st)}
                                  onPointerMove={handleInventoryCardPointerMove}
                                  onPointerUp={handleInventoryCardPointerEnd}
                                  onPointerCancel={handleInventoryCardPointerEnd}
                                  onPointerLeave={handleInventoryCardPointerEnd}
                                  onClick={() => handleInventoryCardClick(product, st)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setActionStoreContext(st);
                                      setActionProduct(product);
                                    }
                                  }}
                                  className="p-3.5 space-y-2.5 text-xs hover:bg-slate-800/35 active:bg-slate-800/60 cursor-pointer select-none transition"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <h4 className="font-bold text-white text-sm truncate">
                                          {product.name}
                                        </h4>
                                        {product.variation && (
                                          <span className="px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px] font-semibold inline-flex items-center gap-1">
                                            <Layers className="w-3 h-3" />
                                            {product.variation}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400 mt-1">
                                        <span className="font-mono">SKU: {product.sku}</span>
                                        {cat && (
                                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                                            <Tag className="w-2.5 h-2.5" />
                                            {cat.name}
                                          </span>
                                        )}
                                        {customEntries.map((cf, idx) => (
                                          <span
                                            key={idx}
                                            className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px]"
                                          >
                                            {cf}
                                          </span>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="flex items-start gap-2 shrink-0">
                                      <div className="text-right">
                                        <div className="text-[10px] text-slate-400">
                                          {st.name}
                                        </div>
                                        <div className="text-base font-bold font-mono tabular-nums text-blue-400">
                                          {storeQty.toLocaleString()} {product.unit}
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        aria-label={`Actions for ${product.name}`}
                                        onPointerDown={e => e.stopPropagation()}
                                        onClick={e => {
                                          e.stopPropagation();
                                          setActionStoreContext(st);
                                          setActionProduct(product);
                                        }}
                                        className="p-1.5 rounded-lg bg-slate-950/70 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition"
                                      >
                                        <MoreVertical className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-[11px]">
                                    <div>
                                      <span className="text-slate-500 block text-[10px]">Buy Price</span>
                                      <span className="font-mono text-slate-300">
                                        {formatCurrency(product.purchasePrice, settings.currencySymbol)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500 block text-[10px]">Sell Price</span>
                                      <span className="font-mono font-semibold text-white">
                                        {formatCurrency(product.sellingPrice, settings.currencySymbol)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500 block text-[10px]">Cost Value</span>
                                      <span className="font-mono text-purple-300">
                                        {formatCurrency(costVal, settings.currencySymbol)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500 block text-[10px]">Sale Value</span>
                                      <span className="font-mono font-semibold text-emerald-400">
                                        {formatCurrency(saleVal, settings.currencySymbol)}
                                      </span>
                                    </div>
                                  </div>

                                  {hasHistorical && (
                                    <div className="flex items-center justify-between flex-wrap gap-2 px-2.5 py-1.5 rounded-lg bg-amber-950/20 border border-amber-500/20 text-[10px] text-amber-200/90">
                                      <span className="inline-flex items-center gap-1 font-semibold">
                                        <History className="w-3 h-3 text-amber-400" />
                                        {product.historicalNote || 'Historical date unavailable'}
                                      </span>
                                      <span className="font-mono tabular-nums">
                                        Sold: {product.historicalUnitsSold || 0} · Transferred:{' '}
                                        {product.historicalUnitsTransferred || 0} · Adjusted:{' '}
                                        {product.historicalUnitsAdjusted || 0}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {storeProducts.length > STORE_PAGE_SIZE && (
                          <div className="p-3 bg-slate-950/40 border-t border-slate-800/80 space-y-2">
                            <div className="text-[10px] text-slate-500 text-center">
                              Showing{' '}
                              <span className="text-slate-300 font-semibold">
                                {Math.min(visibleCount, storeProducts.length).toLocaleString()}
                              </span>{' '}
                              of{' '}
                              <span className="text-slate-300 font-semibold">
                                {storeProducts.length.toLocaleString()}
                              </span>{' '}
                              products in {st.name}
                            </div>
                            <div className="flex items-center gap-2">
                              {visibleCount > STORE_PAGE_SIZE && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setInvVisibleCounts(prev => ({
                                      ...prev,
                                      [st.id]: STORE_PAGE_SIZE,
                                    }))
                                  }
                                  className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 text-[11px] font-semibold transition"
                                >
                                  Show Less
                                </button>
                              )}
                              {remaining > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setInvVisibleCounts(prev => ({
                                      ...prev,
                                      [st.id]: (prev[st.id] ?? STORE_PAGE_SIZE) + STORE_PAGE_SIZE,
                                    }))
                                  }
                                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-[11px] font-semibold shadow transition"
                                >
                                  <ChevronDown className="w-3.5 h-3.5" />
                                  <span>See More ({Math.min(STORE_PAGE_SIZE, remaining)})</span>
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
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: FULL-PAGE STOCK TRANSFER FORM */}
      {activeSubTab === 'transfer' && (
        <div className="space-y-4 w-full">
          <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 sm:px-0 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setEditingTransferId(null);
                  setActiveSubTab('stores');
                }}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition shrink-0"
                aria-label="Back to Stores"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
                  {editingTransferId ? 'Edit Stock Transfer' : 'Transfer Stock'}
                </h2>
                <p className="text-xs text-slate-400 truncate">
                  Supports Store → Shop, Store → Store (same shop), and Shop → Store transfers
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setListLocationFilter('ALL');
                setActiveSubTab('list');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-xs font-semibold transition"
            >
              <ClipboardList className="w-4 h-4" />
              <span>List ({allTransfersConsolidated.length})</span>
            </button>
          </div>

          {sourceLocationOptions.length === 0 ? (
            <div className="mx-3.5 sm:mx-0 bg-slate-900 border border-slate-800 rounded-2xl py-12 px-4 text-center">
              <Warehouse className="w-10 h-10 mx-auto text-slate-600 mb-2.5" />
              <h3 className="text-sm font-semibold text-white">
                No Active Stores Available for Transfer
              </h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Create at least one active warehouse store assigned to a shop before transferring stock.
              </p>
              <button
                type="button"
                onClick={openCreateStoreModal}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create Store</span>
              </button>
            </div>
          ) : (
            <div className="bg-slate-900 border-y sm:border border-slate-800 rounded-none sm:rounded-2xl py-4 sm:py-6 shadow-xl">
              {transferError && (
                <div className="mx-3.5 sm:mx-6 mb-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{transferError}</span>
                </div>
              )}

              <form onSubmit={handleSubmitTransfer} className="space-y-5 text-xs">
                <div className="px-3.5 sm:px-6 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1.5">
                      Select Date *
                    </label>
                    <div
                      onClick={() => {
                        const input = transferDateInputRef.current;
                        if (input) {
                          input.focus();
                          const pickerFn = (input as HTMLInputElement & { showPicker?: () => void })
                            .showPicker;
                          if (typeof pickerFn === 'function') {
                            try {
                              pickerFn.call(input);
                            } catch {
                              // fallback to native click
                            }
                          }
                        }
                      }}
                      className="relative cursor-pointer"
                    >
                      <Calendar className="w-4 h-4 text-blue-400 absolute left-3 top-2.5 pointer-events-none" />
                      <input
                        ref={transferDateInputRef}
                        type="date"
                        required
                        value={transferDate}
                        onChange={e => {
                          setTransferDate(e.target.value);
                          setTransferError('');
                        }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-white text-xs font-mono cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1.5">
                      Transfer Status *
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setTransferStatus('COMPLETED')}
                        className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                          transferStatus === 'COMPLETED'
                            ? 'bg-emerald-600/25 border-emerald-500 text-emerald-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Completed</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTransferStatus('NOT_COMPLETED')}
                        className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                          transferStatus === 'NOT_COMPLETED'
                            ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Not Complete</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="px-3.5 sm:px-6 grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1.5">
                      Location From *
                    </label>
                    <select
                      value={effectiveSourceLocationKey}
                      onChange={e => handleSourceLocationChange(e.target.value)}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">-- Select Location From --</option>
                      {sourceLocationOptions.map(opt => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1.5">
                      Location To *
                    </label>
                    <select
                      value={effectiveDestLocationKey}
                      onChange={e => {
                        setDestLocationKey(e.target.value);
                        setTransferError('');
                      }}
                      disabled={!selectedSourceLocation}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {!selectedSourceLocation ? (
                        <option value="">-- Select Location From first --</option>
                      ) : destLocationOptions.length === 0 ? (
                        <option value="">No valid destination available</option>
                      ) : (
                        <>
                          <option value="">-- Select Location To --</option>
                          {destLocationOptions.map(opt => (
                            <option key={opt.key} value={opt.key}>
                              {opt.label}
                            </option>
                          ))}
                        </>
                      )}
                    </select>
                  </div>
                </div>

                {selectedSourceLocation && selectedDestLocation && (
                  <div className="mx-3.5 sm:mx-6 px-3.5 py-2.5 rounded-xl bg-blue-950/25 border border-blue-500/25 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-300">
                      Route:{' '}
                      <strong className="text-white">{selectedSourceLocation.name}</strong>
                      <span className="mx-2 text-blue-400">→</span>
                      <strong className="text-emerald-300">{selectedDestLocation.name}</strong>
                    </span>
                    <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 font-semibold">
                      {selectedSourceLocation.type === 'STORE' &&
                      selectedDestLocation.type === 'SHOP'
                        ? 'Store → Shop'
                        : selectedSourceLocation.type === 'STORE' &&
                            selectedDestLocation.type === 'STORE'
                          ? 'Store → Store'
                          : 'Shop → Store'}
                    </span>
                  </div>
                )}

                <div className="px-3.5 sm:px-6 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        ref={transferProductSearchRef}
                        type="text"
                        value={productSearch}
                        disabled={!selectedSourceLocation}
                        inputMode="search"
                        autoComplete="off"
                        onChange={e => {
                          setProductSearch(e.target.value);
                          setTransferVisibleLimit(STORE_PAGE_SIZE);
                        }}
                        onKeyDown={handleTransferSearchKeyDown}
                        placeholder={
                          selectedSourceLocation
                            ? 'Search product name, SKU, or barcode — click to add...'
                            : 'Select Location From above to search products...'
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-9 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      />
                      {productSearch && (
                        <button
                          type="button"
                          onClick={() => {
                            setProductSearch('');
                            setTransferVisibleLimit(STORE_PAGE_SIZE);
                            transferProductSearchRef.current?.focus();
                          }}
                          aria-label="Clear search"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {selectedTransferEntries.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTransferMap({});
                          setSelectedTransferOrder([]);
                          setSelectedPriceMap({});
                          setSelectedQueueFilter('');
                          setTransferError('');
                        }}
                        className="shrink-0 px-3 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 active:bg-rose-500/30 border border-rose-500/30 text-rose-300 text-xs font-semibold whitespace-nowrap transition"
                      >
                        Clear All
                      </button>
                    )}
                  </div>

                  {!selectedSourceLocation ? (
                    <p className="text-[11px] text-slate-500 px-1">
                      Choose a <span className="text-slate-300 font-medium">Location From</span>{' '}
                      first, then search and click products to add them below.
                    </p>
                  ) : productSearch.trim() ? (
                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                      <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-400">
                          <strong className="text-white">
                            {storeScopedProducts.length.toLocaleString()}
                          </strong>{' '}
                          match{storeScopedProducts.length === 1 ? '' : 'es'} in{' '}
                          <strong className="text-slate-200">{selectedSourceLocation.name}</strong>{' '}
                          for &ldquo;{productSearch.trim()}&rdquo;
                          {storeScopedProducts.length > 0 ? ' — click a product to add' : ''}
                        </span>
                      </div>

                      {storeScopedProducts.length === 0 ? (
                        otherLocationSearchMatches.length > 0 ? (
                          (() => {
                            const uniqueStockedLabels: string[] = [];
                            for (const m of otherLocationSearchMatches) {
                              for (const loc of m.stockedLocations) {
                                if (!uniqueStockedLabels.includes(loc.label)) {
                                  uniqueStockedLabels.push(loc.label);
                                }
                              }
                            }
                            const formatOrList = (items: string[]) => {
                              if (items.length === 0) return '';
                              if (items.length === 1) return items[0];
                              if (items.length === 2) return `${items[0]} or ${items[1]}`;
                              return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
                            };
                            const sourceNoun =
                              selectedSourceLocation.type === 'STORE'
                                ? `this store (${selectedSourceLocation.name})`
                                : `this shop (${selectedSourceLocation.name})`;

                            return (
                              <div className="p-4 space-y-3">
                                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                  <div className="min-w-0 space-y-1">
                                    <p className="text-xs font-semibold text-amber-200">
                                      {uniqueStockedLabels.length > 0
                                        ? `No this product in ${sourceNoun} — it is in ${formatOrList(uniqueStockedLabels)}.`
                                        : `No this product in ${sourceNoun}.`}
                                    </p>
                                    <p className="text-[11px] text-amber-300/80">
                                      Change <span className="font-semibold">Location From</span> to
                                      where the product is stocked to transfer it.
                                    </p>
                                  </div>
                                </div>

                                <div className="divide-y divide-slate-800/70 rounded-xl border border-slate-800/80 bg-slate-900/40 max-h-56 overflow-y-auto">
                                  {otherLocationSearchMatches.slice(0, 8).map(m => (
                                    <div
                                      key={m.product.id}
                                      className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                                    >
                                      <div className="min-w-0">
                                        <div className="font-medium text-slate-200 truncate">
                                          {m.product.name}
                                          {m.product.variation ? ` (${m.product.variation})` : ''}
                                        </div>
                                        <div className="text-[11px] text-slate-500 font-mono">
                                          {m.product.sku}
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                        {m.stockedLocations.length > 0 ? (
                                          m.stockedLocations.map(loc => (
                                            <span
                                              key={`${m.product.id}-${loc.label}`}
                                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-200 text-[11px] font-medium"
                                            >
                                              <MapPin className="w-3 h-3 text-blue-400" />
                                              <span>
                                                {loc.label}: {loc.qty.toLocaleString()}{' '}
                                                {m.product.unit || 'pcs'}
                                              </span>
                                            </span>
                                          ))
                                        ) : (
                                          <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-[11px]">
                                            0 stock
                                            {m.zeroLocations.length > 0
                                              ? ` (listed in ${formatOrList(m.zeroLocations)})`
                                              : ''}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <div className="py-7 px-4 text-center">
                            <Package className="w-8 h-8 mx-auto text-slate-600 mb-1.5" />
                            <p className="text-xs font-medium text-slate-400">
                              No products match &ldquo;{productSearch.trim()}&rdquo;
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Try a shorter search or check the SKU in {selectedSourceLocation.name}.
                            </p>
                          </div>
                        )
                      ) : (
                        <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/70 overscroll-contain">
                          {storeScopedProducts.slice(0, transferVisibleLimit).map(p => {
                            const qtyHere = getSourceAvailableQty(p);
                            const existingQtyStr = selectedTransferMap[p.id];
                            const isAdded = p.id in selectedTransferMap;
                            const isZeroCopy = transferStatus === 'COMPLETED' && qtyHere <= 0;

                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => handleAddTransferProduct(p)}
                                className={`w-full text-left px-3 py-3 flex items-center justify-between gap-3 transition active:bg-slate-800/80 ${
                                  isAdded
                                    ? 'bg-blue-950/25 hover:bg-blue-950/40'
                                    : 'hover:bg-slate-900/80'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs sm:text-sm font-medium text-white truncate">
                                      {p.name}
                                    </span>
                                    {p.variation && (
                                      <span className="px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px]">
                                        {p.variation}
                                      </span>
                                    )}
                                    {isAdded && (
                                      <span className="px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[10px] font-semibold">
                                        In List ({existingQtyStr})
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center flex-wrap gap-x-2.5 gap-y-0.5 mt-1 text-[11px] text-slate-400 font-mono">
                                    <span>{p.sku}</span>
                                    <span className={qtyHere > 0 ? 'text-blue-400' : 'text-amber-400'}>
                                      Avail: {qtyHere.toLocaleString()} {p.unit}
                                    </span>
                                    <span className="text-emerald-400/90">
                                      {formatCurrency(
                                        Number(p.sellingPrice || p.purchasePrice || 0),
                                        settings.currencySymbol
                                      )}
                                    </span>
                                  </div>
                                </div>

                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold shrink-0 transition ${
                                    isAdded
                                      ? 'bg-blue-600/25 text-blue-200 border border-blue-500/40'
                                      : isZeroCopy
                                        ? 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/35'
                                        : 'bg-blue-600 text-white shadow-sm'
                                  }`}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>
                                    {isAdded ? (isZeroCopy ? 'In List' : '+1') : isZeroCopy ? 'Copy (0)' : 'Add'}
                                  </span>
                                </span>
                              </button>
                            );
                          })}

                          {storeScopedProducts.length > STORE_PAGE_SIZE && (
                            <div className="p-2.5 bg-slate-950 border-t border-slate-800/80 flex items-center gap-2">
                              {transferVisibleLimit > STORE_PAGE_SIZE && (
                                <button
                                  type="button"
                                  onClick={() => setTransferVisibleLimit(STORE_PAGE_SIZE)}
                                  className="flex-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                                >
                                  Show Less
                                </button>
                              )}
                              {storeScopedProducts.length > transferVisibleLimit && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setTransferVisibleLimit(v => v + STORE_PAGE_SIZE)
                                  }
                                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold"
                                >
                                  <ChevronDown className="w-3.5 h-3.5" />
                                  <span>
                                    See More (
                                    {Math.min(
                                      STORE_PAGE_SIZE,
                                      storeScopedProducts.length - transferVisibleLimit
                                    )}
                                    )
                                  </span>
                                </button>
                              )}
                            </div>
                          )}

                          {otherLocationSearchMatches.length > 0 && (
                            <div className="px-3 py-2.5 bg-amber-500/5 border-t border-amber-500/20 text-[11px] text-amber-200/90 space-y-1">
                              <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {otherLocationSearchMatches.length} other matching product
                                  {otherLocationSearchMatches.length === 1 ? '' : 's'} not in{' '}
                                  {selectedSourceLocation.name}:
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-300">
                                {otherLocationSearchMatches.slice(0, 3).map(m => (
                                  <span key={m.product.id}>
                                    <strong className="text-white">{m.product.name}</strong>{' '}
                                    {m.stockedLocations.length > 0
                                      ? `is in ${m.stockedLocations
                                          .map(l => `${l.label} (${l.qty})`)
                                          .join(' or ')}`
                                      : '(0 stock)'}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>

                {selectedTransferEntries.length > 0 && (() => {
                  const qSel = selectedQueueFilter.trim().toLowerCase();
                  const filteredSelected = qSel
                    ? selectedTransferEntries.filter(
                        entry =>
                          entry.product.name.toLowerCase().includes(qSel) ||
                          (entry.product.sku || '').toLowerCase().includes(qSel) ||
                          (entry.product.variation || '').toLowerCase().includes(qSel)
                      )
                    : selectedTransferEntries;

                  return (
                    <div className="mx-0 px-0 bg-slate-950/90 border-y border-blue-500/35 rounded-none overflow-hidden">
                      {selectedTransferEntries.length > 10 && (
                        <div className="px-2.5 sm:px-4 py-2 border-b border-slate-800/70 bg-slate-950/60">
                          <input
                            type="text"
                            value={selectedQueueFilter}
                            onChange={e => {
                              setSelectedQueueFilter(e.target.value);
                              setSelectedQueueVisibleLimit(STORE_PAGE_SIZE);
                            }}
                            placeholder="Filter inside selected products..."
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      )}

                      <div className="overflow-x-auto overflow-y-auto max-h-96">
                        <div className="min-w-[580px] w-full divide-y divide-slate-800/70">
                          <div className="sticky top-0 z-10 flex items-center gap-2.5 px-2.5 sm:px-4 py-2 bg-slate-900/95 border-b border-slate-800 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            <div className="flex-1 min-w-[190px]">Product</div>
                            <div className="w-[112px] shrink-0 text-center">Qty</div>
                            <div className="w-[96px] shrink-0 text-right">Price</div>
                            <div className="w-[96px] shrink-0 text-right">Subtotal</div>
                            <div className="w-7 shrink-0" />
                          </div>

                          {filteredSelected.slice(0, selectedQueueVisibleLimit).map((entry, idx) => (
                            <div
                              key={entry.product.id}
                              className="flex flex-nowrap items-center gap-2.5 px-2.5 sm:px-4 py-2.5 text-xs hover:bg-slate-900/40 transition"
                            >
                              <div className="flex-1 min-w-[190px] overflow-hidden">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-mono text-slate-500 shrink-0">
                                    #{idx + 1}
                                  </span>
                                  <span className="font-semibold text-white truncate">
                                    {entry.product.name}
                                    {entry.product.variation ? ` (${entry.product.variation})` : ''}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                                  {entry.product.sku} · Avail:{' '}
                                  <span
                                    className={
                                      entry.available > 0 ? 'text-blue-300' : 'text-amber-300'
                                    }
                                  >
                                    {entry.available.toLocaleString()} {entry.product.unit || 'pcs'}
                                  </span>
                                </div>
                              </div>

                              <div className="w-[112px] shrink-0 flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  max={
                                    transferStatus === 'COMPLETED'
                                      ? entry.available
                                      : undefined
                                  }
                                  inputMode="numeric"
                                  value={entry.qtyStr}
                                  onChange={e =>
                                    handleChangeSelectedTransferQty(
                                      entry.product.id,
                                      e.target.value
                                    )
                                  }
                                  aria-label={`Quantity for ${entry.product.name}`}
                                  className={`w-16 bg-slate-900 border rounded-lg px-2 py-1 text-right text-xs font-mono text-white focus:outline-none focus:ring-1 ${
                                    entry.isExceeding || entry.isInvalidQty
                                      ? 'border-rose-500 focus:ring-rose-500'
                                      : 'border-slate-700 focus:ring-blue-500'
                                  }`}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleChangeSelectedTransferQty(
                                      entry.product.id,
                                      String(Math.max(0, entry.available))
                                    )
                                  }
                                  className="px-1.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-blue-300 shrink-0"
                                >
                                  Max
                                </button>
                              </div>

                              <div className="w-[96px] shrink-0">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  inputMode="decimal"
                                  value={entry.priceStr}
                                  onChange={e =>
                                    handleChangeSelectedTransferPrice(
                                      entry.product.id,
                                      e.target.value
                                    )
                                  }
                                  aria-label={`Price for ${entry.product.name}`}
                                  className={`w-full bg-slate-900 border rounded-lg px-2 py-1 text-right text-xs font-mono text-white focus:outline-none focus:ring-1 ${
                                    entry.isInvalidPrice
                                      ? 'border-rose-500 focus:ring-rose-500'
                                      : 'border-slate-700 focus:ring-blue-500'
                                  }`}
                                />
                              </div>

                              <div className="w-[96px] shrink-0 text-right font-mono tabular-nums font-bold text-emerald-400 whitespace-nowrap">
                                {formatCurrency(entry.subtotal, settings.currencySymbol)}
                              </div>

                              <div className="w-7 shrink-0 flex justify-end">
                                <button
                                  type="button"
                                  aria-label={`Remove ${entry.product.name}`}
                                  onClick={() => {
                                    setSelectedTransferMap(prev => {
                                      const next = { ...prev };
                                      delete next[entry.product.id];
                                      return next;
                                    });
                                    setSelectedTransferOrder(prev =>
                                      prev.filter(id => id !== entry.product.id)
                                    );
                                    setSelectedPriceMap(prev => {
                                      const next = { ...prev };
                                      delete next[entry.product.id];
                                      return next;
                                    });
                                  }}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {filteredSelected.length > STORE_PAGE_SIZE && (
                        <div className="p-2.5 bg-slate-950/70 border-t border-slate-800/80 flex items-center gap-2">
                          {selectedQueueVisibleLimit > STORE_PAGE_SIZE && (
                            <button
                              type="button"
                              onClick={() => setSelectedQueueVisibleLimit(STORE_PAGE_SIZE)}
                              className="flex-1 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                            >
                              Show Less
                            </button>
                          )}
                          {filteredSelected.length > selectedQueueVisibleLimit && (
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedQueueVisibleLimit(v => v + STORE_PAGE_SIZE)
                              }
                              className="flex-1 flex items-center justify-center gap-1 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                              <span>
                                See More (
                                {Math.min(
                                  STORE_PAGE_SIZE,
                                  filteredSelected.length - selectedQueueVisibleLimit
                                )}
                                )
                              </span>
                            </button>
                          )}
                        </div>
                      )}

                      <div className="px-2.5 sm:px-4 py-3 bg-slate-950 border-t border-blue-500/25 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-300">
                          Total ({transferSelectionSummary.selectedCount} product
                          {transferSelectionSummary.selectedCount === 1 ? '' : 's'} ·{' '}
                          {transferSelectionSummary.totalUnits.toLocaleString()} units)
                        </span>
                        <span className="text-base font-bold font-mono tabular-nums text-emerald-400">
                          {formatCurrency(
                            transferSelectionSummary.totalAmount,
                            settings.currencySymbol
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                <div className="px-3.5 sm:px-6 grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1.5">
                      Shipping Charges (Optional)
                    </label>
                    <div className="relative">
                      <Truck className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={shippingCharges}
                        onChange={e => setShippingCharges(e.target.value)}
                        placeholder="0"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1.5">
                      Notice (Optional)
                    </label>
                    <div className="relative">
                      <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={transferNotes}
                        onChange={e => setTransferNotes(e.target.value)}
                        placeholder="e.g. Driver Ali · Urgent branch refill"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                {transferProgressPct !== null && (
                  <div className="mx-3.5 sm:mx-6 bg-slate-950 border border-blue-500/40 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-blue-300 flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>
                          {editingTransferId ? 'Updating transfer...' : 'Processing transfer...'}
                        </span>
                      </span>
                      <span className="font-mono font-bold text-white">
                        {transferProgressPct}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-200"
                        style={{ width: `${transferProgressPct}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="px-3.5 sm:px-6 pt-2 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-slate-300 font-mono tabular-nums space-y-0.5">
                    <div>
                      Products Total:{' '}
                      <strong className="text-white">
                        {formatCurrency(
                          transferSelectionSummary.totalAmount,
                          settings.currencySymbol
                        )}
                      </strong>
                      {transferSelectionSummary.shippingNum > 0 && (
                        <span className="text-slate-400">
                          {' '}
                          + Shipping:{' '}
                          <strong className="text-amber-300">
                            {formatCurrency(
                              transferSelectionSummary.shippingNum,
                              settings.currencySymbol
                            )}
                          </strong>
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-emerald-400 font-bold">
                      Grand Total:{' '}
                      {formatCurrency(
                        transferSelectionSummary.grandTotal,
                        settings.currencySymbol
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {editingTransferId && (
                      <button
                        type="button"
                        disabled={transferProgressPct !== null}
                        onClick={() => {
                          setEditingTransferId(null);
                          setActiveSubTab('list');
                        }}
                        className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                      >
                        Cancel Edit
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={
                        transferProgressPct !== null ||
                        !effectiveSourceLocationKey ||
                        !effectiveDestLocationKey ||
                        transferSelectionSummary.selectedCount === 0 ||
                        transferSelectionSummary.selectedCount > MAX_BATCH_TRANSFER_PRODUCTS ||
                        transferSelectionSummary.invalidCount > 0
                      }
                      className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold transition disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {transferProgressPct !== null
                          ? `Transferring (${transferProgressPct}%)...`
                          : editingTransferId
                            ? 'Save Changes'
                            : 'Transfer'}
                      </span>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: FULL-PAGE TRANSFERRED PRODUCTS LIST */}
      {activeSubTab === 'list' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setActiveSubTab('stores')}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition shrink-0"
                aria-label="Back to Stores"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
                  Transferred Products List
                </h2>
                <p className="text-xs text-slate-400 truncate">
                  Consolidated transfer batches across Store → Shop, Store → Store, and Shop → Store
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => openNewTransferForm()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span>Transfer Stock</span>
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                  Transfer Period
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {transferStartDate === transferEndDate
                  ? transferStartDate
                  : `${transferStartDate || '...'} → ${transferEndDate || '...'}`}{' '}
                ·{' '}
                <strong className="text-white">
                  {filteredTransferList.length.toLocaleString()}
                </strong>{' '}
                transfer{filteredTransferList.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  {
                    id: 'TODAY',
                    label: 'Today',
                    activeClass:
                      'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/30',
                    idleClass:
                      'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20',
                  },
                  {
                    id: 'WEEKLY',
                    label: 'Weekly',
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
                const isActive = transferDatePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setTransferDatePreset(preset.id)}
                    className={`py-2 rounded-lg border text-[11px] font-semibold transition active:scale-95 ${
                      isActive ? preset.activeClass : preset.idleClass
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {transferDatePreset === 'CUSTOM' && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">From</label>
                  <input
                    type="date"
                    value={transferStartDate}
                    onChange={e => setTransferStartDate(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white w-full focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">To</label>
                  <input
                    type="date"
                    value={transferEndDate}
                    onChange={e => setTransferEndDate(e.target.value)}
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
                  value={listSearchQuery}
                  onChange={e => setListSearchQuery(e.target.value)}
                  placeholder="Search transfer #, location, notice, or product..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <select
                value={listLocationFilter}
                onChange={e => setListLocationFilter(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">All Stores &amp; Shop Locations</option>
                {sourceLocationOptions.map(opt => (
                  <option key={opt.key} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredTransferList.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl py-12 px-4 text-center">
              <ClipboardList className="w-10 h-10 mx-auto text-slate-600 mb-2" />
              <p className="text-sm font-semibold text-white">No Transfers Found</p>
              <p className="text-xs text-slate-400 mt-1">
                No stock transfers recorded for the selected dates and location filter.
              </p>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950 border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Location From</th>
                      <th className="py-3 px-4">Location To</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Shipping</th>
                      <th className="py-3 px-4 text-right">Total Amount</th>
                      <th className="py-3 px-4 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filteredTransferList.slice(0, listVisibleLimit).map(t => (
                      <tr key={t.id} className="hover:bg-slate-800/35 transition">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-mono font-semibold text-white">
                            {t.transferDate || t.createdAt.slice(0, 10)}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">
                            {t.transferNumber}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-100">{t.sourceName}</div>
                          <div className="text-[10px] text-slate-400">
                            {t.sourceLocation || t.sourceShopName || ''}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-emerald-300">{t.destName}</div>
                          <div className="text-[10px] text-slate-400">
                            {t.destLocation || t.destShopName || ''}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                              t.status === 'COMPLETED'
                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                            }`}
                          >
                            {t.status === 'COMPLETED' ? 'Completed' : 'Not Complete'}
                          </span>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                            {t.items.length} item{t.items.length === 1 ? '' : 's'} ·{' '}
                            {t.totalUnits.toLocaleString()} units
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {formatCurrency(t.shippingCharges || 0, settings.currencySymbol)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-bold text-white">
                            {formatCurrency(t.totalAmount || 0, settings.currencySymbol)}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              title="View"
                              onClick={() => {
                                setViewingTransferId(t.id);
                                setActiveSubTab('transfer_view');
                              }}
                              className="p-1.5 rounded-lg bg-blue-600/15 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 transition"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Print Transfer Voucher"
                              disabled={printingTransferId === t.id}
                              onClick={() => handlePrintTransfer(t)}
                              className="p-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 transition disabled:opacity-50"
                            >
                              {printingTransferId === t.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Printer className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              title="Download PDF"
                              disabled={downloadingTransferId === t.id}
                              onClick={() => handleDownloadTransfer(t)}
                              className="p-1.5 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 transition disabled:opacity-50"
                            >
                              {downloadingTransferId === t.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              title="Edit"
                              onClick={() => openEditTransferForm(t)}
                              className="p-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 transition"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Delete"
                              onClick={() => setDeletingTransfer(t)}
                              className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-slate-800/80">
                {filteredTransferList.slice(0, listVisibleLimit).map(t => (
                  <div key={t.id} className="p-3.5 space-y-2.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono font-bold text-white">
                          {t.transferDate || t.createdAt.slice(0, 10)} ·{' '}
                          <span className="text-blue-400">{t.transferNumber}</span>
                        </div>
                        <div className="text-[11px] text-slate-300 mt-1">
                          <span className="font-semibold text-white">{t.sourceName}</span>
                          <span className="mx-1.5 text-blue-400">→</span>
                          <span className="font-semibold text-emerald-300">{t.destName}</span>
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${
                          t.status === 'COMPLETED'
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                            : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                        }`}
                      >
                        {t.status === 'COMPLETED' ? 'Completed' : 'Not Complete'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 bg-slate-950/70 border border-slate-800 rounded-lg p-2 text-[11px] font-mono tabular-nums">
                      <div>
                        <span className="text-[9px] text-slate-500 block uppercase">Items</span>
                        <span className="text-slate-200 font-semibold">
                          {t.items.length} ({t.totalUnits})
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block uppercase">Shipping</span>
                        <span className="text-slate-200">
                          {formatCurrency(t.shippingCharges || 0, settings.currencySymbol)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] text-slate-500 block uppercase">Total</span>
                        <span className="text-emerald-400 font-bold">
                          {formatCurrency(t.totalAmount || 0, settings.currencySymbol)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-5 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setViewingTransferId(t.id);
                          setActiveSubTab('transfer_view');
                        }}
                        className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-300 text-[11px] font-semibold"
                      >
                        <Eye className="w-3 h-3" />
                        <span>View</span>
                      </button>
                      <button
                        type="button"
                        disabled={printingTransferId === t.id}
                        onClick={() => handlePrintTransfer(t)}
                        className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-indigo-600/15 border border-indigo-500/30 text-indigo-300 text-[11px] font-semibold disabled:opacity-50"
                      >
                        {printingTransferId === t.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Printer className="w-3 h-3" />
                        )}
                        <span>Print</span>
                      </button>
                      <button
                        type="button"
                        disabled={downloadingTransferId === t.id}
                        onClick={() => handleDownloadTransfer(t)}
                        className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-600/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold disabled:opacity-50"
                      >
                        {downloadingTransferId === t.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Download className="w-3 h-3" />
                        )}
                        <span>PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditTransferForm(t)}
                        className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-semibold"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingTransfer(t)}
                        className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] font-semibold"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Del</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {filteredTransferList.length > STORE_PAGE_SIZE && (
                <div className="p-3 bg-slate-950/60 border-t border-slate-800 space-y-2">
                  <div className="text-[10px] text-slate-500 text-center">
                    Showing{' '}
                    <span className="text-slate-300 font-semibold">
                      {Math.min(listVisibleLimit, filteredTransferList.length).toLocaleString()}
                    </span>{' '}
                    of{' '}
                    <span className="text-slate-300 font-semibold">
                      {filteredTransferList.length.toLocaleString()}
                    </span>{' '}
                    transfers
                  </div>
                  <div className="flex items-center gap-2">
                    {listVisibleLimit > STORE_PAGE_SIZE && (
                      <button
                        type="button"
                        onClick={() => setListVisibleLimit(STORE_PAGE_SIZE)}
                        className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition"
                      >
                        Show Less
                      </button>
                    )}
                    {filteredTransferList.length > listVisibleLimit && (
                      <button
                        type="button"
                        onClick={() => setListVisibleLimit(v => v + STORE_PAGE_SIZE)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                        <span>
                          See More (
                          {Math.min(
                            STORE_PAGE_SIZE,
                            filteredTransferList.length - listVisibleLimit
                          )}
                          )
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 5: FULL-PAGE TRANSFER VIEW DETAILS */}
      {activeSubTab === 'transfer_view' && viewingTransfer && (
        <div className="space-y-4 w-full">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setActiveSubTab('list')}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition shrink-0"
                aria-label="Back to Transfer List"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                    Transfer {viewingTransfer.transferNumber}
                  </h2>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                      viewingTransfer.status === 'COMPLETED'
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                    }`}
                  >
                    {viewingTransfer.status === 'COMPLETED' ? 'Completed' : 'Not Complete'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Date: {viewingTransfer.transferDate} · Recorded by{' '}
                  {viewingTransfer.createdByName || 'Admin'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={printingTransferId === viewingTransfer.id}
                onClick={() => handlePrintTransfer(viewingTransfer)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/35 text-indigo-300 hover:text-white text-xs font-semibold transition disabled:opacity-50"
              >
                {printingTransferId === viewingTransfer.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Printer className="w-4 h-4" />
                )}
                <span>{printingTransferId === viewingTransfer.id ? 'Printing...' : 'Print'}</span>
              </button>
              <button
                type="button"
                disabled={downloadingTransferId === viewingTransfer.id}
                onClick={() => handleDownloadTransfer(viewingTransfer)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition disabled:opacity-50"
              >
                {downloadingTransferId === viewingTransfer.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>
                  {downloadingTransferId === viewingTransfer.id ? 'Generating...' : 'Download PDF'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => openEditTransferForm(viewingTransfer)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold transition"
              >
                <Edit3 className="w-4 h-4" />
                <span>Edit</span>
              </button>
              <button
                type="button"
                onClick={() => setDeletingTransfer(viewingTransfer)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-xs font-semibold transition"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-1">
                Location From
              </div>
              <div className="text-sm font-bold text-white">{viewingTransfer.sourceName}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {viewingTransfer.sourceShopName || 'Shop'}
                {viewingTransfer.sourceLocation ? ` · ${viewingTransfer.sourceLocation}` : ''}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1">
                Location To
              </div>
              <div className="text-sm font-bold text-white">{viewingTransfer.destName}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {viewingTransfer.destShopName || 'Shop'}
                {viewingTransfer.destLocation ? ` · ${viewingTransfer.destLocation}` : ''}
              </div>
            </div>
          </div>

          {viewingTransfer.notice && (
            <div className="bg-amber-950/20 border border-amber-500/30 rounded-xl px-4 py-2.5 text-xs text-amber-200">
              <strong className="text-amber-300">Notice:</strong> {viewingTransfer.notice}
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950 border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-3 px-4 w-10">#</th>
                    <th className="py-3 px-4">Product Name</th>
                    <th className="py-3 px-4 text-right">Quantity</th>
                    <th className="py-3 px-4 text-right">Price</th>
                    <th className="py-3 px-4 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {viewingTransfer.items.map((item, idx) => (
                    <tr key={item.id || `${item.productId}-${idx}`} className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-mono text-slate-500">{idx + 1}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">
                          {item.productName}
                          {item.variation ? ` (${item.variation})` : ''}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">SKU: {item.sku}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                        {item.quantity.toLocaleString()} {item.unit || 'pcs'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300">
                        {formatCurrency(item.unitPrice, settings.currencySymbol)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-emerald-400">
                        {formatCurrency(item.subtotal, settings.currencySymbol)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-1.5 text-xs font-mono tabular-nums">
              <div className="flex justify-between text-slate-400">
                <span>
                  Total Products ({viewingTransfer.items.length} items ·{' '}
                  {viewingTransfer.totalUnits.toLocaleString()} units)
                </span>
                <span className="text-white font-semibold">
                  {formatCurrency(viewingTransfer.totalAmount, settings.currencySymbol)}
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Shipping Charges</span>
                <span className="text-amber-300">
                  {formatCurrency(viewingTransfer.shippingCharges || 0, settings.currencySymbol)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-800 text-sm font-bold text-emerald-400">
                <span>Total Price</span>
                <span>
                  {formatCurrency(
                    (viewingTransfer.totalAmount || 0) + (viewingTransfer.shippingCharges || 0),
                    settings.currencySymbol
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Store Modal */}
      {isStoreModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <Warehouse className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">
                  {editingStore ? 'Edit Store' : 'Create Store'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsStoreModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {storeFormError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{storeFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveStore} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Shop Assignment *
                </label>
                <select
                  value={storeShopId}
                  onChange={e => setStoreShopId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="" disabled>
                    Select shop...
                  </option>
                  {accessibleShops.map(sh => (
                    <option key={sh.id} value={sh.id}>
                      {sh.name} ({sh.code || 'UNIT'})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  A shop can have multiple stores (warehouses).
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Store Name *
                </label>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={e => setStoreName(e.target.value)}
                  placeholder="e.g. Kariakoo Main Store"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Location (Optional)
                </label>
                <input
                  type="text"
                  value={storeLocation}
                  onChange={e => setStoreLocation(e.target.value)}
                  placeholder="e.g. Block C, Ground Floor"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsStoreModalOpen(false)}
                  className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={accessibleShops.length === 0}
                  className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition disabled:opacity-50"
                >
                  {editingStore ? 'Save Changes' : 'Create Store'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Store 4-Column Excel Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-lg w-full p-4 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-base font-bold text-white">Import Excel to Store</h3>
                  <p className="text-[11px] text-slate-400">
                    Accepts: Product Name, Buying Price, Selling Price, Quantity
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isParsingImport || isCommittingImport}
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Target Store <span className="text-rose-400">*</span>
                </label>
                <select
                  value={importTargetStoreId}
                  disabled={isParsingImport || isCommittingImport}
                  onChange={e => setImportTargetStoreId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                >
                  <option value="">-- Select a store --</option>
                  {activeStores.map(st => {
                    const sh = accessibleShops.find(s => s.id === st.shopId);
                    return (
                      <option key={st.id} value={st.id}>
                        {st.name}
                        {st.isShopFloor ? ' (POS Floor)' : ''} — {sh?.name || 'Shop'}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Excel File (.xlsx / .xls / .csv) <span className="text-rose-400">*</span>
                </label>
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  disabled={!importTargetStoreId || isParsingImport || isCommittingImport}
                  onChange={handleStoreExcelFileSelected}
                  className="w-full bg-slate-950 text-xs text-slate-300 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 cursor-pointer p-1.5 rounded-xl border border-slate-800 disabled:opacity-40"
                />
                {!importTargetStoreId && (
                  <p className="text-[10px] text-amber-400 mt-1">
                    Select a store above to enable file upload.
                  </p>
                )}
              </div>

              <div className="p-3 bg-blue-950/30 border border-blue-800/40 rounded-xl text-[11px] text-blue-200">
                <strong>Expected Excel Columns:</strong>
                <div className="mt-1 font-mono text-[10px] text-blue-100 overflow-x-auto whitespace-nowrap">
                  Product Name | Buying Price | Selling Price | Quantity
                </div>
              </div>
            </div>

            {(isParsingImport || isCommittingImport) && (
              <ImportProgressBar
                progress={importProgress}
                phaseLabel={isCommittingImport ? 'Importing Products' : undefined}
              />
            )}

            {importParseResult && !isParsingImport && (
              <div className="space-y-3 border-t border-slate-800 pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white truncate">
                    {importFile?.name || 'Spreadsheet'}
                  </span>
                  <span className="text-[11px] text-slate-400 shrink-0">
                    Valid:{' '}
                    <strong className="text-emerald-400">
                      {importParseResult.rows.length.toLocaleString()}
                    </strong>{' '}
                    · Errors:{' '}
                    <strong className="text-rose-400">
                      {importParseResult.errors.length.toLocaleString()}
                    </strong>
                  </span>
                </div>

                {importParseResult.errors.length > 0 && (
                  <div className="p-2.5 bg-rose-950/25 border border-rose-800/40 rounded-xl max-h-32 overflow-y-auto space-y-1 text-[11px] text-rose-200">
                    {importParseResult.errors.slice(0, 50).map((err, i) => (
                      <div key={i}>
                        <span className="font-mono text-[10px] bg-rose-900/60 px-1 py-0.2 rounded mr-1.5">
                          Row {err.rowNumber}
                        </span>
                        {err.message}
                      </div>
                    ))}
                    {importParseResult.errors.length > 50 && (
                      <div className="text-[10px] text-rose-300/80 pt-1 border-t border-rose-900/40">
                        Showing first 50 of {importParseResult.errors.length.toLocaleString()} errors.
                      </div>
                    )}
                  </div>
                )}

                {importParseResult.rows.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {importParseResult.rows.slice(0, 15).map((r, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs flex items-center justify-between gap-2"
                      >
                        <span className="font-semibold text-white truncate">{r.productName}</span>
                        <span className="text-[11px] font-mono text-slate-400 shrink-0">
                          Buy {r.buyingPrice.toLocaleString()} ·{' '}
                          <strong className="text-emerald-400">{r.sellingPrice.toLocaleString()}</strong> · Qty{' '}
                          <strong className="text-blue-300">{r.quantity}</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                disabled={isParsingImport || isCommittingImport}
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition disabled:opacity-45 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommitStoreExcelImport}
                disabled={
                  isParsingImport ||
                  isCommittingImport ||
                  !importTargetStoreId ||
                  !importParseResult ||
                  importParseResult.rows.length === 0
                }
                className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {isCommittingImport
                    ? `Importing (${Math.round(importProgress?.percent ?? 0)}%)...`
                    : `Import (${(importParseResult?.rows.length || 0).toLocaleString()}) to ${
                        activeStores.find(s => s.id === importTargetStoreId)?.name || 'Store'
                      }`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Store Delete Confirmation Modal */}
      {deletingStore && (() => {
        const deletingShop = accessibleShops.find(s => s.id === deletingStore.shopId);
        const stockedItems = accessibleProducts.filter(
          p => p.shopId === deletingStore.shopId && getProductQtyInStore(p, deletingStore) > 0
        );
        const stockedUnits = stockedItems.reduce(
          (sum, p) => sum + getProductQtyInStore(p, deletingStore),
          0
        );
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
            <div className="bg-slate-900 border border-rose-800/60 rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5 text-rose-400">
                  <div className="p-2 rounded-xl bg-rose-950/80 border border-rose-800/50">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-white">Delete Store?</h3>
                    <p className="text-[11px] text-slate-400">
                      {deletingStore.name}
                      {deletingShop ? ` — ${deletingShop.name}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDeletingStore(null)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5">
                <p>
                  Are you sure you want to permanently delete{' '}
                  <strong className="text-white">{deletingStore.name}</strong>?
                </p>
                {stockedUnits > 0 ? (
                  <p className="text-amber-300 text-[11px]">
                    This store currently holds{' '}
                    <strong className="font-mono">{stockedUnits.toLocaleString()}</strong> units across{' '}
                    <strong className="font-mono">{stockedItems.length}</strong> product(s).
                    Deleting the store removes its store-level stock count while preserving sales history and shop floor inventory.
                  </p>
                ) : (
                  <p className="text-slate-400 text-[11px]">
                    This action removes the store from Stores &amp; Transfers and queues deletion across synced devices.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDeletingStore(null)}
                  className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmDeleteStore(deletingStore)}
                  className="px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Store</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Store Inventory Product Click / Hold Action Modal (Edit, Transfer, Delete) */}
      {actionProduct && (() => {
        const shopName = accessibleShops.find(s => s.id === actionProduct.shopId)?.name || 'Shop';
        const effectiveContextStore = actionStoreContext || selectedInventoryStore;
        const contextQty = effectiveContextStore
          ? getProductQtyInStore(actionProduct, effectiveContextStore)
          : getProductTotalTrackedUnits(actionProduct);
        return (
          <div
            onClick={() => {
              setActionProduct(null);
              setActionStoreContext(null);
            }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4"
          >
            <div
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-sm w-full p-4 sm:p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                    {effectiveContextStore ? effectiveContextStore.name : shopName}
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-white truncate mt-0.5">
                    {actionProduct.name}
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400 mt-1 font-mono">
                    <span>SKU: {actionProduct.sku}</span>
                    <span>·</span>
                    <span className="text-blue-300 font-semibold">
                      {contextQty.toLocaleString()} {actionProduct.unit || 'pcs'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActionProduct(null);
                    setActionStoreContext(null);
                  }}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <button
                  type="button"
                  onClick={() => handleOpenEditProductFromAction(actionProduct)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 text-left text-blue-200 transition"
                >
                  <div className="w-9 h-9 rounded-lg bg-blue-600/25 border border-blue-500/40 flex items-center justify-center text-blue-300 shrink-0">
                    <Edit3 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-white">Edit Product &amp; Stock</div>
                    <div className="text-[11px] text-slate-400">
                      Update name, prices, or per-store quantities
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenTransferFromAction(actionProduct)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-left text-emerald-200 transition"
                >
                  <div className="w-9 h-9 rounded-lg bg-emerald-600/25 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0">
                    <ArrowRightLeft className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-white">Transfer Stock</div>
                    <div className="text-[11px] text-slate-400">
                      Move units from store warehouse to shop floor
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const target = actionProduct;
                    setActionProduct(null);
                    setDeletingProduct(target);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/30 text-left text-rose-200 transition"
                >
                  <div className="w-9 h-9 rounded-lg bg-rose-600/25 border border-rose-500/40 flex items-center justify-center text-rose-300 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-white">Delete Product</div>
                    <div className="text-[11px] text-slate-400">
                      Permanently remove this item from catalog &amp; stores
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Product from Store Inventory Modal */}
      {editingProduct && (() => {
        const warehouseStoresInShop = accessibleStores
          .filter(st => st.shopId === editingProduct.shopId && !st.isShopFloor)
          .sort((a, b) => {
            if (selectedInventoryStore?.id === a.id) return -1;
            if (selectedInventoryStore?.id === b.id) return 1;
            return a.name.localeCompare(b.name);
          });
        const shopCategories = accessibleCategories.filter(
          c => c.shopId === editingProduct.shopId
        );

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-lg w-full p-4 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
                <div className="flex items-center gap-2">
                  <Edit3 className="w-5 h-5 text-blue-400" />
                  <div>
                    <h3 className="text-base font-bold text-white">Edit Store Product</h3>
                    <p className="text-[11px] text-slate-400 truncate max-w-[260px]">
                      {editingProduct.name} ({editingProduct.sku})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isSavingProductEdit}
                  onClick={() => setEditingProduct(null)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {editProdError && (
                <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editProdError}</span>
                </div>
              )}

              <form onSubmit={handleSaveEditedProduct} className="space-y-3.5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Product Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={editProdName}
                      onChange={e => setEditProdName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Variation
                    </label>
                    <input
                      type="text"
                      value={editProdVariation}
                      onChange={e => setEditProdVariation(e.target.value)}
                      placeholder="e.g. 500ml, Red, 12V"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">SKU *</label>
                    <input
                      type="text"
                      required
                      value={editProdSku}
                      onChange={e => setEditProdSku(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Unit</label>
                    <input
                      type="text"
                      value={editProdUnit}
                      onChange={e => setEditProdUnit(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-slate-300 font-medium mb-1">Category</label>
                    <select
                      value={editProdCategoryId}
                      onChange={e => setEditProdCategoryId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {shopCategories.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Buy Price *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={editProdPurchasePrice}
                      onChange={e => setEditProdPurchasePrice(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Sell Price *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={editProdSellingPrice}
                      onChange={e => setEditProdSellingPrice(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Min Alert
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editProdMinStock}
                      onChange={e => setEditProdMinStock(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2.5">
                  <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                    Stock Quantities by Store
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {warehouseStoresInShop.map(st => {
                      const isCurrent = selectedInventoryStore?.id === st.id;
                      return (
                        <div key={st.id}>
                          <label
                            className={`block text-[11px] font-medium mb-1 ${
                              isCurrent ? 'text-blue-300 font-semibold' : 'text-slate-400'
                            }`}
                          >
                            {st.name}
                            {isCurrent ? ' (Current)' : ''}
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editProdStoreQtys[st.id] ?? '0'}
                            onChange={e =>
                              setEditProdStoreQtys(prev => ({
                                ...prev,
                                [st.id]: e.target.value,
                              }))
                            }
                            className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                              isCurrent ? 'border-blue-500/60' : 'border-slate-800'
                            }`}
                          />
                        </div>
                      );
                    })}
                    <div>
                      <label className="block text-[11px] font-medium text-emerald-300 mb-1">
                        Shop Floor (POS Stock)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={editProdFloorStock}
                        onChange={e => setEditProdFloorStock(e.target.value)}
                        className="w-full bg-slate-900 border border-emerald-500/40 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={isSavingProductEdit}
                    onClick={() => setEditingProduct(null)}
                    className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProductEdit}
                    className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition disabled:opacity-50"
                  >
                    {isSavingProductEdit ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Delete Product from Store Inventory Confirmation Modal */}
      {deletingProduct && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
          <div className="bg-slate-900 border border-rose-800/60 rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5 text-rose-400">
                <div className="p-2 rounded-xl bg-rose-950/80 border border-rose-800/50">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">Delete Product?</h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    SKU: {deletingProduct.sku}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5">
              <p>
                Are you sure you want to permanently delete{' '}
                <strong className="text-white">{deletingProduct.name}</strong>?
              </p>
              <p className="text-amber-300 text-[11px]">
                Tracked stock:{' '}
                <strong className="font-mono">
                  {getProductTotalTrackedUnits(deletingProduct).toLocaleString()}
                </strong>{' '}
                {deletingProduct.unit || 'pcs'}. Deleting removes this item from all stores and POS catalog while preserving past receipts.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteProduct}
                className="px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Product</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Transfer Confirmation Modal */}
      {deletingTransfer && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
          <div className="bg-slate-900 border border-rose-800/60 rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5 text-rose-400">
                <div className="p-2 rounded-xl bg-rose-950/80 border border-rose-800/50">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    Delete Stock Transfer?
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {deletingTransfer.transferNumber} · {deletingTransfer.transferDate}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingTransfer(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5">
              <p>
                Delete transfer from{' '}
                <strong className="text-white">{deletingTransfer.sourceName}</strong> to{' '}
                <strong className="text-emerald-300">{deletingTransfer.destName}</strong> (
                <strong className="font-mono">
                  {deletingTransfer.items.length} product
                  {deletingTransfer.items.length === 1 ? '' : 's'}
                </strong>
                ,{' '}
                <strong className="font-mono">
                  {deletingTransfer.totalUnits.toLocaleString()} units
                </strong>
                )?
              </p>
              {deletingTransfer.status === 'COMPLETED' ? (
                <p className="text-amber-300 text-[11px]">
                  This transfer is marked <strong>Completed</strong>. Deleting it will automatically reverse and restore the transferred quantities back to{' '}
                  <strong>{deletingTransfer.sourceName}</strong>.
                </p>
              ) : (
                <p className="text-slate-400 text-[11px]">
                  This transfer is marked Not Complete, so no stock balances will be altered.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeletingTransfer(null)}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDeleteTransfer(deletingTransfer)}
                className="px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Transfer</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
