import React, { useState, useMemo, useEffect } from 'react';
import {
  Store,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Edit2,
  Boxes,
  Users,
  ShoppingCart,
  Phone,
  MapPin,
  AlertTriangle,
  Info,
  Shield,
  UserCheck,
  UserX,
  Trash2,
  ArrowLeft,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ShopService } from '../../services/shopService';
import { CloudflareApi } from '../../services/cloudflareApi';
import { Shop, ShopStatus, User } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { getShopAdminShopIds, isPlatformAdmin, isShopAdmin } from '../../utils/permissions';

export const AdminShops: React.FC = () => {
  const {
    currentUser,
    dbState,
    addToast,
    selectedShopId,
    setSelectedShopId,
    setActiveTab,
    shopsSubTab,
    setShopsSubTab,
    shopsNavTick,
  } = useApp();
  const settings = dbState.settings;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ShopStatus>('ALL');

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingShop, setEditingShop] = useState<Shop | null>(null);
  const [deactivatingShop, setDeactivatingShop] = useState<Shop | null>(null);
  const [deletingShop, setDeletingShop] = useState<Shop | null>(null);
  const [isDeletingShop, setIsDeletingShop] = useState(false);
  const [shopAdminModalShop, setShopAdminModalShop] = useState<Shop | null>(null);
  const [selectedAdminSellerId, setSelectedAdminSellerId] = useState<string>('');

  const platformAdmin = isPlatformAdmin(currentUser);
  const shopAdm = isShopAdmin(currentUser);
  const explicitManagedShopIds = getShopAdminShopIds(currentUser);
  const managedShopIds = useMemo(() => {
    if (explicitManagedShopIds.length > 0) return explicitManagedShopIds;
    if (currentUser?.permissions?.canManageShops) {
      return currentUser.assignedShopIds || [];
    }
    return [];
  }, [explicitManagedShopIds, currentUser]);

  // Form inputs
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    address: '',
    phone: '',
    status: 'ACTIVE' as ShopStatus,
  });

  const accessibleAllShops = useMemo(() => {
    const all = dbState.shops || [];
    if (platformAdmin) return all;
    if (shopAdm) return all.filter(s => managedShopIds.includes(s.id));
    return [];
  }, [dbState.shops, platformAdmin, shopAdm, managedShopIds]);

  const shops = useMemo(() => {
    const base = ShopService.getShops({
      status: statusFilter,
      search,
    });
    if (platformAdmin) return base;
    if (shopAdm) return base.filter(s => managedShopIds.includes(s.id));
    return [];
  }, [dbState.shops, statusFilter, search, platformAdmin, shopAdm, managedShopIds]);

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

  // Sync with collapsible Shops & Business Unit menu navigation
  useEffect(() => {
    if (shopsNavTick === 0) return;
    setEditingShop(null);
    setIsCreateModalOpen(false);
    if (shopsSubTab === 'add') {
      setFormData({
        name: '',
        code: '',
        description: '',
        address: '',
        phone: '',
        status: 'ACTIVE',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopsNavTick]);

  useEffect(() => {
    if (shopsSubTab === 'list') {
      setEditingShop(null);
      setIsCreateModalOpen(false);
    }
  }, [shopsSubTab]);

  const eligibleSellersForModal: User[] = useMemo(() => {
    if (!shopAdminModalShop) return [];
    return (dbState.users || []).filter(
      u =>
        u.role === 'SELLER' &&
        u.status === 'ACTIVE' &&
        (u.assignedShopIds || []).includes(shopAdminModalShop.id)
    );
  }, [dbState.users, shopAdminModalShop]);

  if (!currentUser || (!platformAdmin && !shopAdm && !currentUser.permissions?.canManageShops)) {
    return null;
  }

  const handleOpenCreate = () => {
    setEditingShop(null);
    setFormData({
      name: '',
      code: '',
      description: '',
      address: '',
      phone: '',
      status: 'ACTIVE',
    });
    setShopsSubTab('add');
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
    setShopsSubTab('add');
  };

  const handleSaveShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    if (editingShop) {
      const res = await ShopService.updateShop(
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
        setShopsSubTab('list');
      } else {
        addToast({
          type: 'error',
          title: 'Update Failed',
          description: res.error || 'Failed to update shop.',
        });
      }
    } else {
      const res = await ShopService.createShop(
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
        setShopsSubTab('list');
      } else {
        addToast({
          type: 'error',
          title: 'Creation Failed',
          description: res.error || 'Failed to create shop.',
        });
      }
    }
  };

  const handleToggleStatus = async (shop: Shop) => {
    if (!currentUser) return;
    const newStatus: ShopStatus = shop.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    const res = await ShopService.toggleShopStatus(shop.id, newStatus, currentUser);
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

  const handleConfirmDeleteShop = async () => {
    if (!currentUser || !deletingShop || isDeletingShop) return;
    setIsDeletingShop(true);
    const targetShop = deletingShop;
    try {
      const res = await ShopService.deleteShop(targetShop.id, currentUser);
      if (res.success) {
        if (selectedShopId === targetShop.id) {
          setSelectedShopId('ALL');
        }
        addToast({
          type: 'success',
          title: 'Shop Deleted',
          description: `Shop "${targetShop.name}" and its linked stores/catalog have been deleted.`,
        });
        setDeletingShop(null);
      } else {
        addToast({
          type: 'error',
          title: 'Delete Failed',
          description: res.error || 'Failed to delete shop.',
        });
      }
    } finally {
      setIsDeletingShop(false);
    }
  };

  const handleOpenSetShopAdmin = (shop: Shop) => {
    const currentShopAdmin = ShopService.getShopAdmin(shop.id);
    setShopAdminModalShop(shop);
    setSelectedAdminSellerId(currentShopAdmin?.id || '');
  };

  const handleSaveShopAdmin = async (sellerIdToAssign: string | null) => {
    if (!currentUser || !shopAdminModalShop) return;
    const res = await ShopService.setShopAdmin(shopAdminModalShop.id, sellerIdToAssign, currentUser);
    if (res.success) {
      const assignedSeller = sellerIdToAssign
        ? (dbState.users || []).find(u => u.id === sellerIdToAssign)
        : undefined;
      addToast({
        type: 'success',
        title: assignedSeller ? 'Shop Admin Assigned' : 'Shop Admin Removed',
        description: assignedSeller
          ? `${assignedSeller.name} now manages ${shopAdminModalShop.name} with full shop-scoped admin access.`
          : `Shop Admin role removed from ${shopAdminModalShop.name}.`,
      });
      setShopAdminModalShop(null);
    } else {
      addToast({
        type: 'error',
        title: 'Assignment Failed',
        description: res.error || 'Could not update Shop Admin.',
      });
    }
  };

  const handleSelectAndJump = (shopId: string, tab: string) => {
    setSelectedShopId(shopId);
    setActiveTab(tab);
  };

  if (shopsSubTab === 'add' && (platformAdmin || editingShop)) {
    return (
      <div
        id="admin-shops-add-page"
        className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-6"
      >
        <div className="w-full space-y-4 sm:space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 bg-slate-900/90 p-3.5 sm:p-5 rounded-xl border border-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setEditingShop(null);
                  setIsCreateModalOpen(false);
                  setShopsSubTab('list');
                }}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition shrink-0"
                title="Back to All Shops"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Store className="w-5 h-5 text-amber-400 shrink-0" />
                  <h2 className="text-base sm:text-xl font-bold text-white tracking-tight truncate">
                    {editingShop ? `Edit Shop: ${editingShop.name}` : 'Add New Shop'}
                  </h2>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                  {editingShop
                    ? 'Update business unit details, contact info, and status.'
                    : `Create a new independent shop or business unit under ${settings.businessName}.`}
                </p>
              </div>
            </div>
          </div>

          {/* Full-page Add / Edit Shop Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <form onSubmit={handleSaveShop} className="p-4 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Shop Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Stationery, Hardware, Clothing"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-slate-950 text-xs text-white px-3.5 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Code / Prefix
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. STAT, HDW"
                    value={formData.code}
                    onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full bg-slate-950 text-xs text-white px-3.5 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Description / Category Focus
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Office supplies, books, printing services..."
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className="w-full bg-slate-950 text-xs text-white px-3.5 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Address / Location
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Wing B, Ground Floor"
                    value={formData.address}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    className="w-full bg-slate-950 text-xs text-white px-3.5 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Phone / Contact
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. +255 7XX XXX XXX"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full bg-slate-950 text-xs text-white px-3.5 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Operational Status
                </label>
                <select
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value as ShopStatus })}
                  className="w-full bg-slate-950 text-xs text-white px-3.5 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
                >
                  <option value="ACTIVE">ACTIVE (Open for POS sales & operations)</option>
                  <option value="INACTIVE">INACTIVE (Temporarily closed, records preserved)</option>
                </select>
              </div>

              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <span>
                  Creating or editing a shop immediately enables isolated product inventories, sales counters, and seller assignments.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setEditingShop(null);
                    setIsCreateModalOpen(false);
                    setShopsSubTab('list');
                  }}
                  className="px-4 py-2.5 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition"
                >
                  {editingShop ? 'Save Changes' : 'Create Shop Unit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      id="admin-shops-management"
      className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-6"
    >
      <div className="space-y-4 sm:space-y-6">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 bg-slate-900/90 p-3.5 sm:p-5 rounded-xl border border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <Store className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" />
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">All Shops (List)</h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {platformAdmin
                ? `Manage multiple independent retail units under ${settings.businessName} and designate a Shop Admin from each shop's sellers.`
                : `Manage your designated shop unit${managedShopIds.length > 1 ? 's' : ''} under ${settings.businessName}.`}
            </p>
          </div>

          {platformAdmin && (
            <button
              id="btn-create-new-shop"
              onClick={handleOpenCreate}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3.5 py-2 rounded-xl shadow-sm transition self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Shop</span>
            </button>
          )}
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
          <div className="flex items-center gap-2 flex-1">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              id="search-shops-input"
              type="text"
              placeholder="Search by shop name, code, or description..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-950 text-xs text-slate-200 placeholder-slate-500 px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center justify-between sm:justify-start gap-2">
            <span className="text-xs text-slate-400">Status:</span>
            <select
              id="filter-shop-status"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as 'ALL' | ShopStatus)}
              className="bg-slate-950 text-xs text-slate-200 px-2.5 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500 flex-1 sm:flex-initial"
            >
              <option value="ALL">All Statuses ({accessibleAllShops.length})</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive Only</option>
            </select>
          </div>
        </div>

        {/* Shops Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 sm:gap-5">
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
            const shopAdminUser = ShopService.getShopAdmin(shop.id);

            return (
              <div
                key={shop.id}
                id={`shop-card-${shop.id}`}
                className={`bg-slate-900 rounded-2xl border transition-all flex flex-col justify-between overflow-hidden shadow-lg ${
                  isActive ? 'border-slate-800 hover:border-slate-700' : 'border-slate-800/60 opacity-80 bg-slate-950/40'
                }`}
              >
                {/* Card Header */}
                <div className="p-4 sm:p-5 border-b border-slate-800/80">
                  <div className="flex items-start justify-between gap-2.5 mb-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${
                          isActive
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        <Store className="w-4 h-4 sm:w-5 sm:h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="font-semibold text-xs sm:text-sm text-white">{shop.name}</h3>
                          {shop.code && (
                            <span className="text-[9px] sm:text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                              {shop.code}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-1">{shop.description || 'No description'}</p>
                      </div>
                    </div>

                    <span
                      className={`text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase shrink-0 ${
                        isActive
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {shop.status}
                    </span>
                  </div>

                  {/* Location & Contact */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 mt-2.5 pt-2.5 border-t border-slate-800/50">
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

                  {/* Shop Admin Designation Row */}
                  <div className="mt-2.5 pt-2.5 border-t border-slate-800/50 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Shield
                        className={`w-3.5 h-3.5 shrink-0 ${
                          shopAdminUser ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      />
                      {shopAdminUser ? (
                        <div className="min-w-0">
                          <div className="text-[10px] text-slate-400 font-medium leading-none mb-0.5">
                            Shop Admin
                          </div>
                          <div className="text-xs font-semibold text-emerald-300 truncate">
                            {shopAdminUser.name}{' '}
                            <span className="text-[10px] font-mono text-slate-400">
                              (@{shopAdminUser.username})
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500 italic truncate">
                          No Shop Admin set
                        </span>
                      )}
                    </div>

                    {platformAdmin && (
                      <button
                        id={`btn-set-shop-admin-${shop.id}`}
                        type="button"
                        onClick={() => handleOpenSetShopAdmin(shop)}
                        className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition flex items-center gap-1 ${
                          shopAdminUser
                            ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border-blue-500/30'
                        }`}
                      >
                        <UserCheck className="w-3 h-3" />
                        <span>{shopAdminUser ? 'Change Admin' : 'Set Admin'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Card Metrics Summary */}
                <div className="p-3 sm:p-4 grid grid-cols-3 gap-2 bg-slate-950/40 text-center">
                  <div className="p-1.5 sm:p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
                    <span className="text-[9px] sm:text-[10px] text-slate-400 block mb-0.5">Catalog</span>
                    <span className="text-[11px] sm:text-xs font-bold text-slate-200">{metrics.productsCount} SKUs</span>
                  </div>
                  <div className="p-1.5 sm:p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
                    <span className="text-[9px] sm:text-[10px] text-slate-400 block mb-0.5">Sellers</span>
                    <span className="text-[11px] sm:text-xs font-bold text-blue-400">{metrics.sellersCount} Staff</span>
                  </div>
                  <div className="p-1.5 sm:p-2 rounded-lg bg-slate-900/60 border border-slate-800/60">
                    <span className="text-[9px] sm:text-[10px] text-slate-400 block mb-0.5">Sales</span>
                    <span className="text-[11px] sm:text-xs font-bold text-emerald-400 truncate block">{formatCurrency(metrics.salesRevenue, settings.currencySymbol)}</span>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="p-2.5 sm:p-3 border-t border-slate-800 flex items-center justify-between gap-2 bg-slate-900">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleSelectAndJump(shop.id, 'products')}
                      title="View products in this shop"
                      className="text-[11px] text-blue-400 hover:text-blue-300 hover:bg-slate-800 px-2 py-1 rounded transition flex items-center gap-1"
                    >
                      <Boxes className="w-3 h-3" />
                      <span>Products</span>
                    </button>
                    <button
                      onClick={() => handleSelectAndJump(shop.id, 'sales')}
                      title="View sales in this shop"
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 px-2 py-1 rounded transition flex items-center gap-1"
                    >
                      <ShoppingCart className="w-3 h-3" />
                      <span>Sales</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      id={`btn-edit-shop-${shop.id}`}
                      onClick={() => handleOpenEdit(shop)}
                      className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
                      title="Edit Shop Information"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      id={`btn-toggle-shop-status-${shop.id}`}
                      onClick={() => setDeactivatingShop(shop)}
                      className={`p-1.5 rounded-lg transition ${
                        isActive
                          ? 'text-rose-400 hover:text-rose-300 hover:bg-rose-950/40'
                          : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40'
                      }`}
                      title={isActive ? 'Deactivate Shop' : 'Activate Shop'}
                    >
                      {isActive ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    </button>

                    {platformAdmin && (
                      <button
                        id={`btn-delete-shop-${shop.id}`}
                        type="button"
                        onClick={() => setDeletingShop(shop)}
                        className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 transition"
                        title="Delete Shop Permanently"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {shops.length === 0 && (
          <div className="p-8 sm:p-12 text-center bg-slate-900/40 rounded-2xl border border-slate-800 flex flex-col items-center justify-center">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-blue-950/40 border border-blue-800/50 flex items-center justify-center text-blue-400 mb-4 shadow-lg">
              <Store className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <h4 className="text-sm sm:text-base font-bold text-white mb-1">No Shops Created Yet</h4>
            <p className="text-xs text-slate-400 max-w-md mb-6 leading-relaxed">
              {search
                ? 'No business units match your query.'
                : 'Your workspace has a clean slate. Create your first shop, branch, or retail unit to begin adding inventory, sellers, and processing sales.'}
            </p>
            {!search && platformAdmin && (
              <button
                onClick={handleOpenCreate}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create First Shop</span>
              </button>
            )}
          </div>
        )}

        {/* CREATE / EDIT MODAL */}
        {(isCreateModalOpen || editingShop) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3.5 sm:p-4 backdrop-blur-xs">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
              <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-950 shrink-0">
                <div className="flex items-center gap-2">
                  <Store className="w-5 h-5 text-blue-400" />
                  <h3 className="font-bold text-xs sm:text-sm text-white">
                    {editingShop ? `Edit Shop: ${editingShop.name}` : 'Create New Shop Unit'}
                  </h3>
                </div>
                <button
                  onClick={() => {
                    setIsCreateModalOpen(false);
                    setEditingShop(null);
                  }}
                  className="text-slate-400 hover:text-white p-1 rounded-lg"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveShop} className="p-4 sm:p-5 space-y-3.5 overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Shop Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Stationery, Hardware, Clothing"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Code / Prefix</label>
                    <input
                      type="text"
                      placeholder="e.g. STAT, HDW"
                      value={formData.code}
                      onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500 font-mono"
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
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Address / Location</label>
                    <input
                      type="text"
                      placeholder="e.g. Wing B, Ground Floor"
                      value={formData.address}
                      onChange={e => setFormData({ ...formData, address: e.target.value })}
                      className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Phone / Contact</label>
                    <input
                      type="text"
                      placeholder="e.g. +1 555-0199"
                      value={formData.phone}
                      onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Operational Status</label>
                  <select
                    value={formData.status}
                    onChange={e => setFormData({ ...formData, status: e.target.value as ShopStatus })}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="ACTIVE">ACTIVE (Open for POS sales & operations)</option>
                    <option value="INACTIVE">INACTIVE (Temporarily closed, records preserved)</option>
                  </select>
                </div>

                <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  <span>
                    Creating or editing a shop immediately enables isolated product inventories, sales counters, and seller assignments.
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreateModalOpen(false);
                      setEditingShop(null);
                    }}
                    className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3.5 sm:p-4 backdrop-blur-xs">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
              <div className="p-4 sm:p-5">
                <div className="flex items-center gap-3 mb-3 text-amber-400">
                  <AlertTriangle className="w-6 h-6 shrink-0" />
                  <h3 className="font-bold text-xs sm:text-sm text-white">
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

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setDeactivatingShop(null)}
                    className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(deactivatingShop)}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition text-white ${
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

        {/* PERMANENT DELETE SHOP CONFIRMATION MODAL */}
        {platformAdmin && deletingShop && (() => {
          const shopStoresCount = (dbState.stores || []).filter(s => s.shopId === deletingShop.id).length;
          const shopProductsCount = (dbState.products || []).filter(p => p.shopId === deletingShop.id).length;
          const shopSalesCount = (dbState.sales || []).filter(s => s.shopId === deletingShop.id).length;
          const shopSellersCount = (dbState.users || []).filter(
            u => u.role === 'SELLER' && (u.assignedShopIds || []).includes(deletingShop.id)
          ).length;

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3.5 sm:p-4 backdrop-blur-xs">
              <div className="bg-slate-900 border border-rose-500/40 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
                <div className="p-4 sm:p-5">
                  <div className="flex items-center gap-3 mb-3 text-rose-400">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                      <Trash2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-xs sm:text-sm text-white">
                        Delete Shop "{deletingShop.name}"?
                      </h3>
                      <p className="text-[11px] text-rose-300">
                        This permanent action cannot be undone.
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed mb-3">
                    Deleting this shop permanently removes the business unit from local storage and cloud sync, including:
                  </p>

                  <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Warehouse Stores</div>
                      <div className="font-bold text-slate-200">{shopStoresCount}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Products / SKUs</div>
                      <div className="font-bold text-slate-200">{shopProductsCount}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Sales Records</div>
                      <div className="font-bold text-slate-200">{shopSalesCount}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Assigned Sellers</div>
                      <div className="font-bold text-slate-200">{shopSellersCount}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                    <button
                      type="button"
                      disabled={isDeletingShop}
                      onClick={() => setDeletingShop(null)}
                      className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isDeletingShop}
                      onClick={handleConfirmDeleteShop}
                      className="px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isDeletingShop ? 'Deleting...' : 'Delete Permanently'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* SET / CHANGE SHOP ADMIN MODAL */}
        {platformAdmin && shopAdminModalShop && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3.5 sm:p-4 backdrop-blur-xs">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
              <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-slate-800 bg-slate-950 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Shield className="w-5 h-5 text-emerald-400 shrink-0" />
                  <h3 className="font-bold text-xs sm:text-sm text-white truncate">
                    Shop Admin — {shopAdminModalShop.name}
                  </h3>
                </div>
                <button
                  onClick={() => setShopAdminModalShop(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg"
                >
                  ✕
                </button>
              </div>

              <div className="p-4 sm:p-5 space-y-4 overflow-y-auto text-xs">
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-200/90 leading-relaxed">
                  Choose an active seller assigned to <strong className="text-white">{shopAdminModalShop.name}</strong>. The designated Shop Admin receives full admin permissions (products, stock, sales, expenses, debts, reports, and adding sellers under <strong className="text-white">{shopAdminModalShop.name}</strong>) strictly scoped to this shop.
                </div>

                {eligibleSellersForModal.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-3">
                    <Users className="w-8 h-8 text-slate-600 mx-auto" />
                    <div className="text-slate-300 font-semibold">
                      No Active Sellers Assigned to {shopAdminModalShop.name}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Create or assign an active seller to {shopAdminModalShop.name} first before selecting a Shop Admin.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setShopAdminModalShop(null);
                        setActiveTab('sellers');
                      }}
                      className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
                    >
                      Go to Sellers
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Select Shop Seller ({eligibleSellersForModal.length} available)
                    </label>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {eligibleSellersForModal.map(seller => {
                        const isSelected = selectedAdminSellerId === seller.id;
                        const isCurrentAdmin = getShopAdminShopIds(seller).includes(shopAdminModalShop.id);
                        return (
                          <label
                            key={seller.id}
                            className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition ${
                              isSelected
                                ? 'bg-emerald-500/15 border-emerald-500/50 text-white'
                                : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="radio"
                                name="shop-admin-seller"
                                checked={isSelected}
                                onChange={() => setSelectedAdminSellerId(seller.id)}
                                className="text-emerald-500 focus:ring-emerald-500"
                              />
                              <div className="min-w-0">
                                <div className="font-semibold text-white truncate">{seller.name}</div>
                                <div className="text-[10px] font-mono text-slate-400">@{seller.username}</div>
                              </div>
                            </div>
                            {isCurrentAdmin && (
                              <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                                Current Admin
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-4 sm:px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-2 shrink-0">
                <div>
                  {ShopService.getShopAdmin(shopAdminModalShop.id) && (
                    <button
                      type="button"
                      onClick={() => handleSaveShopAdmin(null)}
                      className="px-3 py-2 rounded-lg text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 transition flex items-center gap-1"
                    >
                      <UserX className="w-3.5 h-3.5" />
                      <span>Remove Admin</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShopAdminModalShop(null)}
                    className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  >
                    Cancel
                  </button>
                  {eligibleSellersForModal.length > 0 && (
                    <button
                      type="button"
                      disabled={!selectedAdminSellerId}
                      onClick={() => handleSaveShopAdmin(selectedAdminSellerId)}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold transition"
                    >
                      Save Shop Admin
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
