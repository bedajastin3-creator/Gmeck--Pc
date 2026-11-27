import { SellerPermissions, Shop, User } from '../types';

export const ALL_SHOP_ADMIN_PERMISSIONS: Omit<SellerPermissions, 'shopAdminShopIds'> = {
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

export function isPlatformAdmin(user?: User | null): boolean {
  return user?.role === 'ADMIN';
}

export function getShopAdminShopIds(user?: User | null): string[] {
  if (!user || user.role !== 'SELLER') return [];
  const fromPerms = Array.isArray(user.permissions?.shopAdminShopIds)
    ? user.permissions!.shopAdminShopIds
    : [];
  const fromUser = Array.isArray(user.shopAdminShopIds)
    ? user.shopAdminShopIds
    : [];
  return Array.from(
    new Set(
      [...fromPerms, ...fromUser].filter(
        (id): id is string => typeof id === 'string' && id.trim().length > 0
      )
    )
  );
}

export function isShopAdmin(user?: User | null, shopId?: string | null): boolean {
  const managedIds = getShopAdminShopIds(user);
  if (managedIds.length === 0) return false;
  if (shopId) {
    return managedIds.includes(shopId);
  }
  return true;
}

export function hasAdminAccess(user?: User | null): boolean {
  return isPlatformAdmin(user) || isShopAdmin(user);
}

export function canAccessShopAsAdmin(user: User | null | undefined, shopId?: string | null): boolean {
  if (isPlatformAdmin(user)) return true;
  if (!shopId) return false;
  return isShopAdmin(user, shopId);
}

export function getAdminManagedShops(user: User | null | undefined, allShops: Shop[]): Shop[] {
  if (isPlatformAdmin(user)) return allShops;
  const managedIds = getShopAdminShopIds(user);
  if (managedIds.length === 0) return [];
  return allShops.filter(s => managedIds.includes(s.id));
}

export function getEffectiveSellerPermissions(user?: User | null): SellerPermissions {
  if (!user) return {};
  if (isPlatformAdmin(user)) {
    return { ...ALL_SHOP_ADMIN_PERMISSIONS };
  }
  const managedIds = getShopAdminShopIds(user);
  if (managedIds.length > 0) {
    return {
      ...(user.permissions || {}),
      ...ALL_SHOP_ADMIN_PERMISSIONS,
      shopAdminShopIds: managedIds,
    };
  }
  return user.permissions || {};
}

export function isCustomerDetailsEnabledForShop(
  settings:
    | {
        enableCustomerDetails?: boolean;
        customerDetailsByShop?: Record<string, boolean>;
      }
    | null
    | undefined,
  shopId?: string | null
): boolean {
  if (!settings) return false;
  const map = settings.customerDetailsByShop;
  if (shopId && map && typeof map === 'object' && typeof map[shopId] === 'boolean') {
    return map[shopId];
  }
  return Boolean(settings.enableCustomerDetails);
}
