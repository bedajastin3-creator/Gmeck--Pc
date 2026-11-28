import {
  User,
  Category,
  Product,
  Sale,
  Purchase,
  Expense,
  InventoryMovement,
  BusinessSettings,
  AuditLog,
  SyncQueueItem,
  Shop,
  Store,
  ImportHistoryItem,
  DebtRecord,
  AppNotification,
  SaleEditRequest,
  StockTransfer,
  PurchaseReturn,
  CustomerRecord,
} from '../types';
import { INITIAL_SETTINGS } from './seedData';

export interface DatabaseState {
  shops: Shop[];
  stores: Store[];
  users: User[];
  categories: Category[];
  products: Product[];
  sales: Sale[];
  purchases: Purchase[];
  expenses: Expense[];
  movements: InventoryMovement[];
  settings: BusinessSettings;
  auditLogs: AuditLog[];
  syncQueue: SyncQueueItem[];
  importHistory: ImportHistoryItem[];
  debts: DebtRecord[];
  notifications: AppNotification[];
  saleEditRequests: SaleEditRequest[];
  stockTransfers: StockTransfer[];
  purchaseReturns: PurchaseReturn[];
  customerRecords?: CustomerRecord[];
}

type DBListener = () => void;

/**
 * Pure in-memory session database.
 * Online-only mode: no business records are saved to or loaded from localStorage.
 * Every mutation commits to the Cloudflare D1 backend first and updates this in-memory cache.
 */
class MemoryDatabase {
  private listeners: Set<DBListener> = new Set();
  private memoryCache: DatabaseState | null = null;
  private cloudLoaded = false;
  private preMigrationSnapshot: any = null;

  constructor() {
    this.cleanupLegacyStorage();
    this.init();
  }

