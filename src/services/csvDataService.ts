import { db } from '../db/storage';
import {
  Product,
  Sale,
  Purchase,
  Expense,
  User,
  Shop,
  InventoryMovement,
  CsvDataType,
  ImportHistoryItem,
} from '../types';
import { generateUUID } from '../utils/crypto';

// Helper to escape CSV cell
function escapeCsvCell(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Helper to parse CSV string properly handling quotes and commas
function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentCell += '"';
        i++; // skip next quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some(c => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(c => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export interface ValidationIssue {
  rowNumber: number;
  type: 'ERROR' | 'WARNING';
  field?: string;
  message: string;
}

export interface ImportValidationResult {
  dataType: CsvDataType;
  fileName: string;
  totalRows: number;
  validRowsCount: number;
  willCreateCount: number;
  willUpdateCount: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  parsedRecords: any[];
}

export class CsvDataService {
  /**
   * EXPORT TO CSV
   */
  public static exportDataToCsv(dataType: CsvDataType, shopId?: string): { fileName: string; csvContent: string } {
    const isAllShops = !shopId || shopId === 'ALL';
    const shops = db.getShops();
    const targetShop = isAllShops ? null : shops.find(s => s.id === shopId);
    const shopSlug = targetShop ? targetShop.name.toLowerCase().replace(/\s+/g, '_') : 'all_shops';
    const dateStr = new Date().toISOString().slice(0, 10);

    let fileName = `export_${dataType.toLowerCase()}_${shopSlug}_${dateStr}.csv`;
    let headers: string[] = [];
    let rows: string[][] = [];

    switch (dataType) {
      case 'PRODUCTS': {
        headers = [
          'product_id',
          'shop_id',
          'shop_name',
          'product_name',
          'sku',
          'barcode',
          'category_id',
          'selling_price',
          'purchase_price',
          'current_stock',
          'min_stock',
          'unit',
          'status',
        ];
        let products = db.getProducts();
        if (!isAllShops) {
          products = products.filter(p => p.shopId === shopId);
        }
        rows = products.map(p => {
          const sh = shops.find(s => s.id === p.shopId);
          return [
            p.id,
            p.shopId,
            sh?.name || '',
            p.name,
            p.sku,
            p.barcode,
            p.categoryId,
            p.sellingPrice.toString(),
            p.purchasePrice.toString(),
            p.currentStock.toString(),
            p.minStock.toString(),
            p.unit,
            p.status,
          ];
        });
        break;
      }

      case 'INVENTORY': {
        headers = [
          'movement_id',
          'shop_id',
          'shop_name',
          'product_id',
          'product_name',
          'previous_qty',
          'change_qty',
          'new_qty',
          'movement_type',
          'reason',
          'user_name',
          'created_at',
        ];
        let movements = db.getMovements();
        if (!isAllShops) {
          movements = movements.filter(m => m.shopId === shopId);
        }
        rows = movements.map(m => [
          m.id,
          m.shopId,
          m.shopName || '',
          m.productId,
          m.productName,
          m.previousQty.toString(),
          m.changeQty.toString(),
          m.newQty.toString(),
          m.type,
          m.reason,
          m.userName,
          m.createdAt,
        ]);
        break;
      }

      case 'SALES': {
        headers = [
          'sale_id',
          'receipt_number',
          'shop_id',
          'shop_name',
          'seller_id',
          'seller_name',
          'subtotal',
          'discount',
          'tax',
          'total',
          'cost_of_goods',
          'gross_profit',
          'payment_method',
          'status',
          'items_count',
          'created_at',
        ];
        let sales = db.getSales();
        if (!isAllShops) {
          sales = sales.filter(s => s.shopId === shopId);
        }
        rows = sales.map(s => [
          s.id,
          s.receiptNumber,
          s.shopId,
          s.shopName || '',
          s.sellerId,
          s.sellerName,
          s.subtotal.toString(),
          s.discount.toString(),
          s.tax.toString(),
          s.total.toString(),
          s.costOfGoods.toString(),
          s.grossProfit.toString(),
          s.paymentMethod,
          s.status,
          s.items.length.toString(),
          s.createdAt,
        ]);
        break;
      }

      case 'PURCHASES': {
        headers = [
          'purchase_id',
          'purchase_number',
          'shop_id',
          'shop_name',
          'supplier_name',
          'date',
          'total_amount',
          'payment_status',
          'invoice_number',
          'created_by',
          'created_at',
        ];
        let purchases = db.getPurchases();
        if (!isAllShops) {
          purchases = purchases.filter(p => p.shopId === shopId);
        }
        rows = purchases.map(p => [
          p.id,
          p.purchaseNumber,
          p.shopId,
          p.shopName || '',
          p.supplierName,
          p.date,
          p.totalAmount.toString(),
          p.paymentStatus,
          p.invoiceNumber || '',
          p.createdByName,
          p.createdAt,
        ]);
        break;
      }

      case 'EXPENSES': {
        headers = [
          'expense_id',
          'shop_id',
          'shop_name',
          'is_company_expense',
          'category',
          'title',
          'amount',
          'payment_method',
          'date',
          'reference',
          'created_by',
          'created_at',
        ];
        let expenses = db.getExpenses();
        if (!isAllShops) {
          expenses = expenses.filter(e => e.shopId === shopId);
        }
        rows = expenses.map(e => [
          e.id,
          e.shopId || '',
          e.shopName || (e.isCompanyExpense ? 'General Company' : ''),
          e.isCompanyExpense ? 'true' : 'false',
          e.category,
          e.title || e.description,
          e.amount.toString(),
          e.paymentMethod,
          e.date,
          e.reference || '',
          e.createdByName,
          e.createdAt,
        ]);
        break;
      }

      case 'SELLERS': {
        headers = [
          'seller_id',
          'username',
          'name',
          'role',
          'status',
          'color',
          'assigned_shop_ids',
          'assigned_shop_names',
          'created_at',
        ];
        const sellers = db.getUsers().filter(u => u.role === 'SELLER');
        rows = sellers.map(u => {
          const shopNames = (u.assignedShopIds || [])
            .map(sId => shops.find(s => s.id === sId)?.name)
            .filter(Boolean)
            .join('; ');
          return [
            u.id,
            u.username,
            u.name,
            u.role,
            u.status,
            u.color,
            (u.assignedShopIds || []).join(';'),
            shopNames,
            u.createdAt,
          ];
        });
        break;
      }

      case 'SHOPS': {
        headers = ['shop_id', 'shop_name', 'code', 'description', 'address', 'phone', 'status', 'created_at'];
        rows = shops.map(s => [
          s.id,
          s.name,
          s.code || '',
          s.description || '',
          s.address || '',
          s.phone || '',
          s.status,
          s.createdAt,
        ]);
        break;
      }
    }

    const csvContent = [
      headers.map(escapeCsvCell).join(','),
      ...rows.map(r => r.map(escapeCsvCell).join(',')),
    ].join('\n');

    return { fileName, csvContent };
  }

