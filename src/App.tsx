import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';
import { ReceiptModal } from './components/common/ReceiptModal';
import { ToastContainer } from './components/common/ToastContainer';
import { LoginView } from './components/auth/LoginView';
import { getShopAdminShopIds, hasAdminAccess, isShopAdmin } from './utils/permissions';

// Common / Shared Independent Modules
import { DebtManagement } from './components/debt/DebtManagement';
import { NotificationCenter } from './components/notifications/NotificationCenter';

// Seller Views
import { SellerDashboard } from './components/seller/SellerDashboard';
import { NewSalePOS } from './components/seller/NewSalePOS';
import { SellerProducts } from './components/seller/SellerProducts';
import { SellerSales } from './components/seller/SellerSales';
import { SellerReceipts } from './components/seller/SellerReceipts';
import { SellerSettings } from './components/seller/SellerSettings';

// Admin Views
import { AdminDashboard } from './components/admin/AdminDashboard';
import { AdminShops } from './components/admin/AdminShops';
import { AdminStores } from './components/admin/AdminStores';
import { AdminSales } from './components/admin/AdminSales';
import { AdminProducts } from './components/admin/AdminProducts';
import { AdminInventory } from './components/admin/AdminInventory';
import { AdminSellers } from './components/admin/AdminSellers';
import { AdminPurchases } from './components/admin/AdminPurchases';
import { AdminExpenses } from './components/admin/AdminExpenses';
import { AdminReports } from './components/admin/AdminReports';
import { AdminDataManagement } from './components/admin/AdminDataManagement';
import { AdminSettings } from './components/admin/AdminSettings';

