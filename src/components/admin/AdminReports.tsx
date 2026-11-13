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
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ReportService } from '../../services/reportService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type ReportPeriod = 'today' | 'week' | 'month' | 'custom';

interface DeviationRow {
  saleId: string;
  receiptNumber: string;
  createdAt: string;
  shopId: string;
  shopName: string;
  sellerId: string;
  sellerName: string;
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

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function computeRange(period: ReportPeriod, customFrom: string, customTo: string) {
  const now = new Date();
  if (period === 'today') {
    const d = now.toISOString().slice(0, 10);
    return { from: d, to: d };
  }
  if (period === 'week') {
    const past = new Date(now.getTime() - 7 * 86400000);
    return { from: past.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  }
  if (period === 'month') {
    const past = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: past.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  }
  return { from: customFrom || undefined, to: customTo || undefined };
}

// ─────────────────────────────────────────────────────────────
// Section Header
// ─────────────────────────────────────────────────────────────
const SectionHeader: React.FC<{
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
  accent?: 'blue' | 'rose' | 'purple' | 'amber';
}> = ({
  title, subtitle, icon, period, onPeriodChange,
  customStart, customEnd, onCustomStartChange, onCustomEndChange,
  collapsed, onToggleCollapsed, actions, accent = 'blue',
}) => {
  const accentClasses: Record<string, string> = {
    blue: 'from-blue-950/20 via-slate-900 to-slate-900',
    rose: 'from-rose-950/20 via-slate-900 to-slate-900',
    purple: 'from-purple-950/20 via-slate-900 to-slate-900',
    amber: 'from-amber-950/20 via-slate-900 to-slate-900',
  };
  const pillActive: Record<string, string> = {
    blue: 'bg-blue-600 text-white shadow-sm',
    rose: 'bg-rose-600 text-white shadow-sm',
    purple: 'bg-purple-600 text-white shadow-sm',
    amber: 'bg-amber-600 text-white shadow-sm',
  };

  return (
    <div className={`border-b border-slate-800 bg-gradient-to-r ${accentClasses[accent]} p-3.5 space-y-3`}>
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
            { id: 'custom', label: 'Custom' },
          ].map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPeriodChange(p.id as ReportPeriod)}
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
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">From</label>
            <input
              type="date"
              value={customStart}
              onChange={e => onCustomStartChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">To</label>
            <input
              type="date"
              value={customEnd}
              onChange={e => onCustomEndChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export const AdminReports: React.FC = () => {
  const { currentUser, dbState, addToast } = useApp();

  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('today');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

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

  const [incomeCollapsed, setIncomeCollapsed] = useState(false);
  const [deviationCollapsed, setDeviationCollapsed] = useState(false);
  const [shopsCollapsed, setShopsCollapsed] = useState(false);
  const [productsCollapsed, setProductsCollapsed] = useState(false);
  const [sellersCollapsed, setSellersCollapsed] = useState(false);

  const [shopFilter, setShopFilter] = useState('ALL');
  const [productSearch, setProductSearch] = useState('');
  const [sellerSearch, setSellerSearch] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  const [deviationDirection, setDeviationDirection] = useState<DeviationDirection>('ALL');

  if (!currentUser) return null;
  if (currentUser.role !== 'ADMIN' && !currentUser.permissions?.canViewReports) return null;

  const settings = dbState.settings;
  const shops = dbState.shops || [];
  const products = dbState.products || [];

  const incomeRange = useMemo(() => computeRange(reportPeriod, customStartDate, customEndDate), [reportPeriod, customStartDate, customEndDate]);
  const deviationRange = useMemo(() => computeRange(deviationPeriod, deviationStart, deviationEnd), [deviationPeriod, deviationStart, deviationEnd]);
  const shopRange = useMemo(() => computeRange(shopPeriod, shopStart, shopEnd), [shopPeriod, shopStart, shopEnd]);
  const productRange = useMemo(() => computeRange(productPeriod, productStart, productEnd), [productPeriod, productStart, productEnd]);
  const sellerRange = useMemo(() => computeRange(sellerPeriod, sellerStart, sellerEnd), [sellerPeriod, sellerStart, sellerEnd]);

  const incomeSummary = useMemo(() => ReportService.getFinancialSummary(incomeRange, { shopId: shopFilter }, currentUser) || {}, [incomeRange, currentUser, dbState, shopFilter]);
  const shopSummary = useMemo(() => ReportService.getFinancialSummary(shopRange, { shopId: shopFilter }, currentUser) || {}, [shopRange, currentUser, dbState, shopFilter]);
  const productSummary = useMemo(() => ReportService.getFinancialSummary(productRange, { shopId: shopFilter }, currentUser) || {}, [productRange, currentUser, dbState, shopFilter]);
  const sellerSummary = useMemo(() => ReportService.getFinancialSummary(sellerRange, { shopId: shopFilter }, currentUser) || {}, [sellerRange, currentUser, dbState, shopFilter]);
  const deviationSummary = useMemo(() => ReportService.getFinancialSummary(deviationRange, { shopId: shopFilter }, currentUser) || {}, [deviationRange, currentUser, dbState, shopFilter]);

  const filteredProducts = useMemo(() => {
    const list = (productSummary as any).topProducts || [];
    if (!productSearch.trim()) return list;
    const q = productSearch.trim().toLowerCase();
    return list.filter((p: any) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [productSummary, productSearch]);

  const filteredSellers = useMemo(() => {
    const list = (sellerSummary as any).sellerSales || [];
    if (!sellerSearch.trim()) return list;
    const q = sellerSearch.trim().toLowerCase();
    return list.filter((s: any) => s.name.toLowerCase().includes(q));
  }, [sellerSummary, sellerSearch]);

  const selectedShopName =
    shopFilter === 'ALL' ? 'All Shops' : shops.find((s: any) => s.id === shopFilter)?.name || 'Unknown';

  // ─────────────────────────────────────────────────────────────
  // Deviations — snapshot-first, below-cost detection
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

        rows.push({
          saleId: sale.id,
          receiptNumber: sale.receiptNumber,
          createdAt: sale.createdAt,
          shopId: sale.shopId,
          shopName: sale.shopName || '',
          sellerId: sale.sellerId,
          sellerName: sale.sellerName,
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
  }, [deviationSummary, products]);

  const deviations = useMemo(() => {
    if (deviationDirection === 'ALL') return allDeviations;
    if (deviationDirection === 'BELOW_COST') return allDeviations.filter(d => d.belowCost);
    if (deviationDirection === 'BELOW') return allDeviations.filter(d => d.direction === 'BELOW' && d.referencePrice > 0);
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

  const DEVIATION_DISPLAY_CAP = 150;
  const visibleDeviations = deviations.slice(0, DEVIATION_DISPLAY_CAP);
  const hiddenDeviationCount = Math.max(0, deviations.length - DEVIATION_DISPLAY_CAP);

  // ─────────────────────────────────────────────────────────────
  // Print Main Report
  // ─────────────────────────────────────────────────────────────
  const handlePrintReport = () => {
    setIsPrinting(true);
    const printWindow = window.open('', '_blank', 'width=1400,height=900');
    if (!printWindow) {
      addToast({ type: 'error', title: 'Popup Blocked', description: 'Please allow popups to print.' });
      setIsPrinting(false);
      return;
    }
    const s: any = incomeSummary;
    const printContent = `
      <!DOCTYPE html><html><head><title>Financial Report - ${selectedShopName}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; padding:20px; background:#fff; color:#1e293b; }
        .header { text-align:center; margin-bottom:20px; border-bottom:3px double #3b82f6; padding-bottom:15px; }
        .header h1 { font-size:22px; color:#1e40af; }
        .header .company { font-size:13px; color:#475569; margin-top:5px; }
        .header .meta { font-size:11px; color:#64748b; margin-top:8px; line-height:1.5; }
        .badge { display:inline-block; background:#dbeafe; color:#1e40af; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:600; margin-top:8px; }
        .section-title { font-size:15px; font-weight:bold; margin-bottom:12px; padding:8px 12px; background:#eff6ff; border-left:4px solid #3b82f6; border-radius:0 8px 8px 0; }
        table { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:16px; }
        thead { background:#1e293b; color:#fff; }
        th { padding:8px 6px; text-align:left; font-weight:600; }
        td { padding:7px 6px; border-bottom:1px solid #e2e8f0; }
        tr:nth-child(even) { background:#f8fafc; }
        .amount { text-align:right; font-family:'Courier New',monospace; font-weight:bold; }
        .positive { color:#16a34a; }
        .negative { color:#dc2626; }
        .footer { text-align:center; margin-top:25px; font-size:10px; color:#94a3b8; border-top:2px solid #e2e8f0; padding-top:12px; }
      </style></head><body>
        <div class="header">
          <h1>${settings.businessName}</h1>
          <div class="company">${settings.tagline || ''}</div>
          <div class="meta">
            <strong>Financial Report</strong><br>
            Period: ${incomeRange.from || 'Beginning'} to ${incomeRange.to || 'Present'}<br>
            Generated: ${new Date().toLocaleString()}
          </div>
          <div class="badge">🏪 ${selectedShopName}</div>
        </div>
        <div class="section-title">📊 Income Statement</div>
        <table><tbody>
          <tr><td><strong>Gross Revenue</strong></td><td class="amount">${settings.currencySymbol} ${(s.totalGrossSales || 0).toLocaleString()}</td></tr>
          <tr><td>Less: COGS</td><td class="amount negative">-${settings.currencySymbol} ${(s.totalCostOfGoods || 0).toLocaleString()}</td></tr>
          <tr><td><strong>Gross Profit</strong></td><td class="amount positive">${settings.currencySymbol} ${(s.totalGrossProfit || 0).toLocaleString()} (${s.profitMarginPercent || 0}%)</td></tr>
          <tr><td>Less: Expenses</td><td class="amount negative">-${settings.currencySymbol} ${(s.totalExpenses || 0).toLocaleString()}</td></tr>
          <tr style="background:#f0fdf4;"><td><strong>NET PROFIT</strong></td><td class="amount ${(s.netProfit || 0) >= 0 ? 'positive' : 'negative'}">${settings.currencySymbol} ${(s.netProfit || 0).toLocaleString()} (${s.netMarginPercent || 0}%)</td></tr>
        </tbody></table>
        <div class="section-title">🏪 Shop Performance</div>
        <table><thead><tr><th>Shop</th><th class="amount">Sales</th><th class="amount">Revenue</th><th class="amount">Profit</th></tr></thead><tbody>
          ${(s.shopSalesBreakdown || []).map((sh: any) => `<tr><td>${sh.name}</td><td class="amount">${sh.salesCount}</td><td class="amount">${settings.currencySymbol} ${sh.totalSales.toLocaleString()}</td><td class="amount positive">${settings.currencySymbol} ${sh.grossProfit.toLocaleString()}</td></tr>`).join('')}
        </tbody></table>
        <div class="section-title">📦 Product Profitability</div>
        <table><thead><tr><th>Product</th><th>SKU</th><th class="amount">Units</th><th class="amount">Revenue</th><th class="amount">Profit</th></tr></thead><tbody>
          ${(s.topProducts || []).map((p: any) => `<tr><td>${p.name}</td><td style="font-family:monospace;">${p.sku}</td><td class="amount">${p.unitsSold}</td><td class="amount">${settings.currencySymbol} ${p.revenue.toLocaleString()}</td><td class="amount positive">${settings.currencySymbol} ${p.profit.toLocaleString()}</td></tr>`).join('')}
        </tbody></table>
        <div class="section-title">👥 Seller Performance</div>
        <table><thead><tr><th>Seller</th><th class="amount">Orders</th><th class="amount">Revenue</th><th class="amount">Profit</th></tr></thead><tbody>
          ${(s.sellerSales || []).map((se: any) => `<tr><td>${se.name}</td><td class="amount">${se.count}</td><td class="amount">${settings.currencySymbol} ${se.total.toLocaleString()}</td><td class="amount positive">${settings.currencySymbol} ${se.profit.toLocaleString()}</td></tr>`).join('')}
        </tbody></table>
        <div class="footer">${settings.businessName} - ${settings.address || ''} | Phone: ${settings.phone || 'N/A'}</div>
        <script>window.onload=function(){window.print();}</script>
      </body></html>
    `;
    printWindow.document.write(printContent);
    printWindow.document.close();
    setTimeout(() => setIsPrinting(false), 2000);
  };

  const handlePrintDeviations = () => {
    if (deviations.length === 0) {
      addToast({ type: 'info', title: 'No Deviations', description: 'There are no price deviations in the current filter.' });
      return;
    }
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) {
      addToast({ type: 'error', title: 'Popup Blocked', description: 'Please allow popups to print.' });
      return;
    }
    const printContent = `
      <!DOCTYPE html><html><head><title>Price Deviation Audit</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; padding:20px; background:#fff; color:#1e293b; }
        .header { text-align:center; margin-bottom:20px; border-bottom:3px double #dc2626; padding-bottom:15px; }
        .header h1 { font-size:22px; color:#991b1b; }
        .header .meta { font-size:11px; color:#64748b; margin-top:8px; line-height:1.5; }
        .summary { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin-bottom:20px; }
        .card { padding:12px; border-radius:8px; text-align:center; }
        .card.below { background:#fef2f2; border:2px solid #dc2626; }
        .card.belowcost { background:#fff7ed; border:2px solid #f97316; }
        .card.above { background:#f0fdf4; border:2px solid #16a34a; }
        .card .label { font-size:9px; text-transform:uppercase; color:#64748b; font-weight:600; }
        .card .value { font-size:16px; font-weight:bold; margin-top:4px; }
        table { width:100%; border-collapse:collapse; font-size:10px; }
        thead { background:#1e293b; color:#fff; }
        th { padding:7px 5px; text-align:left; font-weight:600; }
        td { padding:6px 5px; border-bottom:1px solid #e2e8f0; }
        tr.below td { background:#fef2f2; }
        tr.belowcost td { background:#fff7ed; }
        tr.above td { background:#f0fdf4; }
        .amount { text-align:right; font-family:'Courier New',monospace; font-weight:bold; }
        .diff-below { color:#dc2626; text-align:right; font-weight:bold; }
        .diff-above { color:#16a34a; text-align:right; font-weight:bold; }
        .loss-tag { display:inline-block; background:#f97316; color:#fff; padding:1px 4px; border-radius:3px; font-size:8px; font-weight:bold; margin-left:3px; }
        .est { color:#94a3b8; font-size:8px; font-weight:normal; margin-left:3px; }
        @media (min-width:640px) { .summary { grid-template-columns:repeat(3,1fr); } table { font-size:11px; } }
      </style></head><body>
        <div class="header">
          <h1>Price Deviation Audit</h1>
          <div class="meta">
            Shop: ${selectedShopName} | Period: ${deviationRange.from || 'Beginning'} to ${deviationRange.to || 'Present'}<br>
            Direction: ${deviationDirection} | Generated: ${new Date().toLocaleString()}
          </div>
        </div>
        <div class="summary">
          <div class="card below"><div class="label">Below Reference</div><div class="value">${deviationStats.belowCount}</div></div>
          <div class="card belowcost"><div class="label">Below Cost (Loss)</div><div class="value">${deviationStats.belowCostCount}</div></div>
          <div class="card above"><div class="label">Above Reference</div><div class="value">${deviationStats.aboveCount}</div></div>
        </div>
        <table><thead><tr>
          <th>Date</th><th>Receipt</th><th>Shop</th><th>Seller</th><th>Product</th><th>SKU</th>
          <th class="amount">Selling Price</th><th class="amount">Sold At</th><th class="amount">Diff</th><th class="amount">Qty</th><th class="amount">Impact</th>
        </tr></thead><tbody>
          ${deviations.map(d => `
            <tr class="${d.belowCost ? 'belowcost' : d.direction === 'BELOW' ? 'below' : 'above'}">
              <td>${formatDateTime(d.createdAt)}</td>
              <td><strong>${d.receiptNumber}</strong></td>
              <td>${d.shopName}</td>
              <td>${d.sellerName}</td>
              <td>${d.productName}${d.belowCost ? '<span class="loss-tag">LOSS</span>' : ''}</td>
              <td style="font-family:monospace;">${d.sku}</td>
              <td class="amount">${d.referencePrice > 0 ? `${settings.currencySymbol} ${d.referencePrice.toLocaleString()}${!d.usedSnapshot ? '<span class="est">*</span>' : ''}` : '—'}</td>
              <td class="amount">${settings.currencySymbol} ${d.soldPrice.toLocaleString()}</td>
              <td class="${d.direction === 'BELOW' ? 'diff-below' : 'diff-above'}">${d.referencePrice > 0 ? `${d.diff > 0 ? '+' : ''}${settings.currencySymbol} ${d.diff.toLocaleString()}` : '—'}</td>
              <td class="amount">${d.quantity}</td>
              <td class="${d.direction === 'BELOW' ? 'diff-below' : 'diff-above'}">${d.referencePrice > 0 ? `${d.totalImpact > 0 ? '+' : ''}${settings.currencySymbol} ${d.totalImpact.toLocaleString()}` : '—'}</td>
            </tr>
          `).join('')}
        </tbody></table>
        <script>window.onload=function(){window.print();}</script>
      </body></html>
    `;
    printWindow.document.write(printContent);
    printWindow.document.close();
  };

  const handleExportCSV = () => {
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
    csv += `\nPRODUCT PROFITABILITY\nProduct,SKU,Units,Revenue,Profit\n`;
    (s.topProducts || []).forEach((p: any) => {
      csv += `"${p.name}","${p.sku}",${p.unitsSold},${p.revenue},${p.profit}\n`;
    });
    csv += `\nSELLER PERFORMANCE\nSeller,Orders,Total,Profit\n`;
    (s.sellerSales || []).forEach((se: any) => {
      csv += `"${se.name}",${se.count},${se.total},${se.profit}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `financial_report_${selectedShopName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: 'Report Exported', description: 'CSV report downloaded successfully.' });
  };

  const handleExportDeviationsCSV = () => {
    if (deviations.length === 0) {
      addToast({ type: 'info', title: 'No Deviations', description: 'There are no price deviations in the current filter.' });
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
    csv += `Above Reference Value,${deviationStats.aboveImpact}\n\n`;
    csv += `Date,Receipt #,Shop,Seller,Product,SKU,Selling Price,Sold At,Purchase Cost,Diff,Qty,Impact,Direction,Below Cost,Reference Source\n`;
    deviations.forEach(d => {
      csv += `"${formatDateTime(d.createdAt)}","${d.receiptNumber}","${d.shopName}","${d.sellerName}","${d.productName}","${d.sku}",${d.referencePrice},${d.soldPrice},${d.purchasePrice},${d.diff},${d.quantity},${d.totalImpact},${d.direction},${d.belowCost ? 'YES' : 'NO'},"${d.usedSnapshot ? 'Snapshot' : 'Current price'}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `price_deviations_${selectedShopName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: 'Deviations Exported', description: `${deviations.length} deviation(s) saved.` });
  };

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div
      id="admin-reports-view"
      className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto space-y-4 pb-24 sm:pb-6"
    >
      {/* Global header */}
      <div className="flex flex-col gap-3 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">Financial Reports</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Audit store performance, margins, and price deviations
          </p>
        </div>

        <select
          value={shopFilter}
          onChange={e => setShopFilter(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white"
        >
          <option value="ALL">🏪 All Shops</option>
          {shops.map((s: any) => <option key={s.id} value={s.id}>🏪 {s.name}</option>)}
        </select>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition active:scale-95"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={handlePrintReport}
            disabled={isPrinting}
            className="flex-1 flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow transition disabled:opacity-50 active:scale-95"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{isPrinting ? 'Printing...' : 'Print'}</span>
          </button>
        </div>
      </div>

      {/* ── Income Statement ──────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <SectionHeader
          title="Income Statement"
          subtitle="Revenue, COGS, expenses, net profit"
          icon={<FileText className="w-4 h-4 text-blue-400" />}
          period={reportPeriod}
          onPeriodChange={setReportPeriod}
          customStart={customStartDate}
          customEnd={customEndDate}
          onCustomStartChange={setCustomStartDate}
          onCustomEndChange={setCustomEndDate}
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
            <div className={`flex justify-between py-2.5 px-3 rounded-lg border ${
              ((incomeSummary as any).netProfit || 0) >= 0
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-rose-500/10 border-rose-500/30'
            }`}>
              <div>
                <span className="font-bold text-white">NET PROFIT</span>
                <span className="text-[10px] text-slate-300 block font-mono">
                  {(incomeSummary as any).netMarginPercent || 0}% Net Return
                </span>
              </div>
              <span className={`font-mono font-extrabold text-sm ${
                ((incomeSummary as any).netProfit || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {formatCurrency((incomeSummary as any).netProfit || 0, settings.currencySymbol)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Price Deviation Audit ────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <SectionHeader
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
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleExportDeviationsCSV}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px] font-semibold transition"
                >
                  <Download className="w-3 h-3" />
                  <span>Export</span>
                </button>
                <button
                  onClick={handlePrintDeviations}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold shadow transition"
                >
                  <Printer className="w-3 h-3" />
                  <span>Print</span>
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
              <div className="p-3.5 space-y-3.5">
                {/* Summary — 3 cards */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-800/40">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-rose-300 uppercase tracking-wider">Below Reference</span>
                      <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                    </div>
                    <div className="text-lg font-bold text-rose-300 font-mono">{deviationStats.belowCount}</div>
                    <div className="text-[10px] text-rose-400/80 mt-0.5">
                      {deviationStats.belowSalesCount} sale{deviationStats.belowSalesCount === 1 ? '' : 's'} · value {formatCurrency(deviationStats.belowImpact, settings.currencySymbol)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-orange-950/30 border border-orange-800/40">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-orange-300 uppercase tracking-wider">Below Cost (Loss)</span>
                      <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
                    </div>
                    <div className="text-lg font-bold text-orange-300 font-mono">{deviationStats.belowCostCount}</div>
                    <div className="text-[10px] text-orange-400/80 mt-0.5">
                      Real loss: {formatCurrency(deviationStats.costLoss, settings.currencySymbol)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">Above Reference</span>
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="text-lg font-bold text-emerald-300 font-mono">{deviationStats.aboveCount}</div>
                    <div className="text-[10px] text-emerald-400/80 mt-0.5">
                      {deviationStats.aboveSalesCount} sale{deviationStats.aboveSalesCount === 1 ? '' : 's'} · value {formatCurrency(deviationStats.aboveImpact, settings.currencySymbol)}
                    </div>
                  </div>
                </div>

                <div className={`p-3 rounded-xl border flex items-center justify-between ${
                  deviationStats.netImpact >= 0 ? 'bg-emerald-950/20 border-emerald-800/40' : 'bg-rose-950/20 border-rose-800/40'
                }`}>
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Net Impact</span>
                  <span className={`text-base font-bold font-mono ${
                    deviationStats.netImpact >= 0 ? 'text-emerald-300' : 'text-rose-300'
                  }`}>
                    {deviationStats.netImpact > 0 ? '+' : ''}{formatCurrency(deviationStats.netImpact, settings.currencySymbol)}
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
                      deviationDirection === 'BELOW_COST' ? 'bg-orange-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    Loss ({deviationStats.belowCostCount})
                  </button>
                  <button
                    onClick={() => setDeviationDirection('ABOVE')}
                    className={`px-2 py-1.5 rounded-md transition ${
                      deviationDirection === 'ABOVE' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    Above ({deviationStats.aboveCount})
                  </button>
                </div>

                <div className="text-[10px] text-slate-500 font-mono text-center">
                  Showing {visibleDeviations.length} of {deviations.length}
                  {hiddenDeviationCount > 0 && ` · export CSV to see all`}
                </div>

                {/* ── Deviation cards ── */}
                <div className="space-y-2">
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
                      <div key={`${d.saleId}-${d.productId}-${idx}`} className={`rounded-xl p-3 border space-y-2.5 ${cardBg}`}>
                        {/* Product name + LOSS badge + impact */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-bold text-white truncate">{d.productName}</span>
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

                        {/* 3-column grid: Selling Price | Sold At | Qty */}
                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div>
                            <div className="text-slate-500 text-[9px] uppercase tracking-wider mb-0.5">Selling Price</div>
                            <div className="font-mono font-semibold text-slate-200">
                              {d.referencePrice > 0
                                ? `${formatCurrency(d.referencePrice, settings.currencySymbol)}${!d.usedSnapshot ? '*' : ''}`
                                : '—'}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-[9px] uppercase tracking-wider mb-0.5">Sold At</div>
                            <div className={`font-mono font-bold ${accentText}`}>
                              {formatCurrency(d.soldPrice, settings.currencySymbol)}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-[9px] uppercase tracking-wider mb-0.5">Qty</div>
                            <div className="font-mono font-semibold text-slate-200">{d.quantity}</div>
                          </div>
                        </div>

                        {/* Footer: receipt • seller (BOLD) • date */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/60 text-[10px]">
                          <span className="font-mono text-slate-400 truncate">{d.receiptNumber}</span>
                          <span className="font-bold text-slate-100 truncate max-w-[140px]" title={d.sellerName}>
                            {d.sellerName}
                          </span>
                          <span className="font-mono text-slate-400 shrink-0">{formatDateTime(d.createdAt).slice(5, 16)}</span>
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

      {/* ── Shop Performance ─────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <SectionHeader
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
          <div className="p-3.5">
            {((shopSummary as any).shopSalesBreakdown || []).length === 0 ? (
              <div className="py-6 text-center text-slate-500 text-xs">No shop data in this period.</div>
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
                      <span>{shop.salesCount} {shop.salesCount === 1 ? 'sale' : 'sales'}</span>
                      <span className="font-mono">{formatCurrency(shop.totalSales, settings.currencySymbol)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Product Profitability ────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <SectionHeader
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
          <div className="p-3.5 space-y-3">
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
              <div className="divide-y divide-slate-800/60">
                {filteredProducts.map((p: any) => (
                  <div key={p.sku} className="py-2.5 space-y-1">
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

      {/* ── Seller Performance ───────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <SectionHeader
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
          <div className="p-3.5 space-y-3">
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
              <div className="divide-y divide-slate-800/60">
                {filteredSellers.map((seller: any) => (
                  <div key={seller.name} className="py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white font-semibold text-xs truncate">{seller.name}</span>
                      <span className="font-mono font-bold text-emerald-400 text-xs shrink-0">
                        +{formatCurrency(seller.profit, settings.currencySymbol)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{seller.count} {seller.count === 1 ? 'order' : 'orders'}</span>
                      <span className="font-mono">{formatCurrency(seller.total, settings.currencySymbol)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
