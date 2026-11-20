// src/services/syncService.ts
import { db } from '../db/storage';
import { SaleEditRequest, SyncQueueItem, User } from '../types';
import { CloudflareApi } from './cloudflareApi';

export type SyncState = 'OFFLINE_LOCAL' | 'PENDING_SYNC' | 'SYNCING' | 'SYNCED';

const OP_ORDER: Record<string, number> = {
  // Tier 1 — roots
  CREATE_SHOP: 1,
  UPDATE_SHOP: 1,
  TOGGLE_SHOP_STATUS: 1,

  // Tier 2 — depend on shops
  CREATE_CATEGORY: 2,
  UPDATE_CATEGORY: 2,
  CREATE_STORE: 2,
  UPDATE_STORE: 2,
  CREATE_SELLER: 2,
  UPDATE_SELLER: 2,
  DELETE_SELLER: 2,

  // Tier 3 — depend on categories/stores/users
  CREATE_PRODUCT: 3,
  UPDATE_PRODUCT: 3,
  TOGGLE_PRODUCT_STATUS: 3,
  DELETE_PRODUCT: 3,
  STOCK_ADJUSTMENT: 3,

  // Tier 4 — inventory transactions
  CREATE_PURCHASE: 4,
  UPDATE_PURCHASE: 4,
  TRANSFER_STORE_TO_SHOP: 4,
  UPSERT_STOCK_TRANSFER: 4,

  // Tier 5 — sales & downstream
  CREATE_PURCHASE_RETURN: 5,
  CREATE_SALE: 5,
  UPDATE_SALE: 5,
  VOID_SALE: 5,
  CREATE_SALE_EDIT_REQUEST: 5,
  REVIEW_SALE_EDIT_REQUEST: 5,
  CREATE_EXPENSE: 5,
  CREATE_DEBT: 5,
  UPDATE_DEBT: 5,
  DELETE_DEBT: 5,

  // Cleanup
  DELETE_PURCHASE: 90,
  DELETE_SHOP: 90,
  DELETE_STORE: 90,
  DELETE_STOCK_TRANSFER: 90,
  DELETE_PRODUCT_DEEP: 90,
};

export class SyncService {
  private static isSimulatingSync = false;
  private static isSyncing = false;
  private static lastSyncedAt: string | null = localStorage.getItem(
    'omnibiz_last_synced_at'
  );
  private static lastSyncAttempt: number = 0;
  private static readonly SYNC_INTERVAL_MS = 60000;
  private static hasLocalChanges = false;

  public static markLocalChanged(): void {
    this.hasLocalChanges = true;
  }

  public static shouldSync(): boolean {
    const pendingCount = this.getPendingCount();
    if (pendingCount > 0) return true;

    const now = Date.now();
    const timeSinceLastSync = now - this.lastSyncAttempt;
    return this.hasLocalChanges && timeSinceLastSync >= this.SYNC_INTERVAL_MS;
  }

  public static getQueueItems(): SyncQueueItem[] {
    return db.getSyncQueue();
  }

  public static getPendingCount(): number {
    return db.getSyncQueue().filter(item => item.status === 'PENDING').length;
  }

  public static getSyncStats(): {
    total: number;
    pending: number;
    synced: number;
    failed: number;
  } {
    const queue = db.getSyncQueue();
    return {
      total: queue.length,
      pending: queue.filter(q => q.status === 'PENDING').length,
      synced: queue.filter(q => q.status === 'SYNCED').length,
      failed: queue.filter(q => q.status === 'FAILED').length,
    };
  }

  public static getSyncStatus(): {
    state: SyncState;
    pendingCount: number;
    lastSyncedAt?: string;
  } {
    const queue = db.getSyncQueue();
    const pending = queue.filter(q => q.status === 'PENDING').length;

    if (SyncService.isSyncing) {
      return {
        state: 'SYNCING',
        pendingCount: pending,
        lastSyncedAt: this.lastSyncedAt || undefined,
      };
    }

    if (pending > 0) {
      return {
        state: 'PENDING_SYNC',
        pendingCount: pending,
        lastSyncedAt: this.lastSyncedAt || undefined,
      };
    }

    return {
      state: this.lastSyncedAt ? 'SYNCED' : 'OFFLINE_LOCAL',
      pendingCount: 0,
      lastSyncedAt: this.lastSyncedAt || undefined,
    };
  }

  /**
   * Sort PENDING queue items by dependency tier first, then chronologically (oldest first)
   * because db.enqueueSync prepends newest items at index 0.
   */
  public static sortPendingItems(items: SyncQueueItem[]): SyncQueueItem[] {
    return [...items].sort((a, b) => {
      const opA = (a.operation || a.action) as string;
      const opB = (b.operation || b.action) as string;
      const tierDiff = (OP_ORDER[opA] ?? 99) - (OP_ORDER[opB] ?? 99);
      if (tierDiff !== 0) return tierDiff;
      return (
        new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
      );
    });
  }

