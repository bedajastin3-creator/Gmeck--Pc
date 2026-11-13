import React, { useState, useMemo, useRef } from 'react';
import {
  CreditCard,
  Plus,
  Calendar,
  DollarSign,
  Search,
  PieChart,
  X,
  AlertCircle,
  TrendingDown,
  Edit2,
  Trash2,
  Tag,
  FolderPlus,
  Save,
  AlertTriangle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ExpenseService } from '../../services/expenseService';
import { ExpenseCategory, PaymentMethod, Expense } from '../../types';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { formatPriceInput, parsePriceInput } from '../../utils/priceInput';
import { generateUUID } from '../../utils/crypto';

const DEFAULT_EXPENSE_CATEGORIES: { id: string; label: string; isCustom?: boolean }[] = [
  { id: 'RENT', label: 'Store Rent & Lease' },
  { id: 'ELECTRICITY', label: 'Electricity & Utilities' },
  { id: 'SALARIES', label: 'Staff Salaries & Payroll' },
  { id: 'TRANSPORT', label: 'Transport & Logistics' },
  { id: 'INTERNET', label: 'Internet & Communications' },
  { id: 'MAINTENANCE', label: 'Maintenance & Repairs' },
  { id: 'MARKETING', label: 'Marketing & Advertising' },
  { id: 'SUPPLIES', label: 'Store Supplies & Consumables' },
  { id: 'OTHER', label: 'General / Miscellaneous' },
];

const CUSTOM_CATEGORIES_KEY = 'omnibiz_custom_expense_categories';

type PeriodFilter = 'today' | 'week' | 'month' | 'year' | 'custom' | 'all';

interface CustomCategory {
  id: string;
  label: string;
  isCustom: true;
}

