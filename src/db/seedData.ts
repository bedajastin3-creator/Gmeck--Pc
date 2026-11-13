import {
  User,
  Category,
  Product,
  Sale,
  Purchase,
  Expense,
  InventoryMovement,
  BusinessSettings,
  AuditLog,
  Shop,
  ImportHistoryItem,
  DebtRecord,
} from '../types';

// Pre-computed SHA-256 hash for default master admin password:
// "52775277" + "_omnibiz_salt_v1" => 15d191753448756ea4c781eec8f93b0b9a66f685a94b9c31be048d4ed22f5681
export const DEFAULT_ADMIN_HASH = '15d191753448756ea4c781eec8f93b0b9a66f685a94b9c31be048d4ed22f5681';

export const INITIAL_SHOPS: Shop[] = [];

export const INITIAL_SETTINGS: BusinessSettings = {
  businessName: 'Gmeck Company Limited',
  tagline: 'Quality Electronics & Solutions',
  address: '428 Commerce Boulevard, Suite 100, Metro City',
  phone: '+1 (555) 019-2834',
  email: 'operations@gmeck.local',
  currencySymbol: 'TSh',
  currencyCode: 'TZS',
  taxRatePercent: 6.5,
  enableTax: true,
  receiptHeaderNote: 'Thank you for shopping with Gmeck Company Limited!',
  receiptFooterNote: 'Goods once sold can be exchanged within 7 days with valid receipt. No cash refunds.',
  receiptPaperWidth: '80mm',
  lowStockThresholdDefault: 5,
};

export const INITIAL_USERS: User[] = [
  {
    id: 'user-admin-01',
    username: 'Admin',
    name: 'Administrator (Executive)',
    role: 'ADMIN',
    passwordHash: DEFAULT_ADMIN_HASH, // "52775277"
    color: 'slate',
    status: 'ACTIVE',
    assignedShopIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const INITIAL_CATEGORIES: Category[] = [];
export const INITIAL_PRODUCTS: Product[] = [];
export const INITIAL_SALES: Sale[] = [];
export const INITIAL_PURCHASES: Purchase[] = [];
export const INITIAL_EXPENSES: Expense[] = [];
export const INITIAL_MOVEMENTS: InventoryMovement[] = [];
export const INITIAL_IMPORT_HISTORY: ImportHistoryItem[] = [];
export const INITIAL_AUDIT_LOGS: AuditLog[] = [];
export const INITIAL_DEBTS: DebtRecord[] = [];
