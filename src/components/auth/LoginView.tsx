import React, { useState } from 'react';
import {
  Shield,
  User as UserIcon,
  KeyRound,
  ArrowRight,
  Lock,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AuthService } from '../../services/authService';
import { CloudflareApi } from '../../services/cloudflareApi';
import { SyncService } from '../../services/syncService';
import { UserRole } from '../../types';

export const LoginView: React.FC = () => {
  const { login, dbState } = useApp();
  const [activePortal, setActivePortal] = useState<UserRole>('SELLER');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  // Password visibility toggle (masked by default on BOTH portals for security)
  const [showPassword, setShowPassword] = useState(false);

  const settings = dbState.settings;

  /**
   * Pull fresh users + shops from cloud.
   * Only used when local lookup fails (new user from another device).
   */
  const pullFreshAccountsFromCloud = async (): Promise<boolean> => {
    try {
      const online = await CloudflareApi.checkConnection();
      if (!online) {
        console.log('[LoginView] Offline — skipping cloud account refresh');
        return false;
      }

      setStatusMsg('Checking for latest accounts...');
      const pullResult = await CloudflareApi.pullSync();

      if (pullResult.success && pullResult.data) {
        SyncService.applyCloudData(pullResult.data);
        console.log('[LoginView] Cloud accounts pulled successfully');
        setStatusMsg('');
        return true;
      }

      setStatusMsg('');
      return false;
    } catch (err) {
      console.log('[LoginView] Cloud account refresh failed:', err);
      setStatusMsg('');
      return false;
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');

    if (!username.trim()) {
      setErrorMsg('Please enter your username or account ID.');
      return;
    }

    if (!password) {
      setErrorMsg('Please enter your password.');
      return;
    }

    setIsLoading(true);
    try {
      // ==========================================
      // STEP 1: Try local login (fast, offline-capable)
      // ==========================================
      const result = await AuthService.login(username, password, activePortal);

      if (result.success && result.user) {
        if (rememberMe) AuthService.setRememberMe(result.user);
        else AuthService.clearRememberMe();
        login(result.user);
        return;
      }

      // ==========================================
      // STEP 2: If user not found locally, refresh from cloud
      // ==========================================
      const isUserNotFoundError =
        result.error?.toLowerCase().includes('account not found') ||
        result.error?.toLowerCase().includes('not found');

      if (isUserNotFoundError) {
        console.log('[LoginView] User not found locally — pulling from cloud...');
        const refreshed = await pullFreshAccountsFromCloud();

        if (refreshed) {
          // Retry login with fresh local data
          const retryResult = await AuthService.login(username, password, activePortal);

          if (retryResult.success && retryResult.user) {
            if (rememberMe) AuthService.setRememberMe(retryResult.user);
            else AuthService.clearRememberMe();
            login(retryResult.user);
            return;
          }

          // Still failing after refresh
          setErrorMsg(
            retryResult.error || 'Authentication failed. Please verify credentials.'
          );
        } else {
          // Couldn't refresh (offline or error)
          setErrorMsg(
            result.error ||
              'Account not found locally. Connect to internet to check for new accounts.'
          );
        }
        return;
      }

      // Any other error (wrong password, inactive, etc.)
      setErrorMsg(result.error || 'Authentication failed. Please verify credentials.');
    } catch (err: any) {
      setErrorMsg(err.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
      setStatusMsg('');
    }
  };

  // Reset password visibility whenever the portal is switched
  const switchPortal = (role: UserRole) => {
    setActivePortal(role);
    setErrorMsg('');
    setShowPassword(false);
  };

  return (
    <div
      id="login-screen"
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between select-none"
    >
      {/* Top Windows Bar Simulator */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-900 border-b border-slate-800 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <img
            src="./icon.png"
            alt="Gmeck Company Limited"
            referrerPolicy="no-referrer"
            className="w-4 h-4 rounded object-cover"
          />
          <span className="font-semibold text-slate-200">{settings.businessName}</span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-400">Windows Desktop Business Engine</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
          <span className="text-[11px] text-emerald-400 font-medium">
            Local Database Ready
          </span>
        </div>
      </div>

      {/* Main Login Body */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          {/* Brand Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-slate-950 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-500/15 border border-blue-500/30 overflow-hidden">
              <img
                src="./icon.png"
                alt="Gmeck Company Limited"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              {settings.businessName}
            </h1>
            <p className="text-sm text-slate-400 mt-1">{settings.tagline}</p>
          </div>

          {/* Portal Switcher Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950/80 rounded-xl border border-slate-800/80 mb-6">
              <button
                type="button"
                id="portal-seller-btn"
                onClick={() => switchPortal('SELLER')}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  activePortal === 'SELLER'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <UserIcon className="w-4 h-4" />
                <span>Seller Login</span>
              </button>

              <button
                type="button"
                id="portal-admin-btn"
                onClick={() => switchPortal('ADMIN')}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  activePortal === 'ADMIN'
                    ? 'bg-slate-800 text-amber-300 border border-amber-500/40 shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Shield className="w-4 h-4" />
                <span>Admin Login</span>
              </button>
            </div>

            {/* Status message (checking cloud) */}
            {statusMsg && (
              <div className="mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs flex items-center gap-2">
                <RefreshCw className="w-4 h-4 shrink-0 animate-spin" />
                <span>{statusMsg}</span>
              </div>
            )}

            {/* Error banner */}
            {errorMsg && (
              <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2 animate-in fade-in">
                <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              {/* Username */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  {activePortal === 'ADMIN' ? 'Admin Username' : 'Seller Username / Account ID'}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <input
                    id="login-username-input"
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder={
                      activePortal === 'ADMIN' ? 'Enter admin username' : 'Enter seller username'
                    }
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    inputMode="text"
                    enterKeyHint="next"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  />
                </div>
              </div>

              {/* Password — masked by default on BOTH portals for security */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <KeyRound className="w-4 h-4" />
                  </div>

                  {/* Always type="text" so mobile keyboards behave predictably.
                      When hidden, characters are masked with -webkit-text-security. */}
                  <input
                    id="login-password-input"
                    type="text"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter password..."
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    inputMode="text"
                    enterKeyHint="done"
                    style={
                      showPassword
                        ? undefined
                        : ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-10 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  />

                  {/* Eye toggle — available on both Seller and Admin portals */}
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300 transition"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {/* Security hint (subtle, reassuring) */}
                <p className="text-[10px] text-slate-500 mt-1.5 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  Password is hidden for your security. Click the eye icon to reveal it.
                </p>
              </div>

              {/* Remember Me Checkbox */}
              <label className="flex items-center gap-2.5 text-xs text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span>Remember this device (auto-login next time)</span>
              </label>

              <button
                type="submit"
                id="login-submit-btn"
                disabled={isLoading}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-white shadow-lg transition-all ${
                  activePortal === 'ADMIN'
                    ? 'bg-amber-600 hover:bg-amber-500 focus:ring-amber-500'
                    : 'bg-blue-600 hover:bg-blue-500 focus:ring-blue-500'
                } disabled:opacity-50`}
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <span>
                      Sign In to {activePortal === 'ADMIN' ? 'Admin Portal' : 'POS Register'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <footer className="px-6 py-3 border-t border-slate-900 text-center text-xs text-slate-400">
        Local SQLite-compatible Storage • Zero Internet Requirement • Multi-Shop Ready
      </footer>
    </div>
  );
};