export const AdminExpenses: React.FC = () => {
  const { currentUser, dbState, addToast } = useApp();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  const [editingCategory, setEditingCategory] = useState<CustomCategory | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<CustomCategory | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  // Period filter state — ✅ DEFAULT: TODAY
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('today');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Custom Categories State
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(() => {
    try {
      const stored = localStorage.getItem(CUSTOM_CATEGORIES_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');

  // Form State
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('ELECTRICITY');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');

  // All categories = default + custom
  const allCategories = useMemo(() => {
    return [...DEFAULT_EXPENSE_CATEGORIES, ...customCategories];
  }, [customCategories]);

  // Permission check
  if (!currentUser) return null;
  if (
    currentUser.role !== 'ADMIN' &&
    !currentUser.permissions?.canViewExpenses &&
    !currentUser.permissions?.canRecordExpenses
  )
    return null;

  const canRecordExpense =
    currentUser.role === 'ADMIN' || currentUser.permissions?.canRecordExpenses;
  const isAdmin = currentUser.role === 'ADMIN';

  const settings = dbState.settings;

  // Save custom categories to localStorage
  const saveCustomCategories = (cats: CustomCategory[]) => {
    setCustomCategories(cats);
    localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(cats));
  };

  // Compute date range
  const dateRange = useMemo(() => {
    const now = new Date();

    switch (periodFilter) {
      case 'today': {
        const d = now.toISOString().slice(0, 10);
        return { from: d, to: d };
      }
      case 'week': {
        const past = new Date(now.getTime() - 7 * 86400000);
        return {
          from: past.toISOString().slice(0, 10),
          to: now.toISOString().slice(0, 10),
        };
      }
      case 'month': {
        const past = new Date(now.getFullYear(), now.getMonth(), 1);
        return {
          from: past.toISOString().slice(0, 10),
          to: now.toISOString().slice(0, 10),
        };
      }
      case 'year': {
        const past = new Date(now.getFullYear(), 0, 1);
        return {
          from: past.toISOString().slice(0, 10),
          to: now.toISOString().slice(0, 10),
        };
      }
      case 'custom': {
        return { from: customStartDate || undefined, to: customEndDate || undefined };
      }
      case 'all':
      default:
        return { from: undefined, to: undefined };
    }
  }, [periodFilter, customStartDate, customEndDate]);

  // Get expenses
  const expenses = useMemo(() => {
    return ExpenseService.getExpenses(
      {
        category: categoryFilter === 'ALL' ? undefined : categoryFilter,
        search: searchQuery,
        startDate: dateRange.from,
        endDate: dateRange.to,
      },
      currentUser
    );
  }, [categoryFilter, searchQuery, dateRange, currentUser, dbState.expenses]);

  const totalSpent = expenses.reduce((sum, e) => sum + e.amount, 0);

  // Compute top spend category
  const topCategory = useMemo(() => {
    const categoryTotals: Record<string, number> = {};
    expenses.forEach(e => {
      categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
    });

    let topCat = '';
    let topAmount = 0;
    Object.entries(categoryTotals).forEach(([cat, amt]) => {
      if (amt > topAmount) {
        topAmount = amt;
        topCat = cat;
      }
    });

    if (topCat) {
      const found = allCategories.find(c => c.id === topCat);
      return found ? found.label : topCat;
    }
    return 'No data';
  }, [expenses, allCategories]);

  // Get category label by ID
  const getCategoryLabel = (catId: string): string => {
    const found = allCategories.find(c => c.id === catId);
    return found ? found.label : catId;
  };

  const openAddModal = () => {
    setEditingExpense(null);
    setTitle('');
    setCategory('ELECTRICITY');
    setAmount('');
    setPaymentMethod('CASH');
    setReference('');
    setNotes('');
    setFormError('');
    setIsModalOpen(true);
  };

  const openEditModal = (expense: Expense) => {
    setEditingExpense(expense);
    setTitle(expense.title || expense.description);
    setCategory(expense.category);
    setAmount(expense.amount.toString());
    setPaymentMethod(expense.paymentMethod);
    setReference(expense.reference || '');
    setNotes(expense.notes || '');
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSaveExpense = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!title.trim()) {
      setFormError('Expense description title is required.');
      return;
    }

    const amt = parsePriceInput(amount);
    if (isNaN(amt) || amt <= 0) {
      setFormError('Please enter a valid expense amount.');
      return;
    }

    if (editingExpense) {
      const res = ExpenseService.updateExpense(
        editingExpense.id,
        {
          title: title.trim(),
          category,
          amount: amt,
          paymentMethod,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        },
        currentUser
      );

      if (res.success) {
        addToast({
          type: 'success',
          title: 'Expense Updated',
          description: `Expense updated successfully.`,
        });
        setIsModalOpen(false);
        setEditingExpense(null);
      } else {
        setFormError(res.error || 'Failed to update expense.');
      }
    } else {
      const res = ExpenseService.createExpense(
        {
          title: title.trim(),
          category,
          amount: amt,
          paymentMethod,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        },
        currentUser
      );

      if (res.success) {
        addToast({
          type: 'success',
          title: 'Expense Recorded',
          description: `Expense of ${formatCurrency(
            amt,
            settings.currencySymbol
          )} logged under ${getCategoryLabel(category)}.`,
        });
        setIsModalOpen(false);
      } else {
        setFormError(res.error || 'Failed to record expense.');
      }
    }
  };

  const handleDeleteExpense = () => {
    if (!deletingExpense || !currentUser) return;

    const res = ExpenseService.deleteExpense(deletingExpense.id, currentUser);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Expense Deleted',
        description: `Expense "${deletingExpense.title}" has been deleted.`,
      });
    } else {
      addToast({
        type: 'error',
        title: 'Delete Failed',
        description: res.error || 'Could not delete expense.',
      });
    }
    setDeletingExpense(null);
  };

  // Category management functions
  const handleCreateCategory = () => {
    setCategoryError('');

    if (!newCategoryName.trim()) {
      setCategoryError('Category name is required.');
      return;
    }

    const cleanName = newCategoryName.trim();
    const categoryId = `CUSTOM_${cleanName.toUpperCase().replace(/\s+/g, '_')}`;

    const exists = allCategories.some(
      c =>
        c.id.toLowerCase() === categoryId.toLowerCase() ||
        c.label.toLowerCase() === cleanName.toLowerCase()
    );

    if (exists) {
      setCategoryError('A category with this name already exists.');
      return;
    }

    const newCat: CustomCategory = {
      id: categoryId,
      label: cleanName,
      isCustom: true,
    };

    saveCustomCategories([...customCategories, newCat]);
    setNewCategoryName('');
    addToast({
      type: 'success',
      title: 'Category Created',
      description: `Custom category "${cleanName}" added.`,
    });
  };

  const handleEditCategory = (cat: CustomCategory) => {
    setEditingCategory(cat);
    setNewCategoryName(cat.label);
    setCategoryError('');
    setIsCategoryModalOpen(true);
  };

  const handleSaveEditedCategory = () => {
    if (!editingCategory) return;

    if (!newCategoryName.trim()) {
      setCategoryError('Category name is required.');
      return;
    }

    const cleanName = newCategoryName.trim();
    const updatedCats = customCategories.map(c =>
      c.id === editingCategory.id ? { ...c, label: cleanName } : c
    );

    saveCustomCategories(updatedCats);
    setEditingCategory(null);
    setNewCategoryName('');
    setCategoryError('');
    addToast({
      type: 'success',
      title: 'Category Updated',
      description: `Category renamed to "${cleanName}".`,
    });
  };

  const handleDeleteCategory = () => {
    if (!deletingCategory) return;

    const updatedCats = customCategories.filter(c => c.id !== deletingCategory.id);
    saveCustomCategories(updatedCats);

    if (categoryFilter === deletingCategory.id) {
      setCategoryFilter('ALL');
    }
    if (category === deletingCategory.id) {
      setCategory('ELECTRICITY');
    }

    addToast({
      type: 'success',
      title: 'Category Deleted',
      description: `Category "${deletingCategory.label}" removed.`,
    });
    setDeletingCategory(null);
  };

  const handleOpenCategoryModal = () => {
    setEditingCategory(null);
    setNewCategoryName('');
    setCategoryError('');
    setIsCategoryModalOpen(true);
  };

  const getPeriodLabel = () => {
    switch (periodFilter) {
      case 'today':
        return 'Today';
      case 'week':
        return 'Last 7 Days';
      case 'month':
        return 'This Month';
      case 'year':
        return 'This Year';
      case 'custom':
        return 'Custom Range';
      case 'all':
        return 'All Time';
      default:
        return 'Today';
    }
  };

  return (
    <div id="admin-expenses-view" className="flex-1 p-6 bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Operating Expenses</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Log overhead operating costs, utility bills, salaries, and maintenance for P&L tracking
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={handleOpenCategoryModal}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition"
            >
              <FolderPlus className="w-4 h-4" />
              <span>Manage Categories</span>
            </button>
          )}

          {canRecordExpense && (
            <button
              id="record-expense-btn"
              onClick={openAddModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>Record Expense</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">
              Total Spend ({getPeriodLabel()})
            </span>
            <TrendingDown className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-rose-300 font-mono">
            {formatCurrency(totalSpent, settings.currencySymbol)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {expenses.length} expense transactions
          </p>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">
              Top Spend Category
            </span>
            <PieChart className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-lg font-bold text-white truncate">{topCategory}</div>
          <p className="text-[11px] text-slate-400 mt-1">For selected period</p>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Categories</span>
            <Tag className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-lg font-bold text-amber-300">{allCategories.length}</div>
          <p className="text-[11px] text-slate-400 mt-1">
            {customCategories.length} custom + {DEFAULT_EXPENSE_CATEGORIES.length} default
          </p>
        </div>
      </div>

      {/* Period Filter Tabs */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 mb-5 space-y-3 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {[
              { id: 'today', label: 'Today' },
              { id: 'week', label: 'This Week' },
              { id: 'month', label: 'This Month' },
              { id: 'year', label: 'This Year' },
              { id: 'all', label: 'All Time' },
              { id: 'custom', label: 'Custom' },
            ].map(p => (
              <button
                key={p.id}
                onClick={() => setPeriodFilter(p.id as PeriodFilter)}
                className={`px-3 py-1.5 rounded-lg transition font-semibold ${
                  periodFilter === p.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {periodFilter === 'custom' && (
          <div className="flex items-center gap-3 pt-2 border-t border-slate-800/80">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-slate-400">From:</span>
            <input
              type="date"
              value={customStartDate}
              onChange={e => setCustomStartDate(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
            />
            <span className="text-slate-500">to</span>
            <input
              type="date"
              value={customEndDate}
              onChange={e => setCustomEndDate(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
            />
            {(customStartDate || customEndDate) && (
              <button
                onClick={() => {
                  setCustomStartDate('');
                  setCustomEndDate('');
                }}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
              >
                Clear
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800/80">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search expenses, reference #, notes..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="ALL">All Categories ({allCategories.length})</option>
            {DEFAULT_EXPENSE_CATEGORIES.map(c => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            {customCategories.length > 0 && (
              <optgroup label="Custom Categories">
                {customCategories.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          {(periodFilter !== 'today' || searchQuery || categoryFilter !== 'ALL') && (
            <button
              onClick={() => {
                setPeriodFilter('today');
                setSearchQuery('');
                setCategoryFilter('ALL');
                setCustomStartDate('');
                setCustomEndDate('');
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Expenses Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                <th className="py-3 px-4 font-semibold">Date</th>
                <th className="py-3 px-4 font-semibold">Expense Title</th>
                <th className="py-3 px-4 font-semibold">Category</th>
                <th className="py-3 px-4 font-semibold">Payment Method</th>
                <th className="py-3 px-4 font-semibold">Reference</th>
                <th className="py-3 px-4 font-semibold">Recorded By</th>
                <th className="py-3 px-4 text-right font-semibold">Amount</th>
                {isAdmin && (
                  <th className="py-3 px-4 text-right font-semibold">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} className="py-10 text-center text-slate-500">
                    <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p>No expense records match your filter.</p>
                  </td>
                </tr>
              ) : (
                expenses.map(expense => (
                  <tr key={expense.id} className="hover:bg-slate-850/60 transition">
                    <td className="py-3.5 px-4 text-slate-400 font-mono">
                      {formatDateTime(expense.createdAt)}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">
                      {expense.title || expense.description}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-medium border border-slate-700/60">
                        {getCategoryLabel(expense.category)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] uppercase font-medium">
                        {expense.paymentMethod}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-400">
                      {expense.reference || '—'}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">{expense.createdByName}</td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-rose-400 text-sm">
                      {formatCurrency(expense.amount, settings.currencySymbol)}
                    </td>
                    {isAdmin && (
                      <td className="py-3.5 px-4 text-right space-x-1.5">
                        <button
                          onClick={() => openEditModal(expense)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white transition"
                          title="Edit expense"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeletingExpense(expense)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white transition"
                          title="Delete expense"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Record/Edit Expense */}
      {isModalOpen && canRecordExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">
                  {editingExpense ? 'Edit Expense' : 'Record Operating Expense'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingExpense(null);
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveExpense} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Expense Description *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Electricity Bill - July 2026"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Category</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {DEFAULT_EXPENSE_CATEGORIES.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                    {customCategories.length > 0 && (
                      <optgroup label="Custom Categories">
                        {customCategories.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Amount Spent *</label>
                  <input
                    type="text"
                    required
                    value={amount}
                    onChange={e => setAmount(formatPriceInput(e.target.value))}
                    placeholder="0"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank Transfer / Check</option>
                    <option value="CARD">Debit / Credit Card</option>
                    <option value="MOBILE_MONEY">Mobile Money</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Receipt / Invoice #</label>
                  <input
                    type="text"
                    value={reference}
                    onChange={e => setReference(e.target.value)}
                    placeholder="e.g. UTL-9912"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Notes (Optional)</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Additional context or account reference..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingExpense(null);
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow transition flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  {editingExpense ? 'Save Changes' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Manage Categories */}
      {isCategoryModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Manage Expense Categories</h3>
              </div>
              <button
                onClick={() => {
                  setIsCategoryModalOpen(false);
                  setEditingCategory(null);
                  setNewCategoryName('');
                  setCategoryError('');
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4 p-3 rounded-lg bg-slate-950 border border-slate-800">
              <label className="block text-slate-300 font-medium mb-1.5 text-xs">
                {editingCategory ? 'Edit Category Name' : 'Create New Category'}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  placeholder="e.g. Water Bills, Repairs..."
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <button
                  onClick={editingCategory ? handleSaveEditedCategory : handleCreateCategory}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition flex items-center gap-1"
                >
                  {editingCategory ? (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      Save
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      Add
                    </>
                  )}
                </button>
                {editingCategory && (
                  <button
                    onClick={() => {
                      setEditingCategory(null);
                      setNewCategoryName('');
                      setCategoryError('');
                    }}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                  >
                    Cancel
                  </button>
                )}
              </div>
              {categoryError && (
                <p className="text-rose-400 text-[11px] mt-1.5">{categoryError}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Custom Categories ({customCategories.length})
              </div>
              {customCategories.length === 0 ? (
                <div className="p-4 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-lg">
                  No custom categories yet. Create one above.
                </div>
              ) : (
                customCategories.map(cat => (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800"
                  >
                    <div className="flex items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs text-white font-medium">{cat.label}</span>
                      <span className="text-[10px] text-slate-500 font-mono">{cat.id}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEditCategory(cat)}
                        className="p-1.5 rounded hover:bg-blue-600 text-slate-400 hover:text-white transition"
                        title="Edit category"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setDeletingCategory(cat)}
                        className="p-1.5 rounded hover:bg-rose-600 text-slate-400 hover:text-white transition"
                        title="Delete category"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 space-y-2">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Default Categories ({DEFAULT_EXPENSE_CATEGORIES.length}) — Read Only
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {DEFAULT_EXPENSE_CATEGORIES.map(cat => (
                  <div
                    key={cat.id}
                    className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/60 text-[11px] text-slate-400"
                  >
                    {cat.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Expense Confirmation */}
      {deletingExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-3 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-base font-bold text-white">Delete Expense?</h3>
            </div>
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-200 text-xs mb-4">
              <strong>Warning:</strong> This action cannot be undone.
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Delete expense <strong className="text-white">"{deletingExpense.title}"</strong> of{' '}
              <strong className="text-white">
                {formatCurrency(deletingExpense.amount, settings.currencySymbol)}
              </strong>
              ?
            </p>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setDeletingExpense(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteExpense}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
              >
                Delete Expense
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Category Confirmation */}
      {deletingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-3 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-base font-bold text-white">Delete Category?</h3>
            </div>
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-200 text-xs mb-4">
              <strong>Warning:</strong> This only removes the category option. Existing expenses will
              keep their category label.
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Delete category <strong className="text-white">"{deletingCategory.label}"</strong>?
            </p>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setDeletingCategory(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteCategory}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
              >
                Delete Category
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