  /**
   * Push PENDING items only (without forcing a pull) using topological OP_ORDER
   * sorting and per-item reconciliation. Used by AppContext background auto-push.
   */
  public static async pushPendingOnly(): Promise<{
    success: boolean;
    processedCount: number;
    failedCount: number;
    errors: any[];
    results: any[];
  }> {
    const pendingItems = db.getSyncQueue().filter(item => item.status === 'PENDING');
    if (pendingItems.length === 0) {
      return {
        success: true,
        processedCount: 0,
        failedCount: 0,
        errors: [],
        results: [],
      };
    }

    const sorted = this.sortPendingItems(pendingItems);
    const BATCH_SIZE = 50;
    const allResults: any[] = [];
    const allErrors: any[] = [];
    let overallSuccess = true;

    for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
      const batch = sorted.slice(i, i + BATCH_SIZE);
      const operations = batch.map(item => ({
        id: item.id,
        operation: item.operation || item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        payload: item.payload,
      }));

      const pushResult = await CloudflareApi.pushSync(operations);

      const pushSuccess = pushResult.success === true;
      const pushErrors = pushResult.errors || [];
      const pushResults = pushResult.results || [];

      if (!pushSuccess) overallSuccess = false;
      allResults.push(...pushResults);
      allErrors.push(...pushErrors);

      // ── Per-item reconciliation ──
      const okIds = new Set<string>(pushResults.map((r: any) => r.id));
      const failedMap = new Map<string, string>();
      for (const err of pushErrors) {
        failedMap.set(err.id, err.error || 'Unknown error');
      }

      const now = new Date().toISOString();
      const reconciledQueue = db.getSyncQueue().map(item => {
        if (item.status !== 'PENDING') return item;

        if (okIds.has(item.id)) {
          return { ...item, status: 'SYNCED' as const, syncedAt: now };
        }

        if (failedMap.has(item.id)) {
          const errMsg = failedMap.get(item.id)!;
          console.error(
            `[sync] ${item.operation || item.action} failed for ${item.entityId}: ${errMsg}`
          );
          return {
            ...item,
            status: 'FAILED' as const,
            lastError: errMsg,
            failedAt: now,
            retryCount: (item.retryCount || 0) + 1,
          };
        }

        return item;
      });
      db.saveSyncQueue(reconciledQueue);

      if (pushSuccess) {
        this.lastSyncedAt = now;
        localStorage.setItem('omnibiz_last_synced_at', now);
      }

      if (i + BATCH_SIZE < sorted.length) {
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }

    if (!overallSuccess) {
      console.warn(
        `[sync] Push partial: ${allResults.length} ok, ${allErrors.length} failed`,
        allErrors.slice(0, 10)
      );
    }

    return {
      success: overallSuccess,
      processedCount: allResults.length,
      failedCount: allErrors.length,
      errors: allErrors,
      results: allResults,
    };
  }

  public static async processSyncQueue(
    _currentUser?: User,
    force: boolean = false
  ): Promise<{ success: boolean; processedCount: number; message?: string }> {
    if (!force && !this.shouldSync() && !this.isSyncing) {
      return {
        success: true,
        processedCount: 0,
        message: 'Sync skipped - no pending changes',
      };
    }

    const online = await CloudflareApi.checkConnection();

    if (!online) {
      return {
        success: false,
        processedCount: 0,
        message: 'Offline mode: Working locally. Will sync when online.',
      };
    }

    if (SyncService.isSyncing) {
      return {
        success: false,
        processedCount: 0,
        message: 'Sync already in progress',
      };
    }

    SyncService.isSyncing = true;
    this.lastSyncAttempt = Date.now();

    try {
      const pendingBefore = this.getPendingCount();

      let pushSuccess = true;
      let pushErrors: any[] = [];
      let pushResults: any[] = [];

      // ───────────────────────────────────────────────────────────
      // 1. PUSH
      // ───────────────────────────────────────────────────────────
      if (pendingBefore > 0) {
        const pushOutcome = await this.pushPendingOnly();
        pushSuccess = pushOutcome.success;
        pushErrors = pushOutcome.errors;
        pushResults = pushOutcome.results;
      }

      // ───────────────────────────────────────────────────────────
      // 2. PULL (only if push fully succeeded OR forced/local changes)
      // ───────────────────────────────────────────────────────────
      const canPull =
        pushSuccess && (force || pendingBefore > 0 || this.hasLocalChanges);

      if (canPull) {
        const pullResult = await CloudflareApi.pullSync(
          force ? undefined : this.lastSyncedAt || undefined
        );

        if (pullResult.success && pullResult.data) {
          this.applyCloudData(pullResult.data);
          this.lastSyncedAt = new Date().toISOString();
          localStorage.setItem('omnibiz_last_synced_at', this.lastSyncedAt);
        }
      }

      this.hasLocalChanges = false;
      SyncService.isSyncing = false;

      // ───────────────────────────────────────────────────────────
      // 3. Honest return value
      // ───────────────────────────────────────────────────────────
      if (!pushSuccess) {
        const firstError = pushErrors[0]?.error || 'unknown';
        return {
          success: false,
          processedCount: pushResults.length,
          message: `Sync partial: ${pushResults.length} pushed, ${pushErrors.length} failed. First error: ${firstError}`,
        };
      }

      return {
        success: true,
        processedCount: pendingBefore,
        message:
          pendingBefore > 0
            ? `Cloud sync complete: ${pendingBefore} pushed, cloud data pulled.`
            : 'Cloud sync complete: all records up to date.',
      };
    } catch (error: any) {
      SyncService.isSyncing = false;
      return {
        success: false,
        processedCount: 0,
        message: `Cloud sync failed: ${error.message}. Working offline.`,
      };
    }
  }

  // Retry failed items by flipping them back to PENDING.
  public static retryFailed(): void {
    const queue = db.getSyncQueue().map(item =>
      item.status === 'FAILED'
        ? ({ ...item, status: 'PENDING' as const } as SyncQueueItem)
        : item
    );
    db.saveSyncQueue(queue);
  }

  // Drop FAILED items (e.g. after user acknowledges).
  public static clearFailed(): void {
    const queue = db.getSyncQueue().filter(q => q.status !== 'FAILED');
    db.saveSyncQueue(queue);
  }

