import { db } from '../db/storage';
import { InventoryMovement, MovementType, User } from '../types';
import { generateUUID } from '../utils/crypto';
import { getAdminManagedShops, hasAdminAccess, isPlatformAdmin, isShopAdmin } from '../utils/permissions';

function getAllowedShopIdsForInventory(currentUser?: User): Set<string> | null {
  if (!currentUser || isPlatformAdmin(currentUser)) return null;
  if (isShopAdmin(currentUser)) {
    return new Set(getAdminManagedShops(currentUser, db.getShops()).map(s => s.id));
  }
  return new Set(currentUser.assignedShopIds || []);
}

export class InventoryService {
  /**
   * Adjust stock manually for count correction, damage, loss, or physical inventory.
   * Admin, Shop Admin, OR Seller with canManageInventory permission.
   */
  public static adjustStock(
    productId: string,
    newQuantity: number,
    reason: string,
    currentUser: User,
    movementType: MovementType = 'ADJUSTMENT',
    options?: { targetLocation?: 'SHOP' | string }
  ): { success: boolean; error?: string; lossValue?: number } {
    if (!hasAdminAccess(currentUser) && !currentUser.permissions?.canManageInventory) {
      return { success: false, error: 'Permission Denied: You do not have permission to adjust stock levels.' };
    }

    if (!reason?.trim()) {
      return { success: false, error: 'Please provide a reason for the stock adjustment.' };
    }

    const products = db.getProducts();
    const prodIndex = products.findIndex(p => p.id === productId);
    if (prodIndex === -1) {
      return { success: false, error: 'Product not found.' };
    }

    const prod = products[prodIndex];
    const allowedShopIds = getAllowedShopIdsForInventory(currentUser);
    if (allowedShopIds && (!prod.shopId || !allowedShopIds.has(prod.shopId))) {
      return { success: false, error: 'Permission Denied: This product belongs to a shop outside your access scope.' };
    }

    const safeNewQty = Math.max(0, Math.round(Number(newQuantity) || 0));
    const allStores = db.getStores();
    const shop = db.getShops().find(s => s.id === prod.shopId);
    const floorStoreIds = new Set(allStores.filter(s => s.isShopFloor).map(s => s.id));
    const requestedLocation = options?.targetLocation?.trim();
    const targetStore =
      requestedLocation && requestedLocation !== 'SHOP' && !floorStoreIds.has(requestedLocation)
        ? allStores.find(s => s.id === requestedLocation && s.shopId === prod.shopId && !s.isShopFloor)
        : undefined;

    if (requestedLocation && requestedLocation !== 'SHOP' && !floorStoreIds.has(requestedLocation) && !targetStore) {
      return { success: false, error: 'Selected store location was not found for this product.' };
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const followUpIso = new Date(nowMs + 5).toISOString();

    if (targetStore) {
      const shopWarehouses = allStores.filter(s => s.shopId === prod.shopId && !s.isShopFloor);
      const nextStoreStocks: Record<string, number> = { ...(prod.storeStocks || {}) };

      const mappedWarehouseSum = shopWarehouses.reduce(
        (sum, ws) => sum + Math.max(0, Number(nextStoreStocks[ws.id] || 0)),
        0
      );
      if (mappedWarehouseSum === 0 && Number(prod.storeStock || 0) > 0 && shopWarehouses.length > 0) {
        const legacyStoreId =
          prod.storeId && shopWarehouses.some(ws => ws.id === prod.storeId)
            ? prod.storeId
            : shopWarehouses[0].id;
        nextStoreStocks[legacyStoreId] = Math.max(0, Number(prod.storeStock || 0));
      }

      const prevQty = Math.max(0, Number(nextStoreStocks[targetStore.id] ?? 0));
      const diff = safeNewQty - prevQty;

      if (diff === 0) {
        return { success: true };
      }

      nextStoreStocks[targetStore.id] = safeNewQty;

      const nextStoreDetails = { ...(prod.storeDetails || {}) };
      const prevDetail = nextStoreDetails[targetStore.id];
      const unitBuy = prevDetail?.unitPurchasePrice ?? prod.purchasePrice ?? 0;
      const unitSell = prevDetail?.unitSellingPrice ?? prod.sellingPrice ?? 0;
      nextStoreDetails[targetStore.id] = {
        ...prevDetail,
        storeId: targetStore.id,
        storeName: targetStore.name,
        quantity: safeNewQty,
        unitPurchasePrice: unitBuy,
        unitSellingPrice: unitSell,
        ...(prevDetail?.importedPurchaseValue !== undefined
          ? { importedPurchaseValue: Number((safeNewQty * unitBuy).toFixed(2)) }
          : {}),
        ...(prevDetail?.importedSaleValue !== undefined
          ? { importedSaleValue: Number((safeNewQty * unitSell).toFixed(2)) }
          : {}),
        ...(prevDetail?.importedPotentialProfit !== undefined
          ? { importedPotentialProfit: Number((safeNewQty * (unitSell - unitBuy)).toFixed(2)) }
          : {}),
      };

      const nextStoreStock = Object.entries(nextStoreStocks).reduce(
        (sum, [sid, q]) => (floorStoreIds.has(sid) ? sum : sum + Math.max(0, Number(q || 0))),
        0
      );

      const updatedProduct = {
        ...prod,
        storeId: prod.storeId || targetStore.id,
        storeStock: nextStoreStock,
        storeStocks: nextStoreStocks,
        storeDetails: nextStoreDetails,
        updatedAt: nowIso,
      };

      products[prodIndex] = updatedProduct;
      db.saveProducts(products);

      const costValue = Number((Math.abs(diff) * (prod.purchasePrice || 0)).toFixed(2));
      const movement: InventoryMovement = {
        id: generateUUID(),
        shopId: prod.shopId,
        shopName: shop?.name || 'Main Shop',
        storeId: targetStore.id,
        productId: prod.id,
        productName: prod.name,
        previousQty: prevQty,
        changeQty: diff,
        newQty: safeNewQty,
        type: movementType,
        costValue,
        reason: `${reason.trim()} [${targetStore.name}]`,
        userId: currentUser.id,
        userName: currentUser.name,
        createdAt: nowIso,
      };
      db.saveMovements([movement, ...db.getMovements()]);

      db.enqueueSync({
        id: generateUUID(),
        operation: 'STOCK_ADJUSTMENT',
        entityType: 'INVENTORY',
        entityId: movement.id,
        payload: movement,
        status: 'PENDING',
        createdAt: nowIso,
      });

      // Also enqueue full product update so store_stocks / store_details / aggregate store_stock stay accurate in D1
      db.enqueueSync({
        id: generateUUID(),
        operation: 'UPDATE_PRODUCT',
        entityType: 'PRODUCT',
        entityId: updatedProduct.id,
        payload: updatedProduct,
        status: 'PENDING',
        createdAt: followUpIso,
      });

      db.addAuditLog({
        id: generateUUID(),
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'STOCK_ADJUSTMENT',
        details: `Adjusted '${prod.name}' stock in store '${targetStore.name}' from ${prevQty} to ${safeNewQty} (${movementType}: ${reason.trim()}, Cost Impact: $${costValue}) [${shop?.name || 'Shop'}]`,
        entityType: 'INVENTORY',
        entityId: prod.id,
        timestamp: nowIso,
      });

      return { success: true, lossValue: diff < 0 ? costValue : 0 };
    }

    // Shop floor adjustment
    const prevQty = Math.max(0, Number(prod.currentStock || 0));
    const diff = safeNewQty - prevQty;

    if (diff === 0) {
      return { success: true };
    }

    const costValue = Number((Math.abs(diff) * (prod.purchasePrice || 0)).toFixed(2));

    const shopFloorStores = allStores.filter(s => s.shopId === prod.shopId && s.isShopFloor);
    let nextStoreStocks = prod.storeStocks ? { ...prod.storeStocks } : undefined;
    let nextStoreDetails = prod.storeDetails ? { ...prod.storeDetails } : undefined;
    let updatedFloorMap = false;

    for (const fl of shopFloorStores) {
      if (nextStoreStocks && fl.id in nextStoreStocks) {
        nextStoreStocks[fl.id] = safeNewQty;
        updatedFloorMap = true;
      }
      if (nextStoreDetails && fl.id in nextStoreDetails) {
        const prevFloorDetail = nextStoreDetails[fl.id];
        const unitBuy = prevFloorDetail.unitPurchasePrice ?? prod.purchasePrice ?? 0;
        const unitSell = prevFloorDetail.unitSellingPrice ?? prod.sellingPrice ?? 0;
        nextStoreDetails[fl.id] = {
          ...prevFloorDetail,
          storeId: fl.id,
          storeName: fl.name,
          quantity: safeNewQty,
          ...(prevFloorDetail.importedPurchaseValue !== undefined
            ? { importedPurchaseValue: Number((safeNewQty * unitBuy).toFixed(2)) }
            : {}),
          ...(prevFloorDetail.importedSaleValue !== undefined
            ? { importedSaleValue: Number((safeNewQty * unitSell).toFixed(2)) }
            : {}),
          ...(prevFloorDetail.importedPotentialProfit !== undefined
            ? { importedPotentialProfit: Number((safeNewQty * (unitSell - unitBuy)).toFixed(2)) }
            : {}),
        };
        updatedFloorMap = true;
      }
    }

    const updatedProduct = {
      ...prod,
      currentStock: safeNewQty,
      ...(nextStoreStocks ? { storeStocks: nextStoreStocks } : {}),
      ...(nextStoreDetails ? { storeDetails: nextStoreDetails } : {}),
      updatedAt: nowIso,
    };

    products[prodIndex] = updatedProduct;
    db.saveProducts(products);

    const movement: InventoryMovement = {
      id: generateUUID(),
      shopId: prod.shopId,
      shopName: shop?.name || 'Main Shop',
      productId: prod.id,
      productName: prod.name,
      previousQty: prevQty,
      changeQty: diff,
      newQty: safeNewQty,
      type: movementType,
      costValue,
      reason: `${reason.trim()} [${shop?.name || 'Shop'}]`,
      userId: currentUser.id,
      userName: currentUser.name,
      createdAt: nowIso,
    };
    db.saveMovements([movement, ...db.getMovements()]);

    // Include ALL movement data in sync payload
    db.enqueueSync({
      id: generateUUID(),
      operation: 'STOCK_ADJUSTMENT',
      entityType: 'INVENTORY',
      entityId: movement.id,
      payload: movement,
      status: 'PENDING',
      createdAt: nowIso,
    });

    if (updatedFloorMap) {
      db.enqueueSync({
        id: generateUUID(),
        operation: 'UPDATE_PRODUCT',
        entityType: 'PRODUCT',
        entityId: updatedProduct.id,
        payload: updatedProduct,
        status: 'PENDING',
        createdAt: followUpIso,
      });
    }

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'STOCK_ADJUSTMENT',
      details: `Adjusted '${prod.name}' stock from ${prevQty} to ${safeNewQty} (${movementType}: ${reason.trim()}, Cost Impact: $${costValue}) in [${shop?.name || 'Shop'}]`,
      entityType: 'INVENTORY',
      entityId: prod.id,
      timestamp: nowIso,
    });

