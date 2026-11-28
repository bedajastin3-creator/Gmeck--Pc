import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import { db, DatabaseState } from '../db/storage';
import { AuthService } from '../services/authService';
import { SyncService, SyncState } from '../services/syncService';
import { CloudflareApi } from '../services/cloudflareApi';
import { User, Sale, ToastMessage, Shop } from '../types';
import { getColorOption } from '../utils/colors';
import { hasAdminAccess } from '../utils/permissions';
import { CachedHomeSnapshot, HomeCacheService } from '../services/homeCacheService';

export type StoresSubTab = 'stores' | 'inventory' | 'transfer' | 'list' | 'transfer_view';
export type ShopsSubTab = 'list' | 'add';
export type InventoryFilter = 'ALL' | 'SHOP' | 'STORE' | 'ADJUST' | 'ADJUSTMENT_LIST';
export type ProductsSubTab = 'product_list' | 'add_product' | 'category_list' | 'add_category';
export type PurchasesSubTab = 'list' | 'add' | 'returns' | 'suppliers';
export type ExpensesSubTab = 'list' | 'add';
export type SellersSubTab = 'list' | 'add';

interface AppContextType {
  currentUser: User | null;
  dbState: DatabaseState;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  storesSubTab: StoresSubTab;
  setStoresSubTab: (subTab: StoresSubTab) => void;
  openStoresSubTab: (subTab: StoresSubTab) => void;
  storesNavTick: number;
  bumpStoresNavTick: () => void;
  shopsSubTab: ShopsSubTab;
  setShopsSubTab: (subTab: ShopsSubTab) => void;
  openShopsSubTab: (subTab: ShopsSubTab) => void;
  shopsNavTick: number;
  bumpShopsNavTick: () => void;
  inventoryFilter: InventoryFilter;
  setInventoryFilter: (filter: InventoryFilter) => void;
  openInventoryFilter: (filter: InventoryFilter) => void;
  inventoryNavTick: number;
  bumpInventoryNavTick: () => void;
  productsSubTab: ProductsSubTab;
  setProductsSubTab: (subTab: ProductsSubTab) => void;
  openProductsSubTab: (subTab: ProductsSubTab) => void;
  productsNavTick: number;
  bumpProductsNavTick: () => void;
  purchasesSubTab: PurchasesSubTab;
  setPurchasesSubTab: (subTab: PurchasesSubTab) => void;
  openPurchasesSubTab: (subTab: PurchasesSubTab) => void;
  purchasesNavTick: number;
  bumpPurchasesNavTick: () => void;
  expensesSubTab: ExpensesSubTab;
  setExpensesSubTab: (subTab: ExpensesSubTab) => void;
  openExpensesSubTab: (subTab: ExpensesSubTab) => void;
  expensesNavTick: number;
  bumpExpensesNavTick: () => void;
  sellersSubTab: SellersSubTab;
  setSellersSubTab: (subTab: SellersSubTab) => void;
  openSellersSubTab: (subTab: SellersSubTab) => void;
  sellersNavTick: number;
  bumpSellersNavTick: () => void;
  login: (user: User) => void;
  logout: () => void;
  refreshUser: () => void;
  // Shop context
  selectedShopId: string;
  setSelectedShopId: (shopId: string) => void;
  currentShop: Shop | null;
  availableShops: Shop[];
  // Toast notifications
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
  // Receipt modal
  activeReceipt: Sale | null;
  showReceipt: (sale: Sale) => void;
  closeReceipt: () => void;
  // Online-only cloud state
  isOnline: boolean;
  isCloudLoaded: boolean;
  isInitialLoading: boolean;
  cloudError: string | null;
  cachedHome: CachedHomeSnapshot | null;
  retryConnection: () => Promise<boolean>;
  // Sync status
  syncStatus: { state: SyncState; pendingCount: number };
  triggerSync: () => Promise<void>;
  pullLatestNow: (force?: boolean) => Promise<boolean>;
  refreshStoresFromCloud: (force?: boolean) => Promise<{ success: boolean; error?: string }>;
  // Settings
  updateSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;
  // Seller color theme
  sellerColor: ReturnType<typeof getColorOption>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => AuthService.getActiveUser());
  const [dbState, setDbState] = useState<DatabaseState>(() => db.getState());
  const [isOnline, setIsOnline] = useState<boolean>(() => CloudflareApi.isOnline());
  const [isCloudLoaded, setIsCloudLoaded] = useState<boolean>(() => db.isCloudLoaded());
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(() => !db.isCloudLoaded());
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cachedHome, setCachedHome] = useState<CachedHomeSnapshot | null>(() => {
    const u = AuthService.getActiveUser();
    return u ? HomeCacheService.load(u.id) : null;
  });
  const [activeTab, setActiveTabState] = useState<string>(() => {
    const u = AuthService.getActiveUser();
    if (u && (!CloudflareApi.isOnline() || !db.isCloudLoaded()) && HomeCacheService.load(u.id)) {
      return 'dashboard';
    }
    if (u && !hasAdminAccess(u)) return 'new_sale';
    return 'dashboard';
  });
  const [storesSubTab, setStoresSubTab] = useState<StoresSubTab>('stores');
  const [storesNavTick, setStoresNavTick] = useState<number>(0);
  const [shopsSubTab, setShopsSubTab] = useState<ShopsSubTab>('list');
  const [shopsNavTick, setShopsNavTick] = useState<number>(0);
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>('ALL');
  const [inventoryNavTick, setInventoryNavTick] = useState<number>(0);
  const [productsSubTab, setProductsSubTab] = useState<ProductsSubTab>('product_list');
  const [productsNavTick, setProductsNavTick] = useState<number>(0);
  const [purchasesSubTab, setPurchasesSubTab] = useState<PurchasesSubTab>('list');
  const [purchasesNavTick, setPurchasesNavTick] = useState<number>(0);
  const [expensesSubTab, setExpensesSubTab] = useState<ExpensesSubTab>('list');
  const [expensesNavTick, setExpensesNavTick] = useState<number>(0);
  const [sellersSubTab, setSellersSubTab] = useState<SellersSubTab>('list');
  const [sellersNavTick, setSellersNavTick] = useState<number>(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [activeReceipt, setActiveReceipt] = useState<Sale | null>(null);
  const [syncStatus, setSyncStatus] = useState(SyncService.getSyncStatus());
  const [selectedShopId, setSelectedShopIdState] = useState<string>(() => {
    const saved = localStorage.getItem('diocres_selected_shop_id');
    return saved || 'ALL';
  });

  const isPullingRef = useRef<boolean>(false);
  const lastPullTimeRef = useRef<number>(0);
  const currentUserRef = useRef<User | null>(currentUser);
  const isOnlineRef = useRef<boolean>(isOnline);
  const wasOfflineLockedRef = useRef<boolean>(false);
  const prevIsOnlineRef = useRef<boolean>(isOnline);
  const PULL_INTERVAL = 60000; // 60 seconds between background pulls so desktop/mobile App stays live
  const FOCUS_PULL_COOLDOWN = 10000; // 10 seconds cooldown on window focus

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    currentUserRef.current = currentUser;
    if (currentUser && (!isOnline || !isCloudLoaded)) {
      setActiveTabState('dashboard');
      return;
    }
    if (currentUser && !hasAdminAccess(currentUser)) {
      const canExpense = Boolean(
        currentUser.permissions?.canViewExpenses || currentUser.permissions?.canRecordExpenses
      );
      setActiveTabState(prev => {
        if (prev === 'new_sale' || prev === 'settings') return prev;
        if (prev === 'expenses' && canExpense) return prev;
        return 'new_sale';
      });
    }
  }, [currentUser, isOnline, isCloudLoaded]);

  // Enforce Home-only when offline & restore seller default POS view on reconnect
  useEffect(() => {
    const wasOnline = prevIsOnlineRef.current;
    prevIsOnlineRef.current = isOnline;

    if (!currentUser) {
      wasOfflineLockedRef.current = false;
      return;
    }

    if (!isOnline) {
      wasOfflineLockedRef.current = true;
      setActiveTabState('dashboard');
      if (wasOnline) {
        addToast({
          type: 'warning',
          title: 'You are offline',
          description: 'Showing cached Home. Connect to the internet to open other pages.',
        });
      }
      return;
    }

    if (isOnline && isCloudLoaded && wasOfflineLockedRef.current) {
      wasOfflineLockedRef.current = false;
      if (!hasAdminAccess(currentUser)) {
        setActiveTabState('new_sale');
      }
    }
  }, [isOnline, isCloudLoaded, currentUser?.id]);

  const notifyOfflineBlockedPage = () => {
    addToast({
      type: 'warning',
      title: 'Offline — Internet Required',
      description: 'You are offline. Only cached Home is available until internet returns.',
    });
  };

  const setActiveTab = (tab: string) => {
    if (!isOnlineRef.current || !db.isCloudLoaded()) {
      if (tab !== 'dashboard') {
        notifyOfflineBlockedPage();
      }
      setActiveTabState('dashboard');
      return;
    }
    if (currentUserRef.current && !hasAdminAccess(currentUserRef.current)) {
      if (tab === 'settings') {
        setActiveTabState('settings');
        return;
      }
      const canExpense = Boolean(
        currentUserRef.current.permissions?.canViewExpenses ||
          currentUserRef.current.permissions?.canRecordExpenses
      );
      if (tab === 'expenses' && canExpense) {
        setActiveTabState('expenses');
        return;
      }
      setActiveTabState('new_sale');
      return;
    }
    setActiveTabState(tab);
  };

  const setSelectedShopId = (shopId: string) => {
    setSelectedShopIdState(shopId);
    localStorage.setItem('diocres_selected_shop_id', shopId);
  };

  // Available shops based on current user (uses cached Home shops when offline at startup)
  const availableShops = useMemo(() => {
    const allShops = db.isCloudLoaded()
      ? dbState.shops || []
      : cachedHome?.shops || dbState.shops || [];
    if (!currentUser) return allShops;

    if (currentUser.role === 'ADMIN') {
      return allShops;
    }

    const assigned = currentUser.assignedShopIds || [];
    return allShops.filter(s => s.status === 'ACTIVE' && assigned.includes(s.id));
  }, [dbState.shops, cachedHome?.shops, currentUser, isCloudLoaded]);

  // Current Shop entity
  const currentShop = useMemo(() => {
    if (selectedShopId === 'ALL') return null;
    const allShops = db.isCloudLoaded()
      ? dbState.shops || []
      : cachedHome?.shops || dbState.shops || [];
    return allShops.find(s => s.id === selectedShopId) || null;
  }, [dbState.shops, cachedHome?.shops, selectedShopId, isCloudLoaded]);

  const validateActiveUserAgainstCloud = (state: DatabaseState) => {
    const activeUser = currentUserRef.current;
    if (!activeUser || !db.isCloudLoaded()) return;

    const freshUser = state.users.find(u => u.id === activeUser.id);
    if (!freshUser) {
      AuthService.logout();
      setCurrentUser(null);
      setToasts(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          type: 'warning',
          title: 'Session Expired',
          description: 'Your account was not found in the cloud database. Please sign in again.',
        },
      ]);
      return;
    }

    if (freshUser.status !== 'ACTIVE') {
      AuthService.logout();
      setCurrentUser(null);
      setToasts(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          type: 'warning',
          title: 'Account Deactivated',
          description: 'Your seller account has been deactivated by an Administrator.',
        },
      ]);
      return;
    }

    const changed =
      freshUser.updatedAt !== activeUser.updatedAt ||
      freshUser.name !== activeUser.name ||
      freshUser.color !== activeUser.color ||
      freshUser.avatarUrl !== activeUser.avatarUrl ||
      freshUser.role !== activeUser.role ||
      JSON.stringify(freshUser.permissions || {}) !== JSON.stringify(activeUser.permissions || {}) ||
      JSON.stringify(freshUser.assignedShopIds || []) !== JSON.stringify(activeUser.assignedShopIds || []);

    if (changed) {
      setCurrentUser(freshUser);
      AuthService.setActiveUser(freshUser);
    }
  };

  /**
   * PULL LATEST CLOUD DATA
   * Pulls on startup, login, reconnect, focus, and periodically every 60s.
   */
  const pullCloudData = async (force: boolean = false): Promise<boolean> => {
    if (isPullingRef.current) return false;

    const now = Date.now();
    const timeSinceLastPull = now - lastPullTimeRef.current;

    if (!force && timeSinceLastPull < PULL_INTERVAL) return false;

    isPullingRef.current = true;

    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setIsOnline(false);
        setSyncStatus({ state: 'OFFLINE_LOCAL', pendingCount: 0 });
        if (!db.isCloudLoaded()) {
          setCloudError(CloudflareApi.OFFLINE_ERROR_MESSAGE);
        }
        return false;
      }

      const online = await CloudflareApi.checkConnection();
      setIsOnline(online);
      if (!online) {
        setSyncStatus({ state: 'OFFLINE_LOCAL', pendingCount: 0 });
        if (!db.isCloudLoaded()) {
          setCloudError(CloudflareApi.OFFLINE_ERROR_MESSAGE);
        }
        return false;
      }

      const pullResult = await CloudflareApi.pullSync();

      if (pullResult.success && pullResult.data) {
        SyncService.applyCloudData(pullResult.data, true);

        const state = db.getState();
        setDbState({ ...state });
        setIsOnline(true);
        setIsCloudLoaded(true);
        setCloudError(null);
        setSyncStatus(SyncService.getSyncStatus());
        lastPullTimeRef.current = Date.now();

        validateActiveUserAgainstCloud(state);
        return true;
      }

      if (!db.isCloudLoaded()) {
        setCloudError(pullResult.error || CloudflareApi.OFFLINE_ERROR_MESSAGE);
      }
      lastPullTimeRef.current = Date.now();
      return false;
    } catch (error: any) {
      const errMsg = CloudflareApi.formatError(error, CloudflareApi.OFFLINE_ERROR_MESSAGE);
      if (CloudflareApi.isNetworkError(error)) {
        setIsOnline(false);
      }
      if (!db.isCloudLoaded()) {
        setCloudError(errMsg);
      }
      setSyncStatus(SyncService.getSyncStatus());
      return false;
    } finally {
      isPullingRef.current = false;
    }
  };

  const retryConnection = async (): Promise<boolean> => {
    if (!db.isCloudLoaded()) {
      setIsInitialLoading(true);
    }
    setCloudError(null);
    const ok = await pullCloudData(true);
    setIsInitialLoading(false);
    return ok;
  };

  // 1. INITIAL CLOUD LOAD ON STARTUP (strictly online-only: never use offline fallback)
  useEffect(() => {
    let active = true;
    (async () => {
      await pullCloudData(true);
      if (active) {
        setIsInitialLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // 2. Retry automatically if initial cloud load has not succeeded yet
  useEffect(() => {
    if (isCloudLoaded) return;
    const retryTimer = setInterval(() => {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        pullCloudData(true).then(ok => {
          if (ok) setIsInitialLoading(false);
        });
      }
    }, 8000);
    return () => clearInterval(retryTimer);
  }, [isCloudLoaded]);

  // 3. Listen to in-memory DB state changes (keep React state & currentUser fresh)
  useEffect(() => {
    const unsubscribe = db.subscribe(() => {
      const state = db.getState();
      setDbState({ ...state });
      setIsCloudLoaded(db.isCloudLoaded());
      setSyncStatus(SyncService.getSyncStatus());
      validateActiveUserAgainstCloud(state);
    });

    return () => unsubscribe();
  }, []);

  // 4. Pull cloud data on login, periodically, when viewing dashboard, and when app regains focus
  useEffect(() => {
    if (currentUser?.id) {
      pullCloudData(true);
    }

    const interval = setInterval(() => pullCloudData(false), PULL_INTERVAL);

    const handleFocusPull = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastPullTimeRef.current >= FOCUS_PULL_COOLDOWN) {
        pullCloudData(true);
      }
    };

    window.addEventListener('focus', handleFocusPull);
    document.addEventListener('visibilitychange', handleFocusPull);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocusPull);
      document.removeEventListener('visibilitychange', handleFocusPull);
    };
  }, [currentUser?.id]);

  // 4b. Pull fresh data whenever user switches to Home dashboard
  useEffect(() => {
    if (currentUser?.id && activeTab === 'dashboard') {
      if (Date.now() - lastPullTimeRef.current >= 4000) {
        pullCloudData(true);
      }
    }
  }, [activeTab, currentUser?.id]);

  // 5. Track live network & CloudflareApi connection status
  useEffect(() => {
    const unsubConn = CloudflareApi.onConnectionChange(online => {
      setIsOnline(online);
      setSyncStatus(SyncService.getSyncStatus());
      if (!online && !db.isCloudLoaded()) {
        setCloudError(CloudflareApi.OFFLINE_ERROR_MESSAGE);
      }
    });

    const handleOnline = async () => {
      setIsOnline(true);
      const ok = await pullCloudData(true);
      if (ok) {
        setIsInitialLoading(false);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus({ state: 'OFFLINE_LOCAL', pendingCount: 0 });
      if (!db.isCloudLoaded()) {
        setCloudError(CloudflareApi.OFFLINE_ERROR_MESSAGE);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      unsubConn();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Refresh lightweight Home-only offline cache whenever live cloud data changes
  useEffect(() => {
    if (!currentUser || !isCloudLoaded || !isOnline) return;
    const timer = window.setTimeout(() => {
      const snap = HomeCacheService.saveFromLiveState(currentUser);
      if (snap) {
        setCachedHome(snap);
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [dbState, currentUser, isCloudLoaded, isOnline]);

  // Ensure seller has a valid shop selected
  useEffect(() => {
    if (!currentUser) return;

    if (currentUser.role === 'SELLER') {
      const sellerShops = availableShops;

      if (sellerShops.length > 0) {
        const isCurrentValid = sellerShops.some(s => s.id === selectedShopId);
        if (!isCurrentValid || selectedShopId === 'ALL') {
          setSelectedShopId(sellerShops[0].id);
        }
      }
    }
  }, [currentUser, availableShops, selectedShopId]);

  const refreshUser = () => {
    const u = AuthService.getActiveUser();
    setCurrentUser(u);
  };

  const login = (user: User) => {
    const allUsers = db.getUsers();
    const freshUser = allUsers.find(u => u.id === user.id) || user;

    AuthService.setActiveUser(freshUser);
    setCurrentUser(freshUser);

    const existingCached = HomeCacheService.load(freshUser.id);
    if (existingCached) {
      setCachedHome(existingCached);
    }

    if (freshUser.role === 'ADMIN') {
      setActiveTab('dashboard');
    } else {
      setActiveTab('new_sale');
      const sellerShops = (dbState.shops || []).filter(
        s => s.status === 'ACTIVE' && (freshUser.assignedShopIds || []).includes(s.id)
      );
      if (sellerShops.length > 0) {
        setSelectedShopId(sellerShops[0].id);
      }
    }

    addToast({
      type: 'success',
      title: `Welcome back, ${freshUser.name}`,
      description: `Logged in as ${freshUser.role}`,
    });

    setTimeout(() => {
      pullCloudData(true);
    }, 200);
  };

  const logout = () => {
    AuthService.logout();
    HomeCacheService.clear();
    setCachedHome(null);
    setCurrentUser(null);
    setActiveTabState('dashboard');
    addToast({
      type: 'info',
      title: 'Logged Out',
      description: 'Session ended securely.',
    });
  };

  const addToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 6);
    setToasts(prev => [...prev, { ...toast, id }]);

    setTimeout(() => {
      removeToast(id);
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const showReceipt = (sale: Sale) => {
    setActiveReceipt(sale);
  };

  const closeReceipt = () => {
    setActiveReceipt(null);
  };

  const bumpStoresNavTick = () => {
    setStoresNavTick(prev => prev + 1);
  };

  const openStoresSubTab = (subTab: StoresSubTab) => {
    if (!isOnlineRef.current || !db.isCloudLoaded()) {
      notifyOfflineBlockedPage();
      setActiveTabState('dashboard');
      return;
    }
    setStoresSubTab(subTab);
    setStoresNavTick(prev => prev + 1);
    setActiveTab('stores');
  };

  const bumpShopsNavTick = () => {
    setShopsNavTick(prev => prev + 1);
  };

  const openShopsSubTab = (subTab: ShopsSubTab) => {
    if (!isOnlineRef.current || !db.isCloudLoaded()) {
      notifyOfflineBlockedPage();
      setActiveTabState('dashboard');
      return;
    }
    setShopsSubTab(subTab);
    setShopsNavTick(prev => prev + 1);
    setActiveTab('shops');
  };

  const bumpInventoryNavTick = () => {
    setInventoryNavTick(prev => prev + 1);
  };

  const openInventoryFilter = (filter: InventoryFilter) => {
    if (!isOnlineRef.current || !db.isCloudLoaded()) {
      notifyOfflineBlockedPage();
      setActiveTabState('dashboard');
      return;
    }
    setInventoryFilter(filter);
    setInventoryNavTick(prev => prev + 1);
    setActiveTab('inventory');
  };

  const bumpProductsNavTick = () => {
    setProductsNavTick(prev => prev + 1);
  };

  const openProductsSubTab = (subTab: ProductsSubTab) => {
    if (!isOnlineRef.current || !db.isCloudLoaded()) {
      notifyOfflineBlockedPage();
      setActiveTabState('dashboard');
      return;
    }
    setProductsSubTab(subTab);
    setProductsNavTick(prev => prev + 1);
    setActiveTab('products');
  };

  const bumpPurchasesNavTick = () => {
    setPurchasesNavTick(prev => prev + 1);
  };

  const openPurchasesSubTab = (subTab: PurchasesSubTab) => {
    if (!isOnlineRef.current || !db.isCloudLoaded()) {
      notifyOfflineBlockedPage();
      setActiveTabState('dashboard');
      return;
    }
    setPurchasesSubTab(subTab);
    setPurchasesNavTick(prev => prev + 1);
    setActiveTab('purchases');
  };

  const bumpExpensesNavTick = () => {
    setExpensesNavTick(prev => prev + 1);
  };

  const openExpensesSubTab = (subTab: ExpensesSubTab) => {
    if (!isOnlineRef.current || !db.isCloudLoaded()) {
      notifyOfflineBlockedPage();
      setActiveTabState('dashboard');
      return;
    }
    setExpensesSubTab(subTab);
    setExpensesNavTick(prev => prev + 1);
    setActiveTab('expenses');
  };

  const bumpSellersNavTick = () => {
    setSellersNavTick(prev => prev + 1);
  };

  const openSellersSubTab = (subTab: SellersSubTab) => {
    if (!isOnlineRef.current || !db.isCloudLoaded()) {
      notifyOfflineBlockedPage();
      setActiveTabState('dashboard');
      return;
    }
    setSellersSubTab(subTab);
    setSellersNavTick(prev => prev + 1);
    setActiveTab('sellers');
  };

  const refreshStoresFromCloud = async (
    force: boolean = false
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const online = await CloudflareApi.checkConnection();
      setIsOnline(online);
      if (!online) {
        return { success: false, error: CloudflareApi.OFFLINE_ERROR_MESSAGE };
      }

      const cloudStores = await CloudflareApi.getStores();
      if (Array.isArray(cloudStores)) {
        SyncService.applyCloudStores(cloudStores, { reconcileDeleted: true });
      }

      if (force) {
        await pullCloudData(true);
      }

      setDbState({ ...db.getState() });
      setSyncStatus(SyncService.getSyncStatus());
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: CloudflareApi.formatError(err, 'Could not refresh stores from cloud.'),
      };
    }
  };

  const triggerSync = async () => {
    setSyncStatus({ state: 'SYNCING', pendingCount: 0 });

    const pulled = await pullCloudData(true);
    setSyncStatus(SyncService.getSyncStatus());

    if (pulled) {
      addToast({
        type: 'success',
        title: 'Cloud Database Synced',
        description: 'Live data refreshed from cloud database.',
      });
    } else {
      addToast({
        type: 'error',
        title: 'Offline',
        description: CloudflareApi.OFFLINE_ERROR_MESSAGE,
      });
    }
  };

  const updateSettings = async (
    newSettings: any
  ): Promise<{ success: boolean; error?: string }> => {
    const currentSettings = db.getSettings();
    const updatedSettings = { ...currentSettings, ...newSettings };

    const commitRes = await SyncService.commitOperation({
      operation: 'UPDATE_SETTINGS',
      entityType: 'SETTINGS',
      entityId: 'global',
      payload: updatedSettings,
    });

    if (!commitRes.success) {
      return { success: false, error: commitRes.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    db.saveSettings(updatedSettings);
    setDbState(db.getState());
    setSyncStatus(SyncService.getSyncStatus());
    return { success: true };
  };

  const sellerColor = useMemo(() => {
    return getColorOption(currentUser?.color || 'blue');
  }, [currentUser?.color]);

  return (
    <AppContext.Provider
      value={{
        currentUser,
        dbState,
        activeTab,
        setActiveTab,
        storesSubTab,
        setStoresSubTab,
        openStoresSubTab,
        storesNavTick,
        bumpStoresNavTick,
        shopsSubTab,
        setShopsSubTab,
        openShopsSubTab,
        shopsNavTick,
        bumpShopsNavTick,
        inventoryFilter,
        setInventoryFilter,
        openInventoryFilter,
        inventoryNavTick,
        bumpInventoryNavTick,
        productsSubTab,
        setProductsSubTab,
        openProductsSubTab,
        productsNavTick,
        bumpProductsNavTick,
        purchasesSubTab,
        setPurchasesSubTab,
        openPurchasesSubTab,
        purchasesNavTick,
        bumpPurchasesNavTick,
        expensesSubTab,
        setExpensesSubTab,
        openExpensesSubTab,
        expensesNavTick,
        bumpExpensesNavTick,
        sellersSubTab,
        setSellersSubTab,
        openSellersSubTab,
        sellersNavTick,
        bumpSellersNavTick,
        login,
        logout,
        refreshUser,
        selectedShopId,
        setSelectedShopId,
        currentShop,
        availableShops,
        toasts,
        addToast,
        removeToast,
        activeReceipt,
        showReceipt,
        closeReceipt,
        isOnline,
        isCloudLoaded,
        isInitialLoading,
        cloudError,
        cachedHome,
        retryConnection,
        syncStatus,
        triggerSync,
        pullLatestNow: pullCloudData,
        refreshStoresFromCloud,
        updateSettings,
        sellerColor,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
