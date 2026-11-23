import type { SellerPermissions, Shop, User } from '../types';

/**
 * Returns true if the user is a platform-wide Administrator.
 */
export function isPlatformAdmin(user?: User | null): boolean {
  return user?.role === 'ADMIN';
}

/**
 * Returns the explicit Shop IDs for which a seller has been designated Shop Admin.
 */
export function getShopAdminShopIds(user?: User | null): string[] {
  if (!user || user.role !== 'SELLER') return [];
  const fromPerms = Array.isArray(user.permissions?.shopAdminShopIds)
    ? user.permissions!.shopAdminShopIds
    : [];
  const fromUser = Array.isArray(user.shopAdminShopIds)
    ? user.shopAdminShopIds
    : [];
  return Array.from(new Set([...fromPerms, ...fromUser].filter(Boolean)));
}

/**
 * Returns true if the user is a Seller who has been granted shop/store management permissions
 * or has been designated as a Shop Admin for one or more shops.
 */
export function isShopAdmin(user?: User | null): boolean {
  if (!user || user.role !== 'SELLER') return false;
  return Boolean(
    getShopAdminShopIds(user).length > 0 ||
      user.permissions?.canManageShops ||
      user.permissions?.canManageInventory
  );
}

/**
 * Returns true if the user has administrative access (platform admin or shop admin).
 */
export function hasAdminAccess(user?: User | null): boolean {
  return isPlatformAdmin(user) || isShopAdmin(user);
}

/**
 * Computes effective seller permissions, merging explicit seller permissions
 * with implied permissions for Platform Admins and designated Shop Admins.
 */
export function getEffectiveSellerPermissions(user?: User | null): SellerPermissions {
  if (!user) return {};

  if (isPlatformAdmin(user)) {
    return {
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
  }

  const base = user.permissions || {};
  const shopAdminIds = getShopAdminShopIds(user);

  if (shopAdminIds.length > 0) {
    return {
      ...base,
      canEditProducts: base.canEditProducts ?? true,
      canManageInventory: base.canManageInventory ?? true,
      canManageShops: base.canManageShops ?? true,
      canEditSales: base.canEditSales ?? true,
      canDeleteSales: base.canDeleteSales ?? true,
      canViewReports: base.canViewReports ?? true,
      canViewExpenses: base.canViewExpenses ?? true,
      canRecordExpenses: base.canRecordExpenses ?? true,
      canRecordPurchases: base.canRecordPurchases ?? true,
      canViewPurchases: base.canViewPurchases ?? true,
      shopAdminShopIds: shopAdminIds,
    };
  }

  return { ...base };
}

/**
 * Returns the shops a user is permitted to administer.
 */
export function getAdminManagedShops(
  user: User | null | undefined,
  allShops: Shop[]
): Shop[] {
  if (!user) return [];
  if (isPlatformAdmin(user)) return allShops;
  const shopAdminIds = getShopAdminShopIds(user);
  if (shopAdminIds.length > 0) {
    return allShops.filter(s => shopAdminIds.includes(s.id));
  }
  const assigned = user.assignedShopIds || [];
  if (assigned.length === 0) return [];
  return allShops.filter(s => assigned.includes(s.id));
}
