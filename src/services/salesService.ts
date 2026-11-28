import { db } from '../db/storage';
import { Sale, SaleItem, PaymentMethod, User, SaleEditRequest } from '../types';
import { generateUUID } from '../utils/crypto';
import { generateReceiptNumber, formatDateTime } from '../utils/formatters';
import { NotificationService } from './notificationService';
import { CloudflareApi } from './cloudflareApi';
import { CloudOperation, SyncService } from './syncService';
import {
  canAccessShopAsAdmin,
  getShopAdminShopIds,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../utils/permissions';

export interface CartItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
}

export class SalesService {
  /**
   * Complete a new sale transaction for a specific shop.
   */
  public static async createSale(
    params: {
      shopId: string;
      items: CartItemInput[];
      paymentMethod: PaymentMethod;
      discount?: number;
      amountReceived: number;
      notes?: string;
      assistantName?: string;
      saleDate?: string;
    },
    currentUser: User
  ): Promise<{ success: boolean; sale?: Sale; error?: string }> {
    if (!params.shopId) {
      return { success: false, error: 'Shop identification is required to process sale.' };
    }

    const shop = db.getShops().find(s => s.id === params.shopId);
    if (!shop) {
      return { success: false, error: 'Selected shop does not exist.' };
    }

    if (shop.status !== 'ACTIVE') {
      return { success: false, error: `Shop "${shop.name}" is currently inactive. Sales cannot be recorded.` };
    }

    if (!params.items || params.items.length === 0) {
      return { success: false, error: 'Cart is empty. Please add items to complete sale.' };
    }

    const products = db.getProducts();
    const settings = db.getSettings();

    const saleItems: SaleItem[] = [];
    let subtotal = 0;
    let totalCostOfGoods = 0;

    for (const itemInput of params.items) {
      const product = products.find(p => p.id === itemInput.productId && p.shopId === params.shopId);
      if (!product) {
        return { success: false, error: `Product not found in ${shop.name} (ID: ${itemInput.productId})` };
      }

      if (product.status !== 'ACTIVE') {
        return { success: false, error: `Product '${product.name}' is inactive and cannot be sold.` };
      }

      if (product.currentStock < itemInput.quantity) {
        return {
          success: false,
          error: `Insufficient stock in ${shop.name} for '${product.name}'. Available: ${product.currentStock} ${product.unit}, Requested: ${itemInput.quantity}`,
        };
      }

      const itemTotal = itemInput.quantity * itemInput.unitPrice - (itemInput.discount || 0);
      subtotal += itemTotal;
      totalCostOfGoods += itemInput.quantity * product.purchasePrice;

      // 🔒 Snapshot the reference price at the exact moment of sale
      const referencePrice =
        product.proposedSellingPrice && product.proposedSellingPrice > 0
          ? product.proposedSellingPrice
          : product.sellingPrice || 0;
      const referenceType: 'PROPOSED' | 'SELLING' =
        product.proposedSellingPrice && product.proposedSellingPrice > 0
          ? 'PROPOSED'
          : 'SELLING';

      saleItems.push({
        id: generateUUID(),
        saleId: '',
        shopId: params.shopId,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unitPrice: itemInput.unitPrice,
        purchasePrice: product.purchasePrice,
        quantity: itemInput.quantity,
        discount: itemInput.discount || 0,
        total: Math.max(0, itemTotal),
        referencePrice,
        referenceType,
      });
    }

    const overallDiscount = params.discount || 0;
    const discountedSubtotal = Math.max(0, subtotal - overallDiscount);
    const taxAmount = 0;
    const finalTotal = Number(discountedSubtotal.toFixed(2));

    const safeAmountReceived =
      Number.isFinite(params.amountReceived) && params.amountReceived >= 0
        ? params.amountReceived
        : finalTotal;
    const change = 0;
    const grossProfit = Number((finalTotal - totalCostOfGoods).toFixed(2));

    const now = new Date();
    const localTodayYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const canBackdateSale =
      isPlatformAdmin(currentUser) || canAccessShopAsAdmin(currentUser, params.shopId);
    let txDate = now;
    if (
      canBackdateSale &&
      params.saleDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(params.saleDate) &&
      params.saleDate < localTodayYMD
    ) {
      const [year, month, day] = params.saleDate.split('-').map(Number);
      const candidate = new Date(
        year,
        month - 1,
        day,
        now.getHours(),
        now.getMinutes(),
        now.getSeconds(),
        now.getMilliseconds()
      );
      txDate =
        candidate.toISOString().slice(0, 10) === params.saleDate
          ? candidate
          : new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    }
    const txTimestamp = txDate.toISOString();
    const nowTimestamp = now.toISOString();

    const saleId = generateUUID();
    const receiptNumber = generateReceiptNumber();

    saleItems.forEach(item => {
      item.saleId = saleId;
    });

    const trimmedAssistantName = params.assistantName?.trim();

    const newSale: Sale = {
      id: saleId,
      receiptNumber,
      shopId: params.shopId,
      shopName: shop.name,
      sellerId: currentUser.id,
      sellerName: currentUser.name,
      ...(trimmedAssistantName ? { assistantName: trimmedAssistantName } : {}),
      subtotal: Number(subtotal.toFixed(2)),
      discount: Number(overallDiscount.toFixed(2)),
      tax: taxAmount,
      total: finalTotal,
      costOfGoods: Number(totalCostOfGoods.toFixed(2)),
      grossProfit,
      paymentMethod: params.paymentMethod,
      amountReceived: Number(safeAmountReceived.toFixed(2)),
      change,
      status: 'COMPLETED',
      notes: params.notes?.trim(),
      createdAt: txTimestamp,
      items: saleItems,
    };

    const updatedProducts = products.map(prod => {
      const soldItem = saleItems.find(si => si.productId === prod.id && prod.shopId === params.shopId);
      if (soldItem) {
        return {
          ...prod,
          currentStock: prod.currentStock - soldItem.quantity,
          updatedAt: nowTimestamp,
        };
      }
      return prod;
    });
    const newMovements = saleItems.map(item => {
      const prod = products.find(p => p.id === item.productId)!;
      return {
        id: generateUUID(),
        shopId: params.shopId,
        shopName: shop.name,
        productId: item.productId,
        productName: item.productName,
        previousQty: prod.currentStock,
        changeQty: -item.quantity,
        newQty: prod.currentStock - item.quantity,
        type: 'SALE' as const,
        reason: `Sale ${receiptNumber} (${currentUser.name}) [${shop.name}]`,
        referenceId: saleId,
        userId: currentUser.id,
        userName: currentUser.name,
        createdAt: txTimestamp,
      };
    });

    const commit = await SyncService.commitOperation({
      operation: 'CREATE_SALE',
      entityType: 'SALE',
      entityId: saleId,
      payload: newSale,
    });
    if (!commit.success) {
      return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    db.saveProducts(updatedProducts);
    db.saveMovements([...newMovements, ...db.getMovements()]);
    db.saveSales([newSale, ...db.getSales()]);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'CREATE_SALE',
      details: `Completed sale ${receiptNumber} in [${shop.name}] for ${settings.currencySymbol}${finalTotal.toFixed(2)} (${params.paymentMethod})`,
      entityType: 'SALE',
      entityId: saleId,
      timestamp: new Date().toISOString(),
    });

