export type UserRole = 'ADMIN' | 'SELLER';

export type UserStatus = 'ACTIVE' | 'INACTIVE';

// ==========================================
// SELLER PERMISSIONS (GRANULAR ACCESS CONTROL)
// ==========================================
export interface SellerPermissions {
  canEditProducts?: boolean;      // Edit existing products
  canDeleteProducts?: boolean;    // Delete products
  canViewExpenses?: boolean;      // View expenses
  canRecordExpenses?: boolean;    // Record expenses
  canManageInventory?: boolean;   // Stock adjustments
  canEditSales?: boolean;         // Edit sales without approval
  canDeleteSales?: boolean;       // Void sales
  canManageDebts?: boolean;       // Manage all debts (not just own)
  canViewReports?: boolean;       // View financial reports
  canManageShops?: boolean;       // Manage shops
  canManageSellers?: boolean;     // Manage other sellers
  canRecordPurchases?: boolean;   // Record purchases
  canViewPurchases?: boolean;     // View purchases
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  color: string; // Hex or theme color key
  status: UserStatus;
  assignedShopIds?: string[]; // Multiple shop IDs assigned to this user
  avatarUrl?: string; // URL to user's avatar image
  permissions?: SellerPermissions; // NEW: Granular permissions for sellers
  createdAt: string;
  updatedAt: string;
}

export type ShopStatus = 'ACTIVE' | 'INACTIVE';

export interface Shop {
  id: string;
  name: string;
  code?: string;
  description?: string;
  address?: string;
  phone?: string;
  status: ShopStatus;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  shopId: string; // Specific shop this category belongs to
  name: string;
  icon?: string;
  color?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
}

export type ProductStatus = 'ACTIVE' | 'INACTIVE';

export interface ProductImage {
  imageId: string;
  productId?: string;
  imageOrder: number; // 0, 1, 2 (0 = Main Image)
  version: number; // Version number for delta-sync (starts at 1)
  dataUrl: string; // Full compressed base64 data for gallery viewer
  thumbnailUrl?: string; // Ultra-compact thumbnail base64 for fast lists
  filename?: string;
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  hash?: string; // Stable Checksum / Hash for comparing local vs server version
  syncStatus?: 'LOCAL_ONLY' | 'SYNCED' | 'MODIFIED_LOCALLY';
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  shopId: string; // Stable Shop ID
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  sellingPrice: number;
  proposedSellingPrice?: number; // Proposed price alias
  purchasePrice: number; // Cost of goods
  currentStock: number;
  minStock: number;
  unit: string; // e.g., 'pcs', 'kg', 'box', 'pack', 'liter'
  status: ProductStatus;
  imageUrl?: string; // Main image URL/dataUrl (for backward compatibility)
  images?: ProductImage[]; // Optional array of up to 3 ProductImages
  createdAt: string;
  updatedAt: string;
}

export type PaymentMethod = 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'BANK' | 'OTHER';

export type SaleStatus = 'COMPLETED' | 'VOIDED';

export interface SaleItem {
  id: string;
  saleId: string;
  shopId?: string;
  productId: string;
  productName: string;
  sku: string;
  unitPrice: number;
  purchasePrice: number;
  quantity: number;
  discount: number;
  total: number;

  // ─── Reference price snapshot (immutable at sale time) ───
  // Captured when the sale was created so that price-deviation
  // reports compare against what the seller actually saw, not
  // against whatever the product price is today.
  referencePrice?: number;
  referenceType?: 'PROPOSED' | 'SELLING';
}

export interface Sale {
  id: string;
  receiptNumber: string;
  shopId: string;
  shopName?: string;
  sellerId: string;
  sellerName: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  costOfGoods: number;
  grossProfit: number;
  paymentMethod: PaymentMethod;
  amountReceived: number;
  change: number;
  status: SaleStatus;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
  notes?: string;
  createdAt: string;
  items: SaleItem[];
}

// ==========================================
// SALE EDIT REQUEST (APPROVAL WORKFLOW)
// ==========================================
export type SaleEditRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SaleEditRequest {
  id: string;
  saleId: string;
  requestedByUserId: string;
  requestedByName: string;
  originalValues: {
    items: SaleItem[];
    total: number;
    subtotal: number;
    grossProfit: number;
    costOfGoods: number;
    amountReceived: number;
    change: number;
  };
  newValues: {
    items: SaleItem[];
    total: number;
    subtotal: number;
    grossProfit: number;
    costOfGoods: number;
    amountReceived: number;
    change: number;
  };
  reason: string;
  status: SaleEditRequestStatus;
  reviewedByUserId?: string;
  reviewedByName?: string;
  reviewNote?: string;
  createdAt: string;
  reviewedAt?: string;
}

