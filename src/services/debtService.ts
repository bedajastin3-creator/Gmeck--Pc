import { db } from '../db/storage';
import { DebtRecord, DebtSummary, DebtType, DebtStatus, DebtPayment, User } from '../types';
import { generateUUID } from '../utils/crypto';

export class DebtService {
  /**
   * Helper to normalize a date string (YYYY-MM-DD) to compare with today
   */
  private static getTodayStr(): string {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  /**
   * Calculate effective status of a debt based on current local date & remaining balance
   */
  public static calculateStatus(debt: DebtRecord, todayStr: string = this.getTodayStr()): DebtStatus {
    if (debt.status === 'PAID') return 'PAID';
    if (debt.status === 'CANCELLED') return 'CANCELLED';
    if (debt.status === 'ARCHIVED') return 'ARCHIVED';

    const paidAmt = debt.paidAmount || 0;
    const remaining = debt.remainingAmount !== undefined ? debt.remainingAmount : Math.max(0, debt.amount - paidAmt);

    if (remaining <= 0) {
      return 'PAID';
    }

    if (paidAmt > 0) {
      if (debt.dueDate) {
        const due = debt.dueDate.slice(0, 10);
        if (due < todayStr) return 'OVERDUE';
        if (due === todayStr) return 'DUE_TODAY';
      }
      return 'PARTIALLY_PAID';
    }

    if (!debt.dueDate) {
      return 'PENDING';
    }

    const due = debt.dueDate.slice(0, 10);
    if (due < todayStr) {
      return 'OVERDUE';
    } else if (due === todayStr) {
      return 'DUE_TODAY';
    } else {
      return 'PENDING';
    }
  }

  /**
   * Calculate overdue days from due date to today
   */
  public static getOverdueDays(dueDate?: string, todayStr: string = this.getTodayStr()): number {
    if (!dueDate) return 0;
    const due = new Date(dueDate.slice(0, 10)).getTime();
    const today = new Date(todayStr).getTime();
    if (today <= due) return 0;
    const diffMs = today - due;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Get all debts with user filtering
   * Admin sees all, Seller sees only their own
   */
  public static getAllDebts(currentUser?: User): DebtRecord[] {
    let rawDebts = db.getDebts();
    
    // Filter: Admin sees all, Sellers see only their own
    if (currentUser && currentUser.role === 'SELLER') {
      rawDebts = rawDebts.filter(d => d.createdByUserId === currentUser.id);
    }
    
    const todayStr = this.getTodayStr();

    return rawDebts.map(d => {
      const paidAmount = d.paidAmount || 0;
      const remainingAmount = d.remainingAmount !== undefined ? d.remainingAmount : Math.max(0, d.amount - paidAmount);
      const computedStatus = this.calculateStatus({ ...d, remainingAmount, paidAmount }, todayStr);

      return {
        ...d,
        paidAmount,
        remainingAmount,
        status: (d.status === 'CANCELLED' || d.status === 'ARCHIVED') ? d.status : computedStatus,
      };
    });
  }

  /**
   * Get Debt Dashboard Summary Metrics with user filtering
   */
  public static getSummary(currentUser?: User): DebtSummary {
    const debts = this.getAllDebts(currentUser);

    const summary: DebtSummary = {
      weDemand: {
        totalOutstanding: 0,
        dueTodayCount: 0,
        dueTodayAmount: 0,
        overdueCount: 0,
        overdueAmount: 0,
        paidCount: 0,
        paidAmount: 0,
        totalCount: 0,
      },
      theyDemand: {
        totalOutstanding: 0,
        dueTodayCount: 0,
        dueTodayAmount: 0,
        overdueCount: 0,
        overdueAmount: 0,
        paidCount: 0,
        paidAmount: 0,
        totalCount: 0,
      },
    };

    debts.forEach(d => {
      const target = d.type === 'WE_DEMAND' ? summary.weDemand : summary.theyDemand;
      target.totalCount += 1;

      const remaining = d.remainingAmount !== undefined ? d.remainingAmount : (d.status === 'PAID' ? 0 : d.amount);
      const paid = d.paidAmount !== undefined ? d.paidAmount : (d.status === 'PAID' ? d.amount : 0);

      if (d.status === 'PAID') {
        target.paidCount += 1;
        target.paidAmount += d.amount;
      } else if (d.status !== 'CANCELLED' && d.status !== 'ARCHIVED') {
        target.totalOutstanding += remaining;
        target.paidAmount += paid;

        if (d.status === 'DUE_TODAY') {
          target.dueTodayCount += 1;
          target.dueTodayAmount += remaining;
        } else if (d.status === 'OVERDUE') {
          target.overdueCount += 1;
          target.overdueAmount += remaining;
        }
      }
    });

    return summary;
  }

  /**
   * Create a new independent debt record
   */
  public static createDebt(
    input: {
      type: DebtType;
      debtorName: string;
      productDescription?: string;
      amount: number;
      dueDate?: string;
      contact?: string;
      notes?: string;
      shopId?: string;
    },
    user: User
  ): DebtRecord {
    const id = `debt-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const now = new Date().toISOString();
    const totalAmt = Math.max(0, Number(input.amount));

    const initialStatus = input.dueDate
      ? this.calculateStatus({
          id,
          type: input.type,
          debtorName: input.debtorName.trim(),
          amount: totalAmt,
          paidAmount: 0,
          remainingAmount: totalAmt,
          dueDate: input.dueDate,
          status: 'PENDING',
          createdByUserId: user.id,
          createdByName: user.name,
          createdAt: now,
          updatedAt: now,
        })
      : 'PENDING';

    const record: DebtRecord = {
      id,
      type: input.type,
      debtorName: input.debtorName.trim(),
      productDescription: (input.productDescription || '').trim(),
      amount: totalAmt,
      paidAmount: 0,
      remainingAmount: totalAmt,
      payments: [],
      dueDate: input.dueDate || undefined,
      contact: (input.contact || '').trim() || undefined,
      notes: (input.notes || '').trim() || undefined,
      status: initialStatus,
      createdByUserId: user.id,
      createdByName: user.name,
      shopId: input.shopId || undefined,
      createdAt: now,
      updatedAt: now,
    };

    db.addDebt(record);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_DEBT',
      entityType: 'DEBT',
      entityId: record.id,
      payload: record,
      status: 'PENDING',
      createdAt: now,
    });

    return record;
  }

  /**
   * Record a partial or full payment on a debt with ownership check
   */
  public static recordPayment(
    debtId: string,
    paymentAmount: number,
    user: User,
    options?: {
      paymentDate?: string;
      paymentMethod?: string;
      notes?: string;
    }
  ): { success: boolean; debt?: DebtRecord; error?: string } {
    const rawDebts = db.getDebts();
    const existing = rawDebts.find(d => d.id === debtId);
    if (!existing) {
      return { success: false, error: 'Rekodi ya deni haijapatikana / Debt not found' };
    }

    // Ownership check: Seller can only pay their own debts
    if (user.role === 'SELLER' && existing.createdByUserId !== user.id) {
      return { success: false, error: 'Unaweza kusimamia madeni yako tu / You can only manage your own debts.' };
    }

    if (paymentAmount <= 0) {
      return { success: false, error: 'Kiasi cha malipo kinapaswa kuwa zaidi ya 0 / Payment amount must be > 0' };
    }

    const currentPaid = existing.paidAmount || (existing.status === 'PAID' ? existing.amount : 0);
    const currentRemaining = existing.remainingAmount !== undefined ? existing.remainingAmount : Math.max(0, existing.amount - currentPaid);

    if (paymentAmount > currentRemaining && currentRemaining > 0) {
      return {
        success: false,
        error: `Kiasi kinacholipwa (TSh ${paymentAmount.toLocaleString()}) kinazidi salio lililobaki (TSh ${currentRemaining.toLocaleString()})`,
      };
    }

    const newPaidAmount = currentPaid + paymentAmount;
    const newRemaining = Math.max(0, existing.amount - newPaidAmount);
    const isFullyPaid = newRemaining <= 0;
    const paymentDate = options?.paymentDate || new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    const paymentEntry: DebtPayment = {
      id: `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      debtId: existing.id,
      amount: paymentAmount,
      paymentDate,
      paymentMethod: options?.paymentMethod || 'CASH',
      paidByUserId: user.id,
      paidByName: user.name,
      notes: options?.notes?.trim(),
      remainingAfter: newRemaining,
      createdAt: now,
    };

    const existingPayments = existing.payments || [];
    const updatedPayments = [...existingPayments, paymentEntry];

    const newStatus: DebtStatus = isFullyPaid ? 'PAID' : 'PARTIALLY_PAID';

    const patch: Partial<DebtRecord> = {
      paidAmount: newPaidAmount,
      remainingAmount: newRemaining,
      payments: updatedPayments,
      status: newStatus,
      updatedAt: now,
      ...(isFullyPaid
        ? {
            paidAt: paymentDate,
            paidByUserId: user.id,
            paidByName: user.name,
            paymentNotes: options?.notes?.trim() || undefined,
          }
        : {}),
    };

    db.updateDebt(debtId, patch);

    const updated = { ...existing, ...patch };

    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_DEBT',
      entityType: 'DEBT',
      entityId: debtId,
      payload: updated,
      status: 'PENDING',
      createdAt: now,
    });

