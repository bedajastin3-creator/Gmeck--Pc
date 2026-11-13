import { db } from '../db/storage';
import { Shop, User, ShopStatus } from '../types';

export interface ShopFilterOptions {
  status?: 'ALL' | ShopStatus;
  search?: string;
}

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

  public static createShop(
    shopData: Omit<Shop, 'id' | 'createdAt' | 'updatedAt'>,
    createdBy: User
  ): { success: boolean; shop?: Shop; error?: string } {
    try {
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
        id: `audit-${Date.now()}`,
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
        id: `sync-${Date.now()}`,
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
        id: `audit-${Date.now()}`,
        userId: updatedBy.id,
        userName: updatedBy.name,
        action: 'UPDATE_SHOP',
        details: `Updated shop unit "${updatedShop.name}" details`,
        entityType: 'SHOP',
        entityId: updatedShop.id,
        timestamp: now,
      });

      db.enqueueSync({
        id: `sync-${Date.now()}`,
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
        id: `audit-${Date.now()}`,
        userId: updatedBy.id,
        userName: updatedBy.name,
        action: 'TOGGLE_SHOP_STATUS',
        details: `Changed shop "${updatedShop.name}" status from ${current.status} to ${newStatus}`,
        entityType: 'SHOP',
        entityId: updatedShop.id,
        timestamp: now,
      });

      db.enqueueSync({
        id: `sync-${Date.now()}`,
        operation: 'TOGGLE_SHOP_STATUS',
        entityType: 'SHOP',
        entityId: updatedShop.id,
        payload: { id, status: newStatus },
        status: 'PENDING',
        createdAt: now,
      });

      return { success: true, shop: updatedShop };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to toggle shop status' };
    }
  }

  /**
   * Admin deletes a shop permanently.
   * This also removes the shop from all users' assignedShopIds.
   */
  public static deleteShop(
    shopId: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Permission Denied: Only Admin can delete shops.' };
    }

    const shops = db.getShops();
    const shop = shops.find(s => s.id === shopId);
    
    if (!shop) {
      return { success: false, error: 'Shop not found.' };
    }

    // Remove shop from shops list
    const updatedShops = shops.filter(s => s.id !== shopId);
    db.saveShops(updatedShops);

    // Remove shopId from all users' assignedShopIds
    const users = db.getUsers();
    const updatedUsers = users.map(u => ({
      ...u,
      assignedShopIds: (u.assignedShopIds || []).filter(id => id !== shopId),
    }));
    db.saveUsers(updatedUsers);

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
      id: `sync-${Date.now()}`,
      operation: 'DELETE_SHOP',
      entityType: 'SHOP',
      entityId: shopId,
      payload: { id: shopId },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    // Audit log
    db.addAuditLog({
      id: `audit-${Date.now()}`,
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_SHOP',
      details: `Deleted shop: ${shop.name} (${shop.code || 'NO-CODE'})`,
      entityType: 'SHOP',
      entityId: shopId,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }
}
