import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  DollarSign,
  TrendingDown,
  ShoppingCart,
  AlertTriangle,
  Users,
  Package,
  Calendar,
  Layers,
  ArrowRight,
  Shield,
  CreditCard,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ReportService } from '../../services/reportService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

export const AdminDashboard: React.FC = () => {
  const { currentUser, dbState, setActiveTab, showReceipt, selectedShopId, currentShop } = useApp();
  const [timeFilter, setTimeFilter] = useState<'today' | 'week' | 'month' | 'all'>('today');

  if (!currentUser || currentUser.role !== 'ADMIN') return null;

  const settings = dbState.settings;

  // Compute date range based on filter
  const dateRange = useMemo(() => {
    const now = new Date();
    if (timeFilter === 'today') {
      const todayStr = now.toISOString().slice(0, 10);
      return { from: todayStr, to: todayStr };
    }
    if (timeFilter === 'week') {
      const past = new Date(now.getTime() - 7 * 86400000);
      return { from: past.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
    }
    if (timeFilter === 'month') {
      const past = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: past.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
    }
    return {};
  }, [timeFilter]);

  const summary = useMemo(() => {
    return ReportService.getFinancialSummary(
      dateRange,
      { shopId: selectedShopId },
      currentUser
    );
  }, [dateRange, selectedShopId, currentUser, dbState]);

  // Inventory stats filtered by shop if specific shop is selected
  const lowStockProducts = (dbState.products || []).filter(
    p => p.status === 'ACTIVE' && p.currentStock <= p.minStock && (!selectedShopId || selectedShopId === 'ALL' || p.shopId === selectedShopId)
  );

  const shopScopeLabel = selectedShopId === 'ALL' 
    ? 'Company Overview (All Shops)' 
    : currentShop?.name || 'Selected Shop';

  return (
    <div id="admin-dashboard-view" className="flex-1 p-6 bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Top Header & Range Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white tracking-tight">Executive Business Overview</h2>
            <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-bold border border-blue-500/30">
              {shopScopeLabel}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {selectedShopId === 'ALL' 
              ? 'Consolidated company-wide financial performance across all business units' 
              : `Real-time analytics and financial metrics for ${currentShop?.name || 'selected shop'}`}
          </p>
        </div>

        {/* Date Filters */}
        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
          {[
            { id: 'today', label: 'Today' },
            { id: 'week', label: 'Last 7 Days' },
            { id: 'month', label: 'This Month' },
            { id: 'all', label: 'All Time' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setTimeFilter(f.id as any)}
              className={`px-3 py-1.5 rounded-lg transition ${
                timeFilter === f.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Gross Sales */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Gross Sales</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {formatCurrency(summary.totalGrossSales, settings.currencySymbol)}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1">
            <span>{summary.transactionCount} completed orders</span>
          </div>
        </div>

        {/* Gross Profit */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Gross Profit</span>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-blue-300 font-mono">
            {formatCurrency(summary.totalGrossProfit, settings.currencySymbol)}
          </div>
          <div className="text-[11px] text-blue-400/80 mt-1 font-medium">
            Margin: {summary.profitMarginPercent}% of sales
          </div>
        </div>

        {/* Operating Expenses */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Expenses</span>
            <TrendingDown className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-rose-300 font-mono">
            {formatCurrency(summary.totalExpenses, settings.currencySymbol)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            COGS: {formatCurrency(summary.totalCostOfGoods, settings.currencySymbol)}
          </div>
        </div>

        {/* Net Result */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Net Bottom Line</span>
            <Shield className="w-4 h-4 text-amber-400" />
          </div>
          <div
            className={`text-2xl font-bold font-mono ${
              summary.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {formatCurrency(summary.netProfit, settings.currencySymbol)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Net Margin: {summary.netMarginPercent}%
          </div>
        </div>
      </div>

      {/* Low Stock Warning Box */}
      {lowStockProducts.length > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-amber-300">
                Action Required: {lowStockProducts.length} Product(s) Below Minimum Stock
              </h4>
              <p className="text-xs text-amber-200/80 mt-0.5">
                Restock through the Purchases or Inventory adjustment module to prevent checkout shortages.
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveTab('inventory')}
            className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition shrink-0"
          >
            Manage Inventory
          </button>
        </div>
      )}

      {/* 2-Column Section: Top Products & Sales by Seller */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Top Products */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-bold text-white">Top Selling Products</h3>
            </div>
            <span className="text-xs text-slate-400">By Revenue</span>
          </div>

          {(summary.topProducts || []).length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">No product sales in this period.</div>
          ) : (
            <div className="space-y-3">
              {(summary.topProducts || []).map((p, idx) => (
                <div
                  key={p.sku}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 font-bold flex items-center justify-center text-[10px]">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">{p.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {p.unitsSold} units sold • SKU: {p.sku}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold text-emerald-400">
                      {formatCurrency(p.revenue, settings.currencySymbol)}
                    </div>
                    <div className="text-[10px] text-blue-400 font-mono">
                      +${p.profit.toFixed(2)} profit
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sales by Seller Leaderboard */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-bold text-white">Seller Performance Breakdown</h3>
            </div>
            <button
              onClick={() => setActiveTab('sellers')}
              className="text-xs text-blue-400 hover:text-blue-300 font-semibold transition"
            >
              Manage Sellers
            </button>
          </div>

          {(summary.sellerSales || []).length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">No seller records in this period.</div>
          ) : (
            <div className="space-y-3">
              {(summary.sellerSales || []).map(seller => (
                <div
                  key={seller.name}
                  className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-500/30 flex items-center justify-center font-bold">
                      {seller.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold text-white">{seller.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {seller.count} transaction(s) completed
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-mono font-bold text-white">
                      {formatCurrency(seller.total, settings.currencySymbol)}
                    </div>
                    <div className="text-[10px] text-emerald-400 font-mono">
                      Gross Profit: {formatCurrency(seller.profit, settings.currencySymbol)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Business Transactions Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Recent Transactions</h3>
            <p className="text-xs text-slate-400 mt-0.5">Live store receipts saved to local database</p>
          </div>
          <button
            onClick={() => setActiveTab('sales')}
            className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 transition"
          >
            <span>View All Sales</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="pb-2.5 font-semibold">Receipt #</th>
                <th className="pb-2.5 font-semibold">Date & Time</th>
                <th className="pb-2.5 font-semibold">Products Sold</th>
                <th className="pb-2.5 font-semibold">Shop & Cashier</th>
                <th className="pb-2.5 font-semibold">Payment</th>
                <th className="pb-2.5 text-right font-semibold">Cost (COGS)</th>
                <th className="pb-2.5 text-right font-semibold">Total Revenue</th>
                <th className="pb-2.5 text-right font-semibold">Profit</th>
                <th className="pb-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {(summary.filteredSales || []).length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    No transactions found for the selected shop/period.
                  </td>
                </tr>
              ) : (
                (summary.filteredSales || []).slice(0, 6).map(sale => (
                  <tr key={sale.id} className="hover:bg-slate-850/60 transition">
                    <td className="py-3 font-mono font-semibold text-white">
                      <div>{sale.receiptNumber}</div>
                    </td>
                    <td className="py-3 text-slate-400 whitespace-nowrap">
                      {formatDateTime(sale.createdAt)}
                    </td>
                    <td className="py-3 max-w-xs">
                      <div className="flex flex-wrap gap-1">
                        {(sale.items || []).map((item, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/60 text-[11px] text-slate-200"
                            title={`${item.quantity}x ${item.productName} @ ${formatCurrency(item.unitPrice, settings.currencySymbol)}`}
                          >
                            <span className="font-bold text-blue-400">{item.quantity}x</span>
                            <span className="truncate max-w-[120px]">{item.productName}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 text-slate-300">
                      <div className="font-medium text-white">{sale.sellerName}</div>
                      <div className="text-[10px] text-slate-500">{sale.shopName}</div>
                    </td>
                    <td className="py-3">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] uppercase font-medium">
                        {sale.paymentMethod}
                      </span>
                    </td>
                    <td className="py-3 text-right font-mono text-slate-400">
                      {formatCurrency(sale.costOfGoods, settings.currencySymbol)}
                    </td>
                    <td className="py-3 text-right font-mono font-bold text-white">
                      {formatCurrency(sale.total, settings.currencySymbol)}
                    </td>
                    <td className="py-3 text-right font-mono font-bold text-emerald-400">
                      +{formatCurrency(sale.grossProfit, settings.currencySymbol)}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => showReceipt(sale)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition"
                      >
                        Receipt
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
