import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { NotificationService } from '../../services/notificationService';
import { AppNotification, NotificationType, NotificationCategory } from '../../types';
import { formatDateTime, formatDate } from '../../utils/formatters';
import {
  Bell,
  CheckCheck,
  Filter,
  AlertTriangle,
  Info,
  CheckCircle2,
  Clock,
  Package,
  DollarSign,
  FileText,
  Trash2,
  Search,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

export const NotificationCenter: React.FC = () => {
  const { currentUser, dbState, setActiveTab } = useApp();
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'DEBT' | 'STOCK' | 'PRICE'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNREAD' | 'READ'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Sync automatic notifications on mount
  useEffect(() => {
    NotificationService.syncAutomaticNotifications();
  }, []);

  const notifications = useMemo(() => {
    return NotificationService.getUserNotifications(currentUser);
  }, [dbState.notifications, dbState.debts, dbState.products, currentUser]);

  const filteredNotifications = useMemo(() => {
    if (!currentUser) return [];

    return notifications.filter(n => {
      const isRead = (n.readByUserIds || []).includes(currentUser.id);

      // Status filter
      if (statusFilter === 'UNREAD' && isRead) return false;
      if (statusFilter === 'READ' && !isRead) return false;

      // Category filter
      if (categoryFilter === 'DEBT') {
        if (!n.type.startsWith('DEBT_')) return false;
      } else if (categoryFilter === 'STOCK') {
        if (!n.type.startsWith('STOCK_')) return false;
      } else if (categoryFilter === 'PRICE') {
        if (!n.type.startsWith('PRICE_')) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const msgMatch = n.message.toLowerCase().includes(q);
        const titleMatch = (n.title || '').toLowerCase().includes(q);
        const shopMatch = (n.targetShopName || '').toLowerCase().includes(q);
        if (!msgMatch && !titleMatch && !shopMatch) return false;
      }

      return true;
    });
  }, [notifications, categoryFilter, statusFilter, searchQuery, currentUser]);

  const unreadCount = useMemo(() => {
    return NotificationService.getUnreadCount(currentUser);
  }, [notifications, currentUser]);

  const handleMarkAsRead = (notifId: string) => {
    if (!currentUser) return;
    NotificationService.markAsRead(notifId, currentUser);
  };

  const handleMarkAllAsRead = () => {
    if (!currentUser) return;
    NotificationService.markAllAsRead(currentUser);
  };

  const handleNotificationClick = (n: AppNotification) => {
    if (currentUser) {
      NotificationService.markAsRead(n.id, currentUser);
    }

    if (n.relatedEntityType === 'DEBT' || n.type.startsWith('DEBT_')) {
      setActiveTab('debts');
    } else if (n.relatedEntityType === 'PRODUCT' || n.type.startsWith('STOCK_') || n.type.startsWith('PRICE_')) {
      if (currentUser?.role === 'ADMIN') {
        setActiveTab('inventory');
      } else {
        setActiveTab('products');
      }
    }
  };

  const renderIcon = (type: NotificationType, category: NotificationCategory) => {
    if (type.startsWith('DEBT_')) {
      if (category === 'CRITICAL' || type.includes('OVERDUE')) {
        return <AlertTriangle className="w-4 h-4 text-rose-400" />;
      }
      return <Clock className="w-4 h-4 text-amber-400" />;
    }
    if (type === 'STOCK_OUT') {
      return <AlertTriangle className="w-4 h-4 text-rose-400" />;
    }
    if (type === 'STOCK_LOW') {
      return <Package className="w-4 h-4 text-amber-400" />;
    }
    if (type.startsWith('PRICE_')) {
      return <DollarSign className="w-4 h-4 text-blue-400" />;
    }
    return <Info className="w-4 h-4 text-slate-400" />;
  };

  const getBadgeStyle = (category: NotificationCategory) => {
    switch (category) {
      case 'CRITICAL':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      case 'WARNING':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'SUCCESS':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'INFO':
      default:
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
    }
  };

  return (
    <div id="notification-center-page" className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="p-4 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 relative">
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white font-mono text-[9px] font-bold flex items-center justify-center animate-pulse">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          <div>
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              Kituo cha Taarifa na Vikumbusho
              <span className="text-xs font-normal text-slate-400">/ Notifications</span>
            </h1>
            <p className="text-xs text-slate-400">
              Taarifa zote za madeni yanayotakiwa kulipwa, akiba ya bidhaa, na mabadiliko ya bei
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition border border-slate-700"
            >
              <CheckCheck className="w-4 h-4 text-emerald-400" />
              <span>Weka Zote Zimesomwa ({unreadCount})</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-5xl mx-auto w-full">
        {/* Filters */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Category Tabs */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800 text-xs">
              <button
                onClick={() => setCategoryFilter('ALL')}
                className={`px-3 py-1.5 rounded-md font-medium transition ${
                  categoryFilter === 'ALL'
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Zote ({notifications.length})
              </button>
              <button
                onClick={() => setCategoryFilter('DEBT')}
                className={`px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition ${
                  categoryFilter === 'DEBT'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-amber-400 hover:bg-slate-900'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                Madeni (Debt)
              </button>
              <button
                onClick={() => setCategoryFilter('STOCK')}
                className={`px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition ${
                  categoryFilter === 'STOCK'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-rose-400 hover:bg-slate-900'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                Akiba ya Bidhaa
              </button>
              <button
                onClick={() => setCategoryFilter('PRICE')}
                className={`px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition ${
                  categoryFilter === 'PRICE'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-blue-400 hover:bg-slate-900'
                }`}
              >
                <DollarSign className="w-3.5 h-3.5" />
                Mabadiliko ya Bei
              </button>
            </div>

            {/* Read/Unread Filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" /> Onyesha:
              </span>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as any)}
                className="bg-slate-950 text-xs text-white px-2.5 py-1.5 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">Zote (All)</option>
                <option value="UNREAD">Ambazo Hazijasomwa (Unread)</option>
                <option value="READ">Zilizosomwa (Read)</option>
              </select>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Tafuta kwenye ujumbe wa taarifa..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 text-xs text-white pl-9 pr-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Notifications List */}
        <div className="space-y-2.5">
          {filteredNotifications.length === 0 ? (
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-12 text-center text-slate-500">
              <Bell className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <div className="text-sm font-medium text-slate-400">Hakuna taarifa mpya</div>
              <div className="text-xs text-slate-600 mt-1">
                Taarifa na vikumbusho vitaonekana hapa kiotomatiki.
              </div>
            </div>
          ) : (
            filteredNotifications.map(n => {
              const isRead = (n.readByUserIds || []).includes(currentUser?.id || '');

              return (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`p-4 rounded-xl border transition cursor-pointer flex items-start gap-3.5 relative group ${
                    isRead
                      ? 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-850'
                      : 'bg-slate-900 border-blue-500/40 shadow-sm text-white hover:border-blue-500/60 ring-1 ring-blue-500/20'
                  }`}
                >
                  {/* Category icon */}
                  <div
                    className={`p-2 rounded-lg border shrink-0 mt-0.5 ${getBadgeStyle(
                      n.category
                    )}`}
                  >
                    {renderIcon(n.type, n.category)}
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-bold text-xs text-white flex items-center gap-1.5">
                        {!isRead && (
                          <span className="w-2 h-2 rounded-full bg-blue-400 inline-block animate-pulse" />
                        )}
                        {n.title}
                      </span>

                      {n.targetShopName && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-mono">
                          {n.targetShopName}
                        </span>
                      )}

                      {n.isGlobal && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px]">
                          Taarifa ya Jumla
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-200 leading-relaxed font-normal">
                      {n.message}
                    </p>

                    <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(n.createdAt)}
                      </span>

                      <span className="text-blue-400 group-hover:underline flex items-center gap-0.5 font-medium">
                        <span>Fungua / Fungua ukurasa husika</span>
                        <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-1">
                    {!isRead && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleMarkAsRead(n.id);
                        }}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-emerald-400 transition"
                        title="Weka kama imesomwa"
                      >
                        <CheckCheck className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