  /**
   * DOWNLOAD TEMPLATES
   */
  public static getCsvTemplate(dataType: CsvDataType): { fileName: string; csvContent: string } {
    let fileName = `template_${dataType.toLowerCase()}.csv`;
    let headers: string[] = [];
    let exampleRows: string[][] = [];

    switch (dataType) {
      case 'PRODUCTS':
        headers = [
          'product_id',
          'shop_id',
          'shop_name',
          'product_name',
          'sku',
          'barcode',
          'category_id',
          'selling_price',
          'purchase_price',
          'current_stock',
          'min_stock',
          'unit',
          'status',
        ];
        exampleRows = [
          [
            '', // Leave blank for new product or provide existing ID to update
            'shop-stationery-01',
            'Stationery',
            'Ballpoint Pen Box (50pcs)',
            'STAT-PEN-50',
            '893482910001',
            'cat-stationery',
            '12.50',
            '7.00',
            '100',
            '20',
            'box',
            'ACTIVE',
          ],
          [
            '',
            'shop-hardware-03',
            'Hardware',
            'Claw Hammer 16oz Fiberglass',
            'HDW-HAM-16',
            '893482910002',
            'cat-hardware',
            '24.00',
            '14.50',
            '45',
            '10',
            'pcs',
            'ACTIVE',
          ],
        ];
        break;

      case 'EXPENSES':
        headers = [
          'expense_id',
          'shop_id',
          'shop_name',
          'is_company_expense',
          'category',
          'title',
          'amount',
          'payment_method',
          'date',
          'reference',
        ];
        exampleRows = [
          [
            '',
            'shop-hardware-03',
            'Hardware',
            'false',
            'TRANSPORT',
            'Material delivery transport fee',
            '85.00',
            'CASH',
            '2026-08-22',
            'TR-001',
          ],
          [
            '',
            '',
            'General Company',
            'true',
            'RENT',
            'Head Office monthly lease payment',
            '600.00',
            'BANK',
            '2026-08-22',
            'RENT-AUG',
          ],
        ];
        break;

      case 'SELLERS':
        headers = ['seller_id', 'username', 'name', 'password', 'assigned_shop_names', 'color', 'status'];
        exampleRows = [
          ['', 'juma', 'Juma', 'seller123', 'Stationery; Hardware', 'blue', 'ACTIVE'],
          ['', 'sarah', 'Sarah Jenkins', 'seller123', 'Clothing', 'purple', 'ACTIVE'],
        ];
        break;

      case 'SHOPS':
        headers = ['shop_id', 'shop_name', 'code', 'description', 'address', 'phone', 'status'];
        exampleRows = [
          ['', 'Stationery', 'STAT', 'Office & school stationery', 'Wing A', '+1 555 0101', 'ACTIVE'],
          ['', 'Hardware', 'HDW', 'Building & tools supplies', 'Main Yard', '+1 555 0102', 'ACTIVE'],
        ];
        break;

      default:
        headers = ['id', 'shop_id', 'name', 'status'];
        exampleRows = [['', 'shop-hardware-03', 'Example Item', 'ACTIVE']];
        break;
    }

    const csvContent = [
      headers.map(escapeCsvCell).join(','),
      ...exampleRows.map(r => r.map(escapeCsvCell).join(',')),
    ].join('\n');

    return { fileName, csvContent };
  }