    return { success: true, debt: updated };
  }

  /**
   * Mark a debt as fully Paid with ownership check
   */
  public static markAsPaid(
    debtId: string,
    user: User,
    paymentNotes?: string,
    paymentDate: string = new Date().toISOString()
  ): boolean {
    const rawDebts = db.getDebts();
    const existing = rawDebts.find(d => d.id === debtId);
    if (!existing) return false;

    // Ownership check
    if (user.role === 'SELLER' && existing.createdByUserId !== user.id) {
      return false;
    }

    const currentPaid = existing.paidAmount || 0;
    const currentRemaining = existing.remainingAmount !== undefined ? existing.remainingAmount : Math.max(0, existing.amount - currentPaid);

    const res = this.recordPayment(debtId, currentRemaining > 0 ? currentRemaining : existing.amount, user, {
      paymentDate: paymentDate.slice(0, 10),
      notes: paymentNotes,
      paymentMethod: 'CASH',
    });

    return res.success;
  }

  /**
   * Update an existing debt record with ownership check
   */
  public static updateDebt(debtId: string, patch: Partial<DebtRecord>, currentUser?: User): boolean {
    const rawDebts = db.getDebts();
    const existing = rawDebts.find(d => d.id === debtId);
    if (!existing) return false;

    // Ownership check
    if (currentUser && currentUser.role === 'SELLER' && existing.createdByUserId !== currentUser.id) {
      return false;
    }

    if (patch.amount !== undefined) {
      const paid = patch.paidAmount !== undefined ? patch.paidAmount : (existing.paidAmount || 0);
      patch.remainingAmount = Math.max(0, patch.amount - paid);
      if (patch.remainingAmount <= 0) {
        patch.status = 'PAID';
      }
    }

    patch.updatedAt = new Date().toISOString();
    db.updateDebt(debtId, patch);

    const updated = { ...existing, ...patch };
    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_DEBT',
      entityType: 'DEBT',
      entityId: debtId,
      payload: updated,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    return true;
  }

  /**
   * Delete or archive a debt record with ownership check
   * Admin can delete any, Seller can only delete their own
   */
  public static deleteDebt(debtId: string, currentUser?: User): boolean {
    const rawDebts = db.getDebts();
    const existing = rawDebts.find(d => d.id === debtId);
    if (!existing) return false;

    // Ownership check
    if (currentUser && currentUser.role === 'SELLER' && existing.createdByUserId !== currentUser.id) {
      return false;
    }

    // Delete from local database
    db.deleteDebt(debtId);

    // CRITICAL FIX: Enqueue DELETE_DEBT sync operation
    db.enqueueSync({
      id: generateUUID(),
      operation: 'DELETE_DEBT',
      entityType: 'DEBT',
      entityId: debtId,
      payload: { id: debtId },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    return true;
  }
}
