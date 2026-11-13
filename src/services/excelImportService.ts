
// src/services/excelImportService.ts
import * as XLSX from 'xlsx';
import { db } from '../db/storage';
import { generateUUID } from '../utils/crypto';
import { User, Product } from '../types';

export interface ExcelProductRow {
  productName: string;
  buyingPrice: number;
  sellingPrice: number;
  quantity: number;
}

export interface ExcelParseResult {
  success: boolean;
  rows: ExcelProductRow[];
  errors: { rowNumber: number; message: string }[];
  sheetName?: string;
}

export class ExcelImportService {
  /**
   * Parse an Excel file into structured product rows.
   * Expects columns: "Product Name", "Buying Price", "Selling Price", "Quantity"
   * (case-insensitive, flexible header matching)
   */
  public static async parseExcelFile(file: File): Promise<ExcelParseResult> {
    const errors: { rowNumber: number; message: string }[] = [];
    const rows: ExcelProductRow[] = [];

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return {
          success: false,
          rows: [],
          errors: [{ rowNumber: 0, message: 'Excel file has no sheets.' }],
        };
      }

      const sheet = workbook.Sheets[firstSheetName];
      const jsonRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (jsonRows.length === 0) {
        return { success: false, rows: [], errors: [{ rowNumber: 0, message: 'Sheet is empty.' }] };
      }

      // Flexible header matching
      const headerMap = this.detectHeaders(Object.keys(jsonRows[0]));
      if (!headerMap.productName || !headerMap.sellingPrice || !headerMap.quantity) {
        return {
          success: false,
          rows: [],
          errors: [
            {
              rowNumber: 1,
              message:
                'Missing required columns. Need: "Product Name", "Selling Price", "Quantity". Optional: "Buying Price".',
            },
          ],
        };
      }

      jsonRows.forEach((row, idx) => {
        const rowNum = idx + 2;

        const name = String(row[headerMap.productName!] ?? '').trim();
        const buyingPrice = this.parseNumber(row[headerMap.buyingPrice!]);
        const sellingPrice = this.parseNumber(row[headerMap.sellingPrice!]);
        const quantity = this.parseNumber(row[headerMap.quantity!]);

        if (!name && !sellingPrice && !quantity) return;

        if (!name) {
          errors.push({ rowNumber: rowNum, message: 'Product Name is required.' });
          return;
        }

        if (isNaN(sellingPrice) || sellingPrice < 0) {
          errors.push({ rowNumber: rowNum, message: `Invalid Selling Price for "${name}".` });
          return;
        }

        if (isNaN(quantity) || quantity < 0) {
          errors.push({ rowNumber: rowNum, message: `Invalid Quantity for "${name}".` });
          return;
        }

        rows.push({
          productName: name,
          buyingPrice: isNaN(buyingPrice) ? 0 : buyingPrice,
          sellingPrice,
          quantity: Math.floor(quantity),
        });
      });

