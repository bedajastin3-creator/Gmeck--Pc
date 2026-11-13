// src/services/syncService.ts (COMPLETE WITH SALE EDIT REQUESTS PULL)
import { db } from '../db/storage';
import { SyncQueueItem, User } from '../types';
import { CloudflareApi } from './cloudflareApi';

export type SyncState = 'OFFLINE_LOCAL' | 'PENDING_SYNC' | 'SYNCING' | 'SYNCED';

export class SyncService {
  private static isSimulatingSync = false;
  private static isSyncing = false;
  private static lastSyncedAt: string | null = localStorage.getItem('omnibiz_last_synced_at');
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

  public static getSyncStats(): { total: number; pending: number; synced: number; failed: number } {
    const queue = db.getSyncQueue();
    return {
      total: queue.length,
      pending: queue.filter(q => q.status === 'PENDING').length,
      synced: queue.filter(q => q.status === 'SYNCED').length,
      failed: queue.filter(q => q.status === 'FAILED').length,
    };
  }

  public static getSyncStatus(): { state: SyncState; pendingCount: number; lastSyncedAt?: string } {
    const queue = db.getSyncQueue();
    const pending = queue.filter(q => q.status === 'PENDING').length;

    if (SyncService.isSyncing) {
      return { state: 'SYNCING', pendingCount: pending, lastSyncedAt: this.lastSyncedAt || undefined };
    }

    if (pending > 0) {
      return { state: 'PENDING_SYNC', pendingCount: pending, lastSyncedAt: this.lastSyncedAt || undefined };
    }

    return {
      state: this.lastSyncedAt ? 'SYNCED' : 'OFFLINE_LOCAL',
      pendingCount: 0,
      lastSyncedAt: this.lastSyncedAt || undefined,
    };
  }

