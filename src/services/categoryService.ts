import { db } from '../db/storage';
import { Category, Shop, User } from '../types';
import { generateUUID } from '../utils/crypto';

export interface GetCategoriesOptions {
  shopId?: string;
  activeOnly?: boolean;
}

export interface ShopCategoryGroup {
  shop: Shop;
  categories: Category[];
}

export class CategoryService {
  /**
   * Retrieve categories with optional shop filtering and active-only filtering
   */
  public static getCategories(optionsOrActiveOnly?: GetCategoriesOptions | boolean): Category[] {
    const cats = db.getCategories();
    let shopId: string | undefined;
    let activeOnly = false;

    if (typeof optionsOrActiveOnly === 'boolean') {
      activeOnly = optionsOrActiveOnly;
    } else if (optionsOrActiveOnly) {
      shopId = optionsOrActiveOnly.shopId;
      activeOnly = !!optionsOrActiveOnly.activeOnly;
    }

    return cats.filter(c => {
      if (activeOnly && c.status === 'INACTIVE') return false;
      if (shopId && shopId !== 'ALL' && c.shopId !== shopId) return false;
      return true;
    });
  }

  /**
   * Retrieve categories grouped by shop for display in admin panels
   */
  public static getCategoriesGroupedByShop(activeOnly = false): ShopCategoryGroup[] {
    const shops = db.getShops();
    const categories = this.getCategories({ activeOnly });

    return shops.map(shop => ({
      shop,
      categories: categories.filter(c => c.shopId === shop.id),
    }));
  }

  /**
   * Create a new category assigned strictly to a specific shop
   * Admin OR Seller with canEditProducts permission
   */
  public static createCategory(
    data: { name: string; shopId: string; icon?: string; color?: string },
    currentUser: User
  ): { success: boolean; category?: Category; error?: string } {
    // FIX: Allow Admin OR Seller with canEditProducts permission
    if (currentUser.role !== 'ADMIN' && !currentUser.permissions?.canEditProducts) {
      return { success: false, error: 'Permission Denied: You do not have permission to create categories.' };
    }

    if (!data.name.trim()) {
      return { success: false, error: 'Category name is required.' };
    }

    if (!data.shopId || !data.shopId.trim()) {
      return { success: false, error: 'Every category must be assigned to a specific shop.' };
    }

    const shops = db.getShops();
    const targetShop = shops.find(s => s.id === data.shopId.trim());
    if (!targetShop) {
      return { success: false, error: 'Selected shop does not exist.' };
    }

    const categories = db.getCategories();
    const duplicateInShop = categories.some(
      c => c.shopId === targetShop.id && c.name.toLowerCase() === data.name.trim().toLowerCase()
    );

    if (duplicateInShop) {
      return {
        success: false,
        error: `A category named '${data.name.trim()}' already exists in ${targetShop.name}.`,
      };
    }

    const newCategory: Category = {
      id: `cat-${generateUUID().slice(0, 8)}`,
      shopId: targetShop.id,
      name: data.name.trim(),
      icon: data.icon || 'Package',
      color: data.color || '#3b82f6',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.saveCategories([...categories, newCategory]);

    // Enqueue sync operation for category creation
    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_CATEGORY',
      entityType: 'CATEGORY',
      entityId: newCategory.id,
      payload: newCategory,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'CREATE_CATEGORY',
      details: `Created category '${newCategory.name}' for shop '${targetShop.name}' (${targetShop.code || 'UNIT'})`,
      entityType: 'SETTINGS',
      entityId: newCategory.id,
      shopId: targetShop.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, category: newCategory };
  }

  /**
   * Update an existing category
   * Admin OR Seller with canEditProducts permission
   */
  public static updateCategory(
    id: string,
    data: { name?: string; shopId?: string; icon?: string; color?: string; status?: 'ACTIVE' | 'INACTIVE' },
    currentUser: User
  ): { success: boolean; category?: Category; error?: string } {
    // FIX: Allow Admin OR Seller with canEditProducts permission
    if (currentUser.role !== 'ADMIN' && !currentUser.permissions?.canEditProducts) {
      return { success: false, error: 'Permission Denied: You do not have permission to edit categories.' };
    }

    const categories = db.getCategories();
    const index = categories.findIndex(c => c.id === id);
    if (index === -1) {
      return { success: false, error: 'Category not found.' };
    }

    const current = categories[index];
    const targetShopId = data.shopId || current.shopId;
    const targetName = data.name !== undefined ? data.name.trim() : current.name;

    if (!targetName) {
      return { success: false, error: 'Category name cannot be empty.' };
    }

    const duplicate = categories.some(
      c => c.id !== id && c.shopId === targetShopId && c.name.toLowerCase() === targetName.toLowerCase()
    );

    if (duplicate) {
      const shops = db.getShops();
      const shop = shops.find(s => s.id === targetShopId);
      return {
        success: false,
        error: `Another category named '${targetName}' already exists in ${shop ? shop.name : 'this shop'}.`,
      };
    }

    const updatedCategory: Category = {
      ...current,
      ...data,
      shopId: targetShopId,
      name: targetName,
      updatedAt: new Date().toISOString(),
    };

    categories[index] = updatedCategory;
    db.saveCategories([...categories]);

    // Enqueue sync operation for category update
    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_CATEGORY',
      entityType: 'CATEGORY',
      entityId: updatedCategory.id,
      payload: updatedCategory,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    const shops = db.getShops();
    const shop = shops.find(s => s.id === updatedCategory.shopId);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_CATEGORY',
      details: `Updated category '${updatedCategory.name}' for shop '${shop?.name || updatedCategory.shopId}' (Status: ${updatedCategory.status})`,
      entityType: 'SETTINGS',
      entityId: updatedCategory.id,
      shopId: updatedCategory.shopId,
      timestamp: new Date().toISOString(),
    });

    return { success: true, category: updatedCategory };
  }

  public static toggleCategoryStatus(
    id: string,
    currentUser: User
  ): { success: boolean; category?: Category; error?: string } {
    const category = db.getCategories().find(c => c.id === id);
    if (!category) {
      return { success: false, error: 'Category not found.' };
    }

    const newStatus = category.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
    return this.updateCategory(id, { status: newStatus }, currentUser);
  }
}