    return { success: true, lossValue: diff < 0 ? costValue : 0 };
  }

  /**
   * Receive fast stock-in.
   * Admin, Shop Admin, OR Seller with canManageInventory permission.
   */
  public static stockIn(
    productId: string,
    addQuantity: number,
    reason: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (!hasAdminAccess(currentUser) && !currentUser.permissions?.canManageInventory) {
      return { success: false, error: 'Permission Denied: You do not have permission to perform stock-in.' };
    }

    if (addQuantity <= 0) {
      return { success: false, error: 'Quantity must be greater than 0.' };
    }

    const products = db.getProducts();
    const prod = products.find(p => p.id === productId);
    if (!prod) return { success: false, error: 'Product not found.' };

    return this.adjustStock(productId, prod.currentStock + addQuantity, reason || 'Quick Stock In', currentUser);
  }

  public static getMovements(productId?: string, shopId?: string): InventoryMovement[] {
    let movements = db.getMovements();
    if (shopId && shopId !== 'ALL') {
      movements = movements.filter(m => m.shopId === shopId);
    }
    if (productId) {
      movements = movements.filter(m => m.productId === productId);
    }
    return movements;
  }

  public static getMovementHistory(
    filter?: { search?: string; productId?: string; shopId?: string },
    currentUser?: User
  ): InventoryMovement[] {
    let list = db.getMovements();

    const allowedShopIds = getAllowedShopIdsForInventory(currentUser);
    if (allowedShopIds) {
      list = list.filter(m => !!m.shopId && allowedShopIds.has(m.shopId));
    }

    if (filter?.shopId && filter.shopId !== 'ALL') {
      list = list.filter(m => m.shopId === filter.shopId);
    }

    if (filter?.productId) {
      list = list.filter(m => m.productId === filter.productId);
    }

    if (filter?.search?.trim()) {
      const q = filter.search.trim().toLowerCase();
      list = list.filter(
        m =>
          m.productName.toLowerCase().includes(q) ||
          m.reason.toLowerCase().includes(q) ||
          m.userName.toLowerCase().includes(q) ||
          m.type.toLowerCase().includes(q) ||
          (m.shopName && m.shopName.toLowerCase().includes(q))
      );
    }
    return list;
  }

  public static getInventoryValuation(shopId?: string, currentUser?: User) {
    let products = db.getProducts().filter(p => p.status === 'ACTIVE');
    const allowedShopIds = getAllowedShopIdsForInventory(currentUser);
    if (allowedShopIds) {
      products = products.filter(p => !!p.shopId && allowedShopIds.has(p.shopId));
    }
    if (shopId && shopId !== 'ALL') {
      products = products.filter(p => p.shopId === shopId);
    }

    const totalCost = products.reduce((acc, p) => acc + p.currentStock * p.purchasePrice, 0);
    const totalRetail = products.reduce((acc, p) => acc + p.currentStock * p.sellingPrice, 0);
    const totalUnits = products.reduce((acc, p) => acc + Math.max(0, p.currentStock), 0);
    const potentialProfit = totalRetail - totalCost;
    const lowStockCount = products.filter(p => p.currentStock > 0 && p.currentStock <= p.minStock).length;
    const outOfStockCount = products.filter(p => p.currentStock <= 0).length;

    return {
      totalCost: Number(totalCost.toFixed(2)),
      totalRetail: Number(totalRetail.toFixed(2)),
      totalCostValue: Number(totalCost.toFixed(2)),
      totalRetailValue: Number(totalRetail.toFixed(2)),
      totalUnits,
      totalUnitsInStock: totalUnits,
      potentialProfit: Number(potentialProfit.toFixed(2)),
      lowStockCount,
      outOfStockCount,
      productCount: products.length,
      totalProducts: products.length,
    };
  }
}
