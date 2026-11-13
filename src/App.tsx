import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';
import { ReceiptModal } from './components/common/ReceiptModal';
import { ToastContainer } from './components/common/ToastContainer';
import { LoginView } from './components/auth/LoginView';

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
  const { currentUser, activeTab } = useApp();

  if (!currentUser) {
    return <LoginView />;
  }

  const renderActiveView = () => {
    // Shared tabs accessible to both roles
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
          return <SellerDashboard />;
        case 'new_sale':
          return <NewSalePOS />;
        case 'products':
          return <SellerProducts />;
        case 'purchases':
          // Sellers can always view/record purchases
          return <AdminPurchases />;
        case 'sales':
          // ADDED: Allow seller with canEditSales or canDeleteSales to view sales history
          if (permissions.canEditSales || permissions.canDeleteSales) {
            return <AdminSales />;
          }
          return <SellerDashboard />;
        case 'inventory':
          // Only if seller has canManageInventory permission
          if (permissions.canManageInventory) {
            return <AdminInventory />;
          }
          return <SellerDashboard />;
        case 'expenses':
          // Only if seller has canViewExpenses or canRecordExpenses permission
          if (permissions.canViewExpenses || permissions.canRecordExpenses) {
            return <AdminExpenses />;
          }
          return <SellerDashboard />;
        case 'reports':
          // Only if seller has canViewReports permission
          if (permissions.canViewReports) {
            return <AdminReports />;
          }
          return <SellerDashboard />;
        case 'shops':
          // Only if seller has canManageShops permission
          if (permissions.canManageShops) {
            return <AdminShops />;
          }
          return <SellerDashboard />;
        case 'sellers':
          // Only if seller has canManageSellers permission
          if (permissions.canManageSellers) {
            return <AdminSellers />;
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