    saleItems.forEach(item => {
      const prod = products.find(p => p.id === item.productId);
      if (prod && prod.purchasePrice > 0 && item.unitPrice < prod.purchasePrice) {
        NotificationService.notifyBelowCostSale(prod, item.unitPrice, currentUser, shop.name, receiptNumber);
      }
    });

    return { success: true, sale: newSale };
  }

  /**
   * Void/Cancel a sale transaction.
   */
  public static async voidSale(
    saleId: string,
    voidReason: string,
    currentUser: User
  ): Promise<{ success: boolean; error?: string }> {
    const canVoid =
      isPlatformAdmin(currentUser) ||
      hasAdminAccess(currentUser) ||
      Boolean(currentUser.permissions?.canDeleteSales);
    if (!canVoid) {
      return { success: false, error: 'Permission Denied: Only Admin can void a sale.' };
    }

    if (!voidReason?.trim()) {
      return { success: false, error: 'A cancellation reason is required to void a sale.' };
    }

    const sales = db.getSales();
    const targetSale = sales.find(s => s.id === saleId);
    if (!targetSale) {
      return { success: false, error: 'Sale record not found.' };
    }

    if (!isPlatformAdmin(currentUser)) {
      const managedIds = getShopAdminShopIds(currentUser);
      const allowedIds =
        managedIds.length > 0 ? managedIds : currentUser.assignedShopIds || [];
      if (!allowedIds.includes(targetSale.shopId)) {
        return {
          success: false,
          error: 'Permission Denied: You can only void sales inside your managed shops.',
        };
      }
    }

    if (targetSale.status === 'VOIDED') {
      return { success: false, error: 'Sale has already been voided.' };
    }

    const nextProducts = [...db.getProducts()];
    const returnMovements = [];

    for (const item of targetSale.items) {
      const prodIndex = nextProducts.findIndex(p => p.id === item.productId && p.shopId === targetSale.shopId);
      if (prodIndex !== -1) {
        const prod = nextProducts[prodIndex];
        const prevQty = prod.currentStock;
        const newQty = prevQty + item.quantity;

        nextProducts[prodIndex] = {
          ...prod,
          currentStock: newQty,
          updatedAt: new Date().toISOString(),
        };

        returnMovements.push({
          id: generateUUID(),
          shopId: targetSale.shopId,
          shopName: targetSale.shopName,
          productId: prod.id,
          productName: prod.name,
          previousQty: prevQty,
          changeQty: item.quantity,
          newQty,
          type: 'VOID_RETURN' as const,
          reason: `Restocked from voided sale ${targetSale.receiptNumber}: ${voidReason.trim()}`,
          referenceId: saleId,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: new Date().toISOString(),
        });
      }
    }

    const commit = await SyncService.commitOperation({
      operation: 'VOID_SALE',
      entityType: 'SALE',
      entityId: saleId,
      payload: { saleId, voidReason, voidedBy: currentUser.name },
    });
    if (!commit.success) {
      return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    db.saveProducts(nextProducts);
    db.saveMovements([...returnMovements, ...db.getMovements()]);

    const updatedSales = sales.map(s =>
      s.id === saleId
        ? {
            ...s,
            status: 'VOIDED' as const,
            voidReason: voidReason.trim(),
            voidedAt: new Date().toISOString(),
            voidedBy: currentUser.name,
          }
        : s
    );
    db.saveSales(updatedSales);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'VOID_SALE',
      details: `Voided sale ${targetSale.receiptNumber} (${voidReason.trim()}) in [${targetSale.shopName || 'Shop'}]. Restored inventory.`,
      entityType: 'SALE',
      entityId: saleId,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  /**
   * Seller or Admin requests a sale edit
   */
  public static async requestSaleEdit(
    saleId: string,
    newItems: CartItemInput[],
    reason: string,
    currentUser: User
  ): Promise<{ success: boolean; error?: string; requiresApproval?: boolean }> {
    const sales = db.getSales();
    const sale = sales.find(s => s.id === saleId);

    if (!sale) {
      return { success: false, error: 'Sale not found.' };
    }

    if (sale.status === 'VOIDED') {
      return { success: false, error: 'Cannot edit a voided sale.' };
    }

    if (!newItems || newItems.length === 0) {
      return { success: false, error: 'Please provide at least one item.' };
    }

    const products = db.getProducts();
    let newSubtotal = 0;
    let newCostOfGoods = 0;

    const newSaleItems: SaleItem[] = newItems.map(itemInput => {
      const product = products.find(p => p.id === itemInput.productId);
      if (!product) {
        throw new Error(`Product not found: ${itemInput.productId}`);
      }

      const itemTotal = itemInput.quantity * itemInput.unitPrice - (itemInput.discount || 0);
      newSubtotal += itemTotal;
      newCostOfGoods += itemInput.quantity * product.purchasePrice;

      // 🔒 Snapshot the reference price at the moment of the edit
      const referencePrice =
        product.proposedSellingPrice && product.proposedSellingPrice > 0
          ? product.proposedSellingPrice
          : product.sellingPrice || 0;
      const referenceType: 'PROPOSED' | 'SELLING' =
        product.proposedSellingPrice && product.proposedSellingPrice > 0
          ? 'PROPOSED'
          : 'SELLING';

      return {
        id: generateUUID(),
        saleId: sale.id,
        shopId: sale.shopId,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unitPrice: itemInput.unitPrice,
        purchasePrice: product.purchasePrice,
        quantity: itemInput.quantity,
        discount: itemInput.discount || 0,
        total: Math.max(0, itemTotal),
        referencePrice,
        referenceType,
      };
    });

    const newTotal = Number((newSubtotal - sale.discount).toFixed(2));
    const newGrossProfit = Number((newTotal - newCostOfGoods).toFixed(2));

    const canApplyDirectly =
      isPlatformAdmin(currentUser) ||
      (isShopAdmin(currentUser) &&
        (getShopAdminShopIds(currentUser).includes(sale.shopId) ||
          Boolean(
            currentUser.permissions?.canManageShops &&
              (currentUser.assignedShopIds || []).includes(sale.shopId)
          ))) ||
      Boolean(currentUser.permissions?.canEditSales);

    if (canApplyDirectly) {
      return await this.applySaleEdit(sale, {
        items: newSaleItems,
        subtotal: Number(newSubtotal.toFixed(2)),
        total: newTotal,
        costOfGoods: Number(newCostOfGoods.toFixed(2)),
        grossProfit: newGrossProfit,
        amountReceived: newTotal,
        change: 0,
      }, currentUser, reason);
    }

    const editRequest: SaleEditRequest = {
      id: generateUUID(),
      saleId: sale.id,
      requestedByUserId: currentUser.id,
      requestedByName: currentUser.name,
      originalValues: {
        items: sale.items,
        total: sale.total,
        subtotal: sale.subtotal,
        grossProfit: sale.grossProfit,
        costOfGoods: sale.costOfGoods,
        amountReceived: sale.amountReceived,
        change: sale.change,
      },
      newValues: {
        items: newSaleItems,
        total: newTotal,
        subtotal: Number(newSubtotal.toFixed(2)),
        grossProfit: newGrossProfit,
        costOfGoods: Number(newCostOfGoods.toFixed(2)),
        amountReceived: newTotal,
        change: 0,
      },
      reason,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };

    const commit = await SyncService.commitOperation({
      operation: 'CREATE_SALE_EDIT_REQUEST',
      entityType: 'SALE_EDIT_REQUEST',
      entityId: editRequest.id,
      payload: editRequest,
    });
    if (!commit.success) {
      return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    const editRequests = db.getSaleEditRequests?.() || [];
    db.saveSaleEditRequests?.([editRequest, ...editRequests]);

    const admins = db.getUsers().filter(u => u.role === 'ADMIN');
    for (const admin of admins) {
      NotificationService.notifySaleEditRequested(editRequest, admin.id);
    }

    return { success: true, requiresApproval: true };
  }

  private static buildSaleEditMutation(
    sale: Sale,
    newValues: {
      items: SaleItem[];
      subtotal: number;
      total: number;
      costOfGoods: number;
      grossProfit: number;
      amountReceived: number;
      change: number;
    },
    currentUser: User,
    reason?: string
  ) {
    const products = db.getProducts();
    const sales = db.getSales();

    const updatedProducts = [...products];
    for (const oldItem of sale.items) {
      const prodIndex = updatedProducts.findIndex(p => p.id === oldItem.productId);
      if (prodIndex !== -1) {
        updatedProducts[prodIndex] = {
          ...updatedProducts[prodIndex],
          currentStock: updatedProducts[prodIndex].currentStock + oldItem.quantity,
          updatedAt: new Date().toISOString(),
        };
      }
    }

    for (const newItem of newValues.items) {
      const prodIndex = updatedProducts.findIndex(p => p.id === newItem.productId);
      if (prodIndex !== -1) {
        updatedProducts[prodIndex] = {
          ...updatedProducts[prodIndex],
          currentStock: updatedProducts[prodIndex].currentStock - newItem.quantity,
          updatedAt: new Date().toISOString(),
        };
      }
    }

    const updatedSales = [...sales];
    const saleIndex = updatedSales.findIndex(s => s.id === sale.id);
    let updatedSale: Sale | null = null;
    if (saleIndex !== -1) {
      const editNote = `\n[Edited by ${currentUser.name} at ${new Date().toISOString()}${reason ? ` - Reason: ${reason}` : ''}]`;
      updatedSale = {
        ...sale,
        items: newValues.items,
        subtotal: newValues.subtotal,
        total: newValues.total,
        costOfGoods: newValues.costOfGoods,
        grossProfit: newValues.grossProfit,
        amountReceived: newValues.amountReceived,
        change: newValues.change,
        notes: (sale.notes || '') + editNote,
      };
      updatedSales[saleIndex] = updatedSale;
    }

    return { updatedProducts, updatedSales, updatedSale };
  }

  /**
   * Apply sale edit (used by admin)
   */
  private static async applySaleEdit(
    sale: Sale,
    newValues: {
      items: SaleItem[];
      subtotal: number;
      total: number;
      costOfGoods: number;
      grossProfit: number;
      amountReceived: number;
      change: number;
    },
    currentUser: User,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> {
    const { updatedProducts, updatedSales, updatedSale } = this.buildSaleEditMutation(
      sale,
      newValues,
      currentUser,
      reason
    );

    if (updatedSale) {
      const commit = await SyncService.commitOperation({
        operation: 'UPDATE_SALE',
        entityType: 'SALE',
        entityId: sale.id,
        payload: updatedSale,
      });
      if (!commit.success) {
        return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
      }

      db.saveProducts(updatedProducts);
      db.saveSales(updatedSales);

      db.addAuditLog({
        id: generateUUID(),
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'EDIT_SALE',
        details: `Edited sale ${sale.receiptNumber}${reason ? ` - Reason: ${reason}` : ''}`,
        entityType: 'SALE',
        entityId: sale.id,
        timestamp: new Date().toISOString(),
      });
    }

    return { success: true };
  }

  /**
   * Approve or reject a sale edit request (admin only)
   */
  public static async reviewSaleEdit(
    requestId: string,
    action: 'APPROVE' | 'REJECT',
    currentUser: User,
    reviewNote?: string
  ): Promise<{ success: boolean; error?: string }> {
    const requests = db.getSaleEditRequests?.() || [];
    const request = requests.find(r => r.id === requestId);

    if (!request) {
      return { success: false, error: 'Edit request not found.' };
    }

    const saleForReq = db.getSales().find(s => s.id === request.saleId);
    const canReviewAsShopAdmin =
      isShopAdmin(currentUser) &&
      Boolean(saleForReq?.shopId) &&
      getShopAdminShopIds(currentUser).includes(saleForReq!.shopId);

    if (!isPlatformAdmin(currentUser) && !canReviewAsShopAdmin) {
      return { success: false, error: 'Only Platform Admin or designated Shop Admin can review sale edits.' };
    }

    if (request.status !== 'PENDING') {
      return { success: false, error: 'Request already reviewed.' };
    }

    const updatedRequests = requests.map(r =>
      r.id === requestId
        ? {
            ...r,
            status: action === 'APPROVE' ? ('APPROVED' as const) : ('REJECTED' as const),
            reviewedByUserId: currentUser.id,
            reviewedByName: currentUser.name,
            reviewNote,
            reviewedAt: new Date().toISOString(),
          }
        : r
    );
    const updatedRequest = updatedRequests.find(r => r.id === requestId);

    const ops: CloudOperation[] = [
      {
        operation: 'REVIEW_SALE_EDIT_REQUEST',
        entityType: 'SALE_EDIT_REQUEST',
        entityId: requestId,
        payload: {
          ...updatedRequest,
          id: requestId,
        },
      },
    ];

    let saleEditMutation: ReturnType<typeof SalesService.buildSaleEditMutation> | null = null;
    if (action === 'APPROVE') {
      const sale = db.getSales().find(s => s.id === request.saleId);
      if (!sale) {
        return { success: false, error: 'Sale not found.' };
      }
      saleEditMutation = this.buildSaleEditMutation(sale, request.newValues, currentUser, request.reason);
      if (saleEditMutation.updatedSale) {
        ops.push({
          operation: 'UPDATE_SALE',
          entityType: 'SALE',
          entityId: sale.id,
          payload: saleEditMutation.updatedSale,
        });
      }
    }

    const commit = await SyncService.commitOperations(ops);
    if (!commit.success) {
      return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    db.saveSaleEditRequests?.(updatedRequests);
    if (saleEditMutation && saleEditMutation.updatedSale) {
      db.saveProducts(saleEditMutation.updatedProducts);
      db.saveSales(saleEditMutation.updatedSales);
      db.addAuditLog({
        id: generateUUID(),
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'EDIT_SALE',
        details: `Edited sale ${saleForReq?.receiptNumber || request.saleId}${request.reason ? ` - Reason: ${request.reason}` : ''}`,
        entityType: 'SALE',
        entityId: request.saleId,
        timestamp: new Date().toISOString(),
      });
    }

    NotificationService.notifySaleEditReviewed(request, action, currentUser.name, reviewNote);

    return { success: true };
  }

  /**
   * Get sale edit requests
   */
  public static getSaleEditRequests(currentUser: User): SaleEditRequest[] {
    const requests = db.getSaleEditRequests?.() || [];

    if (!Array.isArray(requests)) {
      console.warn('getSaleEditRequests: not an array');
      return [];
    }

    if (isPlatformAdmin(currentUser)) {
      return requests;
    }

    if (isShopAdmin(currentUser) || currentUser.permissions?.canEditSales) {
      const managedIds = getShopAdminShopIds(currentUser);
      const allowedShopIds =
        managedIds.length > 0 ? managedIds : currentUser.assignedShopIds || [];
      const salesById = new Map(db.getSales().map(s => [s.id, s]));

      return requests.filter(r => {
        if (r.requestedByUserId === currentUser.id) return true;
        const sale = salesById.get(r.saleId);
        const shopId =
          sale?.shopId ||
          r.originalValues?.items?.[0]?.shopId ||
          r.newValues?.items?.[0]?.shopId;
        return Boolean(shopId && allowedShopIds.includes(shopId));
      });
    }

    return requests.filter(r => r.requestedByUserId === currentUser.id);
  }

  /**
   * Query sales.
   */
  public static getSales(
    options: {
      shopId?: string;
      sellerId?: string;
      search?: string;
      paymentMethod?: PaymentMethod | 'ALL';
      status?: 'ALL' | 'COMPLETED' | 'VOIDED';
      startDate?: string;
      endDate?: string;
    },
    currentUser: User
  ): Sale[] {
    let sales = db.getSales();

    // FIX: Ensure sales is always an array
    if (!Array.isArray(sales)) {
      console.warn('getSales: db.getSales() returned non-array');
      return [];
    }

    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    const canManageTeamSales =
      platformAdmin ||
      shopAdmin ||
      Boolean(currentUser.permissions?.canEditSales) ||
      Boolean(currentUser.permissions?.canDeleteSales);

    if (!canManageTeamSales) {
      sales = sales.filter(s => s.sellerId === currentUser.id);
    } else {
      if (!platformAdmin) {
        const managedIds = getShopAdminShopIds(currentUser);
        const allowedShopIds =
          managedIds.length > 0 ? managedIds : currentUser.assignedShopIds || [];
        sales = sales.filter(s => allowedShopIds.includes(s.shopId));
      }
      if (options.sellerId && options.sellerId !== 'ALL') {
        sales = sales.filter(s => s.sellerId === options.sellerId);
      }
    }

    if (options.shopId && options.shopId !== 'ALL') {
      sales = sales.filter(s => s.shopId === options.shopId);
    }

    if (options.status && options.status !== 'ALL') {
      sales = sales.filter(s => s.status === options.status);
    }

    if (options.paymentMethod && options.paymentMethod !== 'ALL') {
      sales = sales.filter(s => s.paymentMethod === options.paymentMethod);
    }

    if (options.search && options.search.trim()) {
      const q = options.search.toLowerCase().trim();
      sales = sales.filter(s => {
        const dateStr = formatDateTime(s.createdAt).toLowerCase();
        const isoDate = (s.createdAt || '').slice(0, 10).toLowerCase();
        return (
          s.receiptNumber.toLowerCase().includes(q) ||
          s.sellerName.toLowerCase().includes(q) ||
          (s.shopName && s.shopName.toLowerCase().includes(q)) ||
          (s.paymentMethod && s.paymentMethod.toLowerCase().includes(q)) ||
          (s.status && s.status.toLowerCase().includes(q)) ||
          String(s.total).includes(q) ||
          dateStr.includes(q) ||
          isoDate.includes(q) ||
          s.items.some(
            i =>
              i.productName.toLowerCase().includes(q) ||
              (i.sku && i.sku.toLowerCase().includes(q))
          )
        );
      });
    }

    if (options.startDate) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(options.startDate.trim());
      const startMs = m
        ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime()
        : new Date(options.startDate).getTime();
      if (!Number.isNaN(startMs)) {
        sales = sales.filter(s => new Date(s.createdAt).getTime() >= startMs);
      }
    }

    if (options.endDate) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(options.endDate.trim());
      const endMs = m
        ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999).getTime()
        : new Date(options.endDate).getTime() + 86400000;
      if (!Number.isNaN(endMs)) {
        sales = sales.filter(s => new Date(s.createdAt).getTime() <= endMs);
      }
    }

    return sales;
  }

  public static getSaleByReceipt(receiptNumber: string, currentUser: User): Sale | undefined {
    const sale = db.getSales().find(s => s.receiptNumber.toLowerCase() === receiptNumber.toLowerCase());
    if (!sale) return undefined;

    if (currentUser.role === 'SELLER' && sale.sellerId !== currentUser.id) {
      return undefined;
    }
    return sale;
  }
}
