import React, { useState, useRef, useEffect } from 'react';
import {
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  LogOut,
  Shield,
  Clock,
  Store,
  ChevronDown,
  Bell,
  CheckCheck,
  ArrowRight,
  AlertTriangle,
  Package,
  DollarSign,
  FileText,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatDate, formatDateTime } from '../../utils/formatters';
import { NotificationService } from '../../services/notificationService';

export const Header: React.FC = () => {
  const {
    currentUser,
    logout,
    syncStatus,
    triggerSync,
    sellerColor,
    dbState,
    selectedShopId,
    setSelectedShopId,
    availableShops,
    setActiveTab,
  } = useApp();
  const settings = dbState.settings;

  const [isNotifDropdownOpen, setIsNotifDropdownOpen] = useState(false);
  const notifDropdownRef = useRef<HTMLDivElement>(null);

  const isAdmin = currentUser?.role === 'ADMIN';

  // Sync automatic notifications
  useEffect(() => {
    NotificationService.syncAutomaticNotifications();
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(e.target as Node)) {
        setIsNotifDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const userNotifications = NotificationService.getUserNotifications(currentUser);
  const unreadCount = NotificationService.getUnreadCount(currentUser);
  const recentNotifications = userNotifications.slice(0, 4);

  const handleOpenAllNotifications = () => {
    setIsNotifDropdownOpen(false);
    setActiveTab('notifications');
  };


  return (
    <header id="desktop-app-header" className="bg-slate-900 text-slate-100 border-b border-slate-800 select-none">
      {/* Top Windows Native Frame Simulation */}
      <div className="flex items-center justify-between px-3 py-1 bg-slate-950 text-slate-400 text-xs border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <img
            src="./icon.png"
            alt="Gmeck Company Limited"
            referrerPolicy="no-referrer"
            className="w-4 h-4 rounded object-cover"
          />
          <span className="font-semibold text-slate-300">Gmeck POS</span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">{settings.businessName}</span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">Windows Offline Engine v2.4</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
            <Clock className="w-3 h-3 text-slate-500" />
            <span>{formatDate(new Date().toISOString())}</span>
          </div>

          {/* Window Control Buttons Simulation */}
          <div className="flex items-center space-x-2 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block"></span>
          </div>
        </div>
      </div>

      {/* Main App Bar */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-3">
          {/* Avatar with fallback to initial or shield for admin */}
          {currentUser?.avatarUrl ? (
            <img 
              src={currentUser.avatarUrl} 
              alt={currentUser.name} 
              className="w-9 h-9 rounded-lg object-cover shadow-sm"
              style={{ border: `2px solid ${currentUser.role === 'ADMIN' ? '#334155' : sellerColor.primary}` }}
            />
          ) : (
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-white shadow-sm transition-colors"
              style={{ backgroundColor: currentUser?.role === 'ADMIN' ? '#334155' : sellerColor.primary }}
            >
              {currentUser?.role === 'ADMIN' ? (
                <Shield className="w-5 h-5" />
              ) : (
                currentUser?.name.charAt(0).toUpperCase() || 'S'
              )}
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-sm text-white tracking-tight">
                {currentUser?.name || 'Gmeck POS'}
              </h1>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${
                  currentUser?.role === 'ADMIN'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                }`}
              >
                {currentUser?.role === 'ADMIN' ? 'Administrator' : 'Seller Mode'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              @{currentUser?.username} • Local Offline Mode Active
            </p>
          </div>
        </div>

        {/* Middle: Shop Selector & Context */}
        <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800 shadow-inner">
          <Store className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-xs text-slate-400 font-medium">Shop Unit:</span>

          {isAdmin ? (
            <div className="relative flex items-center">
              <select
                id="header-admin-shop-select"
                value={selectedShopId}
                onChange={e => setSelectedShopId(e.target.value)}
                className="bg-slate-900 text-xs text-slate-200 font-semibold py-1 pl-2.5 pr-7 rounded border border-slate-700 hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer appearance-none"
              >
                <option value="ALL">🏢 All Shops (Company Overview)</option>
                {availableShops.map(sh => (
                  <option key={sh.id} value={sh.id}>
                    {sh.status === 'INACTIVE' ? `🚫 ${sh.name} (Inactive)` : `🏪 ${sh.name}`}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
            </div>
          ) : (
            // Seller View
            availableShops.length > 1 ? (
              <div className="relative flex items-center">
                <select
                  id="header-seller-shop-select"
                  value={selectedShopId}
                  onChange={e => setSelectedShopId(e.target.value)}
                  className="bg-slate-900 text-xs text-blue-300 font-semibold py-1 pl-2.5 pr-7 rounded border border-blue-700/60 hover:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer appearance-none"
                >
                  {availableShops.map(sh => (
                    <option key={sh.id} value={sh.id}>
                      🏪 {sh.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-blue-400 absolute right-2 pointer-events-none" />
              </div>
            ) : availableShops.length === 1 ? (
              <span className="text-xs font-semibold text-blue-300 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800/60">
                🏪 {availableShops[0].name}
              </span>
            ) : (
              <span className="text-xs text-rose-400 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-900/60">
                ⚠️ No Assigned Shops
              </span>
            )
          )}
        </div>

        {/* Right side status indicators & user actions */}
        <div className="flex items-center gap-2.5">
          {/* Notification Bell Dropdown */}
          <div className="relative" ref={notifDropdownRef}>
            <button
              id="header-notification-bell"
              onClick={() => setIsNotifDropdownOpen(!isNotifDropdownOpen)}
              title="Kituo cha Taarifa na Vikumbusho"
              className={`p-2 rounded-md transition relative flex items-center justify-center border ${
                unreadCount > 0
                  ? 'bg-slate-800 text-amber-400 border-amber-500/40 hover:bg-slate-750'
                  : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-800'
              }`}
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white font-mono text-[10px] font-bold flex items-center justify-center border-2 border-slate-900 animate-pulse">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Notification Popover Dropdown */}
            {isNotifDropdownOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                <div className="p-3 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-blue-400" />
                    <span className="font-bold text-xs text-white">Taarifa & Vikumbusho</span>
                    {unreadCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-mono font-bold">
                        {unreadCount} Mpya
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && currentUser && (
                    <button
                      onClick={() => NotificationService.markAllAsRead(currentUser)}
                      className="text-[11px] text-slate-400 hover:text-emerald-400 flex items-center gap-1 transition"
                      title="Weka zote zimesomwa"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      <span>Zisome zote</span>
                    </button>
                  )}
                </div>

                {/* List */}
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/60">
                  {recentNotifications.length === 0 ? (
                    <div className="p-6 text-center text-slate-500 text-xs">
                      <Bell className="w-8 h-8 mx-auto mb-1.5 opacity-20" />
                      <div>Hakuna taarifa yoyote kwa sasa.</div>
                    </div>
                  ) : (
                    recentNotifications.map(n => {
                      const isRead = (n.readByUserIds || []).includes(currentUser?.id || '');
                      return (
                        <div
                          key={n.id}
                          onClick={() => {
                            if (currentUser) NotificationService.markAsRead(n.id, currentUser);
                            setIsNotifDropdownOpen(false);
                            if (n.relatedEntityType === 'DEBT' || n.type.startsWith('DEBT_')) {
                              setActiveTab('debts');
                            } else {
                              setActiveTab('notifications');
                            }
                          }}
                          className={`p-3 text-xs transition cursor-pointer hover:bg-slate-800/60 flex items-start gap-2.5 ${
                            isRead ? 'text-slate-400' : 'bg-slate-850/50 text-slate-100 font-medium'
                          }`}
                        >
                          <div className="mt-0.5 shrink-0">
                            {n.type.startsWith('DEBT_') ? (
                              <Clock className="w-4 h-4 text-amber-400" />
                            ) : n.type === 'STOCK_OUT' ? (
                              <AlertTriangle className="w-4 h-4 text-rose-400" />
                            ) : n.type === 'STOCK_LOW' ? (
                              <Package className="w-4 h-4 text-amber-400" />
                            ) : (
                              <DollarSign className="w-4 h-4 text-blue-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <span className="font-bold text-[11px] text-white truncate">
                                {!isRead && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block mr-1" />}
                                {n.title}
                              </span>
                              <span className="text-[9px] text-slate-500 font-mono shrink-0">
                                {formatDate(n.createdAt)}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-300 line-clamp-2 leading-relaxed">
                              {n.message}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Footer link to full notification center */}
                <div className="p-2 bg-slate-950/80 border-t border-slate-800 text-center">
                  <button
                    onClick={handleOpenAllNotifications}
                    className="w-full py-1.5 text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center justify-center gap-1 transition"
                  >
                    <span>Fungua Kituo Kamili cha Taarifa</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Sync & Offline Status Badge */}
          <button
            id="sync-status-button"
            onClick={triggerSync}
            title="Click to synchronize with server"
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-800/90 hover:bg-slate-800 text-xs font-medium border border-slate-700 transition"
          >
            {syncStatus.state === 'SYNCING' ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                <span className="text-blue-300">Syncing ({syncStatus.pendingCount})...</span>
              </>
            ) : syncStatus.state === 'PENDING_SYNC' ? (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-amber-300">Pending Sync ({syncStatus.pendingCount})</span>
              </>
            ) : syncStatus.state === 'SYNCED' ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300">Synced</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300">Offline / Local DB</span>
              </>
            )}
          </button>

          {/* Logout Button */}
          <button
            id="logout-button"
            onClick={logout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-rose-950/40 hover:text-rose-300 hover:border-rose-800/60 text-slate-300 text-xs font-medium border border-slate-700 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Switch User / Exit</span>
          </button>
        </div>

      </div>
    </header>
  );
};
