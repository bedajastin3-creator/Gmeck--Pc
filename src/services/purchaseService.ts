import { db } from '../db/storage';
import {
  InventoryMovement,
  PaymentStatus,
  Product,
  ProductStoreStockDetail,
  Purchase,
  PurchaseItem,
  PurchaseReturn,
  PurchaseReturnItem,
  Store,
  User,
} from '../types';
import { generateUUID } from '../utils/crypto';
import { generatePurchaseNumber } from '../utils/formatters';
import { getAdminManagedShops, hasAdminAccess, isPlatformAdmin } from '../utils/permissions';
import { NotificationService } from './notificationService';
import { CloudflareApi } from './cloudflareApi';
import { SyncService } from './syncService';

export interface PurchaseItemInput {
  productId: string;
  quantity: number;
  unitCost: number;
  sellingPrice?: number;
}

function generateReturnNumber(): string {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RET-${ymd}-${rand}`;
}

function hydrateProductStoreStocks(
  product: Product,
  shopStores: Store[]
): Record<string, number> {
  const nextStocks: Record<string, number> = { ...(product.storeStocks || {}) };
  const warehouses = shopStores.filter(s => !s.isShopFloor);
  const warehouseIds = new Set(warehouses.map(s => s.id));
  const mappedWarehouseSum = Object.entries(nextStocks)
    .filter(([sid]) => warehouseIds.has(sid))
    .reduce((sum, [, q]) => sum + Math.max(0, Number(q || 0)), 0);

  const rawStoreStock = Math.max(0, Number(product.storeStock || 0));
  if (mappedWarehouseSum === 0 && rawStoreStock > 0 && warehouses.length > 0) {
    const fallbackStoreId =
      product.storeId && warehouseIds.has(product.storeId)
        ? product.storeId
        : warehouses[0].id;
    nextStocks[fallbackStoreId] = rawStoreStock;
  }
  return nextStocks;
}

function recalculateStoreStockSummary(
  storeStocks: Record<string, number>,
  shopStores: Store[]
): { total: number; primaryStoreId?: string } {
  const warehouseSet = new Set(shopStores.filter(s => !s.isShopFloor).map(s => s.id));
  let total = 0;
  let primaryStoreId: string | undefined;
  let maxQty = -1;

  for (const [sid, rawQty] of Object.entries(storeStocks)) {
    if (!warehouseSet.has(sid)) continue;
    const qty = Math.max(0, Number(rawQty || 0));
    total += qty;
    if (qty > maxQty) {
      maxQty = qty;
      primaryStoreId = sid;
    }
  }
  return { total, primaryStoreId };
}

function buildStoreDetail(
  store: Store,
  qty: number,
  buyPrice: number,
  sellPrice: number,
  prev?: ProductStoreStockDetail
): ProductStoreStockDetail {
  return {
    ...(prev || {
      storeId: store.id,
      storeName: store.name,
      quantity: qty,
    }),
    storeId: store.id,
    storeName: store.name,
    quantity: qty,
    unitPurchasePrice: buyPrice,
    unitSellingPrice: sellPrice,
    importedPurchaseValue: qty * buyPrice,
    importedSaleValue: qty * sellPrice,
    importedPotentialProfit: qty * (sellPrice - buyPrice),
  };
}

function adjustProductDestinationStock(
  product: Product,
  deltaQty: number,
  targetStore: Store | undefined,
  shopStores: Store[],
  options?: {
    newPurchasePrice?: number;
    newSellingPrice?: number;
    now?: string;
  }
): {
  updatedProduct: Product;
  previousQty: number;
  newQty: number;
} {
  const now = options?.now || new Date().toISOString();
  const buyPrice =
    options?.newPurchasePrice !== undefined
      ? Number(options.newPurchasePrice.toFixed(2))
      : product.purchasePrice || 0;
  const sellPrice =
    options?.newSellingPrice !== undefined && options.newSellingPrice >= 0
      ? Number(options.newSellingPrice.toFixed(2))
      : product.sellingPrice || 0;

  if (targetStore && !targetStore.isShopFloor) {
    const storeStocks = hydrateProductStoreStocks(product, shopStores);
    const prevQty = Math.max(0, Number(storeStocks[targetStore.id] || 0));
    const nextQty = Math.max(0, Number((prevQty + deltaQty).toFixed(4)));
    storeStocks[targetStore.id] = nextQty;

    const { total, primaryStoreId } = recalculateStoreStockSummary(storeStocks, shopStores);
    const storeDetails: Record<string, ProductStoreStockDetail> = {
      ...(product.storeDetails || {}),
      [targetStore.id]: buildStoreDetail(
        targetStore,
        nextQty,
        buyPrice,
        sellPrice,
        product.storeDetails?.[targetStore.id]
      ),
    };

    const updatedProduct: Product = {
      ...product,
      storeId: product.storeId || primaryStoreId || targetStore.id,
      storeStock: total,
      storeStocks,
      storeDetails,
      purchasePrice: buyPrice,
      sellingPrice: sellPrice,
      updatedAt: now,
    };
    return { updatedProduct, previousQty: prevQty, newQty: nextQty };
  }

  const prevQty = Math.max(0, Number(product.currentStock || 0));
  const nextQty = Math.max(0, Number((prevQty + deltaQty).toFixed(4)));
  const updatedProduct: Product = {
    ...product,
    currentStock: nextQty,
    purchasePrice: buyPrice,
    sellingPrice: sellPrice,
    updatedAt: now,
  };
  return { updatedProduct, previousQty: prevQty, newQty: nextQty };
}

function canUserModifyPurchase(currentUser: User, purchase: Purchase): boolean {
  if (isPlatformAdmin(currentUser)) return true;
  if (hasAdminAccess(currentUser)) {
    const managedIds = getAdminManagedShops(currentUser, db.getShops()).map(s => s.id);
    if (managedIds.length === 0 || managedIds.includes(purchase.shopId)) {
      return true;
    }
  }
  if (purchase.createdByUserId === currentUser.id) return true;
  const assigned = currentUser.assignedShopIds || [];
  if (assigned.length > 0 && assigned.includes(purchase.shopId)) return true;
  return false;
}

export class PurchaseService {
  /**
   * Record a new purchase order / stock-in for a specific shop or store warehouse.
   * Uses LATEST PURCHASE PRICE for inventory valuation and optionally updates selling price.
   */
  public static async recordPurchase(
    params: {
      shopId?: string;
      storeId?: string;
      supplierName: string;
      supplierPhone?: string;
      date?: string;
      items: PurchaseItemInput[];
      paymentStatus: PaymentStatus;
      notes?: string;
      invoiceNumber?: string;
    },
    currentUser: User
  ): Promise<{ success: boolean; purchase?: Purchase; error?: string }> {
    const targetShopId = params.shopId || db.getShops()[0]?.id || 'shop-1';

    if (!isPlatformAdmin(currentUser)) {
      const managedIds = getAdminManagedShops(currentUser, db.getShops()).map(s => s.id);
      const assigned = currentUser.assignedShopIds || [];
      const allowedIds = Array.from(new Set([...managedIds, ...assigned]));
      if (allowedIds.length > 0 && !allowedIds.includes(targetShopId)) {
        return {
          success: false,
          error: 'Permission Denied: You are not assigned to record purchases for this shop.',
        };
      }
    }

    const shop = db.getShops().find(s => s.id === targetShopId);
    if (!shop) {
      return { success: false, error: 'Selected shop does not exist.' };
    }

    const allStores = db.getStores();
    const shopStores = allStores.filter(s => s.shopId === targetShopId);
    const targetStore = params.storeId
      ? shopStores.find(s => s.id === params.storeId)
      : undefined;

    if (params.storeId && !targetStore) {
      return {
        success: false,
        error: 'Selected destination store does not belong to this shop.',
      };
    }

    if (!params.items || params.items.length === 0) {
      return { success: false, error: 'Please add at least one product item.' };
    }

    const now = new Date().toISOString();
    const products = [...db.getProducts()];
    const movementsToAdd: InventoryMovement[] = [];
    const purchaseId = generateUUID();
    const purchaseNumber = generatePurchaseNumber();
    const purchaseItems: PurchaseItem[] = [];
    let totalAmount = 0;
    const finalSupplierName = params.supplierName?.trim() || 'Walk-in Supplier';
    const finalSupplierPhone = params.supplierPhone?.trim() || undefined;
    const priceChanges: Array<{ product: Product; oldPrice: number; newPrice: number }> = [];

    for (const itemInput of params.items) {
      const prodIndex = products.findIndex(p => p.id === itemInput.productId);
      if (prodIndex === -1) {
        return { success: false, error: `Product not found (ID: ${itemInput.productId})` };
      }

      const prod = products[prodIndex];
      if (itemInput.quantity <= 0) {
        return {
          success: false,
          error: `Invalid quantity for ${prod.name}. Must be greater than 0.`,
        };
      }
      if (itemInput.unitCost < 0) {
        return {
          success: false,
          error: `Unit cost for ${prod.name} cannot be negative.`,
        };
      }
      if (itemInput.sellingPrice !== undefined && itemInput.sellingPrice < 0) {
        return {
          success: false,
          error: `Selling price for ${prod.name} cannot be negative.`,
        };
      }

      const itemTotal = Number((itemInput.quantity * itemInput.unitCost).toFixed(2));
      totalAmount += itemTotal;

      const resolvedSellPrice =
        itemInput.sellingPrice !== undefined && Number.isFinite(itemInput.sellingPrice)
          ? Number(itemInput.sellingPrice.toFixed(2))
          : prod.sellingPrice;

      purchaseItems.push({
        id: generateUUID(),
        productId: prod.id,
        productName: prod.name,
        quantity: itemInput.quantity,
        unitCost: itemInput.unitCost,
        sellingPrice: resolvedSellPrice,
        total: itemTotal,
      });

      const oldSellingPrice = prod.sellingPrice;
      const { updatedProduct, previousQty, newQty } = adjustProductDestinationStock(
        prod,
        itemInput.quantity,
        targetStore && !targetStore.isShopFloor ? targetStore : undefined,
        shopStores,
        {
          newPurchasePrice: itemInput.unitCost,
          newSellingPrice: resolvedSellPrice,
          now,
        }
      );

      products[prodIndex] = updatedProduct;

      if (
        itemInput.sellingPrice !== undefined &&
        Math.abs(resolvedSellPrice - oldSellingPrice) > 0.001
      ) {
        priceChanges.push({
          product: updatedProduct,
          oldPrice: oldSellingPrice,
          newPrice: resolvedSellPrice,
        });
      }

      const destLabel =
        targetStore && !targetStore.isShopFloor
          ? `Store: ${targetStore.name} (${shop.name})`
          : shop.name;

      movementsToAdd.push({
        id: generateUUID(),
        shopId: targetShopId,
        shopName: shop.name,
        storeId: targetStore && !targetStore.isShopFloor ? targetStore.id : undefined,
        productId: prod.id,
        productName: prod.name,
        previousQty,
        changeQty: itemInput.quantity,
        newQty,
        type: 'PURCHASE',
        reason: `PO ${purchaseNumber} from ${finalSupplierName} [${destLabel}] @ ${itemInput.unitCost}/unit`,
        costValue: itemTotal,
        referenceId: purchaseId,
        userId: currentUser.id,
        userName: currentUser.name,
        createdAt: now,
      });
    }

    const newPurchase: Purchase = {
      id: purchaseId,
      shopId: targetShopId,
      shopName: shop.name,
      storeId: targetStore && !targetStore.isShopFloor ? targetStore.id : undefined,
      storeName: targetStore && !targetStore.isShopFloor ? targetStore.name : undefined,
      purchaseNumber,
      supplierName: finalSupplierName,
      supplierPhone: finalSupplierPhone,
      date: params.date || new Date().toISOString().slice(0, 10),
      items: purchaseItems,
      totalAmount: Number(totalAmount.toFixed(2)),
      paymentStatus: params.paymentStatus,
      notes: params.notes?.trim() || undefined,
      invoiceNumber: params.invoiceNumber?.trim() || undefined,
      createdByUserId: currentUser.id,
      createdByName: currentUser.name,
      createdAt: now,
    };

    const commit = await SyncService.commitOperation({
      operation: 'CREATE_PURCHASE',
      entityType: 'PURCHASE',
      entityId: purchaseId,
      payload: newPurchase,
    });
    if (!commit.success) {
      return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    db.saveProducts(products);
    if (movementsToAdd.length > 0) {
      db.saveMovements([...movementsToAdd, ...db.getMovements()]);
    }

    priceChanges.forEach(({ product, oldPrice, newPrice }) => {
      NotificationService.broadcastPriceChange(product, oldPrice, newPrice);
    });

    db.savePurchases([newPurchase, ...db.getPurchases()]);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'RECORD_PURCHASE',
      details: `Recorded purchase ${purchaseNumber} from ${finalSupplierName} for [${
        targetStore && !targetStore.isShopFloor ? `${targetStore.name} - ${shop.name}` : shop.name
      }]`,
      entityType: 'PURCHASE',
      entityId: purchaseId,
      shopId: targetShopId,
      timestamp: now,
    });

    return { success: true, purchase: newPurchase };
  }

  public static async createPurchase(
    params: {
      shopId?: string;
      storeId?: string;
      supplierName: string;
      supplierPhone?: string;
      date?: string;
      items: PurchaseItemInput[];
      paymentStatus: PaymentStatus;
      notes?: string;
      invoiceNumber?: string;
    },
    currentUser: User
  ) {
    return this.recordPurchase(params, currentUser);
  }

  /**
   * Update an existing purchase.
   * Can update metadata only OR items (which triggers store/floor stock recalculation).
   */
  public static async updatePurchase(
    purchaseId: string,
    updates: {
      supplierName?: string;
      supplierPhone?: string;
      date?: string;
      invoiceNumber?: string;
      paymentStatus?: PaymentStatus;
      notes?: string;
      items?: PurchaseItemInput[];
    },
    currentUser: User
  ): Promise<{ success: boolean; purchase?: Purchase; error?: string }> {
    const purchases = db.getPurchases();
    const index = purchases.findIndex(p => p.id === purchaseId);
    if (index === -1) {
      return { success: false, error: 'Purchase not found.' };
    }

    const current = purchases[index];
    if (!canUserModifyPurchase(currentUser, current)) {
      return {
        success: false,
        error: 'Permission Denied: You do not have access to update this purchase.',
      };
    }

    const now = new Date().toISOString();
    const cleanPhone =
      updates.supplierPhone !== undefined
        ? updates.supplierPhone.trim() || undefined
        : current.supplierPhone;
    const cleanDate = updates.date?.trim() || current.date;

    if (updates.items && updates.items.length > 0) {
      const products = [...db.getProducts()];
      const allStores = db.getStores();
      const shopStores = allStores.filter(s => s.shopId === current.shopId);
      const targetStore = current.storeId
        ? shopStores.find(s => s.id === current.storeId && !s.isShopFloor)
        : undefined;

      // 1. Reverse OLD purchase quantities from Store or Shop Floor
      for (const oldItem of current.items) {
        const prodIndex = products.findIndex(p => p.id === oldItem.productId);
        if (prodIndex !== -1) {
          const { updatedProduct } = adjustProductDestinationStock(
            products[prodIndex],
            -oldItem.quantity,
            targetStore,
            shopStores,
            { now }
          );
          products[prodIndex] = updatedProduct;
        }
      }

      // 2. Apply NEW quantities with latest buy/sell prices
      const purchaseItems: PurchaseItem[] = [];
      const movementsToAdd: InventoryMovement[] = [];
      const priceChanges: Array<{ product: Product; oldPrice: number; newPrice: number }> = [];
      let totalAmount = 0;

      for (const itemInput of updates.items) {
        const prodIndex = products.findIndex(p => p.id === itemInput.productId);
        if (prodIndex === -1) {
          return { success: false, error: `Product not found (ID: ${itemInput.productId})` };
        }
        if (itemInput.quantity <= 0) {
          return { success: false, error: 'Invalid quantity. Must be greater than 0.' };
        }
        if (itemInput.unitCost < 0) {
          return { success: false, error: 'Unit cost cannot be negative.' };
        }
        if (itemInput.sellingPrice !== undefined && itemInput.sellingPrice < 0) {
          return { success: false, error: 'Selling price cannot be negative.' };
        }

        const prod = products[prodIndex];
        const itemTotal = Number((itemInput.quantity * itemInput.unitCost).toFixed(2));
        totalAmount += itemTotal;

        const resolvedSellPrice =
          itemInput.sellingPrice !== undefined && Number.isFinite(itemInput.sellingPrice)
            ? Number(itemInput.sellingPrice.toFixed(2))
            : prod.sellingPrice;

        purchaseItems.push({
          id: generateUUID(),
          productId: itemInput.productId,
          productName: prod.name,
          quantity: itemInput.quantity,
          unitCost: itemInput.unitCost,
          sellingPrice: resolvedSellPrice,
          total: itemTotal,
        });

        const oldSellingPrice = prod.sellingPrice;
        const { updatedProduct, previousQty, newQty } = adjustProductDestinationStock(
          prod,
          itemInput.quantity,
          targetStore,
          shopStores,
          {
            newPurchasePrice: itemInput.unitCost,
            newSellingPrice: resolvedSellPrice,
            now,
          }
        );

        products[prodIndex] = updatedProduct;

        if (
          itemInput.sellingPrice !== undefined &&
          Math.abs(resolvedSellPrice - oldSellingPrice) > 0.001
        ) {
          priceChanges.push({
            product: updatedProduct,
            oldPrice: oldSellingPrice,
            newPrice: resolvedSellPrice,
          });
        }

        movementsToAdd.push({
          id: generateUUID(),
          shopId: current.shopId,
          shopName: current.shopName,
          storeId: targetStore ? targetStore.id : undefined,
          productId: itemInput.productId,
          productName: prod.name,
          previousQty,
          changeQty: itemInput.quantity,
          newQty,
          type: 'PURCHASE_EDIT',
          reason: `Corrected PO ${current.purchaseNumber} - quantity/price adjusted`,
          costValue: itemTotal,
          referenceId: purchaseId,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: now,
        });
      }

      const updatedPurchase: Purchase = {
        ...current,
        supplierName: updates.supplierName?.trim() || current.supplierName,
        supplierPhone: cleanPhone,
        date: cleanDate,
        invoiceNumber:
          updates.invoiceNumber !== undefined
            ? updates.invoiceNumber.trim() || undefined
            : current.invoiceNumber,
        paymentStatus: updates.paymentStatus || current.paymentStatus,
        notes: updates.notes !== undefined ? updates.notes.trim() || undefined : current.notes,
        items: purchaseItems,
        totalAmount: Number(totalAmount.toFixed(2)),
        updatedAt: now,
      };

      const commit = await SyncService.commitOperation({
        operation: 'UPDATE_PURCHASE',
        entityType: 'PURCHASE',
        entityId: purchaseId,
        payload: updatedPurchase,
      });
      if (!commit.success) {
        return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
      }

      db.saveProducts(products);
      if (movementsToAdd.length > 0) {
        db.saveMovements([...movementsToAdd, ...db.getMovements()]);
      }
      priceChanges.forEach(({ product, oldPrice, newPrice }) => {
        NotificationService.broadcastPriceChange(product, oldPrice, newPrice);
      });

      const nextPurchases = [...purchases];
      nextPurchases[index] = updatedPurchase;
      db.savePurchases(nextPurchases);

      db.addAuditLog({
        id: generateUUID(),
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'UPDATE_PURCHASE_ITEMS',
        details: `Updated purchase items for ${current.purchaseNumber}. Stock recalculated.`,
        entityType: 'PURCHASE',
        entityId: purchaseId,
        shopId: current.shopId,
        timestamp: now,
      });

      return { success: true, purchase: updatedPurchase };
    }

    const updatedPurchase: Purchase = {
      ...current,
      supplierName: updates.supplierName?.trim() || current.supplierName,
      supplierPhone: cleanPhone,
      date: cleanDate,
      invoiceNumber:
        updates.invoiceNumber !== undefined
          ? updates.invoiceNumber.trim() || undefined
          : current.invoiceNumber,
      paymentStatus: updates.paymentStatus || current.paymentStatus,
      notes: updates.notes !== undefined ? updates.notes.trim() || undefined : current.notes,
      updatedAt: now,
    };

    const commit = await SyncService.commitOperation({
      operation: 'UPDATE_PURCHASE',
      entityType: 'PURCHASE',
      entityId: purchaseId,
      payload: updatedPurchase,
    });
    if (!commit.success) {
      return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    const nextPurchases = [...purchases];
    nextPurchases[index] = updatedPurchase;
    db.savePurchases(nextPurchases);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_PURCHASE',
      details: `Updated purchase ${current.purchaseNumber} metadata`,
      entityType: 'PURCHASE',
      entityId: purchaseId,
      shopId: current.shopId,
      timestamp: now,
    });

    return { success: true, purchase: updatedPurchase };
  }

  /**
   * Permanently void & delete a purchase order and automatically revert added stock
   * from Shop Floor or Store warehouse.
   */
  public static async voidPurchase(
    purchaseId: string,
    reason: string,
    currentUser: User
  ): Promise<{ success: boolean; revertedUnits?: number; error?: string }> {
    const purchases = db.getPurchases();
    const current = purchases.find(p => p.id === purchaseId);
    if (!current) {
      return { success: false, error: 'Purchase not found.' };
    }

    if (!canUserModifyPurchase(currentUser, current)) {
      return {
        success: false,
        error: 'Permission Denied: You do not have permission to void this purchase.',
      };
    }

    const cleanReason = reason.trim();
    if (!cleanReason) {
      return { success: false, error: 'A void reason is required.' };
    }

    const now = new Date().toISOString();
    const products = [...db.getProducts()];
    const allStores = db.getStores();
    const shopStores = allStores.filter(s => s.shopId === current.shopId);
    const targetStore = current.storeId
      ? shopStores.find(s => s.id === current.storeId && !s.isShopFloor)
      : undefined;

    const movementsToAdd: InventoryMovement[] = [];
    let revertedUnits = 0;

    for (const item of current.items || []) {
      const qty = Number(item.quantity || 0);
      if (qty <= 0) continue;
      revertedUnits += qty;

      const prodIndex = products.findIndex(p => p.id === item.productId);
      if (prodIndex !== -1) {
        const prod = products[prodIndex];
        const { updatedProduct, previousQty, newQty } = adjustProductDestinationStock(
          prod,
          -qty,
          targetStore,
          shopStores,
          { now }
        );
        products[prodIndex] = updatedProduct;

        movementsToAdd.push({
          id: generateUUID(),
          shopId: current.shopId,
          shopName: current.shopName,
          storeId: targetStore ? targetStore.id : undefined,
          productId: prod.id,
          productName: prod.name,
          previousQty,
          changeQty: -(previousQty - newQty),
          newQty,
          type: 'VOID_RETURN',
          reason: `Voided PO ${current.purchaseNumber} (${cleanReason})`,
          costValue: item.total,
          referenceId: purchaseId,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: now,
        });
      }
    }

    const commit = await SyncService.commitOperation({
      operation: 'DELETE_PURCHASE',
      entityType: 'PURCHASE',
      entityId: purchaseId,
      payload: { id: purchaseId, reason: cleanReason },
    });
    if (!commit.success) {
      return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    db.saveProducts(products);
    if (movementsToAdd.length > 0) {
      db.saveMovements([...movementsToAdd, ...db.getMovements()]);
    }

    const remainingPurchases = purchases.filter(p => p.id !== purchaseId);
    db.savePurchases(remainingPurchases);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'VOID_PURCHASE',
      details: `Voided & deleted PO ${current.purchaseNumber} (${current.supplierName}), reverted ${revertedUnits} unit(s). Reason: ${cleanReason}`,
      entityType: 'PURCHASE',
      entityId: purchaseId,
      shopId: current.shopId,
      timestamp: now,
    });

    return { success: true, revertedUnits: Number(revertedUnits.toFixed(4)) };
  }

  /**
   * Process a partial or full supplier return from an existing purchase.
   * Reduces Floor/Store stock, reduces purchase item quantities and totalAmount,
   * and logs a PurchaseReturn audit record.
   */
  public static async returnPurchaseItems(
    purchaseId: string,
    selections: Array<{ productId: string; itemId: string; returnQty: number }>,
    reason: string,
    currentUser: User
  ): Promise<{ success: boolean; purchaseReturn?: PurchaseReturn; error?: string }> {
    const purchases = db.getPurchases();
    const index = purchases.findIndex(p => p.id === purchaseId);
    if (index === -1) {
      return { success: false, error: 'Purchase not found.' };
    }

    const current = purchases[index];
    if (!canUserModifyPurchase(currentUser, current)) {
      return {
        success: false,
        error: 'Permission Denied: You do not have permission to process returns for this purchase.',
      };
    }

    const cleanReason = reason.trim();
    if (!cleanReason) {
      return { success: false, error: 'Please provide a reason for returning these items.' };
    }

    if (!selections || selections.length === 0) {
      return { success: false, error: 'Select at least one product quantity to return.' };
    }

    const now = new Date().toISOString();
    const products = [...db.getProducts()];
    const allStores = db.getStores();
    const shopStores = allStores.filter(s => s.shopId === current.shopId);
    const targetStore = current.storeId
      ? shopStores.find(s => s.id === current.storeId && !s.isShopFloor)
      : undefined;

    const selectionByItemId = new Map<string, number>();
    for (const sel of selections) {
      if (sel.returnQty <= 0) continue;
      selectionByItemId.set(sel.itemId, sel.returnQty);
    }

    if (selectionByItemId.size === 0) {
      return { success: false, error: 'Return quantity must be greater than 0.' };
    }

    const returnItems: PurchaseReturnItem[] = [];
    const movementsToAdd: InventoryMovement[] = [];
    const updatedPurchaseItems: PurchaseItem[] = [];
    let totalReturnQty = 0;
    let totalReturnAmount = 0;

    for (const item of current.items || []) {
      const returnQty = selectionByItemId.get(item.id) || 0;
      if (returnQty <= 0) {
        updatedPurchaseItems.push(item);
        continue;
      }

      if (returnQty > item.quantity) {
        return {
          success: false,
          error: `Return quantity (${returnQty}) for ${item.productName} exceeds remaining purchased quantity (${item.quantity}).`,
        };
      }

      const remainingQty = Math.max(0, Number((item.quantity - returnQty).toFixed(4)));
      const returnTotal = Number((returnQty * item.unitCost).toFixed(2));
      totalReturnQty += returnQty;
      totalReturnAmount += returnTotal;

      returnItems.push({
        id: generateUUID(),
        productId: item.productId,
        productName: item.productName,
        originalQty: item.quantity,
        returnQty,
        remainingQty,
        unitCost: item.unitCost,
        returnTotal,
      });

      if (remainingQty > 0) {
        updatedPurchaseItems.push({
          ...item,
          quantity: remainingQty,
          total: Number((remainingQty * item.unitCost).toFixed(2)),
        });
      }

      const prodIndex = products.findIndex(p => p.id === item.productId);
      if (prodIndex !== -1) {
        const prod = products[prodIndex];
        const { updatedProduct, previousQty, newQty } = adjustProductDestinationStock(
          prod,
          -returnQty,
          targetStore,
          shopStores,
          { now }
        );
        products[prodIndex] = updatedProduct;

        movementsToAdd.push({
          id: generateUUID(),
          shopId: current.shopId,
          shopName: current.shopName,
          storeId: targetStore ? targetStore.id : undefined,
          productId: prod.id,
          productName: prod.name,
          previousQty,
          changeQty: -(previousQty - newQty),
          newQty,
          type: 'RETURN',
          reason: `Supplier return from PO ${current.purchaseNumber} (${cleanReason})`,
          costValue: returnTotal,
          referenceId: purchaseId,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: now,
        });
      }
    }

    if (returnItems.length === 0) {
      return { success: false, error: 'No matching purchase line items selected to return.' };
    }

    const updatedTotalAmount = Number(
      updatedPurchaseItems.reduce((sum, i) => sum + (Number(i.total) || 0), 0).toFixed(2)
    );

    const updatedPurchase: Purchase = {
      ...current,
      items: updatedPurchaseItems,
      totalAmount: updatedTotalAmount,
      updatedAt: now,
    };

    const resolvedStoreName =
      current.storeName || (targetStore ? targetStore.name : undefined);

    const purchaseReturn: PurchaseReturn = {
      id: generateUUID(),
      returnNumber: generateReturnNumber(),
      purchaseId: current.id,
      purchaseNumber: current.purchaseNumber,
      shopId: current.shopId,
      shopName: current.shopName,
      storeId: current.storeId,
      storeName: resolvedStoreName,
      supplierName: current.supplierName,
      invoiceNumber: current.invoiceNumber,
      items: returnItems,
      totalReturnQty: Number(totalReturnQty.toFixed(4)),
      totalReturnAmount: Number(totalReturnAmount.toFixed(2)),
      reason: cleanReason,
      returnedByUserId: currentUser.id,
      returnedByName: currentUser.name,
      createdAt: now,
    };

    const commit = await SyncService.commitOperations([
      {
        operation: 'CREATE_PURCHASE_RETURN',
        entityType: 'PURCHASE_RETURN',
        entityId: purchaseReturn.id,
        payload: purchaseReturn,
      },
      {
        operation: 'UPDATE_PURCHASE',
        entityType: 'PURCHASE',
        entityId: purchaseId,
        payload: updatedPurchase,
      },
    ]);
    if (!commit.success) {
      return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    const nextPurchases = [...purchases];
    nextPurchases[index] = updatedPurchase;
    db.saveProducts(products);
    if (movementsToAdd.length > 0) {
      db.saveMovements([...movementsToAdd, ...db.getMovements()]);
    }
    db.savePurchases(nextPurchases);
    db.savePurchaseReturns([purchaseReturn, ...db.getPurchaseReturns()]);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'PURCHASE_RETURN',
      details: `Returned ${purchaseReturn.totalReturnQty} unit(s) (${purchaseReturn.returnNumber}) on PO ${current.purchaseNumber}. Deducted ${purchaseReturn.totalReturnAmount}. Reason: ${cleanReason}`,
      entityType: 'PURCHASE',
      entityId: purchaseId,
      shopId: current.shopId,
      timestamp: now,
    });

    return { success: true, purchaseReturn };
  }

  /**
   * Get purchase returns filtered by shop/role and search.
   */
  public static getPurchaseReturns(
    options?: {
      shopId?: string;
      search?: string;
    },
    currentUser?: User
  ): PurchaseReturn[] {
    let returns = db.getPurchaseReturns();

    if (currentUser && !isPlatformAdmin(currentUser)) {
      const managedIds = getAdminManagedShops(currentUser, db.getShops()).map(s => s.id);
      const assigned = currentUser.assignedShopIds || [];
      const allowedIds = Array.from(new Set([...managedIds, ...assigned]));
      if (allowedIds.length > 0) {
        const set = new Set(allowedIds);
        returns = returns.filter(r => set.has(r.shopId));
      }
    }

    if (options?.shopId && options.shopId !== 'ALL') {
      returns = returns.filter(r => r.shopId === options.shopId);
    }

    if (options?.search?.trim()) {
      const tokens = options.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
      returns = returns.filter(ret => {
        const itemsText = (ret.items || []).map(i => i.productName).join(' ');
        const hay = [
          ret.returnNumber,
          ret.purchaseNumber,
          ret.supplierName,
          ret.invoiceNumber || '',
          ret.shopName || '',
          ret.storeName || '',
          ret.reason,
          ret.returnedByName,
          itemsText,
        ]
          .join(' ')
          .toLowerCase();
        return tokens.every(tok => hay.includes(tok));
      });
    }

    return returns;
  }

  /**
   * Get purchases filtered by shop, supplier, date, and user access.
   */
  public static getPurchases(
    options?: {
      shopId?: string;
      supplierName?: string;
      search?: string;
      paymentStatus?: PaymentStatus | 'ALL';
      startDate?: string;
      endDate?: string;
    },
    currentUser?: User
  ): Purchase[] {
    let purchases = db.getPurchases();

    if (currentUser && !isPlatformAdmin(currentUser)) {
      const managedIds = getAdminManagedShops(currentUser, db.getShops()).map(s => s.id);
      const assigned = currentUser.assignedShopIds || [];
      const allowedIds = Array.from(new Set([...managedIds, ...assigned]));
      if (allowedIds.length > 0) {
        const set = new Set(allowedIds);
        purchases = purchases.filter(p => set.has(p.shopId));
      }
    }

    if (options?.shopId && options.shopId !== 'ALL') {
      purchases = purchases.filter(p => p.shopId === options.shopId);
    }

    if (options?.search?.trim()) {
      const q = options.search.trim().toLowerCase();
      purchases = purchases.filter(
        p =>
          p.supplierName.toLowerCase().includes(q) ||
          (p.supplierPhone && p.supplierPhone.toLowerCase().includes(q)) ||
          p.purchaseNumber.toLowerCase().includes(q) ||
          (p.invoiceNumber && p.invoiceNumber.toLowerCase().includes(q)) ||
          (p.shopName && p.shopName.toLowerCase().includes(q))
      );
    }

    if (options?.supplierName) {
      const q = options.supplierName.toLowerCase();
      purchases = purchases.filter(p => p.supplierName.toLowerCase().includes(q));
    }

    if (options?.paymentStatus && options.paymentStatus !== 'ALL') {
      purchases = purchases.filter(p => p.paymentStatus === options.paymentStatus);
    }

    if (options?.startDate) {
      purchases = purchases.filter(p => p.date >= options.startDate!);
    }

    if (options?.endDate) {
      purchases = purchases.filter(p => p.date <= options.endDate!);
    }

    return purchases;
  }
}
