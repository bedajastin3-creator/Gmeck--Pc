import { db } from '../db/storage';
import { InventoryMovement, MovementType, User } from '../types';
import { generateUUID } from '../utils/crypto';

export class InventoryService {
  /**
   * Adjust stock manually for count correction, damage, loss, or physical inventory.
   * Admin OR Seller with canManageInventory permission.
   */
  public static adjustStock(
    productId: string,
    newQuantity: number,
    reason: string,
    currentUser: User,
    movementType: MovementType = 'ADJUSTMENT'
  ): { success: boolean; error?: string; lossValue?: number } {
    // FIX: Allow Admin OR Seller with canManageInventory permission
    if (currentUser.role !== 'ADMIN' && !currentUser.permissions?.canManageInventory) {
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
    const prevQty = prod.currentStock;
    const diff = newQuantity - prevQty;

    if (diff === 0) {
      return { success: true };
    }

    const shop = db.getShops().find(s => s.id === prod.shopId);
    const costValue = Number((Math.abs(diff) * (prod.purchasePrice || 0)).toFixed(2));

    products[prodIndex] = {
      ...prod,
      currentStock: newQuantity,
      updatedAt: new Date().toISOString(),
    };
    db.saveProducts(products);

    const movement: InventoryMovement = {
      id: generateUUID(),
      shopId: prod.shopId,
      shopName: shop?.name || 'Main Shop',
      productId: prod.id,
      productName: prod.name,
      previousQty: prevQty,
      changeQty: diff,
      newQty: newQuantity,
      type: movementType,
      costValue,
      reason: `${reason.trim()} [${shop?.name || 'Shop'}]`,
      userId: currentUser.id,
      userName: currentUser.name,
      createdAt: new Date().toISOString(),
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
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'STOCK_ADJUSTMENT',
      details: `Adjusted '${prod.name}' stock from ${prevQty} to ${newQuantity} (${movementType}: ${reason.trim()}, Cost Impact: $${costValue}) in [${shop?.name || 'Shop'}]`,
      entityType: 'INVENTORY',
      entityId: prod.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, lossValue: diff < 0 ? costValue : 0 };
  }

  /**
   * Receive fast stock-in.
   * Admin OR Seller with canManageInventory permission.
   */
  public static stockIn(
    productId: string,
    addQuantity: number,
    reason: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    // FIX: Allow Admin OR Seller with canManageInventory permission
    if (currentUser.role !== 'ADMIN' && !currentUser.permissions?.canManageInventory) {
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
    _currentUser?: User
  ): InventoryMovement[] {
    let list = db.getMovements();

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
          (m.shopName && m.shopName.toLowerCase().includes(q))
      );
    }
    return list;
  }

  public static getInventoryValuation(shopId?: string, _currentUser?: User) {
    let products = db.getProducts().filter(p => p.status === 'ACTIVE');
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
