import React, { useState, useMemo } from 'react';
import {
  Store,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Edit2,
  Boxes,
  Users,
  DollarSign,
  ShoppingCart,
  Phone,
  MapPin,
  FileText,
  AlertTriangle,
  Info,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ShopService } from '../../services/shopService';
import { Shop, ShopStatus } from '../../types';
import { formatCurrency, formatDate } from '../../utils/formatters';

export const AdminShops: React.FC = () => {
  const { currentUser, dbState, addToast, setSelectedShopId, setActiveTab } = useApp();
  const settings = dbState.settings;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ShopStatus>('ALL');

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingShop, setEditingShop] = useState<Shop | null>(null);
  const [deactivatingShop, setDeactivatingShop] = useState<Shop | null>(null);
  const [deletingShop, setDeletingShop] = useState<Shop | null>(null);

  // Form inputs
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    address: '',
    phone: '',
    status: 'ACTIVE' as ShopStatus,
  });

  // Permission check: Admin OR Seller with canManageShops
  if (!currentUser) return null;
  if (currentUser.role !== 'ADMIN' && !currentUser.permissions?.canManageShops) return null;

  const shops = useMemo(() => {
    return ShopService.getShops({
      status: statusFilter,
      search,
    });
  }, [dbState.shops, statusFilter, search]);

  // Compute metrics per shop
  const shopMetrics = useMemo(() => {
    const metrics: Record<
      string,
      {
        productsCount: number;
        totalUnits: number;
        inventoryValuation: number;
        sellersCount: number;
        salesCount: number;
        salesRevenue: number;
      }
    > = {};

    (dbState.shops || []).forEach(sh => {
      const shopProducts = (dbState.products || []).filter(p => p.shopId === sh.id && p.status === 'ACTIVE');
      const shopSellers = (dbState.users || []).filter(
        u => u.role === 'SELLER' && u.status === 'ACTIVE' && (u.assignedShopIds || []).includes(sh.id)
      );
      const shopSales = (dbState.sales || []).filter(s => s.shopId === sh.id && s.status === 'COMPLETED');

      const totalVal = shopProducts.reduce((sum, p) => sum + p.currentStock * p.sellingPrice, 0);
      const totalUnits = shopProducts.reduce((sum, p) => sum + Math.max(0, p.currentStock), 0);
      const totalRev = shopSales.reduce((sum, s) => sum + s.total, 0);

      metrics[sh.id] = {
        productsCount: shopProducts.length,
        totalUnits,
        inventoryValuation: totalVal,
        sellersCount: shopSellers.length,
        salesCount: shopSales.length,
        salesRevenue: totalRev,
      };
    });

    return metrics;
  }, [dbState.shops, dbState.products, dbState.users, dbState.sales]);

  const handleOpenCreate = () => {
    setFormData({
      name: '',
      code: '',
      description: '',
      address: '',
      phone: '',
      status: 'ACTIVE',
    });
    setIsCreateModalOpen(true);
  };

  const handleOpenEdit = (shop: Shop) => {
    setEditingShop(shop);
    setFormData({
      name: shop.name,
      code: shop.code || '',
      description: shop.description || '',
      address: shop.address || '',
      phone: shop.phone || '',
      status: shop.status,
    });
  };

  const handleSaveShop = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    if (editingShop) {
      const res = ShopService.updateShop(
        editingShop.id,
        {
          name: formData.name,
          code: formData.code,
          description: formData.description,
          address: formData.address,
          phone: formData.phone,
          status: formData.status,
        },
        currentUser
      );

      if (res.success) {
        addToast({
          type: 'success',
          title: 'Shop Updated',
          description: `Business unit "${formData.name}" details updated successfully.`,
        });
        setEditingShop(null);
      } else {
        addToast({
          type: 'error',
          title: 'Update Failed',
          description: res.error || 'Failed to update shop.',
        });
      }
    } else {
      const res = ShopService.createShop(
        {
          name: formData.name,
          code: formData.code,
          description: formData.description,
          address: formData.address,
          phone: formData.phone,
          status: formData.status,
        },
        currentUser
      );

      if (res.success) {
        addToast({
          type: 'success',
          title: 'Shop Created',
          description: `New business unit "${formData.name}" added to company.`,
        });
        setIsCreateModalOpen(false);
      } else {
        addToast({
          type: 'error',
          title: 'Creation Failed',
          description: res.error || 'Failed to create shop.',
        });
      }
    }
  };

  const handleToggleStatus = (shop: Shop) => {
    if (!currentUser) return;
    const newStatus: ShopStatus = shop.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    const res = ShopService.toggleShopStatus(shop.id, newStatus, currentUser);
    if (res.success) {
      addToast({
        type: newStatus === 'ACTIVE' ? 'success' : 'warning',
        title: newStatus === 'ACTIVE' ? 'Shop Activated' : 'Shop Deactivated',
        description: `Shop "${shop.name}" is now ${newStatus.toLowerCase()}. Historical data remains completely preserved.`,
      });
      setDeactivatingShop(null);
    } else {
      addToast({
        type: 'error',
        title: 'Status Update Failed',
        description: res.error || 'Failed to toggle status.',
      });
    }
  };

  const handleDeleteShop = () => {
    if (!deletingShop || !currentUser) return;

    const res = ShopService.deleteShop(deletingShop.id, currentUser);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Shop Deleted',
        description: `Shop "${deletingShop.name}" has been permanently deleted along with all related products and categories.`,
      });
    } else {
      addToast({
        type: 'error',
        title: 'Delete Failed',
        description: res.error || 'Could not delete shop.',
      });
    }
    setDeletingShop(null);
  };

  const handleSelectAndJump = (shopId: string, tab: string) => {
    setSelectedShopId(shopId);
    setActiveTab(tab);
  };

  return (
    <div id="admin-shops-management" className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 p-5 rounded-xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Store className="w-6 h-6 text-amber-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Shops & Business Units</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Manage multiple independent retail units under {settings.businessName}. Operational data (Products, Inventory, Sales, Expenses, Sellers) are isolated per shop.
          </p>
        </div>

        <button
          id="btn-create-new-shop"
          onClick={handleOpenCreate}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Shop Unit</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            id="search-shops-input"
            type="text"
            placeholder="Search by shop name, code, or description..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-950 text-xs text-slate-200 placeholder-slate-500 px-3 py-1.5 rounded border border-slate-800 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Status:</span>
          <select
            id="filter-shop-status"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="bg-slate-950 text-xs text-slate-200 px-2.5 py-1.5 rounded border border-slate-800 focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Statuses ({(dbState.shops || []).length})</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive Only</option>
          </select>
        </div>
      </div>

      {/* Shops Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {shops.map(shop => {
          const metrics = shopMetrics[shop.id] || {
            productsCount: 0,
            totalUnits: 0,
            inventoryValuation: 0,
            sellersCount: 0,
            salesCount: 0,
            salesRevenue: 0,
          };

          const isActive = shop.status === 'ACTIVE';

          return (
            <div
              key={shop.id}
              id={`shop-card-${shop.id}`}
              className={`bg-slate-900 rounded-xl border transition-all flex flex-col justify-between ${
                isActive ? 'border-slate-800 hover:border-slate-700' : 'border-slate-800/60 opacity-80 bg-slate-950/40'
              }`}
            >
              {/* Card Header */}
              <div className="p-5 border-b border-slate-800/80">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${
                        isActive
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      <Store className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm text-white">{shop.name}</h3>
                        {shop.code && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            {shop.code}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 line-clamp-1">{shop.description || 'No description'}</p>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                      isActive
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    }`}
                  >
                    {shop.status}
                  </span>
                </div>

                {/* Location & Contact */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800/50">
                  {shop.address && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-500" />
                      {shop.address}
                    </span>
                  )}
                  {shop.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-slate-500" />
                      {shop.phone}
                    </span>
                  )}
                  {!shop.address && !shop.phone && (
                    <span className="text-slate-600 italic">No address/phone configured</span>
                  )}
                </div>
              </div>

              {/* Card Metrics Summary */}
              <div className="p-4 grid grid-cols-3 gap-2 bg-slate-950/40 text-center">
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Catalog</span>
                  <span className="text-xs font-bold text-slate-200">{metrics.productsCount} SKUs</span>
                </div>
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Assigned Sellers</span>
                  <span className="text-xs font-bold text-blue-400">{metrics.sellersCount} Staff</span>
                </div>
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Gross Sales</span>
                  <span className="text-xs font-bold text-emerald-400">{formatCurrency(metrics.salesRevenue, settings.currencySymbol)}</span>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="p-3 border-t border-slate-800 flex items-center justify-between gap-2 bg-slate-900">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleSelectAndJump(shop.id, 'products')}
                    title="View products in this shop"
                    className="text-[11px] text-blue-400 hover:text-blue-300 hover:bg-slate-800 px-2 py-1 rounded transition flex items-center gap-1"
                  >
                    <Boxes className="w-3 h-3" />
                    Products
                  </button>
                  <button
                    onClick={() => handleSelectAndJump(shop.id, 'sales')}
                    title="View sales in this shop"
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 px-2 py-1 rounded transition flex items-center gap-1"
                  >
                    <ShoppingCart className="w-3 h-3" />
                    Sales
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    id={`btn-edit-shop-${shop.id}`}
                    onClick={() => handleOpenEdit(shop)}
                    className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition"
                    title="Edit Shop Information"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    id={`btn-toggle-shop-status-${shop.id}`}
                    onClick={() => setDeactivatingShop(shop)}
                    className={`p-1.5 rounded transition ${
                      isActive
                        ? 'text-rose-400 hover:text-rose-300 hover:bg-rose-950/40'
                        : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40'
                    }`}
                    title={isActive ? 'Deactivate Shop' : 'Activate Shop'}
                  >
                    {isActive ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    onClick={() => setDeletingShop(shop)}
                    className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded transition"
                    title="Delete Shop"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {shops.length === 0 && (
        <div className="p-12 text-center bg-slate-900/40 rounded-xl border border-slate-800 flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-950/40 border border-blue-800/50 flex items-center justify-center text-blue-400 mb-4 shadow-lg">
            <Store className="w-8 h-8" />
          </div>
          <h4 className="text-base font-bold text-white mb-1">No Shops Created Yet</h4>
          <p className="text-xs text-slate-400 max-w-md mb-6 leading-relaxed">
            {search
              ? 'No business units match your query.'
              : 'Your workspace has a clean slate. Create your first shop, branch, or retail unit to begin adding inventory, sellers, and processing sales.'}
          </p>
          {!search && (
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Shop</span>
            </button>
          )}
        </div>
      )}

      {/* Delete Shop Confirmation Modal */}
      {deletingShop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3 text-rose-400">
                <Trash2 className="w-6 h-6 shrink-0" />
                <h3 className="font-bold text-sm text-white">Delete Shop "{deletingShop.name}"?</h3>
              </div>

              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-200 text-xs mb-4">
                <strong>Warning:</strong> This action is permanent and cannot be undone.
              </div>

              <p className="text-xs text-slate-300 leading-relaxed mb-4">
                Deleting this shop will permanently remove:
                <br /><br />
                • All products in this shop ({shopMetrics[deletingShop.id]?.productsCount || 0} products)
                <br />
                • All categories assigned to this shop
                <br />
                • Shop assignment from all sellers
                <br /><br />
                <strong className="text-amber-400">Note:</strong> Historical sales records will be preserved for reporting purposes.
              </p>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setDeletingShop(null)}
                  className="px-4 py-2 rounded text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteShop}
                  className="px-5 py-2 rounded text-xs font-semibold shadow-sm transition text-white bg-rose-600 hover:bg-rose-500"
                >
                  Delete Shop Permanently
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {(isCreateModalOpen || editingShop) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2">
                <Store className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-sm text-white">
                  {editingShop ? `Edit Shop: ${editingShop.name}` : 'Create New Shop / Business Unit'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setEditingShop(null);
                }}
                className="text-slate-400 hover:text-white p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveShop} className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Shop Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Stationery, Hardware, Clothing"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded border border-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Code / Prefix</label>
                  <input
                    type="text"
                    placeholder="e.g. STAT, HDW"
                    value={formData.code}
                    onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded border border-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Description / Category Focus</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Office supplies, books, printing services..."
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded border border-slate-800 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Address / Wing Location</label>
                  <input
                    type="text"
                    placeholder="e.g. Wing B, Ground Floor"
                    value={formData.address}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded border border-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Direct Phone / Ext</label>
                  <input
                    type="text"
                    placeholder="e.g. +1 555-0199"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded border border-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Operational Status</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value as ShopStatus })}
                  className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded border border-slate-800 focus:outline-none focus:border-blue-500"
                >
                  <option value="ACTIVE">ACTIVE (Open for POS sales & operations)</option>
                  <option value="INACTIVE">INACTIVE (Temporarily closed, records preserved)</option>
                </select>
              </div>

              <div className="bg-slate-950/60 p-3 rounded border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <span>
                  Creating or editing a shop immediately enables isolated product inventories, sales counters, and seller assignments.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateModalOpen(false);
                    setEditingShop(null);
                  }}
                  className="px-4 py-2 rounded text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition"
                >
                  {editingShop ? 'Save Changes' : 'Create Shop Unit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STATUS TOGGLE CONFIRMATION MODAL */}
      {deactivatingShop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3 text-amber-400">
                <AlertTriangle className="w-6 h-6 shrink-0" />
                <h3 className="font-bold text-sm text-white">
                  {deactivatingShop.status === 'ACTIVE'
                    ? `Deactivate Shop "${deactivatingShop.name}"?`
                    : `Activate Shop "${deactivatingShop.name}"?`}
                </h3>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed mb-4">
                {deactivatingShop.status === 'ACTIVE' ? (
                  <>
                    Deactivating this shop will hide it from the active POS seller terminal and prevent new sales or purchases from being recorded for this location.
                    <br />
                    <br />
                    <strong className="text-emerald-400">Safe Operation Guarantee:</strong> All historical sales, past receipts, purchase history, and product stocks remain 100% saved in the local database and company reporting.
                  </>
                ) : (
                  <>
                    Activating this shop will immediately reopen it for POS seller checkouts, inventory stock movements, and operational expense logs.
                  </>
                )}
              </p>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setDeactivatingShop(null)}
                  className="px-4 py-2 rounded text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleStatus(deactivatingShop)}
                  className={`px-5 py-2 rounded text-xs font-semibold shadow-sm transition text-white ${
                    deactivatingShop.status === 'ACTIVE'
                      ? 'bg-rose-600 hover:bg-rose-500'
                      : 'bg-emerald-600 hover:bg-emerald-500'
                  }`}
                >
                  {deactivatingShop.status === 'ACTIVE' ? 'Confirm Deactivation' : 'Reactivate Shop'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