  public static async simulateServerSync(): Promise<{
    success: boolean;
    syncedCount: number;
  }> {
    if (SyncService.isSimulatingSync) {
      return { success: false, syncedCount: 0 };
    }

    SyncService.isSimulatingSync = true;
    const queue = db.getSyncQueue();
    const pendingItems = queue.filter(item => item.status === 'PENDING');

    if (pendingItems.length === 0) {
      SyncService.isSimulatingSync = false;
      return { success: true, syncedCount: 0 };
    }

    await new Promise(resolve => setTimeout(resolve, 1200));

    const updatedQueue = queue.map(item => {
      if (item.status === 'PENDING') {
        return { ...item, status: 'SYNCED' as const };
      }
      return item;
    });

    db.saveSyncQueue(updatedQueue);
    SyncService.isSimulatingSync = false;

    return { success: true, syncedCount: pendingItems.length };
  }

  public static clearCompleted(): void {
    const queue = db.getSyncQueue().filter(q => q.status !== 'SYNCED');
    db.saveSyncQueue(queue);
  }

  public static applyCloudShops(
    cloudShops: any[],
    options?: { reconcileDeleted?: boolean }
  ): void {
    if (!Array.isArray(cloudShops)) return;

    const queue = db.getSyncQueue();
    const pendingDeleteShopIds = new Set(
      queue
        .filter(q => q.status === 'PENDING' && (q.operation || q.action) === 'DELETE_SHOP')
        .map(q => q.entityId)
    );
    const pendingMutateShopIds = new Set(
      queue
        .filter(
          q =>
            q.status === 'PENDING' &&
            ['CREATE_SHOP', 'UPDATE_SHOP', 'TOGGLE_SHOP_STATUS'].includes(
              String(q.operation || q.action)
            )
        )
        .map(q => q.entityId)
    );

    const localShops = db.getShops();
    const merged: any[] = options?.reconcileDeleted
      ? localShops.filter(s => pendingMutateShopIds.has(s.id) && !pendingDeleteShopIds.has(s.id))
      : localShops.filter(s => !pendingDeleteShopIds.has(s.id));

    cloudShops.forEach((cloudShop: any) => {
      if (!cloudShop?.id || pendingDeleteShopIds.has(cloudShop.id)) return;
      const index = merged.findIndex(s => s.id === cloudShop.id);
      if (index !== -1 && pendingMutateShopIds.has(cloudShop.id)) {
        return;
      }
      const existing = index !== -1 ? merged[index] : undefined;
      const rawStatus = String(cloudShop.status || existing?.status || 'ACTIVE').toUpperCase();
      const shopData = {
        id: cloudShop.id,
        name: cloudShop.name ?? existing?.name ?? '',
        code: cloudShop.code ?? existing?.code,
        description: cloudShop.description ?? existing?.description,
        address: cloudShop.address ?? existing?.address,
        phone: cloudShop.phone ?? existing?.phone,
        status: (rawStatus === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
        color: cloudShop.color ?? existing?.color,
        createdAt: cloudShop.created_at || cloudShop.createdAt || existing?.createdAt || new Date().toISOString(),
        updatedAt: cloudShop.updated_at || cloudShop.updatedAt || existing?.updatedAt || new Date().toISOString(),
      };

      if (index === -1) {
        merged.push(shopData);
      } else {
        merged[index] = { ...existing, ...shopData };
      }
    });

    db.saveShops(merged);
  }

  public static applyCloudStores(
    cloudStores: any[],
    options?: { reconcileDeleted?: boolean }
  ) {
    if (!Array.isArray(cloudStores)) return db.getStores();

    const queue = db.getSyncQueue();
    const pendingDeleteStoreIds = new Set(
      queue
        .filter(q => q.status === 'PENDING' && (q.operation || q.action) === 'DELETE_STORE')
        .map(q => q.entityId)
    );
    const pendingMutateStoreIds = new Set(
      queue
        .filter(
          q =>
            q.status === 'PENDING' &&
            ['CREATE_STORE', 'UPDATE_STORE'].includes(String(q.operation || q.action))
        )
        .map(q => q.entityId)
    );

    const localStores = db.getStores();
    const mergedStores = options?.reconcileDeleted
      ? localStores.filter(s => pendingMutateStoreIds.has(s.id) && !pendingDeleteStoreIds.has(s.id))
      : localStores.filter(s => !pendingDeleteStoreIds.has(s.id));

    cloudStores.forEach((cloudStore: any) => {
      if (!cloudStore?.id || pendingDeleteStoreIds.has(cloudStore.id)) return;
      const index = mergedStores.findIndex(s => s.id === cloudStore.id);
      if (index !== -1 && pendingMutateStoreIds.has(cloudStore.id)) {
        return;
      }

      const existingStore = index !== -1 ? mergedStores[index] : undefined;
      const rawStatus = String(
        cloudStore.status || existingStore?.status || 'ACTIVE'
      ).toUpperCase();
      const resolvedShopId = cloudStore.shop_id || cloudStore.shopId || existingStore?.shopId || '';
      if (!resolvedShopId) return;

      const storeData = {
        id: cloudStore.id,
        shopId: resolvedShopId,
        name: cloudStore.name ?? existingStore?.name ?? 'Unnamed Store',
        location: cloudStore.location || existingStore?.location || undefined,
        status: (rawStatus === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
        isShopFloor:
          cloudStore.is_shop_floor !== undefined
            ? Boolean(cloudStore.is_shop_floor)
            : cloudStore.isShopFloor !== undefined
              ? Boolean(cloudStore.isShopFloor)
              : existingStore?.isShopFloor,
        createdAt:
          cloudStore.created_at ||
          cloudStore.createdAt ||
          existingStore?.createdAt ||
          new Date().toISOString(),
        updatedAt:
          cloudStore.updated_at ||
          cloudStore.updatedAt ||
          existingStore?.updatedAt ||
          new Date().toISOString(),
      };

      if (index === -1) {
        mergedStores.push(storeData);
      } else {
        mergedStores[index] = { ...existingStore, ...storeData };
      }
    });

    db.saveStores(mergedStores);
    return mergedStores;
  }

  // ==========================================
  // APPLY CLOUD DATA TO LOCAL DATABASE
  // ==========================================
  public static applyCloudData(cloudData: any): void {
    if (!cloudData) return;

    // Apply shops
    if (Array.isArray(cloudData.shops) && cloudData.shops.length > 0) {
      this.applyCloudShops(cloudData.shops);
    }

    // Apply stores (warehouses)
    if (Array.isArray(cloudData.stores) && cloudData.stores.length > 0) {
      this.applyCloudStores(cloudData.stores);
    }

    // Apply users
    if (cloudData.users && cloudData.users.length > 0) {
      const localUsers = db.getUsers();
      const mergedUsers = [...localUsers];

      cloudData.users.forEach((cloudUser: any) => {
        const index = mergedUsers.findIndex(u => u.id === cloudUser.id);

        let parsedPermissions: any = {};
        try {
          if (cloudUser.permissions) {
            parsedPermissions =
              typeof cloudUser.permissions === 'string'
                ? JSON.parse(cloudUser.permissions)
                : cloudUser.permissions;
          }
        } catch (e) {
          console.warn('Failed to parse permissions for user:', cloudUser.id, e);
          parsedPermissions = {};
        }

        let parsedShopIds: string[] = [];
        try {
          if (cloudUser.assigned_shop_ids) {
            parsedShopIds =
              typeof cloudUser.assigned_shop_ids === 'string'
                ? JSON.parse(cloudUser.assigned_shop_ids)
                : cloudUser.assigned_shop_ids;
          }
        } catch (e) {
          console.warn(
            'Failed to parse assigned_shop_ids for user:',
            cloudUser.id,
            e
          );
          parsedShopIds = [];
        }

        const userData = {
          id: cloudUser.id,
          username: cloudUser.username,
          name: cloudUser.name,
          role: cloudUser.role,
          passwordHash: cloudUser.password_hash,
          color: cloudUser.color,
          status: cloudUser.status,
          assignedShopIds: parsedShopIds,
          avatarUrl: cloudUser.avatar_url || cloudUser.avatarUrl || null,
          permissions: parsedPermissions,
          createdAt: cloudUser.created_at,
          updatedAt: cloudUser.updated_at,
        };

        if (index === -1) {
          mergedUsers.push(userData);
        } else {
          mergedUsers[index] = { ...mergedUsers[index], ...userData };
        }
      });

      db.saveUsers(mergedUsers);
    }

    // Apply categories
    if (cloudData.categories && cloudData.categories.length > 0) {
      const localCats = db.getCategories();
      const mergedCats = [...localCats];

      cloudData.categories.forEach((cloudCat: any) => {
        const index = mergedCats.findIndex(c => c.id === cloudCat.id);
        const catData = {
          id: cloudCat.id,
          shopId: cloudCat.shop_id,
          name: cloudCat.name,
          icon: cloudCat.icon,
          color: cloudCat.color,
          status: cloudCat.status,
          createdAt: cloudCat.created_at,
          updatedAt: cloudCat.updated_at,
        };

        if (index === -1) {
          mergedCats.push(catData);
        } else {
          mergedCats[index] = { ...mergedCats[index], ...catData };
        }
      });

      db.saveCategories(mergedCats);
    }

    // Apply products
    if (cloudData.products && cloudData.products.length > 0) {
      const localProducts = db.getProducts();
      const mergedProducts = [...localProducts];

      cloudData.products.forEach((cloudProduct: any) => {
        const index = mergedProducts.findIndex(p => p.id === cloudProduct.id);

        const productImages = (cloudData.productImages || [])
          .filter((img: any) => img.product_id === cloudProduct.id)
          .map((img: any) => ({
            imageId: img.image_id,
            productId: img.product_id,
            imageOrder: img.image_order,
            version: img.version,
            dataUrl: img.r2_key,
            thumbnailUrl: img.r2_key,
            filename: img.filename,
            mimeType: img.mime_type,
            fileSize: img.file_size,
            syncStatus: img.sync_status,
            createdAt: img.created_at,
            updatedAt: img.updated_at,
          }));

        const parseMaybeJson = <T,>(raw: any, fallback?: T): T | undefined => {
          if (raw === undefined || raw === null || raw === '') return fallback;
          if (typeof raw === 'string') {
            try {
              return JSON.parse(raw) as T;
            } catch {
              return fallback;
            }
          }
          return raw as T;
        };

        const existingProd = index !== -1 ? mergedProducts[index] : undefined;
        const parsedStoreStocks = parseMaybeJson<Record<string, number>>(
          cloudProduct.store_stocks ?? cloudProduct.storeStocks,
          existingProd?.storeStocks
        );
        const parsedStoreDetails = parseMaybeJson<Record<string, any>>(
          cloudProduct.store_details ?? cloudProduct.storeDetails,
          existingProd?.storeDetails
        );
        const parsedCustomFields = parseMaybeJson<any>(
          cloudProduct.custom_fields ?? cloudProduct.customFields,
          existingProd?.customFields
        );

        const productData = {
          id: cloudProduct.id,
          shopId: cloudProduct.shop_id,
          storeId: cloudProduct.store_id || cloudProduct.storeId || existingProd?.storeId,
          name: cloudProduct.name,
          variation: cloudProduct.variation ?? existingProd?.variation,
          sku: cloudProduct.sku,
          barcode: cloudProduct.barcode || existingProd?.barcode || '',
          categoryId: cloudProduct.category_id,
          sellingPrice: cloudProduct.selling_price,
          proposedSellingPrice: cloudProduct.proposed_selling_price,
          purchasePrice: cloudProduct.purchase_price,
          currentStock: cloudProduct.current_stock ?? existingProd?.currentStock ?? 0,
          storeStock: cloudProduct.store_stock ?? existingProd?.storeStock ?? 0,
          ...(parsedStoreStocks ? { storeStocks: parsedStoreStocks } : {}),
          ...(parsedStoreDetails ? { storeDetails: parsedStoreDetails } : {}),
          ...(parsedCustomFields ? { customFields: parsedCustomFields } : {}),
          minStock: cloudProduct.min_stock,
          unit: cloudProduct.unit,
          status: cloudProduct.status,
          imageUrl: cloudProduct.image_url,
          images: productImages.length > 0 ? productImages : existingProd?.images,
          createdAt: cloudProduct.created_at,
          updatedAt: cloudProduct.updated_at,
        };

        if (index === -1) {
          mergedProducts.push(productData);
        } else {
          mergedProducts[index] = { ...existingProd, ...productData };
        }
      });

      db.saveProducts(mergedProducts);
    }

    // Apply sales
    if (cloudData.sales && cloudData.sales.length > 0) {
      const localSales = db.getSales();
      const mergedSales = [...localSales];

      cloudData.sales.forEach((cloudSale: any) => {
        const index = mergedSales.findIndex(s => s.id === cloudSale.id);

        const saleItems = (cloudData.saleItems || [])
          .filter((item: any) => item.sale_id === cloudSale.id)
          .map((item: any) => ({
            id: item.id,
            saleId: item.sale_id,
            shopId: item.shop_id,
            productId: item.product_id,
            productName: item.product_name,
            sku: item.sku,
            unitPrice: item.unit_price,
            purchasePrice: item.purchase_price,
            quantity: item.quantity,
            discount: item.discount,
            total: item.total,
            referencePrice: item.reference_price ?? undefined,
            referenceType: item.reference_type ?? undefined,
          }));

        const saleData = {
          id: cloudSale.id,
          receiptNumber: cloudSale.receipt_number,
          shopId: cloudSale.shop_id,
          shopName: cloudSale.shop_name,
          sellerId: cloudSale.seller_id,
          sellerName: cloudSale.seller_name,
          assistantName: cloudSale.assistant_name || undefined,
          subtotal: cloudSale.subtotal,
          discount: cloudSale.discount,
          tax: cloudSale.tax,
          total: cloudSale.total,
          costOfGoods: cloudSale.cost_of_goods,
          grossProfit: cloudSale.gross_profit,
          paymentMethod: cloudSale.payment_method,
          amountReceived: cloudSale.amount_received,
          change: cloudSale.change,
          status: cloudSale.status,
          notes: cloudSale.notes,
          createdAt: cloudSale.created_at,
          items: saleItems,
        };

        if (index === -1) {
          mergedSales.push(saleData);
        } else {
          mergedSales[index] = { ...mergedSales[index], ...saleData };
        }
      });

      db.saveSales(mergedSales);
    }

    // Apply purchases
    if (cloudData.purchases && cloudData.purchases.length > 0) {
      const queue = db.getSyncQueue();
      const pendingDeletePurchaseIds = new Set(
        queue
          .filter(q => q.status === 'PENDING' && (q.operation || q.action) === 'DELETE_PURCHASE')
          .map(q => q.entityId)
      );

      const localPurchases = db
        .getPurchases()
        .filter(p => !pendingDeletePurchaseIds.has(p.id));
      const mergedPurchases = [...localPurchases];

      cloudData.purchases.forEach((cloudPurchase: any) => {
        if (!cloudPurchase?.id || pendingDeletePurchaseIds.has(cloudPurchase.id)) return;
        const index = mergedPurchases.findIndex(p => p.id === cloudPurchase.id);

        const purchaseItems = (cloudData.purchaseItems || [])
          .filter((item: any) => item.purchase_id === cloudPurchase.id)
          .map((item: any) => ({
            id: item.id,
            productId: item.product_id,
            productName: item.product_name,
            quantity: item.quantity,
            unitCost: item.unit_cost,
            total: item.total,
          }));

        const purchaseData = {
          id: cloudPurchase.id,
          purchaseNumber: cloudPurchase.purchase_number,
          shopId: cloudPurchase.shop_id,
          shopName: cloudPurchase.shop_name,
          storeId: cloudPurchase.store_id || undefined,
          storeName: cloudPurchase.store_name || undefined,
          supplierName: cloudPurchase.supplier_name,
          date: cloudPurchase.date,
          totalAmount: cloudPurchase.total_amount,
          paymentStatus: cloudPurchase.payment_status,
          notes: cloudPurchase.notes,
          invoiceNumber: cloudPurchase.invoice_number,
          createdByUserId: cloudPurchase.created_by_user_id,
          createdByName: cloudPurchase.created_by_name,
          createdAt: cloudPurchase.created_at,
          updatedAt: cloudPurchase.updated_at || undefined,
          items: purchaseItems,
        };

        if (index === -1) {
          mergedPurchases.push(purchaseData);
        } else {
          mergedPurchases[index] = { ...mergedPurchases[index], ...purchaseData };
        }
      });

      db.savePurchases(mergedPurchases);
    }

    // Apply purchase returns
    if (cloudData.purchaseReturns && cloudData.purchaseReturns.length > 0) {
      const localReturns = db.getPurchaseReturns();
      const mergedReturns = [...localReturns];

      cloudData.purchaseReturns.forEach((cloudRet: any) => {
        if (!cloudRet?.id) return;
        const index = mergedReturns.findIndex(r => r.id === cloudRet.id);

        const returnItems = (cloudData.purchaseReturnItems || [])
          .filter((item: any) => item.return_id === cloudRet.id)
          .map((item: any) => ({
            id: item.id,
            productId: item.product_id,
            productName: item.product_name,
            originalQty: Number(item.original_qty) || 0,
            returnQty: Number(item.return_qty) || 0,
            remainingQty: Number(item.remaining_qty) || 0,
            unitCost: Number(item.unit_cost) || 0,
            returnTotal: Number(item.return_total) || 0,
          }));

        const returnData = {
          id: cloudRet.id,
          returnNumber: cloudRet.return_number,
          purchaseId: cloudRet.purchase_id,
          purchaseNumber: cloudRet.purchase_number,
          shopId: cloudRet.shop_id,
          shopName: cloudRet.shop_name || undefined,
          storeId: cloudRet.store_id || undefined,
          storeName: cloudRet.store_name || undefined,
          supplierName: cloudRet.supplier_name,
          invoiceNumber: cloudRet.invoice_number || undefined,
          items: returnItems,
          totalReturnQty: Number(cloudRet.total_return_qty) || 0,
          totalReturnAmount: Number(cloudRet.total_return_amount) || 0,
          reason: cloudRet.reason || '',
          returnedByUserId: cloudRet.returned_by_user_id,
          returnedByName: cloudRet.returned_by_name,
          createdAt: cloudRet.created_at,
        };

        if (index === -1) {
          mergedReturns.push(returnData);
        } else {
          mergedReturns[index] = { ...mergedReturns[index], ...returnData };
        }
      });

      mergedReturns.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      db.savePurchaseReturns(mergedReturns);
    }

    // Apply expenses
    if (cloudData.expenses && cloudData.expenses.length > 0) {
      const localExpenses = db.getExpenses();
      const mergedExpenses = [...localExpenses];

      cloudData.expenses.forEach((cloudExpense: any) => {
        const index = mergedExpenses.findIndex(e => e.id === cloudExpense.id);
        const expenseData = {
          id: cloudExpense.id,
          shopId: cloudExpense.shop_id,
          shopName: cloudExpense.shop_name,
          isCompanyExpense: !!cloudExpense.is_company_expense,
          category: cloudExpense.category,
          description: cloudExpense.description,
          title: cloudExpense.title,
          amount: cloudExpense.amount,
          paymentMethod: cloudExpense.payment_method,
          date: cloudExpense.date,
          reference: cloudExpense.reference,
          notes: cloudExpense.notes,
          createdByUserId: cloudExpense.created_by_user_id,
          createdByName: cloudExpense.created_by_name,
          createdAt: cloudExpense.created_at,
        };

        if (index === -1) {
          mergedExpenses.push(expenseData);
        } else {
          mergedExpenses[index] = { ...mergedExpenses[index], ...expenseData };
        }
      });

      db.saveExpenses(mergedExpenses);
    }

    // Apply debts
    if (cloudData.debts && cloudData.debts.length > 0) {
      const localDebts = db.getDebts();
      const mergedDebts = [...localDebts];

      cloudData.debts.forEach((cloudDebt: any) => {
        const index = mergedDebts.findIndex(d => d.id === cloudDebt.id);
        const debtData = {
          id: cloudDebt.id,
          type: cloudDebt.type,
          debtorName: cloudDebt.debtor_name,
          productDescription: cloudDebt.product_description,
          amount: cloudDebt.amount,
          paidAmount: cloudDebt.paid_amount,
          remainingAmount: cloudDebt.remaining_amount,
          payments: [],
          dueDate: cloudDebt.due_date,
          contact: cloudDebt.contact,
          notes: cloudDebt.notes,
          status: cloudDebt.status,
          paidAt: cloudDebt.paid_at,
          paidByUserId: cloudDebt.paid_by_user_id,
          paidByName: cloudDebt.paid_by_name,
          paymentNotes: cloudDebt.payment_notes,
          createdByUserId: cloudDebt.created_by_user_id,
          createdByName: cloudDebt.created_by_name,
          shopId: cloudDebt.shop_id,
          createdAt: cloudDebt.created_at,
          updatedAt: cloudDebt.updated_at,
        };

        if (index === -1) {
          mergedDebts.push(debtData);
        } else {
          mergedDebts[index] = { ...mergedDebts[index], ...debtData };
        }
      });

      db.saveDebts(mergedDebts);
    }

    // Apply movements
    if (cloudData.movements && cloudData.movements.length > 0) {
      const localMovements = db.getMovements();
      const mergedMovements = [...localMovements];

      cloudData.movements.forEach((cloudMovement: any) => {
        const index = mergedMovements.findIndex(m => m.id === cloudMovement.id);
        const movementData = {
          id: cloudMovement.id,
          shopId: cloudMovement.shop_id,
          shopName: cloudMovement.shop_name,
          storeId: cloudMovement.store_id || undefined,
          productId: cloudMovement.product_id,
          productName: cloudMovement.product_name,
          previousQty: cloudMovement.previous_qty,
          changeQty: cloudMovement.change_qty,
          newQty: cloudMovement.new_qty,
          type: cloudMovement.type,
          reason: cloudMovement.reason,
          costValue: cloudMovement.cost_value,
          referenceId: cloudMovement.reference_id,
          userId: cloudMovement.user_id,
          userName: cloudMovement.user_name,
          createdAt: cloudMovement.created_at,
        };

        if (index === -1) {
          mergedMovements.push(movementData);
        } else {
          mergedMovements[index] = { ...mergedMovements[index], ...movementData };
        }
      });

      db.saveMovements(mergedMovements);
    }

    // Apply sale edit requests
    if (cloudData.saleEditRequests && cloudData.saleEditRequests.length > 0) {
      const localRequests = db.getSaleEditRequests();
      const mergedRequests = [...localRequests];

      cloudData.saleEditRequests.forEach((cloudRequest: any) => {
        const index = mergedRequests.findIndex(r => r.id === cloudRequest.id);

        let parsedOriginalValues: any = {};
        let parsedNewValues: any = {};

        try {
          parsedOriginalValues =
            typeof cloudRequest.original_values === 'string'
              ? JSON.parse(cloudRequest.original_values)
              : cloudRequest.original_values;
        } catch (e) {
          console.warn('Failed to parse original_values:', e);
        }

        try {
          parsedNewValues =
            typeof cloudRequest.new_values === 'string'
              ? JSON.parse(cloudRequest.new_values)
              : cloudRequest.new_values;
        } catch (e) {
          console.warn('Failed to parse new_values:', e);
        }

        const requestData: SaleEditRequest = {
          id: cloudRequest.id,
          saleId: cloudRequest.sale_id,
          requestedByUserId: cloudRequest.requested_by_user_id,
          requestedByName: cloudRequest.requested_by_name,
          originalValues: parsedOriginalValues,
          newValues: parsedNewValues,
          reason: cloudRequest.reason,
          status: cloudRequest.status,
          reviewedByUserId: cloudRequest.reviewed_by_user_id,
          reviewedByName: cloudRequest.reviewed_by_name,
          reviewNote: cloudRequest.review_note,
          createdAt: cloudRequest.created_at,
          reviewedAt: cloudRequest.reviewed_at,
        };

        if (index === -1) {
          mergedRequests.push(requestData);
        } else {
          mergedRequests[index] = { ...mergedRequests[index], ...requestData };
        }
      });

      db.saveSaleEditRequests(mergedRequests);
    }

    // Apply settings
    if (cloudData.settings) {
      const localSettings = db.getSettings();
      const mergedSettings = { ...localSettings };

      if (cloudData.settings.business_name)
        mergedSettings.businessName = cloudData.settings.business_name;
      if (cloudData.settings.tagline)
        mergedSettings.tagline = cloudData.settings.tagline;
      if (cloudData.settings.address)
        mergedSettings.address = cloudData.settings.address;
      if (cloudData.settings.phone)
        mergedSettings.phone = cloudData.settings.phone;
      if (cloudData.settings.email)
        mergedSettings.email = cloudData.settings.email;
      if (cloudData.settings.currency_symbol)
        mergedSettings.currencySymbol = cloudData.settings.currency_symbol;
      if (cloudData.settings.currency_code)
        mergedSettings.currencyCode = cloudData.settings.currency_code;
      if (cloudData.settings.tax_rate_percent !== undefined)
        mergedSettings.taxRatePercent = cloudData.settings.tax_rate_percent;
      if (cloudData.settings.enable_tax !== undefined)
        mergedSettings.enableTax = !!cloudData.settings.enable_tax;
      if (cloudData.settings.enable_sales_assistant !== undefined)
        mergedSettings.enableSalesAssistant = !!cloudData.settings.enable_sales_assistant;
      if (cloudData.settings.receipt_header_note)
        mergedSettings.receiptHeaderNote =
          cloudData.settings.receipt_header_note;
      if (cloudData.settings.receipt_footer_note)
        mergedSettings.receiptFooterNote =
          cloudData.settings.receipt_footer_note;

      db.saveSettings(mergedSettings);
    }

    // Apply stock transfers
    if (Array.isArray(cloudData.stockTransfers) && cloudData.stockTransfers.length > 0) {
      const queue = db.getSyncQueue();
      const pendingDeleteIds = new Set(
        queue
          .filter(q => q.status === 'PENDING' && (q.operation || q.action) === 'DELETE_STOCK_TRANSFER')
          .map(q => q.entityId)
      );
      const pendingUpsertIds = new Set(
        queue
          .filter(q => q.status === 'PENDING' && (q.operation || q.action) === 'UPSERT_STOCK_TRANSFER')
          .map(q => q.entityId)
      );

      const localTransfers = db.getStockTransfers().filter(t => !pendingDeleteIds.has(t.id));
      const mergedTransfers = [...localTransfers];

      cloudData.stockTransfers.forEach((ct: any) => {
        if (!ct?.id || pendingDeleteIds.has(ct.id)) return;
        const idx = mergedTransfers.findIndex(t => t.id === ct.id);
        if (idx !== -1 && pendingUpsertIds.has(ct.id)) return;

        let parsedItems: any[] = [];
        try {
          parsedItems =
            typeof ct.items_json === 'string'
              ? JSON.parse(ct.items_json)
              : Array.isArray(ct.items)
                ? ct.items
                : [];
        } catch {
          parsedItems = [];
        }

        const record = {
          id: ct.id,
          transferNumber: ct.transfer_number || ct.transferNumber || `TRF-${String(ct.id).slice(0, 6).toUpperCase()}`,
          transferDate: ct.transfer_date || ct.transferDate || (ct.created_at || ct.createdAt || new Date().toISOString()).slice(0, 10),
          sourceType: (ct.source_type || ct.sourceType || 'STORE') as 'STORE' | 'SHOP',
          sourceId: ct.source_id || ct.sourceId || '',
          sourceName: ct.source_name || ct.sourceName || 'Source',
          sourceLocation: ct.source_location || ct.sourceLocation || undefined,
          sourceShopId: ct.source_shop_id || ct.sourceShopId || '',
          sourceShopName: ct.source_shop_name || ct.sourceShopName || undefined,
          destType: (ct.dest_type || ct.destType || 'SHOP') as 'STORE' | 'SHOP',
          destId: ct.dest_id || ct.destId || '',
          destName: ct.dest_name || ct.destName || 'Destination',
          destLocation: ct.dest_location || ct.destLocation || undefined,
          destShopId: ct.dest_shop_id || ct.destShopId || '',
          destShopName: ct.dest_shop_name || ct.destShopName || undefined,
          status: (ct.status === 'NOT_COMPLETED' ? 'NOT_COMPLETED' : 'COMPLETED') as 'COMPLETED' | 'NOT_COMPLETED',
          shippingCharges: Number(ct.shipping_charges ?? ct.shippingCharges ?? 0),
          notice: ct.notice || undefined,
          items: parsedItems,
          totalUnits: Number(ct.total_units ?? ct.totalUnits ?? 0),
          totalAmount: Number(ct.total_amount ?? ct.totalAmount ?? 0),
          createdByUserId: ct.created_by_user_id || ct.createdByUserId || '',
          createdByName: ct.created_by_name || ct.createdByName || 'System',
          createdAt: ct.created_at || ct.createdAt || new Date().toISOString(),
          updatedAt: ct.updated_at || ct.updatedAt || new Date().toISOString(),
        };

        if (idx === -1) {
          mergedTransfers.push(record);
        } else {
          mergedTransfers[idx] = { ...mergedTransfers[idx], ...record };
        }
      });

      db.saveStockTransfers(
        mergedTransfers.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      );
    }

    // Reconstruct per-store stock breakdown from movements/purchases when missing after cloud pull
    this.reconcileStoreStocksFromMovements();
  }

  public static reconcileStoreStocksFromMovements(): void {
    const stores = db.getStores();
    const products = db.getProducts();
    if (stores.length === 0 || products.length === 0) return;

    const validStoreIdSet = new Set(stores.map(s => s.id));
    const warehouseStoresByShop = new Map<string, any[]>();
    for (const st of stores) {
      if (!st.isShopFloor) {
        const list = warehouseStoresByShop.get(st.shopId) || [];
        list.push(st);
        warehouseStoresByShop.set(st.shopId, list);
      }
    }

    const movements = db.getMovements();
    const purchases = db.getPurchases();
    const mvByProduct = new Map<string, Map<string, number>>();
    for (const m of movements) {
      if (!m.storeId || !validStoreIdSet.has(m.storeId)) continue;
      let storeMap = mvByProduct.get(m.productId);
      if (!storeMap) {
        storeMap = new Map<string, number>();
        mvByProduct.set(m.productId, storeMap);
      }
      storeMap.set(m.storeId, (storeMap.get(m.storeId) || 0) + Number(m.changeQty || 0));
    }
    for (const pur of purchases) {
      if (!pur.storeId || !validStoreIdSet.has(pur.storeId)) continue;
      for (const item of pur.items || []) {
        let storeMap = mvByProduct.get(item.productId);
        if (!storeMap) {
          storeMap = new Map<string, number>();
          mvByProduct.set(item.productId, storeMap);
        }
        if (!storeMap.has(pur.storeId)) {
          storeMap.set(pur.storeId, Number(item.quantity || 0));
        }
      }
    }

    let changed = false;
    const updatedProducts = products.map(p => {
      const storeStockTotal = Number(p.storeStock || 0);
      const validExistingEntries = p.storeStocks
        ? Object.entries(p.storeStocks).filter(([sid]) => validStoreIdSet.has(sid))
        : [];
      const mappedWarehouseSum = validExistingEntries.reduce((sum, [sid, q]) => {
        const st = stores.find(s => s.id === sid);
        return st?.isShopFloor ? sum : sum + Math.max(0, Number(q || 0));
      }, 0);

      if (validExistingEntries.length > 0 && (storeStockTotal === 0 || mappedWarehouseSum > 0)) {
        return p;
      }
      if (storeStockTotal <= 0) return p;

      const shopWarehouses = (warehouseStoresByShop.get(p.shopId) || []).filter(
        s => s.status === 'ACTIVE'
      );
      const fallbackWarehouses =
        shopWarehouses.length > 0 ? shopWarehouses : warehouseStoresByShop.get(p.shopId) || [];
      if (fallbackWarehouses.length === 0) return p;

      const nextStoreStocks: Record<string, number> = { ...(p.storeStocks || {}) };

      if (p.storeId && fallbackWarehouses.some(w => w.id === p.storeId)) {
        nextStoreStocks[p.storeId] = storeStockTotal;
        changed = true;
        return { ...p, storeStocks: nextStoreStocks };
      }

      const prodMv = mvByProduct.get(p.id);
      if (prodMv && prodMv.size > 0) {
        const positiveEntries = Array.from(prodMv.entries()).filter(
          ([sid, qty]) =>
            qty > 0 && fallbackWarehouses.some(w => w.id === sid)
        );
        if (positiveEntries.length > 0) {
          const mvSum = positiveEntries.reduce((s, [, q]) => s + q, 0);
          let assigned = 0;
          positiveEntries.forEach(([sid, q], idx) => {
            const share =
              idx === positiveEntries.length - 1
                ? Math.max(0, storeStockTotal - assigned)
                : Math.round((q / mvSum) * storeStockTotal);
            nextStoreStocks[sid] = share;
            assigned += share;
          });
          changed = true;
          return { ...p, storeStocks: nextStoreStocks };
        }
      }

      if (fallbackWarehouses.length === 1) {
        nextStoreStocks[fallbackWarehouses[0].id] = storeStockTotal;
        changed = true;
        return { ...p, storeStocks: nextStoreStocks };
      }

      return p;
    });

    if (changed) {
      db.saveProducts(updatedProducts);
    }
  }
}
