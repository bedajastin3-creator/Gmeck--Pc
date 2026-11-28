// src/services/syncService.ts
import { db } from '../db/storage';
import { SaleEditRequest, SyncQueueItem, User } from '../types';
import { generateUUID } from '../utils/crypto';
import { CloudflareApi } from './cloudflareApi';

export type SyncState = 'OFFLINE_LOCAL' | 'PENDING_SYNC' | 'SYNCING' | 'SYNCED';

export interface CloudOperation {
  id?: string;
  operation: string;
  entityType: string;
  entityId: string;
  payload: any;
}

const OP_ORDER: Record<string, number> = {
  // Tier 1 — roots
  CREATE_SHOP: 1,
  UPDATE_SHOP: 1,
  TOGGLE_SHOP_STATUS: 1,
  UPDATE_SETTINGS: 1,

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
  UPDATE_EXPENSE: 5,
  DELETE_EXPENSE: 5,
  CREATE_DEBT: 5,
  UPDATE_DEBT: 5,
  DELETE_DEBT: 5,
  CREATE_CUSTOMER_RECORD: 5,
  DELETE_CUSTOMER_RECORD: 5,

  // Cleanup
  DELETE_PURCHASE: 90,
  DELETE_SHOP: 90,
  DELETE_STORE: 90,
  DELETE_STOCK_TRANSFER: 90,
  DELETE_PRODUCT_DEEP: 90,
};

export class SyncService {
  private static isSyncing = false;
  private static lastSyncedAt: string | null = null;

  public static markLocalChanged(): void {
    // No-op in online-only mode (changes commit immediately to cloud)
  }

  public static shouldSync(): boolean {
    return false;
  }

  public static getQueueItems(): SyncQueueItem[] {
    return [];
  }

  public static getPendingCount(): number {
    return 0;
  }

  public static getSyncStats(): {
    total: number;
    pending: number;
    synced: number;
    failed: number;
  } {
    return {
      total: 0,
      pending: 0,
      synced: 0,
      failed: 0,
    };
  }

  public static getSyncStatus(): {
    state: SyncState;
    pendingCount: number;
    lastSyncedAt?: string;
  } {
    if (SyncService.isSyncing) {
      return {
        state: 'SYNCING',
        pendingCount: 0,
        lastSyncedAt: this.lastSyncedAt || undefined,
      };
    }

    if (!CloudflareApi.isOnline() || !db.isCloudLoaded()) {
      return {
        state: 'OFFLINE_LOCAL',
        pendingCount: 0,
        lastSyncedAt: this.lastSyncedAt || undefined,
      };
    }

    return {
      state: 'SYNCED',
      pendingCount: 0,
      lastSyncedAt: this.lastSyncedAt || undefined,
    };
  }