  /**
   * VALIDATE CSV FILE CONTENT
   */
  public static validateCsv(dataType: CsvDataType, csvText: string, fileName: string): ImportValidationResult {
    const rawRows = parseCsvRows(csvText);
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const parsedRecords: any[] = [];

    if (rawRows.length < 2) {
      return {
        dataType,
        fileName,
        totalRows: 0,
        validRowsCount: 0,
        willCreateCount: 0,
        willUpdateCount: 0,
        errors: [{ rowNumber: 1, type: 'ERROR', message: 'CSV file is empty or missing data rows.' }],
        warnings: [],
        parsedRecords: [],
      };
    }

    const headerRow = rawRows[0].map(h => h.toLowerCase().trim().replace(/[\s-]+/g, '_'));
    const dataRows = rawRows.slice(1);

    const shops = db.getShops();
    const existingProducts = db.getProducts();
    const existingUsers = db.getUsers();

    let willCreateCount = 0;
    let willUpdateCount = 0;

    dataRows.forEach((row, idx) => {
      const rowNum = idx + 2; // 1-indexed including header
      if (row.length === 0 || (row.length === 1 && !row[0])) {
        return; // skip blank trailing line
      }

      // Convert row to key-value record based on headers
      const record: Record<string, string> = {};
      headerRow.forEach((colName, colIdx) => {
        record[colName] = row[colIdx] || '';
      });

      let hasRowError = false;

      switch (dataType) {
        case 'PRODUCTS': {
          const pId = record['product_id'] || record['id'] || '';
          const name = record['product_name'] || record['name'] || '';
          const sku = record['sku'] || '';
          const barcode = record['barcode'] || '';
          const rawShopId = record['shop_id'] || '';
          const rawShopName = record['shop_name'] || '';
          const rawSellingPrice = record['selling_price'] || record['price'] || '';
          const rawPurchasePrice = record['purchase_price'] || record['cost'] || '0';
          const rawStock = record['current_stock'] || record['stock'] || '0';
          const rawMinStock = record['min_stock'] || '5';
          const unit = record['unit'] || 'pcs';
          const status = (record['status'] || 'ACTIVE').toUpperCase();

          // 1. Name validation
          if (!name) {
            errors.push({ rowNumber: rowNum, type: 'ERROR', field: 'product_name', message: 'Missing product name' });
            hasRowError = true;
          }

          // 2. Shop validation
          let resolvedShopId = '';
          if (rawShopId) {
            const found = shops.find(s => s.id === rawShopId);
            if (!found) {
              errors.push({ rowNumber: rowNum, type: 'ERROR', field: 'shop_id', message: `Unknown shop ID: "${rawShopId}"` });
              hasRowError = true;
            } else {
              resolvedShopId = found.id;
            }
          } else if (rawShopName) {
            const found = shops.find(s => s.name.toLowerCase() === rawShopName.toLowerCase());
            if (!found) {
              errors.push({ rowNumber: rowNum, type: 'ERROR', field: 'shop_name', message: `Unknown shop name: "${rawShopName}"` });
              hasRowError = true;
            } else {
              resolvedShopId = found.id;
            }
          } else {
            // Default to first active shop with a warning
            const firstShop = shops.find(s => s.status === 'ACTIVE') || shops[0];
            if (firstShop) {
              resolvedShopId = firstShop.id;
              warnings.push({ rowNumber: rowNum, type: 'WARNING', field: 'shop', message: `No shop specified. Assigned to default "${firstShop.name}".` });
            } else {
              errors.push({ rowNumber: rowNum, type: 'ERROR', field: 'shop', message: 'No active shops available in system.' });
              hasRowError = true;
            }
          }

          // 3. Price validation
          const sellingPrice = parseFloat(rawSellingPrice);
          if (isNaN(sellingPrice) || sellingPrice < 0) {
            errors.push({ rowNumber: rowNum, type: 'ERROR', field: 'selling_price', message: `Invalid selling price: "${rawSellingPrice}"` });
            hasRowError = true;
          }

          const purchasePrice = parseFloat(rawPurchasePrice) || 0;
          const currentStock = parseInt(rawStock, 10) || 0;
          const minStock = parseInt(rawMinStock, 10) || 5;

          if (!hasRowError) {
            // Check if existing ID -> Update, otherwise -> Create
            let isExisting = false;
            if (pId) {
              isExisting = existingProducts.some(p => p.id === pId);
            }
            if (isExisting) {
              willUpdateCount++;
            } else {
              willCreateCount++;
            }

            parsedRecords.push({
              id: pId || generateUUID(),
              shopId: resolvedShopId,
              name,
              sku: sku || `SKU-${Date.now().toString().slice(-6)}`,
              barcode: barcode || `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
              categoryId: record['category_id'] || 'cat-supplies',
              sellingPrice,
              purchasePrice,
              currentStock,
              minStock,
              unit,
              status: status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
              isUpdate: isExisting,
            });
          }
          break;
        }

        case 'EXPENSES': {
          const eId = record['expense_id'] || record['id'] || '';
          const title = record['title'] || record['description'] || '';
          const category = (record['category'] || 'OTHER').toUpperCase();
          const rawAmount = record['amount'] || '';
          const rawShopId = record['shop_id'] || '';
          const rawShopName = record['shop_name'] || '';
          const isComp = record['is_company_expense'] === 'true' || rawShopName.toLowerCase().includes('company');
          const paymentMethod = (record['payment_method'] || 'CASH').toUpperCase();
          const date = record['date'] || new Date().toISOString().slice(0, 10);
          const reference = record['reference'] || '';

          if (!title) {
            errors.push({ rowNumber: rowNum, type: 'ERROR', field: 'title', message: 'Missing expense description/title' });
            hasRowError = true;
          }

          const amount = parseFloat(rawAmount);
          if (isNaN(amount) || amount <= 0) {
            errors.push({ rowNumber: rowNum, type: 'ERROR', field: 'amount', message: `Invalid expense amount: "${rawAmount}"` });
            hasRowError = true;
          }

          let resolvedShopId: string | null = null;
          let resolvedShopName = 'General Company';

          if (!isComp) {
            if (rawShopId) {
              const found = shops.find(s => s.id === rawShopId);
              if (!found) {
                errors.push({ rowNumber: rowNum, type: 'ERROR', field: 'shop_id', message: `Unknown shop ID: "${rawShopId}"` });
                hasRowError = true;
              } else {
                resolvedShopId = found.id;
                resolvedShopName = found.name;
              }
            } else if (rawShopName && rawShopName.toLowerCase() !== 'general company') {
              const found = shops.find(s => s.name.toLowerCase() === rawShopName.toLowerCase());
              if (!found) {
                errors.push({ rowNumber: rowNum, type: 'ERROR', field: 'shop_name', message: `Unknown shop name: "${rawShopName}"` });
                hasRowError = true;
              } else {
                resolvedShopId = found.id;
                resolvedShopName = found.name;
              }
            }
          }

          if (!hasRowError) {
            const existingExpenses = db.getExpenses();
            const isExisting = eId ? existingExpenses.some(e => e.id === eId) : false;
            if (isExisting) willUpdateCount++;
            else willCreateCount++;

            parsedRecords.push({
              id: eId || generateUUID(),
              shopId: resolvedShopId,
              shopName: resolvedShopName,
              isCompanyExpense: isComp || !resolvedShopId,
              category,
              title,
              description: title,
              amount,
              paymentMethod,
              date,
              reference,
              isUpdate: isExisting,
            });
          }
          break;
        }

        case 'SHOPS': {
          const sId = record['shop_id'] || record['id'] || '';
          const name = record['shop_name'] || record['name'] || '';
          const code = (record['code'] || name.substring(0, 4)).toUpperCase();
          const description = record['description'] || '';
          const address = record['address'] || '';
          const phone = record['phone'] || '';
          const status = (record['status'] || 'ACTIVE').toUpperCase();

          if (!name) {
            errors.push({ rowNumber: rowNum, type: 'ERROR', field: 'shop_name', message: 'Missing shop name' });
            hasRowError = true;
          }

          if (!hasRowError) {
            const isExisting = sId ? shops.some(s => s.id === sId) : false;
            if (isExisting) willUpdateCount++;
            else willCreateCount++;

            parsedRecords.push({
              id: sId || `shop-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
              name,
              code,
              description,
              address,
              phone,
              status: status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
              isUpdate: isExisting,
            });
          }
          break;
        }

        case 'SELLERS': {
          const uId = record['seller_id'] || record['id'] || '';
          const username = (record['username'] || '').toLowerCase().trim();
          const name = record['name'] || '';
          const password = record['password'] || 'seller123';
          const assignedNamesStr = record['assigned_shop_names'] || '';
          const assignedIdsStr = record['assigned_shop_ids'] || '';
          const color = record['color'] || 'blue';
          const status = (record['status'] || 'ACTIVE').toUpperCase();

          if (!username) {
            errors.push({ rowNumber: rowNum, type: 'ERROR', field: 'username', message: 'Missing seller username' });
            hasRowError = true;
          }

          if (!name) {
            errors.push({ rowNumber: rowNum, type: 'ERROR', field: 'name', message: 'Missing seller full name' });
            hasRowError = true;
          }

          // Resolve assigned shops
          let assignedShopIds: string[] = [];
          if (assignedIdsStr) {
            const splitIds = assignedIdsStr.split(/[;,|]/).map(s => s.trim()).filter(Boolean);
            assignedShopIds = splitIds.filter(id => shops.some(sh => sh.id === id));
          } else if (assignedNamesStr) {
            const splitNames = assignedNamesStr.split(/[;,|]/).map(s => s.trim().toLowerCase()).filter(Boolean);
            assignedShopIds = shops
              .filter(sh => splitNames.includes(sh.name.toLowerCase()))
              .map(sh => sh.id);
          }

          if (assignedShopIds.length === 0) {
            const firstShop = shops.find(s => s.status === 'ACTIVE') || shops[0];
            if (firstShop) {
              assignedShopIds = [firstShop.id];
              warnings.push({ rowNumber: rowNum, type: 'WARNING', field: 'assigned_shops', message: `No assigned shops found. Assigned to default "${firstShop.name}".` });
            }
          }

          if (!hasRowError) {
            const isExisting = uId ? existingUsers.some(u => u.id === uId) : existingUsers.some(u => u.username === username);
            if (isExisting) willUpdateCount++;
            else willCreateCount++;

            parsedRecords.push({
              id: uId || generateUUID(),
              username,
              name,
              password,
              color,
              status: status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
              assignedShopIds,
              isUpdate: isExisting,
            });
          }
          break;
        }

        default:
          errors.push({ rowNumber: rowNum, type: 'ERROR', message: `Import for ${dataType} is not directly supported via bulk CSV.` });
          break;
      }
    });

    return {
      dataType,
      fileName,
      totalRows: dataRows.length,
      validRowsCount: parsedRecords.length,
      willCreateCount,
      willUpdateCount,
      errors,
      warnings,
      parsedRecords,
    };
  }

