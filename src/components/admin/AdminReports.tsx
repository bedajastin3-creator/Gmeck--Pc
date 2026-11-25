import React, { useState, useMemo } from 'react';
import {
  FileText,
  Printer,
  Calendar,
  Download,
  Users,
  Package,
  Store,
  Search,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Scale,
  Coins,
  UserCheck,
  Crown,
  ArrowLeft,
  Trophy,
  Award,
  Loader2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  ProfitLossPeriod,
  ReportService,
} from '../../services/reportService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  downloadFinancialReportPdf,
  downloadPriceDeviationsPdf,
  downloadShopProfitLossPdf,
  printFinancialReportPdf,
  printPriceDeviationsPdf,
  printShopProfitLossPdf,
} from '../../utils/pdfExport';
import { saveTextFileCrossPlatform } from '../../utils/nativeDownload';
import {
  getAdminManagedShops,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../../utils/permissions';
import { CustomDateRangeCalendar } from '../common/CustomDateRangeCalendar';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type ReportPeriod = 'today' | 'week' | 'month' | 'year' | 'custom';

interface DeviationRow {
  saleId: string;
  receiptNumber: string;
  createdAt: string;
  shopId: string;
  shopName: string;
  sellerId: string;
  sellerName: string;
  assistantName?: string;
  sellerDisplayName: string;
  productId: string;
  productName: string;
  sku: string;
  referencePrice: number;
  soldPrice: number;
  purchasePrice: number;
  quantity: number;
  diff: number;
  totalImpact: number;
  direction: 'ABOVE' | 'BELOW';
  usedSnapshot: boolean;
  belowCost: boolean;
  costLoss: number;
}

type DeviationDirection = 'ALL' | 'ABOVE' | 'BELOW' | 'BELOW_COST';

function toLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeRange(period: ReportPeriod, customFrom: string, customTo: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (period === 'today') {
    const d = toLocalYMD(now);
    return { from: d, to: d };
  }
  if (period === 'week') {
    const past = new Date(now);
    past.setDate(past.getDate() - 6);
    return { from: toLocalYMD(past), to: toLocalYMD(now) };
  }
  if (period === 'month') {
    const past = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toLocalYMD(past), to: toLocalYMD(now) };
  }
  if (period === 'year') {
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    return { from: toLocalYMD(startOfYear), to: toLocalYMD(now) };
  }
  return { from: customFrom || undefined, to: customTo || undefined };
}

