import React, { useState, useEffect } from 'react';
import {
  Search,
  Receipt,
  Calendar,
  X,
  Ban,
  RotateCcw,
  Printer,
  Download,
  Pencil,
  Check,
  Clock,
  RefreshCw,
  ClipboardList,
  ArrowLeft,
  Store,
  User as UserIcon,
  ChevronDown,
  Loader2,
  Package,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SalesService, CartItemInput } from '../../services/salesService';
import { CloudflareApi } from '../../services/cloudflareApi';
import { SyncService } from '../../services/syncService';
import { db } from '../../db/storage';
import { Product, Sale, SaleEditRequest } from '../../types';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  downloadSaleEditsReportPdf,
  formatSaleEditDetails,
  printSaleEditsReportPdf,
} from '../../utils/saleEditsPrint';
import {
  downloadSalesReportPdf,
  printSalesReportPdf,
  downloadSoldProductsSummaryPdf,
  printSoldProductsSummaryPdf,
  SoldProductSummaryRow,
} from '../../utils/pdfExport';
import { saveTextFileCrossPlatform } from '../../utils/nativeDownload';
import {
  getAdminManagedShops,
  getShopAdminShopIds,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../../utils/permissions';

type DatePreset = 'TODAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM';
type EditListPreset = 'ALL' | DatePreset;

const SALES_PAGE_SIZE = 15;

export const AdminSales: React.FC = () => {
  const { currentUser, showReceipt, dbState, addToast } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCurrentPeriodOnly, setSearchCurrentPeriodOnly] = useState(false);
  const [sellerFilter, setSellerFilter] = useState('ALL');
  const [paymentFilter, setPaymentFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [shopFilter, setShopFilter] = useState('ALL');
  const [datePreset, setDatePreset] = useState<DatePreset>('TODAY');

  // ---------- Date helpers ----------
  const toYMD = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const computePresetRange = (
    preset: DatePreset
  ): { start: string; end: string } | null => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (preset === 'TODAY') {
      return { start: toYMD(today), end: toYMD(today) };
    }

    if (preset === 'WEEK') {
      const start = new Date(today);
      start.setDate(start.getDate() - 6); // last 7 days rolling
      return { start: toYMD(start), end: toYMD(today) };
    }

    if (preset === 'MONTH') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: toYMD(start), end: toYMD(today) };
    }

    if (preset === 'YEAR') {
      const start = new Date(today.getFullYear(), 0, 1);
      return { start: toYMD(start), end: toYMD(today) };
    }

    return null; // CUSTOM
  };

  const initialTodayRange = computePresetRange('TODAY')!;
  const [startDate, setStartDate] = useState<string>(() => initialTodayRange.start);
  const [endDate, setEndDate] = useState<string>(() => initialTodayRange.end);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isDownloadingSoldProductsPdf, setIsDownloadingSoldProductsPdf] = useState(false);
  const [isPrintingSoldProductsPdf, setIsPrintingSoldProductsPdf] = useState(false);
  const [isPrintingEditList, setIsPrintingEditList] = useState(false);
  const [isDownloadingEditList, setIsDownloadingEditList] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Per-group pagination (default 15 per group, expand +15)
  const [groupVisibleCounts, setGroupVisibleCounts] = useState<Record<string, number>>({});

  // Full-page Edit List (Approved & Rejected edits)
  const [showEditListPage, setShowEditListPage] = useState(false);
  const [editListSearch, setEditListSearch] = useState('');
  const [editListStatus, setEditListStatus] = useState<'ALL' | 'APPROVED' | 'REJECTED'>('ALL');
  const [editListShopFilter, setEditListShopFilter] = useState('ALL');
  const [editListPreset, setEditListPreset] = useState<EditListPreset>('ALL');
  const [editListStartDate, setEditListStartDate] = useState('');
  const [editListEndDate, setEditListEndDate] = useState('');
  const [editListVisibleCount, setEditListVisibleCount] = useState(SALES_PAGE_SIZE);

  // Void Dialog
  const [voidingSale, setVoidingSale] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);

  // Edit Dialog
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [editItems, setEditItems] = useState<CartItemInput[]>([]);
  const [editReason, setEditReason] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Pending edit requests toggle
  const [showEditRequests, setShowEditRequests] = useState(false);

  // Apply preset → compute start/end (except CUSTOM)
  useEffect(() => {
    if (datePreset === 'CUSTOM') return;
    const range = computePresetRange(datePreset);
    if (range) {
      setStartDate(range.start);
      setEndDate(range.end);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datePreset]);

  // Apply Edit List preset → compute start/end
  useEffect(() => {
    if (editListPreset === 'ALL') {
      setEditListStartDate('');
      setEditListEndDate('');
      return;
    }
    if (editListPreset === 'CUSTOM') return;
    const range = computePresetRange(editListPreset);
    if (range) {
      setEditListStartDate(range.start);
      setEditListEndDate(range.end);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editListPreset]);

  // Reset per-group pagination when filters change
  useEffect(() => {
    setGroupVisibleCounts({});
  }, [searchQuery, searchCurrentPeriodOnly, sellerFilter, paymentFilter, statusFilter, shopFilter, datePreset, startDate, endDate]);

  // Reset Edit List pagination when its filters change
  useEffect(() => {
    setEditListVisibleCount(SALES_PAGE_SIZE);
  }, [editListSearch, editListStatus, editListShopFilter, editListPreset, editListStartDate, editListEndDate]);

  // Force pull on mount (always registered cleanly before early permission guard)
  useEffect(() => {
    if (!currentUser) return;
    const forcePull = async () => {
      try {
        const online = await CloudflareApi.checkConnection();
        if (!online) return;

        console.log('[AdminSales] Pulling latest sale edit requests...');
        const pullResult = await CloudflareApi.pullSync();

        if (pullResult.success && pullResult.data) {
          SyncService.applyCloudData(pullResult.data);
          const state = db.getState();
          console.log(
            '[AdminSales] Pull completed, edit requests:',
            state.saleEditRequests?.length || 0
          );
        }
      } catch (error) {
        console.log('[AdminSales] Pull error:', error);
      }
    };

    forcePull();
  }, [currentUser]);

  // Permission check (after all hooks)
  if (!currentUser) return null;
  if (
    !hasAdminAccess(currentUser) &&
    !currentUser.permissions?.canEditSales &&
    !currentUser.permissions?.canDeleteSales
  ) {
    return null;
  }

  const platformAdmin = isPlatformAdmin(currentUser);
  const shopAdmin = isShopAdmin(currentUser);
  const managedShopIds = getShopAdminShopIds(currentUser);
  const canEditSale = hasAdminAccess(currentUser) || currentUser.permissions?.canEditSales;
  const canVoidSale = hasAdminAccess(currentUser) || currentUser.permissions?.canDeleteSales;
  const isAdmin = hasAdminAccess(currentUser);

  const refreshEditRequests = async () => {
    setIsRefreshing(true);
    try {
      const online = await CloudflareApi.checkConnection();
      if (!online) {
        addToast({
          type: 'error',
          title: 'Offline',
          description: 'Cannot refresh while offline.',
        });
        return;
      }

      const pullResult = await CloudflareApi.pullSync();
      if (pullResult.success && pullResult.data) {
        SyncService.applyCloudData(pullResult.data);
        addToast({
          type: 'success',
          title: 'Refreshed',
          description: 'Sale edit requests updated.',
        });
      }
    } catch (error) {
      console.log('Refresh error:', error);
      addToast({
        type: 'error',
        title: 'Refresh Failed',
        description: 'Could not refresh data.',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const settings = dbState.settings;
  const allShops = dbState.shops || [];
  const shops = platformAdmin
    ? allShops
    : shopAdmin
      ? getAdminManagedShops(currentUser, allShops)
      : allShops.filter(s => (currentUser.assignedShopIds || []).includes(s.id));
  const sellers = dbState.users.filter(
    u =>
      u.role === 'SELLER' &&
      (platformAdmin ||
        !shopAdmin ||
        (u.assignedShopIds || []).some(sid =>
          (managedShopIds.length > 0 ? managedShopIds : currentUser.assignedShopIds || []).includes(sid)
        ))
  );
  const products = dbState.products || [];
  const editRequests = SalesService.getSaleEditRequests(currentUser);
  const pendingRequests = editRequests.filter(r => r.status === 'PENDING');
  const handledEditRequests = editRequests
    .filter(r => r.status === 'APPROVED' || r.status === 'REJECTED')
    .sort((a, b) => {
      const tA = new Date(a.reviewedAt || a.createdAt).getTime();
      const tB = new Date(b.reviewedAt || b.createdAt).getTime();
      return tB - tA;
    });

  const salesById = new Map<string, Sale>((dbState.sales || []).map(s => [s.id, s]));

  // Always derive the active date range deterministically from the selected preset
  const activePresetRange = datePreset === 'CUSTOM' ? null : computePresetRange(datePreset);
  const effectiveStartDate = datePreset === 'CUSTOM' ? startDate : activePresetRange?.start || startDate;
  const effectiveEndDate = datePreset === 'CUSTOM' ? endDate : activePresetRange?.end || endDate;
  const isSearchingAllDates = searchQuery.trim().length > 0 && !searchCurrentPeriodOnly;

  const sales = SalesService.getSales(
    {
      search: searchQuery,
      sellerId: sellerFilter === 'ALL' ? undefined : sellerFilter,
      paymentMethod: paymentFilter === 'ALL' ? undefined : (paymentFilter as any),
      status: statusFilter === 'ALL' ? undefined : (statusFilter as any),
      shopId: shopFilter === 'ALL' ? undefined : shopFilter,
      startDate: isSearchingAllDates ? undefined : effectiveStartDate || undefined,
      endDate: isSearchingAllDates ? undefined : effectiveEndDate || undefined,
    },
    currentUser
  );

  const totalVolume = sales.reduce(
    (sum, s) => (s.status === 'COMPLETED' ? sum + s.total : sum),
    0
  );
  const totalProfit = sales.reduce(
    (sum, s) => (s.status === 'COMPLETED' ? sum + s.grossProfit : sum),
    0
  );

  // Organize sales by Shop (Platform Admin + All Shops) or by Seller (Shop Admin + All Sellers)
  const groupByMode: 'SHOP' | 'SELLER' | 'NONE' =
    platformAdmin && shopFilter === 'ALL'
      ? 'SHOP'
      : shopAdmin && !platformAdmin && sellerFilter === 'ALL'
        ? 'SELLER'
        : 'NONE';

  interface SalesGroup {
    key: string;
    label: string;
    kind: 'SHOP' | 'SELLER' | 'SINGLE';
    sales: Sale[];
    totalRevenue: number;
    totalProfit: number;
    completedCount: number;
  }

  const salesGroups: SalesGroup[] = (() => {
    if (sales.length === 0) return [];

    if (groupByMode === 'SHOP') {
      const grouped = new Map<string, { label: string; items: Sale[] }>();
      for (const sale of sales) {
        const key = sale.shopId || sale.shopName || '__UNASSIGNED_SHOP__';
        const shopObj = shops.find(s => s.id === sale.shopId);
        const label = shopObj?.name || sale.shopName || 'Unassigned Shop';
        const bucket = grouped.get(key);
        if (bucket) {
          bucket.items.push(sale);
        } else {
          grouped.set(key, { label, items: [sale] });
        }
      }

      const shopOrderIndex = new Map<string, number>(shops.map((s, idx) => [s.id, idx]));
      return Array.from(grouped.entries())
        .sort(([keyA, a], [keyB, b]) => {
          const idxA = shopOrderIndex.has(keyA) ? (shopOrderIndex.get(keyA) as number) : 999999;
          const idxB = shopOrderIndex.has(keyB) ? (shopOrderIndex.get(keyB) as number) : 999999;
          if (idxA !== idxB) return idxA - idxB;
          return a.label.localeCompare(b.label);
        })
        .map(([key, bucket]) => {
          let rev = 0;
          let prof = 0;
          let completedCount = 0;
          for (const s of bucket.items) {
            if (s.status === 'COMPLETED') {
              rev += s.total;
              prof += s.grossProfit;
              completedCount += 1;
            }
          }
          return {
            key: `shop:${key}`,
            label: bucket.label,
            kind: 'SHOP' as const,
            sales: bucket.items,
            totalRevenue: rev,
            totalProfit: prof,
            completedCount,
          };
        });
    }

    if (groupByMode === 'SELLER') {
      const grouped = new Map<string, { label: string; items: Sale[] }>();
      for (const sale of sales) {
        const key = sale.sellerId || sale.sellerName || '__UNKNOWN_SELLER__';
        const sellerObj = sellers.find(u => u.id === sale.sellerId);
        const label = sellerObj?.name || sale.sellerName || 'Unknown Seller';
        const bucket = grouped.get(key);
        if (bucket) {
          bucket.items.push(sale);
        } else {
          grouped.set(key, { label, items: [sale] });
        }
      }

      const sellerOrderIndex = new Map<string, number>(sellers.map((u, idx) => [u.id, idx]));
      return Array.from(grouped.entries())
        .sort(([keyA, a], [keyB, b]) => {
          const idxA = sellerOrderIndex.has(keyA) ? (sellerOrderIndex.get(keyA) as number) : 999999;
          const idxB = sellerOrderIndex.has(keyB) ? (sellerOrderIndex.get(keyB) as number) : 999999;
          if (idxA !== idxB) return idxA - idxB;
          return a.label.localeCompare(b.label);
        })
        .map(([key, bucket]) => {
          let rev = 0;
          let prof = 0;
          let completedCount = 0;
          for (const s of bucket.items) {
            if (s.status === 'COMPLETED') {
              rev += s.total;
              prof += s.grossProfit;
              completedCount += 1;
            }
          }
          return {
            key: `seller:${key}`,
            label: bucket.label,
            kind: 'SELLER' as const,
            sales: bucket.items,
            totalRevenue: rev,
            totalProfit: prof,
            completedCount,
          };
        });
    }

    // Single scope (specific shop picked by platform admin, or specific seller picked by shop admin)
    const label =
      shopFilter !== 'ALL'
        ? shops.find(s => s.id === shopFilter)?.name || 'Selected Shop'
        : sellerFilter !== 'ALL'
          ? sellers.find(s => s.id === sellerFilter)?.name || 'Selected Seller'
          : 'Transactions';
    return [
      {
        key: `single:${shopFilter}:${sellerFilter}`,
        label,
        kind: 'SINGLE' as const,
        sales,
        totalRevenue: totalVolume,
        totalProfit,
        completedCount: sales.filter(s => s.status === 'COMPLETED').length,
      },
    ];
  })();

  const selectedShopName =
    shopFilter === 'ALL'
      ? shopAdmin && !platformAdmin
        ? shops.length === 1
          ? shops[0].name
          : 'All Managed Shops'
        : 'All Shops'
      : shops.find(s => s.id === shopFilter)?.name || 'Unknown Shop';

  const handleExecuteVoid = () => {
    if (!voidingSale || !currentUser) return;
    if (!voidReason.trim()) {
      addToast({
        type: 'warning',
        title: 'Reason Required',
        description: 'Please provide a reason for cancelling this sale.',
      });
      return;
    }

    setIsVoiding(true);
    const res = SalesService.voidSale(voidingSale.id, voidReason, currentUser);
    setIsVoiding(false);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Sale Voided & Inventory Restored',
        description: `Receipt #${voidingSale.receiptNumber} marked voided. All product quantities were returned to stock.`,
      });
      setVoidingSale(null);
      setVoidReason('');
    } else {
      addToast({
        type: 'error',
        title: 'Void Failed',
        description: res.error || 'Could not void transaction.',
      });
    }
  };

  const openEditSale = (sale: Sale) => {
    setEditingSale(sale);
    setEditItems(
      sale.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount || 0,
      }))
    );
    setEditReason('');
  };

  const handleSaveEdit = () => {
    if (!editingSale || !currentUser) return;

    setIsEditing(true);
    const result = SalesService.requestSaleEdit(
      editingSale.id,
      editItems,
      editReason || 'Admin correction',
      currentUser
    );
    setIsEditing(false);

    if (result.success) {
      addToast({
        type: 'success',
        title: result.requiresApproval ? 'Edit Request Sent' : 'Sale Edited Successfully',
        description: result.requiresApproval
          ? 'Your edit request has been sent for admin approval.'
          : `Receipt #${editingSale.receiptNumber} updated. Stock recalculated.`,
      });
      setEditingSale(null);
      setEditItems([]);
      setEditReason('');
    } else {
      addToast({
        type: 'error',
        title: 'Edit Failed',
        description: result.error || 'Could not edit sale.',
      });
    }
  };

  const handleReviewRequest = (request: SaleEditRequest, action: 'APPROVE' | 'REJECT') => {
    if (!currentUser) return;

    const reviewNote = action === 'REJECT' ? 'Rejected by admin' : undefined;
    const result = SalesService.reviewSaleEdit(request.id, action, currentUser, reviewNote);

    if (result.success) {
      addToast({
        type: 'success',
        title: action === 'APPROVE' ? 'Edit Approved' : 'Edit Rejected',
        description:
          action === 'APPROVE'
            ? 'Sale edit approved. Stock recalculated.'
            : 'Sale edit request rejected.',
      });
    } else {
      addToast({
        type: 'error',
        title: 'Review Failed',
        description: result.error || 'Could not process review.',
      });
    }
  };

  const formatHumanDate = (ymd?: string) => {
    if (!ymd) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) return ymd;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const activePeriodMeta = (() => {
    const startLabel = formatHumanDate(effectiveStartDate);
    const endLabel = formatHumanDate(effectiveEndDate);
    const dateRangeText =
      startLabel && endLabel
        ? startLabel === endLabel
          ? startLabel
          : `${startLabel} to ${endLabel}`
        : startLabel || endLabel || 'All Dates';

    switch (datePreset) {
      case 'TODAY':
        return {
          periodKey: 'day' as const,
          shortLabel: 'Day',
          periodTitle: 'Daily Sales Report',
          periodLabel: 'Day (Today)',
          dateRangeText,
        };
      case 'WEEK':
        return {
          periodKey: 'week' as const,
          shortLabel: 'Week',
          periodTitle: 'Weekly Sales Report',
          periodLabel: 'Week (Last 7 Days)',
          dateRangeText,
        };
      case 'MONTH':
        return {
          periodKey: 'month' as const,
          shortLabel: 'Month',
          periodTitle: 'Monthly Sales Report',
          periodLabel: 'Month (This Month)',
          dateRangeText,
        };
      case 'YEAR':
        return {
          periodKey: 'year' as const,
          shortLabel: 'Year',
          periodTitle: 'Yearly Sales Report',
          periodLabel: 'Year (This Year)',
          dateRangeText,
        };
      case 'CUSTOM':
      default:
        return {
          periodKey: 'custom' as const,
          shortLabel: 'Custom',
          periodTitle: 'Custom Period Sales Report',
          periodLabel: 'Custom Range',
          dateRangeText,
        };
    }
  })();

  const selectedSellerLabel =
    sellerFilter === 'ALL'
      ? 'All Sellers'
      : sellers.find(s => s.id === sellerFilter)?.name || 'Selected Seller';

  const selectedPaymentLabel =
    paymentFilter === 'ALL'
      ? 'All Payment Methods'
      : paymentFilter === 'MOBILE_MONEY'
        ? 'Mobile Money'
        : paymentFilter.charAt(0) + paymentFilter.slice(1).toLowerCase();

  const selectedStatusLabel =
    statusFilter === 'ALL'
      ? 'All Statuses'
      : statusFilter.charAt(0) + statusFilter.slice(1).toLowerCase();

  const buildSalesPdfMeta = () => ({
    shopLabel: selectedShopName,
    startDate: isSearchingAllDates ? undefined : effectiveStartDate || undefined,
    endDate: isSearchingAllDates ? undefined : effectiveEndDate || undefined,
    periodKey: isSearchingAllDates ? 'search' : activePeriodMeta.periodKey,
    periodTitle: isSearchingAllDates ? 'Sales Search Report' : activePeriodMeta.periodTitle,
    periodLabel: isSearchingAllDates ? 'All Dates (Search)' : activePeriodMeta.periodLabel,
    dateRangeText: isSearchingAllDates ? 'All Dates' : activePeriodMeta.dateRangeText,
    sellerLabel: selectedSellerLabel,
    paymentLabel: selectedPaymentLabel,
    statusLabel: selectedStatusLabel,
    searchQuery: searchQuery.trim() || undefined,
    totalRevenue: totalVolume,
    totalProfit,
  });

  const handleDownloadPdf = async () => {
    if (isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    try {
      const ok = await downloadSalesReportPdf(sales, settings, buildSalesPdfMeta());
      if (ok) {
        addToast({
          type: 'success',
          title: `${isSearchingAllDates ? 'Sales Search Report' : activePeriodMeta.periodTitle} Downloaded`,
          description: `Saved ${sales.length} transaction(s) for ${isSearchingAllDates ? 'All Dates (Search)' : `${activePeriodMeta.periodLabel} (${activePeriodMeta.dateRangeText})`}.`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'PDF Export Failed',
          description: 'Could not save sales PDF document on this device.',
        });
      }
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handlePrint = async () => {
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      const res = await printSalesReportPdf(sales, settings, buildSalesPdfMeta());
      if (res.ok) {
        addToast({
          type: 'success',
          title: res.mode === 'fallback_download' ? 'Opened Sales PDF' : 'Print Dialog Opened',
          description:
            res.mode === 'fallback_download'
              ? 'Use the printer option in your PDF viewer to print.'
              : `Ready to print ${sales.length} transaction(s).`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'Print Failed',
          description: res.error || 'Could not open print dialog on this device.',
        });
      }
    } finally {
      setIsPrinting(false);
    }
  };

  // Unique Sold Products Summary (strictly products sold in the currently selected period)
  const soldProductsSummaryRows: SoldProductSummaryRow[] = (() => {
    const floorStoreIdSet = new Set(
      (dbState.stores || []).filter(st => st.isShopFloor).map(st => st.id)
    );
    const productById = new Map<string, Product>(products.map(p => [p.id, p]));
    const getRemainingQty = (productId?: string): number => {
      if (!productId) return 0;
      const p = productById.get(productId);
      if (!p) return 0;
      const floorQty = Math.max(0, Number(p.currentStock) || 0);
      const storeQty =
        typeof p.storeStock === 'number' && Number.isFinite(p.storeStock)
          ? Math.max(0, p.storeStock)
          : p.storeStocks
            ? Object.entries(p.storeStocks).reduce(
                (sum, [sid, q]) =>
                  floorStoreIdSet.has(sid) ? sum : sum + Math.max(0, Number(q || 0)),
                0
              )
            : 0;
      return floorQty + storeQty;
    };

    const agg = new Map<string, SoldProductSummaryRow>();
    for (const sale of sales) {
      if (sale.status !== 'COMPLETED') continue;
      for (const item of sale.items || []) {
        const qty = Number(item.quantity) || 0;
        if (qty <= 0) continue;
        const matchedProd = item.productId ? productById.get(item.productId) : undefined;
        const key =
          item.productId ||
          `${sale.shopId || ''}::${(item.productName || '').trim().toLowerCase()}`;
        const existing = agg.get(key);
        if (existing) {
          existing.totalSold += qty;
        } else {
          const baseName = (matchedProd?.name || item.productName || 'Unnamed Product').trim();
          const fullName =
            matchedProd?.variation && !baseName.toLowerCase().includes(matchedProd.variation.toLowerCase())
              ? `${baseName} (${matchedProd.variation})`
              : baseName;
          agg.set(key, {
            productName: fullName,
            totalRemained: getRemainingQty(item.productId),
            totalSold: qty,
            unit: matchedProd?.unit,
          });
        }
      }
    }

    return Array.from(agg.values()).sort(
      (a, b) => b.totalSold - a.totalSold || a.productName.localeCompare(b.productName)
    );
  })();

  const buildSoldProductsPdfMeta = () => ({
    shopLabel: selectedShopName,
    startDate: isSearchingAllDates ? undefined : effectiveStartDate || undefined,
    endDate: isSearchingAllDates ? undefined : effectiveEndDate || undefined,
    periodKey: isSearchingAllDates ? 'search' : activePeriodMeta.periodKey,
    periodLabel: isSearchingAllDates ? 'All Dates (Search)' : activePeriodMeta.periodLabel,
    dateRangeText: isSearchingAllDates ? 'All Dates' : activePeriodMeta.dateRangeText,
    sellerLabel: selectedSellerLabel,
    paymentLabel: selectedPaymentLabel,
    searchQuery: searchQuery.trim() || undefined,
  });

  const handleDownloadSoldProductsPdf = async () => {
    if (isDownloadingSoldProductsPdf) return;
    setIsDownloadingSoldProductsPdf(true);
    try {
      const ok = await downloadSoldProductsSummaryPdf(
        soldProductsSummaryRows,
        settings,
        buildSoldProductsPdfMeta()
      );
      if (ok) {
        addToast({
          type: 'success',
          title: `Sold Products PDF Downloaded (${isSearchingAllDates ? 'Search' : activePeriodMeta.shortLabel})`,
          description: `Exported ${soldProductsSummaryRows.length} unique sold product(s) with remaining and sold quantities.`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'PDF Export Failed',
          description: 'Could not save Sold Products Summary PDF on this device.',
        });
      }
    } finally {
      setIsDownloadingSoldProductsPdf(false);
    }
  };

  const handlePrintSoldProductsPdf = async () => {
    if (isPrintingSoldProductsPdf) return;
    setIsPrintingSoldProductsPdf(true);
    try {
      const res = await printSoldProductsSummaryPdf(
        soldProductsSummaryRows,
        settings,
        buildSoldProductsPdfMeta()
      );
      if (res.ok) {
        addToast({
          type: 'success',
          title:
            res.mode === 'fallback_download'
              ? 'Opened Sold Products PDF'
              : 'Print Dialog Opened',
          description:
            res.mode === 'fallback_download'
              ? 'Use the printer icon in your PDF viewer to print.'
              : `Ready to print ${soldProductsSummaryRows.length} unique sold product(s) (${isSearchingAllDates ? 'Search' : activePeriodMeta.periodLabel}).`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'Print Failed',
          description: res.error || 'Could not print Sold Products Summary on this device.',
        });
      }
    } finally {
      setIsPrintingSoldProductsPdf(false);
    }
  };

  const handleExportCSV = async () => {
    let csv = `${activePeriodMeta.periodTitle} - ${selectedShopName}\n`;
    csv += `Period: ${activePeriodMeta.periodLabel} (${activePeriodMeta.dateRangeText})\n`;
    csv += `Generated: ${new Date().toLocaleString()}\n\n`;
    csv += `Receipt #,Date,Shop,Seller,Products,Payment,Status,Total,Profit\n`;

    sales.forEach(sale => {
      const prodList = (sale.items || [])
        .map(i => `${i.quantity}x ${i.productName}`)
        .join('; ');
      csv += `"${sale.receiptNumber}","${formatDateTime(sale.createdAt)}","${sale.shopName || ''}","${sale.sellerName}","${prodList}","${sale.paymentMethod}","${sale.status}",${sale.total},${sale.status === 'COMPLETED' ? sale.grossProfit : 0}\n`;
    });

    const dateTag =
      effectiveStartDate && effectiveEndDate
        ? effectiveStartDate === effectiveEndDate
          ? effectiveStartDate
          : `${effectiveStartDate}_to_${effectiveEndDate}`
        : new Date().toISOString().slice(0, 10);
    const fileName = `sales_report_${activePeriodMeta.periodKey}_${selectedShopName
      .toLowerCase()
      .replace(/\s+/g, '_')}_${dateTag}.csv`;
    const res = await saveTextFileCrossPlatform(csv, fileName, 'text/csv;charset=utf-8');
    if (res.ok) {
      addToast({
        type: 'success',
        title: 'CSV Downloaded',
        description: `Saved ${res.location || fileName}.`,
      });
    } else {
      addToast({
        type: 'error',
        title: 'CSV Export Failed',
        description: res.error || 'Could not save CSV file.',
      });
    }
  };

  const hasActiveFilters =
    searchQuery ||
    sellerFilter !== 'ALL' ||
    paymentFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    shopFilter !== 'ALL' ||
    datePreset !== 'TODAY' ||
    (datePreset === 'CUSTOM' && (startDate || endDate));

  // Colored presets config
  const presets: { id: DatePreset; label: string; activeClass: string; idleClass: string }[] = [
    {
      id: 'TODAY',
      label: 'Day',
      activeClass: 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/30',
      idleClass: 'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20',
    },
    {
      id: 'WEEK',
      label: 'Week',
      activeClass: 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-500/30',
      idleClass: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20',
    },
    {
      id: 'MONTH',
      label: 'Month',
      activeClass: 'bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-500/30',
      idleClass: 'bg-violet-500/10 border-violet-500/30 text-violet-300 hover:bg-violet-500/20',
    },
    {
      id: 'YEAR',
      label: 'Year',
      activeClass: 'bg-cyan-600 border-cyan-500 text-white shadow-md shadow-cyan-500/30',
      idleClass: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20',
    },
    {
      id: 'CUSTOM',
      label: 'Custom',
      activeClass: 'bg-amber-500 border-amber-400 text-white shadow-md shadow-amber-500/30',
      idleClass: 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20',
    },
  ];

  // Filtered handled edit requests (Approved & Rejected) for Edit List Full Page
  const filteredHandledEdits = handledEditRequests.filter(req => {
    if (editListStatus !== 'ALL' && req.status !== editListStatus) return false;

    const sale = salesById.get(req.saleId);
    const reqShopId =
      sale?.shopId ||
      req.originalValues?.items?.[0]?.shopId ||
      req.newValues?.items?.[0]?.shopId ||
      '';

    if (editListShopFilter !== 'ALL' && reqShopId !== editListShopFilter) return false;

    const targetTime = new Date(req.reviewedAt || req.createdAt).getTime();
    if (editListStartDate) {
      const startMs = new Date(`${editListStartDate}T00:00:00`).getTime();
      if (targetTime < startMs) return false;
    }
    if (editListEndDate) {
      const endMs = new Date(`${editListEndDate}T23:59:59.999`).getTime();
      if (targetTime > endMs) return false;
    }

    if (editListSearch.trim()) {
      const q = editListSearch.toLowerCase().trim();
      const details = formatSaleEditDetails(req, sale, settings.currencySymbol);
      const haystack = [
        details.receiptNumber,
        details.shopName,
        details.sellerName,
        req.requestedByName,
        req.reviewedByName || '',
        req.reason,
        req.reviewNote || '',
        req.status,
        ...details.productNames,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  if (showEditListPage) {
    const approvedCount = filteredHandledEdits.filter(r => r.status === 'APPROVED').length;
    const rejectedCount = filteredHandledEdits.filter(r => r.status === 'REJECTED').length;
    const visibleEdits = filteredHandledEdits.slice(0, editListVisibleCount);
    const hasMoreEdits = editListVisibleCount < filteredHandledEdits.length;

    const editPeriodLabel =
      editListPreset === 'ALL'
        ? 'All Dates'
        : editListStartDate || editListEndDate
          ? `${editListStartDate || 'Start'} to ${editListEndDate || 'Today'}`
          : editListPreset;

    const editShopLabel =
      editListShopFilter === 'ALL'
        ? selectedShopName
        : shops.find(s => s.id === editListShopFilter)?.name || 'Selected Shop';

    const editStatusLabel =
      editListStatus === 'ALL'
        ? 'Approved & Rejected'
        : editListStatus === 'APPROVED'
          ? 'Approved Only'
          : 'Rejected Only';

    const handleDownloadEditListPdf = async () => {
      if (isDownloadingEditList) return;
      setIsDownloadingEditList(true);
      try {
        const ok = await downloadSaleEditsReportPdf(filteredHandledEdits, salesById, settings, {
          periodLabel: editPeriodLabel,
          statusLabel: editStatusLabel,
          shopLabel: editShopLabel,
        });
        if (ok) {
          addToast({
            type: 'success',
            title: 'Edit History PDF Downloaded',
            description: `Saved ${filteredHandledEdits.length} handled sale edit(s) to Downloads.`,
          });
        } else {
          addToast({
            type: 'error',
            title: 'PDF Export Failed',
            description: 'Could not save sale edits PDF on this device.',
          });
        }
      } finally {
        setIsDownloadingEditList(false);
      }
    };

    const handlePrintEditList = async () => {
      if (isPrintingEditList) return;
      setIsPrintingEditList(true);
      try {
        const res = await printSaleEditsReportPdf(filteredHandledEdits, salesById, settings, {
          periodLabel: editPeriodLabel,
          statusLabel: editStatusLabel,
          shopLabel: editShopLabel,
        });
        if (res.ok) {
          addToast({
            type: 'success',
            title:
              res.mode === 'fallback_download'
                ? 'Opened Edit History PDF'
                : 'Print Dialog Opened',
            description:
              res.mode === 'fallback_download'
                ? 'Use the printer option in your PDF viewer to print.'
                : `Ready to print ${filteredHandledEdits.length} handled sale edit(s).`,
          });
        } else {
          addToast({
            type: 'error',
            title: 'Print Failed',
            description: res.error || 'Could not open print dialog on this device.',
          });
        }
      } finally {
        setIsPrintingEditList(false);
      }
    };

    return (
      <div
        id="admin-sales-edit-list-page"
        className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-6"
      >
        {/* Full-Page Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setShowEditListPage(false)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-violet-400 shrink-0" />
                <span className="truncate">Sale Edits History</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                All approved and rejected sale edits handled by admin
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={refreshEditRequests}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Refreshing' : 'Refresh'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrintEditList}
              disabled={isPrintingEditList}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/35 text-xs font-semibold shadow transition disabled:opacity-50"
            >
              {isPrintingEditList ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Printer className="w-3.5 h-3.5" />
              )}
              <span>{isPrintingEditList ? 'Printing...' : 'Print'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadEditListPdf}
              disabled={isDownloadingEditList}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow transition disabled:opacity-50"
            >
              {isDownloadingEditList ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{isDownloadingEditList ? 'Generating...' : 'Download PDF'}</span>
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
              Total Handled
            </span>
            <span className="text-base font-bold text-violet-300 font-mono">
              {filteredHandledEdits.length}
            </span>
          </div>
          <div className="p-3 bg-slate-900 border border-emerald-500/20 rounded-xl">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
              Approved
            </span>
            <span className="text-base font-bold text-emerald-400 font-mono">
              {approvedCount}
            </span>
          </div>
          <div className="p-3 bg-slate-900 border border-rose-500/20 rounded-xl">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
              Rejected
            </span>
            <span className="text-base font-bold text-rose-400 font-mono">
              {rejectedCount}
            </span>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4 space-y-2.5 text-xs">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={editListSearch}
              onChange={e => setEditListSearch(e.target.value)}
              placeholder="Search product name, seller, receipt, reason..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            <button
              type="button"
              onClick={() => setEditListPreset('ALL')}
              className={`py-2 rounded-lg border text-[11px] font-semibold transition ${
                editListPreset === 'ALL'
                  ? 'bg-slate-700 border-slate-500 text-white'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              All Dates
            </button>
            {presets.map(p => {
              const isActive = editListPreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setEditListPreset(p.id)}
                  className={`py-2 rounded-lg border text-[11px] font-semibold transition ${
                    isActive ? p.activeClass : p.idleClass
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {editListPreset === 'CUSTOM' && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">From</label>
                <input
                  type="date"
                  value={editListStartDate}
                  onChange={e => setEditListStartDate(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white w-full focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 block mb-1">To</label>
                <input
                  type="date"
                  value={editListEndDate}
                  onChange={e => setEditListEndDate(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white w-full focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1 min-w-[210px]">
              {(['ALL', 'APPROVED', 'REJECTED'] as const).map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setEditListStatus(st)}
                  className={`flex-1 py-2 px-2.5 rounded-lg border text-[11px] font-semibold transition ${
                    editListStatus === st
                      ? st === 'APPROVED'
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : st === 'REJECTED'
                          ? 'bg-rose-600 border-rose-500 text-white'
                          : 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {st === 'ALL' ? 'All Status' : st === 'APPROVED' ? 'Approved' : 'Rejected'}
                </button>
              ))}
            </div>

            {(platformAdmin || shops.length > 1) && (
              <select
                value={editListShopFilter}
                onChange={e => setEditListShopFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="ALL">🏪 All Shops</option>
                {shops.map(s => (
                  <option key={s.id} value={s.id}>
                    🏪 {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Handled Edits List */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          {filteredHandledEdits.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-xs">No approved or rejected sale edits found.</p>
            </div>
          ) : (
            <>
              {/* Mobile Cards (< md) */}
              <div className="md:hidden divide-y divide-slate-800/80">
                {visibleEdits.map(req => {
                  const sale = salesById.get(req.saleId);
                  const details = formatSaleEditDetails(req, sale, settings.currencySymbol);
                  const isApproved = req.status === 'APPROVED';

                  return (
                    <div key={req.id} className="p-3.5 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-white text-xs">
                              #{details.receiptNumber}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/50 text-[10px] font-semibold">
                              🏪 {details.shopName}
                            </span>
                          </div>
                          <p className="text-[11px] font-semibold text-slate-200 mt-1">
                            Seller: {details.sellerName}
                          </p>
                          <p className="text-[10px] font-mono text-slate-400">
                            {formatDateTime(req.reviewedAt || req.createdAt)}
                            {req.reviewedByName ? ` • By ${req.reviewedByName}` : ''}
                          </p>
                        </div>

                        <span
                          className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isApproved
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          }`}
                        >
                          {req.status}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">
                          Product Name(s)
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {details.productNames.map((name, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] text-slate-100 font-medium"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                          Changes
                        </span>
                        {details.changes.map((c, idx) => (
                          <div
                            key={idx}
                            className={`text-[11px] ${
                              c.kind === 'added'
                                ? 'text-emerald-400'
                                : c.kind === 'removed'
                                  ? 'text-rose-400'
                                  : c.kind === 'total'
                                    ? 'text-blue-300 font-bold pt-1 border-t border-slate-800'
                                    : 'text-amber-300'
                            }`}
                          >
                            <span className="font-semibold">{c.label}:</span> {c.detail}
                          </div>
                        ))}
                      </div>

                      <div className="text-xs text-slate-300 bg-slate-950/40 p-2 rounded-lg border border-slate-800/70">
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-0.5">
                          Reason
                        </span>
                        <p>{req.reason || 'No reason provided'}</p>
                        {req.reviewNote && (
                          <p className="text-[10px] text-slate-400 mt-1">
                            Admin Note: {req.reviewNote}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table (md+) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                      <th className="py-3 px-4 font-semibold">Date & Receipt</th>
                      <th className="py-3 px-4 font-semibold">Product Name</th>
                      <th className="py-3 px-4 font-semibold">Seller Name</th>
                      <th className="py-3 px-4 text-center font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold">Changes</th>
                      <th className="py-3 px-4 font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {visibleEdits.map(req => {
                      const sale = salesById.get(req.saleId);
                      const details = formatSaleEditDetails(req, sale, settings.currencySymbol);
                      const isApproved = req.status === 'APPROVED';

                      return (
                        <tr key={req.id} className="hover:bg-slate-850/60 transition align-top">
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-mono font-bold text-white">
                              #{details.receiptNumber}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {formatDateTime(req.reviewedAt || req.createdAt)}
                            </div>
                            <span className="inline-block mt-1 px-2 py-0.5 rounded bg-blue-950/70 text-blue-300 border border-blue-800/50 text-[10px] font-semibold">
                              🏪 {details.shopName}
                            </span>
                          </td>
                          <td className="py-3 px-4 max-w-xs">
                            <div className="flex flex-wrap gap-1">
                              {details.productNames.map((name, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700/70 text-[11px] text-slate-100 font-medium"
                                >
                                  {name}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-200">{details.sellerName}</div>
                            {req.reviewedByName && (
                              <div className="text-[10px] text-slate-500 mt-0.5">
                                Handled by: {req.reviewedByName}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                isApproved
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              }`}
                            >
                              {req.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 max-w-sm">
                            <div className="space-y-1">
                              {details.changes.map((c, idx) => (
                                <div
                                  key={idx}
                                  className={`text-[11px] ${
                                    c.kind === 'added'
                                      ? 'text-emerald-400'
                                      : c.kind === 'removed'
                                        ? 'text-rose-400'
                                        : c.kind === 'total'
                                          ? 'text-blue-300 font-bold pt-1 border-t border-slate-800/80'
                                          : 'text-amber-300'
                                  }`}
                                >
                                  <span className="font-semibold">{c.label}:</span> {c.detail}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="py-3 px-4 max-w-xs text-slate-300">
                            <p>{req.reason || 'No reason provided'}</p>
                            {req.reviewNote && (
                              <p className="text-[10px] text-slate-500 mt-1">
                                Note: {req.reviewNote}
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {(filteredHandledEdits.length > SALES_PAGE_SIZE ||
                editListVisibleCount > SALES_PAGE_SIZE) && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-800 bg-slate-950/60 text-xs">
                  <span className="text-slate-400">
                    Showing {visibleEdits.length} of {filteredHandledEdits.length} edits
                  </span>
                  <div className="flex items-center gap-2">
                    {editListVisibleCount > SALES_PAGE_SIZE && (
                      <button
                        type="button"
                        onClick={() => setEditListVisibleCount(SALES_PAGE_SIZE)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition"
                      >
                        Show Less
                      </button>
                    )}
                    {hasMoreEdits && (
                      <button
                        type="button"
                        onClick={() => setEditListVisibleCount(prev => prev + SALES_PAGE_SIZE)}
                        className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold transition"
                      >
                        See More (+{Math.min(SALES_PAGE_SIZE, filteredHandledEdits.length - visibleEdits.length)})
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      id="admin-sales-view"
      className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-6"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 mb-5 pb-4 border-b border-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              Sales & Transactions
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Audit store sales, filter by cashier or payment gateway, and manage voiding
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowEditListPage(true)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600/20 hover:bg-violet-600 text-violet-300 hover:text-white border border-violet-500/40 text-xs font-semibold transition active:scale-95"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            <span>Edit List</span>
            <span className="px-1.5 py-0.5 rounded-full bg-violet-500/30 text-[10px] font-bold">
              {handledEditRequests.length}
            </span>
          </button>
        </div>

        {/* KPI cards + Print/CSV */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
              Completed Rev
            </span>
            <span className="text-sm font-bold text-emerald-400 font-mono">
              {formatCurrency(totalVolume, settings.currencySymbol)}
            </span>
          </div>
          <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
              Gross Profit
            </span>
            <span className="text-sm font-bold text-blue-400 font-mono">
              {formatCurrency(totalProfit, settings.currencySymbol)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={handlePrint}
            disabled={isPrinting}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/35 text-xs font-semibold shadow transition disabled:opacity-50"
          >
            {isPrinting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : (
              <Printer className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">
              {isPrinting
                ? 'Printing...'
                : `Print (${isSearchingAllDates ? 'Search' : activePeriodMeta.shortLabel})`}
            </span>
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={isDownloadingPdf}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold shadow transition disabled:opacity-50"
          >
            {isDownloadingPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : (
              <Download className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">
              {isDownloadingPdf
                ? 'Generating...'
                : `Download PDF (${isSearchingAllDates ? 'Search' : activePeriodMeta.shortLabel})`}
            </span>
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 border border-slate-700 text-xs font-semibold transition"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>CSV</span>
          </button>
        </div>

        {/* Separate Sold Products Summary PDF & Print (Product Name, Total Remained Qty, Total Sold Qty ONLY) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            id="sales-sold-products-pdf-btn"
            type="button"
            onClick={handleDownloadSoldProductsPdf}
            disabled={isDownloadingSoldProductsPdf}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600 active:bg-emerald-700 text-emerald-300 hover:text-white border border-emerald-500/40 text-xs font-semibold shadow transition disabled:opacity-50"
          >
            <Package className="w-3.5 h-3.5 shrink-0" />
            {isDownloadingSoldProductsPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : (
              <Download className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">
              {isDownloadingSoldProductsPdf
                ? 'Saving Sold Products PDF...'
                : `Sold Products PDF (${isSearchingAllDates ? 'Search' : activePeriodMeta.shortLabel})`}
            </span>
            <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/25 text-[10px] font-mono font-bold shrink-0">
              {soldProductsSummaryRows.length}
            </span>
          </button>

          <button
            id="sales-sold-products-print-btn"
            type="button"
            onClick={handlePrintSoldProductsPdf}
            disabled={isPrintingSoldProductsPdf}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-teal-600/20 hover:bg-teal-600 active:bg-teal-700 text-teal-300 hover:text-white border border-teal-500/40 text-xs font-semibold shadow transition disabled:opacity-50"
          >
            {isPrintingSoldProductsPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : (
              <Printer className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">
              {isPrintingSoldProductsPdf
                ? 'Printing Sold Products...'
                : `Print Sold Products (${isSearchingAllDates ? 'Search' : activePeriodMeta.shortLabel})`}
            </span>
          </button>
        </div>
      </div>

      {/* Pending Edit Requests */}
      {canEditSale && (
        <div className="mb-4 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl">
          <div className="flex items-center justify-between mb-2.5 gap-2 flex-wrap">
            <h3 className="text-xs sm:text-sm font-bold text-amber-300 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Pending Edit Requests ({pendingRequests.length})
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={refreshEditRequests}
                disabled={isRefreshing}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 active:text-blue-200 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Refreshing' : 'Refresh'}
              </button>
              <button
                onClick={() => setShowEditRequests(!showEditRequests)}
                className="text-xs text-slate-400 hover:text-white transition"
              >
                {showEditRequests ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {showEditRequests && pendingRequests.length > 0 &&
            pendingRequests.map(request => (
              <div
                key={request.id}
                className="p-3 bg-slate-950 rounded-lg border border-slate-800 mb-2"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white text-xs">
                      From: {request.requestedByName}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {formatDateTime(request.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    <strong>Reason:</strong> {request.reason}
                  </p>
                  <div className="text-[11px] text-slate-500">
                    <strong>Original:</strong>{' '}
                    {formatCurrency(request.originalValues.total, settings.currencySymbol)} →{' '}
                    <strong>New:</strong>{' '}
                    {formatCurrency(request.newValues.total, settings.currencySymbol)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    <strong>Items:</strong> {request.originalValues.items.length} →{' '}
                    {request.newValues.items.length}
                  </div>

                  {isAdmin && (() => {
                    const requestSale = dbState.sales.find(s => s.id === request.saleId);
                    const canApproveThisRequest =
                      platformAdmin ||
                      (!!requestSale?.shopId && managedShopIds.includes(requestSale.shopId));
                    if (!canApproveThisRequest) return null;
                    return (
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={() => handleReviewRequest(request, 'APPROVE')}
                          className="flex-1 px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold transition flex items-center justify-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Approve
                        </button>
                        <button
                          onClick={() => handleReviewRequest(request, 'REJECT')}
                          className="flex-1 px-3 py-2 rounded bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white text-xs font-semibold transition flex items-center justify-center gap-1"
                        >
                          <X className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))}

          {showEditRequests && pendingRequests.length === 0 && (
            <div className="p-3 text-center text-slate-500 text-xs">
              No pending edit requests.
            </div>
          )}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4 space-y-2.5 text-xs">
        <div className="space-y-1.5">
          <div className="relative">
            <Search className="w-4 h-4 text-blue-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search any sale: receipt #, product, SKU, seller, shop, amount, payment, date..."
              className="w-full bg-slate-950 border border-slate-700/90 hover:border-slate-600 focus:border-blue-500 rounded-xl pl-9 pr-9 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {searchQuery.trim() && (
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/25 text-[11px]">
              <span className="text-blue-200 truncate">
                {isSearchingAllDates ? (
                  <>
                    Searching <strong className="text-white">all dates</strong> •{' '}
                    <strong className="text-blue-300">{sales.length}</strong>{' '}
                    {sales.length === 1 ? 'sale' : 'sales'} found
                  </>
                ) : (
                  <>
                    Searching <strong className="text-white">{activePeriodMeta.shortLabel}</strong> only •{' '}
                    <strong className="text-blue-300">{sales.length}</strong>{' '}
                    {sales.length === 1 ? 'sale' : 'sales'} found
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => setSearchCurrentPeriodOnly(prev => !prev)}
                className="shrink-0 px-2 py-0.5 rounded-md bg-blue-600/25 hover:bg-blue-600/40 text-blue-200 font-semibold text-[10px] transition"
              >
                {isSearchingAllDates
                  ? `Limit to ${activePeriodMeta.shortLabel}`
                  : 'Search All Dates'}
              </button>
            </div>
          )}
        </div>

        {/* Date Preset Pills */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
              Period
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {presets.map(p => {
              const isActive = datePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDatePreset(p.id)}
                  className={`py-2 rounded-lg border text-[11px] font-semibold transition active:scale-95 ${
                    isActive ? p.activeClass : p.idleClass
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom date range inputs — only when CUSTOM */}
        {datePreset === 'CUSTOM' && (
          <div className="grid grid-cols-2 gap-2 pt-1 animate-in fade-in duration-150">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">From</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white w-full focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">To</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white w-full focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select
            value={shopFilter}
            onChange={e => setShopFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="ALL">
              🏪 {shopAdmin && !platformAdmin ? (shops.length === 1 ? shops[0].name : 'All Managed Shops') : 'All Shops'}
            </option>
            {(platformAdmin || shops.length > 1) &&
              shops.map(s => (
                <option key={s.id} value={s.id}>
                  🏪 {s.name}
                </option>
              ))}
          </select>

          <select
            value={sellerFilter}
            onChange={e => setSellerFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="ALL">All Sellers</option>
            {sellers.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <select
            value={paymentFilter}
            onChange={e => setPaymentFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="ALL">All Payment Methods</option>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="MOBILE_MONEY">Mobile Money</option>
            <option value="BANK">Bank</option>
            <option value="OTHER">Other</option>
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="VOIDED">Voided</option>
          </select>
        </div>

        {hasActiveFilters && (
          <button
            onClick={() => {
              setSearchQuery('');
              setSearchCurrentPeriodOnly(false);
              setSellerFilter('ALL');
              setPaymentFilter('ALL');
              setStatusFilter('ALL');
              setShopFilter('ALL');
              setDatePreset('TODAY');
            }}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 font-semibold transition text-xs"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Sales List (Grouped by Shop / Seller with 15-item See More + Group Totals before Expand) */}
      <div className="space-y-4">
        {salesGroups.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl py-12 text-center text-slate-500">
            <Receipt className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-xs">No transaction records found.</p>
          </div>
        ) : (
          salesGroups.map(group => {
            const visibleLimit = groupVisibleCounts[group.key] ?? SALES_PAGE_SIZE;
            const visibleSales = group.sales.slice(0, visibleLimit);
            const hasMore = visibleLimit < group.sales.length;
            const remaining = group.sales.length - visibleSales.length;

            return (
              <div
                key={group.key}
                className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl"
              >
                {/* Group Header */}
                <div className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-950/80 border-b border-slate-800">
                  <div className="flex items-center gap-2 min-w-0">
                    {group.kind === 'SELLER' ? (
                      <UserIcon className="w-4 h-4 text-violet-400 shrink-0" />
                    ) : (
                      <Store className="w-4 h-4 text-blue-400 shrink-0" />
                    )}
                    <h3 className="text-sm font-bold text-white truncate">{group.label}</h3>
                  </div>
                  <span className="shrink-0 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[11px] font-semibold text-slate-300">
                    {group.sales.length} {group.sales.length === 1 ? 'sale' : 'sales'}
                  </span>
                </div>

                {/* Mobile Cards (< md) */}
                <div className="md:hidden divide-y divide-slate-800/80">
                  {visibleSales.map(sale => {
                    const isVoided = sale.status === 'VOIDED';

                    return (
                      <div
                        key={sale.id}
                        className={`p-3.5 space-y-2.5 ${isVoided ? 'opacity-65' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold text-white text-xs">
                                #{sale.receiptNumber}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                                  !isVoided
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                }`}
                              >
                                {sale.status}
                              </span>
                            </div>
                            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                              {formatDateTime(sale.createdAt)}
                            </p>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="font-mono font-bold text-white text-sm">
                              {formatCurrency(sale.total, settings.currencySymbol)}
                            </div>
                            <div className="font-mono text-[10px] text-emerald-400">
                              {isVoided
                                ? formatCurrency(0, settings.currencySymbol)
                                : `+${formatCurrency(sale.grossProfit, settings.currencySymbol)}`}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                          <span className="px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/50 font-semibold">
                            🏪 {sale.shopName || 'N/A'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                            {sale.sellerName}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 uppercase">
                            {sale.paymentMethod}
                          </span>
                        </div>

                        <div className="bg-slate-950/70 rounded-xl border border-slate-800/90 overflow-hidden">
                          <div className="px-2.5 py-1.5 bg-slate-900/80 border-b border-slate-800/80 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            <span>Products ({(sale.items || []).length})</span>
                            <span>Qty × Price</span>
                          </div>
                          <div className="divide-y divide-slate-800/60">
                            {(sale.items || []).map((item, idx) => (
                              <div
                                key={idx}
                                className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]"
                              >
                                <span className="text-slate-200 font-medium leading-snug break-words min-w-0 flex-1">
                                  {item.productName}
                                </span>
                                <span className="shrink-0 font-mono text-[10px] text-slate-400 tabular-nums">
                                  <span className="text-blue-400 font-bold">{item.quantity}</span>
                                  {' × '}
                                  {formatCurrency(item.unitPrice, settings.currencySymbol)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-1.5 border-t border-slate-800/60">
                          <button
                            onClick={() => showReceipt(sale)}
                            className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 text-[11px] font-semibold transition"
                          >
                            Receipt
                          </button>

                          {!isVoided && canEditSale && (
                            <button
                              onClick={() => openEditSale(sale)}
                              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-blue-500/15 hover:bg-blue-600 active:bg-blue-700 text-blue-300 hover:text-white text-[11px] font-semibold border border-blue-500/30 transition"
                            >
                              <Pencil className="w-3 h-3" />
                              Edit
                            </button>
                          )}

                          {!isVoided && canVoidSale && (
                            <button
                              onClick={() => {
                                setVoidingSale(sale);
                                setVoidReason('');
                              }}
                              className="flex-1 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-600 active:bg-rose-700 text-rose-300 hover:text-white text-[11px] font-semibold border border-rose-500/30 transition"
                            >
                              Void
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Tablet / Desktop Table (md+) */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                        <th className="py-3 px-4 font-semibold">Receipt</th>
                        <th className="py-3 px-4 font-semibold">Date & Time</th>
                        <th className="py-3 px-4 font-semibold">Shop</th>
                        <th className="py-3 px-4 font-semibold">Seller</th>
                        <th className="py-3 px-4 font-semibold">Products</th>
                        <th className="py-3 px-4 font-semibold">Payment</th>
                        <th className="py-3 px-4 text-right font-semibold">Total</th>
                        <th className="py-3 px-4 text-right font-semibold">Profit</th>
                        <th className="py-3 px-4 text-center font-semibold">Status</th>
                        <th className="py-3 px-4 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {visibleSales.map(sale => {
                        const isVoided = sale.status === 'VOIDED';

                        return (
                          <tr
                            key={sale.id}
                            className={`hover:bg-slate-850/60 transition ${
                              isVoided ? 'opacity-65' : ''
                            }`}
                          >
                            <td className="py-3 px-4 font-mono font-bold text-white">
                              {sale.receiptNumber}
                            </td>
                            <td className="py-3 px-4 text-slate-400">
                              {formatDateTime(sale.createdAt)}
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded bg-blue-950/70 text-blue-300 border border-blue-800/50 text-[10px] font-semibold">
                                🏪 {sale.shopName || 'N/A'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-slate-300 font-medium">
                              {sale.sellerName}
                            </td>
                            <td className="py-3 px-4 min-w-[230px] max-w-sm align-top">
                              <div className="rounded-lg bg-slate-950/60 border border-slate-800/80 divide-y divide-slate-800/60 overflow-hidden">
                                {(sale.items || []).map((item, idx) => (
                                  <div
                                    key={idx}
                                    className="px-2.5 py-1.5 flex items-center justify-between gap-3 text-[11px]"
                                  >
                                    <span className="text-slate-200 font-medium leading-snug break-words min-w-0 flex-1">
                                      {item.productName}
                                    </span>
                                    <span className="shrink-0 font-mono text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
                                      <span className="font-bold text-blue-400">
                                        {item.quantity}x
                                      </span>{' '}
                                      {formatCurrency(item.unitPrice, settings.currencySymbol)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] uppercase font-medium">
                                {sale.paymentMethod}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-white">
                              {formatCurrency(sale.total, settings.currencySymbol)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                              {isVoided
                                ? formatCurrency(0, settings.currencySymbol)
                                : `+${formatCurrency(sale.grossProfit, settings.currencySymbol)}`}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  !isVoided
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                }`}
                              >
                                {sale.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                              <button
                                onClick={() => showReceipt(sale)}
                                className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition"
                              >
                                Receipt
                              </button>
                              {!isVoided && (
                                <>
                                  {canEditSale && (
                                    <button
                                      onClick={() => openEditSale(sale)}
                                      className="px-2 py-1.5 rounded bg-blue-500/15 hover:bg-blue-600 hover:text-white text-blue-300 text-[11px] font-semibold border border-blue-500/30 transition"
                                    >
                                      <Pencil className="w-3 h-3 inline mr-0.5" />
                                      Edit
                                    </button>
                                  )}
                                  {canVoidSale && (
                                    <button
                                      onClick={() => {
                                        setVoidingSale(sale);
                                        setVoidReason('');
                                      }}
                                      className="px-2 py-1.5 rounded bg-rose-500/15 hover:bg-rose-600 hover:text-white text-rose-300 text-[11px] font-semibold border border-rose-500/30 transition"
                                    >
                                      Void
                                    </button>
                                  )}
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Per-Group Total Sales & Profit Summary */}
                <div className="px-3.5 py-3 bg-slate-950/75 border-t border-slate-800/90 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="font-semibold uppercase tracking-wider truncate">
                      {group.label} Summary
                    </span>
                    <span className="font-mono tabular-nums text-slate-300 shrink-0">
                      {group.completedCount.toLocaleString()} completed{' '}
                      {group.completedCount === 1 ? 'sale' : 'sales'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2">
                      <div className="text-[9px] text-slate-400 uppercase font-semibold">
                        Total Sales
                      </div>
                      <div className="text-xs font-bold font-mono tabular-nums text-blue-300 mt-0.5 truncate">
                        {formatCurrency(group.totalRevenue, settings.currencySymbol)}
                      </div>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-right">
                      <div className="text-[9px] text-slate-400 uppercase font-semibold">
                        Total Profit
                      </div>
                      <div className="text-xs font-bold font-mono tabular-nums text-emerald-400 mt-0.5 truncate">
                        {formatCurrency(group.totalProfit, settings.currencySymbol)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expand / See More Footer */}
                {(group.sales.length > SALES_PAGE_SIZE || visibleLimit > SALES_PAGE_SIZE) && (
                  <div className="p-3 bg-slate-950/40 border-t border-slate-800/80 space-y-2">
                    <div className="text-[10px] text-slate-500 text-center">
                      Showing{' '}
                      <span className="text-slate-300 font-semibold">
                        {visibleSales.length.toLocaleString()}
                      </span>{' '}
                      of{' '}
                      <span className="text-slate-300 font-semibold">
                        {group.sales.length.toLocaleString()}
                      </span>{' '}
                      sales
                    </div>
                    <div className="flex items-center gap-2">
                      {visibleLimit > SALES_PAGE_SIZE && (
                        <button
                          type="button"
                          onClick={() =>
                            setGroupVisibleCounts(prev => ({
                              ...prev,
                              [group.key]: SALES_PAGE_SIZE,
                            }))
                          }
                          className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 text-[11px] font-semibold transition"
                        >
                          Show Less
                        </button>
                      )}
                      {hasMore && (
                        <button
                          type="button"
                          onClick={() =>
                            setGroupVisibleCounts(prev => ({
                              ...prev,
                              [group.key]: (prev[group.key] ?? SALES_PAGE_SIZE) + SALES_PAGE_SIZE,
                            }))
                          }
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-[11px] font-semibold shadow transition"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span>See More ({Math.min(SALES_PAGE_SIZE, remaining)})</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Edit Sale Modal */}
      {editingSale && canEditSale && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-2xl w-full p-4 sm:p-6 shadow-2xl max-h-[95vh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2 text-blue-400 min-w-0">
                <Pencil className="w-5 h-5 shrink-0" />
                <h3 className="text-sm sm:text-base font-bold text-white truncate">
                  Edit Sale #{editingSale.receiptNumber}
                </h3>
              </div>
              <button
                onClick={() => setEditingSale(null)}
                className="text-slate-400 hover:text-white p-1 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-xs mb-4">
              <strong>Stock Recalculation:</strong> Editing this sale will reverse the original
              quantities and apply the new ones automatically.
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Edit Reason (Optional)
                </label>
                <input
                  type="text"
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  placeholder="Optional - e.g. Wrong quantity entered"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white text-xs"
                />
              </div>

              <div className="space-y-2.5 max-h-72 overflow-y-auto">
                {editItems.map((item, idx) => {
                  const product = products.find(p => p.id === item.productId);
                  return (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2"
                    >
                      <div>
                        <span className="text-white text-xs font-semibold">
                          {product?.name || 'Unknown'}
                        </span>
                        <span className="text-slate-500 text-[10px] block font-mono">
                          {product?.sku || ''}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-0.5">
                            Qty
                          </label>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            value={item.quantity}
                            onChange={e => {
                              const val = e.target.value;
                              const newItems = [...editItems];
                              newItems[idx] = {
                                ...newItems[idx],
                                quantity: val === '' ? ('' as any) : parseInt(val) || 0,
                              };
                              setEditItems(newItems);
                            }}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-2 text-white font-mono text-center text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-0.5">
                            Price
                          </label>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={e => {
                              const val = e.target.value;
                              const newItems = [...editItems];
                              newItems[idx] = {
                                ...newItems[idx],
                                unitPrice: val === '' ? ('' as any) : parseFloat(val) || 0,
                              };
                              setEditItems(newItems);
                            }}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-2 text-white font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-0.5">
                            Discount
                          </label>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={item.discount || 0}
                            onChange={e => {
                              const val = e.target.value;
                              const newItems = [...editItems];
                              newItems[idx] = {
                                ...newItems[idx],
                                discount: val === '' ? ('' as any) : parseFloat(val) || 0,
                              };
                              setEditItems(newItems);
                            }}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-2 text-white font-mono text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setEditingSale(null)}
                className="px-4 py-2.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isEditing}
                className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-50"
              >
                {isEditing ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void Modal */}
      {voidingSale && canVoidSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2 text-rose-400">
                <Ban className="w-5 h-5" />
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Void Sale {voidingSale.receiptNumber}
                </h3>
              </div>
              <button
                onClick={() => setVoidingSale(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-xs mb-4 flex items-start gap-2">
              <RotateCcw className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong>Automatic Stock Restoration:</strong> Voiding will restock all{' '}
                <strong>
                  {voidingSale.items.reduce((s, i) => s + i.quantity, 0)} units
                </strong>{' '}
                back into inventory.
              </div>
            </div>

            <div className="space-y-3 text-xs mb-5">
              <label className="block text-slate-300 font-semibold mb-1">
                Cancellation Reason *
              </label>
              <textarea
                required
                rows={3}
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                placeholder="e.g. Customer returned items..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setVoidingSale(null)}
                className="px-4 py-2.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteVoid}
                disabled={isVoiding}
                className="px-4 py-2.5 rounded-lg bg-rose-600 text-white text-xs font-bold disabled:opacity-50"
              >
                {isVoiding ? 'Processing...' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
