import React, { useState, useRef } from 'react';
import {
  Sliders,
  Store,
  Receipt,
  ShieldCheck,
  KeyRound,
  User as UserIcon,
  FileSpreadsheet,
  History,
  Check,
  AlertCircle,
  Camera,
  Upload,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AuthService } from '../../services/authService';
import { StorageService } from '../../db/storage';
import { CloudflareApi } from '../../services/cloudflareApi';
import { formatDateTime } from '../../utils/formatters';

export const AdminSettings: React.FC = () => {
  const { currentUser, dbState, addToast, updateSettings, refreshUser } = useApp();

  // Settings Form
  const [businessName, setBusinessName] = useState(dbState.settings.businessName);
  const [tagline, setTagline] = useState(dbState.settings.tagline);
  const [address, setAddress] = useState(dbState.settings.address);
  const [phone, setPhone] = useState(dbState.settings.phone);
  const [email, setEmail] = useState(dbState.settings.email);
  const [currencySymbol, setCurrencySymbol] = useState(dbState.settings.currencySymbol);
  const [currencyCode, setCurrencyCode] = useState(dbState.settings.currencyCode);
  const [enableTax, setEnableTax] = useState(dbState.settings.enableTax);
  const [taxRatePercent, setTaxRatePercent] = useState(dbState.settings.taxRatePercent.toString());
  const [receiptHeaderNote, setReceiptHeaderNote] = useState(dbState.settings.receiptHeaderNote);
  const [receiptFooterNote, setReceiptFooterNote] = useState(dbState.settings.receiptFooterNote);

  // Admin username state
  const [adminUsername, setAdminUsername] = useState(currentUser?.username || 'Admin');
  const [usernameError, setUsernameError] = useState('');
  const [isChangingUsername, setIsChangingUsername] = useState(false);

  // Admin password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isChangingPass, setIsChangingPass] = useState(false);

  // Avatar upload state
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(currentUser?.avatarUrl);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!currentUser || currentUser.role !== 'ADMIN') return null;

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

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    setIsUploading(true);
    
    try {
      const compressed = await compressImage(file, 200, 200);
      const result = await CloudflareApi.uploadImage(compressed, 'seller', currentUser.id);
      
      if (result.success) {
        setAvatarUrl(result.url);
        
        const users = StorageService.getUsers();
        const userIndex = users.findIndex(u => u.id === currentUser.id);
        if (userIndex !== -1) {
          users[userIndex].avatarUrl = result.url;
          StorageService.saveUsers(users);
          if (refreshUser) refreshUser();
        }
        
        addToast({
          type: 'success',
          title: 'Profile Picture Updated',
          description: 'Your admin profile picture has been updated successfully.',
        });
      }
    } catch (error: any) {
      addToast({
        type: 'error',
        title: 'Upload Failed',
        description: error.message || 'Could not upload profile picture.',
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveAvatar = () => {
    if (!currentUser) return;
    
    setAvatarUrl(undefined);
    
    const users = StorageService.getUsers();
    const userIndex = users.findIndex(u => u.id === currentUser.id);
    if (userIndex !== -1) {
      delete users[userIndex].avatarUrl;
      StorageService.saveUsers(users);
      if (refreshUser) refreshUser();
    }
    
    addToast({
      type: 'info',
      title: 'Profile Picture Removed',
      description: 'Your profile picture has been removed.',
    });
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({
      businessName,
      tagline,
      address,
      phone,
      email,
      currencySymbol,
      currencyCode,
      enableTax,
      taxRatePercent: parseFloat(taxRatePercent) || 0,
      receiptHeaderNote,
      receiptFooterNote,
    });

    addToast({
      type: 'success',
      title: 'Settings Saved',
      description: 'Business configurations and receipt policies updated.',
    });
  };

  const handleChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError('');

    if (!adminUsername.trim() || adminUsername.trim().length < 3) {
      setUsernameError('Username must be at least 3 characters.');
      return;
    }

    setIsChangingUsername(true);
    const res = AuthService.changeAdminUsername(
      currentUser.id,
      adminUsername.trim(),
      currentUser
    );
    setIsChangingUsername(false);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Username Changed',
        description: `Admin username updated to '${adminUsername.trim()}'. Use this next time you login.`,
      });
      if (refreshUser) refreshUser();
    } else {
      setUsernameError(res.error || 'Failed to change username.');
    }
  };

  const handleAdminPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (!currentPassword) {
      setPasswordError('Please enter your current admin password.');
      return;
    }

    if (newPassword.length < 4) {
      setPasswordError('Password must be at least 4 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New password confirmation does not match.');
      return;
    }

    setIsChangingPass(true);
    const res = await AuthService.changePassword(
      currentUser.id,
      currentPassword,
      newPassword,
      currentUser
    );
    setIsChangingPass(false);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Admin Password Changed',
        description: 'New master administrator password saved securely.',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setPasswordError(res.error || 'Failed to update admin password.');
    }
  };

  const auditLogs = StorageService.getAuditLogs();

  return (
    <div id="admin-settings-view" className="flex-1 p-6 bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Header */}
      <div className="mb-6 pb-4 border-b border-slate-800">
        <h2 className="text-xl font-bold text-white tracking-tight">System Configuration & Audit</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Configure business details, admin credentials, tax rates, and view audit trail
        </p>
      </div>

      <div className="max-w-4xl space-y-6">
        {/* Admin Profile Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-800">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Admin Profile</h3>
          </div>

          <div className="flex items-center gap-6">
            <div className="relative">
              {avatarUrl ? (
                <img src={avatarUrl} alt={currentUser.name} className="w-20 h-20 rounded-full object-cover border-2 border-emerald-500 shadow-lg" />
              ) : (
                <div className="w-20 h-20 rounded-full flex items-center justify-center font-bold text-2xl text-white shadow-lg" style={{ backgroundColor: '#10b981' }}>
                  {currentUser.name.charAt(0).toUpperCase()}
                </div>
              )}
              <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="absolute -bottom-1 -right-1 p-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg transition disabled:opacity-50" title="Upload profile picture">
                {isUploading ? <Upload className="w-3.5 h-3.5 animate-pulse" /> : <Camera className="w-3.5 h-3.5" />}
              </button>
              {avatarUrl && (
                <button onClick={handleRemoveAvatar} className="absolute -top-1 -right-1 p-1 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-lg transition" title="Remove profile picture">
                  <X className="w-3 h-3" />
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            </div>

            <div>
              <div className="text-lg font-bold text-white">{currentUser.name}</div>
              <div className="text-sm text-slate-400">@{currentUser.username}</div>
              <div className="text-xs text-slate-500 mt-1">System Administrator</div>
            </div>
          </div>
        </div>

        {/* Change Admin Username */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-800">
            <UserIcon className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Change Admin Username</h3>
          </div>

          {usernameError && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">{usernameError}</div>
          )}

          <form onSubmit={handleChangeUsername} className="space-y-4 max-w-md text-xs">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Current Username</label>
              <input
                type="text"
                value={currentUser.username}
                disabled
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-medium mb-1">New Username</label>
              <input
                type="text"
                required
                value={adminUsername}
                onChange={e => setAdminUsername(e.target.value)}
                placeholder="Enter new admin username..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">You will use this username for admin login.</p>
            </div>

            <button
              type="submit"
              disabled={isChangingUsername}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow transition disabled:opacity-50"
            >
              {isChangingUsername ? 'Updating...' : 'Change Username'}
            </button>
          </form>
        </div>

        {/* Business & POS Configuration */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-800">
            <Store className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Store Identity & Contact Details</h3>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
            {/* ... existing settings form ... */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Business Store Name</label>
                <input type="text" required value={businessName} onChange={e => setBusinessName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Tagline / Slogan</label>
                <input type="text" value={tagline} onChange={e => setTagline(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Physical Address</label>
                <input type="text" value={address} onChange={e => setAddress(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Phone Number</label>
                <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Store Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Currency Symbol</label>
                <input type="text" value={currencySymbol} onChange={e => setCurrencySymbol(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Currency Code</label>
                <input type="text" value={currencyCode} onChange={e => setCurrencyCode(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Tax Rate (%)</label>
                <div className="flex items-center gap-2">
                  <input type="number" step="0.1" min="0" value={taxRatePercent} onChange={e => setTaxRatePercent(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-slate-300">
                    <input type="checkbox" checked={enableTax} onChange={e => setEnableTax(e.target.checked)} className="rounded bg-slate-950 border-slate-800 text-blue-600 focus:ring-0" />
                    <span>Enable</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Receipt Header Announcement Note</label>
                <input type="text" value={receiptHeaderNote} onChange={e => setReceiptHeaderNote(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Receipt Footer Policy Note</label>
                <input type="text" value={receiptFooterNote} onChange={e => setReceiptFooterNote(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button type="submit" className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow transition">Save Store Settings</button>
            </div>
          </form>
        </div>

        {/* Change Admin Password */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-800">
            <KeyRound className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Change Master Admin Password</h3>
          </div>

          {passwordError && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">{passwordError}</div>
          )}

          <form onSubmit={handleAdminPasswordChange} className="space-y-4 max-w-md text-xs">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Current Admin Password</label>
              <input type="password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Enter current password..." className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-slate-300 font-medium mb-1">New Admin Password</label>
              <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="At least 4 characters..." className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-slate-300 font-medium mb-1">Confirm New Password</label>
              <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter new password..." className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500" />
            </div>
            <button type="submit" disabled={isChangingPass} className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold shadow transition disabled:opacity-50">
              {isChangingPass ? 'Updating...' : 'Update Admin Password'}
            </button>
          </form>
        </div>

        {/* Security Audit Trail */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-purple-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Security & Administrative Audit Logs</h3>
            </div>
            <span className="text-xs text-slate-400">{auditLogs.length} events logged</span>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-2 text-xs pr-1">
            {auditLogs.length === 0 ? (
              <div className="text-center py-6 text-slate-500">No audit events recorded yet.</div>
            ) : (
              auditLogs.slice(0, 30).map(log => (
                <div key={log.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-start justify-between gap-3 font-mono text-[11px]">
                  <div>
                    <div className="font-semibold text-slate-200">
                      <span className="text-blue-400">[{log.action}]</span> {log.details}
                    </div>
                    <div className="text-slate-500 text-[10px] mt-0.5">
                      Performed by: <span className="text-slate-300">{log.performedByName}</span>
                    </div>
                  </div>
                  <span className="text-slate-500 shrink-0">{formatDateTime(log.createdAt)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