  private cleanupLegacyStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (
            key &&
            (key.startsWith('omnibiz_pos_db_v1_') ||
              key.startsWith('omnibiz_pos_db_v2_') ||
              key.startsWith('omnibiz_pos_db_v3_') ||
              key === 'omnibiz_pre_migration_snapshot_v1' ||
              key === 'omnibiz_has_synced' ||
              key === 'omnibiz_last_synced_at')
          ) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      }
    } catch (e) {
      console.warn('[MemoryDB] Legacy storage cleanup warning', e);
    }
  }

  public init(): DatabaseState {
    this.memoryCache = {
      shops: [],
      stores: [],
      users: [],
      categories: [],
      products: [],
      sales: [],
      purchases: [],
      expenses: [],
      movements: [],
      settings: { ...INITIAL_SETTINGS },
      auditLogs: [],
      syncQueue: [],
      importHistory: [],
      debts: [],
      notifications: [],
      saleEditRequests: [],
      stockTransfers: [],
      purchaseReturns: [],
      customerRecords: [],
    };
    this.cloudLoaded = false;
    return this.memoryCache;
  }

  public isCloudLoaded(): boolean {
    return this.cloudLoaded;
  }

  public setCloudLoaded(loaded: boolean): void {
    this.cloudLoaded = loaded;
    this.notify();
  }

  public getState(): DatabaseState {
    if (!this.memoryCache) {
      return this.init();
    }
    return this.memoryCache;
  }

  public subscribe(listener: DBListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach(fn => {
      try {
        fn();
      } catch (err) {
        console.error('[MemoryDB] Listener error', err);
      }
    });
  }

  // --- Shops ---
  public getShops(): Shop[] {
    return this.getState().shops || [];
  }

  public saveShops(shops: Shop[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.shops = shops;
    this.notify();
  }

  // --- Stores (Warehouses) ---
  public getStores(): Store[] {
    return this.getState().stores || [];
  }

  public saveStores(stores: Store[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.stores = stores;
    this.notify();
  }

  // --- Stock Transfers ---
  public getStockTransfers(): StockTransfer[] {
    return this.getState().stockTransfers || [];
  }

  public saveStockTransfers(transfers: StockTransfer[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.stockTransfers = transfers;
    this.notify();
  }

  // --- Users ---
  public getUsers(): User[] {
    return this.getState().users || [];
  }

  public saveUsers(users: User[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.users = users;
    this.notify();
  }

  // --- Categories ---
  public getCategories(): Category[] {
    return this.getState().categories || [];
  }

  public saveCategories(categories: Category[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.categories = categories;
    this.notify();
  }

  // --- Products ---
  public getProducts(): Product[] {
    return this.getState().products || [];
  }

  public saveProducts(products: Product[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.products = products;
    this.notify();
  }

  // --- Sales ---
  public getSales(): Sale[] {
    return this.getState().sales || [];
  }

  public saveSales(sales: Sale[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.sales = sales;
    this.notify();
  }

  // --- Purchases ---
  public getPurchases(): Purchase[] {
    return this.getState().purchases || [];
  }

  public savePurchases(purchases: Purchase[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.purchases = purchases;
    this.notify();
  }

  // --- Purchase Returns ---
  public getPurchaseReturns(): PurchaseReturn[] {
    return this.getState().purchaseReturns || [];
  }

  public savePurchaseReturns(returns: PurchaseReturn[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.purchaseReturns = returns;
    this.notify();
  }

  // --- Customer Records ---
  public getCustomerRecords(): CustomerRecord[] {
    return this.getState().customerRecords || [];
  }

  public saveCustomerRecords(records: CustomerRecord[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.customerRecords = records;
    this.notify();
  }

  // --- Expenses ---
  public getExpenses(): Expense[] {
    return this.getState().expenses || [];
  }

  public saveExpenses(expenses: Expense[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.expenses = expenses;
    this.notify();
  }

  // --- Movements ---
  public getMovements(): InventoryMovement[] {
    return this.getState().movements || [];
  }

  public saveMovements(movements: InventoryMovement[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.movements = movements;
    this.notify();
  }

  // --- Settings ---
  public getSettings(): BusinessSettings {
    return this.getState().settings || INITIAL_SETTINGS;
  }

  public saveSettings(settings: BusinessSettings): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.settings = settings;
    this.notify();
  }

  // --- Audit Logs (in-memory session trace only) ---
  public getAuditLogs(): AuditLog[] {
    return this.getState().auditLogs || [];
  }

  public addAuditLog(log: AuditLog): void {
    if (!this.memoryCache) this.init();
    const updated = [log, ...(this.memoryCache!.auditLogs || [])].slice(0, 500);
    this.memoryCache!.auditLogs = updated;
    this.notify();
  }

  // --- Import History (in-memory session trace) ---
  public getImportHistory(): ImportHistoryItem[] {
    return this.getState().importHistory || [];
  }

  public saveImportHistory(history: ImportHistoryItem[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.importHistory = history;
    this.notify();
  }

  public addImportHistory(item: ImportHistoryItem): void {
    if (!this.memoryCache) this.init();
    const updated = [item, ...(this.memoryCache!.importHistory || [])].slice(0, 200);
    this.memoryCache!.importHistory = updated;
    this.notify();
  }

  // --- Sync Queue (always empty in online-only mode) ---
  public getSyncQueue(): SyncQueueItem[] {
    return [];
  }

  public saveSyncQueue(_queue: SyncQueueItem[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.syncQueue = [];
  }

  // --- Sale Edit Requests ---
  public getSaleEditRequests(): SaleEditRequest[] {
    return this.getState().saleEditRequests || [];
  }

  public saveSaleEditRequests(requests: SaleEditRequest[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.saleEditRequests = requests;
    this.notify();
  }

  public addSaleEditRequest(request: SaleEditRequest): void {
    if (!this.memoryCache) this.init();
    const updated = [request, ...(this.memoryCache!.saleEditRequests || [])];
    this.memoryCache!.saleEditRequests = updated;
    this.notify();
  }

  public updateSaleEditRequest(requestId: string, patch: Partial<SaleEditRequest>): void {
    if (!this.memoryCache) this.init();
    const current = this.memoryCache!.saleEditRequests || [];
    const updated = current.map(r => (r.id === requestId ? { ...r, ...patch } : r));
    this.memoryCache!.saleEditRequests = updated;
    this.notify();
  }

  // --- Debts ---
  public getDebts(): DebtRecord[] {
    return this.getState().debts || [];
  }

  public saveDebts(debts: DebtRecord[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.debts = debts;
    this.notify();
  }

  public addDebt(debt: DebtRecord): void {
    if (!this.memoryCache) this.init();
    const updated = [debt, ...(this.memoryCache!.debts || [])];
    this.memoryCache!.debts = updated;
    this.notify();
  }

  public updateDebt(debtId: string, patch: Partial<DebtRecord>): void {
    if (!this.memoryCache) this.init();
    const current = this.memoryCache!.debts || [];
    const updated = current.map(d =>
      d.id === debtId ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d
    );
    this.memoryCache!.debts = updated;
    this.notify();
  }

  public deleteDebt(debtId: string): void {
    if (!this.memoryCache) this.init();
    const current = this.memoryCache!.debts || [];
    const updated = current.filter(d => d.id !== debtId);
    this.memoryCache!.debts = updated;
    this.notify();
  }

  // --- Notifications ---
  public getNotifications(): AppNotification[] {
    return this.getState().notifications || [];
  }

  public saveNotifications(notifications: AppNotification[]): void {
    if (!this.memoryCache) this.init();
    this.memoryCache!.notifications = notifications;
    this.notify();
  }

  public addNotification(notification: AppNotification): void {
    if (!this.memoryCache) this.init();
    const current = this.memoryCache!.notifications || [];
    const isDup = current.some(
      n =>
        n.type === notification.type &&
        n.message === notification.message &&
        n.relatedEntityId === notification.relatedEntityId
    );
    if (!isDup) {
      const updated = [notification, ...current].slice(0, 300);
      this.memoryCache!.notifications = updated;
      this.notify();
    }
  }

  public markNotificationAsRead(notificationId: string, userId: string): void {
    if (!this.memoryCache) this.init();
    const current = this.memoryCache!.notifications || [];
    const updated = current.map(n => {
      if (n.id === notificationId) {
        const reads = n.readByUserIds || [];
        if (!reads.includes(userId)) {
          return { ...n, readByUserIds: [...reads, userId] };
        }
      }
      return n;
    });
    this.memoryCache!.notifications = updated;
    this.notify();
  }

  public markAllNotificationsAsRead(userId: string): void {
    if (!this.memoryCache) this.init();
    const current = this.memoryCache!.notifications || [];
    const updated = current.map(n => {
      const reads = n.readByUserIds || [];
      if (!reads.includes(userId)) {
        return { ...n, readByUserIds: [...reads, userId] };
      }
      return n;
    });
    this.memoryCache!.notifications = updated;
    this.notify();
  }

  // --- Backup & Export (reads current live in-memory cloud snapshot) ---
  public exportFullBackup(): string {
    const data = this.getState();
    const payload = {
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      generator: 'Gmeck Cloud Business System',
      data,
    };
    return JSON.stringify(payload, null, 2);
  }

  public importFullBackup(jsonString: string): { success: boolean; message: string } {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || !parsed.data) {
        return { success: false, message: 'Invalid backup file structure: missing data payload' };
      }
      const d = parsed.data as DatabaseState;
      if (!Array.isArray(d.users) || !Array.isArray(d.products) || !Array.isArray(d.sales)) {
        return { success: false, message: 'Corrupt database snapshot: core tables are missing' };
      }

      this.memoryCache = {
        shops: d.shops || [],
        stores: d.stores || [],
        users: d.users,
        categories: d.categories || [],
        products: d.products,
        sales: d.sales,
        purchases: d.purchases || [],
        expenses: d.expenses || [],
        movements: d.movements || [],
        settings: d.settings || { ...INITIAL_SETTINGS },
        auditLogs: d.auditLogs || [],
        syncQueue: [],
        importHistory: d.importHistory || [],
        debts: d.debts || [],
        notifications: d.notifications || [],
        saleEditRequests: d.saleEditRequests || [],
        stockTransfers: d.stockTransfers || [],
        purchaseReturns: d.purchaseReturns || [],
        customerRecords: d.customerRecords || [],
      };
      this.notify();
      return {
        success: true,
        message: `Loaded backup from ${parsed.exportedAt || 'archive'} into memory`,
      };
    } catch (e: any) {
      return {
        success: false,
        message: `Failed to parse backup: ${e.message || 'JSON parse error'}`,
      };
    }
  }

  public savePreMigrationSnapshot(label: string = 'Pre-Import Snapshot'): boolean {
    const state = this.getState();
    this.preMigrationSnapshot = {
      savedAt: new Date().toISOString(),
      label,
      shops: [...(state.shops || [])],
      stores: [...(state.stores || [])],
      categories: [...(state.categories || [])],
      products: [...(state.products || [])],
      sales: [...(state.sales || [])],
      importHistory: [...(state.importHistory || [])],
    };
    return true;
  }

  public hasPreMigrationSnapshot(): {
    exists: boolean;
    savedAt?: string;
    label?: string;
    productCount?: number;
    storeCount?: number;
  } {
    if (!this.preMigrationSnapshot || !Array.isArray(this.preMigrationSnapshot.products)) {
      return { exists: false };
    }
    return {
      exists: true,
      savedAt: this.preMigrationSnapshot.savedAt,
      label: this.preMigrationSnapshot.label,
      productCount: this.preMigrationSnapshot.products.length,
      storeCount: Array.isArray(this.preMigrationSnapshot.stores)
        ? this.preMigrationSnapshot.stores.length
        : 0,
    };
  }

  public restorePreMigrationSnapshot(): { success: boolean; message: string } {
    if (!this.preMigrationSnapshot || !Array.isArray(this.preMigrationSnapshot.products)) {
      return { success: false, message: 'No pre-import snapshot is available to restore.' };
    }
    const snap = this.preMigrationSnapshot;
    if (!this.memoryCache) this.init();
    if (Array.isArray(snap.shops)) this.memoryCache!.shops = snap.shops;
    if (Array.isArray(snap.stores)) this.memoryCache!.stores = snap.stores;
    if (Array.isArray(snap.categories)) this.memoryCache!.categories = snap.categories;
    this.memoryCache!.products = snap.products;
    if (Array.isArray(snap.sales)) this.memoryCache!.sales = snap.sales;
    if (Array.isArray(snap.importHistory)) this.memoryCache!.importHistory = snap.importHistory;
    this.preMigrationSnapshot = null;
    this.notify();
    return {
      success: true,
      message: `Restored "${snap.label || 'import'}" (${snap.products.length} products) in memory.`,
    };
  }

  public clearPreMigrationSnapshot(): void {
    this.preMigrationSnapshot = null;
  }

  public wipeAllData(keepShopsAndAdmin: boolean = true): void {
    const existingShops = keepShopsAndAdmin ? this.memoryCache?.shops || [] : [];
    const existingUsers = keepShopsAndAdmin ? this.memoryCache?.users || [] : [];
    const existingSettings = this.memoryCache?.settings || { ...INITIAL_SETTINGS };

    this.memoryCache = {
      shops: existingShops,
      stores: [],
      users: existingUsers,
      categories: [],
      products: [],
      sales: [],
      purchases: [],
      expenses: [],
      movements: [],
      settings: existingSettings,
      auditLogs: [],
      syncQueue: [],
      importHistory: [],
      debts: [],
      notifications: [],
      saleEditRequests: [],
      stockTransfers: [],
      purchaseReturns: [],
      customerRecords: [],
    };
    this.notify();
  }

  public resetToDefaultDemo(): void {
    this.wipeAllData(true);
  }
}

export const db = new MemoryDatabase();
export const StorageService = db;