// ─────────────────────────────────────────────────────────────
// Section Header
// ─────────────────────────────────────────────────────────────
const ReportSectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  period: ReportPeriod;
  onPeriodChange: (p: ReportPeriod) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (v: string) => void;
  onCustomEndChange: (v: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  actions?: React.ReactNode;
  accent?: 'blue' | 'rose' | 'purple' | 'amber' | 'emerald';
}> = ({
  title,
  subtitle,
  icon,
  period,
  onPeriodChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
  collapsed,
  onToggleCollapsed,
  actions,
  accent = 'blue',
}) => {
  const [calendarOpenTrigger, setCalendarOpenTrigger] = useState(0);
  const accents: Record<string, string> = {
    blue: 'from-blue-950/20 via-slate-900 to-slate-900',
    rose: 'from-rose-950/20 via-slate-900 to-slate-900',
    purple: 'from-purple-950/20 via-slate-900 to-slate-900',
    amber: 'from-amber-950/20 via-slate-900 to-slate-900',
    emerald: 'from-emerald-950/20 via-slate-900 to-slate-900',
  };
  const pillActive: Record<string, string> = {
    blue: 'bg-blue-600 text-white shadow-sm',
    rose: 'bg-rose-600 text-white shadow-sm',
    purple: 'bg-purple-600 text-white shadow-sm',
    amber: 'bg-amber-600 text-white shadow-sm',
    emerald: 'bg-emerald-600 text-white shadow-sm',
  };

  return (
    <div className={`border-b border-slate-800 bg-gradient-to-r ${accents[accent]} p-3.5 sm:p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex items-start gap-2.5 flex-1 min-w-0 text-left active:opacity-80"
        >
          <span className="text-slate-500 mt-0.5 shrink-0">
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
          {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-white leading-tight">{title}</span>
            {subtitle && (
              <span className="block text-[11px] text-slate-400 mt-0.5 leading-tight">{subtitle}</span>
            )}
          </span>
        </button>
        {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
      </div>

      {!collapsed && (
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-semibold">
          {[
            { id: 'today', label: 'Day' },
            { id: 'week', label: 'Week' },
            { id: 'month', label: 'Month' },
            { id: 'year', label: 'Year' },
            { id: 'custom', label: 'Custom' },
          ].map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onPeriodChange(p.id as ReportPeriod);
                if (p.id === 'custom') {
                  setCalendarOpenTrigger(c => c + 1);
                }
              }}
              className={`flex-1 px-2 py-1.5 rounded-lg transition active:scale-95 ${
                period === p.id ? pillActive[accent] : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {period === 'custom' && !collapsed && (
        <CustomDateRangeCalendar
          startDate={customStart}
          endDate={customEnd}
          onChangeStartDate={onCustomStartChange}
          onChangeEndDate={onCustomEndChange}
          openTrigger={calendarOpenTrigger}
          accent={accent === 'rose' ? 'amber' : accent}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export const AdminReports: React.FC = () => {
  const { currentUser, dbState, addToast } = useApp();

  const [incomePeriod, setIncomePeriod] = useState<ReportPeriod>('today');
  const [incomeStart, setIncomeStart] = useState('');
  const [incomeEnd, setIncomeEnd] = useState('');

  const [deviationPeriod, setDeviationPeriod] = useState<ReportPeriod>('today');
  const [deviationStart, setDeviationStart] = useState('');
  const [deviationEnd, setDeviationEnd] = useState('');

  const [shopPeriod, setShopPeriod] = useState<ReportPeriod>('today');
  const [shopStart, setShopStart] = useState('');
  const [shopEnd, setShopEnd] = useState('');

  const [productPeriod, setProductPeriod] = useState<ReportPeriod>('today');
  const [productStart, setProductStart] = useState('');
  const [productEnd, setProductEnd] = useState('');

  const [sellerPeriod, setSellerPeriod] = useState<ReportPeriod>('today');
  const [sellerStart, setSellerStart] = useState('');
  const [sellerEnd, setSellerEnd] = useState('');

  const [assistantPeriod, setAssistantPeriod] = useState<ReportPeriod>('today');
  const [assistantStart, setAssistantStart] = useState('');
  const [assistantEnd, setAssistantEnd] = useState('');

  const [pnlPeriod, setPnlPeriod] = useState<ProfitLossPeriod>('day');
  const [pnlStart, setPnlStart] = useState('');
  const [pnlEnd, setPnlEnd] = useState('');
  const [pnlCalendarTrigger, setPnlCalendarTrigger] = useState(0);
  const [rankCalendarTrigger, setRankCalendarTrigger] = useState(0);
  const [pnlCollapsed, setPnlCollapsed] = useState(false);
  const [pnlSort, setPnlSort] = useState<'NET_DESC' | 'CAPITAL_DESC' | 'LOSS_DESC' | 'NAME_ASC'>('NET_DESC');
  const [pnlOutcomeFilter, setPnlOutcomeFilter] = useState<'ALL' | 'PROFIT' | 'LOSS'>('ALL');

  const [incomeCollapsed, setIncomeCollapsed] = useState(false);
  const [deviationCollapsed, setDeviationCollapsed] = useState(false);
  const [shopsCollapsed, setShopsCollapsed] = useState(false);
  const [productsCollapsed, setProductsCollapsed] = useState(false);
  const [sellersCollapsed, setSellersCollapsed] = useState(false);
  const [assistantsCollapsed, setAssistantsCollapsed] = useState(false);

  const [shopFilter, setShopFilter] = useState('ALL');
  const [productSearch, setProductSearch] = useState('');
  const [sellerSearch, setSellerSearch] = useState('');
  const [assistantSearch, setAssistantSearch] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isPrintingPnl, setIsPrintingPnl] = useState(false);
  const [isDownloadingPnl, setIsDownloadingPnl] = useState(false);
  const [isPrintingDeviations, setIsPrintingDeviations] = useState(false);
  const [isDownloadingDeviations, setIsDownloadingDeviations] = useState(false);
  const [deviationDirection, setDeviationDirection] = useState<DeviationDirection>('ALL');

  // Full-page Assistant Rankings state
  const [showAssistantRankingPage, setShowAssistantRankingPage] = useState(false);
  const [rankPeriod, setRankPeriod] = useState<'today' | 'week' | 'month' | 'custom'>('month');
  const [rankStart, setRankStart] = useState('');
  const [rankEnd, setRankEnd] = useState('');
  const [rankMode, setRankMode] = useState<'mauzo' | 'above_ref'>('mauzo');
  const [rankSearch, setRankSearch] = useState('');

  const canAccessReports = Boolean(
    currentUser && (hasAdminAccess(currentUser) || currentUser.permissions?.canViewReports)
  );

  const platformAdmin = isPlatformAdmin(currentUser);
  const shopAdmin = isShopAdmin(currentUser);
  const settings = dbState.settings;
  const salesAssistantEnabled = Boolean(settings.enableSalesAssistant);

  const shops = useMemo(() => {
    const allShops = dbState.shops || [];
    if (!currentUser) return [];
    if (platformAdmin) return allShops;
    if (shopAdmin) return getAdminManagedShops(currentUser, allShops);
    return allShops.filter((s: any) => (currentUser.assignedShopIds || []).includes(s.id));
  }, [dbState.shops, currentUser, platformAdmin, shopAdmin]);

  const products = useMemo(() => {
    const visibleShopIdSet = new Set(shops.map((s: any) => s.id));
    return (dbState.products || []).filter(
      (p: any) => platformAdmin || (Boolean(p.shopId) && visibleShopIdSet.has(p.shopId))
    );
  }, [dbState.products, shops, platformAdmin]);

  const effectiveShopFilter = useMemo(() => {
    if (platformAdmin) return shopFilter;
    if (shopAdmin) {
      if (shops.length <= 1) return shops[0]?.id || 'ALL';
      if (shopFilter === 'ALL' || shops.some((s: any) => s.id === shopFilter)) {
        return shopFilter;
      }
      return 'ALL';
    }
    if (shopFilter === 'ALL' || shops.some((s: any) => s.id === shopFilter)) {
      return shopFilter;
    }
    return shops[0]?.id || 'ALL';
  }, [platformAdmin, shopAdmin, shops, shopFilter]);

  const incomeRange = useMemo(() => computeRange(incomePeriod, incomeStart, incomeEnd), [incomePeriod, incomeStart, incomeEnd]);
  const deviationRange = useMemo(() => computeRange(deviationPeriod, deviationStart, deviationEnd), [deviationPeriod, deviationStart, deviationEnd]);
  const shopRange = useMemo(() => computeRange(shopPeriod, shopStart, shopEnd), [shopPeriod, shopStart, shopEnd]);
  const productRange = useMemo(() => computeRange(productPeriod, productStart, productEnd), [productPeriod, productStart, productEnd]);
  const sellerRange = useMemo(() => computeRange(sellerPeriod, sellerStart, sellerEnd), [sellerPeriod, sellerStart, sellerEnd]);
  const assistantRange = useMemo(() => computeRange(assistantPeriod, assistantStart, assistantEnd), [assistantPeriod, assistantStart, assistantEnd]);
  const rankRange = useMemo(() => computeRange(rankPeriod, rankStart, rankEnd), [rankPeriod, rankStart, rankEnd]);
  const pnlRange = useMemo(
    () => ReportService.computeProfitLossDateRange(pnlPeriod, pnlStart, pnlEnd),
    [pnlPeriod, pnlStart, pnlEnd]
  );

  const incomeSummary = useMemo(
    () =>
      canAccessReports && currentUser
        ? ReportService.getFinancialSummary(incomeRange, { shopId: effectiveShopFilter }, currentUser) || {}
        : {},
    [canAccessReports, incomeRange, currentUser, dbState, effectiveShopFilter]
  );
  const shopSummary = useMemo(
    () =>
      canAccessReports && currentUser
        ? ReportService.getFinancialSummary(shopRange, { shopId: effectiveShopFilter }, currentUser) || {}
        : {},
    [canAccessReports, shopRange, currentUser, dbState, effectiveShopFilter]
  );
  const productSummary = useMemo(
    () =>
      canAccessReports && currentUser
        ? ReportService.getFinancialSummary(productRange, { shopId: effectiveShopFilter }, currentUser) || {}
        : {},
    [canAccessReports, productRange, currentUser, dbState, effectiveShopFilter]
  );
  const sellerSummary = useMemo(
    () =>
      canAccessReports && currentUser
        ? ReportService.getFinancialSummary(sellerRange, { shopId: effectiveShopFilter }, currentUser) || {}
        : {},
    [canAccessReports, sellerRange, currentUser, dbState, effectiveShopFilter]
  );
  const assistantSummary = useMemo(
    () =>
      canAccessReports && currentUser
        ? ReportService.getFinancialSummary(assistantRange, { shopId: effectiveShopFilter }, currentUser) || {}
        : {},
    [canAccessReports, assistantRange, currentUser, dbState, effectiveShopFilter]
  );
  const rankSummary = useMemo(
    () =>
      canAccessReports && currentUser
        ? ReportService.getFinancialSummary(rankRange, { shopId: effectiveShopFilter }, currentUser) || {}
        : {},
    [canAccessReports, rankRange, currentUser, dbState, effectiveShopFilter]
  );
  const deviationSummary = useMemo(
    () =>
      canAccessReports && currentUser
        ? ReportService.getFinancialSummary(deviationRange, { shopId: effectiveShopFilter }, currentUser) || {}
        : {},
    [canAccessReports, deviationRange, currentUser, dbState, effectiveShopFilter]
  );

  // Always show all accessible shops in Shop Profit & Loss so every shop's capital, profit & loss can be compared
  const shopProfitLoss = useMemo(() => {
    if (!canAccessReports || !currentUser) {
      return {
        shops: [],
        generalCompanyExpenses: 0,
        totals: {
          skuCount: 0,
          totalUnits: 0,
          floorCapital: 0,
          storeCapital: 0,
          totalCapital: 0,
          expectedRetailValue: 0,
          salesCount: 0,
          revenue: 0,
          costOfGoods: 0,
          grossProfit: 0,
          grossMarginPercent: 0,
          expenses: 0,
          stockLossUnits: 0,
          stockLossValue: 0,
          belowCostSalesLoss: 0,
          totalLossAndExpenses: 0,
          netProfit: 0,
          netMarginPercent: 0,
          netAfterCompanyExpenses: 0,
        },
      };
    }
    return ReportService.getShopProfitAndLoss(pnlRange, currentUser, { shopId: 'ALL' });
  }, [canAccessReports, pnlRange, currentUser, dbState]);

  const visiblePnlShops = useMemo(() => {
    let list = [...shopProfitLoss.shops];
    if (pnlOutcomeFilter === 'PROFIT') {
      list = list.filter(s => s.netProfit >= 0);
    } else if (pnlOutcomeFilter === 'LOSS') {
      list = list.filter(s => s.netProfit < 0 || s.stockLossValue > 0 || s.belowCostSalesLoss > 0);
    }

    list.sort((a, b) => {
      if (pnlSort === 'CAPITAL_DESC') return b.totalCapital - a.totalCapital || a.shopName.localeCompare(b.shopName);
      if (pnlSort === 'LOSS_DESC') return b.totalLossAndExpenses - a.totalLossAndExpenses || a.netProfit - b.netProfit;
      if (pnlSort === 'NAME_ASC') return a.shopName.localeCompare(b.shopName);
      return b.netProfit - a.netProfit || b.totalCapital - a.totalCapital;
    });
    return list;
  }, [shopProfitLoss.shops, pnlOutcomeFilter, pnlSort]);

  const filteredProducts = useMemo(() => {
    const list = (productSummary as any).topProducts || [];
    if (!productSearch.trim()) return list;
    const q = productSearch.trim().toLowerCase();
    return list.filter(
      (p: any) =>
        (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)
    );
  }, [productSummary, productSearch]);

  const filteredSellers = useMemo(() => {
    const list = (sellerSummary as any).sellerSales || [];
    if (!sellerSearch.trim()) return list;
    const q = sellerSearch.trim().toLowerCase();
    return list.filter((s: any) => (s.name || '').toLowerCase().includes(q));
  }, [sellerSummary, sellerSearch]);

  // ─────────────────────────────────────────────────────────────
  // Assistant Performance grouped under each Seller
  // ─────────────────────────────────────────────────────────────
  const assistantPerformance = useMemo(() => {
    const sales = ((assistantSummary as any).filteredSales || []) as any[];
    const sellerMap = new Map<
      string,
      {
        sellerKey: string;
        sellerName: string;
        totalOrders: number;
        totalSales: number;
        totalProfit: number;
        assistantsMap: Map<
          string,
          {
            key: string;
            assistantName: string;
            orders: number;
            itemsSold: number;
            totalSales: number;
            profit: number;
          }
        >;
      }
    >();

    for (const sale of sales) {
      if (sale.status === 'VOIDED') continue;
      const rawAssistant = (sale.assistantName || '').trim();
      if (!rawAssistant) continue;

      const sellerKey = sale.sellerId || sale.sellerName || 'unknown';
      const sellerName = sale.sellerName || 'Seller';
      if (!sellerMap.has(sellerKey)) {
        sellerMap.set(sellerKey, {
          sellerKey,
          sellerName,
          totalOrders: 0,
          totalSales: 0,
          totalProfit: 0,
          assistantsMap: new Map(),
        });
      }
      const sellerGroup = sellerMap.get(sellerKey)!;
      const saleTotal = Number(sale.total || 0);
      const saleProfit = Number(sale.grossProfit || 0);
      const saleUnits = (sale.items || []).reduce(
        (sum: number, it: any) => sum + Number(it.quantity || 0),
        0
      );

      sellerGroup.totalOrders += 1;
      sellerGroup.totalSales += saleTotal;
      sellerGroup.totalProfit += saleProfit;

      const assistantKey = rawAssistant.toLowerCase();
      if (!sellerGroup.assistantsMap.has(assistantKey)) {
        sellerGroup.assistantsMap.set(assistantKey, {
          key: `${sellerKey}::${assistantKey}`,
          assistantName: rawAssistant,
          orders: 0,
          itemsSold: 0,
          totalSales: 0,
          profit: 0,
        });
      }
      const asst = sellerGroup.assistantsMap.get(assistantKey)!;
      asst.orders += 1;
      asst.itemsSold += saleUnits;
      asst.totalSales += saleTotal;
      asst.profit += saleProfit;
    }

    const q = assistantSearch.trim().toLowerCase();
    const groups = Array.from(sellerMap.values())
      .map(g => {
        const allAssistants = Array.from(g.assistantsMap.values())
          .map(a => ({
            ...a,
            avgOrder: a.orders > 0 ? a.totalSales / a.orders : 0,
            sharePct:
              g.totalSales > 0 ? Math.min(100, Math.round((a.totalSales / g.totalSales) * 100)) : 0,
          }))
          .sort((a, b) => b.totalSales - a.totalSales || b.orders - a.orders);

        const filteredAssistants = q
          ? g.sellerName.toLowerCase().includes(q)
            ? allAssistants
            : allAssistants.filter(a => a.assistantName.toLowerCase().includes(q))
          : allAssistants;

        return {
          sellerKey: g.sellerKey,
          sellerName: g.sellerName,
          totalOrders: g.totalOrders,
          totalSales: g.totalSales,
          totalProfit: g.totalProfit,
          assistants: filteredAssistants,
        };
      })
      .filter(g => g.assistants.length > 0)
      .sort((a, b) => b.totalSales - a.totalSales || a.sellerName.localeCompare(b.sellerName));

    const totalAssistants = groups.reduce((s, g) => s + g.assistants.length, 0);
    const totalOrders = groups.reduce(
      (s, g) => s + g.assistants.reduce((a, b) => a + b.orders, 0),
      0
    );
    const totalSales = groups.reduce(
      (s, g) => s + g.assistants.reduce((a, b) => a + b.totalSales, 0),
      0
    );
    const totalProfit = groups.reduce(
      (s, g) => s + g.assistants.reduce((a, b) => a + b.profit, 0),
      0
    );

    return { groups, totalAssistants, totalOrders, totalSales, totalProfit };
  }, [assistantSummary, assistantSearch]);

  // ─────────────────────────────────────────────────────────────
  // Full-Page Assistant Leaderboard (Mauzo Mengi & Above Reference)
  // ─────────────────────────────────────────────────────────────
  const assistantLeaderboard = useMemo(() => {
    const sales = ((rankSummary as any).filteredSales || []) as any[];
    const productMap = new Map(products.map((p: any) => [p.id, p]));

    const byAssistant = new Map<
      string,
      {
        key: string;
        assistantName: string;
        sellers: Set<string>;
        shops: Set<string>;
        orders: number;
        itemsSold: number;
        totalSales: number;
        totalProfit: number;
        aboveRefTotalGain: number;
        aboveRefItemsCount: number;
        aboveRefUnits: number;
        aboveRefSaleIds: Set<string>;
        aboveRefSalesValue: number;
      }
    >();

    for (const sale of sales) {
      if (sale.status === 'VOIDED') continue;
      const rawAssistant = (sale.assistantName || '').trim();
      if (!rawAssistant) continue;

      const key = rawAssistant.toLowerCase();
      if (!byAssistant.has(key)) {
        byAssistant.set(key, {
          key,
          assistantName: rawAssistant,
          sellers: new Set<string>(),
          shops: new Set<string>(),
          orders: 0,
          itemsSold: 0,
          totalSales: 0,
          totalProfit: 0,
          aboveRefTotalGain: 0,
          aboveRefItemsCount: 0,
          aboveRefUnits: 0,
          aboveRefSaleIds: new Set<string>(),
          aboveRefSalesValue: 0,
        });
      }

      const rec = byAssistant.get(key)!;
      if (sale.sellerName) rec.sellers.add(sale.sellerName);
      if (sale.shopName) rec.shops.add(sale.shopName);

      const saleTotal = Number(sale.total || 0);
      const saleProfit = Number(sale.grossProfit || 0);
      const saleUnits = (sale.items || []).reduce(
        (sum: number, it: any) => sum + Number(it.quantity || 0),
        0
      );

      rec.orders += 1;
      rec.itemsSold += saleUnits;
      rec.totalSales += saleTotal;
      rec.totalProfit += saleProfit;

      // Above Reference price check (snapshot-first, identical to Price Deviation Audit)
      for (const item of sale.items || []) {
        const product: any = productMap.get(item.productId);
        const hasSnapshot =
          item.referencePrice !== undefined &&
          item.referencePrice !== null &&
          item.referencePrice > 0;

        let referencePrice = 0;
        if (hasSnapshot) {
          referencePrice = Number(item.referencePrice);
        } else if (product) {
          referencePrice =
            product.proposedSellingPrice && product.proposedSellingPrice > 0
              ? Number(product.proposedSellingPrice)
              : Number(product.sellingPrice || 0);
        }

        const soldPrice = Number(item.unitPrice || 0);
        const qty = Number(item.quantity || 0);

        if (referencePrice > 0 && soldPrice > referencePrice && qty > 0) {
          const extraGain = Number(((soldPrice - referencePrice) * qty).toFixed(2));
          rec.aboveRefTotalGain += extraGain;
          rec.aboveRefItemsCount += 1;
          rec.aboveRefUnits += qty;
          rec.aboveRefSaleIds.add(sale.id);
          rec.aboveRefSalesValue += soldPrice * qty;
        }
      }
    }

    const normalized = Array.from(byAssistant.values()).map(r => ({
      key: r.key,
      assistantName: r.assistantName,
      sellersLabel: Array.from(r.sellers).join(', ') || 'Seller',
      shopsLabel: Array.from(r.shops).join(', '),
      orders: r.orders,
      itemsSold: r.itemsSold,
      totalSales: Number(r.totalSales.toFixed(2)),
      totalProfit: Number(r.totalProfit.toFixed(2)),
      avgOrder: r.orders > 0 ? Number((r.totalSales / r.orders).toFixed(2)) : 0,
      aboveRefTotalGain: Number(r.aboveRefTotalGain.toFixed(2)),
      aboveRefItemsCount: r.aboveRefItemsCount,
      aboveRefUnits: r.aboveRefUnits,
      aboveRefOrders: r.aboveRefSaleIds.size,
      aboveRefSalesValue: Number(r.aboveRefSalesValue.toFixed(2)),
      avgGainPerUnit:
        r.aboveRefUnits > 0 ? Number((r.aboveRefTotalGain / r.aboveRefUnits).toFixed(2)) : 0,
    }));

    const mauzoRanked = [...normalized]
      .filter(a => a.orders > 0)
      .sort(
        (a, b) =>
          b.totalSales - a.totalSales ||
          b.orders - a.orders ||
          b.totalProfit - a.totalProfit ||
          a.assistantName.localeCompare(b.assistantName)
      )
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    const aboveRefRanked = [...normalized]
      .filter(a => a.aboveRefTotalGain > 0)
      .sort(
        (a, b) =>
          b.aboveRefTotalGain - a.aboveRefTotalGain ||
          b.aboveRefItemsCount - a.aboveRefItemsCount ||
          b.aboveRefUnits - a.aboveRefUnits ||
          a.assistantName.localeCompare(b.assistantName)
      )
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    return {
      mauzoRanked,
      aboveRefRanked,
      topMauzo: mauzoRanked[0] || null,
      topAboveRef: aboveRefRanked[0] || null,
      totalAssistants: mauzoRanked.length,
      totalMauzoSales: Number(mauzoRanked.reduce((s, a) => s + a.totalSales, 0).toFixed(2)),
      totalAboveRefGain: Number(
        aboveRefRanked.reduce((s, a) => s + a.aboveRefTotalGain, 0).toFixed(2)
      ),
    };
  }, [rankSummary, products]);

  // ─────────────────────────────────────────────────────────────
  // Deviations — snapshot-first, below-cost detection, no silent skips
  // ─────────────────────────────────────────────────────────────
  const allDeviations = useMemo<DeviationRow[]>(() => {
    const sales = (deviationSummary as any).filteredSales || [];
    const productMap = new Map(products.map((p: any) => [p.id, p]));
    const rows: DeviationRow[] = [];

    for (const sale of sales) {
      if (sale.status === 'VOIDED') continue;

      for (const item of sale.items || []) {
        const product: any = productMap.get(item.productId);

        const hasSnapshot =
          item.referencePrice !== undefined &&
          item.referencePrice !== null &&
          item.referencePrice > 0;

        let referencePrice = 0;
        let usedSnapshot = false;

        if (hasSnapshot) {
          referencePrice = item.referencePrice as number;
          usedSnapshot = true;
        } else if (product) {
          referencePrice =
            product.proposedSellingPrice && product.proposedSellingPrice > 0
              ? product.proposedSellingPrice
              : product.sellingPrice || 0;
          usedSnapshot = false;
        }

        const soldPrice = item.unitPrice || 0;
        const purchasePrice = item.purchasePrice || 0;
        const qty = item.quantity || 0;

        const belowCost = purchasePrice > 0 && soldPrice < purchasePrice;
        const costLoss = belowCost
          ? Number(((purchasePrice - soldPrice) * qty).toFixed(2))
          : 0;

        if (referencePrice <= 0 && !belowCost) continue;
        if (referencePrice > 0 && soldPrice === referencePrice && !belowCost) continue;

        const diff = referencePrice > 0 ? Number((soldPrice - referencePrice).toFixed(2)) : 0;
        const totalImpact = referencePrice > 0 ? Number((diff * qty).toFixed(2)) : 0;

        const assistantTrimmed = (sale.assistantName || '').trim();
        const sellerDisplayName =
          salesAssistantEnabled && assistantTrimmed
            ? `${sale.sellerName}/${assistantTrimmed}`
            : sale.sellerName;

        rows.push({
          saleId: sale.id,
          receiptNumber: sale.receiptNumber,
          createdAt: sale.createdAt,
          shopId: sale.shopId,
          shopName: sale.shopName || '',
          sellerId: sale.sellerId,
          sellerName: sale.sellerName,
          assistantName: assistantTrimmed || undefined,
          sellerDisplayName,
          productId: item.productId,
          productName: item.productName,
          sku: item.sku || product?.sku || '',
          referencePrice,
          soldPrice,
          purchasePrice,
          quantity: qty,
          diff,
          totalImpact,
          direction: diff > 0 ? 'ABOVE' : 'BELOW',
          usedSnapshot,
          belowCost,
          costLoss,
        });
      }
    }

    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return rows;
  }, [deviationSummary, products, salesAssistantEnabled]);

  const deviations = useMemo(() => {
    if (deviationDirection === 'ALL') return allDeviations;
    if (deviationDirection === 'BELOW_COST') return allDeviations.filter(d => d.belowCost);
    if (deviationDirection === 'BELOW')
      return allDeviations.filter(d => d.direction === 'BELOW' && d.referencePrice > 0);
    return allDeviations.filter(d => d.direction === 'ABOVE' && d.referencePrice > 0);
  }, [allDeviations, deviationDirection]);

  const deviationStats = useMemo(() => {
    const belowRefRows = allDeviations.filter(d => d.direction === 'BELOW' && d.referencePrice > 0);
    const aboveRefRows = allDeviations.filter(d => d.direction === 'ABOVE' && d.referencePrice > 0);
    const belowCostRows = allDeviations.filter(d => d.belowCost);

    const belowImpact = belowRefRows.reduce((s, r) => s + r.totalImpact, 0);
    const aboveImpact = aboveRefRows.reduce((s, r) => s + r.totalImpact, 0);
    const costLoss = belowCostRows.reduce((s, r) => s + r.costLoss, 0);

    return {
      belowCount: belowRefRows.length,
      aboveCount: aboveRefRows.length,
      belowCostCount: belowCostRows.length,
      belowSalesCount: new Set(belowRefRows.map(r => r.saleId)).size,
      aboveSalesCount: new Set(aboveRefRows.map(r => r.saleId)).size,
      belowImpact: Number(belowImpact.toFixed(2)),
      aboveImpact: Number(aboveImpact.toFixed(2)),
      costLoss: Number(costLoss.toFixed(2)),
      netImpact: Number((belowImpact + aboveImpact).toFixed(2)),
    };
  }, [allDeviations]);

  if (!canAccessReports) return null;

  const selectedShopName =
    effectiveShopFilter === 'ALL'
      ? shopAdmin && !platformAdmin
        ? shops.length === 1
          ? shops[0].name
          : 'All Managed Shops'
        : 'All Shops'
      : shops.find((s: any) => s.id === effectiveShopFilter)?.name || 'Unknown';

  const DEVIATION_DISPLAY_CAP = 100;
  const visibleDeviations = deviations.slice(0, DEVIATION_DISPLAY_CAP);
  const hiddenDeviationCount = Math.max(0, deviations.length - DEVIATION_DISPLAY_CAP);

  // ─────────────────────────────────────────────────────────────
  // Print & Download Main Report
  // ─────────────────────────────────────────────────────────────
  const buildFinancialReportMeta = () => {
    const periodLabelMap: Record<ReportPeriod, { key: string; label: string }> = {
      today: { key: 'day', label: 'Day (Today)' },
      week: { key: 'week', label: 'Week (Last 7 Days)' },
      month: { key: 'month', label: 'Month (This Month)' },
      year: { key: 'year', label: 'Year (This Year)' },
      custom: { key: 'custom', label: 'Custom Range' },
    };
    const pMeta = periodLabelMap[incomePeriod];
    return {
      pMeta,
      meta: {
        shopLabel: selectedShopName,
        from: incomeRange.from || undefined,
        to: incomeRange.to || undefined,
        periodKey: pMeta.key,
        periodLabel: pMeta.label,
      },
    };
  };

  const handleDownloadReportPdf = async () => {
    if (isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    try {
      const { pMeta, meta } = buildFinancialReportMeta();
      const ok = await downloadFinancialReportPdf(incomeSummary, settings, meta);
      if (ok) {
        addToast({
          type: 'success',
          title: `Financial PDF Downloaded (${pMeta.label})`,
          description: `Saved ${pMeta.label} financial report for ${selectedShopName} to Downloads.`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'PDF Export Failed',
          description: 'Could not save financial PDF report on this device.',
        });
      }
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handlePrintReport = async () => {
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      const { pMeta, meta } = buildFinancialReportMeta();
      const res = await printFinancialReportPdf(incomeSummary, settings, meta);
      if (res.ok) {
        addToast({
          type: 'success',
          title:
            res.mode === 'fallback_download'
              ? `Opened Financial PDF (${pMeta.label})`
              : 'Print Dialog Opened',
          description:
            res.mode === 'fallback_download'
              ? 'Use the printer option in your PDF viewer to print.'
              : `Ready to print ${pMeta.label} financial report for ${selectedShopName}.`,
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

  // ─────────────────────────────────────────────────────────────
  // Print & Download Deviations PDF
  // ─────────────────────────────────────────────────────────────
  const handleDownloadDeviationsPdf = async () => {
    if (deviations.length === 0) {
      addToast({
        type: 'info',
        title: 'No Deviations',
        description: 'There are no price deviations in the current filter.',
      });
      return;
    }
    if (isDownloadingDeviations) return;
    setIsDownloadingDeviations(true);
    try {
      const ok = await downloadPriceDeviationsPdf(deviations, deviationStats, settings, {
        shopLabel: selectedShopName,
        from: deviationRange.from || undefined,
        to: deviationRange.to || undefined,
        direction: deviationDirection,
      });
      if (ok) {
        addToast({
          type: 'success',
          title: 'Deviations PDF Downloaded',
          description: `Saved PDF with ${deviations.length} price deviation(s) to Downloads.`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'PDF Export Failed',
          description: 'Could not save price deviations PDF on this device.',
        });
      }
    } finally {
      setIsDownloadingDeviations(false);
    }
  };

  const handlePrintDeviations = async () => {
    if (deviations.length === 0) {
      addToast({
        type: 'info',
        title: 'No Deviations',
        description: 'There are no price deviations in the current filter.',
      });
      return;
    }
    if (isPrintingDeviations) return;
    setIsPrintingDeviations(true);
    try {
      const res = await printPriceDeviationsPdf(deviations, deviationStats, settings, {
        shopLabel: selectedShopName,
        from: deviationRange.from || undefined,
        to: deviationRange.to || undefined,
        direction: deviationDirection,
      });
      if (res.ok) {
        addToast({
          type: 'success',
          title:
            res.mode === 'fallback_download'
              ? 'Opened Deviations PDF'
              : 'Print Dialog Opened',
          description:
            res.mode === 'fallback_download'
              ? 'Use the printer option in your PDF viewer to print.'
              : `Ready to print ${deviations.length} price deviation(s).`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'Print Failed',
          description: res.error || 'Could not open print dialog on this device.',
        });
      }
    } finally {
      setIsPrintingDeviations(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Export CSVs
  // ─────────────────────────────────────────────────────────────
  const handleExportCSV = async () => {
    const s: any = incomeSummary;
    let csv = `Financial Report - ${selectedShopName}\n`;
    csv += `Period: ${incomeRange.from || 'Beginning'} to ${incomeRange.to || 'Present'}\n\n`;
    csv += `SUMMARY\n`;
    csv += `Gross Revenue,${s.totalGrossSales || 0}\n`;
    csv += `Cost of Goods,${s.totalCostOfGoods || 0}\n`;
    csv += `Gross Profit,${s.totalGrossProfit || 0}\n`;
    csv += `Expenses,${s.totalExpenses || 0}\n`;
    csv += `Net Profit,${s.netProfit || 0}\n\n`;

    csv += `SHOP PERFORMANCE\nShop,Sales Count,Total Sales,Gross Profit\n`;
    (s.shopSalesBreakdown || []).forEach((sh: any) => {
      csv += `"${sh.name}",${sh.salesCount},${sh.totalSales},${sh.grossProfit}\n`;
    });
    csv += `\n`;

    csv += `PRODUCT PROFITABILITY\nProduct,SKU,Units,Revenue,Profit\n`;
    (s.topProducts || []).forEach((p: any) => {
      csv += `"${p.name}","${p.sku}",${p.unitsSold},${p.revenue},${p.profit}\n`;
    });
    csv += `\n`;

    csv += `SELLER PERFORMANCE\nSeller,Orders,Total,Profit\n`;
    (s.sellerSales || []).forEach((se: any) => {
      csv += `"${se.name}",${se.count},${se.total},${se.profit}\n`;
    });

    const fileName = `financial_report_${selectedShopName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    const res = await saveTextFileCrossPlatform(csv, fileName, 'text/csv;charset=utf-8');
    if (res.ok) {
      addToast({ type: 'success', title: 'Report Exported', description: `Saved ${res.location || fileName}.` });
    } else {
      addToast({ type: 'error', title: 'Export Failed', description: res.error || 'Could not save CSV report.' });
    }
  };

  const handleExportDeviationsCSV = async () => {
    if (deviations.length === 0) {
      addToast({
        type: 'info',
        title: 'No Deviations',
        description: 'There are no price deviations in the current filter.',
      });
      return;
    }

    let csv = `Price Deviation Audit - ${selectedShopName}\n`;
    csv += `Period: ${deviationRange.from || 'Beginning'} to ${deviationRange.to || 'Present'}\n`;
    csv += `Direction: ${deviationDirection}\n\n`;
    csv += `Items Below Reference,${deviationStats.belowCount}\n`;
    csv += `Items Below Cost (Loss),${deviationStats.belowCostCount}\n`;
    csv += `Items Above Reference,${deviationStats.aboveCount}\n`;
    csv += `Below Reference Value,${deviationStats.belowImpact}\n`;
    csv += `Total Cost Loss,${deviationStats.costLoss}\n`;
    csv += `Above Reference Value,${deviationStats.aboveImpact}\n`;
    csv += `Net Impact,${deviationStats.netImpact}\n\n`;
    csv += `Date,Receipt #,Shop,Seller,Product,SKU,Selling Price,Sold At,Purchase Cost,Diff,Qty,Impact,Direction,Below Cost,Reference Source\n`;
    deviations.forEach(d => {
      csv += `"${formatDateTime(d.createdAt)}","${d.receiptNumber}","${d.shopName}","${d.sellerDisplayName}","${d.productName}","${d.sku}",${d.referencePrice},${d.soldPrice},${d.purchasePrice},${d.diff},${d.quantity},${d.totalImpact},${d.direction},${d.belowCost ? 'YES' : 'NO'},"${d.usedSnapshot ? 'Snapshot' : 'Current price'}"\n`;
    });

    const fileName = `price_deviations_${selectedShopName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    const res = await saveTextFileCrossPlatform(csv, fileName, 'text/csv;charset=utf-8');
    if (res.ok) {
      addToast({ type: 'success', title: 'Deviations Exported', description: `Saved ${res.location || fileName}.` });
    } else {
      addToast({ type: 'error', title: 'Export Failed', description: res.error || 'Could not save CSV file.' });
    }
  };

  const handleExportShopProfitLossCSV = async () => {
    const rows = visiblePnlShops;
    if (rows.length === 0) {
      addToast({
        type: 'info',
        title: 'Nothing to Export',
        description: 'No shop profit & loss rows match the current filter.',
      });
      return;
    }

    let csv = `Shop Profit & Loss Statement\n`;
    csv += `Period: ${pnlRange.from || 'Beginning'} to ${pnlRange.to || 'Present'}\n\n`;
    csv += `Shop,Status,SKUs,Total Units,Floor Capital,Store Capital,Product Total Capital,Expected Retail Value,Orders,Revenue,COGS,Gross Profit,Gross Margin %,Operating Expenses,Stock Loss Units,Stock Loss Value,Below-Cost Sales Loss,Net Profit / Loss,Net Margin %,Capital Return %\n`;
    rows.forEach(r => {
      csv += `"${r.shopName.replace(/"/g, '""')}",${r.status},${r.skuCount},${r.totalUnits},${r.floorCapital},${r.storeCapital},${r.totalCapital},${r.expectedRetailValue},${r.salesCount},${r.revenue},${r.costOfGoods},${r.grossProfit},${r.grossMarginPercent}%,${r.expenses},${r.stockLossUnits},${r.stockLossValue},${r.belowCostSalesLoss},${r.netProfit},${r.netMarginPercent}%,${r.capitalReturnPercent}%\n`;
    });

    const t = shopProfitLoss.totals;
    csv += `\nCONSOLIDATED TOTALS,,${t.skuCount},${t.totalUnits},${t.floorCapital},${t.storeCapital},${t.totalCapital},${t.expectedRetailValue},${t.salesCount},${t.revenue},${t.costOfGoods},${t.grossProfit},${t.grossMarginPercent}%,${t.expenses},${t.stockLossUnits},${t.stockLossValue},${t.belowCostSalesLoss},${t.netProfit},${t.netMarginPercent}%,\n`;
    if (shopProfitLoss.generalCompanyExpenses > 0) {
      csv += `Unallocated Company Expenses,,,,,,,,,,,,,,${shopProfitLoss.generalCompanyExpenses}\n`;
      csv += `Consolidated Net After Company Expenses,,,,,,,,,,,,,,,,,${t.netAfterCompanyExpenses}\n`;
    }

    const fileName = `shop_profit_and_loss_${pnlPeriod}_${new Date().toISOString().slice(0, 10)}.csv`;
    const res = await saveTextFileCrossPlatform(csv, fileName, 'text/csv;charset=utf-8');
    if (res.ok) {
      addToast({ type: 'success', title: 'P&L Exported', description: `Saved ${res.location || fileName}.` });
    } else {
      addToast({ type: 'error', title: 'Export Failed', description: res.error || 'Could not save P&L CSV.' });
    }
  };

  const handleDownloadShopProfitLossPdf = async () => {
    const rows = visiblePnlShops;
    if (rows.length === 0) {
      addToast({
        type: 'info',
        title: 'Nothing to Export',
        description: 'No shop profit & loss data available.',
      });
      return;
    }
    if (isDownloadingPnl) return;
    setIsDownloadingPnl(true);
    try {
      const ok = await downloadShopProfitLossPdf(
        rows,
        shopProfitLoss.totals,
        shopProfitLoss.generalCompanyExpenses,
        settings,
        {
          from: pnlRange.from || undefined,
          to: pnlRange.to || undefined,
          periodLabel: pnlPeriod,
        }
      );
      if (ok) {
        addToast({
          type: 'success',
          title: 'P&L PDF Downloaded',
          description: `Saved Shop Profit & Loss PDF (${rows.length} shop(s)) to Downloads.`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'PDF Export Failed',
          description: 'Could not save Shop Profit & Loss PDF on this device.',
        });
      }
    } finally {
      setIsDownloadingPnl(false);
    }
  };

  const handlePrintShopProfitLoss = async () => {
    const rows = visiblePnlShops;
    if (rows.length === 0) {
      addToast({
        type: 'info',
        title: 'Nothing to Print',
        description: 'No shop profit & loss data available.',
      });
      return;
    }
    if (isPrintingPnl) return;
    setIsPrintingPnl(true);
    try {
      const res = await printShopProfitLossPdf(
        rows,
        shopProfitLoss.totals,
        shopProfitLoss.generalCompanyExpenses,
        settings,
        {
          from: pnlRange.from || undefined,
          to: pnlRange.to || undefined,
          periodLabel: pnlPeriod,
        }
      );
      if (res.ok) {
        addToast({
          type: 'success',
          title: res.mode === 'fallback_download' ? 'Opened P&L PDF' : 'Print Dialog Opened',
          description:
            res.mode === 'fallback_download'
              ? 'Use the printer option in your PDF viewer to print.'
              : `Ready to print Shop Profit & Loss (${rows.length} shop(s)).`,
        });
      } else {
        addToast({
          type: 'error',
          title: 'Print Failed',
          description: res.error || 'Could not open print dialog on this device.',
        });
      }
    } finally {
      setIsPrintingPnl(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Full-Page Assistant Rankings View
  // ─────────────────────────────────────────────────────────────
  if (showAssistantRankingPage && salesAssistantEnabled) {
    const activeList =
      rankMode === 'mauzo'
        ? assistantLeaderboard.mauzoRanked
        : assistantLeaderboard.aboveRefRanked;

    const qRank = rankSearch.trim().toLowerCase();
    const visibleRanked = qRank
      ? activeList.filter(
          a =>
            a.assistantName.toLowerCase().includes(qRank) ||
            a.sellersLabel.toLowerCase().includes(qRank) ||
            a.shopsLabel.toLowerCase().includes(qRank)
        )
      : activeList;

    const topValue =
      rankMode === 'mauzo'
        ? assistantLeaderboard.topMauzo?.totalSales || 0
        : assistantLeaderboard.topAboveRef?.aboveRefTotalGain || 0;

    return (
      <div
        id="assistant-ranking-view"
        className="flex-1 p-4 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto space-y-4 pb-6"
      >
        {/* Full-Page Header */}
        <div className="flex flex-col gap-3 pb-4 border-b border-slate-800">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => setShowAssistantRankingPage(false)}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:bg-slate-700 border border-slate-800 text-slate-300 hover:text-white transition shrink-0"
                aria-label="Back to Reports"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Crown className="w-5 h-5 text-amber-400 shrink-0" />
                  <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
                    Assistant Rankings
                  </h2>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  {selectedShopName} ·{' '}
                  {rankRange.from && rankRange.to
                    ? `${rankRange.from} → ${rankRange.to}`
                    : rankRange.from
                      ? `From ${rankRange.from}`
                      : rankRange.to
                        ? `Up to ${rankRange.to}`
                        : 'All Time'}
                </p>
              </div>
            </div>

            <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-bold font-mono shrink-0">
              {activeList.length} Ranked
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {/* Shop Selector */}
            {!(shopAdmin && !platformAdmin && shops.length <= 1) && (
              <select
                value={effectiveShopFilter}
                onChange={e => setShopFilter(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="ALL">
                  {shopAdmin && !platformAdmin ? 'All Managed Shops' : 'All Shops Combined'}
                </option>
                {shops.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    🏪 {s.name}
                  </option>
                ))}
              </select>
            )}

            {/* Period Filter: Day | Week | Month | Custom */}
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
                {(
                  [
                    { id: 'today', label: 'Day' },
                    { id: 'week', label: 'Week' },
                    { id: 'month', label: 'Month' },
                    { id: 'custom', label: 'Custom' },
                  ] as const
                ).map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setRankPeriod(p.id);
                      if (p.id === 'custom') {
                        setRankCalendarTrigger(c => c + 1);
                      }
                    }}
                    className={`py-2 rounded-lg transition ${
                      rankPeriod === p.id
                        ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {rankPeriod === 'custom' && (
            <CustomDateRangeCalendar
              startDate={rankStart}
              endDate={rankEnd}
              onChangeStartDate={setRankStart}
              onChangeEndDate={setRankEnd}
              openTrigger={rankCalendarTrigger}
              accent="amber"
            />
          )}
        </div>

        {/* Dual Category Leaders Summary */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setRankMode('mauzo')}
            className={`text-left p-3.5 rounded-2xl border transition ${
              rankMode === 'mauzo'
                ? 'bg-gradient-to-br from-amber-500/15 via-slate-900 to-slate-900 border-amber-400/50 shadow-lg shadow-amber-950/20'
                : 'bg-slate-900 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Mauzo Mengi #1
              </span>
              <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            </div>
            {assistantLeaderboard.topMauzo ? (
              <>
                <div className="text-xs sm:text-sm font-extrabold text-white truncate">
                  1. {assistantLeaderboard.topMauzo.assistantName}
                </div>
                <div className="text-[11px] font-mono font-bold text-emerald-400 mt-0.5 truncate">
                  {formatCurrency(
                    assistantLeaderboard.topMauzo.totalSales,
                    settings.currencySymbol
                  )}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {assistantLeaderboard.topMauzo.orders}{' '}
                  {assistantLeaderboard.topMauzo.orders === 1 ? 'sale' : 'sales'}
                </div>
              </>
            ) : (
              <div className="text-[11px] text-slate-500 mt-1">No sales yet</div>
            )}
          </button>

          <button
            type="button"
            onClick={() => setRankMode('above_ref')}
            className={`text-left p-3.5 rounded-2xl border transition ${
              rankMode === 'above_ref'
                ? 'bg-gradient-to-br from-emerald-500/15 via-slate-900 to-slate-900 border-emerald-400/50 shadow-lg shadow-emerald-950/20'
                : 'bg-slate-900 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                Above Ref #1
              </span>
              <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            </div>
            {assistantLeaderboard.topAboveRef ? (
              <>
                <div className="text-xs sm:text-sm font-extrabold text-white truncate">
                  1. {assistantLeaderboard.topAboveRef.assistantName}
                </div>
                <div className="text-[11px] font-mono font-bold text-emerald-400 mt-0.5 truncate">
                  +
                  {formatCurrency(
                    assistantLeaderboard.topAboveRef.aboveRefTotalGain,
                    settings.currencySymbol
                  )}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {assistantLeaderboard.topAboveRef.aboveRefItemsCount}{' '}
                  {assistantLeaderboard.topAboveRef.aboveRefItemsCount === 1 ? 'item' : 'items'}{' '}
                  above ref
                </div>
              </>
            ) : (
              <div className="text-[11px] text-slate-500 mt-1">No above-ref sales</div>
            )}
          </button>
        </div>

        {/* Ranking Mode Tabs: Mauzo Mengi | Above Reference */}
        <div className="grid grid-cols-2 gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setRankMode('mauzo')}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-xs font-bold transition ${
              rankMode === 'mauzo'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Trophy className="w-3.5 h-3.5" />
            <span>Mauzo Mengi</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                rankMode === 'mauzo' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {assistantLeaderboard.mauzoRanked.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setRankMode('above_ref')}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-xs font-bold transition ${
              rankMode === 'above_ref'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Above Reference</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                rankMode === 'above_ref'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {assistantLeaderboard.aboveRefRanked.length}
            </span>
          </button>
        </div>

        {/* Search Assistant */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={rankSearch}
            onChange={e => setRankSearch(e.target.value)}
            placeholder="Search ranked assistant or seller..."
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        {/* Ranked List */}
        {visibleRanked.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl py-12 px-4 text-center space-y-2">
            <Award className="w-9 h-9 text-slate-600 mx-auto" />
            <div className="text-sm font-semibold text-slate-300">
              {rankMode === 'mauzo'
                ? 'No assistant sales recorded in this period'
                : 'No above-reference sales by assistants in this period'}
            </div>
            <p className="text-xs text-slate-500 max-w-xs mx-auto">
              Try switching to Week, Month, or Custom dates to view assistant rankings.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleRanked.map(item => {
              const isFirst = item.rank === 1;
              const isSecond = item.rank === 2;
              const isThird = item.rank === 3;
              const primaryMetric =
                rankMode === 'mauzo' ? item.totalSales : item.aboveRefTotalGain;
              const pctOfLeader =
                topValue > 0
                  ? Math.max(4, Math.min(100, Math.round((primaryMetric / topValue) * 100)))
                  : 100;

              if (isFirst) {
                return (
                  <div
                    key={item.key}
                    className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500/20 via-amber-950/20 to-slate-900 border border-amber-400/60 p-4 shadow-xl shadow-amber-950/30 space-y-3"
                  >
                    <Crown className="w-24 h-24 text-amber-400/10 absolute -right-4 -top-4 rotate-12 pointer-events-none" />

                    <div className="relative flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex flex-col items-center shrink-0">
                          <Crown className="w-5 h-5 text-amber-300 fill-amber-400/40 drop-shadow mb-0.5" />
                          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-600 text-slate-950 font-black text-base font-mono flex items-center justify-center shadow-lg shadow-amber-500/30 ring-2 ring-amber-200/70">
                            #1
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400/20 border border-amber-400/40 text-amber-200 text-[10px] font-bold uppercase tracking-wider mb-1">
                            <span>
                              {rankMode === 'mauzo'
                                ? 'Top Mauzo Mengi Leader'
                                : 'Top Above Reference Leader'}
                            </span>
                          </div>
                          <div className="text-base sm:text-lg font-extrabold text-white leading-tight truncate">
                            1. {item.assistantName}
                          </div>
                          <div className="text-[11px] text-amber-100/75 truncate mt-0.5">
                            Seller: {item.sellersLabel}
                            {item.shopsLabel ? ` · ${item.shopsLabel}` : ''}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-[10px] uppercase tracking-wider text-amber-200/80 font-semibold">
                          {rankMode === 'mauzo' ? 'Total Sales' : 'Above Ref Gain'}
                        </div>
                        <div className="text-base sm:text-lg font-black font-mono tabular-nums text-amber-300">
                          {rankMode === 'mauzo'
                            ? formatCurrency(item.totalSales, settings.currencySymbol)
                            : `+${formatCurrency(item.aboveRefTotalGain, settings.currencySymbol)}`}
                        </div>
                      </div>
                    </div>

                    {rankMode === 'mauzo' ? (
                      <div className="relative grid grid-cols-3 gap-2 pt-2 border-t border-amber-400/20">
                        <div className="bg-slate-950/60 rounded-xl px-2.5 py-2 border border-amber-500/20">
                          <div className="text-[10px] text-slate-400">Orders</div>
                          <div className="text-xs font-bold font-mono text-white mt-0.5">
                            {item.orders.toLocaleString()}
                          </div>
                        </div>
                        <div className="bg-slate-950/60 rounded-xl px-2.5 py-2 border border-amber-500/20">
                          <div className="text-[10px] text-slate-400">Units Sold</div>
                          <div className="text-xs font-bold font-mono text-blue-300 mt-0.5">
                            {Number(item.itemsSold.toFixed(2)).toLocaleString()}
                          </div>
                        </div>
                        <div className="bg-slate-950/60 rounded-xl px-2.5 py-2 border border-amber-500/20">
                          <div className="text-[10px] text-slate-400">Profit</div>
                          <div className="text-xs font-bold font-mono text-emerald-400 mt-0.5 truncate">
                            +{formatCurrency(item.totalProfit, settings.currencySymbol)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="relative grid grid-cols-3 gap-2 pt-2 border-t border-amber-400/20">
                        <div className="bg-slate-950/60 rounded-xl px-2.5 py-2 border border-amber-500/20">
                          <div className="text-[10px] text-slate-400">Above-Ref Items</div>
                          <div className="text-xs font-bold font-mono text-white mt-0.5">
                            {item.aboveRefItemsCount} ({item.aboveRefOrders}{' '}
                            {item.aboveRefOrders === 1 ? 'sale' : 'sales'})
                          </div>
                        </div>
                        <div className="bg-slate-950/60 rounded-xl px-2.5 py-2 border border-amber-500/20">
                          <div className="text-[10px] text-slate-400">Units</div>
                          <div className="text-xs font-bold font-mono text-blue-300 mt-0.5">
                            {Number(item.aboveRefUnits.toFixed(2)).toLocaleString()}
                          </div>
                        </div>
                        <div className="bg-slate-950/60 rounded-xl px-2.5 py-2 border border-amber-500/20">
                          <div className="text-[10px] text-slate-400">Avg +/Unit</div>
                          <div className="text-xs font-bold font-mono text-emerald-400 mt-0.5 truncate">
                            +{formatCurrency(item.avgGainPerUnit, settings.currencySymbol)}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="relative flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-slate-950/80 overflow-hidden">
                        <div className="h-full w-full rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500" />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-amber-300 shrink-0">
                        100%
                      </span>
                    </div>
                  </div>
                );
              }

              const badgeStyle = isSecond
                ? 'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-950 ring-1 ring-slate-200/60'
                : isThird
                  ? 'bg-gradient-to-br from-amber-600 to-orange-800 text-amber-50 ring-1 ring-amber-500/50'
                  : 'bg-slate-800 text-slate-300 border border-slate-700';

              const cardBorder = isSecond
                ? 'border-slate-500/40'
                : isThird
                  ? 'border-amber-700/40'
                  : 'border-slate-800';

              return (
                <div
                  key={item.key}
                  className={`rounded-2xl bg-slate-900 border ${cardBorder} p-3.5 space-y-2.5 shadow-sm`}
                >
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl font-extrabold text-xs font-mono flex items-center justify-center shrink-0 ${badgeStyle}`}
                      >
                        #{item.rank}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">
                          {item.rank}. {item.assistantName}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          Seller: {item.sellersLabel}
                          {item.shopsLabel ? ` · ${item.shopsLabel}` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div
                        className={`text-sm font-extrabold font-mono tabular-nums ${
                          rankMode === 'mauzo' ? 'text-blue-400' : 'text-emerald-400'
                        }`}
                      >
                        {rankMode === 'mauzo'
                          ? formatCurrency(item.totalSales, settings.currencySymbol)
                          : `+${formatCurrency(item.aboveRefTotalGain, settings.currencySymbol)}`}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {rankMode === 'mauzo'
                          ? `+${formatCurrency(item.totalProfit, settings.currencySymbol)} profit`
                          : `${item.aboveRefItemsCount} ${item.aboveRefItemsCount === 1 ? 'item' : 'items'} above ref`}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    {rankMode === 'mauzo' ? (
                      <span>
                        {item.orders} {item.orders === 1 ? 'order' : 'orders'} ·{' '}
                        {Number(item.itemsSold.toFixed(2)).toLocaleString()} units · Avg{' '}
                        {formatCurrency(item.avgOrder, settings.currencySymbol)}
                      </span>
                    ) : (
                      <span>
                        {item.aboveRefOrders} {item.aboveRefOrders === 1 ? 'sale' : 'sales'} ·{' '}
                        {Number(item.aboveRefUnits.toFixed(2)).toLocaleString()} units · Avg +
                        {formatCurrency(item.avgGainPerUnit, settings.currencySymbol)}/unit
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-slate-500 shrink-0 ml-2">
                      {pctOfLeader}% of #1
                    </span>
                  </div>

                  <div className="h-1.5 rounded-full bg-slate-950 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        rankMode === 'mauzo'
                          ? 'bg-gradient-to-r from-blue-500 to-cyan-400'
                          : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                      }`}
                      style={{ width: `${pctOfLeader}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Main Financial Reports View
  // ─────────────────────────────────────────────────────────────
  return (
    <div
      id="admin-reports-view"
      className="flex-1 p-4 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto space-y-5 pb-6"
    >
      {/* Global Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Financial Reports</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Audit store performance, margins, and price deviations
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {shopAdmin && !platformAdmin && shops.length <= 1 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 flex items-center gap-2">
              <span className="truncate font-medium">🏪 {shops[0]?.name || 'No Managed Shop'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold shrink-0">
                Shop Admin Report
              </span>
            </div>
          ) : (
            <select
              value={effectiveShopFilter}
              onChange={e => setShopFilter(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white min-w-[200px]"
            >
              <option value="ALL">
                🏪 {shopAdmin && !platformAdmin ? 'All Managed Shops' : 'All Shops'}
              </option>
              {shops.map((s: any) => (
                <option key={s.id} value={s.id}>
                  🏪 {s.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition active:scale-95"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={handlePrintReport}
            disabled={isPrinting}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/35 text-xs font-semibold shadow transition disabled:opacity-50 active:scale-95"
          >
            {isPrinting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Printer className="w-3.5 h-3.5" />
            )}
            <span>{isPrinting ? 'Printing...' : 'Print'}</span>
          </button>

          <button
            onClick={handleDownloadReportPdf}
            disabled={isDownloadingPdf}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow transition disabled:opacity-50 active:scale-95"
          >
            {isDownloadingPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{isDownloadingPdf ? 'Generating...' : 'Download PDF'}</span>
          </button>
        </div>
      </div>

      {/* ── INCOME STATEMENT ────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <ReportSectionHeader
          title="Income Statement"
          subtitle="Revenue, COGS, expenses, net profit"
          icon={<FileText className="w-4 h-4 text-blue-400" />}
          period={incomePeriod}
          onPeriodChange={setIncomePeriod}
          customStart={incomeStart}
          customEnd={incomeEnd}
          onCustomStartChange={setIncomeStart}
          onCustomEndChange={setIncomeEnd}
          collapsed={incomeCollapsed}
          onToggleCollapsed={() => setIncomeCollapsed(v => !v)}
          accent="blue"
        />
        {!incomeCollapsed && (
          <div className="p-4 space-y-2.5 text-xs">
            <div className="flex justify-between py-2 border-b border-slate-800/80">
              <span className="text-slate-300 font-medium">Gross Revenue</span>
              <span className="font-mono font-bold text-white">
                {formatCurrency((incomeSummary as any).totalGrossSales || 0, settings.currencySymbol)}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-800/80 text-slate-400">
              <span>Less: COGS</span>
              <span className="font-mono text-rose-400">
                -{formatCurrency((incomeSummary as any).totalCostOfGoods || 0, settings.currencySymbol)}
              </span>
            </div>
            <div className="flex justify-between py-2.5 bg-slate-950/80 px-3 rounded-lg border border-slate-800">
              <div>
                <span className="font-bold text-white">Gross Profit</span>
                <span className="text-[10px] text-emerald-400 block font-mono">
                  {(incomeSummary as any).profitMarginPercent || 0}% Margin
                </span>
              </div>
              <span className="font-mono font-bold text-emerald-400 text-sm">
                {formatCurrency((incomeSummary as any).totalGrossProfit || 0, settings.currencySymbol)}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-800/80 text-slate-400">
              <span>Less: Expenses</span>
              <span className="font-mono text-rose-400">
                -{formatCurrency((incomeSummary as any).totalExpenses || 0, settings.currencySymbol)}
              </span>
            </div>
            <div
              className={`flex justify-between py-2.5 px-3 rounded-lg border ${
                ((incomeSummary as any).netProfit || 0) >= 0
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-rose-500/10 border-rose-500/30'
              }`}
            >
              <div>
                <span className="font-bold text-white">NET PROFIT</span>
                <span className="text-[10px] text-slate-300 block font-mono">
                  {(incomeSummary as any).netMarginPercent || 0}% Net Return
                </span>
              </div>
              <span
                className={`font-mono font-extrabold text-sm ${
                  ((incomeSummary as any).netProfit || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatCurrency((incomeSummary as any).netProfit || 0, settings.currencySymbol)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── SHOP PROFIT & LOSS (CAPITAL, PROFIT & LOSS PER SHOP) ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="border-b border-slate-800 bg-gradient-to-r from-emerald-950/25 via-slate-900 to-slate-900 p-3.5 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2.5">
            <button
              type="button"
              onClick={() => setPnlCollapsed(v => !v)}
              className="flex items-start gap-2.5 flex-1 min-w-0 text-left active:opacity-80"
            >
              <span className="text-slate-500 mt-0.5 shrink-0">
                {pnlCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </span>
              <span className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0">
                <Scale className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm sm:text-base font-bold text-white leading-tight">
                    Shop Profit &amp; Loss
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-mono">
                    {shopProfitLoss.shops.length} Shop{shopProfitLoss.shops.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="block text-[11px] text-slate-400 mt-0.5 leading-tight">
                  All shops with product total capital, revenue, gross profit, expenses &amp; losses
                </span>
              </span>
            </button>

            <div className="flex items-center flex-wrap gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleExportShopProfitLossCSV}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handlePrintShopProfitLoss}
                disabled={isPrintingPnl}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/35 text-[11px] font-semibold shadow transition disabled:opacity-50"
              >
                {isPrintingPnl ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Printer className="w-3.5 h-3.5" />
                )}
                <span>Print P&amp;L</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadShopProfitLossPdf}
                disabled={isDownloadingPnl}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold shadow transition disabled:opacity-50"
              >
                {isDownloadingPnl ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>Download P&amp;L PDF</span>
              </button>
            </div>
          </div>

          {!pnlCollapsed && (
            <div className="space-y-2.5">
              {/* Colored Day / Week / Month / Custom Period Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Period:</span>
                  <span className="font-mono text-slate-200">
                    {pnlRange.from && pnlRange.to
                      ? pnlRange.from === pnlRange.to
                        ? pnlRange.from
                        : `${pnlRange.from} → ${pnlRange.to}`
                      : pnlRange.from
                        ? `From ${pnlRange.from}`
                        : pnlRange.to
                          ? `Up to ${pnlRange.to}`
                          : 'All Dates'}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1.5 w-full sm:w-auto sm:min-w-[300px]">
                  {(
                    [
                      {
                        id: 'day',
                        label: 'Day',
                        activeClass: 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/30',
                        idleClass: 'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20',
                      },
                      {
                        id: 'week',
                        label: 'Week',
                        activeClass: 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-500/30',
                        idleClass: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20',
                      },
                      {
                        id: 'month',
                        label: 'Month',
                        activeClass: 'bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-500/30',
                        idleClass: 'bg-violet-500/10 border-violet-500/30 text-violet-300 hover:bg-violet-500/20',
                      },
                      {
                        id: 'custom',
                        label: 'Custom',
                        activeClass: 'bg-amber-500 border-amber-400 text-white shadow-md shadow-amber-500/30',
                        idleClass: 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20',
                      },
                    ] as const
                  ).map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPnlPeriod(p.id);
                        if (p.id === 'custom') {
                          setPnlCalendarTrigger(c => c + 1);
                        }
                      }}
                      className={`py-1.5 px-2.5 rounded-lg border text-[11px] font-semibold transition active:scale-95 ${
                        pnlPeriod === p.id ? p.activeClass : p.idleClass
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {pnlPeriod === 'custom' && (
                <CustomDateRangeCalendar
                  startDate={pnlStart}
                  endDate={pnlEnd}
                  onChangeStartDate={setPnlStart}
                  onChangeEndDate={setPnlEnd}
                  openTrigger={pnlCalendarTrigger}
                  accent="amber"
                />
              )}
            </div>
          )}
        </div>

        {!pnlCollapsed && (
          <div className="p-3.5 sm:p-4 space-y-4">
            {/* Consolidated All-Shops P&L Summary KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-xl bg-slate-950/80 border border-purple-500/30">
                <div className="flex items-center justify-between text-[10px] font-semibold text-purple-300 uppercase tracking-wider">
                  <span>Product Total Capital</span>
                  <Coins className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <div className="text-sm sm:text-base font-bold text-white font-mono tabular-nums mt-1 truncate">
                  {formatCurrency(shopProfitLoss.totals.totalCapital, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                  {shopProfitLoss.totals.skuCount.toLocaleString()} SKUs ·{' '}
                  {shopProfitLoss.totals.totalUnits.toLocaleString()} units
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-blue-500/30">
                <div className="flex items-center justify-between text-[10px] font-semibold text-blue-300 uppercase tracking-wider">
                  <span>Sales Revenue</span>
                  <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                </div>
                <div className="text-sm sm:text-base font-bold text-white font-mono tabular-nums mt-1 truncate">
                  {formatCurrency(shopProfitLoss.totals.revenue, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                  {shopProfitLoss.totals.salesCount} orders · COGS{' '}
                  {formatCurrency(shopProfitLoss.totals.costOfGoods, settings.currencySymbol)}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-rose-500/30">
                <div className="flex items-center justify-between text-[10px] font-semibold text-rose-300 uppercase tracking-wider">
                  <span>Expenses &amp; Losses</span>
                  <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                </div>
                <div className="text-sm sm:text-base font-bold text-rose-300 font-mono tabular-nums mt-1 truncate">
                  -{formatCurrency(shopProfitLoss.totals.totalLossAndExpenses, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono truncate">
                  Exp {formatCurrency(shopProfitLoss.totals.expenses, settings.currencySymbol)} · Stock Loss{' '}
                  {formatCurrency(shopProfitLoss.totals.stockLossValue, settings.currencySymbol)}
                </div>
              </div>

              <div
                className={`p-3 rounded-xl border ${
                  shopProfitLoss.totals.netProfit >= 0
                    ? 'bg-emerald-950/25 border-emerald-500/40'
                    : 'bg-rose-950/25 border-rose-500/40'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                  <span>Net Profit / (Loss)</span>
                  <Scale
                    className={`w-3.5 h-3.5 ${
                      shopProfitLoss.totals.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  />
                </div>
                <div
                  className={`text-sm sm:text-base font-extrabold font-mono tabular-nums mt-1 truncate ${
                    shopProfitLoss.totals.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {shopProfitLoss.totals.netProfit >= 0 ? '+' : ''}
                  {formatCurrency(shopProfitLoss.totals.netProfit, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-300 mt-0.5 font-mono">
                  Gross: {formatCurrency(shopProfitLoss.totals.grossProfit, settings.currencySymbol)} (
                  {shopProfitLoss.totals.netMarginPercent}% net)
                </div>
              </div>
            </div>

            {/* Filter & Sort Controls */}
            {shopProfitLoss.shops.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  {[
                    { id: 'ALL', label: `All Shops (${shopProfitLoss.shops.length})` },
                    {
                      id: 'PROFIT',
                      label: `Profit (${shopProfitLoss.shops.filter(s => s.netProfit >= 0).length})`,
                    },
                    {
                      id: 'LOSS',
                      label: `Loss (${
                        shopProfitLoss.shops.filter(
                          s => s.netProfit < 0 || s.stockLossValue > 0 || s.belowCostSalesLoss > 0
                        ).length
                      })`,
                    },
                  ].map(pill => (
                    <button
                      key={pill.id}
                      type="button"
                      onClick={() => setPnlOutcomeFilter(pill.id as 'ALL' | 'PROFIT' | 'LOSS')}
                      className={`px-2.5 py-1 rounded-md font-semibold transition ${
                        pnlOutcomeFilter === pill.id
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>

                <select
                  value={pnlSort}
                  onChange={e => setPnlSort(e.target.value as any)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="NET_DESC">Sort: Highest Net Profit</option>
                  <option value="CAPITAL_DESC">Sort: Highest Product Capital</option>
                  <option value="LOSS_DESC">Sort: Highest Expenses &amp; Losses</option>
                  <option value="NAME_ASC">Sort: Shop Name (A–Z)</option>
                </select>
              </div>
            )}

            {visiblePnlShops.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 bg-slate-950/50 rounded-xl border border-slate-800">
                No shops match this Profit &amp; Loss filter.
              </div>
            ) : (
              <>
                {/* Desktop Financial P&L Statement Table */}
                <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-950 text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                        <th className="py-3 px-3.5 text-left font-semibold">Shop</th>
                        <th className="py-3 px-3 text-right font-semibold">Product Total Capital</th>
                        <th className="py-3 px-3 text-right font-semibold">Revenue &amp; COGS</th>
                        <th className="py-3 px-3 text-right font-semibold">Gross Profit</th>
                        <th className="py-3 px-3 text-right font-semibold">Expenses &amp; Losses</th>
                        <th className="py-3 px-3.5 text-right font-semibold">Net Profit / (Loss)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {visiblePnlShops.map(row => {
                        const isProfit = row.netProfit >= 0;
                        const isHighlighted = effectiveShopFilter === row.shopId;
                        return (
                          <tr
                            key={row.shopId}
                            className={`transition ${
                              isHighlighted ? 'bg-blue-950/20' : 'hover:bg-slate-900/60'
                            }`}
                          >
                            <td className="py-3 px-3.5 align-top">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-white">🏪 {row.shopName}</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                    row.netProfit > 0
                                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                      : row.netProfit < 0
                                        ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                                        : 'bg-slate-800 border-slate-700 text-slate-400'
                                  }`}
                                >
                                  {row.netProfit > 0 ? 'Profit' : row.netProfit < 0 ? 'Loss' : 'Even'}
                                </span>
                                {isHighlighted && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[9px] font-semibold">
                                    Selected
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1 font-mono">
                                {row.skuCount} SKUs · {row.totalUnits.toLocaleString()} units (Floor{' '}
                                {row.floorUnits.toLocaleString()} / Store {row.storeUnits.toLocaleString()})
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right align-top font-mono tabular-nums">
                              <div className="font-bold text-purple-300">
                                {formatCurrency(row.totalCapital, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-500 mt-0.5">
                                Floor {formatCurrency(row.floorCapital, settings.currencySymbol)} · Store{' '}
                                {formatCurrency(row.storeCapital, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Retail: {formatCurrency(row.expectedRetailValue, settings.currencySymbol)}
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right align-top font-mono tabular-nums">
                              <div className="font-semibold text-white">
                                {formatCurrency(row.revenue, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {row.salesCount} sale{row.salesCount === 1 ? '' : 's'}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                COGS: -{formatCurrency(row.costOfGoods, settings.currencySymbol)}
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right align-top font-mono tabular-nums">
                              <div
                                className={`font-bold ${
                                  row.grossProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {row.grossProfit >= 0 ? '+' : ''}
                                {formatCurrency(row.grossProfit, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {row.grossMarginPercent}% margin
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right align-top font-mono tabular-nums">
                              <div className="font-semibold text-rose-300">
                                -{formatCurrency(row.totalLossAndExpenses, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                Exp: {formatCurrency(row.expenses, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Stock Loss: {formatCurrency(row.stockLossValue, settings.currencySymbol)}
                                {row.stockLossUnits > 0 ? ` (${row.stockLossUnits}u)` : ''}
                              </div>
                              {row.belowCostSalesLoss > 0 && (
                                <div className="text-[10px] text-amber-400 mt-0.5">
                                  Below-cost: {formatCurrency(row.belowCostSalesLoss, settings.currencySymbol)}
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-3.5 text-right align-top font-mono tabular-nums">
                              <div
                                className={`text-sm font-extrabold ${
                                  isProfit ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {isProfit ? '+' : ''}
                                {formatCurrency(row.netProfit, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {row.netMarginPercent}% net margin
                              </div>
                              <div className="text-[10px] text-slate-500">
                                {row.capitalReturnPercent >= 0 ? '+' : ''}
                                {row.capitalReturnPercent}% ROI on cap
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-900/90 border-t-2 border-slate-700 font-mono tabular-nums text-xs">
                        <td className="py-3 px-3.5 font-bold text-white font-sans">
                          CONSOLIDATED TOTAL ({visiblePnlShops.length} shop{visiblePnlShops.length === 1 ? '' : 's'})
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-purple-300">
                          {formatCurrency(
                            visiblePnlShops.reduce((s, r) => s + r.totalCapital, 0),
                            settings.currencySymbol
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-white">
                          {formatCurrency(
                            visiblePnlShops.reduce((s, r) => s + r.revenue, 0),
                            settings.currencySymbol
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-emerald-400">
                          {formatCurrency(
                            visiblePnlShops.reduce((s, r) => s + r.grossProfit, 0),
                            settings.currencySymbol
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-rose-300">
                          -
                          {formatCurrency(
                            visiblePnlShops.reduce((s, r) => s + r.totalLossAndExpenses, 0),
                            settings.currencySymbol
                          )}
                        </td>
                        <td
                          className={`py-3 px-3.5 text-right font-extrabold ${
                            visiblePnlShops.reduce((s, r) => s + r.netProfit, 0) >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {visiblePnlShops.reduce((s, r) => s + r.netProfit, 0) >= 0 ? '+' : ''}
                          {formatCurrency(
                            visiblePnlShops.reduce((s, r) => s + r.netProfit, 0),
                            settings.currencySymbol
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Compact Cards for narrow viewports */}
                <div className="md:hidden space-y-2.5">
                  {visiblePnlShops.map(row => {
                    const isProfit = row.netProfit >= 0;
                    return (
                      <div
                        key={row.shopId}
                        className={`rounded-xl border p-3.5 space-y-3 text-xs ${
                          isProfit
                            ? 'bg-slate-950/70 border-slate-800'
                            : 'bg-rose-950/15 border-rose-800/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-800/80">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h4 className="font-bold text-white text-sm truncate">
                                🏪 {row.shopName}
                              </h4>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                  row.netProfit > 0
                                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                    : row.netProfit < 0
                                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                                      : 'bg-slate-800 border-slate-700 text-slate-400'
                                }`}
                              >
                                {row.netProfit > 0 ? 'Profit' : row.netProfit < 0 ? 'Loss' : 'Even'}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                              {row.skuCount} SKUs · {row.totalUnits.toLocaleString()} units
                            </p>
                          </div>

                          <div className="text-right shrink-0 font-mono tabular-nums">
                            <div className="text-[10px] text-slate-400">Net P&amp;L</div>
                            <div
                              className={`text-sm font-extrabold ${
                                isProfit ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {isProfit ? '+' : ''}
                              {formatCurrency(row.netProfit, settings.currencySymbol)}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2">
                            <span className="text-[10px] text-slate-400 font-sans block">
                              Product Capital
                            </span>
                            <span className="font-bold text-purple-300 text-xs">
                              {formatCurrency(row.totalCapital, settings.currencySymbol)}
                            </span>
                            <span className="text-[9px] text-slate-500 block mt-0.5">
                              Floor {formatCurrency(row.floorCapital, settings.currencySymbol)} · Store{' '}
                              {formatCurrency(row.storeCapital, settings.currencySymbol)}
                            </span>
                          </div>

                          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2">
                            <span className="text-[10px] text-slate-400 font-sans block">
                              Revenue ({row.salesCount} sales)
                            </span>
                            <span className="font-bold text-white text-xs">
                              {formatCurrency(row.revenue, settings.currencySymbol)}
                            </span>
                            <span className="text-[9px] text-slate-500 block mt-0.5">
                              COGS: {formatCurrency(row.costOfGoods, settings.currencySymbol)}
                            </span>
                          </div>

                          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2">
                            <span className="text-[10px] text-slate-400 font-sans block">
                              Gross Profit
                            </span>
                            <span
                              className={`font-bold text-xs ${
                                row.grossProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {row.grossProfit >= 0 ? '+' : ''}
                              {formatCurrency(row.grossProfit, settings.currencySymbol)}
                            </span>
                            <span className="text-[9px] text-slate-500 block mt-0.5">
                              Margin: {row.grossMarginPercent}%
                            </span>
                          </div>

                          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2">
                            <span className="text-[10px] text-slate-400 font-sans block">
                              Expenses &amp; Losses
                            </span>
                            <span className="font-bold text-rose-300 text-xs">
                              -{formatCurrency(row.totalLossAndExpenses, settings.currencySymbol)}
                            </span>
                            <span className="text-[9px] text-slate-500 block mt-0.5">
                              Exp {formatCurrency(row.expenses, settings.currencySymbol)} · Loss{' '}
                              {formatCurrency(row.stockLossValue, settings.currencySymbol)}
                            </span>
                          </div>
                        </div>

                        {row.belowCostSalesLoss > 0 && (
                          <div className="px-2.5 py-1.5 rounded-lg bg-amber-950/30 border border-amber-500/30 text-[10px] text-amber-300 font-mono">
                            Below-cost sales loss: -
                            {formatCurrency(row.belowCostSalesLoss, settings.currencySymbol)} (included in Gross Profit)
                          </div>
                        )}

                        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 font-mono">
                          <span>Net Margin: {row.netMarginPercent}%</span>
                          <span>
                            Capital ROI: {row.capitalReturnPercent >= 0 ? '+' : ''}
                            {row.capitalReturnPercent}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {shopProfitLoss.generalCompanyExpenses > 0 && (
              <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="text-amber-200">
                  <strong className="font-semibold">Unallocated General Company Expenses:</strong>{' '}
                  <span className="font-mono text-rose-300">
                    -{formatCurrency(shopProfitLoss.generalCompanyExpenses, settings.currencySymbol)}
                  </span>
                </div>
                <div className="font-mono text-xs">
                  <span className="text-slate-400 mr-1.5">Company Net:</span>
                  <strong
                    className={
                      shopProfitLoss.totals.netAfterCompanyExpenses >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }
                  >
                    {shopProfitLoss.totals.netAfterCompanyExpenses >= 0 ? '+' : ''}
                    {formatCurrency(
                      shopProfitLoss.totals.netAfterCompanyExpenses,
                      settings.currencySymbol
                    )}
                  </strong>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── PRICE DEVIATION AUDIT ──────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <ReportSectionHeader
          title="Price Deviation Audit"
          subtitle="Sales charged above, below, or at a loss"
          icon={<TrendingDown className="w-4 h-4 text-rose-400" />}
          period={deviationPeriod}
          onPeriodChange={setDeviationPeriod}
          customStart={deviationStart}
          customEnd={deviationEnd}
          onCustomStartChange={setDeviationStart}
          onCustomEndChange={setDeviationEnd}
          collapsed={deviationCollapsed}
          onToggleCollapsed={() => setDeviationCollapsed(v => !v)}
          accent="rose"
          actions={
            allDeviations.length > 0 ? (
              <div className="flex items-center flex-wrap gap-1.5">
                <button
                  onClick={handleExportDeviationsCSV}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px] font-semibold transition"
                >
                  <Download className="w-3 h-3" />
                  <span>Export</span>
                </button>
                <button
                  onClick={handlePrintDeviations}
                  disabled={isPrintingDeviations}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/35 text-[10px] font-semibold shadow transition disabled:opacity-50"
                >
                  {isPrintingDeviations ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Printer className="w-3 h-3" />
                  )}
                  <span>Print</span>
                </button>
                <button
                  onClick={handleDownloadDeviationsPdf}
                  disabled={isDownloadingDeviations}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold shadow transition disabled:opacity-50"
                >
                  {isDownloadingDeviations ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Download className="w-3 h-3" />
                  )}
                  <span>PDF</span>
                </button>
              </div>
            ) : null
          }
        />
        {!deviationCollapsed && (
          <>
            {allDeviations.length === 0 ? (
              <div className="p-5 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium">
                  <TrendingUp className="w-4 h-4" />
                  <span>All sales match the reference price</span>
                </div>
              </div>
            ) : (
              <div className="p-3.5 sm:p-4 space-y-3.5">
                {/* 3 summary cards */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-800/40">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-rose-300 uppercase tracking-wider">
                        Below Reference
                      </span>
                      <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                    </div>
                    <div className="text-lg font-bold text-rose-300 font-mono">
                      {deviationStats.belowCount}
                    </div>
                    <div className="text-[10px] text-rose-400/80 mt-0.5">
                      {deviationStats.belowSalesCount} sale
                      {deviationStats.belowSalesCount === 1 ? '' : 's'} · value{' '}
                      {formatCurrency(deviationStats.belowImpact, settings.currencySymbol)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-orange-950/30 border border-orange-800/40">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-orange-300 uppercase tracking-wider">
                        Below Cost (Loss)
                      </span>
                      <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
                    </div>
                    <div className="text-lg font-bold text-orange-300 font-mono">
                      {deviationStats.belowCostCount}
                    </div>
                    <div className="text-[10px] text-orange-400/80 mt-0.5">
                      Real loss: {formatCurrency(deviationStats.costLoss, settings.currencySymbol)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">
                        Above Reference
                      </span>
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="text-lg font-bold text-emerald-300 font-mono">
                      {deviationStats.aboveCount}
                    </div>
                    <div className="text-[10px] text-emerald-400/80 mt-0.5">
                      {deviationStats.aboveSalesCount} sale
                      {deviationStats.aboveSalesCount === 1 ? '' : 's'} · value{' '}
                      {formatCurrency(deviationStats.aboveImpact, settings.currencySymbol)}
                    </div>
                  </div>
                </div>

                {/* Net impact */}
                <div
                  className={`p-3 rounded-xl border flex items-center justify-between ${
                    deviationStats.netImpact >= 0
                      ? 'bg-emerald-950/20 border-emerald-800/40'
                      : 'bg-rose-950/20 border-rose-800/40'
                  }`}
                >
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Net Impact
                  </span>
                  <span
                    className={`text-base font-bold font-mono ${
                      deviationStats.netImpact >= 0 ? 'text-emerald-300' : 'text-rose-300'
                    }`}
                  >
                    {deviationStats.netImpact > 0 ? '+' : ''}
                    {formatCurrency(deviationStats.netImpact, settings.currencySymbol)}
                  </span>
                </div>

                {/* Direction filter pills */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px] font-semibold">
                  <button
                    onClick={() => setDeviationDirection('ALL')}
                    className={`px-2 py-1.5 rounded-md transition ${
                      deviationDirection === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400'
                    }`}
                  >
                    All ({allDeviations.length})
                  </button>
                  <button
                    onClick={() => setDeviationDirection('BELOW')}
                    className={`px-2 py-1.5 rounded-md transition ${
                      deviationDirection === 'BELOW' ? 'bg-rose-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    Below ({deviationStats.belowCount})
                  </button>
                  <button
                    onClick={() => setDeviationDirection('BELOW_COST')}
                    className={`px-2 py-1.5 rounded-md transition ${
                      deviationDirection === 'BELOW_COST'
                        ? 'bg-orange-600 text-white'
                        : 'text-slate-400'
                    }`}
                  >
                    Loss ({deviationStats.belowCostCount})
                  </button>
                  <button
                    onClick={() => setDeviationDirection('ABOVE')}
                    className={`px-2 py-1.5 rounded-md transition ${
                      deviationDirection === 'ABOVE'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400'
                    }`}
                  >
                    Above ({deviationStats.aboveCount})
                  </button>
                </div>

                <div className="text-[10px] text-slate-500 font-mono text-center">
                  Showing {visibleDeviations.length} of {deviations.length}
                  {hiddenDeviationCount > 0 && ` · export CSV to see all`}
                </div>

                {/* Deviation cards — NO cost column */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                  {visibleDeviations.map((d, idx) => {
                    const isBelow = d.direction === 'BELOW';
                    const cardBg = d.belowCost
                      ? 'bg-orange-950/10 border-orange-800/40'
                      : isBelow
                        ? 'bg-rose-950/10 border-rose-800/40'
                        : 'bg-emerald-950/10 border-emerald-800/40';
                    const accentText = d.belowCost
                      ? 'text-orange-300'
                      : isBelow
                        ? 'text-rose-300'
                        : 'text-emerald-300';

                    return (
                      <div
                        key={`${d.saleId}-${d.productId}-${idx}`}
                        className={`rounded-xl p-3 border space-y-2.5 ${cardBg}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-bold text-white truncate">
                                {d.productName}
                              </span>
                              {d.belowCost && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/30 text-orange-200 border border-orange-500/50 font-bold">
                                  LOSS
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">{d.sku}</div>
                          </div>
                          <div className={`shrink-0 text-right ${accentText}`}>
                            <div className="font-mono font-bold text-sm">
                              {d.referencePrice > 0
                                ? `${d.totalImpact > 0 ? '+' : ''}${formatCurrency(d.totalImpact, settings.currencySymbol)}`
                                : `-${formatCurrency(d.costLoss, settings.currencySymbol)}`}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div>
                            <div className="text-slate-500 text-[9px] uppercase tracking-wider mb-0.5">
                              Selling Price
                            </div>
                            <div className="font-mono font-semibold text-slate-200">
                              {d.referencePrice > 0
                                ? `${formatCurrency(d.referencePrice, settings.currencySymbol)}${!d.usedSnapshot ? '*' : ''}`
                                : '—'}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-[9px] uppercase tracking-wider mb-0.5">
                              Sold At
                            </div>
                            <div className={`font-mono font-bold ${accentText}`}>
                              {formatCurrency(d.soldPrice, settings.currencySymbol)}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-[9px] uppercase tracking-wider mb-0.5">
                              Qty
                            </div>
                            <div className="font-mono font-semibold text-slate-200">{d.quantity}</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/60 text-[10px]">
                          <span className="font-mono text-slate-400 truncate">{d.receiptNumber}</span>
                          <span
                            className="font-bold text-slate-100 truncate max-w-[165px]"
                            title={d.sellerDisplayName}
                          >
                            {d.sellerDisplayName}
                          </span>
                          <span className="font-mono text-slate-400 shrink-0">
                            {formatDateTime(d.createdAt).slice(5, 16)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="text-[9px] text-slate-500 text-center italic">
                  * = Selling Price estimated from current product (legacy sale)
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── SHOP PERFORMANCE ─────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <ReportSectionHeader
          title="Shop Performance"
          subtitle="Revenue and profit by shop unit"
          icon={<Store className="w-4 h-4 text-blue-400" />}
          period={shopPeriod}
          onPeriodChange={setShopPeriod}
          customStart={shopStart}
          customEnd={shopEnd}
          onCustomStartChange={setShopStart}
          onCustomEndChange={setShopEnd}
          collapsed={shopsCollapsed}
          onToggleCollapsed={() => setShopsCollapsed(v => !v)}
          accent="blue"
        />
        {!shopsCollapsed && (
          <div className="p-3.5 sm:p-4">
            {((shopSummary as any).shopSalesBreakdown || []).length === 0 ? (
              <div className="py-6 text-center text-slate-500 text-xs">
                No shop data in this period.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {((shopSummary as any).shopSalesBreakdown || []).map((shop: any) => (
                  <div key={shop.id} className="py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white font-semibold text-xs truncate">🏪 {shop.name}</span>
                      <span className="font-mono font-bold text-emerald-400 text-xs shrink-0">
                        +{formatCurrency(shop.grossProfit, settings.currencySymbol)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>
                        {shop.salesCount} {shop.salesCount === 1 ? 'sale' : 'sales'}
                      </span>
                      <span className="font-mono">
                        {formatCurrency(shop.totalSales, settings.currencySymbol)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── PRODUCT PROFITABILITY & SELLER PERFORMANCE GRID ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* PRODUCT PROFITABILITY */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <ReportSectionHeader
            title="Product Profitability"
            subtitle="Revenue and profit per product"
            icon={<Package className="w-4 h-4 text-purple-400" />}
            period={productPeriod}
            onPeriodChange={setProductPeriod}
            customStart={productStart}
            customEnd={productEnd}
            onCustomStartChange={setProductStart}
            onCustomEndChange={setProductEnd}
            collapsed={productsCollapsed}
            onToggleCollapsed={() => setProductsCollapsed(v => !v)}
            accent="purple"
          />
          {!productsCollapsed && (
            <div className="p-3.5 sm:p-4 space-y-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  placeholder="Filter products..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white"
                />
              </div>

              {filteredProducts.length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-xs">No products match</div>
              ) : (
                <div className="divide-y divide-slate-800/60 max-h-[380px] overflow-y-auto pr-1">
                  {filteredProducts.map((p: any, idx: number) => (
                    <div key={`${p.id || p.sku}-${idx}`} className="py-2.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-white font-medium text-xs truncate">{p.name}</span>
                        <span className="font-mono font-bold text-emerald-400 text-xs shrink-0">
                          +{formatCurrency(p.profit, settings.currencySymbol)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span className="font-mono truncate">{p.sku}</span>
                        <span className="font-mono">
                          {p.unitsSold} × {formatCurrency(p.revenue, settings.currencySymbol)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* SELLER PERFORMANCE */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <ReportSectionHeader
            title="Seller Performance"
            subtitle="Revenue and profit per seller"
            icon={<Users className="w-4 h-4 text-purple-400" />}
            period={sellerPeriod}
            onPeriodChange={setSellerPeriod}
            customStart={sellerStart}
            customEnd={sellerEnd}
            onCustomStartChange={setSellerStart}
            onCustomEndChange={setSellerEnd}
            collapsed={sellersCollapsed}
            onToggleCollapsed={() => setSellersCollapsed(v => !v)}
            accent="amber"
          />
          {!sellersCollapsed && (
            <div className="p-3.5 sm:p-4 space-y-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={sellerSearch}
                  onChange={e => setSellerSearch(e.target.value)}
                  placeholder="Filter sellers..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white"
                />
              </div>

              {filteredSellers.length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-xs">No sellers match</div>
              ) : (
                <div className="divide-y divide-slate-800/60 max-h-[380px] overflow-y-auto pr-1">
                  {filteredSellers.map((seller: any) => (
                    <div key={seller.id || seller.name} className="py-2.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-white font-semibold text-xs truncate">{seller.name}</span>
                        <span className="font-mono font-bold text-emerald-400 text-xs shrink-0">
                          +{formatCurrency(seller.profit, settings.currencySymbol)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>
                          {seller.count} {seller.count === 1 ? 'order' : 'orders'}
                        </span>
                        <span className="font-mono">
                          {formatCurrency(seller.total, settings.currencySymbol)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── ASSISTANT PERFORMANCE (Only shown when Sales Assistant feature is ON) ── */}
      {salesAssistantEnabled && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <ReportSectionHeader
            title="Assistant Performance"
            subtitle="Sales assistant performance grouped under each seller"
            icon={<UserCheck className="w-4 h-4 text-emerald-400" />}
            period={assistantPeriod}
            onPeriodChange={setAssistantPeriod}
            customStart={assistantStart}
            customEnd={assistantEnd}
            onCustomStartChange={setAssistantStart}
            onCustomEndChange={setAssistantEnd}
            collapsed={assistantsCollapsed}
            onToggleCollapsed={() => setAssistantsCollapsed(v => !v)}
            accent="emerald"
            actions={
              <button
                type="button"
                onClick={() => {
                  setRankPeriod(assistantPeriod === 'year' ? 'month' : assistantPeriod);
                  setRankStart(assistantStart);
                  setRankEnd(assistantEnd);
                  setRankSearch('');
                  setShowAssistantRankingPage(true);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 active:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[11px] font-bold transition shadow-sm"
              >
                <Crown className="w-3.5 h-3.5 text-amber-400" />
                <span>List</span>
              </button>
            }
          />
          {!assistantsCollapsed && (
            <div className="p-3.5 sm:p-4 space-y-3">
              {/* Summary Strip */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Assistants</div>
                  <div className="text-sm font-extrabold text-white font-mono mt-0.5">
                    {assistantPerformance.totalAssistants}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {assistantPerformance.totalOrders}{' '}
                    {assistantPerformance.totalOrders === 1 ? 'order' : 'orders'}
                  </div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total Sales</div>
                  <div className="text-xs sm:text-sm font-extrabold text-blue-400 font-mono mt-0.5 truncate">
                    {formatCurrency(assistantPerformance.totalSales, settings.currencySymbol)}
                  </div>
                  <div className="text-[10px] text-slate-500">Assisted revenue</div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total Profit</div>
                  <div className="text-xs sm:text-sm font-extrabold text-emerald-400 font-mono mt-0.5 truncate">
                    +{formatCurrency(assistantPerformance.totalProfit, settings.currencySymbol)}
                  </div>
                  <div className="text-[10px] text-slate-500">Gross margin</div>
                </div>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={assistantSearch}
                  onChange={e => setAssistantSearch(e.target.value)}
                  placeholder="Filter by assistant or seller name..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {assistantPerformance.groups.length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-xs">
                  No sales recorded with a Sales Assistant (Jina la Muuzaji) in this period.
                </div>
              ) : (
                <div className="space-y-3">
                  {assistantPerformance.groups.map(group => (
                    <div
                      key={group.sellerKey}
                      className="rounded-xl bg-slate-950/80 border border-slate-800 overflow-hidden"
                    >
                      {/* Seller Group Header */}
                      <div className="px-3 py-2 bg-slate-950 border-b border-slate-800/80 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                          <span className="text-xs font-bold text-white truncate">
                            Seller: {group.sellerName}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono shrink-0">
                            {group.assistants.length}{' '}
                            {group.assistants.length === 1 ? 'assistant' : 'assistants'}
                          </span>
                        </div>
                        <div className="text-right shrink-0 text-[11px] font-mono">
                          <span className="text-slate-300 font-semibold">
                            {formatCurrency(group.totalSales, settings.currencySymbol)}
                          </span>
                        </div>
                      </div>

                      {/* Assistants under this Seller */}
                      <div className="divide-y divide-slate-800/60 px-3">
                        {group.assistants.map(asst => (
                          <div key={asst.key} className="py-2.5 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs font-semibold text-white truncate">
                                  {asst.assistantName}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 font-mono truncate">
                                  {group.sellerName}/{asst.assistantName}
                                </span>
                              </div>
                              <span className="font-mono font-bold text-emerald-400 text-xs shrink-0">
                                +{formatCurrency(asst.profit, settings.currencySymbol)}
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-slate-400">
                              <span>
                                {asst.orders} {asst.orders === 1 ? 'order' : 'orders'} ·{' '}
                                {Number(asst.itemsSold.toFixed(2))} units · Avg{' '}
                                {formatCurrency(asst.avgOrder, settings.currencySymbol)}
                              </span>
                              <span className="font-mono font-semibold text-slate-200 shrink-0">
                                {formatCurrency(asst.totalSales, settings.currencySymbol)}
                              </span>
                            </div>

                            {/* Performance share bar under Seller */}
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                                  style={{ width: `${Math.max(4, asst.sharePct)}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-slate-500 w-8 text-right shrink-0">
                                {asst.sharePct}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
