import { db } from '../db/storage';
import { Shop, User, ShopStatus, SellerPermissions } from '../types';
import { generateUUID } from '../utils/crypto';
import { getShopAdminShopIds, isPlatformAdmin } from '../utils/permissions';

export interface ShopFilterOptions {
  status?: 'ALL' | ShopStatus;
  search?: string;
}

const SHOP_ADMIN_FULL_PERMISSIONS: Omit<SellerPermissions, 'shopAdminShopIds'> = {
  canEditProducts: true,
  canDeleteProducts: true,
  canViewExpenses: true,
  canRecordExpenses: true,
  canManageInventory: true,
  canEditSales: true,
  canDeleteSales: true,
  canManageDebts: true,
  canViewReports: true,
  canManageShops: true,
  canManageSellers: true,
  canRecordPurchases: true,
  canViewPurchases: true,
};

export class ShopService {
  public static getShops(options?: ShopFilterOptions | boolean): Shop[] {
    let all = db.getShops();

    if (typeof options === 'boolean') {
      return options ? all : all.filter(s => s.status === 'ACTIVE');
    }

    if (options) {
      if (options.status && options.status !== 'ALL') {
        all = all.filter(s => s.status === options.status);
      }
      if (options.search && options.search.trim()) {
        const q = options.search.trim().toLowerCase();
        all = all.filter(
          s =>
            s.name.toLowerCase().includes(q) ||
            (s.code && s.code.toLowerCase().includes(q)) ||
            (s.description && s.description.toLowerCase().includes(q))
        );
      }
    }

    return all;
  }

  public static getShopById(id: string): Shop | undefined {
    return db.getShops().find(s => s.id === id);
  }

  /**
   * Returns the active seller currently designated as Shop Admin for `shopId`.
   */
  public static getShopAdmin(shopId: string): User | undefined {
    if (!shopId) return undefined;
    const users = db.getUsers();
    return users.find(
      u =>
        u.role === 'SELLER' &&
        u.status === 'ACTIVE' &&
        getShopAdminShopIds(u).includes(shopId)
    );
  }

  /**
   * Checks whether `user` is permitted to edit/toggle the given shop.
   */
  public static canManageShop(user: User | null | undefined, shopId: string): boolean {
    if (!user) return false;
    if (isPlatformAdmin(user)) return true;
    if (user.role !== 'SELLER') return false;
    if (getShopAdminShopIds(user).includes(shopId)) return true;
    return Boolean(
      user.permissions?.canManageShops &&
        (user.assignedShopIds || []).includes(shopId)
    );
  }

