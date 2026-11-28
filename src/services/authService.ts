// src/services/authService.ts
import { db } from '../db/storage';
import { User, UserRole, SellerPermissions } from '../types';
import { hashPassword, verifyPassword, generateUUID } from '../utils/crypto';
import { CloudflareApi } from './cloudflareApi';
import { SyncService } from './syncService';
import { getShopAdminShopIds, hasAdminAccess, isPlatformAdmin, isShopAdmin } from '../utils/permissions';

const AUTH_STORAGE_KEY = 'omnibiz_active_session_v1';
const REMEMBER_KEY = 'omnibiz_remember_me';

export class AuthService {
  private static parsePermissions(permissions: any): SellerPermissions {
    if (!permissions) return {};
    try {
      let current = permissions;
      while (typeof current === 'string' && current.trim()) {
        current = JSON.parse(current);
      }
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        return current as SellerPermissions;
      }
      return {};
    } catch (e) {
      console.warn('Failed to parse permissions:', e);
      return {};
    }
  }

  public static async login(
    username: string,
    plainPassword: string,
    expectedRole?: UserRole
  ): Promise<{ success: boolean; user?: User; error?: string }> {
    if (!CloudflareApi.isOnline()) {
      return { success: false, error: CloudflareApi.OFFLINE_ERROR_MESSAGE };
    }

    const trimmedUsername = username.trim().toLowerCase();

    try {
      // Always pull fresh users and cloud state first so roles/permissions/passwords are authoritative
      const pullResult = await CloudflareApi.pullSync();
      if (!pullResult?.success || !pullResult?.data) {
        return {
          success: false,
          error: pullResult?.error || 'Could not reach cloud database. Wait for internet connection.',
        };
      }
      SyncService.applyCloudData(pullResult.data, true);
    } catch (err: any) {
      return {
        success: false,
        error: CloudflareApi.formatError(err, CloudflareApi.OFFLINE_ERROR_MESSAGE),
      };
    }

    const users = db.getUsers();
    let user = users.find(u => u.username.toLowerCase() === trimmedUsername);

    // Fallback to /auth/login endpoint if user wasn't matched or to obtain an API token
    if (!user) {
      try {
        const cloudResult = await CloudflareApi.login(username, plainPassword);
        if (cloudResult?.success && cloudResult.user) {
          const parsedPermissions = AuthService.parsePermissions(cloudResult.user.permissions);
          const cloudUser: User = {
            id: cloudResult.user.id,
            username: cloudResult.user.username,
            name: cloudResult.user.name,
            role: cloudResult.user.role,
            passwordHash: await hashPassword(plainPassword),
            color: cloudResult.user.color || 'blue',
            status: cloudResult.user.status || 'ACTIVE',
            assignedShopIds: cloudResult.user.assignedShopIds || [],
            avatarUrl: cloudResult.user.avatarUrl || cloudResult.user.avatar_url || null,
            permissions: parsedPermissions,
            createdAt: cloudResult.user.created_at || new Date().toISOString(),
            updatedAt: cloudResult.user.updated_at || new Date().toISOString(),
          };
          db.saveUsers([...db.getUsers().filter(u => u.id !== cloudUser.id), cloudUser]);
          if (cloudResult.token) {
            CloudflareApi.setToken(cloudResult.token);
          }
          user = cloudUser;
        }
      } catch (err: any) {
        if (CloudflareApi.isNetworkError(err)) {
          return { success: false, error: CloudflareApi.OFFLINE_ERROR_MESSAGE };
        }
      }
    }

    if (!user) {
      return { success: false, error: 'Account not found. Please check your username.' };
    }

    if (user.status !== 'ACTIVE') {
      return {
        success: false,
        error: 'This account is currently inactive. Please contact the administrator.',
      };
    }

    if (expectedRole && user.role !== expectedRole) {
      return {
        success: false,
        error: `Unauthorized role: This login portal is restricted to ${expectedRole.toLowerCase()} accounts.`,
      };
    }

    const isValid = await verifyPassword(plainPassword, user.passwordHash);
    if (!isValid) {
      return { success: false, error: 'Incorrect password. Please try again.' };
    }

    if (user.permissions && typeof user.permissions === 'string') {
      user.permissions = AuthService.parsePermissions(user.permissions);
      db.saveUsers(db.getUsers().map(u => (u.id === user!.id ? user! : u)));
    }

    // Obtain/refresh API token online without blocking if /auth/login returns extra metadata
    try {
      const result = await CloudflareApi.login(username, plainPassword);
      if (result?.success && result.token) {
        CloudflareApi.setToken(result.token);
      }
    } catch {
      // Token fetch optional if pullSync already authenticated
    }

    AuthService.setActiveUser(user);

    db.addAuditLog({
      id: generateUUID(),
      userId: user.id,
      userName: user.name,
      action: 'USER_LOGIN',
      details: `${user.role} login successful (${user.username})`,
      entityType: 'AUTH',
      entityId: user.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, user };
  }

  public static getActiveUser(): User | null {
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as User;

      // Before cloud finishes loading at startup, return the saved session identity
      // so AppContext knows whether a user was signed in; once cloud is loaded, validate against live cloud users.
      if (!db.isCloudLoaded()) {
        return parsed;
      }

      const users = db.getUsers();
      const current = users.find(u => u.id === parsed.id);
      if (current && current.status === 'ACTIVE') {
        if (current.permissions && typeof current.permissions === 'string') {
          current.permissions = AuthService.parsePermissions(current.permissions);
        }
        return current;
      }
      return null;
    } catch {
      return null;
    }
  }

  public static setActiveUser(user: User | null): void {
    if (!user) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } else {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    }
  }

  public static setRememberMe(user: User): void {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ userId: user.id }));
  }

  public static clearRememberMe(): void {
    localStorage.removeItem(REMEMBER_KEY);
  }

  public static getRememberedUser(): User | null {
    try {
      if (!db.isCloudLoaded()) return null;
      const remembered = localStorage.getItem(REMEMBER_KEY);
      if (!remembered) return null;
      const { userId } = JSON.parse(remembered);
      const users = db.getUsers();
      const user = users.find(u => u.id === userId);
      if (user && user.status === 'ACTIVE') {
        if (user.permissions && typeof user.permissions === 'string') {
          user.permissions = AuthService.parsePermissions(user.permissions);
        }
        AuthService.setActiveUser(user);
        return user;
      }
      return null;
    } catch {
      return null;
    }
  }

  public static logout(): void {
    const user = AuthService.getActiveUser();
    if (user) {
      db.addAuditLog({
        id: generateUUID(),
        userId: user.id,
        userName: user.name,
        action: 'USER_LOGOUT',
        details: `User logged out (${user.username})`,
        entityType: 'AUTH',
        entityId: user.id,
        timestamp: new Date().toISOString(),
      });

      CloudflareApi.logout(user.id).catch(() => {});
      CloudflareApi.clearToken();
    }
    AuthService.setActiveUser(null);
  }

  public static async adminResetPassword(
    sellerId: string,
    newPass: string,
    currentUser: User
  ): Promise<{ success: boolean; error?: string }> {
    if (!hasAdminAccess(currentUser)) {
      return {
        success: false,
        error: 'Permission denied: Only Admin or Shop Admin can reset seller passwords.',
      };
    }
    return AuthService.changePassword(sellerId, '', newPass, currentUser);
  }

  public static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    callerUser: User
  ): Promise<{ success: boolean; error?: string }> {
    if (!hasAdminAccess(callerUser) && callerUser.id !== userId) {
      return { success: false, error: 'Permission denied: You cannot change another user password.' };
    }

    if (newPassword.length < 4) {
      return { success: false, error: 'New password must be at least 4 characters.' };
    }

    const users = db.getUsers();
    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) {
      return { success: false, error: 'User not found.' };
    }

    if (!isPlatformAdmin(callerUser) && callerUser.id !== userId) {
      const managedShopIds = new Set(getShopAdminShopIds(callerUser));
      const inManagedShop =
        targetUser.role === 'SELLER' &&
        (targetUser.assignedShopIds || []).some(id => managedShopIds.has(id));
      if (!isShopAdmin(callerUser) || !inManagedShop) {
        return {
          success: false,
          error: 'Permission denied: You can only reset passwords for sellers in your managed shop.',
        };
      }
    }

    if (callerUser.id === userId && callerUser.role === 'SELLER') {
      const isValid = await verifyPassword(currentPassword, targetUser.passwordHash);
      if (!isValid) {
        return { success: false, error: 'Current password is not correct.' };
      }
    }

    const newHash = await hashPassword(newPassword);
    const updatedUser: User = {
      ...targetUser,
      passwordHash: newHash,
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

    db.saveUsers(users.map(u => (u.id === updatedUser.id ? updatedUser : u)));
    if (callerUser.id === updatedUser.id) {
      AuthService.setActiveUser(updatedUser);
    }

    db.addAuditLog({
      id: generateUUID(),
      userId: callerUser.id,
      userName: callerUser.name,
      action: 'PASSWORD_CHANGE',
      details: `Password changed for user ${updatedUser.username} by ${callerUser.name}`,
      entityType: 'SELLER',
      entityId: updatedUser.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  public static async changeAdminUsername(
    adminUserId: string,
    newUsername: string,
    currentUser: User
  ): Promise<{ success: boolean; error?: string }> {
    if (currentUser.role !== 'ADMIN') {
      return { success: false, error: 'Permission denied: Only Admin can change username.' };
    }

    if (!newUsername.trim() || newUsername.trim().length < 3) {
      return { success: false, error: 'Username must be at least 3 characters.' };
    }

    const cleanUsername = newUsername.trim().toLowerCase();
    const users = db.getUsers();

    if (users.some(u => u.username.toLowerCase() === cleanUsername && u.id !== adminUserId)) {
      return { success: false, error: `Username '${cleanUsername}' is already taken.` };
    }

    const targetUser = users.find(u => u.id === adminUserId);
    if (!targetUser) {
      return { success: false, error: 'Admin user not found.' };
    }

    const updatedUser: User = {
      ...targetUser,
      username: cleanUsername,
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

    db.saveUsers(users.map(u => (u.id === updatedUser.id ? updatedUser : u)));
    AuthService.setActiveUser(updatedUser);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'USERNAME_CHANGE',
      details: `Admin username changed to '${cleanUsername}'`,
      entityType: 'AUTH',
      entityId: updatedUser.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }
}
