import { db } from '../db/storage';
import { Expense, ExpenseCategory, PaymentMethod, User } from '../types';
import { generateUUID } from '../utils/crypto';
import {
  canAccessShopAsAdmin,
  getEffectiveSellerPermissions,
  getShopAdminShopIds,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../utils/permissions';

function getAllowedExpenseShopIds(user: User): Set<string> | null {
  if (isPlatformAdmin(user)) return null;
  if (isShopAdmin(user)) {
    return new Set([...getShopAdminShopIds(user), ...(user.assignedShopIds || [])]);
  }
  return new Set(user.assignedShopIds || []);
}

export class ExpenseService {
  /**
   * Record operational expense (Shop-specific or General Company).
   * Platform Admin, Shop Admin, OR Seller with canRecordExpenses permission.
   */
  public static recordExpense(
    params: {
      shopId?: string | null;
      isCompanyExpense?: boolean;
      category: ExpenseCategory | string;
      description?: string;
      title?: string;
      amount: number;
      paymentMethod: PaymentMethod;
      date?: string;
      reference?: string;
      notes?: string;
    },
    currentUser: User
  ): { success: boolean; expense?: Expense; error?: string } {
    const effectivePerms = getEffectiveSellerPermissions(currentUser);
    if (!hasAdminAccess(currentUser) && !effectivePerms.canRecordExpenses) {
      return { success: false, error: 'Permission Denied: You do not have permission to record expenses.' };
    }

    const desc = params.title || params.description;
    if (!desc?.trim()) {
      return { success: false, error: 'Description is required.' };
    }

    if (params.amount <= 0) {
      return { success: false, error: 'Amount must be greater than zero.' };
    }

    let shopName: string | undefined = undefined;
    let finalShopId: string | null = null;
    const allowedShopIds = getAllowedExpenseShopIds(currentUser);
    let requestedShopId = params.shopId && params.shopId !== 'GENERAL' ? params.shopId : null;

    if (allowedShopIds !== null) {
      if (params.isCompanyExpense) {
        return {
          success: false,
          error: 'Permission Denied: Only Platform Admin can record general company-wide expenses.',
        };
      }
      if (!requestedShopId && allowedShopIds.size > 0) {
        requestedShopId = Array.from(allowedShopIds)[0];
      }
      if (requestedShopId && !allowedShopIds.has(requestedShopId)) {
        return {
          success: false,
          error: 'Permission Denied: Selected shop is outside your access scope.',
        };
      }
    }

    const isCompany = Boolean(params.isCompanyExpense || !requestedShopId);

    if (!isCompany && requestedShopId) {
      const shop = db.getShops().find(s => s.id === requestedShopId);
      if (!shop) {
        return { success: false, error: 'Selected shop does not exist.' };
      }
      shopName = shop.name;
      finalShopId = shop.id;
    } else {
      shopName = 'General Company';
      finalShopId = null;
    }

    const newExpense: Expense = {
      id: generateUUID(),
      shopId: finalShopId,
      shopName,
      isCompanyExpense: isCompany,
      category: params.category || 'OTHER',
      description: desc.trim(),
      title: desc.trim(),
      amount: Number(params.amount.toFixed(2)),
      paymentMethod: params.paymentMethod || 'CASH',
      date: params.date || new Date().toISOString().slice(0, 10),
      reference: params.reference?.trim(),
      notes: params.notes?.trim(),
      createdByUserId: currentUser.id,
      createdByName: currentUser.name,
      createdAt: new Date().toISOString(),
    };

    db.saveExpenses([newExpense, ...db.getExpenses()]);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_EXPENSE',
      entityType: 'EXPENSE',
      entityId: newExpense.id,
      payload: newExpense,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'CREATE_EXPENSE',
      details: `Recorded ${newExpense.category} expense: ${newExpense.amount.toFixed(2)} (${newExpense.description}) [${shopName}]`,
      entityType: 'EXPENSE',
      entityId: newExpense.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, expense: newExpense };
  }

  public static createExpense(
    params: {
      shopId?: string | null;
      isCompanyExpense?: boolean;
      category: ExpenseCategory | string;
      title: string;
      amount: number;
      paymentMethod: PaymentMethod;
      reference?: string;
      notes?: string;
    },
    currentUser: User
  ) {
    return ExpenseService.recordExpense(params, currentUser);
  }

  /**
   * Update an existing expense.
   * Platform Admin, Shop Admin (within managed shops), or Seller with canRecordExpenses (own only).
   */
  public static updateExpense(
    expenseId: string,
    updates: {
      title?: string;
      category?: ExpenseCategory | string;
      amount?: number;
      paymentMethod?: PaymentMethod;
      reference?: string;
      notes?: string;
      date?: string;
      shopId?: string | null;
      isCompanyExpense?: boolean;
    },
    currentUser: User
  ): { success: boolean; expense?: Expense; error?: string } {
    const expenses = db.getExpenses();
    const index = expenses.findIndex(e => e.id === expenseId);

    if (index === -1) {
      return { success: false, error: 'Expense not found.' };
    }

    const current = expenses[index];
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    const effectivePerms = getEffectiveSellerPermissions(currentUser);

    if (!platformAdmin) {
      if (shopAdmin) {
        const canManageThisExpense =
          Boolean(current.shopId && canAccessShopAsAdmin(currentUser, current.shopId)) ||
          current.createdByUserId === currentUser.id;
        if (!canManageThisExpense) {
          return {
            success: false,
            error: 'Permission Denied: You can only edit expenses within your managed shops.',
          };
        }
      } else {
        if (!effectivePerms.canRecordExpenses) {
          return { success: false, error: 'Permission Denied: You do not have permission to edit expenses.' };
        }
        if (current.createdByUserId !== currentUser.id) {
          return { success: false, error: 'Permission Denied: You can only edit expenses you created.' };
        }
      }
    }

    if (updates.amount !== undefined && updates.amount <= 0) {
      return { success: false, error: 'Amount must be greater than zero.' };
    }

    let nextShopId = current.shopId ?? null;
    let nextShopName = current.shopName || 'General Company';
    let nextIsCompany = Boolean(current.isCompanyExpense || !current.shopId);

    if (updates.shopId !== undefined || updates.isCompanyExpense !== undefined) {
      const requestedShopId =
        updates.shopId && updates.shopId !== 'GENERAL' ? updates.shopId : null;
      const wantsCompany = Boolean(updates.isCompanyExpense || !requestedShopId);

      if (!platformAdmin) {
        const allowedShopIds = getAllowedExpenseShopIds(currentUser) || new Set<string>();
        if (wantsCompany && current.createdByUserId !== currentUser.id) {
          return {
            success: false,
            error: 'Permission Denied: Only Platform Admin can assign general company expenses.',
          };
        }
        if (requestedShopId && !allowedShopIds.has(requestedShopId)) {
          return {
            success: false,
            error: 'Permission Denied: Selected shop is outside your access scope.',
          };
        }
      }

      if (!wantsCompany && requestedShopId) {
        const shop = db.getShops().find(s => s.id === requestedShopId);
        if (!shop) {
          return { success: false, error: 'Selected shop does not exist.' };
        }
        nextShopId = shop.id;
        nextShopName = shop.name;
        nextIsCompany = false;
      } else {
        nextShopId = null;
        nextShopName = 'General Company';
        nextIsCompany = true;
      }
    }

    const finalTitle = updates.title?.trim() || current.title || current.description;

    const updatedExpense: Expense = {
      ...current,
      shopId: nextShopId,
      shopName: nextShopName,
      isCompanyExpense: nextIsCompany,
      title: finalTitle,
      description: finalTitle,
      category: updates.category || current.category,
      amount: updates.amount !== undefined ? Number(updates.amount.toFixed(2)) : current.amount,
      paymentMethod: updates.paymentMethod || current.paymentMethod,
      reference: updates.reference?.trim() || undefined,
      notes: updates.notes?.trim() || undefined,
      date: updates.date || current.date,
    };

    expenses[index] = updatedExpense;
    db.saveExpenses(expenses);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_EXPENSE',
      entityType: 'EXPENSE',
      entityId: expenseId,
      payload: updatedExpense,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_EXPENSE',
      details: `Updated expense: ${updatedExpense.title} (${updatedExpense.category}, ${updatedExpense.amount})`,
      entityType: 'EXPENSE',
      entityId: expenseId,
      timestamp: new Date().toISOString(),
    });

    return { success: true, expense: updatedExpense };
  }

  /**
   * Delete an expense permanently.
   * Platform Admin OR Shop Admin (within their managed shops).
   */
  public static deleteExpense(
    expenseId: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    const expenses = db.getExpenses();
    const expense = expenses.find(e => e.id === expenseId);

    if (!expense) {
      return { success: false, error: 'Expense not found.' };
    }

    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    const canDeleteAsShopAdmin =
      shopAdmin &&
      (Boolean(expense.shopId && canAccessShopAsAdmin(currentUser, expense.shopId)) ||
        expense.createdByUserId === currentUser.id);

    if (!platformAdmin && !canDeleteAsShopAdmin) {
      return {
        success: false,
        error: 'Permission Denied: Only Admin or Shop Admin can delete expenses.',
      };
    }

    const updatedExpenses = expenses.filter(e => e.id !== expenseId);
    db.saveExpenses(updatedExpenses);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'DELETE_EXPENSE',
      entityType: 'EXPENSE',
      entityId: expenseId,
      payload: { id: expenseId },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_EXPENSE',
      details: `Deleted expense: ${expense.title} (${expense.category}, ${expense.amount})`,
      entityType: 'EXPENSE',
      entityId: expenseId,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  /**
   * Get expenses - Admin sees all, Seller with canViewExpenses sees all, 
   * Seller with canRecordExpenses sees all (they need to view what they record).
   */
  public static getExpenses(
    filter?: {
      shopId?: string;
      category?: ExpenseCategory | string;
      search?: string;
      startDate?: string;
      endDate?: string;
    },
    currentUser?: User
  ): Expense[] {
    if (currentUser) {
      const effectivePerms = getEffectiveSellerPermissions(currentUser);
      if (
        !hasAdminAccess(currentUser) &&
        !effectivePerms.canViewExpenses &&
        !effectivePerms.canRecordExpenses
      ) {
        return [];
      }
    }

    let list = db.getExpenses();

    if (currentUser && !isPlatformAdmin(currentUser)) {
      const allowedShopIds = getAllowedExpenseShopIds(currentUser) || new Set<string>();
      list = list.filter(
        e =>
          (Boolean(e.shopId) && allowedShopIds.has(e.shopId!)) ||
          e.createdByUserId === currentUser.id
      );
    }

    if (filter?.shopId && filter.shopId !== 'ALL') {
      if (filter.shopId === 'GENERAL') {
        list = list.filter(e => e.isCompanyExpense || !e.shopId);
      } else {
        list = list.filter(e => e.shopId === filter.shopId);
      }
    }

    if (filter?.category && filter.category !== 'ALL') {
      list = list.filter(e => e.category === filter.category);
    }

    if (filter?.search?.trim()) {
      const q = filter.search.trim().toLowerCase();
      list = list.filter(
        e =>
          (e.description && e.description.toLowerCase().includes(q)) ||
          (e.title && e.title.toLowerCase().includes(q)) ||
          (e.reference && e.reference.toLowerCase().includes(q)) ||
          (e.notes && e.notes.toLowerCase().includes(q)) ||
          (e.shopName && e.shopName.toLowerCase().includes(q))
      );
    }

    if (filter?.startDate) {
      list = list.filter(e => e.date >= filter.startDate!);
    }

    if (filter?.endDate) {
      list = list.filter(e => e.date <= filter.endDate!);
    }

    return list;
  }
}
