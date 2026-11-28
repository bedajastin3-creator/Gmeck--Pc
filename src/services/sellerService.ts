import { db } from '../db/storage';
import { User, UserStatus, SellerPermissions } from '../types';
import { generateUUID, hashPassword } from '../utils/crypto';
import {
  getEffectiveSellerPermissions,
  getShopAdminShopIds,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../utils/permissions';
import { CloudflareApi } from './cloudflareApi';
import { SyncService } from './syncService';

function getAllowedSellerShopIds(user: User): Set<string> | null {
  if (isPlatformAdmin(user)) return null;
  if (isShopAdmin(user)) {
    return new Set(getShopAdminShopIds(user));
  }
  return new Set(user.assignedShopIds || []);
}

export class SellerService {
  /**
   * Get sellers (scoped to managed shops when currentUser is a non-platform admin).
   */
  public static getSellers(
    currentUser?: User
  ): (User & { salesCount: number; totalRevenue: number; assignedShopNames: string[] })[] {
    const allowedShopIds = currentUser ? getAllowedSellerShopIds(currentUser) : null;
    const users = db.getUsers().filter(u => {
      if (u.role !== 'SELLER') return false;
      if (!allowedShopIds) return true;
      return (u.assignedShopIds || []).some(id => allowedShopIds.has(id));
    });
    const sales = db.getSales().filter(s => s.status === 'COMPLETED');
    const shops = db.getShops();

    return users.map(user => {
      const userSales = sales.filter(s => s.sellerId === user.id);
      const salesCount = userSales.length;
      const totalRevenue = userSales.reduce((sum, s) => sum + s.total, 0);

      const assignedShopNames = (user.assignedShopIds || [])
        .map(id => shops.find(sh => sh.id === id)?.name)
        .filter(Boolean) as string[];

      return {
        ...user,
        salesCount,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        assignedShopNames,
      };
    });
  }

  /**
   * Admin or Seller with canManageSellers permission creates a new seller.
   */
  public static async createSeller(
    params: {
      name: string;
      username: string;
      password: string;
      color?: string;
      status?: UserStatus;
      assignedShopIds?: string[];
      permissions?: SellerPermissions;
    },
    currentUser: User
  ): Promise<{ success: boolean; seller?: User; error?: string }> {
    const perms = getEffectiveSellerPermissions(currentUser);
    if (!hasAdminAccess(currentUser) && !perms.canManageSellers) {
      return { success: false, error: 'Permission Denied: Only Admin can create seller accounts.' };
    }

    if (!params.name?.trim() || !params.username?.trim() || !params.password) {
      return { success: false, error: 'Full name, username, and password are required.' };
    }

    const platformAdmin = isPlatformAdmin(currentUser);
    const allowedShopIds = getAllowedSellerShopIds(currentUser);
    let finalAssignedShopIds =
      params.assignedShopIds && params.assignedShopIds.length > 0 ? params.assignedShopIds : [];

    if (!platformAdmin && allowedShopIds) {
      finalAssignedShopIds = finalAssignedShopIds.filter(id => allowedShopIds.has(id));
      if (finalAssignedShopIds.length === 0) {
        return {
          success: false,
          error: 'Permission Denied: You can only assign sellers to your managed shop.',
        };
      }
    }

    const finalPermissions: SellerPermissions = platformAdmin
      ? params.permissions || {}
      : isShopAdmin(currentUser)
        ? { canRecordExpenses: Boolean(params.permissions?.canRecordExpenses) }
        : {};

    const cleanUsername = params.username.trim().toLowerCase();
    const users = db.getUsers();

    if (users.some(u => u.username.toLowerCase() === cleanUsername)) {
      return { success: false, error: `Username '${cleanUsername}' is already taken.` };
    }

    const passwordHash = await hashPassword(params.password);
    const newSeller: User = {
      id: generateUUID(),
      username: cleanUsername,
      name: params.name.trim(),
      role: 'SELLER',
      passwordHash,
      color: params.color || 'blue',
      status: params.status || 'ACTIVE',
      assignedShopIds: finalAssignedShopIds,
      avatarUrl: null,
      permissions: finalPermissions,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sellerPayload = {
      id: newSeller.id,
      username: newSeller.username,
      name: newSeller.name,
      role: newSeller.role,
      passwordHash: newSeller.passwordHash,
      color: newSeller.color,
      status: newSeller.status,
      assignedShopIds: newSeller.assignedShopIds,
      avatarUrl: newSeller.avatarUrl || null,
      permissions: newSeller.permissions || {},
      createdAt: newSeller.createdAt,
      updatedAt: newSeller.updatedAt,
    };

    const commit = await SyncService.commitOperation({
      operation: 'CREATE_SELLER',
      entityType: 'SELLER',
      entityId: newSeller.id,
      payload: sellerPayload,
    });
    if (!commit.success) {
      return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    db.saveUsers([...users, newSeller]);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'CREATE_SELLER',
      details: `Created new seller account: ${newSeller.name} (@${newSeller.username}) with ${newSeller.assignedShopIds?.length || 0} assigned shops`,
      entityType: 'SELLER',
      entityId: newSeller.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, seller: newSeller };
  }

  /**
   * Admin or Seller with canManageSellers permission updates a seller.
   */
  public static async updateSeller(
    sellerId: string,
    params: {
      name?: string;
      color?: string;
      status?: UserStatus;
      assignedShopIds?: string[];
      permissions?: SellerPermissions;
    },
    currentUser: User
  ): Promise<{ success: boolean; seller?: User; error?: string }> {
    const perms = getEffectiveSellerPermissions(currentUser);
    if (!hasAdminAccess(currentUser) && !perms.canManageSellers) {
      return { success: false, error: 'Permission Denied: Only Admin can manage seller profiles.' };
    }

    const users = db.getUsers();
    const index = users.findIndex(u => u.id === sellerId && u.role === 'SELLER');
    if (index === -1) {
      return { success: false, error: 'Seller account not found.' };
    }

    const updatedSeller: User = { ...users[index] };
    const platformAdmin = isPlatformAdmin(currentUser);
    const allowedShopIds = getAllowedSellerShopIds(currentUser);

    if (!platformAdmin && allowedShopIds) {
      const inManagedShop = (updatedSeller.assignedShopIds || []).some(id => allowedShopIds.has(id));
      if (!inManagedShop) {
        return {
          success: false,
          error: 'Permission Denied: You can only manage sellers assigned to your shop.',
        };
      }
    }

    if (params.name?.trim()) {
      updatedSeller.name = params.name.trim();
    }

    if (params.color) {
      updatedSeller.color = params.color;
    }

    if (params.status) {
      updatedSeller.status = params.status;
    }

    if (params.assignedShopIds !== undefined) {
      if (!platformAdmin && allowedShopIds) {
        const externalShopIds = (updatedSeller.assignedShopIds || []).filter(
          id => !allowedShopIds.has(id)
        );
        const scopedSelection = params.assignedShopIds.filter(id => allowedShopIds.has(id));
        if (scopedSelection.length === 0 && externalShopIds.length === 0) {
          return {
            success: false,
            error: 'Please select at least one shop within your management scope.',
          };
        }
        updatedSeller.assignedShopIds = Array.from(new Set([...externalShopIds, ...scopedSelection]));
      } else {
        updatedSeller.assignedShopIds = params.assignedShopIds;
      }
    }

    if (params.permissions !== undefined) {
      if (platformAdmin) {
        updatedSeller.permissions = params.permissions;
      } else if (isShopAdmin(currentUser)) {
        updatedSeller.permissions = {
          ...(updatedSeller.permissions || {}),
          canRecordExpenses: Boolean(params.permissions.canRecordExpenses),
        };
      }
    }

    updatedSeller.updatedAt = new Date().toISOString();

    const commit = await SyncService.commitOperation({
      operation: 'UPDATE_SELLER',
      entityType: 'SELLER',
      entityId: updatedSeller.id,
      payload: {
        id: updatedSeller.id,
        username: updatedSeller.username,
        name: updatedSeller.name,
        role: updatedSeller.role,
        passwordHash: updatedSeller.passwordHash,
        color: updatedSeller.color,
        status: updatedSeller.status,
        assignedShopIds: updatedSeller.assignedShopIds,
        avatarUrl: updatedSeller.avatarUrl || null,
        permissions: updatedSeller.permissions || {},
        createdAt: updatedSeller.createdAt,
        updatedAt: updatedSeller.updatedAt,
      },
    });
    if (!commit.success) {
      return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    const nextUsers = [...users];
    nextUsers[index] = updatedSeller;
    db.saveUsers(nextUsers);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_SELLER',
      details: `Updated seller ${updatedSeller.name} (Status: ${updatedSeller.status}, Color: ${updatedSeller.color}, Assigned Shops: ${updatedSeller.assignedShopIds?.length || 0})`,
      entityType: 'SELLER',
      entityId: updatedSeller.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, seller: updatedSeller };
  }

  public static async toggleSellerStatus(
    sellerId: string,
    status: UserStatus,
    currentUser: User
  ): Promise<{ success: boolean; error?: string }> {
    return SellerService.updateSeller(sellerId, { status }, currentUser);
  }

  /**
   * Admin or Seller with canManageSellers permission deletes a seller.
   */
  public static async deleteSeller(
    sellerId: string,
    currentUser: User
  ): Promise<{ success: boolean; error?: string }> {
    const perms = getEffectiveSellerPermissions(currentUser);
    if (!hasAdminAccess(currentUser) && !perms.canManageSellers) {
      return { success: false, error: 'Permission Denied: Only Admin can delete sellers.' };
    }

    const users = db.getUsers();
    const seller = users.find(u => u.id === sellerId && u.role === 'SELLER');

    if (!seller) {
      return { success: false, error: 'Seller not found.' };
    }

    const platformAdmin = isPlatformAdmin(currentUser);
    const allowedShopIds = getAllowedSellerShopIds(currentUser);
    if (!platformAdmin && allowedShopIds) {
      const sellerShops = seller.assignedShopIds || [];
      const inManagedShop = sellerShops.some(id => allowedShopIds.has(id));
      const hasExternalShop = sellerShops.some(id => !allowedShopIds.has(id));
      if (!inManagedShop) {
        return {
          success: false,
          error: 'Permission Denied: You can only delete sellers assigned to your shop.',
        };
      }
      if (hasExternalShop || isShopAdmin(seller)) {
        return {
          success: false,
          error: 'Permission Denied: Only Platform Admin can delete a multi-shop seller or Shop Admin.',
        };
      }
    }

    const commit = await SyncService.commitOperation({
      operation: 'DELETE_SELLER',
      entityType: 'SELLER',
      entityId: sellerId,
      payload: { id: sellerId },
    });
    if (!commit.success) {
      return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    const updatedUsers = users.filter(u => u.id !== sellerId);
    db.saveUsers(updatedUsers);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_SELLER',
      details: `Deleted seller account: ${seller.name} (@${seller.username})`,
      entityType: 'SELLER',
      entityId: sellerId,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  /**
   * Seller or Admin updates the seller's account color.
   */
  public static async updateSellerColor(
    sellerId: string,
    color: string,
    currentUser: User
  ): Promise<{ success: boolean; error?: string }> {
    if (currentUser.role !== 'ADMIN' && currentUser.id !== sellerId) {
      return { success: false, error: 'Permission Denied: You cannot modify another user color.' };
    }

    const users = db.getUsers();
    const index = users.findIndex(u => u.id === sellerId);
    if (index === -1) return { success: false, error: 'User not found.' };

    const updatedUser: User = {
      ...users[index],
      color,
      updatedAt: new Date().toISOString(),
    };

    const commit = await SyncService.commitOperation({
      operation: 'UPDATE_SELLER',
      entityType: 'SELLER',
      entityId: updatedUser.id,
      payload: {
        id: updatedUser.id,
        username: updatedUser.username,
        name: updatedUser.name,
        role: updatedUser.role,
        passwordHash: updatedUser.passwordHash,
        color: updatedUser.color,
        status: updatedUser.status,
        assignedShopIds: updatedUser.assignedShopIds,
        avatarUrl: updatedUser.avatarUrl || null,
        permissions: updatedUser.permissions || {},
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      },
    });
    if (!commit.success) {
      return { success: false, error: commit.error || CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    const nextUsers = [...users];
    nextUsers[index] = updatedUser;
    db.saveUsers(nextUsers);

    return { success: true };
  }
}