      return { success: errors.length === 0, rows, errors, sheetName: firstSheetName };
    } catch (err: any) {
      return {
        success: false,
        rows: [],
        errors: [{ rowNumber: 0, message: err.message || 'Failed to read Excel file.' }],
      };
    }
  }

  private static detectHeaders(headers: string[]): {
    productName?: string;
    buyingPrice?: string;
    sellingPrice?: string;
    quantity?: string;
  } {
    const normalize = (s: string) => s.toLowerCase().replace(/[\s_\-]/g, '');
    const map: any = {};

    headers.forEach(h => {
      const n = normalize(h);
      if (n === 'productname' || n === 'name' || n === 'product' || n === 'title') {
        map.productName = h;
      } else if (
        n === 'buyingprice' ||
        n === 'buyprice' ||
        n === 'costprice' ||
        n === 'cost' ||
        n === 'purchaseprice'
      ) {
        map.buyingPrice = h;
      } else if (
        n === 'sellingprice' ||
        n === 'sellprice' ||
        n === 'price' ||
        n === 'retailprice'
      ) {
        map.sellingPrice = h;
      } else if (n === 'quantity' || n === 'qty' || n === 'stock' || n === 'currentstock') {
        map.quantity = h;
      }
    });

    return map;
  }

  private static parseNumber(val: any): number {
    if (val === null || val === undefined || val === '') return NaN;
    if (typeof val === 'number') return val;
    const cleaned = String(val).replace(/[^0-9.\-]/g, '');
    return parseFloat(cleaned);
  }

  public static commitImport(
    rows: ExcelProductRow[],
    shopId: string,
    currentUser: User
  ): { success: boolean; created: number; updated: number; errors: string[] } {
    const shop = db.getShops().find(s => s.id === shopId);
    if (!shop) {
      return { success: false, created: 0, updated: 0, errors: ['Selected shop does not exist.'] };
    }

    const allProducts = [...db.getProducts()];
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    rows.forEach(row => {
      try {
        const existingIndex = allProducts.findIndex(
          p =>
            p.shopId === shopId &&
            p.name.toLowerCase().trim() === row.productName.toLowerCase().trim()
        );

        if (existingIndex !== -1) {
          const existing = allProducts[existingIndex];
          const prevStock = existing.currentStock || 0;
          const newStock = prevStock + row.quantity;

          const productId = existing.id;
          allProducts[existingIndex] = {
            ...existing,
            purchasePrice: row.buyingPrice > 0 ? row.buyingPrice : existing.purchasePrice,
            sellingPrice: row.sellingPrice,
            currentStock: newStock,
            updatedAt: now,
          };

          db.enqueueSync({
            id: generateUUID(),
            operation: 'UPDATE_PRODUCT',
            entityType: 'PRODUCT',
            entityId: productId,
            payload: allProducts[existingIndex],
            status: 'PENDING',
            createdAt: now,
          });

          if (row.quantity > 0) {
            db.saveMovements([
              {
                id: generateUUID(),
                shopId: shop.id,
                shopName: shop.name,
                productId,
                productName: row.productName,
                previousQty: prevStock,
                changeQty: row.quantity,
                newQty: newStock,
                type: 'ADJUSTMENT',
                reason: `Excel import by ${currentUser.name}`,
                userId: currentUser.id,
                userName: currentUser.name,
                createdAt: now,
              },
              ...db.getMovements(),
            ]);
          }

          updated++;
        } else {
          const productId = generateUUID();
          const sku = `SKU-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
          const barcode = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;

          const newProduct: Product = {
            id: productId,
            shopId,
            name: row.productName,
            sku,
            barcode,
            categoryId: '',
            sellingPrice: row.sellingPrice,
            purchasePrice: row.buyingPrice || 0,
            currentStock: row.quantity,
            minStock: 5,
            unit: 'pcs',
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          };

          allProducts.push(newProduct);

          db.enqueueSync({
            id: generateUUID(),
            operation: 'CREATE_PRODUCT',
            entityType: 'PRODUCT',
            entityId: productId,
            payload: newProduct,
            status: 'PENDING',
            createdAt: now,
          });

          if (row.quantity > 0) {
            db.saveMovements([
              {
                id: generateUUID(),
                shopId: shop.id,
                shopName: shop.name,
                productId,
                productName: row.productName,
                previousQty: 0,
                changeQty: row.quantity,
                newQty: row.quantity,
                type: 'ADJUSTMENT',
                reason: `Excel import by ${currentUser.name}`,
                userId: currentUser.id,
                userName: currentUser.name,
                createdAt: now,
              },
              ...db.getMovements(),
            ]);
          }

          created++;
        }
      } catch (err: any) {
        errors.push(`"${row.productName}": ${err.message}`);
      }
    });

    if (created > 0 || updated > 0) {
      db.saveProducts(allProducts);

      db.addImportHistory({
        id: generateUUID(),
        fileName: 'Excel Import',
        dataType: 'PRODUCTS',
        totalRecords: rows.length,
        successCount: created + updated,
        failedCount: errors.length,
        createdCount: created,
        updatedCount: updated,
        importedByUserId: currentUser.id,
        importedByName: currentUser.name,
        createdAt: now,
        notes: `Imported to ${shop.name}`,
      });
    }

    return { success: errors.length === 0, created, updated, errors };
  }
}