const MainLayout: React.FC = () => {
  const {
    currentUser,
    activeTab,
    isOnline,
    isCloudLoaded,
    isInitialLoading,
    cloudError,
    cachedHome,
    retryConnection,
  } = useApp();

  const canShowCachedHome = Boolean(currentUser && cachedHome);

  if (!isCloudLoaded && !canShowCachedHome) {
    return (
      <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 select-none font-sans">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
          {isInitialLoading ? (
            <>
              <div className="w-16 h-16 rounded-2xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center mx-auto mb-5">
                <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">
                Connecting to Live Database...
              </h2>
              <p className="text-sm text-slate-400">
                Loading your online business data. Please wait a moment.
              </p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto mb-5">
                <WifiOff className="w-8 h-8 text-rose-400" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">
                You are offline
              </h2>
              <p className="text-sm text-slate-300 mb-2">
                Wait for internet connection.
              </p>
              <p className="text-xs text-slate-400 mb-6">
                {cloudError ||
                  'No data can be loaded because this system operates online only. Check your internet connection and try again.'}
              </p>
              <button
                type="button"
                onClick={() => retryConnection()}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Connection</span>
              </button>
            </>
          )}
        </div>
        <ToastContainer />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <LoginView />
        <ToastContainer />
      </>
    );
  }

  const renderActiveView = () => {
    // Offline mode: always display cached Home only and lock every other page
    if (!isOnline || !isCloudLoaded) {
      return hasAdminAccess(currentUser) ? <AdminDashboard /> : <SellerDashboard />;
    }

    // Non-admin sellers can access New Sale (POS), Account Settings, and Shop Expenses if permitted
    if (!hasAdminAccess(currentUser)) {
      const permissions = currentUser.permissions || {};
      if (activeTab === 'settings') {
        return <SellerSettings />;
      }
      if (activeTab === 'expenses' && (permissions.canViewExpenses || permissions.canRecordExpenses)) {
        return <AdminExpenses />;
      }
      return <NewSalePOS />;
    }

    // Shared tabs accessible to admins / shop admins
    if (activeTab === 'debts') {
      return <DebtManagement />;
    }
    if (activeTab === 'notifications') {
      return <NotificationCenter />;
    }

    if (currentUser.role === 'SELLER') {
      const permissions = currentUser.permissions || {};

      switch (activeTab) {
        case 'dashboard':
          return hasAdminAccess(currentUser) ? <AdminDashboard /> : <SellerDashboard />;
        case 'new_sale':
          return <NewSalePOS />;
        case 'products':
          if (hasAdminAccess(currentUser) || permissions.canEditProducts || permissions.canDeleteProducts) {
            return <AdminProducts />;
          }
          return <SellerProducts />;
        case 'purchases':
          // Sellers can always view/record purchases
          return <AdminPurchases />;
        case 'sales':
          // Allow seller with canEditSales, canDeleteSales, or designated Shop Admin to view sales history
          if (permissions.canEditSales || permissions.canDeleteSales || getShopAdminShopIds(currentUser).length > 0) {
            return <AdminSales />;
          }
          return <SellerDashboard />;
        case 'inventory':
          // Only if seller has canManageInventory permission or Shop Admin access
          if (permissions.canManageInventory || hasAdminAccess(currentUser)) {
            return <AdminInventory />;
          }
          return <SellerDashboard />;
        case 'expenses':
          // Only if seller has canViewExpenses or canRecordExpenses permission or Shop Admin access
          if (hasAdminAccess(currentUser) || permissions.canViewExpenses || permissions.canRecordExpenses) {
            return <AdminExpenses />;
          }
          return <SellerDashboard />;
        case 'reports':
          // Only if seller has canViewReports permission or Shop Admin access
          if (hasAdminAccess(currentUser) || permissions.canViewReports) {
            return <AdminReports />;
          }
          return <SellerDashboard />;
        case 'shops':
          // Only if seller has canManageShops permission or is designated Shop Admin
          if (permissions.canManageShops || getShopAdminShopIds(currentUser).length > 0) {
            return <AdminShops />;
          }
          return <SellerDashboard />;
        case 'stores':
          if (hasAdminAccess(currentUser) || permissions.canManageShops || permissions.canManageInventory) {
            return <AdminStores />;
          }
          return <SellerDashboard />;
        case 'sellers':
          // Only if seller has canManageSellers permission or Shop Admin access
          if (hasAdminAccess(currentUser) || permissions.canManageSellers) {
            return <AdminSellers />;
          }
          return <SellerDashboard />;
        case 'data_management':
          if (isShopAdmin(currentUser)) {
            return <AdminDataManagement />;
          }
          return <SellerDashboard />;
        case 'my_sales':
          return <SellerSales />;
        case 'receipts':
          return <SellerReceipts />;
        case 'settings':
          return <SellerSettings />;
        default:
          return <NewSalePOS />;
      }
    }

    // Admin Views
    switch (activeTab) {
      case 'dashboard':
        return <AdminDashboard />;
      case 'new_sale':
        return <NewSalePOS />;
      case 'shops':
        return <AdminShops />;
      case 'stores':
        return <AdminStores />;
      case 'sales':
        return <AdminSales />;
      case 'products':
        return <AdminProducts />;
      case 'inventory':
        return <AdminInventory />;
      case 'sellers':
        return <AdminSellers />;
      case 'purchases':
        return <AdminPurchases />;
      case 'expenses':
        return <AdminExpenses />;
      case 'reports':
        return <AdminReports />;
      case 'data_management':
        return <AdminDataManagement />;
      case 'settings':
        return <AdminSettings />;
      default:
        return <AdminDashboard />;
    }
  };

  return (
    <div id="omnibiz-pos-app" className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none font-sans">
      <Header />
      {(!isOnline || !isCloudLoaded) && (
        <div className="px-4 py-2 bg-rose-950/90 border-b border-rose-500/40 text-rose-200 text-xs flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 font-medium">
            <WifiOff className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              You are offline — Viewing cached Home. Connect to the internet to open other pages.
            </span>
          </div>
          <button
            type="button"
            onClick={() => retryConnection()}
            className="px-2.5 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/30 text-rose-100 font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-950">
          {renderActiveView()}
        </main>
      </div>
      <ReceiptModal />
      <ToastContainer />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
