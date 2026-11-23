import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import { db, DatabaseState } from '../db/storage';
import { AuthService } from '../services/authService';
import { SyncService, SyncState } from '../services/syncService';
import { CloudflareApi } from '../services/cloudflareApi';
import { User, Sale, ToastMessage, Shop } from '../types';
import { getColorOption } from '../utils/colors';
import { generateUUID } from '../utils/crypto';

export type StoresSubTab = 'stores' | 'inventory' | 'transfer' | 'list' | 'transfer_view';
export type ShopsSubTab = 'list' | 'add';
export type InventoryFilter = 'ALL' | 'SHOP' | 'STORE';
export type ProductsSubTab = 'product_list' | 'add_product' | 'category_list' | 'add_category';
export type PurchasesSubTab = 'list' | 'add' | 'returns';
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
  // Sync status
  syncStatus: { state: SyncState; pendingCount: number };
  triggerSync: () => Promise<void>;
  refreshStoresFromCloud: (force?: boolean) => Promise<{ success: boolean; error?: string }>;
  // Settings
  updateSettings: (settings: any) => void;
  // Seller color theme
  sellerColor: ReturnType<typeof getColorOption>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => AuthService.getActiveUser());
  const [dbState, setDbState] = useState<DatabaseState>(() => db.getState());
  const [activeTab, setActiveTab] = useState<string>('dashboard');
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
  
  const isSyncingRef = useRef<boolean>(false);
  const isPushingRef = useRef<boolean>(false);
  const lastPullTimeRef = useRef<number>(0);
  const currentUserRef = useRef<User | null>(currentUser);
  const PULL_INTERVAL = 900000; // 15 minutes between background pulls (D1 cost optimization)
  const FOCUS_PULL_COOLDOWN = 30000; // 30 seconds cooldown on window focus

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const setSelectedShopId = (shopId: string) => {
    setSelectedShopIdState(shopId);
    localStorage.setItem('diocres_selected_shop_id', shopId);
  };

  // Available shops based on current user
  const availableShops = useMemo(() => {
    const allShops = dbState.shops || [];
    if (!currentUser) return allShops;

    if (currentUser.role === 'ADMIN') {
      return allShops;
    }

    const assigned = currentUser.assignedShopIds || [];
    return allShops.filter(s => s.status === 'ACTIVE' && assigned.includes(s.id));
  }, [dbState.shops, currentUser]);

  // Current Shop entity
  const currentShop = useMemo(() => {
    if (selectedShopId === 'ALL') return null;
    return (dbState.shops || []).find(s => s.id === selectedShopId) || null;
  }, [dbState.shops, selectedShopId]);

  /**
   * PUSH PENDING ITEMS TO CLOUD
   * Called immediately after any local data change (via db.subscribe)
   */
  const pushPendingItems = async () => {
    if (isPushingRef.current || isSyncingRef.current) return;
    
    const queue = db.getSyncQueue();
    const pendingItems = queue.filter(item => item.status === 'PENDING');
    
    if (pendingItems.length === 0) return;
    
    isPushingRef.current = true;
    isSyncingRef.current = true;
    
    try {
      const online = await CloudflareApi.checkConnection();
      
      if (online) {
        console.log(`[Sync] Pushing ${pendingItems.length} items to cloud...`);
        
        const operations = pendingItems.map(item => ({
          id: item.id,
          operation: item.operation || item.action,
          entityType: item.entityType,
          entityId: item.entityId,
          payload: item.payload,
        }));
        
        const pushResult = await CloudflareApi.pushSync(operations);
        
        if (pushResult.success) {
          const updatedQueue = queue.map(item => {
            if (item.status === 'PENDING') {
              return { ...item, status: 'SYNCED' as const };
            }
            return item;
          });
          db.saveSyncQueue(updatedQueue);
          
          localStorage.setItem('omnibiz_last_synced_at', new Date().toISOString());
          
          const state = db.getState();
          setDbState({ ...state });
          setSyncStatus(SyncService.getSyncStatus());
          
          console.log(`[Sync] Successfully pushed ${pendingItems.length} items`);
        } else {
          console.log('[Sync] Push failed:', pushResult);
        }
      } else {
        console.log('[Sync] Offline - will retry later');
      }
    } catch (error) {
      console.log('[Sync] Push error:', error);
    } finally {
      isPushingRef.current = false;
      isSyncingRef.current = false;
    }
  };

  /**
   * PULL LATEST CLOUD DATA
   * Pulls every 15 minutes or on first load
   */
  const pullCloudData = async (force: boolean = false) => {
    if (isSyncingRef.current) return;
    
    const now = Date.now();
    const timeSinceLastPull = now - lastPullTimeRef.current;
    
    if (!force && timeSinceLastPull < PULL_INTERVAL) return;
    
    isSyncingRef.current = true;
    
    try {
      const online = await CloudflareApi.checkConnection();
      if (!online) {
        isSyncingRef.current = false;
        return;
      }
      
      console.log('[Sync] Pulling cloud data...');
      
      // Pass no since parameter to get ALL data on first load
      const pullResult = await CloudflareApi.pullSync();
      
      if (pullResult.success && pullResult.data) {
        SyncService.applyCloudData(pullResult.data);
        
        localStorage.setItem('omnibiz_last_synced_at', new Date().toISOString());
        localStorage.setItem('omnibiz_has_synced', 'true');
        
        const state = db.getState();
        setDbState({ ...state });
        setSyncStatus(SyncService.getSyncStatus());
        
        console.log('[Sync] Pull completed');
      }
      
      lastPullTimeRef.current = Date.now();
    } catch (error) {
      console.log('[Sync] Pull error:', error);
    } finally {
      isSyncingRef.current = false;
    }
  };

  // 1. FORCE PULL ON APP STARTUP (ensures desktop app receives latest permissions/data from web)
  useEffect(() => {
    console.log('[Startup] Pulling latest data and user permissions from cloud...');
    pullCloudData(true);
  }, []);

  // 2. Listen to LocalDB changes and push immediately
  useEffect(() => {
    const unsubscribe = db.subscribe(() => {
      const state = db.getState();
      setDbState({ ...state });
      setSyncStatus(SyncService.getSyncStatus());

      const activeUser = currentUserRef.current;
      if (activeUser) {
        const freshUser = state.users.find(u => u.id === activeUser.id);
        if (freshUser) {
          if (freshUser.status !== 'ACTIVE') {
            AuthService.logout();
            setCurrentUser(null);
            setToasts(prev => [...prev, {
              id: Date.now().toString(),
              type: 'warning',
              title: 'Account Deactivated',
              description: 'Your seller account has been deactivated by an Administrator.',
            }]);
          } else {
            const changed =
              freshUser.updatedAt !== activeUser.updatedAt ||
              freshUser.name !== activeUser.name ||
              freshUser.color !== activeUser.color ||
              freshUser.avatarUrl !== activeUser.avatarUrl ||
              JSON.stringify(freshUser.permissions || {}) !== JSON.stringify(activeUser.permissions || {}) ||
              JSON.stringify(freshUser.assignedShopIds || []) !== JSON.stringify(activeUser.assignedShopIds || []);

            if (changed) {
              setCurrentUser(freshUser);
              AuthService.setActiveUser(freshUser);
            }
          }
        }
      }
      
      // PUSH: Immediately push pending items when db changes
      const pendingCount = db.getSyncQueue().filter(q => q.status === 'PENDING').length;
      if (pendingCount > 0) {
        pushPendingItems();
      }
    });

    return () => unsubscribe();
  }, []);

  // 3. Pull cloud data on login, periodically, and when app regains focus
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

  // 4. Push on reconnect
  useEffect(() => {
    const handleOnline = () => {
      console.log('[Sync] Connection restored - pushing pending items');
      pushPendingItems();
      // Pull on reconnect
      pullCloudData(true);
    };

    const handleOffline = () => {
      console.log('[Sync] Connection lost');
      setSyncStatus({ state: 'OFFLINE_LOCAL', pendingCount: SyncService.getPendingCount() });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Ensure seller has a valid shop selected
  useEffect(() => {
    if (!currentUser) return;

    if (currentUser.role === 'SELLER') {
      const sellerShops = (dbState.shops || []).filter(
        s => s.status === 'ACTIVE' && (currentUser.assignedShopIds || []).includes(s.id)
      );

      if (sellerShops.length > 0) {
        const isCurrentValid = sellerShops.some(s => s.id === selectedShopId);
        if (!isCurrentValid || selectedShopId === 'ALL') {
          setSelectedShopId(sellerShops[0].id);
        }
      }
    }
  }, [currentUser, dbState.shops, selectedShopId]);

  const refreshUser = () => {
    const u = AuthService.getActiveUser();
    setCurrentUser(u);
  };

  const login = (user: User) => {
    // Get freshest user data from local DB (includes permissions)
    const allUsers = db.getUsers();
    const freshUser = allUsers.find(u => u.id === user.id) || user;
    
    console.log('[Login] User:', { id: freshUser.id, role: freshUser.role, permissions: freshUser.permissions });
    
    AuthService.setActiveUser(freshUser);
    setCurrentUser(freshUser);

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
    
    // Push any pending items and force-pull latest data/permissions after login
    setTimeout(() => {
      pushPendingItems();
      pullCloudData(true);
    }, 300);
  };

  const logout = () => {
    // Push pending items before logout
    pushPendingItems();
    
    AuthService.logout();
    setCurrentUser(null);
    setActiveTab('dashboard');
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
    setStoresSubTab(subTab);
    setStoresNavTick(prev => prev + 1);
    setActiveTab('stores');
  };

  const bumpShopsNavTick = () => {
    setShopsNavTick(prev => prev + 1);
  };

  const openShopsSubTab = (subTab: ShopsSubTab) => {
    setShopsSubTab(subTab);
    setShopsNavTick(prev => prev + 1);
    setActiveTab('shops');
  };

  const bumpInventoryNavTick = () => {
    setInventoryNavTick(prev => prev + 1);
  };

  const openInventoryFilter = (filter: InventoryFilter) => {
    setInventoryFilter(filter);
    setInventoryNavTick(prev => prev + 1);
    setActiveTab('inventory');
  };

  const bumpProductsNavTick = () => {
    setProductsNavTick(prev => prev + 1);
  };

  const openProductsSubTab = (subTab: ProductsSubTab) => {
    setProductsSubTab(subTab);
    setProductsNavTick(prev => prev + 1);
    setActiveTab('products');
  };

  const bumpPurchasesNavTick = () => {
    setPurchasesNavTick(prev => prev + 1);
  };

  const openPurchasesSubTab = (subTab: PurchasesSubTab) => {
    setPurchasesSubTab(subTab);
    setPurchasesNavTick(prev => prev + 1);
    setActiveTab('purchases');
  };

  const bumpExpensesNavTick = () => {
    setExpensesNavTick(prev => prev + 1);
  };

  const openExpensesSubTab = (subTab: ExpensesSubTab) => {
    setExpensesSubTab(subTab);
    setExpensesNavTick(prev => prev + 1);
    setActiveTab('expenses');
  };

  const bumpSellersNavTick = () => {
    setSellersNavTick(prev => prev + 1);
  };

  const openSellersSubTab = (subTab: SellersSubTab) => {
    setSellersSubTab(subTab);
    setSellersNavTick(prev => prev + 1);
    setActiveTab('sellers');
  };

  const refreshStoresFromCloud = async (
    force: boolean = false
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const online = await CloudflareApi.checkConnection();
      if (!online) {
        return { success: false, error: 'Offline: showing locally saved stores.' };
      }

      const cloudStores = await CloudflareApi.getStores();
      if (Array.isArray(cloudStores)) {
        SyncService.applyCloudStores(cloudStores, { reconcileDeleted: true });
      }

      if (force) {
        await pushPendingItems();
        await pullCloudData(true);
      }

      setDbState({ ...db.getState() });
      setSyncStatus(SyncService.getSyncStatus());
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Could not refresh stores from cloud.',
      };
    }
  };

  const triggerSync = async () => {
    setSyncStatus({ state: 'SYNCING', pendingCount: syncStatus.pendingCount });
    
    // Push pending items
    await pushPendingItems();
    
    // Pull latest data (force)
    await pullCloudData(true);
    
    setSyncStatus(SyncService.getSyncStatus());
    
    const pendingCount = SyncService.getPendingCount();
    
    if (pendingCount === 0) {
      addToast({
        type: 'success',
        title: 'Synchronization Complete',
        description: 'All records up to date.',
      });
    } else {
      addToast({
        type: 'warning',
        title: 'Sync Status',
        description: `${pendingCount} items still pending. Will retry automatically.`,
      });
    }
  };

  const updateSettings = (newSettings: any) => {
    const currentSettings = db.getSettings();
    const updatedSettings = { ...currentSettings, ...newSettings };
    db.saveSettings(updatedSettings);
    
    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_SETTINGS',
      entityType: 'SETTINGS',
      entityId: 'global',
      payload: updatedSettings,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });
    
    setDbState(db.getState());
    setSyncStatus(SyncService.getSyncStatus());
    
    // Push immediately
    pushPendingItems();
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
        syncStatus,
        triggerSync,
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
