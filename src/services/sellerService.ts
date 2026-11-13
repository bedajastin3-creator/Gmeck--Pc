import { db } from '../db/storage';
import { User, UserStatus, SellerPermissions } from '../types';
import { generateUUID, hashPassword } from '../utils/crypto';

export class SellerService {
  /**
   * Get all sellers with their performance statistics (Total sales, total revenue, status, assigned shops).
   */
  public static getSellers(): (User & { salesCount: number; totalRevenue: number; assignedShopNames: string[] })[] {
    const users = db.getUsers().filter(u => u.role === 'SELLER');
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
    // FIX: Allow Admin OR Seller with canManageSellers permission
    if (currentUser.role !== 'ADMIN' && !currentUser.permissions?.canManageSellers) {
      return { success: false, error: 'Permission Denied: Only Admin can create seller accounts.' };
    }

    if (!params.name?.trim() || !params.username?.trim() || !params.password) {
      return { success: false, error: 'Full name, username, and password are required.' };
    }

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
      assignedShopIds: params.assignedShopIds && params.assignedShopIds.length > 0 ? params.assignedShopIds : [],
      avatarUrl: null,
      permissions: params.permissions || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.saveUsers([...users, newSeller]);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_SELLER',
      entityType: 'SELLER',
      entityId: newSeller.id,
      payload: {
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
      },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

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
  public static updateSeller(
    sellerId: string,
    params: {
      name?: string;
      color?: string;
      status?: UserStatus;
      assignedShopIds?: string[];
      permissions?: SellerPermissions;
    },
    currentUser: User
  ): { success: boolean; seller?: User; error?: string } {
    // FIX: Allow Admin OR Seller with canManageSellers permission
    if (currentUser.role !== 'ADMIN' && !currentUser.permissions?.canManageSellers) {
      return { success: false, error: 'Permission Denied: Only Admin can manage seller profiles.' };
    }

    const users = db.getUsers();
    const index = users.findIndex(u => u.id === sellerId && u.role === 'SELLER');
    if (index === -1) {
      return { success: false, error: 'Seller account not found.' };
    }

    const seller = users[index];

    if (params.name?.trim()) {
      seller.name = params.name.trim();
    }

    if (params.color) {
      seller.color = params.color;
    }

    if (params.status) {
      seller.status = params.status;
    }

    if (params.assignedShopIds !== undefined) {
      seller.assignedShopIds = params.assignedShopIds;
    }

    if (params.permissions !== undefined) {
      seller.permissions = params.permissions;
    }

    seller.updatedAt = new Date().toISOString();
    users[index] = seller;
    db.saveUsers(users);

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
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_SELLER',
      details: `Updated seller ${seller.name} (Status: ${seller.status}, Color: ${seller.color}, Assigned Shops: ${seller.assignedShopIds?.length || 0})`,
      entityType: 'SELLER',
      entityId: seller.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, seller };
  }

  public static toggleSellerStatus(
    sellerId: string,
    status: UserStatus,
    currentUser: User
  ): { success: boolean; error?: string } {
    return SellerService.updateSeller(sellerId, { status }, currentUser);
  }

  /**
   * Admin or Seller with canManageSellers permission deletes a seller.
   */
  public static deleteSeller(
    sellerId: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    // FIX: Allow Admin OR Seller with canManageSellers permission
    if (currentUser.role !== 'ADMIN' && !currentUser.permissions?.canManageSellers) {
      return { success: false, error: 'Permission Denied: Only Admin can delete sellers.' };
    }

    const users = db.getUsers();
    const seller = users.find(u => u.id === sellerId && u.role === 'SELLER');
    
    if (!seller) {
      return { success: false, error: 'Seller not found.' };
    }

    // Remove seller from users
    const updatedUsers = users.filter(u => u.id !== sellerId);
    db.saveUsers(updatedUsers);

    // Sync to cloud
    db.enqueueSync({
      id: generateUUID(),
      operation: 'DELETE_SELLER',
      entityType: 'SELLER',
      entityId: sellerId,
      payload: { id: sellerId },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    // Audit log
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
  public static updateSellerColor(
    sellerId: string,
    color: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (currentUser.role !== 'ADMIN' && currentUser.id !== sellerId) {
      return { success: false, error: 'Permission Denied: You cannot modify another user color.' };
    }

    const users = db.getUsers();
    const user = users.find(u => u.id === sellerId);
    if (!user) return { success: false, error: 'User not found.' };

    user.color = color;
    user.updatedAt = new Date().toISOString();
    db.saveUsers(users);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_SELLER',
      entityType: 'SELLER',
      entityId: user.id,
      payload: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        passwordHash: user.passwordHash,
        color: user.color,
        status: user.status,
        assignedShopIds: user.assignedShopIds,
        avatarUrl: user.avatarUrl || null,
        permissions: user.permissions || {},
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    return { success: true };
  }
}