  /**
   * CONFIRM AND COMMIT IMPORT TO DATABASE
   */
  public static async commitImport(
    validationResult: ImportValidationResult,
    currentUser: User
  ): Promise<{ success: boolean; importedCount: number; updatedCount: number; createdCount: number; error?: string }> {
    if (currentUser.role !== 'ADMIN') {
      return { success: false, importedCount: 0, updatedCount: 0, createdCount: 0, error: 'Permission Denied: Only Admin can import CSV data.' };
    }

    const { dataType, fileName, parsedRecords } = validationResult;
    if (!parsedRecords || parsedRecords.length === 0) {
      return { success: false, importedCount: 0, updatedCount: 0, createdCount: 0, error: 'No valid records to import.' };
    }

    const now = new Date().toISOString();
    let updatedCount = 0;
    let createdCount = 0;

    switch (dataType) {
      case 'PRODUCTS': {
        const products = db.getProducts();
        const updatedProductsMap = new Map<string, Product>();
        products.forEach(p => updatedProductsMap.set(p.id, p));

        for (const item of parsedRecords) {
          if (updatedProductsMap.has(item.id)) {
            const current = updatedProductsMap.get(item.id)!;
            updatedProductsMap.set(item.id, {
              ...current,
              shopId: item.shopId,
              name: item.name,
              sku: item.sku,
              barcode: item.barcode,
              categoryId: item.categoryId,
              sellingPrice: item.sellingPrice,
              purchasePrice: item.purchasePrice,
              currentStock: item.currentStock,
              minStock: item.minStock,
              unit: item.unit,
              status: item.status,
              updatedAt: now,
            });
            updatedCount++;
          } else {
            const newProd: Product = {
              id: item.id,
              shopId: item.shopId,
              name: item.name,
              sku: item.sku,
              barcode: item.barcode,
              categoryId: item.categoryId,
              sellingPrice: item.sellingPrice,
              purchasePrice: item.purchasePrice,
              currentStock: item.currentStock,
              minStock: item.minStock,
              unit: item.unit,
              status: item.status,
              createdAt: now,
              updatedAt: now,
            };
            updatedProductsMap.set(newProd.id, newProd);
            createdCount++;
          }
        }

        db.saveProducts(Array.from(updatedProductsMap.values()));
        break;
      }

      case 'EXPENSES': {
        const expenses = db.getExpenses();
        const expenseMap = new Map<string, Expense>();
        expenses.forEach(e => expenseMap.set(e.id, e));

        for (const item of parsedRecords) {
          if (expenseMap.has(item.id)) {
            const current = expenseMap.get(item.id)!;
            expenseMap.set(item.id, {
              ...current,
              shopId: item.shopId,
              shopName: item.shopName,
              isCompanyExpense: item.isCompanyExpense,
              category: item.category,
              title: item.title,
              description: item.description,
              amount: item.amount,
              paymentMethod: item.paymentMethod,
              date: item.date,
              reference: item.reference,
            });
            updatedCount++;
          } else {
            const newExp: Expense = {
              id: item.id,
              shopId: item.shopId,
              shopName: item.shopName,
              isCompanyExpense: item.isCompanyExpense,
              category: item.category,
              title: item.title,
              description: item.description,
              amount: item.amount,
              paymentMethod: item.paymentMethod,
              date: item.date,
              reference: item.reference,
              createdByUserId: currentUser.id,
              createdByName: currentUser.name,
              createdAt: now,
            };
            expenseMap.set(newExp.id, newExp);
            createdCount++;
          }
        }

        db.saveExpenses(Array.from(expenseMap.values()));
        break;
      }

      case 'SHOPS': {
        const shops = db.getShops();
        const shopMap = new Map<string, Shop>();
        shops.forEach(s => shopMap.set(s.id, s));

        for (const item of parsedRecords) {
          if (shopMap.has(item.id)) {
            const current = shopMap.get(item.id)!;
            shopMap.set(item.id, {
              ...current,
              name: item.name,
              code: item.code,
              description: item.description,
              address: item.address,
              phone: item.phone,
              status: item.status,
              updatedAt: now,
            });
            updatedCount++;
          } else {
            const newShop: Shop = {
              id: item.id,
              name: item.name,
              code: item.code,
              description: item.description,
              address: item.address,
              phone: item.phone,
              status: item.status,
              createdAt: now,
              updatedAt: now,
            };
            shopMap.set(newShop.id, newShop);
            createdCount++;
          }
        }

        db.saveShops(Array.from(shopMap.values()));
        break;
      }

      case 'SELLERS': {
        const users = db.getUsers();
        const userMap = new Map<string, User>();
        users.forEach(u => userMap.set(u.id, u));

        for (const item of parsedRecords) {
          const existingByUsername = users.find(u => u.username === item.username);
          const targetId = item.id || existingByUsername?.id;

          if (targetId && userMap.has(targetId)) {
            const current = userMap.get(targetId)!;
            userMap.set(targetId, {
              ...current,
              name: item.name,
              color: item.color,
              status: item.status,
              assignedShopIds: item.assignedShopIds,
              updatedAt: now,
            });
            updatedCount++;
          } else {
            const newUser: User = {
              id: item.id,
              username: item.username,
              name: item.name,
              role: 'SELLER',
              passwordHash: '1f654b0369806ee3921160ce398a63e9f456c68e1467448375e24cf8df5d0648', // default "seller123"
              color: item.color,
              status: item.status,
              assignedShopIds: item.assignedShopIds,
              createdAt: now,
              updatedAt: now,
            };
            userMap.set(newUser.id, newUser);
            createdCount++;
          }
        }

        db.saveUsers(Array.from(userMap.values()));
        break;
      }
    }

    const totalImported = createdCount + updatedCount;

    // Record in Import History
    const historyItem: ImportHistoryItem = {
      id: generateUUID(),
      fileName,
      dataType,
      totalRecords: validationResult.totalRows,
      successCount: totalImported,
      failedCount: validationResult.errors.length,
      createdCount,
      updatedCount,
      importedByUserId: currentUser.id,
      importedByName: currentUser.name,
      createdAt: now,
      notes: `Imported ${totalImported} records (${createdCount} created, ${updatedCount} updated). ${validationResult.warnings.length} warnings.`,
    };
    db.addImportHistory(historyItem);

    // Audit Log
    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'IMPORT',
      details: `Imported ${dataType} CSV "${fileName}": ${createdCount} created, ${updatedCount} updated.`,
      entityType: 'IMPORT',
      entityId: historyItem.id,
      timestamp: now,
    });

    return {
      success: true,
      importedCount: totalImported,
      createdCount,
      updatedCount,
    };
  }

  public static getImportHistory(): ImportHistoryItem[] {
    return db.getImportHistory();
  }
}
