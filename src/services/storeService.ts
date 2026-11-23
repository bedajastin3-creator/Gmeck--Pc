import { db } from '../db/storage';
import {
  InventoryMovement,
  Product,
  ProductStoreStockDetail,
  Shop,
  StockTransfer,
  StockTransferItem,
  StockTransferLocationType,
  StockTransferStatus,
  Store,
  SyncQueueItem,
  User,
} from '../types';
import { generateUUID } from '../utils/crypto';
import { hasAdminAccess } from '../utils/permissions';

export interface StockTransferPayload {
  transferDate: string;
  sourceType: StockTransferLocationType;
  sourceId: string;
  destType: StockTransferLocationType;
  destId: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice?: number;
  }>;
  shippingCharges?: number;
  notice?: string;
  status: StockTransferStatus;
}

function buildTransferNumber(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TRF-${ymd}-${rand}`;
}

function computeStoreDetail(
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

function hydrateLegacyStoreStocksIfNeeded(
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
    const targetStoreId =
      product.storeId && warehouseIds.has(product.storeId)
        ? product.storeId
        : warehouses[0].id;
    nextStocks[targetStoreId] = rawStoreStock;
  }
  return nextStocks;
}

function recalculateWarehouseStoreStock(
  storeStocks: Record<string, number>,
  shopStores: Store[]
): { total: number; primaryStoreId?: string } {
  const warehouses = shopStores.filter(s => !s.isShopFloor);
  const warehouseSet = new Set(warehouses.map(s => s.id));
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

function resolveLocationMeta(
  type: StockTransferLocationType,
  id: string,
  stores: Store[],
  shops: Shop[]
): {
  shopId: string;
  shopName?: string;
  name: string;
  location?: string;
  store?: Store;
  shop?: Shop;
} | null {
  if (type === 'STORE') {
    const store = stores.find(s => s.id === id);
    if (!store) return null;
    const shop = shops.find(s => s.id === store.shopId);
    return {
      shopId: store.shopId,
      shopName: shop?.name,
      name: store.name,
      location: store.location || shop?.address || shop?.name,
      store,
      shop,
    };
  }
  const shop = shops.find(s => s.id === id);
  if (!shop) return null;
  return {
    shopId: shop.id,
    shopName: shop.name,
    name: `${shop.name} (Shop Floor)`,
    location: shop.address || shop.name,
    shop,
  };
}

function applyCompletedTransferBalances(
  transfer: StockTransfer,
  direction: 1 | -1,
  products: Product[],
  stores: Store[],
  shops: Shop[],
  currentUser: User,
  now: string,
  options?: { recordMovements?: boolean }
): {
  success: boolean;
  error?: string;
  updatedProductIds: Set<string>;
  createdProducts: Product[];
  movements: InventoryMovement[];
} {
  const updatedProductIds = new Set<string>();
  const createdProducts: Product[] = [];
  const movements: InventoryMovement[] = [];

  if (transfer.status !== 'COMPLETED') {
    return {
      success: true,
      updatedProductIds,
      createdProducts,
      movements,
    };
  }

  for (const item of transfer.items) {
    const qty = Number(item.quantity || 0);
    if (qty <= 0) continue;

    const srcIdx = products.findIndex(p => p.id === item.productId);
    if (srcIdx === -1) {
      if (direction === 1) {
        return {
          success: false,
          error: `Product "${item.productName}" not found in catalog.`,
          updatedProductIds,
          createdProducts,
          movements,
        };
      }
      continue;
    }

    const srcProd = { ...products[srcIdx] };
    const srcShopStores = stores.filter(s => s.shopId === srcProd.shopId);
    const srcStoreStocks = hydrateLegacyStoreStocksIfNeeded(srcProd, srcShopStores);
    const srcStoreDetails: Record<string, ProductStoreStockDetail> = {
      ...(srcProd.storeDetails || {}),
    };

    // 1. Source adjustment (direction = +1 deducts from source, direction = -1 restores source)
    if (transfer.sourceType === 'STORE') {
      const sourceStore = stores.find(s => s.id === transfer.sourceId);
      const currentAvail = Math.max(0, Number(srcStoreStocks[transfer.sourceId] || 0));
      if (direction === 1 && currentAvail < qty) {
        return {
          success: false,
          error: `Insufficient stock in ${transfer.sourceName} for "${srcProd.name}" (available: ${currentAvail}, requested: ${qty}).`,
          updatedProductIds,
          createdProducts,
          movements,
        };
      }
      const nextSourceQty = Math.max(0, currentAvail - direction * qty);
      srcStoreStocks[transfer.sourceId] = nextSourceQty;
      if (sourceStore) {
        srcStoreDetails[sourceStore.id] = computeStoreDetail(
          sourceStore,
          nextSourceQty,
          srcProd.purchasePrice || 0,
          srcProd.sellingPrice || 0,
          srcStoreDetails[sourceStore.id]
        );
      }
      if (options?.recordMovements) {
        movements.push({
          id: generateUUID(),
          shopId: srcProd.shopId,
          shopName: transfer.sourceShopName,
          storeId: transfer.sourceId,
          productId: srcProd.id,
          productName: srcProd.name,
          previousQty: currentAvail,
          changeQty: -qty,
          newQty: nextSourceQty,
          type: 'STORE_TRANSFER',
          reason: `Transferred OUT to ${transfer.destName} (${transfer.transferNumber})`,
          referenceId: transfer.id,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: now,
        });
      }
    } else {
      // Source is SHOP floor
      const currentAvail = Math.max(0, Number(srcProd.currentStock || 0));
      if (direction === 1 && currentAvail < qty) {
        return {
          success: false,
          error: `Insufficient floor stock in ${transfer.sourceName} for "${srcProd.name}" (available: ${currentAvail}, requested: ${qty}).`,
          updatedProductIds,
          createdProducts,
          movements,
        };
      }
      const nextFloorQty = Math.max(0, currentAvail - direction * qty);
      srcProd.currentStock = nextFloorQty;
      for (const fl of srcShopStores.filter(s => s.isShopFloor)) {
        srcStoreStocks[fl.id] = nextFloorQty;
        srcStoreDetails[fl.id] = computeStoreDetail(
          fl,
          nextFloorQty,
          srcProd.purchasePrice || 0,
          srcProd.sellingPrice || 0,
          srcStoreDetails[fl.id]
        );
      }
      if (options?.recordMovements) {
        movements.push({
          id: generateUUID(),
          shopId: srcProd.shopId,
          shopName: transfer.sourceShopName,
          productId: srcProd.id,
          productName: srcProd.name,
          previousQty: currentAvail,
          changeQty: -qty,
          newQty: nextFloorQty,
          type: 'STORE_TRANSFER',
          reason: `Transferred OUT to ${transfer.destName} (${transfer.transferNumber})`,
          referenceId: transfer.id,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: now,
        });
      }
    }

    // 2. Destination adjustment (direction = +1 adds to dest, direction = -1 deducts from dest)
    if (transfer.destType === 'STORE') {
      const destStore = stores.find(s => s.id === transfer.destId);
      const prevDestQty = Math.max(0, Number(srcStoreStocks[transfer.destId] || 0));
      const nextDestQty = Math.max(0, prevDestQty + direction * qty);
      srcStoreStocks[transfer.destId] = nextDestQty;
      if (destStore) {
        srcStoreDetails[destStore.id] = computeStoreDetail(
          destStore,
          nextDestQty,
          srcProd.purchasePrice || 0,
          srcProd.sellingPrice || 0,
          srcStoreDetails[destStore.id]
        );
      }
      if (options?.recordMovements) {
        movements.push({
          id: generateUUID(),
          shopId: transfer.destShopId || srcProd.shopId,
          shopName: transfer.destShopName,
          storeId: transfer.destId,
          productId: srcProd.id,
          productName: srcProd.name,
          previousQty: prevDestQty,
          changeQty: qty,
          newQty: nextDestQty,
          type: 'STORE_TRANSFER',
          reason: `Transferred IN from ${transfer.sourceName} (${transfer.transferNumber})`,
          referenceId: transfer.id,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: now,
        });
      }
    } else if (transfer.destId === srcProd.shopId) {
      // Destination is same Shop Floor
      const prevFloorQty = Math.max(0, Number(srcProd.currentStock || 0));
      const nextFloorQty = Math.max(0, prevFloorQty + direction * qty);
      srcProd.currentStock = nextFloorQty;
      for (const fl of srcShopStores.filter(s => s.isShopFloor)) {
        srcStoreStocks[fl.id] = nextFloorQty;
        srcStoreDetails[fl.id] = computeStoreDetail(
          fl,
          nextFloorQty,
          srcProd.purchasePrice || 0,
          srcProd.sellingPrice || 0,
          srcStoreDetails[fl.id]
        );
      }
      if (options?.recordMovements) {
        movements.push({
          id: generateUUID(),
          shopId: transfer.destId,
          shopName: transfer.destShopName,
          storeId: transfer.sourceType === 'STORE' ? transfer.sourceId : undefined,
          productId: srcProd.id,
          productName: srcProd.name,
          previousQty: prevFloorQty,
          changeQty: qty,
          newQty: nextFloorQty,
          type: 'STORE_TRANSFER',
          reason: `Transferred IN from ${transfer.sourceName} (${transfer.transferNumber})`,
          referenceId: transfer.id,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: now,
        });
      }
    } else {
      // Destination is a DIFFERENT Shop Floor
      const destShop = shops.find(s => s.id === transfer.destId);
      const destIdx = products.findIndex(
        p =>
          p.shopId === transfer.destId &&
          ((srcProd.sku && p.sku && p.sku.toLowerCase() === srcProd.sku.toLowerCase()) ||
            (p.name.toLowerCase().trim() === srcProd.name.toLowerCase().trim() &&
              (p.variation || '').toLowerCase().trim() ===
                (srcProd.variation || '').toLowerCase().trim()))
      );

      if (destIdx !== -1) {
        const destProd = { ...products[destIdx] };
        const prevFloorQty = Math.max(0, Number(destProd.currentStock || 0));
        const nextFloorQty = Math.max(0, prevFloorQty + direction * qty);
        destProd.currentStock = nextFloorQty;
        destProd.updatedAt = now;
        products[destIdx] = destProd;
        updatedProductIds.add(destProd.id);

        if (options?.recordMovements) {
          movements.push({
            id: generateUUID(),
            shopId: transfer.destId,
            shopName: destShop?.name || transfer.destShopName,
            productId: destProd.id,
            productName: destProd.name,
            previousQty: prevFloorQty,
            changeQty: qty,
            newQty: nextFloorQty,
            type: 'STORE_TRANSFER',
            reason: `Transferred IN from ${transfer.sourceName} (${transfer.transferNumber})`,
            referenceId: transfer.id,
            userId: currentUser.id,
            userName: currentUser.name,
            createdAt: now,
          });
        }
      } else if (direction === 1) {
        const newProdId = generateUUID();
        const clonedProduct: Product = {
          id: newProdId,
          shopId: transfer.destId,
          name: srcProd.name,
          variation: srcProd.variation,
          sku: srcProd.sku,
          barcode: srcProd.barcode,
          categoryId: srcProd.categoryId,
          sellingPrice: Number(item.unitPrice ?? srcProd.sellingPrice ?? 0),
          proposedSellingPrice: srcProd.proposedSellingPrice,
          purchasePrice: srcProd.purchasePrice || 0,
          currentStock: qty,
          storeStock: 0,
          minStock: srcProd.minStock ?? 5,
          unit: srcProd.unit || 'pcs',
          status: 'ACTIVE',
          imageUrl: srcProd.imageUrl,
          customFields: srcProd.customFields,
          createdAt: now,
          updatedAt: now,
        };
        products.push(clonedProduct);
        createdProducts.push(clonedProduct);

        if (options?.recordMovements) {
          movements.push({
            id: generateUUID(),
            shopId: transfer.destId,
            shopName: destShop?.name || transfer.destShopName,
            productId: clonedProduct.id,
            productName: clonedProduct.name,
            previousQty: 0,
            changeQty: qty,
            newQty: qty,
            type: 'STORE_TRANSFER',
            reason: `Transferred IN from ${transfer.sourceName} (${transfer.transferNumber})`,
            referenceId: transfer.id,
            userId: currentUser.id,
            userName: currentUser.name,
            createdAt: now,
          });
        }
      }
    }

    const recalc = recalculateWarehouseStoreStock(srcStoreStocks, srcShopStores);
    srcProd.storeStocks = srcStoreStocks;
    srcProd.storeDetails = srcStoreDetails;
    srcProd.storeStock = recalc.total;
    if (recalc.primaryStoreId) {
      srcProd.storeId = recalc.primaryStoreId;
    }
    srcProd.updatedAt = now;
    products[srcIdx] = srcProd;
    updatedProductIds.add(srcProd.id);
  }

  return {
    success: true,
    updatedProductIds,
    createdProducts,
    movements,
  };
}

export class StoreService {
  public static createStore(
    data: { name: string; location?: string; shopId: string },
    currentUser: User
  ): { success: boolean; store?: Store; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return { success: false, error: 'Permission Denied: Admin access required.' };
    }

    const cleanName = (data.name || '').trim();
    if (!cleanName) {
      return { success: false, error: 'Store name is required.' };
    }
    if (!data.shopId) {
      return { success: false, error: 'Shop assignment is required.' };
    }

    const shop = db.getShops().find(s => s.id === data.shopId);
    if (!shop) {
      return { success: false, error: 'Selected shop does not exist.' };
    }

    const stores = db.getStores();
    const duplicate = stores.find(
      s =>
        s.shopId === data.shopId &&
        s.name.toLowerCase().trim() === cleanName.toLowerCase()
    );
    if (duplicate) {
      return {
        success: false,
        error: `A store named "${cleanName}" already exists in ${shop.name}.`,
      };
    }

    const now = new Date().toISOString();
    const newStore: Store = {
      id: generateUUID(),
      shopId: data.shopId,
      name: cleanName,
      location: data.location?.trim() || undefined,
      status: 'ACTIVE',
      isShopFloor: false,
      createdAt: now,
      updatedAt: now,
    };

    db.saveStores([newStore, ...stores]);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_STORE',
      entityType: 'STORE',
      entityId: newStore.id,
      payload: newStore,
      status: 'PENDING',
      createdAt: now,
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'CREATE_STORE',
      details: `Created store '${newStore.name}' assigned to shop '${shop.name}'`,
      entityType: 'STORE',
      entityId: newStore.id,
      shopId: shop.id,
      timestamp: now,
    });

    return { success: true, store: newStore };
  }

  public static updateStore(
    storeId: string,
    updates: Partial<Pick<Store, 'name' | 'location' | 'shopId' | 'status'>>,
    currentUser: User
  ): { success: boolean; store?: Store; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return { success: false, error: 'Permission Denied: Admin access required.' };
    }

    const stores = db.getStores();
    const index = stores.findIndex(s => s.id === storeId);
    if (index === -1) {
      return { success: false, error: 'Store not found.' };
    }

    const existing = stores[index];
    const nextShopId = updates.shopId || existing.shopId;
    const nextName =
      updates.name !== undefined ? updates.name.trim() : existing.name;

    if (!nextName) {
      return { success: false, error: 'Store name cannot be empty.' };
    }

    const shop = db.getShops().find(s => s.id === nextShopId);
    if (!shop) {
      return { success: false, error: 'Assigned shop does not exist.' };
    }

    const duplicate = stores.find(
      s =>
        s.id !== storeId &&
        s.shopId === nextShopId &&
        s.name.toLowerCase().trim() === nextName.toLowerCase()
    );
    if (duplicate) {
      return {
        success: false,
        error: `A store named "${nextName}" already exists in ${shop.name}.`,
      };
    }

    const now = new Date().toISOString();
    const updatedStore: Store = {
      ...existing,
      shopId: nextShopId,
      name: nextName,
      location:
        updates.location !== undefined
          ? updates.location.trim() || undefined
          : existing.location,
      status: updates.status || existing.status,
      updatedAt: now,
    };

    const nextStores = [...stores];
    nextStores[index] = updatedStore;
    db.saveStores(nextStores);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_STORE',
      entityType: 'STORE',
      entityId: updatedStore.id,
      payload: updatedStore,
      status: 'PENDING',
      createdAt: now,
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_STORE',
      details: `Updated store '${updatedStore.name}' (${shop.name})`,
      entityType: 'STORE',
      entityId: updatedStore.id,
      shopId: shop.id,
      timestamp: now,
    });

    return { success: true, store: updatedStore };
  }

  public static deleteStore(
    storeId: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return { success: false, error: 'Permission Denied: Admin access required.' };
    }

    const stores = db.getStores();
    const target = stores.find(s => s.id === storeId);
    if (!target) {
      return { success: false, error: 'Store not found.' };
    }

    const now = new Date().toISOString();
    const remainingStores = stores.filter(s => s.id !== storeId);
    db.saveStores(remainingStores);

    // Clean store references from products and recalculate aggregate storeStock
    const products = [...db.getProducts()];
    const syncItems: SyncQueueItem[] = [];
    let productsChanged = false;

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const hasStoreStockEntry = p.storeStocks && storeId in p.storeStocks;
      const hasStoreDetailEntry = p.storeDetails && storeId in p.storeDetails;
      const isPrimaryStore = p.storeId === storeId;

      if (!hasStoreStockEntry && !hasStoreDetailEntry && !isPrimaryStore) continue;

      const nextStocks = { ...(p.storeStocks || {}) };
      delete nextStocks[storeId];

      const nextDetails = p.storeDetails ? { ...p.storeDetails } : undefined;
      if (nextDetails) delete nextDetails[storeId];

      const shopStores = remainingStores.filter(s => s.shopId === p.shopId);
      const recalc = recalculateWarehouseStoreStock(nextStocks, shopStores);

      const updatedProd: Product = {
        ...p,
        storeId: recalc.primaryStoreId,
        storeStock: recalc.total,
        storeStocks: nextStocks,
        storeDetails: nextDetails,
        updatedAt: now,
      };
      products[i] = updatedProd;
      productsChanged = true;

      syncItems.push({
        id: generateUUID(),
        operation: 'UPDATE_PRODUCT',
        entityType: 'PRODUCT',
        entityId: updatedProd.id,
        payload: updatedProd,
        status: 'PENDING',
        createdAt: now,
      });
    }

    if (productsChanged) {
      db.saveProducts(products);
    }

    syncItems.push({
      id: generateUUID(),
      operation: 'DELETE_STORE',
      entityType: 'STORE',
      entityId: storeId,
      payload: { id: storeId },
      status: 'PENDING',
      createdAt: now,
    });
    db.enqueueSyncBatch(syncItems);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_STORE',
      details: `Deleted store '${target.name}'`,
      entityType: 'STORE',
      entityId: storeId,
      shopId: target.shopId,
      timestamp: now,
    });

    return { success: true };
  }

  public static executeStockTransfer(
    payload: StockTransferPayload,
    currentUser: User
  ): { success: boolean; transfer?: StockTransfer; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return { success: false, error: 'Permission Denied: Admin access required.' };
    }

    const stores = db.getStores();
    const shops = db.getShops();
    const srcMeta = resolveLocationMeta(payload.sourceType, payload.sourceId, stores, shops);
    const dstMeta = resolveLocationMeta(payload.destType, payload.destId, stores, shops);

    if (!srcMeta) {
      return { success: false, error: 'Selected Location From does not exist.' };
    }
    if (!dstMeta) {
      return { success: false, error: 'Selected Location To does not exist.' };
    }
    if (
      payload.sourceType === payload.destType &&
      payload.sourceId === payload.destId
    ) {
      return { success: false, error: 'Source and destination cannot be the same location.' };
    }
    if (!payload.items || payload.items.length === 0) {
      return { success: false, error: 'Select at least one product to transfer.' };
    }

    const workingProducts = db.getProducts().map(p => ({ ...p }));
    const productMap = new Map(workingProducts.map(p => [p.id, p]));

    const builtItems: StockTransferItem[] = [];
    let totalUnits = 0;
    let totalAmount = 0;

    for (const raw of payload.items) {
      const prod = productMap.get(raw.productId);
      if (!prod) {
        return { success: false, error: 'One or more selected products no longer exist.' };
      }
      const qty = Number(raw.quantity || 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        return { success: false, error: `Invalid quantity for "${prod.name}".` };
      }
      const unitPrice =
        raw.unitPrice !== undefined && Number.isFinite(Number(raw.unitPrice))
          ? Math.max(0, Number(raw.unitPrice))
          : Number(prod.sellingPrice || prod.purchasePrice || 0);
      const subtotal = Math.round(qty * unitPrice * 100) / 100;

      builtItems.push({
        id: generateUUID(),
        productId: prod.id,
        productName: prod.name,
        variation: prod.variation,
        sku: prod.sku,
        unit: prod.unit || 'pcs',
        quantity: qty,
        unitPrice,
        subtotal,
      });
      totalUnits += qty;
      totalAmount += subtotal;
    }

    const now = new Date().toISOString();
    const transfer: StockTransfer = {
      id: generateUUID(),
      transferNumber: buildTransferNumber(),
      transferDate: payload.transferDate || now.slice(0, 10),
      sourceType: payload.sourceType,
      sourceId: payload.sourceId,
      sourceName: srcMeta.name,
      sourceLocation: srcMeta.location,
      sourceShopId: srcMeta.shopId,
      sourceShopName: srcMeta.shopName,
      destType: payload.destType,
      destId: payload.destId,
      destName: dstMeta.name,
      destLocation: dstMeta.location,
      destShopId: dstMeta.shopId,
      destShopName: dstMeta.shopName,
      status: payload.status || 'COMPLETED',
      shippingCharges: Math.max(0, Number(payload.shippingCharges || 0) || 0),
      notice: payload.notice?.trim() || undefined,
      items: builtItems,
      totalUnits,
      totalAmount: Math.round(totalAmount * 100) / 100,
      createdByUserId: currentUser.id,
      createdByName: currentUser.name,
      createdAt: now,
      updatedAt: now,
    };

    const applyRes = applyCompletedTransferBalances(
      transfer,
      1,
      workingProducts,
      stores,
      shops,
      currentUser,
      now,
      { recordMovements: true }
    );

    if (!applyRes.success) {
      return { success: false, error: applyRes.error || 'Transfer failed.' };
    }

    if (transfer.status === 'COMPLETED') {
      db.saveProducts(workingProducts);
      if (applyRes.movements.length > 0) {
        db.saveMovements([...applyRes.movements, ...db.getMovements()]);
      }
    }

    const existingTransfers = db.getStockTransfers();
    db.saveStockTransfers([transfer, ...existingTransfers]);

    const syncBatch: SyncQueueItem[] = [];
    for (const createdProd of applyRes.createdProducts) {
      syncBatch.push({
        id: generateUUID(),
        operation: 'CREATE_PRODUCT',
        entityType: 'PRODUCT',
        entityId: createdProd.id,
        payload: createdProd,
        status: 'PENDING',
        createdAt: now,
      });
    }
    const finalProductMap = new Map(workingProducts.map(p => [p.id, p]));
    for (const pid of applyRes.updatedProductIds) {
      const prod = finalProductMap.get(pid);
      if (prod) {
        syncBatch.push({
          id: generateUUID(),
          operation: 'UPDATE_PRODUCT',
          entityType: 'PRODUCT',
          entityId: prod.id,
          payload: prod,
          status: 'PENDING',
          createdAt: now,
        });
      }
    }
    syncBatch.push({
      id: generateUUID(),
      operation: 'UPSERT_STOCK_TRANSFER',
      entityType: 'STOCK_TRANSFER',
      entityId: transfer.id,
      payload: transfer,
      status: 'PENDING',
      createdAt: now,
    });
    db.enqueueSyncBatch(syncBatch);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'STOCK_TRANSFER',
      details: `${transfer.transferNumber}: ${transfer.sourceName} -> ${transfer.destName} (${transfer.totalUnits} units, status: ${transfer.status})`,
      entityType: 'STOCK_TRANSFER',
      entityId: transfer.id,
      shopId: transfer.sourceShopId,
      timestamp: now,
    });

    return { success: true, transfer };
  }

  public static updateStockTransfer(
    transferId: string,
    payload: StockTransferPayload,
    currentUser: User
  ): { success: boolean; transfer?: StockTransfer; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return { success: false, error: 'Permission Denied: Admin access required.' };
    }

    const transfers = db.getStockTransfers();
    const existingIdx = transfers.findIndex(t => t.id === transferId);
    if (existingIdx === -1) {
      return { success: false, error: 'Transfer record not found.' };
    }
    const existing = transfers[existingIdx];

    const stores = db.getStores();
    const shops = db.getShops();
    const srcMeta = resolveLocationMeta(payload.sourceType, payload.sourceId, stores, shops);
    const dstMeta = resolveLocationMeta(payload.destType, payload.destId, stores, shops);

    if (!srcMeta) {
      return { success: false, error: 'Selected Location From does not exist.' };
    }
    if (!dstMeta) {
      return { success: false, error: 'Selected Location To does not exist.' };
    }
    if (!payload.items || payload.items.length === 0) {
      return { success: false, error: 'Select at least one product for this transfer.' };
    }

    const now = new Date().toISOString();
    const workingProducts = db.getProducts().map(p => ({ ...p }));

    // 1. Reverse previous COMPLETED stock balances on workingProducts first
    const touchedIds = new Set<string>();
    if (existing.status === 'COMPLETED') {
      const revertRes = applyCompletedTransferBalances(
        existing,
        -1,
        workingProducts,
        stores,
        shops,
        currentUser,
        now
      );
      revertRes.updatedProductIds.forEach(id => touchedIds.add(id));
    }

    // 2. Build updated transfer record
    const productMap = new Map(workingProducts.map(p => [p.id, p]));
    const builtItems: StockTransferItem[] = [];
    let totalUnits = 0;
    let totalAmount = 0;

    for (const raw of payload.items) {
      const prod = productMap.get(raw.productId);
      if (!prod) {
        return { success: false, error: 'One or more selected products no longer exist.' };
      }
      const qty = Number(raw.quantity || 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        return { success: false, error: `Invalid quantity for "${prod.name}".` };
      }
      const unitPrice =
        raw.unitPrice !== undefined && Number.isFinite(Number(raw.unitPrice))
          ? Math.max(0, Number(raw.unitPrice))
          : Number(prod.sellingPrice || prod.purchasePrice || 0);
      const subtotal = Math.round(qty * unitPrice * 100) / 100;

      builtItems.push({
        id: generateUUID(),
        productId: prod.id,
        productName: prod.name,
        variation: prod.variation,
        sku: prod.sku,
        unit: prod.unit || 'pcs',
        quantity: qty,
        unitPrice,
        subtotal,
      });
      totalUnits += qty;
      totalAmount += subtotal;
    }

    const updatedTransfer: StockTransfer = {
      ...existing,
      transferDate: payload.transferDate || existing.transferDate,
      sourceType: payload.sourceType,
      sourceId: payload.sourceId,
      sourceName: srcMeta.name,
      sourceLocation: srcMeta.location,
      sourceShopId: srcMeta.shopId,
      sourceShopName: srcMeta.shopName,
      destType: payload.destType,
      destId: payload.destId,
      destName: dstMeta.name,
      destLocation: dstMeta.location,
      destShopId: dstMeta.shopId,
      destShopName: dstMeta.shopName,
      status: payload.status || 'COMPLETED',
      shippingCharges: Math.max(0, Number(payload.shippingCharges || 0) || 0),
      notice: payload.notice?.trim() || undefined,
      items: builtItems,
      totalUnits,
      totalAmount: Math.round(totalAmount * 100) / 100,
      updatedAt: now,
    };

    // 3. Apply new COMPLETED stock balances if applicable
    const applyRes = applyCompletedTransferBalances(
      updatedTransfer,
      1,
      workingProducts,
      stores,
      shops,
      currentUser,
      now,
      { recordMovements: true }
    );

    if (!applyRes.success) {
      return { success: false, error: applyRes.error || 'Failed to update stock transfer.' };
    }

    applyRes.updatedProductIds.forEach(id => touchedIds.add(id));

    if (touchedIds.size > 0 || applyRes.createdProducts.length > 0) {
      db.saveProducts(workingProducts);
    }
    if (applyRes.movements.length > 0) {
      db.saveMovements([...applyRes.movements, ...db.getMovements()]);
    }

    const nextTransfers = [...transfers];
    nextTransfers[existingIdx] = updatedTransfer;
    db.saveStockTransfers(nextTransfers);

    const syncBatch: SyncQueueItem[] = [];
    for (const createdProd of applyRes.createdProducts) {
      syncBatch.push({
        id: generateUUID(),
        operation: 'CREATE_PRODUCT',
        entityType: 'PRODUCT',
        entityId: createdProd.id,
        payload: createdProd,
        status: 'PENDING',
        createdAt: now,
      });
    }
    const finalProductMap = new Map(workingProducts.map(p => [p.id, p]));
    for (const pid of touchedIds) {
      const prod = finalProductMap.get(pid);
      if (prod) {
        syncBatch.push({
          id: generateUUID(),
          operation: 'UPDATE_PRODUCT',
          entityType: 'PRODUCT',
          entityId: prod.id,
          payload: prod,
          status: 'PENDING',
          createdAt: now,
        });
      }
    }
    syncBatch.push({
      id: generateUUID(),
      operation: 'UPSERT_STOCK_TRANSFER',
      entityType: 'STOCK_TRANSFER',
      entityId: updatedTransfer.id,
      payload: updatedTransfer,
      status: 'PENDING',
      createdAt: now,
    });
    db.enqueueSyncBatch(syncBatch);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_STOCK_TRANSFER',
      details: `Updated ${updatedTransfer.transferNumber}: ${updatedTransfer.sourceName} -> ${updatedTransfer.destName} (${updatedTransfer.totalUnits} units)`,
      entityType: 'STOCK_TRANSFER',
      entityId: updatedTransfer.id,
      shopId: updatedTransfer.sourceShopId,
      timestamp: now,
    });

    return { success: true, transfer: updatedTransfer };
  }

  public static deleteStockTransfer(
    transferId: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return { success: false, error: 'Permission Denied: Admin access required.' };
    }

    const transfers = db.getStockTransfers();
    const target = transfers.find(t => t.id === transferId);
    if (!target) {
      return { success: false, error: 'Transfer record not found.' };
    }

    const now = new Date().toISOString();
    const stores = db.getStores();
    const shops = db.getShops();
    const workingProducts = db.getProducts().map(p => ({ ...p }));
    const syncBatch: SyncQueueItem[] = [];

    if (target.status === 'COMPLETED') {
      const revertRes = applyCompletedTransferBalances(
        target,
        -1,
        workingProducts,
        stores,
        shops,
        currentUser,
        now
      );

      if (revertRes.updatedProductIds.size > 0) {
        db.saveProducts(workingProducts);
        const prodMap = new Map(workingProducts.map(p => [p.id, p]));
        for (const pid of revertRes.updatedProductIds) {
          const prod = prodMap.get(pid);
          if (prod) {
            syncBatch.push({
              id: generateUUID(),
              operation: 'UPDATE_PRODUCT',
              entityType: 'PRODUCT',
              entityId: prod.id,
              payload: prod,
              status: 'PENDING',
              createdAt: now,
            });
          }
        }
      }
    }

    db.saveStockTransfers(transfers.filter(t => t.id !== transferId));

    syncBatch.push({
      id: generateUUID(),
      operation: 'DELETE_STOCK_TRANSFER',
      entityType: 'STOCK_TRANSFER',
      entityId: transferId,
      payload: { id: transferId },
      status: 'PENDING',
      createdAt: now,
    });
    db.enqueueSyncBatch(syncBatch);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_STOCK_TRANSFER',
      details: `Deleted transfer ${target.transferNumber} (${target.sourceName} -> ${target.destName})`,
      entityType: 'STOCK_TRANSFER',
      entityId: transferId,
      shopId: target.sourceShopId,
      timestamp: now,
    });

    return { success: true };
  }
}
