import React, { useState, useEffect } from 'react';
import {
  Search,
  Receipt,
  Printer,
  ArrowRight,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SalesService } from '../../services/salesService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

type DatePreset = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM';

export const SellerReceipts: React.FC = () => {
  const { currentUser, showReceipt, dbState } = useApp();
  const [receiptNumberInput, setReceiptNumberInput] = useState('');
  const [searchedSale, setSearchedSale] = useState<any>(null);
  const [searchError, setSearchError] = useState('');

  // Period filter — default TODAY
  const [datePreset, setDatePreset] = useState<DatePreset>('TODAY');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

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
      start.setDate(start.getDate() - 6);
      return { start: toYMD(start), end: toYMD(today) };
    }
    if (preset === 'MONTH') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: toYMD(start), end: toYMD(today) };
    }
    return null; // CUSTOM
  };

  // Apply preset → auto-compute start/end
  useEffect(() => {
    if (datePreset === 'CUSTOM') return;
    const range = computePresetRange(datePreset);
    if (range) {
      setStartDate(range.start);
      setEndDate(range.end);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datePreset]);

  if (!currentUser) return null;
  const settings = dbState.settings;

  // Recent sales for quick lookup — now scoped by the period
  const recentSales = SalesService.getSales(
    {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    },
    currentUser
  ).slice(0, 8);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchError('');
    setSearchedSale(null);

    const cleanInput = receiptNumberInput.trim();
    if (!cleanInput) return;

    const sale = SalesService.getSaleByReceipt(cleanInput, currentUser);
    if (sale) {
      setSearchedSale(sale);
    } else {
      setSearchError(`No receipt found with number '${cleanInput}' under your account.`);
    }
  };

  const getPeriodLabel = () => {
    switch (datePreset) {
      case 'TODAY':
        return 'Today';
      case 'WEEK':
        return 'Last 7 Days';
      case 'MONTH':
        return 'This Month';
      case 'CUSTOM':
        return 'Custom Range';
      default:
        return 'Today';
    }
  };

  // Colored presets
  const presets: { id: DatePreset; label: string; activeClass: string; idleClass: string }[] = [
    {
      id: 'TODAY',
      label: 'Today',
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
      id: 'CUSTOM',
      label: 'Custom',
      activeClass: 'bg-amber-500 border-amber-400 text-white shadow-md shadow-amber-500/30',
      idleClass: 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20',
    },
  ];

  return (
    <div
      id="seller-receipts-view"
      className="flex-1 p-3 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-6"
    >
      <div className="mb-6 pb-4 border-b border-slate-800">
        <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
          Receipt Lookup & Reprint
        </h2>
        <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
          Search receipt by unique transaction number or select recent sales to view/reprint thermal slips
        </p>
      </div>

      {/* Search Box */}
      <div className="max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 mb-6 shadow-xl">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Receipt className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={receiptNumberInput}
              onChange={e => setReceiptNumberInput(e.target.value)}
              placeholder="e.g. REC-20260822-4821"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="px-4 sm:px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-xs font-semibold text-white transition shadow shrink-0"
          >
            Find
          </button>
        </form>

        {searchError && (
          <p className="text-xs text-rose-400 mt-2.5 font-medium">{searchError}</p>
        )}

        {searchedSale && (
          <div className="mt-4 p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-in fade-in">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-white text-xs">
                  {searchedSale.receiptNumber}
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                  {searchedSale.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {formatDateTime(searchedSale.createdAt)} • {(searchedSale.items || []).length} items
                • {searchedSale.paymentMethod}
              </p>
              <p className="text-sm font-bold font-mono text-emerald-400 mt-0.5">
                {formatCurrency(searchedSale.total, settings.currencySymbol)}
              </p>
            </div>

            <button
              onClick={() => showReceipt(searchedSale)}
              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-xs font-bold text-white shadow transition shrink-0"
            >
              <Printer className="w-4 h-4" />
              <span>Preview & Print</span>
            </button>
          </div>
        )}
      </div>

      {/* Period Filter Pills */}
      <div className="max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-3.5 mb-5 space-y-3">
        <div className="flex items-center gap-1.5 text-slate-400 text-xs">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">
            Show Recent Receipts From
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
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

        {datePreset === 'CUSTOM' && (
          <div className="grid grid-cols-2 gap-2 pt-1 animate-in fade-in duration-150">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">From</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">To</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Quick Access List */}
      <div>
        <h3 className="text-sm font-bold text-white mb-3">
          Recent Receipts ({getPeriodLabel()}) — Available for Reprint
        </h3>

        {recentSales.length === 0 ? (
          <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-500">
            <Receipt className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-xs sm:text-sm">No receipts found for this period.</p>
            <p className="text-[11px] text-slate-600 mt-1">
              Try switching to Week, Month, or Custom range.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recentSales.map(sale => (
              <div
                key={sale.id}
                className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:border-slate-700 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono font-bold text-xs text-white truncate">
                    {sale.receiptNumber}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {formatDateTime(sale.createdAt)} • {(sale.items || []).length} items
                  </div>
                  <div className="font-mono font-bold text-xs text-emerald-400 mt-1">
                    {formatCurrency(sale.total, settings.currencySymbol)} ({sale.paymentMethod})
                  </div>
                </div>

                <button
                  onClick={() => showReceipt(sale)}
                  className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-xs font-semibold text-slate-200 border border-slate-700 transition shrink-0"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Reprint</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
