import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Receipt,
  History,
  Users,
  TrendingDown,
  Truck,
  BarChart3,
  Database,
  Settings,
  Boxes,
  Lock,
  Store,
  FileText,
  Bell,
  DollarSign,
  Shield,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { NotificationService } from '../../services/notificationService';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  badge?: number | string;
  badgeColor?: 'red' | 'amber' | 'blue';
  requiresPermission?: keyof import('../../types').SellerPermissions;
  requiresAnyPermission?: (keyof import('../../types').SellerPermissions)[];
}

export const Sidebar: React.FC = () => {
  const { currentUser, activeTab, setActiveTab, sellerColor, dbState } = useApp();

  const isSeller = currentUser?.role === 'SELLER';
  const isAdmin = currentUser?.role === 'ADMIN';
  const sellerPermissions = currentUser?.permissions || {};

  // Check if seller has a specific permission
  const hasPermission = (perm: keyof import('../../types').SellerPermissions): boolean => {
    if (isAdmin) return true;
    return !!sellerPermissions[perm];
  };

  // Check if seller has ANY of the given permissions
  const hasAnyPermission = (perms: (keyof import('../../types').SellerPermissions)[]): boolean => {
    if (isAdmin) return true;
    return perms.some(perm => !!sellerPermissions[perm]);
  };

  // Count low-stock items
  const lowStockCount = (dbState.products || []).filter(
    p => p.status === 'ACTIVE' && p.currentStock <= p.minStock
  ).length;

  // Count unread notifications
  const unreadNotifsCount = NotificationService.getUnreadCount(currentUser);

  // Count pending/overdue debts
  const debts = dbState.debts || [];
  const overdueDebtsCount = debts.filter(d => d.status === 'OVERDUE').length;

  const sellerNav: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'new_sale', label: 'New Sale (POS)', icon: ShoppingCart },
    { id: 'products', label: 'Products', icon: Package, badge: lowStockCount > 0 ? lowStockCount : undefined },
    
    // Purchases - always show (sellers can always view/record stock-in)
    { id: 'purchases', label: 'Purchases & Stock In', icon: Truck },
    
    { id: 'my_sales', label: 'My Sales', icon: History },
    { id: 'debts', label: 'Madeni (Debts)', icon: FileText, badge: overdueDebtsCount > 0 ? `${overdueDebtsCount} Overdue` : debts.filter(d => d.status !== 'PAID').length || undefined, badgeColor: overdueDebtsCount > 0 ? 'red' : 'amber' },
    { id: 'notifications', label: 'Taarifa & Vikumbusho', icon: Bell, badge: unreadNotifsCount > 0 ? unreadNotifsCount : undefined, badgeColor: 'red' },
    { id: 'receipts', label: 'Receipts', icon: Receipt },
    
    // Permission-gated items
    { id: 'sales', label: 'Sales History', icon: History, requiresAnyPermission: ['canEditSales', 'canDeleteSales'] },
    { id: 'inventory', label: 'Inventory Management', icon: Boxes, requiresPermission: 'canManageInventory' },
    { id: 'expenses', label: 'Expenses', icon: DollarSign, requiresAnyPermission: ['canViewExpenses', 'canRecordExpenses'] },
    { id: 'reports', label: 'Reports', icon: BarChart3, requiresPermission: 'canViewReports' },
    { id: 'shops', label: 'Shops & Units', icon: Store, requiresPermission: 'canManageShops' },
    { id: 'sellers', label: 'Sellers', icon: Users, requiresPermission: 'canManageSellers' },
    
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const adminNav: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'new_sale', label: 'New Sale (POS)', icon: ShoppingCart },
    { id: 'shops', label: 'Shops & Units', icon: Store, badge: (dbState.shops || []).length },
    { id: 'sales', label: 'Sales History', icon: History },
    { id: 'debts', label: 'Debt Management (Madeni)', icon: FileText, badge: overdueDebtsCount > 0 ? `${overdueDebtsCount} Overdue` : undefined, badgeColor: 'red' },
    { id: 'notifications', label: 'Notification Center', icon: Bell, badge: unreadNotifsCount > 0 ? unreadNotifsCount : undefined, badgeColor: 'red' },
    { id: 'products', label: 'Products & Categories', icon: Package },
    { id: 'inventory', label: 'Inventory', icon: Boxes, badge: lowStockCount > 0 ? `${lowStockCount} Low` : undefined },
    { id: 'sellers', label: 'Sellers', icon: Users },
    { id: 'purchases', label: 'Purchases', icon: Truck },
    { id: 'expenses', label: 'Expenses', icon: TrendingDown },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'data_management', label: 'Data Management', icon: Database },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  // Filter items based on permissions
  const items = (isSeller ? sellerNav : adminNav).filter(item => {
    if (item.requiresPermission) {
      return hasPermission(item.requiresPermission);
    }
    if (item.requiresAnyPermission) {
      return hasAnyPermission(item.requiresAnyPermission);
    }
    return true;
  });

  return (
    <aside
      id="app-sidebar-nav"
      className="w-64 bg-slate-900 text-slate-300 border-r border-slate-800 flex flex-col justify-between shrink-0 select-none"
    >
      <div className="py-3">
        {/* Navigation Category Label */}
        <div className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
          <span>{isSeller ? 'Seller Terminal' : 'Admin Control Panel'}</span>
          {isAdmin && <Lock className="w-3 h-3 text-amber-400" />}
        </div>

        {/* Menu Items */}
        <nav className="space-y-1 px-2">
          {items.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'text-white shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
                style={{
                  backgroundColor: isActive
                    ? isSeller
                      ? sellerColor.primary
                      : '#3b82f6'
                    : undefined,
                }}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>

                {item.badge !== undefined && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : item.badgeColor === 'red'
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        : item.badgeColor === 'blue'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info Box */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-[11px] text-slate-400">
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-slate-300">Local DB Status</span>
          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Operational
          </span>
        </div>
        <p className="text-[10px] text-slate-400">
          Transactions stored locally. Safe to operate without internet connection.
        </p>
      </div>
    </aside>
  );
};