  public static async processSyncQueue(currentUser?: User): Promise<{ success: boolean; processedCount: number; message?: string }> {
    if (!this.shouldSync() && !this.isSyncing) {
      return { success: true, processedCount: 0, message: 'Sync skipped - no pending changes' };
    }

    const online = await CloudflareApi.checkConnection();

    if (!online) {
      return { success: false, processedCount: 0, message: 'Offline mode: Working locally. Will sync when online.' };
    }

    if (SyncService.isSyncing) {
      return { success: false, processedCount: 0, message: 'Sync already in progress' };
    }

    SyncService.isSyncing = true;
    this.lastSyncAttempt = Date.now();

    try {
      const queue = db.getSyncQueue();
      const pendingItems = queue.filter(item => item.status === 'PENDING');

      if (pendingItems.length > 0) {
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

          this.lastSyncedAt = new Date().toISOString();
          localStorage.setItem('omnibiz_last_synced_at', this.lastSyncedAt);
        }
      }

      if (pendingItems.length > 0 || this.hasLocalChanges) {
        const pullResult = await CloudflareApi.pullSync(this.lastSyncedAt || undefined);

        if (pullResult.success && pullResult.data) {
          this.applyCloudData(pullResult.data);
          this.lastSyncedAt = new Date().toISOString();
          localStorage.setItem('omnibiz_last_synced_at', this.lastSyncedAt);
        }
      }

      this.hasLocalChanges = false;
      SyncService.isSyncing = false;

      return {
        success: true,
        processedCount: pendingItems.length,
        message: `Cloud sync complete: ${pendingItems.length} pushed, cloud data pulled.`,
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

  public static async simulateServerSync(): Promise<{ success: boolean; syncedCount: number }> {
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

  // ==========================================
  // APPLY CLOUD DATA TO LOCAL DATABASE
  // ==========================================
  public static applyCloudData(cloudData: any): void {
    if (!cloudData) return;

    // Apply shops
    if (cloudData.shops && cloudData.shops.length > 0) {
      const localShops = db.getShops();
      const merged = [...localShops];

      cloudData.shops.forEach((cloudShop: any) => {
        const index = merged.findIndex(s => s.id === cloudShop.id);
        const shopData = {
          id: cloudShop.id,
          name: cloudShop.name,
          code: cloudShop.code,
          description: cloudShop.description,
          address: cloudShop.address,
          phone: cloudShop.phone,
          status: cloudShop.status,
          color: cloudShop.color,
          createdAt: cloudShop.created_at,
          updatedAt: cloudShop.updated_at,
        };

        if (index === -1) {
          merged.push(shopData);
        } else {
          merged[index] = { ...merged[index], ...shopData };
        }
      });

      db.saveShops(merged);
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
            parsedPermissions = typeof cloudUser.permissions === 'string'
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
            parsedShopIds = typeof cloudUser.assigned_shop_ids === 'string'
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

        const productData = {
          id: cloudProduct.id,
          shopId: cloudProduct.shop_id,
          name: cloudProduct.name,
          sku: cloudProduct.sku,
          barcode: cloudProduct.barcode || '',
          categoryId: cloudProduct.category_id,
          sellingPrice: cloudProduct.selling_price,
          proposedSellingPrice: cloudProduct.proposed_selling_price,
          purchasePrice: cloudProduct.purchase_price,
          currentStock: cloudProduct.current_stock,
          minStock: cloudProduct.min_stock,
          unit: cloudProduct.unit,
          status: cloudProduct.status,
          imageUrl: cloudProduct.image_url,
          images: productImages.length > 0 ? productImages : undefined,
          createdAt: cloudProduct.created_at,
          updatedAt: cloudProduct.updated_at,
        };

        if (index === -1) {
          mergedProducts.push(productData);
        } else {
          mergedProducts[index] = { ...mergedProducts[index], ...productData };
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
            // 🆕 Reference price snapshot from cloud (nullable for legacy rows)
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
      const localPurchases = db.getPurchases();
      const mergedPurchases = [...localPurchases];

      cloudData.purchases.forEach((cloudPurchase: any) => {
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
          supplierName: cloudPurchase.supplier_name,
          date: cloudPurchase.date,
          totalAmount: cloudPurchase.total_amount,
          paymentStatus: cloudPurchase.payment_status,
          notes: cloudPurchase.notes,
          invoiceNumber: cloudPurchase.invoice_number,
          createdByUserId: cloudPurchase.created_by_user_id,
          createdByName: cloudPurchase.created_by_name,
          createdAt: cloudPurchase.created_at,
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

    // FIX: Apply sale edit requests
    if (cloudData.saleEditRequests && cloudData.saleEditRequests.length > 0) {
      const localRequests = db.getSaleEditRequests();
      const mergedRequests = [...localRequests];

      cloudData.saleEditRequests.forEach((cloudRequest: any) => {
        const index = mergedRequests.findIndex(r => r.id === cloudRequest.id);

        let parsedOriginalValues = {};
        let parsedNewValues = {};

        try {
          parsedOriginalValues = typeof cloudRequest.original_values === 'string'
            ? JSON.parse(cloudRequest.original_values)
            : cloudRequest.original_values;
        } catch (e) {
          console.warn('Failed to parse original_values:', e);
        }

        try {
          parsedNewValues = typeof cloudRequest.new_values === 'string'
            ? JSON.parse(cloudRequest.new_values)
            : cloudRequest.new_values;
        } catch (e) {
          console.warn('Failed to parse new_values:', e);
        }

        const requestData = {
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

      if (cloudData.settings.business_name) mergedSettings.businessName = cloudData.settings.business_name;
      if (cloudData.settings.tagline) mergedSettings.tagline = cloudData.settings.tagline;
      if (cloudData.settings.address) mergedSettings.address = cloudData.settings.address;
      if (cloudData.settings.phone) mergedSettings.phone = cloudData.settings.phone;
      if (cloudData.settings.email) mergedSettings.email = cloudData.settings.email;
      if (cloudData.settings.currency_symbol) mergedSettings.currencySymbol = cloudData.settings.currency_symbol;
      if (cloudData.settings.currency_code) mergedSettings.currencyCode = cloudData.settings.currency_code;
      if (cloudData.settings.tax_rate_percent !== undefined) mergedSettings.taxRatePercent = cloudData.settings.tax_rate_percent;
      if (cloudData.settings.enable_tax !== undefined) mergedSettings.enableTax = !!cloudData.settings.enable_tax;
      if (cloudData.settings.receipt_header_note) mergedSettings.receiptHeaderNote = cloudData.settings.receipt_header_note;
      if (cloudData.settings.receipt_footer_note) mergedSettings.receiptFooterNote = cloudData.settings.receipt_footer_note;

      db.saveSettings(mergedSettings);
    }
  }
}
