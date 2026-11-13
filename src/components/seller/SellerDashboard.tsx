import React from 'react';
import {
  ShoppingCart,
  DollarSign,
  Package,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  Receipt,
  CheckCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ReportService } from '../../services/reportService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

export const SellerDashboard: React.FC = () => {
  const { currentUser, setActiveTab, showReceipt, sellerColor, dbState } = useApp();

  if (!currentUser) return null;

  const settings = dbState.settings;
  const summary = ReportService.getSellerDashboardSummary(currentUser.id);

  // Low stock products warning
  const lowStockProducts = (dbState.products || []).filter(
    p => p.status === 'ACTIVE' && p.currentStock <= p.minStock
  );

  return (
    <div id="seller-dashboard-view" className="flex-1 p-6 bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Welcome Banner */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Welcome back, {currentUser.name}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Seller Register Terminal • Local Database Ready • Offline Operations Enabled
          </p>
        </div>

        <button
          id="start-new-sale-btn"
          onClick={() => setActiveTab('new_sale')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs text-white shadow-lg transition-all"
          style={{ backgroundColor: sellerColor.primary }}
        >
          <ShoppingCart className="w-4 h-4" />
          <span>Start New Sale</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Today's Sales */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Today's Revenue</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {formatCurrency(summary.todayRevenue, settings.currencySymbol)}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">From your registered sales today</p>
        </div>

        {/* Transactions Completed */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Transactions</span>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {summary.todaySalesCount}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Completed today</p>
        </div>

        {/* Units Sold */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Items Sold</span>
            <Package className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {summary.todayItemsCount}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Total items processed</p>
        </div>

        {/* All-Time Personal Volume */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">All-Time Sales</span>
            <CheckCircle className="w-4 h-4 text-teal-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {formatCurrency(summary.allTimeRevenue, settings.currencySymbol)}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">{summary.allTimeSalesCount} lifetime sales</p>
        </div>
      </div>

      {/* Low Stock Warning Banner if any */}
      {lowStockProducts.length > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                Low Stock Notification ({lowStockProducts.length} Items)
              </h4>
              <p className="text-xs text-amber-200/80 mt-0.5">
                Certain items in inventory have dropped to or below minimum threshold. Notify administrator for restock.
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveTab('products')}
            className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-semibold text-amber-300 transition shrink-0"
          >
            View Products
          </button>
        </div>
      )}

      {/* Recent Personal Sales Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Your Recent Completed Sales</h3>
            <p className="text-xs text-slate-400 mt-0.5">Latest transactions processed by you</p>
          </div>
          <button
            onClick={() => setActiveTab('my_sales')}
            className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 transition"
          >
            <span>View All My Sales</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {(summary.recentSales || []).length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <Receipt className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium text-slate-400">No sales recorded yet today</p>
            <button
              onClick={() => setActiveTab('new_sale')}
              className="mt-3 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition"
            >
              Start First Sale
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-2.5 font-semibold">Receipt #</th>
                  <th className="pb-2.5 font-semibold">Time</th>
                  <th className="pb-2.5 font-semibold">Items</th>
                  <th className="pb-2.5 font-semibold">Payment</th>
                  <th className="pb-2.5 text-right font-semibold">Total Amount</th>
                  <th className="pb-2.5 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {(summary.recentSales || []).map(sale => (
                  <tr key={sale.id} className="hover:bg-slate-850/60 transition">
                    <td className="py-3 font-mono font-medium text-white">{sale.receiptNumber}</td>
                    <td className="py-3 text-slate-400">{formatDateTime(sale.createdAt)}</td>
                    <td className="py-3 text-slate-300">{(sale.items || []).length} item(s)</td>
                    <td className="py-3">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-medium uppercase">
                        {sale.paymentMethod}
                      </span>
                    </td>
                    <td className="py-3 text-right font-mono font-bold text-emerald-400">
                      {formatCurrency(sale.total, settings.currencySymbol)}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => showReceipt(sale)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition"
                      >
                        View Receipt
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