export type MovementType = 'SALE' | 'PURCHASE' | 'PURCHASE_EDIT' | 'ADJUSTMENT' | 'CORRECTION' | 'RETURN' | 'VOID_RETURN' | 'DAMAGED' | 'BROKEN' | 'EXPIRED' | 'LOST';

export interface InventoryMovement {
  id: string;
  shopId: string;
  shopName?: string;
  productId: string;
  productName: string;
  previousQty: number;
  changeQty: number; // positive or negative
  newQty: number;
  type: MovementType;
  reason: string;
  costValue?: number; // Financial cost/loss value calculated based on purchase price
  referenceId?: string; // sale ID or purchase ID
  userId: string;
  userName: string;
  createdAt: string;
}

export type PaymentStatus = 'PAID' | 'PARTIAL' | 'UNPAID';

export interface PurchaseItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  total: number;
}

export interface Purchase {
  id: string;
  purchaseNumber: string;
  shopId: string;
  shopName?: string;
  supplierName: string;
  date: string;
  items: PurchaseItem[];
  totalAmount: number;
  paymentStatus: PaymentStatus;
  notes?: string;
  invoiceNumber?: string;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  updatedAt?: string;
}

export type ExpenseCategory =
  | 'ELECTRICITY'
  | 'RENT'
  | 'TRANSPORT'
  | 'SALARIES'
  | 'INTERNET'
  | 'MAINTENANCE'
  | 'MARKETING'
  | 'SUPPLIES'
  | 'OFFICE_SUPPLIES'
  | 'OTHER';

export interface Expense {
  id: string;
  shopId?: string | null; // null/undefined for General Company Expense
  shopName?: string;
  isCompanyExpense?: boolean;
  category: ExpenseCategory | string;
  description: string;
  title?: string;
  amount: number;
  paymentMethod: PaymentMethod;
  date: string;
  reference?: string;
  notes?: string;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
}

export interface BusinessSettings {
  businessName: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  currencySymbol: string;
  currencyCode?: string;
  taxRatePercent: number;
  enableTax: boolean;
  receiptHeaderNote: string;
  receiptFooterNote: string;
  receiptPaperWidth: '80mm' | '58mm' | 'A4';
  lowStockThresholdDefault: number;
  logoUrl?: string;
  themePrimaryColor?: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  details: string;
  entityType: 'PRODUCT' | 'SALE' | 'PURCHASE' | 'EXPENSE' | 'SELLER' | 'INVENTORY' | 'SETTINGS' | 'AUTH' | 'BACKUP' | 'SHOP' | 'IMPORT' | 'SALE_EDIT' | 'DEBT';
  entityId?: string;
  shopId?: string;
  timestamp: string;
  performedByName?: string;
  createdAt?: string;
}

export type SyncOperation =
  | 'CREATE_PRODUCT'
  | 'UPDATE_PRODUCT'
  | 'TOGGLE_PRODUCT_STATUS'
  | 'DELETE_PRODUCT'
  | 'CREATE_SALE'
  | 'UPDATE_SALE'
  | 'VOID_SALE'
  | 'CREATE_PURCHASE'
  | 'UPDATE_PURCHASE'
  | 'CREATE_EXPENSE'
  | 'UPDATE_EXPENSE'
  | 'DELETE_EXPENSE'
  | 'CREATE_SELLER'
  | 'UPDATE_SELLER'
  | 'DELETE_SELLER'
  | 'STOCK_ADJUSTMENT'
  | 'UPDATE_SETTINGS'
  | 'CREATE_SHOP'
  | 'UPDATE_SHOP'
  | 'TOGGLE_SHOP_STATUS'
  | 'DELETE_SHOP'
  | 'CREATE_SALE_EDIT_REQUEST'
  | 'REVIEW_SALE_EDIT_REQUEST'
  | 'CREATE_DEBT'
  | 'UPDATE_DEBT'
  | 'DELETE_DEBT';

export interface SyncQueueItem {
  id: string;
  operation?: SyncOperation;
  action?: string;
  entityType: string;
  entityId: string;
  payload: any;
  status: 'PENDING' | 'SYNCED' | 'FAILED';
  retryCount?: number;
  timestamp?: string;
  createdAt: string;
}

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

export interface ColorOption {
  id: string;
  name: string;
  primary: string;
  bgLight: string;
  border: string;
  hover: string;
  text: string;
}

export type CsvDataType = 'PRODUCTS' | 'INVENTORY' | 'SALES' | 'PURCHASES' | 'EXPENSES' | 'SELLERS' | 'SHOPS' | 'DEBTS';

export interface ImportHistoryItem {
  id: string;
  fileName: string;
  dataType: CsvDataType;
  totalRecords: number;
  successCount: number;
  failedCount: number;
  updatedCount?: number;
  createdCount?: number;
  importedByUserId: string;
  importedByName: string;
  createdAt: string;
  notes?: string;
}