  /**
   * Platform Admin designates, replaces, or removes the Shop Admin for a specific shop.
   */
  public static setShopAdmin(
    shopId: string,
    sellerIdToAssign: string | null,
    currentUser: User
  ): { success: boolean; error?: string } {
    try {
      if (!isPlatformAdmin(currentUser)) {
        return {
          success: false,
          error: 'Permission Denied: Only Platform Admin can assign or remove a Shop Admin.',
        };
      }

      const shops = db.getShops();
      const shop = shops.find(s => s.id === shopId);
      if (!shop) {
        return { success: false, error: 'Shop not found.' };
      }

      const users = db.getUsers();
      let targetSeller: User | undefined;

      if (sellerIdToAssign) {
        targetSeller = users.find(
          u => u.id === sellerIdToAssign && u.role === 'SELLER' && u.status === 'ACTIVE'
        );
        if (!targetSeller) {
          return {
            success: false,
            error: 'Selected seller was not found or is inactive.',
          };
        }
        if (!(targetSeller.assignedShopIds || []).includes(shopId)) {
          return {
            success: false,
            error: `${targetSeller.name} is not assigned to ${shop.name}.`,
          };
        }
      }

      const now = new Date().toISOString();
      const modifiedUsers: User[] = [];

      const updatedUsers = users.map(u => {
        if (u.role !== 'SELLER') return u;

        const currentManagedIds = getShopAdminShopIds(u);
        const wasAdminOfThisShop = currentManagedIds.includes(shopId);
        const isTarget = Boolean(sellerIdToAssign && u.id === sellerIdToAssign);

        if (!wasAdminOfThisShop && !isTarget) {
          return u;
        }

        if (isTarget) {
          const nextManagedIds = Array.from(new Set([...currentManagedIds, shopId]));
          const nextPermissions: SellerPermissions = {
            ...(u.permissions || {}),
            ...SHOP_ADMIN_FULL_PERMISSIONS,
            shopAdminShopIds: nextManagedIds,
          };
          const updated: User = {
            ...u,
            shopAdminShopIds: nextManagedIds,
            permissions: nextPermissions,
            updatedAt: now,
          };
          modifiedUsers.push(updated);
          return updated;
        }

        // Remove shopId from previous Shop Admin of this shop
        const remainingIds = currentManagedIds.filter(id => id !== shopId);
        const prevPerms = { ...(u.permissions || {}) };
        if (remainingIds.length === 0) {
          // Revoke Shop Admin scoped flags when seller no longer manages any shop
          delete prevPerms.shopAdminShopIds;
          const resetPerms: SellerPermissions = {
            ...prevPerms,
            canEditProducts: false,
            canDeleteProducts: false,
            canViewExpenses: false,
            canRecordExpenses: false,
            canManageInventory: false,
            canEditSales: false,
            canDeleteSales: false,
            canManageDebts: false,
            canViewReports: false,
            canManageShops: false,
            canManageSellers: false,
            canRecordPurchases: false,
            canViewPurchases: false,
          };
          const updated: User = {
            ...u,
            shopAdminShopIds: [],
            permissions: resetPerms,
            updatedAt: now,
          };
          modifiedUsers.push(updated);
          return updated;
        }

        const updated: User = {
          ...u,
          shopAdminShopIds: remainingIds,
          permissions: {
            ...prevPerms,
            shopAdminShopIds: remainingIds,
          },
          updatedAt: now,
        };
        modifiedUsers.push(updated);
        return updated;
      });

      db.saveUsers(updatedUsers);

      // Enqueue sync for all updated sellers
      modifiedUsers.forEach(seller => {
        db.enqueueSync({
          id: generateUUID(),
          operation: 'UPDATE_SELLER',
          entityType: 'SELLER',
          entityId: seller.id,
          payload: {
            id: seller.id,
            username: seller.username,
            name: seller.name,
            role: seller.role,
            passwordHash: seller.passwordHash,
            color: seller.color,
            status: seller.status,
            assignedShopIds: seller.assignedShopIds,
            avatarUrl: seller.avatarUrl || null,
            permissions: seller.permissions || {},
            createdAt: seller.createdAt,
            updatedAt: seller.updatedAt,
          },
          status: 'PENDING',
          createdAt: now,
        });
      });

      db.addAuditLog({
        id: generateUUID(),
        userId: currentUser.id,
        userName: currentUser.name,
        action: targetSeller ? 'SET_SHOP_ADMIN' : 'REMOVE_SHOP_ADMIN',
        details: targetSeller
          ? `Assigned ${targetSeller.name} (@${targetSeller.username}) as Shop Admin for "${shop.name}"`
          : `Removed Shop Admin role from shop "${shop.name}"`,
        entityType: 'SHOP',
        entityId: shopId,
        shopId,
        timestamp: now,
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update Shop Admin.' };
    }
  }

  public static createShop(
    shopData: Omit<Shop, 'id' | 'createdAt' | 'updatedAt'>,
    createdBy: User
  ): { success: boolean; shop?: Shop; error?: string } {
    try {
      if (!isPlatformAdmin(createdBy)) {
        return { success: false, error: 'Permission Denied: Only Platform Admin can create shops.' };
      }

      const shops = db.getShops();

      const normalizedName = shopData.name.trim();
      if (!normalizedName) {
        return { success: false, error: 'Shop name is required.' };
      }

      const existing = shops.find(
        s => s.name.toLowerCase() === normalizedName.toLowerCase()
      );
      if (existing) {
        return { success: false, error: `A shop with the name "${normalizedName}" already exists.` };
      }

      const id = `shop-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      const now = new Date().toISOString();

      const newShop: Shop = {
        ...shopData,
        id,
        name: normalizedName,
        code: shopData.code ? shopData.code.trim().toUpperCase() : normalizedName.substring(0, 4).toUpperCase(),
        status: shopData.status || 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      };

      const updatedShops = [...shops, newShop];
      db.saveShops(updatedShops);

      // Auto-assign this shop to Admin accounts
      const users = db.getUsers();
      const updatedUsers = users.map(u => {
        if (u.role === 'ADMIN') {
          const assigned = u.assignedShopIds || [];
          if (!assigned.includes(id)) {
            return { ...u, assignedShopIds: [...assigned, id] };
          }
        }
        return u;
      });
      db.saveUsers(updatedUsers);

      // Audit log
      db.addAuditLog({
        id: generateUUID(),
        userId: createdBy.id,
        userName: createdBy.name,
        action: 'CREATE_SHOP',
        details: `Created shop unit "${newShop.name}" (${newShop.code || 'NO-CODE'}) with status ${newShop.status}`,
        entityType: 'SHOP',
        entityId: newShop.id,
        timestamp: now,
      });

      // Enqueue sync item
      db.enqueueSync({
        id: generateUUID(),
        operation: 'CREATE_SHOP',
        entityType: 'SHOP',
        entityId: newShop.id,
        payload: newShop,
        status: 'PENDING',
        createdAt: now,
      });

      return { success: true, shop: newShop };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to create shop' };
    }
  }

  public static updateShop(
    id: string,
    updates: Partial<Omit<Shop, 'id' | 'createdAt' | 'updatedAt'>>,
    updatedBy: User
  ): { success: boolean; shop?: Shop; error?: string } {
    try {
      if (!ShopService.canManageShop(updatedBy, id)) {
        return { success: false, error: 'Permission Denied: You do not have access to update this shop.' };
      }

      const shops = db.getShops();
      const index = shops.findIndex(s => s.id === id);
      if (index === -1) {
        return { success: false, error: 'Shop not found.' };
      }

      const current = shops[index];

      if (updates.name) {
        const normalizedName = updates.name.trim();
        const existing = shops.find(
          s => s.id !== id && s.name.toLowerCase() === normalizedName.toLowerCase()
        );
        if (existing) {
          return { success: false, error: `Another shop with the name "${normalizedName}" already exists.` };
        }
        updates.name = normalizedName;
      }

      const now = new Date().toISOString();
      const updatedShop: Shop = {
        ...current,
        ...updates,
        updatedAt: now,
      };

      shops[index] = updatedShop;
      db.saveShops([...shops]);

      // Audit log
      db.addAuditLog({
        id: generateUUID(),
        userId: updatedBy.id,
        userName: updatedBy.name,
        action: 'UPDATE_SHOP',
        details: `Updated shop unit "${updatedShop.name}" details`,
        entityType: 'SHOP',
        entityId: updatedShop.id,
        timestamp: now,
      });

      db.enqueueSync({
        id: generateUUID(),
        operation: 'UPDATE_SHOP',
        entityType: 'SHOP',
        entityId: updatedShop.id,
        payload: updatedShop,
        status: 'PENDING',
        createdAt: now,
      });

      return { success: true, shop: updatedShop };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to update shop' };
    }
  }

  public static toggleShopStatus(
    id: string,
    newStatus: ShopStatus,
    updatedBy: User
  ): { success: boolean; shop?: Shop; error?: string } {
    try {
      if (!ShopService.canManageShop(updatedBy, id)) {
        return { success: false, error: 'Permission Denied: You do not have access to change this shop status.' };
      }

      const shops = db.getShops();
      const index = shops.findIndex(s => s.id === id);
      if (index === -1) {
        return { success: false, error: 'Shop not found.' };
      }

      const current = shops[index];
      const now = new Date().toISOString();

      const updatedShop: Shop = {
        ...current,
        status: newStatus,
        updatedAt: now,
      };

      shops[index] = updatedShop;
      db.saveShops([...shops]);

      db.addAuditLog({
        id: generateUUID(),
        userId: updatedBy.id,
        userName: updatedBy.name,
        action: 'TOGGLE_SHOP_STATUS',
        details: `Changed shop "${updatedShop.name}" status from ${current.status} to ${newStatus}`,
        entityType: 'SHOP',
        entityId: updatedShop.id,
        timestamp: now,
      });

      db.enqueueSync({
        id: generateUUID(),
        operation: 'TOGGLE_SHOP_STATUS',
        entityType: 'SHOP',
        entityId: updatedShop.id,
        payload: { ...updatedShop, status: newStatus },
        status: 'PENDING',
        createdAt: now,
      });

      return { success: true, shop: updatedShop };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to toggle shop status' };
    }
  }

  /**
   * Platform Admin deletes a shop permanently.
   * Removes the shop from users' assignedShopIds / shopAdminShopIds, stores, products, and categories.
   */
  public static deleteShop(
    shopId: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (!isPlatformAdmin(currentUser)) {
      return { success: false, error: 'Permission Denied: Only Platform Admin can delete shops.' };
    }

    const shops = db.getShops();
    const shop = shops.find(s => s.id === shopId);

    if (!shop) {
      return { success: false, error: 'Shop not found.' };
    }

    const now = new Date().toISOString();

    // Remove shop from shops list
    const updatedShops = shops.filter(s => s.id !== shopId);
    db.saveShops(updatedShops);

    // Remove shopId from all users' assignedShopIds & shopAdminShopIds
    const users = db.getUsers();
    const updatedUsers = users.map(u => {
      const nextAssigned = (u.assignedShopIds || []).filter(id => id !== shopId);
      const nextShopAdmin = getShopAdminShopIds(u).filter(id => id !== shopId);
      const nextPermissions: SellerPermissions | undefined = u.permissions
        ? {
            ...u.permissions,
            ...(u.permissions.shopAdminShopIds
              ? { shopAdminShopIds: nextShopAdmin }
              : {}),
          }
        : undefined;
      return {
        ...u,
        assignedShopIds: nextAssigned,
        ...(u.shopAdminShopIds ? { shopAdminShopIds: nextShopAdmin } : {}),
        ...(nextPermissions ? { permissions: nextPermissions } : {}),
      };
    });
    db.saveUsers(updatedUsers);

    // Remove stores belonging to this shop
    const stores = db.getStores?.() || [];
    const updatedStores = stores.filter(st => st.shopId !== shopId);
    if (db.saveStores) {
      db.saveStores(updatedStores);
    }

    // Remove products in this shop
    const products = db.getProducts();
    const updatedProducts = products.filter(p => p.shopId !== shopId);
    db.saveProducts(updatedProducts);

    // Remove categories in this shop
    const categories = db.getCategories?.() || [];
    const updatedCategories = categories.filter(c => c.shopId !== shopId);
    if (db.saveCategories) {
      db.saveCategories(updatedCategories);
    }

    // Sync to cloud
    db.enqueueSync({
      id: generateUUID(),
      operation: 'DELETE_SHOP',
      entityType: 'SHOP',
      entityId: shopId,
      payload: { id: shopId },
      status: 'PENDING',
      createdAt: now,
    });

    // Audit log
    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_SHOP',
      details: `Deleted shop: ${shop.name} (${shop.code || 'NO-CODE'})`,
      entityType: 'SHOP',
      entityId: shopId,
      timestamp: now,
    });

    return { success: true };
  }
}
