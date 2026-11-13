import { db } from '../db/storage';
import { AppNotification, NotificationType, NotificationCategory, User, Product } from '../types';
import { DebtService } from './debtService';

export class NotificationService {
  private static getTodayStr(): string {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  private static getTomorrowStr(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Run local generation routine for automatic debt and stock reminders.
   */
  public static syncAutomaticNotifications(): void {
    const todayStr = this.getTodayStr();
    const tomorrowStr = this.getTomorrowStr();
    const debts = DebtService.getAllDebts();
    const products = db.getProducts();
    const shops = db.getShops();
    const existingNotifications = db.getNotifications();

    const newNotifications: AppNotification[] = [];

    // 1. Process Debts
    debts.forEach(debt => {
      if (debt.status === 'PAID' || debt.status === 'CANCELLED' || debt.status === 'ARCHIVED') {
        return;
      }

      if (!debt.dueDate) return;

      const due = debt.dueDate.slice(0, 10);
      const desc = debt.productDescription || 'bidhaa';
      const remaining = debt.remainingAmount !== undefined ? debt.remainingAmount : debt.amount;
      if (remaining <= 0) return;

      const remainingStr = remaining.toLocaleString();
      const isPartial = (debt.paidAmount || 0) > 0;
      const amtDisplay = isPartial ? `salio la Sh ${remainingStr} (Jumla: Sh ${debt.amount.toLocaleString()})` : `Sh ${remainingStr}`;

      const shopName = debt.shopId ? (shops.find(s => s.id === debt.shopId)?.name || 'Duka') : undefined;

      if (due === tomorrowStr) {
        if (debt.type === 'WE_DEMAND') {
          const contactMsg = debt.contact ? ` Simu: ${debt.contact}.` : '';
          const msg = `Kesho ni siku ya ${debt.debtorName} kulipa deni la ${desc} ${amtDisplay}.${contactMsg}`;
          const id = `notif-debt-up-cust-${debt.id}-${todayStr}`;
          
          if (!existingNotifications.some(n => n.id === id)) {
            newNotifications.push({
              id,
              type: 'DEBT_UPCOMING_CUSTOMER',
              category: 'INFO',
              title: `Malipo ya Kesho: ${debt.debtorName}`,
              message: msg,
              isGlobal: false,
              targetShopId: debt.shopId,
              targetShopName: shopName,
              targetUserIds: debt.createdByUserId ? [debt.createdByUserId] : undefined,
              targetRole: 'ALL',
              relatedEntityId: debt.id,
              relatedEntityType: 'DEBT',
              createdAt: new Date().toISOString(),
              readByUserIds: [],
            });
          }
        } else {
          const msg = `Kesho ni siku ya kulipa ${debt.debtorName} pesa ya ${desc} ${amtDisplay}.`;
          const id = `notif-debt-up-comp-${debt.id}-${todayStr}`;
          
          if (!existingNotifications.some(n => n.id === id)) {
            newNotifications.push({
              id,
              type: 'DEBT_UPCOMING_COMPANY',
              category: 'WARNING',
              title: `Malipo Yetu Kesho: ${debt.debtorName}`,
              message: msg,
              isGlobal: false,
              targetShopId: debt.shopId,
              targetShopName: shopName,
              targetUserIds: debt.createdByUserId ? [debt.createdByUserId] : undefined,
              targetRole: 'ALL',
              relatedEntityId: debt.id,
              relatedEntityType: 'DEBT',
              createdAt: new Date().toISOString(),
              readByUserIds: [],
            });
          }
        }
      }

      if (due < todayStr) {
        const days = Math.max(1, DebtService.getOverdueDays(debt.dueDate, todayStr));

        if (debt.type === 'WE_DEMAND') {
          const msg = `${debt.debtorName} kachelewa kulipa ${amtDisplay} ya ${desc}. Zimepita siku ${days}.`;
          const id = `notif-debt-over-cust-${debt.id}-${todayStr}`;

          if (!existingNotifications.some(n => n.id === id)) {
            newNotifications.push({
              id,
              type: 'DEBT_OVERDUE_CUSTOMER',
              category: days > 7 ? 'CRITICAL' : 'WARNING',
              title: `Deni Limechelewa: ${debt.debtorName}`,
              message: msg,
              isGlobal: false,
              targetShopId: debt.shopId,
              targetShopName: shopName,
              targetUserIds: debt.createdByUserId ? [debt.createdByUserId] : undefined,
              targetRole: 'ALL',
              relatedEntityId: debt.id,
              relatedEntityType: 'DEBT',
              createdAt: new Date().toISOString(),
              readByUserIds: [],
            });
          }
        } else {
          const msg = `Malipo ya ${desc} kwa ${debt.debtorName} (${amtDisplay}) yamechelewa. Zimepita siku ${days}.`;
          const id = `notif-debt-over-comp-${debt.id}-${todayStr}`;

          if (!existingNotifications.some(n => n.id === id)) {
            newNotifications.push({
              id,
              type: 'DEBT_OVERDUE_COMPANY',
              category: 'CRITICAL',
              title: `Malipo Yamechelewa: ${debt.debtorName}`,
              message: msg,
              isGlobal: false,
              targetShopId: debt.shopId,
              targetShopName: shopName,
              targetUserIds: debt.createdByUserId ? [debt.createdByUserId] : undefined,
              targetRole: 'ALL',
              relatedEntityId: debt.id,
              relatedEntityType: 'DEBT',
              createdAt: new Date().toISOString(),
              readByUserIds: [],
            });
          }
        }
      }
    });

    // 2. Process Shop-specific stock alerts
    products.forEach(product => {
      if (product.status !== 'ACTIVE') return;

      const shop = shops.find(s => s.id === product.shopId);
      const shopName = shop?.name || 'Shop';

      if (product.currentStock <= 0) {
        const msg = `${product.name} zimeisha kabisa.`;
        const id = `notif-stock-out-${product.id}-${todayStr}`;

        if (!existingNotifications.some(n => n.id === id)) {
          newNotifications.push({
            id,
            type: 'STOCK_OUT',
            category: 'CRITICAL',
            title: `Bidhaa Imeisha: ${product.name}`,
            message: msg,
            isGlobal: false,
            targetShopId: product.shopId,
            targetShopName: shopName,
            targetRole: 'ALL',
            relatedEntityId: product.id,
            relatedEntityType: 'PRODUCT',
            createdAt: new Date().toISOString(),
            readByUserIds: [],
          });
        }
      } else if (product.currentStock <= product.minStock) {
        const msg = `${product.name} zimekaribia kuisha — zimebaki ${product.currentStock}.`;
        const id = `notif-stock-low-${product.id}-${todayStr}`;

        if (!existingNotifications.some(n => n.id === id)) {
          newNotifications.push({
            id,
            type: 'STOCK_LOW',
            category: 'WARNING',
            title: `Akiba Chini: ${product.name}`,
            message: msg,
            isGlobal: false,
            targetShopId: product.shopId,
            targetShopName: shopName,
            targetRole: 'ALL',
            relatedEntityId: product.id,
            relatedEntityType: 'PRODUCT',
            createdAt: new Date().toISOString(),
            readByUserIds: [],
          });
        }
      }
    });

    if (newNotifications.length > 0) {
      const merged = [...newNotifications, ...existingNotifications].slice(0, 300);
      db.saveNotifications(merged);
    }
  }

  /**
   * Broadcast a price change event to shop sellers and generate admin confirmation
   */
  public static broadcastPriceChange(product: Product, oldPrice: number, newPrice: number): void {
    if (oldPrice === newPrice) return;

    const shops = db.getShops();
    const targetShop = shops.find(s => s.id === product.shopId);
    const shopName = targetShop?.name || 'Duka';
    const now = new Date().toISOString();

    const sellerNotif: AppNotification = {
      id: `notif-price-seller-${product.id}-${Date.now()}`,
      type: 'PRICE_CHANGE_SELLER',
      category: 'INFO',
      title: `Mabadiliko ya Bei: ${product.name}`,
      message: `${product.name} zimebadilishwa bei sasa zitauzwa Sh ${newPrice.toLocaleString()}.`,
      isGlobal: false,
      targetShopId: product.shopId,
      targetShopName: shopName,
      targetRole: 'SELLER',
      relatedEntityId: product.id,
      relatedEntityType: 'PRODUCT',
      createdAt: now,
      readByUserIds: [],
    };

    const adminNotif: AppNotification = {
      id: `notif-price-admin-${product.id}-${Date.now()}`,
      type: 'PRICE_CHANGE_ADMIN',
      category: 'SUCCESS',
      title: `Taarifa ya Bei Imetumwa (${shopName})`,
      message: `Taarifa imetumwa kwa wauzaji wa ${shopName} juu ya mabadiliko ya bei ya ${product.name}.`,
      isGlobal: false,
      targetShopId: product.shopId,
      targetShopName: shopName,
      targetRole: 'ADMIN',
      relatedEntityId: product.id,
      relatedEntityType: 'PRODUCT',
      createdAt: now,
      readByUserIds: [],
    };

    db.addNotification(sellerNotif);
    db.addNotification(adminNotif);
  }

  /**
   * Notify Admin and Sellers when a product is sold below purchase/cost price
   */
  public static notifyBelowCostSale(
    product: Product,
    soldPrice: number,
    sellerUser: User,
    shopName: string,
    receiptNumber: string
  ): void {
    const now = new Date().toISOString();
    const currency = db.getSettings().currencySymbol;
    const lossPerUnit = product.purchasePrice - soldPrice;

    const notif: AppNotification = {
      id: `notif-loss-sale-${product.id}-${Date.now()}`,
      type: 'STOCK_LOW_ADMIN',
      category: 'WARNING',
      title: `Onyo la Mauzo Chini ya Gharama: ${product.name}`,
      message: `Bidhaa ya ${product.name} imeuzwa kwa ${currency} ${soldPrice.toLocaleString()} (Chini ya bei ya ununuzi ya ${currency} ${product.purchasePrice.toLocaleString()}, Hasara: ${currency} ${lossPerUnit.toLocaleString()}/unit). Muuzaji: ${sellerUser.name}, Risiti: #${receiptNumber} [${shopName}].`,
      isGlobal: true,
      targetShopId: product.shopId,
      targetShopName: shopName,
      relatedEntityId: product.id,
      relatedEntityType: 'PRODUCT',
      createdAt: now,
      readByUserIds: [],
    };

    db.addNotification(notif);
  }

  /**
   * FIX: Notify admins when a seller requests a sale edit
   */
  public static notifySaleEditRequested(request: any, adminUserId: string): void {
    const notification: AppNotification = {
      id: `notif-sale-edit-req-${request.id}`,
      type: 'SALE_EDIT_REQUESTED',
      category: 'WARNING',
      title: 'Ombi la Marekebisho ya Mauzo',
      message: `${request.requestedByName} ameomba kuhariri mauzo. Sababu: ${request.reason}`,
      isGlobal: false,
      targetUserIds: [adminUserId],
      targetRole: 'ADMIN',
      relatedEntityId: request.id,
      relatedEntityType: 'SALE_EDIT_REQUEST',
      createdAt: new Date().toISOString(),
      readByUserIds: [],
    };

    db.addNotification(notification);
  }

  /**
   * FIX: Notify seller when their sale edit request is reviewed
   */
  public static notifySaleEditReviewed(
    request: any,
    action: 'APPROVE' | 'REJECT',
    adminName: string,
    reviewNote?: string
  ): void {
    const isApproved = action === 'APPROVE';
    
    const notification: AppNotification = {
      id: `notif-sale-edit-review-${request.id}-${Date.now()}`,
      type: isApproved ? 'SALE_EDIT_APPROVED' : 'SALE_EDIT_REJECTED',
      category: isApproved ? 'SUCCESS' : 'WARNING',
      title: isApproved ? 'Ombi Lako Limekubaliwa' : 'Ombi Lako Limekataliwa',
      message: isApproved 
        ? `Ombi lako la kuhariri mauzo limekubaliwa na ${adminName}.`
        : `Ombi lako la kuhariri mauzo limekataliwa na ${adminName}.${reviewNote ? ` Sababu: ${reviewNote}` : ''}`,
      isGlobal: false,
      targetUserIds: [request.requestedByUserId],
      targetRole: 'SELLER',
      relatedEntityId: request.id,
      relatedEntityType: 'SALE_EDIT_REQUEST',
      createdAt: new Date().toISOString(),
      readByUserIds: [],
    };

    db.addNotification(notification);
  }

  /**
   * Get notifications visible to the currently logged in user based on role and shop assignments
   */
  public static getUserNotifications(user: User | null): AppNotification[] {
    if (!user) return [];

    const all = db.getNotifications();

    return all.filter(n => {
      if (n.isGlobal) return true;

      if (user.role === 'ADMIN') {
        if (n.targetRole === 'SELLER') return false;
        return true;
      }

      if (n.targetRole === 'ADMIN') return false;

      if (n.targetUserIds && n.targetUserIds.length > 0) {
        if (n.targetUserIds.includes(user.id)) return true;
        if (n.relatedEntityType === 'DEBT') {
          if (n.targetShopId && user.assignedShopIds?.includes(n.targetShopId)) {
            return true;
          }
          return false;
        }
      }

      if (n.targetShopId) {
        const assigned = user.assignedShopIds || [];
        return assigned.includes(n.targetShopId);
      }

      if (n.relatedEntityType === 'DEBT') {
        return false;
      }

      return true;
    });
  }

  /**
   * Get unread notification count for user
   */
  public static getUnreadCount(user: User | null): number {
    if (!user) return 0;
    const userNotifs = this.getUserNotifications(user);
    return userNotifs.filter(n => !(n.readByUserIds || []).includes(user.id)).length;
  }

  /**
   * Mark a notification as read
   */
  public static markAsRead(notificationId: string, user: User): void {
    db.markNotificationAsRead(notificationId, user.id);
  }

  /**
   * Mark all notifications as read for current user
   */
  public static markAllAsRead(user: User): void {
    db.markAllNotificationsAsRead(user.id);
  }
}