  /**
   * Immediately commit one or more operations directly to Cloudflare D1.
   * Online-only: fails cleanly if offline or if the backend rejects the operation,
   * without writing anything to a local queue.
   */
  public static async commitOperations(
    operations: CloudOperation[],
    options?: { batchSize?: number }
  ): Promise<{
    success: boolean;
    processedCount: number;
    error?: string;
    results?: any[];
  }> {
    if (!operations || operations.length === 0) {
      return { success: true, processedCount: 0, results: [] };
    }

    if (!CloudflareApi.isOnline()) {
      return {
        success: false,
        processedCount: 0,
        error: CloudflareApi.OFFLINE_ERROR_MESSAGE,
      };
    }

    const sorted = [...operations].sort((a, b) => {
      const tierDiff = (OP_ORDER[a.operation] ?? 99) - (OP_ORDER[b.operation] ?? 99);
      return tierDiff;
    });

    const BATCH_SIZE = options?.batchSize || 50;
    const allResults: any[] = [];

    try {
      for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
        const batch = sorted.slice(i, i + BATCH_SIZE).map(op => ({
          id: op.id || generateUUID(),
          operation: op.operation,
          entityType: op.entityType,
          entityId: op.entityId,
          payload: op.payload,
        }));

        const pushResult = await CloudflareApi.pushSync(batch);
        const pushResults = pushResult.results || [];
        const pushErrors = pushResult.errors || [];
        allResults.push(...pushResults);

        if (!pushResult.success || pushErrors.length > 0) {
          const firstError =
            pushErrors[0]?.error || pushResult.error || 'Cloud database rejected operation.';
          return {
            success: false,
            processedCount: allResults.length,
            error: firstError,
            results: allResults,
          };
        }
      }

      this.lastSyncedAt = new Date().toISOString();
      return {
        success: true,
        processedCount: allResults.length,
        results: allResults,
      };
    } catch (err: any) {
      return {
        success: false,
        processedCount: allResults.length,
        error: CloudflareApi.formatError(err, 'Failed to save to cloud database.'),
      };
    }
  }

  public static async commitOperation(
    operation: CloudOperation
  ): Promise<{ success: boolean; error?: string }> {
    const res = await this.commitOperations([operation]);
    return { success: res.success, error: res.error };
  }

  /**
   * Pull fresh state directly from the Cloudflare D1 database.
   */
  public static async processSyncQueue(
    _currentUser?: User,
    _force: boolean = true
  ): Promise<{ success: boolean; processedCount: number; message?: string }> {
    if (!CloudflareApi.isOnline()) {
      return {
        success: false,
        processedCount: 0,
        message: CloudflareApi.OFFLINE_ERROR_MESSAGE,
      };
    }

    if (SyncService.isSyncing) {
      return {
        success: false,
        processedCount: 0,
        message: 'Refresh already in progress',
      };
    }

    SyncService.isSyncing = true;

    try {
      const pullResult = await CloudflareApi.pullSync();

      if (pullResult.success && pullResult.data) {
        this.applyCloudData(pullResult.data, true);
        this.lastSyncedAt = new Date().toISOString();
        SyncService.isSyncing = false;
        return {
          success: true,
          processedCount: 0,
          message: 'Live database refreshed successfully.',
        };
      }

      SyncService.isSyncing = false;
      return {
        success: false,
        processedCount: 0,
        message: pullResult.error || 'Could not load cloud data.',
      };
    } catch (error: any) {
      SyncService.isSyncing = false;
      return {
        success: false,
        processedCount: 0,
        message: CloudflareApi.formatError(error, 'Failed to load cloud data.'),
      };
    }
  }

  public static retryFailed(): void {
    // No local queue in online-only mode
  }

  public static clearFailed(): void {
    // No local queue in online-only mode
  }

  public static clearCompleted(): void {
    // No local queue in online-only mode
  }

  public static applyCloudShops(
    cloudShops: any[],
    options?: { reconcileDeleted?: boolean }
  ): void {
    if (!Array.isArray(cloudShops)) return;

    const merged: any[] = options?.reconcileDeleted ? [] : [...db.getShops()];

    cloudShops.forEach((cloudShop: any) => {
      if (!cloudShop?.id) return;
      const index = merged.findIndex(s => s.id === cloudShop.id);
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
        createdAt:
          cloudShop.created_at ||
          cloudShop.createdAt ||
          existing?.createdAt ||
          new Date().toISOString(),
        updatedAt:
          cloudShop.updated_at ||
          cloudShop.updatedAt ||
          existing?.updatedAt ||
          new Date().toISOString(),
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

    const mergedStores: any[] = options?.reconcileDeleted ? [] : [...db.getStores()];

    cloudStores.forEach((cloudStore: any) => {
      if (!cloudStore?.id) return;
      const index = mergedStores.findIndex(s => s.id === cloudStore.id);
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
  // APPLY CLOUD DATA TO IN-MEMORY DATABASE
  // ==========================================
  public static applyCloudData(cloudData: any, isFullPull: boolean = true): void {
    if (!cloudData) return;

    // Apply shops
    if (Array.isArray(cloudData.shops)) {
      this.applyCloudShops(cloudData.shops, { reconcileDeleted: isFullPull });
    }

    // Apply stores (warehouses)
    if (Array.isArray(cloudData.stores)) {
      this.applyCloudStores(cloudData.stores, { reconcileDeleted: isFullPull });
    }

    // Apply users
    if (Array.isArray(cloudData.users)) {
      const mergedUsers = isFullPull ? [] : [...db.getUsers()];

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
          console.warn('Failed to parse assigned_shop_ids for user:', cloudUser.id, e);
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
    if (Array.isArray(cloudData.categories)) {
      const mergedCats = isFullPull ? [] : [...db.getCategories()];

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
    if (Array.isArray(cloudData.products)) {
      const prevProductsMap = new Map(db.getProducts().map(p => [p.id, p]));
      const mergedProducts = isFullPull ? [] : [...db.getProducts()];

      cloudData.products.forEach((cloudProduct: any) => {
        const index = mergedProducts.findIndex(p => p.id === cloudProduct.id);
        const existingProd =
          index !== -1 ? mergedProducts[index] : prevProductsMap.get(cloudProduct.id);

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
    if (Array.isArray(cloudData.sales)) {
      const mergedSales = isFullPull ? [] : [...db.getSales()];

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
    if (Array.isArray(cloudData.purchases)) {
      const mergedPurchases = isFullPull ? [] : [...db.getPurchases()];

      cloudData.purchases.forEach((cloudPurchase: any) => {
        if (!cloudPurchase?.id) return;
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
          supplierPhone: cloudPurchase.supplier_phone || undefined,
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
    if (Array.isArray(cloudData.purchaseReturns)) {
      const mergedReturns = isFullPull ? [] : [...db.getPurchaseReturns()];

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
    if (Array.isArray(cloudData.expenses)) {
      const mergedExpenses = isFullPull ? [] : [...db.getExpenses()];

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

    // Apply debts & debt payments
    if (Array.isArray(cloudData.debts)) {
      const paymentsByDebt = new Map<string, any[]>();
      if (Array.isArray(cloudData.debtPayments)) {
        cloudData.debtPayments.forEach((p: any) => {
          const dId = p.debt_id || p.debtId;
          if (!dId) return;
          const list = paymentsByDebt.get(dId) || [];
          list.push({
            id: p.id,
            amount: Number(p.amount) || 0,
            date: p.payment_date || p.date || p.created_at,
            recordedBy: p.recorded_by_name || p.recordedBy || 'Staff',
            notes: p.notes || undefined,
          });
          paymentsByDebt.set(dId, list);
        });
      }

      const mergedDebts = isFullPull ? [] : [...db.getDebts()];

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
          payments: paymentsByDebt.get(cloudDebt.id) || [],
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
    if (Array.isArray(cloudData.movements)) {
      const mergedMovements = isFullPull ? [] : [...db.getMovements()];

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
    if (Array.isArray(cloudData.saleEditRequests)) {
      const mergedRequests = isFullPull ? [] : [...db.getSaleEditRequests()];

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
      if (cloudData.settings.enable_customer_details !== undefined)
        mergedSettings.enableCustomerDetails = !!cloudData.settings.enable_customer_details;
      if (cloudData.settings.customer_details_by_shop !== undefined) {
        try {
          const rawMap =
            typeof cloudData.settings.customer_details_by_shop === 'string'
              ? JSON.parse(cloudData.settings.customer_details_by_shop)
              : cloudData.settings.customer_details_by_shop;
          if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
            const cleanMap: Record<string, boolean> = {};
            for (const [k, v] of Object.entries(rawMap)) {
              if (k && typeof v === 'boolean') cleanMap[k] = v;
              else if (k && (v === 1 || v === 0)) cleanMap[k] = v === 1;
            }
            mergedSettings.customerDetailsByShop = cleanMap;
          }
        } catch {
          // keep map if malformed
        }
      }
      if (cloudData.settings.receipt_header_note)
        mergedSettings.receiptHeaderNote = cloudData.settings.receipt_header_note;
      if (cloudData.settings.receipt_footer_note)
        mergedSettings.receiptFooterNote = cloudData.settings.receipt_footer_note;

      db.saveSettings(mergedSettings);
    }

    // Apply customer records
    if (Array.isArray(cloudData.customerRecords)) {
      const mergedMap = isFullPull
        ? new Map<string, any>()
        : new Map(db.getCustomerRecords().map(r => [r.id, r]));

      cloudData.customerRecords.forEach((cr: any) => {
        if (!cr?.id) return;
        let parsedUrls: string[] = [];
        try {
          parsedUrls =
            typeof cr.image_urls === 'string'
              ? JSON.parse(cr.image_urls)
              : Array.isArray(cr.image_urls)
                ? cr.image_urls
                : Array.isArray(cr.imageUrls)
                  ? cr.imageUrls
                  : [];
        } catch {
          parsedUrls = [];
        }

        let parsedItems: any[] = [];
        try {
          parsedItems =
            typeof cr.items_json === 'string'
              ? JSON.parse(cr.items_json)
              : Array.isArray(cr.items)
                ? cr.items
                : [];
        } catch {
          parsedItems = [];
        }

        mergedMap.set(cr.id, {
          id: cr.id,
          customerName: cr.customer_name || cr.customerName || '',
          phoneNumber: cr.phone_number || cr.phoneNumber || '',
          imageUrls: parsedUrls.filter((u): u is string => typeof u === 'string').slice(0, 24),
          saleId: cr.sale_id || cr.saleId || undefined,
          receiptNumber: cr.receipt_number || cr.receiptNumber || undefined,
          shopId: cr.shop_id || cr.shopId || undefined,
          shopName: cr.shop_name || cr.shopName || undefined,
          saleDate: cr.sale_date || cr.saleDate || cr.created_at || cr.createdAt || undefined,
          items: Array.isArray(parsedItems) ? parsedItems : [],
          createdAt: cr.created_at || cr.createdAt || new Date().toISOString(),
          updatedAt: cr.updated_at || cr.updatedAt || new Date().toISOString(),
        });
      });

      const mergedList = Array.from(mergedMap.values()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );
      db.saveCustomerRecords(mergedList);
    }

    // Apply stock transfers
    if (Array.isArray(cloudData.stockTransfers)) {
      const mergedTransfers = isFullPull ? [] : [...db.getStockTransfers()];

      cloudData.stockTransfers.forEach((ct: any) => {
        if (!ct?.id) return;
        const idx = mergedTransfers.findIndex(t => t.id === ct.id);

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
          transferNumber:
            ct.transfer_number ||
            ct.transferNumber ||
            `TRF-${String(ct.id).slice(0, 6).toUpperCase()}`,
          transferDate:
            ct.transfer_date ||
            ct.transferDate ||
            (ct.created_at || ct.createdAt || new Date().toISOString()).slice(0, 10),
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
          status: (ct.status === 'NOT_COMPLETED' ? 'NOT_COMPLETED' : 'COMPLETED') as
            | 'COMPLETED'
            | 'NOT_COMPLETED',
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
    db.setCloudLoaded(true);
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
          ([sid, qty]) => qty > 0 && fallbackWarehouses.some(w => w.id === sid)
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
