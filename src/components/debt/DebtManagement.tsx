import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { DebtService } from '../../services/debtService';
import { DebtRecord, DebtType, DebtStatus, DebtPayment } from '../../types';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters';
import { formatPriceInput, parsePriceInput } from '../../utils/priceInput';
import {
  DollarSign,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Calendar,
  Phone,
  Edit2,
  Trash2,
  Filter,
  FileText,
  User,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  Sparkles,
  Info,
  History,
  Receipt,
  CreditCard,
  Check,
  ChevronDown,
  Loader2,
  Archive,
  CircleDot,
} from 'lucide-react';

const PAGE_SIZE = 10;

export const DebtManagement: React.FC = () => {
  const { currentUser, dbState, addToast } = useApp();
  const settings = dbState.settings;

  // Active type filter: 'ALL' | 'WE_DEMAND' | 'THEY_DEMAND'
  const [activeTypeTab, setActiveTypeTab] = useState<'ALL' | DebtType>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Pagination — separate counters for ACTIVE and COMPLETED
  const [activeVisible, setActiveVisible] = useState(PAGE_SIZE);
  const [completedVisible, setCompletedVisible] = useState(PAGE_SIZE);
  const [loadingActive, setLoadingActive] = useState(false);
  const [loadingCompleted, setLoadingCompleted] = useState(false);

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<DebtRecord | null>(null);
  const [payingDebt, setPayingDebt] = useState<DebtRecord | null>(null);
  const [viewingHistoryDebt, setViewingHistoryDebt] = useState<DebtRecord | null>(null);
  const [deletingDebt, setDeletingDebt] = useState<DebtRecord | null>(null);

  // Form State (Create / Edit)
  const [formType, setFormType] = useState<DebtType>('WE_DEMAND');
  const [formName, setFormName] = useState('');
  const [formProduct, setFormProduct] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formContact, setFormContact] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Payment Form State
  const [paymentAmountInput, setPaymentAmountInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('CASH');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));

  // Compute live debts (FILTERED BY USER)
  const debts = useMemo(() => {
    return DebtService.getAllDebts(currentUser);
  }, [dbState.debts, currentUser]);

  // Compute summary metrics (FILTERED BY USER)
  const summary = useMemo(() => {
    return DebtService.getSummary(currentUser);
  }, [dbState.debts, currentUser]);

  // ─────────────────────────────────────────────────────────────
  // 1) FILTER (type, status, search, date) — UNCHANGED behavior
  // ─────────────────────────────────────────────────────────────
  const filteredDebts = useMemo(() => {
    return debts.filter(d => {
      if (activeTypeTab !== 'ALL' && d.type !== activeTypeTab) return false;
      if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;

      if (startDate) {
        const compareDate = (d.dueDate || d.createdAt).slice(0, 10);
        if (compareDate < startDate) return false;
      }
      if (endDate) {
        const compareDate = (d.dueDate || d.createdAt).slice(0, 10);
        if (compareDate > endDate) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nameMatch = d.debtorName.toLowerCase().includes(q);
        const prodMatch = (d.productDescription || '').toLowerCase().includes(q);
        const contactMatch = (d.contact || '').toLowerCase().includes(q);
        const notesMatch = (d.notes || '').toLowerCase().includes(q);
        if (!nameMatch && !prodMatch && !contactMatch && !notesMatch) return false;
      }

      return true;
    });
  }, [debts, activeTypeTab, statusFilter, startDate, endDate, searchQuery]);

  // ─────────────────────────────────────────────────────────────
  // 2) SPLIT — Active vs Completed
  //    Active = everything NOT fully paid (PENDING, DUE_TODAY, OVERDUE, PARTIALLY_PAID)
  //    Completed = PAID (and also CANCELLED/ARCHIVED, so they don't clutter Active)
  // ─────────────────────────────────────────────────────────────
  const activeDebts = useMemo(() => {
    return filteredDebts
      .filter(d => d.status !== 'PAID' && d.status !== 'CANCELLED' && d.status !== 'ARCHIVED')
      .sort((a, b) => {
        // Overdue first, then due today, then partially paid, then pending
        const order: Record<string, number> = {
          OVERDUE: 0,
          DUE_TODAY: 1,
          PARTIALLY_PAID: 2,
          PENDING: 3,
        };
        const oa = order[a.status] ?? 99;
        const ob = order[b.status] ?? 99;
        if (oa !== ob) return oa - ob;
        // Within same status: newest first
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [filteredDebts]);

  const completedDebts = useMemo(() => {
    return filteredDebts
      .filter(d => d.status === 'PAID' || d.status === 'CANCELLED' || d.status === 'ARCHIVED')
      .sort((a, b) => {
        // Newest completed first
        return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
      });
  }, [filteredDebts]);

  // Reset pagination when filters change
  useEffect(() => {
    setActiveVisible(PAGE_SIZE);
    setCompletedVisible(PAGE_SIZE);
  }, [activeTypeTab, statusFilter, searchQuery, startDate, endDate]);

  // Visible slices
  const visibleActive = activeDebts.slice(0, activeVisible);
  const visibleCompleted = completedDebts.slice(0, completedVisible);

  const hasMoreActive = activeDebts.length > activeVisible;
  const hasMoreCompleted = completedDebts.length > completedVisible;
  const remainingActive = activeDebts.length - activeVisible;
  const remainingCompleted = completedDebts.length - completedVisible;

  const handleSeeMoreActive = () => {
    setLoadingActive(true);
    setTimeout(() => {
      setActiveVisible(prev => prev + PAGE_SIZE);
      setLoadingActive(false);
    }, 300);
  };

  const handleSeeMoreCompleted = () => {
    setLoadingCompleted(true);
    setTimeout(() => {
      setCompletedVisible(prev => prev + PAGE_SIZE);
      setLoadingCompleted(false);
    }, 300);
  };

  const handleSeeLessActive = () => setActiveVisible(PAGE_SIZE);
  const handleSeeLessCompleted = () => setCompletedVisible(PAGE_SIZE);

  // Open Create Modal
  const openCreateModal = (type: DebtType = 'WE_DEMAND') => {
    setEditingDebt(null);
    setFormType(type);
    setFormName('');
    setFormProduct('');
    setFormAmount('');
    setFormDueDate('');
    setFormContact('');
    setFormNotes('');
    setIsCreateModalOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (debt: DebtRecord) => {
    setEditingDebt(debt);
    setFormType(debt.type);
    setFormName(debt.debtorName);
    setFormProduct(debt.productDescription || '');
    setFormAmount(formatPriceInput(debt.amount.toString()));
    setFormDueDate(debt.dueDate ? debt.dueDate.slice(0, 10) : '');
    setFormContact(debt.contact || '');
    setFormNotes(debt.notes || '');
    setIsCreateModalOpen(true);
  };

  // Open Payment Modal
  const openPaymentModal = (debt: DebtRecord) => {
    setPayingDebt(debt);
    const remaining = debt.remainingAmount !== undefined ? debt.remainingAmount : (debt.status === 'PAID' ? 0 : debt.amount);
    setPaymentAmountInput(remaining > 0 ? remaining.toString() : debt.amount.toString());
    setPaymentMethod('CASH');
    setPaymentNote('');
    setPaymentDate(new Date().toISOString().slice(0, 10));
  };

  // Handle Form Submit (Create / Edit)
  const handleSaveDebt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    if (!formName.trim()) {
      addToast({ type: 'error', title: 'Tafadhali weka jina / Name is required' });
      return;
    }

    const amt = parsePriceInput(formAmount);
    if (isNaN(amt) || amt <= 0) {
      addToast({ type: 'error', title: 'Weka kiasi sahihi / Enter a valid amount' });
      return;
    }

    if (editingDebt) {
      const currentPaid = editingDebt.paidAmount || 0;
      const newRemaining = Math.max(0, amt - currentPaid);

      DebtService.updateDebt(
        editingDebt.id,
        {
          type: formType,
          debtorName: formName.trim(),
          productDescription: formProduct.trim() || undefined,
          amount: amt,
          paidAmount: currentPaid,
          remainingAmount: newRemaining,
          dueDate: formDueDate ? formDueDate : undefined,
          contact: formContact.trim() || undefined,
          notes: formNotes.trim() || undefined,
          status:
            newRemaining <= 0
              ? 'PAID'
              : currentPaid > 0
              ? 'PARTIALLY_PAID'
              : DebtService.calculateStatus({
                  ...editingDebt,
                  amount: amt,
                  paidAmount: currentPaid,
                  remainingAmount: newRemaining,
                  dueDate: formDueDate,
                }),
        },
        currentUser
      );

      addToast({
        type: 'success',
        title: 'Deni Limesasishwa / Debt Updated',
        description: `Rekodi ya ${formName} imesasishwa kwa mafanikio.`,
      });
    } else {
      DebtService.createDebt(
        {
          type: formType,
          debtorName: formName.trim(),
          productDescription: formProduct.trim() || undefined,
          amount: amt,
          dueDate: formDueDate ? formDueDate : undefined,
          contact: formContact.trim() || undefined,
          notes: formNotes.trim() || undefined,
        },
        currentUser
      );

      addToast({
        type: 'success',
        title:
          formType === 'WE_DEMAND'
            ? 'Deni la Mteja Limehifadhiwa'
            : 'Deni la Kampuni Limehifadhiwa',
        description: `Rekodi ya ${formName} (${formatCurrency(amt, settings.currencySymbol)}) imehifadhiwa.`,
      });
    }

    setIsCreateModalOpen(false);
    setEditingDebt(null);
  };

  // Handle Recording Payment
  const handleConfirmPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingDebt || !currentUser) return;

    const paymentAmt = parsePriceInput(paymentAmountInput);
    if (isNaN(paymentAmt) || paymentAmt <= 0) {
      addToast({
        type: 'error',
        title: 'Kiasi Batili',
        description: 'Tafadhali weka kiasi halali cha malipo.',
      });
      return;
    }

    const currentRemaining =
      payingDebt.remainingAmount !== undefined
        ? payingDebt.remainingAmount
        : payingDebt.amount - (payingDebt.paidAmount || 0);

    if (paymentAmt > currentRemaining && currentRemaining > 0) {
      addToast({
        type: 'error',
        title: 'Kiasi Kimezidi Salio',
        description: `Kiasi ulichoweka (${formatCurrency(
          paymentAmt,
          settings.currencySymbol
        )}) kinazidi salio lililobaki (${formatCurrency(
          currentRemaining,
          settings.currencySymbol
        )}).`,
      });
      return;
    }

    const res = DebtService.recordPayment(payingDebt.id, paymentAmt, currentUser, {
      paymentDate,
      paymentMethod,
      notes: paymentNote,
    });

    if (res.success && res.debt) {
      const remainingAfter = res.debt.remainingAmount ?? 0;
      const isComplete = remainingAfter <= 0;

      addToast({
        type: 'success',
        title: isComplete ? 'Malipo Yamekamilika! 🎉' : 'Malipo ya Awamu Yamepokelewa',
        description: isComplete
          ? `Deni la ${payingDebt.debtorName} limelipwa kikamilifu (${formatCurrency(
              payingDebt.amount,
              settings.currencySymbol
            )}).`
          : `Imelipwa ${formatCurrency(paymentAmt, settings.currencySymbol)}. Baki iliyobaki: ${formatCurrency(
              remainingAfter,
              settings.currencySymbol
            )}.`,
      });

      setPayingDebt(null);
      setPaymentAmountInput('');
      setPaymentNote('');
    } else {
      addToast({
        type: 'error',
        title: 'Hitilafu ya Malipo',
        description: res.error || 'Imeshindikana kurekodi malipo.',
      });
    }
  };

  // Handle Delete - Admin only
  const handleConfirmDelete = () => {
    if (!deletingDebt || !currentUser) return;

    if (currentUser.role !== 'ADMIN') {
      addToast({
        type: 'error',
        title: 'Imeshindikana Kufuta',
        description: 'Ni Admin pekee anaweza kufuta rekodi za madeni.',
      });
      setDeletingDebt(null);
      return;
    }

    const result = DebtService.deleteDebt(deletingDebt.id, currentUser);

    if (result) {
      addToast({
        type: 'success',
        title: 'Deni Limefutwa',
        description: `Rekodi ya ${deletingDebt.debtorName} imefutwa kwa mafanikio.`,
      });
    } else {
      addToast({
        type: 'error',
        title: 'Imeshindikana Kufuta',
        description: 'Rekodi ya deni haikupatikana au imeshindikana kufutwa.',
      });
    }

    setDeletingDebt(null);
  };

  // ─────────────────────────────────────────────────────────────
  // ROW RENDERER (shared for active + completed)
  // ─────────────────────────────────────────────────────────────
  const renderDebtRow = (debt: DebtRecord) => {
    const isPaid = debt.status === 'PAID';
    const isPartiallyPaid = debt.status === 'PARTIALLY_PAID';
    const isOverdue = debt.status === 'OVERDUE';
    const isDueToday = debt.status === 'DUE_TODAY';
    const overdueDays = isOverdue ? DebtService.getOverdueDays(debt.dueDate) : 0;
    const paidAmount = debt.paidAmount || (isPaid ? debt.amount : 0);
    const remainingAmount =
      debt.remainingAmount !== undefined
        ? debt.remainingAmount
        : isPaid
        ? 0
        : Math.max(0, debt.amount - paidAmount);
    const paymentsCount = debt.payments?.length || (paidAmount > 0 ? 1 : 0);
    const isAdmin = currentUser?.role === 'ADMIN';

    return (
      <tr
        key={debt.id}
        className={`hover:bg-slate-850/60 transition ${
          isOverdue && !isPaid ? 'bg-rose-950/10' : ''
        }`}
      >
        {/* Type */}
        <td className="py-3.5 px-4 whitespace-nowrap">
          {debt.type === 'WE_DEMAND' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
              <ArrowDownLeft className="w-3 h-3" /> Tunadai
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-semibold">
              <ArrowUpRight className="w-3 h-3" /> Wanatudai
            </span>
          )}
        </td>

        {/* Debtor Name */}
        <td className="py-3.5 px-4 font-semibold text-white">
          <div className="flex items-center gap-1.5">
            <span>{debt.debtorName}</span>
          </div>
          {debt.contact && (
            <div className="flex items-center gap-1 font-mono text-[11px] text-slate-400 font-normal mt-0.5">
              <Phone className="w-3 h-3 text-slate-500" />
              <span>{debt.contact}</span>
            </div>
          )}
        </td>

        {/* Product / Description */}
        <td className="py-3.5 px-4 text-slate-300">
          <div className="font-medium max-w-xs truncate">
            {debt.productDescription || '—'}
          </div>
          {debt.notes && (
            <div className="text-[10px] text-slate-500 truncate max-w-xs">{debt.notes}</div>
          )}
        </td>

        {/* Total */}
        <td className="py-3.5 px-4 font-mono font-semibold text-slate-300 whitespace-nowrap">
          {formatCurrency(debt.amount, settings.currencySymbol)}
        </td>

        {/* Paid */}
        <td className="py-3.5 px-4 font-mono whitespace-nowrap">
          <span className={paidAmount > 0 ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
            {formatCurrency(paidAmount, settings.currencySymbol)}
          </span>
          {paymentsCount > 1 && (
            <button
              onClick={() => setViewingHistoryDebt(debt)}
              className="block text-[10px] text-blue-400 hover:underline mt-0.5 font-sans"
            >
              ({paymentsCount} awamu)
            </button>
          )}
        </td>

        {/* Remaining */}
        <td className="py-3.5 px-4 font-mono font-bold text-sm whitespace-nowrap">
          {remainingAmount <= 0 ? (
            <span className="text-emerald-400 text-xs flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> 0 (Hakuna Deni)
            </span>
          ) : (
            <span
              className={
                debt.type === 'WE_DEMAND'
                  ? 'text-emerald-300 font-extrabold'
                  : 'text-amber-300 font-extrabold'
              }
            >
              {formatCurrency(remainingAmount, settings.currencySymbol)}
            </span>
          )}
        </td>

        {/* Due Date */}
        <td className="py-3.5 px-4 whitespace-nowrap">
          {debt.dueDate ? (
            <div>
              <div className="font-mono text-slate-300">{formatDate(debt.dueDate)}</div>
              {isOverdue && !isPaid && (
                <div className="text-[10px] font-semibold text-rose-400 flex items-center gap-1 mt-0.5">
                  <AlertTriangle className="w-3 h-3" /> Zimepita siku {overdueDays}
                </div>
              )}
              {isDueToday && !isPaid && (
                <div className="text-[10px] font-semibold text-amber-400 flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3" /> Inatakiwa leo
                </div>
              )}
            </div>
          ) : (
            <span className="text-slate-500">Haina tarehe</span>
          )}
        </td>

        {/* Status */}
        <td className="py-3.5 px-4 whitespace-nowrap">
          {isPaid ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 text-[10px] font-bold">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Imelipwa Kamili
            </span>
          ) : isPartiallyPaid ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-950/80 text-blue-300 border border-blue-700/80 text-[10px] font-bold">
              <Clock className="w-3 h-3 text-blue-400" /> Imelipwa Sehemu
            </span>
          ) : isOverdue ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-950/80 text-rose-300 border border-rose-800 text-[10px] font-semibold">
              <AlertTriangle className="w-3 h-3" /> Imechelewa
            </span>
          ) : isDueToday ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-800 text-[10px] font-semibold">
              <Clock className="w-3 h-3" /> Inatakiwa Leo
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-semibold">
              Inasubiri (Pending)
            </span>
          )}
        </td>

        {/* Actions */}
        <td className="py-3.5 px-4 text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-1.5">
            {!isPaid && (
              <button
                onClick={() => openPaymentModal(debt)}
                className={`px-2.5 py-1.5 rounded text-white font-bold text-xs flex items-center gap-1 shadow-sm transition ${
                  debt.type === 'WE_DEMAND'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-amber-600 hover:bg-amber-500'
                }`}
                title="Weka malipo ya deni hili"
              >
                <DollarSign className="w-3.5 h-3.5" />
                <span>Lipa</span>
              </button>
            )}

            {debt.payments && debt.payments.length > 0 && (
              <button
                onClick={() => setViewingHistoryDebt(debt)}
                className="p-1.5 rounded hover:bg-slate-800 text-blue-400 hover:text-blue-300 transition"
                title="Angalia Historia ya Malipo"
              >
                <History className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => openEditModal(debt)}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition"
              title="Hariri rekodi"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>

            {isAdmin && (
              <button
                onClick={() => setDeletingDebt(debt)}
                className="p-1.5 rounded hover:bg-rose-900/40 text-slate-400 hover:text-rose-400 transition"
                title="Futa rekodi (Admin only)"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // TABLE HEADER (shared)
  // ─────────────────────────────────────────────────────────────
  const renderTableHead = () => (
    <thead>
      <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
        <th className="py-3 px-4">Aina</th>
        <th className="py-3 px-4">Mteja / Mtoa Huduma</th>
        <th className="py-3 px-4">Bidhaa / Maelezo</th>
        <th className="py-3 px-4">Jumla ya Deni</th>
        <th className="py-3 px-4">Kiasi Kilicholipwa</th>
        <th className="py-3 px-4">Salio Lililobaki (Remained)</th>
        <th className="py-3 px-4">Tarehe ya Kulipa</th>
        <th className="py-3 px-4">Hali (Status)</th>
        <th className="py-3 px-4 text-right">Vitendo (Actions)</th>
      </tr>
    </thead>
  );

  return (
    <div
      id="debt-management-page"
      className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100"
    >
      {/* Top Header */}
      <header className="p-4 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white flex items-center gap-2">
                Usimamizi wa Madeni (Debt Ledger)
                <span className="text-xs font-normal text-slate-400">
                  / Partial & Full Settlements
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Daftari huru la kurekodi wanaotudai (Tunadai) na tunaowadai (Wanatudai)
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => openCreateModal('WE_DEMAND')}
            className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>+ Tunadai (Wateja)</span>
          </button>
          <button
            onClick={() => openCreateModal('THEY_DEMAND')}
            className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>+ Wanatudai (Watoa Huduma)</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* SUMMARY KPI CARDS (unchanged) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* WE DEMAND */}
          <div className="bg-slate-900/80 border border-emerald-500/30 rounded-xl p-4 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <ArrowDownLeft className="w-4 h-4" />
                <span>Tunadai / We Demand</span>
                <span className="text-[11px] font-normal text-slate-400">
                  (Wateja wanaotudai pesa)
                </span>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-mono font-bold">
                {summary.weDemand.totalCount} Rekodi
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5">
                <div className="text-[10px] text-slate-400 font-medium uppercase">
                  Kiasi Kinachodaiwa
                </div>
                <div className="text-sm sm:text-base font-bold font-mono text-emerald-400 mt-0.5">
                  {formatCurrency(summary.weDemand.totalOutstanding, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Salio lililobaki</div>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5">
                <div className="text-[10px] text-amber-400 font-medium uppercase flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Kulipwa Leo
                </div>
                <div className="text-sm sm:text-base font-bold font-mono text-amber-300 mt-0.5">
                  {formatCurrency(summary.weDemand.dueTodayAmount, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {summary.weDemand.dueTodayCount} wateja
                </div>
              </div>

              <div className="bg-slate-950/80 border border-rose-900/40 rounded-lg p-2.5 bg-rose-950/10">
                <div className="text-[10px] text-rose-400 font-medium uppercase flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Zimechelewa
                </div>
                <div className="text-sm sm:text-base font-bold font-mono text-rose-400 mt-0.5">
                  {formatCurrency(summary.weDemand.overdueAmount, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-rose-300/70 mt-0.5">
                  {summary.weDemand.overdueCount} zimepitiliza
                </div>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5">
                <div className="text-[10px] text-slate-400 font-medium uppercase flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Zimelipwa
                </div>
                <div className="text-sm sm:text-base font-bold font-mono text-slate-300 mt-0.5">
                  {formatCurrency(summary.weDemand.paidAmount, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {summary.weDemand.paidCount} zimekamilika
                </div>
              </div>
            </div>
          </div>

          {/* THEY DEMAND */}
          <div className="bg-slate-900/80 border border-amber-500/30 rounded-xl p-4 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <ArrowUpRight className="w-4 h-4" />
                <span>Wanatudai / They Demand Us</span>
                <span className="text-[11px] font-normal text-slate-400">
                  (Watoa huduma tunaowadai pesa)
                </span>
              </div>
              <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-mono font-bold">
                {summary.theyDemand.totalCount} Rekodi
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5">
                <div className="text-[10px] text-slate-400 font-medium uppercase">
                  Kiasi Wanachotudai
                </div>
                <div className="text-sm sm:text-base font-bold font-mono text-amber-400 mt-0.5">
                  {formatCurrency(summary.theyDemand.totalOutstanding, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Madeni yetu</div>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5">
                <div className="text-[10px] text-amber-400 font-medium uppercase flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Kulipa Leo
                </div>
                <div className="text-sm sm:text-base font-bold font-mono text-amber-300 mt-0.5">
                  {formatCurrency(summary.theyDemand.dueTodayAmount, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {summary.theyDemand.dueTodayCount} watoa huduma
                </div>
              </div>

              <div className="bg-slate-950/80 border border-rose-900/40 rounded-lg p-2.5 bg-rose-950/10">
                <div className="text-[10px] text-rose-400 font-medium uppercase flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Zimechelewa
                </div>
                <div className="text-sm sm:text-base font-bold font-mono text-rose-400 mt-0.5">
                  {formatCurrency(summary.theyDemand.overdueAmount, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-rose-300/70 mt-0.5">
                  {summary.theyDemand.overdueCount} zimepitiliza
                </div>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5">
                <div className="text-[10px] text-slate-400 font-medium uppercase flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Tumeshalipa
                </div>
                <div className="text-sm sm:text-base font-bold font-mono text-slate-300 mt-0.5">
                  {formatCurrency(summary.theyDemand.paidAmount, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {summary.theyDemand.paidCount} zimekamilika
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CONTROLS & FILTER BAR (unchanged) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800 text-xs">
              <button
                onClick={() => setActiveTypeTab('ALL')}
                className={`px-3 py-1.5 rounded-md font-medium transition ${
                  activeTypeTab === 'ALL'
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Madeni Yote ({debts.length})
              </button>
              <button
                onClick={() => setActiveTypeTab('WE_DEMAND')}
                className={`px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition ${
                  activeTypeTab === 'WE_DEMAND'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-emerald-400 hover:bg-slate-900'
                }`}
              >
                <ArrowDownLeft className="w-3.5 h-3.5" />
                Tunadai ({summary.weDemand.totalCount})
              </button>
              <button
                onClick={() => setActiveTypeTab('THEY_DEMAND')}
                className={`px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition ${
                  activeTypeTab === 'THEY_DEMAND'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-amber-400 hover:bg-slate-900'
                }`}
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                Wanatudai ({summary.theyDemand.totalCount})
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" /> Hali:
              </span>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-slate-950 text-xs text-white px-2.5 py-1.5 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">Hali Zote (All Statuses)</option>
                <option value="PENDING">Inasubiri (Pending)</option>
                <option value="PARTIALLY_PAID">Imelipwa Sehemu (Partially Paid)</option>
                <option value="DUE_TODAY">Inatakiwa Leo (Due Today)</option>
                <option value="OVERDUE">Imechelewa (Overdue)</option>
                <option value="PAID">Imelipwa Kamili (Fully Paid)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Tafuta jina, bidhaa, simu, maelezo..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 text-xs text-white pl-9 pr-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 whitespace-nowrap">Kuanzia:</span>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full bg-slate-950 text-xs text-white px-2.5 py-1.5 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 whitespace-nowrap">Mpaka:</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full bg-slate-950 text-xs text-white px-2.5 py-1.5 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                  }}
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                  title="Ondoa tarehe"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════
            ACTIVE DEBTS SECTION (unpaid / partially paid / overdue / due today)
        ═══════════════════════════════════════════════════════ */}
        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-md bg-amber-500/10 border border-amber-500/20">
                <CircleDot className="w-4 h-4 text-amber-400" />
              </div>
              <h2 className="text-sm font-bold text-white">
                Madeni Yanayoendelea (Active Debts)
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                {activeDebts.length}
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              Yaliyochelewa, yanayotakiwa leo, na yenye malipo ya awamu
            </span>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                {renderTableHead()}
                <tbody className="divide-y divide-slate-800/60">
                  {activeDebts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-slate-500">
                        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30 text-emerald-500" />
                        <div className="font-medium text-slate-400">
                          Hakuna madeni yanayoendelea 🎉
                        </div>
                        <div className="text-[11px] text-slate-600 mt-0.5">
                          Madeni yote yamekamilika kulingana na vichujio vilivyowekwa.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    visibleActive.map(renderDebtRow)
                  )}
                </tbody>
              </table>
            </div>

            {/* Active pagination footer */}
            {activeDebts.length > PAGE_SIZE && (
              <div className="px-5 py-3 border-t border-slate-800/60 bg-slate-950/30 flex items-center justify-between gap-3">
                <div className="text-[11px] text-slate-500">
                  Showing{' '}
                  <span className="text-slate-300 font-semibold">
                    {Math.min(activeVisible, activeDebts.length)}
                  </span>{' '}
                  of{' '}
                  <span className="text-slate-300 font-semibold">{activeDebts.length}</span>{' '}
                  active debts
                </div>
                <div className="flex items-center gap-2">
                  {activeVisible > PAGE_SIZE && (
                    <button
                      onClick={handleSeeLessActive}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                    >
                      Show Less
                    </button>
                  )}
                  {hasMoreActive && (
                    <button
                      onClick={handleSeeMoreActive}
                      disabled={loadingActive}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white text-xs font-semibold shadow transition disabled:opacity-60 disabled:cursor-wait"
                    >
                      {loadingActive ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Loading...</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span>
                            See More ({Math.min(PAGE_SIZE, remainingActive)} of {remainingActive})
                          </span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════
            COMPLETED DEBTS SECTION (fully paid / cancelled / archived)
        ═══════════════════════════════════════════════════════ */}
        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                <Archive className="w-4 h-4 text-emerald-400" />
              </div>
              <h2 className="text-sm font-bold text-white">
                Madeni Yaliyokamilika (All Completed)
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                {completedDebts.length}
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              Yaliyolipwa kikamilifu au yaliyofutwa
            </span>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                {renderTableHead()}
                <tbody className="divide-y divide-slate-800/60">
                  {completedDebts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-slate-500">
                        <Archive className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <div className="font-medium text-slate-400">
                          Hakuna madeni yaliyokamilika bado
                        </div>
                        <div className="text-[11px] text-slate-600 mt-0.5">
                          Madeni yatakayo lipwa kikamilifu yataonekana hapa.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    visibleCompleted.map(renderDebtRow)
                  )}
                </tbody>
              </table>
            </div>

            {/* Completed pagination footer */}
            {completedDebts.length > PAGE_SIZE && (
              <div className="px-5 py-3 border-t border-slate-800/60 bg-slate-950/30 flex items-center justify-between gap-3">
                <div className="text-[11px] text-slate-500">
                  Showing{' '}
                  <span className="text-slate-300 font-semibold">
                    {Math.min(completedVisible, completedDebts.length)}
                  </span>{' '}
                  of{' '}
                  <span className="text-slate-300 font-semibold">{completedDebts.length}</span>{' '}
                  completed debts
                </div>
                <div className="flex items-center gap-2">
                  {completedVisible > PAGE_SIZE && (
                    <button
                      onClick={handleSeeLessCompleted}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                    >
                      Show Less
                    </button>
                  )}
                  {hasMoreCompleted && (
                    <button
                      onClick={handleSeeMoreCompleted}
                      disabled={loadingCompleted}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold shadow transition disabled:opacity-60 disabled:cursor-wait"
                    >
                      {loadingCompleted ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Loading...</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span>
                            See More ({Math.min(PAGE_SIZE, remainingCompleted)} of {remainingCompleted})
                          </span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── MODALS (unchanged) ─────────────────────────────── */}

      {/* CREATE / EDIT DEBT MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-400" />
                <span>
                  {editingDebt
                    ? 'Hariri Deni / Edit Debt Record'
                    : formType === 'WE_DEMAND'
                    ? 'Rekodi Deni Jipya la Mteja (Tunadai)'
                    : 'Rekodi Deni Jipya la Kampuni (Wanatudai)'}
                </span>
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDebt} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Aina ya Deni / Debt Type <span className="text-rose-400">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormType('WE_DEMAND')}
                    className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition ${
                      formType === 'WE_DEMAND'
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 shadow-xs'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                    <span>Tunadai (Mteja Anatupa)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormType('THEY_DEMAND')}
                    className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition ${
                      formType === 'THEY_DEMAND'
                        ? 'bg-amber-600/20 border-amber-500 text-amber-300 shadow-xs'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4 text-amber-400" />
                    <span>Wanatudai (Tunalipa Mtoa Huduma)</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Jina la Mteja / Mtoa Huduma (Name) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder={
                    formType === 'WE_DEMAND'
                      ? 'Mfano: Juma, Mama Amina, Musa...'
                      : 'Mfano: ABC Supplier, Twiga Cement...'
                  }
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-300">
                    Bidhaa / Maelezo ya Deni (Product/Description)
                  </label>
                  <span className="text-[10px] text-slate-500">Andika kwa mkono (Plain text)</span>
                </div>
                <input
                  type="text"
                  placeholder="Mfano: Daftari, Simenti mifuko 10, Sare ya shule..."
                  value={formProduct}
                  onChange={e => setFormProduct(e.target.value)}
                  className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Jumla ya Deni / Total Amount (TSh) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="10,000"
                    value={formAmount}
                    onChange={e => setFormAmount(formatPriceInput(e.target.value))}
                    className="w-full bg-slate-950 text-xs font-mono font-bold text-emerald-400 px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Siku ya Kulipa (Day to Pay)
                  </label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={e => setFormDueDate(e.target.value)}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Namba ya Simu / Mawasiliano (Contact)
                </label>
                <input
                  type="text"
                  placeholder="Mfano: 0712345678"
                  value={formContact}
                  onChange={e => setFormContact(e.target.value)}
                  className="w-full bg-slate-950 text-xs font-mono text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Maelezo ya Ziada / Notes (Hiari)
                </label>
                <textarea
                  rows={2}
                  placeholder="Maelezo mengine yoyote kuhusu deni hili..."
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Ghairi (Cancel)
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 rounded-lg text-white text-xs font-semibold shadow-sm transition ${
                    formType === 'WE_DEMAND'
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : 'bg-amber-600 hover:bg-amber-500'
                  }`}
                >
                  {editingDebt ? 'Hifadhi Mabadiliko' : 'Hifadhi Deni Hili'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PAYMENT MODAL */}
      {payingDebt &&
        (() => {
          const totalDebt = payingDebt.amount;
          const currentPaid =
            payingDebt.paidAmount || (payingDebt.status === 'PAID' ? totalDebt : 0);
          const currentRemaining =
            payingDebt.remainingAmount !== undefined
              ? payingDebt.remainingAmount
              : Math.max(0, totalDebt - currentPaid);
          const typedPayAmt = parsePriceInput(paymentAmountInput) || 0;
          const calculatedRemainder = Math.max(0, currentRemaining - typedPayAmt);
          const isPayingFull = calculatedRemainder <= 0 && typedPayAmt >= currentRemaining;

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs overflow-y-auto">
              <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto">
                <div
                  className={`p-4 border-b flex items-center justify-between ${
                    payingDebt.type === 'WE_DEMAND'
                      ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-300'
                      : 'bg-amber-950/60 border-amber-800/60 text-amber-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-black/40">
                      <DollarSign className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-white">
                        {payingDebt.type === 'WE_DEMAND'
                          ? 'Pokea Malipo ya Deni (Kutoka kwa Mteja)'
                          : 'Lipa Deni la Mtoa Huduma (Wanatudai)'}
                      </h3>
                      <p className="text-[11px] text-slate-300 font-normal">
                        Unaweza kulipa kiasi chote au sehemu ya deni (Partial payment)
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setPayingDebt(null)}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleConfirmPayment} className="p-5 space-y-4 text-xs">
                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Jina la Mhusika:</span>
                      <span className="font-bold text-white text-sm">
                        {payingDebt.debtorName}
                      </span>
                    </div>
                    {payingDebt.productDescription && (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Bidhaa/Maelezo:</span>
                        <span className="text-slate-300">{payingDebt.productDescription}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-center">
                      <div className="p-2 rounded bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400 uppercase">Jumla ya Deni</div>
                        <div className="font-mono font-bold text-white text-xs mt-0.5">
                          {formatCurrency(totalDebt, settings.currencySymbol)}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400 uppercase">Zilizo Lipwa</div>
                        <div className="font-mono font-bold text-emerald-400 text-xs mt-0.5">
                          {formatCurrency(currentPaid, settings.currencySymbol)}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-900 border border-emerald-500/30">
                        <div className="text-[10px] text-amber-400 uppercase font-semibold">
                          Baki ya Sasa
                        </div>
                        <div className="font-mono font-extrabold text-amber-300 text-sm mt-0.5">
                          {formatCurrency(currentRemaining, settings.currencySymbol)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-bold text-slate-200">
                        Kiasi Kinacholipwa Sasa / Amount Paying (TSh) *
                      </label>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setPaymentAmountInput(currentRemaining.toString())
                          }
                          className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[10px] font-bold border border-emerald-500/40"
                        >
                          Lipa Yote (
                          {formatCurrency(currentRemaining, settings.currencySymbol)})
                        </button>
                        {currentRemaining > 100 && (
                          <button
                            type="button"
                            onClick={() =>
                              setPaymentAmountInput(
                                Math.floor(currentRemaining / 2).toString()
                              )
                            }
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold"
                          >
                            50%
                          </button>
                        )}
                      </div>
                    </div>

                    <input
                      type="text"
                      required
                      placeholder="Weka kiasi..."
                      value={paymentAmountInput}
                      onChange={e =>
                        setPaymentAmountInput(formatPriceInput(e.target.value))
                      }
                      className="w-full bg-slate-950 text-base font-mono font-extrabold text-white px-3 py-2 rounded-xl border-2 border-emerald-500/50 focus:outline-none focus:border-emerald-400 shadow-inner"
                    />
                  </div>

                  <div
                    className={`p-3 rounded-xl border flex items-center justify-between ${
                      isPayingFull
                        ? 'bg-emerald-950/40 border-emerald-600/40 text-emerald-300'
                        : 'bg-blue-950/40 border-blue-600/40 text-blue-300'
                    }`}
                  >
                    <div>
                      <span className="text-[11px] block text-slate-400">
                        Salio Litakalobaki Baada ya Malipo:
                      </span>
                      <span className="font-mono text-base font-extrabold text-white">
                        {formatCurrency(calculatedRemainder, settings.currencySymbol)}
                      </span>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                        isPayingFull
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      }`}
                    >
                      {isPayingFull ? '✓ Limelipwa Kamili' : '⏱ Bado Deni (Sehemu)'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Njia ya Malipo (Method)
                      </label>
                      <select
                        value={paymentMethod}
                        onChange={e => setPaymentMethod(e.target.value)}
                        className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="CASH">Taslimu (Cash)</option>
                        <option value="MOBILE_MONEY">Simu (M-Pesa / Tigo / Airtel)</option>
                        <option value="BANK">Benki (Bank Transfer)</option>
                        <option value="OTHER">Nyingine (Other)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Tarehe ya Malipo (Date)
                      </label>
                      <input
                        type="date"
                        value={paymentDate}
                        onChange={e => setPaymentDate(e.target.value)}
                        className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Maelezo ya Malipo (Hiari / Notes)
                    </label>
                    <input
                      type="text"
                      placeholder="Mfano: Malipo ya awamu ya kwanza taslimu dukani..."
                      value={paymentNote}
                      onChange={e => setPaymentNote(e.target.value)}
                      className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  {payingDebt.payments && payingDebt.payments.length > 0 && (
                    <div className="pt-2 border-t border-slate-800">
                      <div className="text-[11px] font-semibold text-slate-400 mb-1.5 flex items-center gap-1">
                        <History className="w-3.5 h-3.5 text-blue-400" />
                        <span>Historia ya Awamu Zilizolipwa Kabla:</span>
                      </div>
                      <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                        {payingDebt.payments.map((p, idx) => (
                          <div
                            key={p.id || idx}
                            className="flex justify-between items-center p-1.5 rounded bg-slate-950 border border-slate-800 text-[10px]"
                          >
                            <div>
                              <span className="font-mono text-slate-400">
                                {p.paymentDate}
                              </span>
                              <span className="text-slate-500 ml-1">
                                ({p.paymentMethod})
                              </span>
                              {p.notes && (
                                <span className="text-slate-400 ml-1 italic">
                                  - {p.notes}
                                </span>
                              )}
                            </div>
                            <span className="font-mono font-bold text-emerald-400">
                              +{formatCurrency(p.amount, settings.currencySymbol)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setPayingDebt(null)}
                      className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                    >
                      Ghairi
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md transition flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        Hifadhi Malipo (
                        {formatCurrency(typedPayAmt || 0, settings.currencySymbol)})
                      </span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          );
        })()}

      {/* PAYMENT HISTORY MODAL */}
      {viewingHistoryDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-4 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-blue-400 font-bold text-sm">
                <History className="w-5 h-5" />
                <span>Historia ya Malipo: {viewingHistoryDebt.debtorName}</span>
              </div>
              <button
                onClick={() => setViewingHistoryDebt(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center">
                <div>
                  <div className="text-slate-400">Jumla ya Deni:</div>
                  <div className="text-sm font-bold font-mono text-white">
                    {formatCurrency(viewingHistoryDebt.amount, settings.currencySymbol)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Zilizolipwa:</div>
                  <div className="text-sm font-bold font-mono text-emerald-400">
                    {formatCurrency(
                      viewingHistoryDebt.paidAmount || 0,
                      settings.currencySymbol
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Baki Iliyobaki:</div>
                  <div className="text-sm font-bold font-mono text-amber-400">
                    {formatCurrency(
                      viewingHistoryDebt.remainingAmount !== undefined
                        ? viewingHistoryDebt.remainingAmount
                        : viewingHistoryDebt.status === 'PAID'
                        ? 0
                        : viewingHistoryDebt.amount,
                      settings.currencySymbol
                    )}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-300 mb-2">
                  Orodha ya Awamu za Malipo
                </h4>
                {!viewingHistoryDebt.payments ||
                viewingHistoryDebt.payments.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 bg-slate-950 rounded-lg border border-slate-800">
                    Hakuna malipo yaliyorekodiwa bado.
                  </div>
                ) : (
                  <div className="border border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="p-2.5 font-semibold">Tarehe</th>
                          <th className="p-2.5 font-semibold">Kiasi</th>
                          <th className="p-2.5 font-semibold">Njia</th>
                          <th className="p-2.5 font-semibold">Baki Baada</th>
                          <th className="p-2.5 font-semibold">Mpokeaji</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {viewingHistoryDebt.payments.map((payment, idx) => (
                          <tr key={payment.id || idx} className="hover:bg-slate-850/40">
                            <td className="p-2.5 font-mono text-slate-300">
                              {payment.paymentDate}
                            </td>
                            <td className="p-2.5 font-mono font-bold text-emerald-400">
                              {formatCurrency(payment.amount, settings.currencySymbol)}
                            </td>
                            <td className="p-2.5 text-slate-400">
                              {payment.paymentMethod}
                            </td>
                            <td className="p-2.5 font-mono text-slate-300">
                              {payment.remainingAfter !== undefined
                                ? formatCurrency(
                                    payment.remainingAfter,
                                    settings.currencySymbol
                                  )
                                : '—'}
                            </td>
                            <td className="p-2.5 text-slate-400">
                              {payment.paidByName || 'Cashier'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setViewingHistoryDebt(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition"
                >
                  Funga
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deletingDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3 text-rose-400">
                <AlertTriangle className="w-6 h-6 shrink-0" />
                <h3 className="font-bold text-sm text-white">
                  Futa Rekodi ya Deni la "{deletingDebt.debtorName}"?
                </h3>
              </div>

              <p className="text-xs text-slate-300 mb-4">
                Una uhakika unataka kufuta rekodi hii ya deni la{' '}
                {formatCurrency(deletingDebt.amount, settings.currencySymbol)} (
                {deletingDebt.productDescription || 'bidhaa'})?
                <br />
                <br />
                <strong className="text-rose-400">Onyo:</strong> Ufutaji huu hauwezi
                kutenduliwa.
              </p>

              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setDeletingDebt(null)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Ghairi
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-sm transition"
                >
                  Futa Deni
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