// ==========================================
// 1. DEBT MANAGEMENT (INDEPENDENT DOMAIN)
// ==========================================
export type DebtType = 'WE_DEMAND' | 'THEY_DEMAND'; // 'Tunadai' vs 'Wanatudai'

export type DebtStatus = 'PENDING' | 'DUE_TODAY' | 'OVERDUE' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED' | 'ARCHIVED';

export interface DebtPayment {
  id: string;
  debtId: string;
  amount: number;
  paymentDate: string;
  paymentMethod?: string;
  paidByUserId: string;
  paidByName: string;
  notes?: string;
  remainingAfter: number;
  createdAt: string;
}

export interface DebtRecord {
  id: string;
  type: DebtType; // 'WE_DEMAND' (Tunadai - People who owe us) | 'THEY_DEMAND' (Wanatudai - People we owe)
  debtorName: string; // Required (Customer/Person or Supplier/Entity)
  productDescription?: string; // Manually typed plain text ONLY (e.g., "Daftari", "Simenti") - NO link to Products
  amount: number; // Required, Original Total Debt in TSh
  paidAmount?: number; // Total amount paid so far
  remainingAmount?: number; // amount - (paidAmount || 0)
  payments?: DebtPayment[]; // Detailed installment payment history
  dueDate?: string; // Optional payment date (YYYY-MM-DD)
  contact?: string; // Optional phone/contact info
  notes?: string; // Optional notes
  status: DebtStatus;
  paidAt?: string;
  paidByUserId?: string;
  paidByName?: string;
  paymentNotes?: string;
  createdByUserId: string;
  createdByName: string;
  shopId?: string; // Optional context tag
  createdAt: string;
  updatedAt: string;
}

export interface DebtSummary {
  weDemand: {
    totalOutstanding: number;
    dueTodayCount: number;
    dueTodayAmount: number;
    overdueCount: number;
    overdueAmount: number;
    paidCount: number;
    paidAmount: number;
    totalCount: number;
  };
  theyDemand: {
    totalOutstanding: number;
    dueTodayCount: number;
    dueTodayAmount: number;
    overdueCount: number;
    overdueAmount: number;
    paidCount: number;
    paidAmount: number;
    totalCount: number;
  };
}

// ==========================================
// 2. NOTIFICATION CENTER (INDEPENDENT DOMAIN)
// ==========================================
export type NotificationCategory = 'CRITICAL' | 'WARNING' | 'INFO' | 'SUCCESS';

export type NotificationType =
  | 'DEBT_UPCOMING_CUSTOMER' // Kesho ni siku ya [Name] kulipa deni la [Desc] Sh [Amount]
  | 'DEBT_UPCOMING_COMPANY'  // Kesho ni siku ya kulipa [Name] pesa ya [Desc] Sh [Amount]
  | 'DEBT_OVERDUE_CUSTOMER'   // [Name] kachelewa kulipa Sh [Amount] ya [Desc]. Zimepita siku [X]
  | 'DEBT_OVERDUE_COMPANY'    // Malipo ya [Desc] kwa [Name] yamechelewa. Zimepita siku [X]
  | 'STOCK_LOW'               // [Product] zimekaribia kuisha — zimebaki [Qty] (Shop-specific)
  | 'STOCK_LOW_ADMIN'         // Low stock alert for admin
  | 'STOCK_OUT'               // [Product] zimeisha kabisa (Shop-specific)
  | 'STOCK_OUT_ADMIN'         // Out of stock alert for admin
  | 'PRICE_CHANGE_SELLER'     // [Product] zimebadilishwa bei sasa zitauzwa Sh [Price] (Shop-specific)
  | 'PRICE_CHANGE_ADMIN'      // Taarifa imetumwa kwa wauzaji wa [Shop] juu ya mabadiliko ya bei ya [Product]
  | 'LOSS_OCCURRED'
  | 'SALE_EDIT_REQUESTED'     // New: Sale edit request notification
  | 'SALE_EDIT_APPROVED'      // New: Sale edit approved notification
  | 'SALE_EDIT_REJECTED'      // New: Sale edit rejected notification
  | 'SYSTEM_EVENT';

export interface AppNotification {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  isGlobal: boolean; // True for debt reminders (Admin + All sellers)
  targetShopId?: string; // For shop-specific notifications
  targetShopName?: string;
  targetUserIds?: string[];
  targetRole?: 'ADMIN' | 'SELLER' | 'ALL';
  relatedEntityId?: string;
  relatedEntityType?: 'DEBT' | 'PRODUCT' | 'SHOP' | 'SALE' | 'SALE_EDIT_REQUEST';
  createdAt: string;
  readByUserIds: string[]; // List of user IDs who marked this notification as read
}
