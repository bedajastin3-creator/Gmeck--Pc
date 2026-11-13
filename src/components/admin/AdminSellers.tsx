import React, { useState, useRef } from 'react';
import {
  Users,
  UserPlus,
  Edit,
  KeyRound,
  Shield,
  Palette,
  Power,
  X,
  AlertCircle,
  Check,
  CheckCircle2,
  Lock,
  Store,
  Camera,
  Upload,
  Trash2,
  Key,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SellerService } from '../../services/sellerService';
import { AuthService } from '../../services/authService';
import { StorageService } from '../../db/storage';
import { CloudflareApi } from '../../services/cloudflareApi';
import { User, SellerPermissions } from '../../types';
import { SELLER_COLORS, getSellerColorById } from '../../utils/colors';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

export const AdminSellers: React.FC = () => {
  const { currentUser, dbState, addToast, refreshUser } = useApp();

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState<User | null>(null);
  const [deletingSeller, setDeletingSeller] = useState<User | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectedColor, setSelectedColor] = useState('blue');
  const [assignedShopIds, setAssignedShopIds] = useState<string[]>([]);
  const [sellerPermissions, setSellerPermissions] = useState<SellerPermissions>({});
  const [formError, setFormError] = useState('');

  // Password reset state
  const [newAdminSetPass, setNewAdminSetPass] = useState('');
  const [passError, setPassError] = useState('');

  // Avatar upload state
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [uploadingSellerId, setUploadingSellerId] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Permission check: Admin OR Seller with canManageSellers
  if (!currentUser) return null;
  if (currentUser.role !== 'ADMIN' && !currentUser.permissions?.canManageSellers) return null;

  const sellers = dbState.users.filter(u => u.role === 'SELLER');
  const allShops = dbState.shops || [];

  // Helper to compress image
  const compressImage = (file: File, maxWidth: number, maxHeight: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          if (width > maxWidth) {
            height = (maxWidth / width) * height;
            width = maxWidth;
          }
          if (height > maxHeight) {
            width = (maxHeight / height) * width;
            height = maxHeight;
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to compress image'));
          }, 'image/jpeg', 0.8);
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleAvatarUpload = async (sellerId: string, file: File) => {
    if (!file) return;

    setUploadingSellerId(sellerId);
    setIsUploadingAvatar(true);
    
    try {
      const compressed = await compressImage(file, 200, 200);
      const result = await CloudflareApi.uploadImage(compressed, 'seller', sellerId);
      
      if (result.success) {
        const users = StorageService.getUsers();
        const userIndex = users.findIndex(u => u.id === sellerId);
        if (userIndex !== -1) {
          users[userIndex].avatarUrl = result.url;
          StorageService.saveUsers(users);
          if (refreshUser) refreshUser();
        }
        
        addToast({
          type: 'success',
          title: 'Profile Picture Updated',
          description: 'Seller profile picture has been updated successfully.',
        });
      }
    } catch (error: any) {
      addToast({
        type: 'error',
        title: 'Upload Failed',
        description: error.message || 'Could not upload profile picture.',
      });
    } finally {
      setIsUploadingAvatar(false);
      setUploadingSellerId(null);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
    }
  };

  const handleAvatarClick = (sellerId: string) => {
    if (avatarInputRef.current) {
      avatarInputRef.current.click();
      avatarInputRef.current.dataset.sellerId = sellerId;
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const sellerId = e.target.dataset.sellerId;
    if (file && sellerId) {
      handleAvatarUpload(sellerId, file);
    }
  };

  const openAddModal = () => {
    setName('');
    setUsername('');
    setPassword('');
    setSelectedColor('blue');
    const activeShopIds = allShops.filter(s => s.status === 'ACTIVE').map(s => s.id);
    setAssignedShopIds(activeShopIds.length > 0 ? [activeShopIds[0]] : []);
    setSellerPermissions({});
    setFormError('');
    setIsAddModalOpen(true);
  };

  const openEditModal = (s: User) => {
    setSelectedSeller(s);
    setName(s.name);
    setSelectedColor(s.color || 'blue');
    setAssignedShopIds(s.assignedShopIds || []);
    setSellerPermissions(s.permissions || {});
    setFormError('');
    setIsEditModalOpen(true);
  };

  const openPasswordModal = (s: User) => {
    setSelectedSeller(s);
    setNewAdminSetPass('');
    setPassError('');
    setIsPasswordModalOpen(true);
  };

  const toggleShopSelection = (shopId: string) => {
    setAssignedShopIds(prev =>
      prev.includes(shopId) ? prev.filter(id => id !== shopId) : [...prev, shopId]
    );
  };

  const togglePermission = (key: keyof SellerPermissions) => {
    setSellerPermissions(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleCreateSeller = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!name.trim() || !username.trim() || !password) {
      setFormError('All required fields must be filled.');
      return;
    }

    if (assignedShopIds.length === 0) {
      setFormError('Please select at least one shop for this seller.');
      return;
    }

    const res = await SellerService.createSeller(
      {
        name: name.trim(),
        username: username.trim().toLowerCase(),
        password,
        color: selectedColor,
        assignedShopIds,
        permissions: sellerPermissions,
      },
      currentUser
    );

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Seller Account Created',
        description: `Account for '${name}' (@${username}) is ready for login.`,
      });
      setIsAddModalOpen(false);
    } else {
      setFormError(res.error || 'Failed to create seller.');
    }
  };

  const handleUpdateSeller = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSeller) return;

    if (assignedShopIds.length === 0) {
      setFormError('Please select at least one shop for this seller.');
      return;
    }

    const res = SellerService.updateSeller(
      selectedSeller.id,
      {
        name: name.trim(),
        color: selectedColor,
        assignedShopIds,
        permissions: sellerPermissions,
      },
      currentUser
    );

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Seller Updated',
        description: `Profile, shop assignments, and permissions for '${name}' updated.`,
      });
      setIsEditModalOpen(false);
    } else {
      setFormError(res.error || 'Failed to update seller.');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSeller) return;

    if (!newAdminSetPass || newAdminSetPass.length < 4) {
      setPassError('Password must be at least 4 characters long.');
      return;
    }

    const res = await AuthService.adminResetPassword(
      selectedSeller.id,
      newAdminSetPass,
      currentUser
    );

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Password Overridden',
        description: `New password assigned to @${selectedSeller.username}.`,
      });
      setIsPasswordModalOpen(false);
    } else {
      setPassError(res.error || 'Failed to update password.');
    }
  };

  const handleToggleStatus = (s: User) => {
    const newStatus = s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const res = SellerService.toggleSellerStatus(s.id, newStatus, currentUser);

    if (res.success) {
      addToast({
        type: 'info',
        title: `Seller ${newStatus === 'ACTIVE' ? 'Activated' : 'Deactivated'}`,
        description: `${s.name} is now ${newStatus}. Historical data preserved.`,
      });
    }
  };

  const handleDeleteSeller = () => {
    if (!deletingSeller || !currentUser) return;

    const res = SellerService.deleteSeller(deletingSeller.id, currentUser);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Seller Deleted',
        description: `${deletingSeller.name} (@${deletingSeller.username}) has been permanently deleted.`,
      });
    } else {
      addToast({
        type: 'error',
        title: 'Delete Failed',
        description: res.error || 'Could not delete seller.',
      });
    }
    setDeletingSeller(null);
  };

  return (
    <div id="admin-sellers-view" className="flex-1 p-6 bg-slate-950 text-slate-100 overflow-y-auto space-y-6">
      {/* Hidden file input for avatar uploads */}
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Seller Account & Shop Assignments</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Create cashier logins, assign specific shop units, override passwords, customize UI color signatures, and manage access
          </p>
        </div>

        <button
          id="create-seller-btn"
          onClick={openAddModal}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg transition"
        >
          <UserPlus className="w-4 h-4" />
          <span>New Seller Account</span>
        </button>
      </div>

      {/* Sellers Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {sellers.map(seller => {
          const colorObj = getSellerColorById(seller.color || 'blue');
          const isActive = seller.status === 'ACTIVE';
          const sellerShops = allShops.filter(sh => (seller.assignedShopIds || []).includes(sh.id));
          const sellerSales = dbState.sales.filter(s => s.sellerId === seller.id);
          const totalSalesVolume = sellerSales.reduce(
            (sum, s) => (s.status === 'COMPLETED' ? sum + s.total : sum),
            0
          );
          const permissionCount = Object.values(seller.permissions || {}).filter(Boolean).length;

          return (
            <div
              key={seller.id}
              className={`p-5 rounded-2xl border bg-slate-900 flex flex-col justify-between transition ${
                isActive ? 'border-slate-800 shadow-xl' : 'border-slate-800/50 opacity-60'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="relative group">
                      {seller.avatarUrl ? (
                        <img 
                          src={seller.avatarUrl} 
                          alt={seller.name} 
                          className="w-12 h-12 rounded-xl object-cover shadow"
                        />
                      ) : (
                        <div
                          className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg text-white shadow"
                          style={{ backgroundColor: colorObj.primary }}
                        >
                          {seller.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      
                      <button
                        onClick={() => handleAvatarClick(seller.id)}
                        disabled={isUploadingAvatar && uploadingSellerId === seller.id}
                        className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                        title="Upload profile picture"
                      >
                        {isUploadingAvatar && uploadingSellerId === seller.id ? (
                          <Upload className="w-4 h-4 text-white animate-pulse" />
                        ) : (
                          <Camera className="w-4 h-4 text-white" />
                        )}
                      </button>
                    </div>
                    
                    <div>
                      <h3 className="font-bold text-white text-sm">{seller.name}</h3>
                      <p className="text-xs text-slate-400 font-mono">@{seller.username}</p>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      isActive
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    }`}
                  >
                    {seller.status}
                  </span>
                </div>

                {/* Assigned Shops Badges */}
                <div className="mb-3">
                  <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                    <Store className="w-3 h-3 text-amber-400" />
                    Assigned Shop Units:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {sellerShops.length > 0 ? (
                      sellerShops.map(sh => (
                        <span
                          key={sh.id}
                          className={`text-[11px] px-2 py-0.5 rounded-md font-medium border ${
                            sh.status === 'ACTIVE'
                              ? 'bg-slate-950 text-blue-300 border-slate-700'
                              : 'bg-rose-950/30 text-rose-400 border-rose-900/50'
                          }`}
                        >
                          🏪 {sh.name} {sh.status === 'INACTIVE' && '(Inactive)'}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-rose-400 italic">No assigned shops</span>
                    )}
                  </div>
                </div>

                {/* Permissions Badges */}
                {permissionCount > 0 && (
                  <div className="mb-3">
                    <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                      <Shield className="w-3 h-3 text-blue-400" />
                      Granted Permissions:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {seller.permissions?.canEditProducts && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950/50 text-blue-300 border border-blue-800/40">
                          Edit Products
                        </span>
                      )}
                      {seller.permissions?.canDeleteProducts && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/50 text-rose-300 border border-rose-800/40">
                          Delete Products
                        </span>
                      )}
                      {seller.permissions?.canManageInventory && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/50 text-amber-300 border border-amber-800/40">
                          Inventory
                        </span>
                      )}
                      {seller.permissions?.canEditSales && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/50 text-emerald-300 border border-emerald-800/40">
                          Edit Sales
                        </span>
                      )}
                      {seller.permissions?.canDeleteSales && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950/50 text-purple-300 border border-purple-800/40">
                          Void Sales
                        </span>
                      )}
                      {seller.permissions?.canManageDebts && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/50 text-cyan-300 border border-cyan-800/40">
                          All Debts
                        </span>
                      )}
                      {seller.permissions?.canViewReports && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950/50 text-indigo-300 border border-indigo-800/40">
                          Reports
                        </span>
                      )}
                      {seller.permissions?.canRecordPurchases && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-950/50 text-orange-300 border border-orange-800/40">
                          Purchases
                        </span>
                      )}
                      {seller.permissions?.canViewExpenses && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-950/50 text-teal-300 border border-teal-800/40">
                          Expenses
                        </span>
                      )}
                      {seller.permissions?.canRecordExpenses && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-lime-950/50 text-lime-300 border border-lime-800/40">
                          Record Expenses
                        </span>
                      )}
                      {seller.permissions?.canManageShops && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-950/50 text-pink-300 border border-pink-800/40">
                          Manage Shops
                        </span>
                      )}
                      {seller.permissions?.canManageSellers && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300 border border-slate-600/40">
                          Manage Sellers
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 space-y-1.5 text-xs mb-4">
                  <div className="flex justify-between text-slate-400">
                    <span>Account Color</span>
                    <span className="font-semibold text-white flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block"
                        style={{ backgroundColor: colorObj.primary }}
                      ></span>
                      {colorObj.name}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Lifetime Sales</span>
                    <span className="font-mono text-emerald-400 font-semibold">
                      {formatCurrency(totalSalesVolume, dbState.settings?.currencySymbol || 'TSh')} ({sellerSales.length})
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Permissions Granted</span>
                    <span className="font-mono text-blue-400 font-semibold flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      {permissionCount}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Registered</span>
                    <span className="font-mono text-slate-400">{seller.createdAt.slice(0, 10)}</span>
                  </div>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="grid grid-cols-4 gap-1.5 pt-3 border-t border-slate-800 text-xs">
                <button
                  onClick={() => openEditModal(seller)}
                  className="py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition flex items-center justify-center gap-1"
                >
                  <Edit className="w-3.5 h-3.5 text-slate-400" />
                  <span>Edit</span>
                </button>

                <button
                  onClick={() => openPasswordModal(seller)}
                  className="py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition flex items-center justify-center gap-1"
                >
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  <span>Password</span>
                </button>

                <button
                  onClick={() => handleToggleStatus(seller)}
                  className={`py-1.5 rounded-lg font-medium transition flex items-center justify-center gap-1 ${
                    isActive
                      ? 'bg-rose-500/15 hover:bg-rose-600 hover:text-white text-rose-300 border border-rose-500/30'
                      : 'bg-emerald-500/15 hover:bg-emerald-600 hover:text-white text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{isActive ? 'Disable' : 'Enable'}</span>
                </button>

                <button
                  onClick={() => setDeletingSeller(seller)}
                  className="py-1.5 rounded-lg bg-slate-800 hover:bg-rose-600 hover:text-white text-slate-400 font-medium transition flex items-center justify-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Delete Confirmation Modal */}
      {deletingSeller && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2 text-rose-400">
                <Trash2 className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">Delete Seller?</h3>
              </div>
              <button onClick={() => setDeletingSeller(null)} className="text-slate-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-200 text-xs mb-4">
              <strong>Warning:</strong> This action is permanent and cannot be undone.
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Are you sure you want to delete <strong className="text-white">{deletingSeller.name}</strong> (@{deletingSeller.username})?
              <br /><br />
              This will permanently remove the seller account. Historical sales records will be preserved.
            </p>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setDeletingSeller(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSeller}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition"
              >
                Delete Seller
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Seller */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Create Seller Account</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
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

            <form onSubmit={handleCreateSeller} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. David Brown"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Username / Account ID *</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="e.g. david"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Initial Password *</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Set login password..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Shop Assignment Checkboxes */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5 flex items-center justify-between">
                  <span>Assigned Shop Units *</span>
                  <span className="text-[10px] text-slate-400 font-normal">Select one or more</span>
                </label>
                <div className="space-y-1.5 max-h-36 overflow-y-auto p-2 rounded-lg bg-slate-950 border border-slate-800">
                  {allShops.map(sh => (
                    <label
                      key={sh.id}
                      className="flex items-center gap-2.5 p-1.5 rounded hover:bg-slate-900 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={assignedShopIds.includes(sh.id)}
                        onChange={() => toggleShopSelection(sh.id)}
                        className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-200">
                        🏪 {sh.name}
                        {sh.status === 'INACTIVE' && <span className="text-rose-400 text-[10px] ml-1">(Inactive)</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Permissions Section */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5 flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-blue-400" />
                  <span>Permissions Granted</span>
                </label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Edit Products (Modify existing)</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canEditProducts || false}
                      onChange={() => togglePermission('canEditProducts')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Delete Products</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canDeleteProducts || false}
                      onChange={() => togglePermission('canDeleteProducts')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Manage Inventory (Stock adjustments)</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canManageInventory || false}
                      onChange={() => togglePermission('canManageInventory')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Edit Sales (No approval needed)</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canEditSales || false}
                      onChange={() => togglePermission('canEditSales')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Void Sales</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canDeleteSales || false}
                      onChange={() => togglePermission('canDeleteSales')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Manage All Debts (Not just own)</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canManageDebts || false}
                      onChange={() => togglePermission('canManageDebts')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">View Financial Reports</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canViewReports || false}
                      onChange={() => togglePermission('canViewReports')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Record Purchases</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canRecordPurchases || false}
                      onChange={() => togglePermission('canRecordPurchases')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">View Expenses</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canViewExpenses || false}
                      onChange={() => togglePermission('canViewExpenses')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Record Expenses</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canRecordExpenses || false}
                      onChange={() => togglePermission('canRecordExpenses')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Manage Shops</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canManageShops || false}
                      onChange={() => togglePermission('canManageShops')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Manage Sellers</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canManageSellers || false}
                      onChange={() => togglePermission('canManageSellers')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1.5">Signature Color Theme</label>
                <div className="grid grid-cols-4 gap-2">
                  {SELLER_COLORS.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedColor(c.id)}
                      className={`p-2 rounded-lg border text-center transition flex flex-col items-center gap-1 ${
                        selectedColor === c.id
                          ? 'bg-slate-800 border-white text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: c.primary }}
                      >
                        {selectedColor === c.id && <Check className="w-3 h-3 text-white" />}
                      </span>
                      <span className="text-[10px]">{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow transition"
                >
                  Create Seller Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Seller */}
      {isEditModalOpen && selectedSeller && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white">Edit Seller @{selectedSeller.username}</h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
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

            <form onSubmit={handleUpdateSeller} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Shop Assignment Checkboxes */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5 flex items-center justify-between">
                  <span>Assigned Shop Units *</span>
                  <span className="text-[10px] text-slate-400 font-normal">Check all shops seller can access</span>
                </label>
                <div className="space-y-1.5 max-h-36 overflow-y-auto p-2 rounded-lg bg-slate-950 border border-slate-800">
                  {allShops.map(sh => (
                    <label
                      key={sh.id}
                      className="flex items-center gap-2.5 p-1.5 rounded hover:bg-slate-900 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={assignedShopIds.includes(sh.id)}
                        onChange={() => toggleShopSelection(sh.id)}
                        className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-200">
                        🏪 {sh.name}
                        {sh.status === 'INACTIVE' && <span className="text-rose-400 text-[10px] ml-1">(Inactive)</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Permissions Section */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5 flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-blue-400" />
                  <span>Permissions Granted</span>
                </label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Edit Products (Modify existing)</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canEditProducts || false}
                      onChange={() => togglePermission('canEditProducts')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Delete Products</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canDeleteProducts || false}
                      onChange={() => togglePermission('canDeleteProducts')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Manage Inventory (Stock adjustments)</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canManageInventory || false}
                      onChange={() => togglePermission('canManageInventory')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Edit Sales (No approval needed)</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canEditSales || false}
                      onChange={() => togglePermission('canEditSales')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Void Sales</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canDeleteSales || false}
                      onChange={() => togglePermission('canDeleteSales')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Manage All Debts (Not just own)</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canManageDebts || false}
                      onChange={() => togglePermission('canManageDebts')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">View Financial Reports</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canViewReports || false}
                      onChange={() => togglePermission('canViewReports')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Record Purchases</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canRecordPurchases || false}
                      onChange={() => togglePermission('canRecordPurchases')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">View Expenses</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canViewExpenses || false}
                      onChange={() => togglePermission('canViewExpenses')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Record Expenses</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canRecordExpenses || false}
                      onChange={() => togglePermission('canRecordExpenses')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Manage Shops</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canManageShops || false}
                      onChange={() => togglePermission('canManageShops')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                  
                  <label className="flex items-center justify-between cursor-pointer p-1.5 rounded hover:bg-slate-900">
                    <span className="text-xs text-slate-200">Manage Sellers</span>
                    <input
                      type="checkbox"
                      checked={sellerPermissions.canManageSellers || false}
                      onChange={() => togglePermission('canManageSellers')}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1.5">Signature Color Theme</label>
                <div className="grid grid-cols-4 gap-2">
                  {SELLER_COLORS.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedColor(c.id)}
                      className={`p-2 rounded-lg border text-center transition flex flex-col items-center gap-1 ${
                        selectedColor === c.id
                          ? 'bg-slate-800 border-white text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: c.primary }}
                      >
                        {selectedColor === c.id && <Check className="w-3 h-3 text-white" />}
                      </span>
                      <span className="text-[10px]">{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow transition"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Admin Password Reset */}
      {isPasswordModalOpen && selectedSeller && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Reset Seller Password</h3>
              </div>
              <button
                onClick={() => setIsPasswordModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Set a new login password for <strong>{selectedSeller.name}</strong> (@{selectedSeller.username}).
            </p>

            {passError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                {passError}
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">New Password</label>
                <input
                  type="password"
                  required
                  value={newAdminSetPass}
                  onChange={e => setNewAdminSetPass(e.target.value)}
                  placeholder="Enter new password..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsPasswordModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold shadow transition"
                >
                  Override Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
