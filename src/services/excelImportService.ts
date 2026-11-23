
// src/services/excelImportService.ts
import * as XLSX from 'xlsx';
import { db } from '../db/storage';
import { generateUUID } from '../utils/crypto';
import { User, Product } from '../types';

export interface ImportProgressInfo {
  stage: 'READING' | 'PARSING' | 'VALIDATING' | 'SAVING' | 'DONE';
  percent: number;
  processedRows: number;
  totalRows: number;
  message: string;
}

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
  public static async parseExcelFile(
    file: File,
    onProgress?: (info: ImportProgressInfo) => void
  ): Promise<ExcelParseResult> {
    const errors: { rowNumber: number; message: string }[] = [];
    const rows: ExcelProductRow[] = [];

    try {
      onProgress?.({
        stage: 'READING',
        percent: 15,
        processedRows: 0,
        totalRows: 0,
        message: `Reading "${file.name}"...`,
      });

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

      onProgress?.({
        stage: 'PARSING',
        percent: 45,
        processedRows: 0,
        totalRows: 0,
        message: `Parsing sheet "${firstSheetName}"...`,
      });

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

      const totalRows = jsonRows.length;
      onProgress?.({
        stage: 'VALIDATING',
        percent: 65,
        processedRows: 0,
        totalRows,
        message: `Validating ${totalRows.toLocaleString()} row(s)...`,
      });

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

      onProgress?.({
        stage: 'DONE',
        percent: 100,
        processedRows: totalRows,
        totalRows,
        message: `Ready: ${rows.length.toLocaleString()} valid product(s).`,
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

  public static async commitImportAsync(
    rows: ExcelProductRow[],
    shopId: string,
    currentUser: User,
    storeId?: string,
    onProgress?: (info: ImportProgressInfo) => void
  ): Promise<{ success: boolean; created: number; updated: number; errors: string[] }> {
    const shop = db.getShops().find(s => s.id === shopId);
    if (!shop) {
      return { success: false, created: 0, updated: 0, errors: ['Selected shop does not exist.'] };
    }

    const targetStore = storeId ? db.getStores().find(s => s.id === storeId) : undefined;
    if (storeId && !targetStore) {
      return { success: false, created: 0, updated: 0, errors: ['Selected store does not exist.'] };
    }

    const shopStores = db.getStores().filter(s => s.shopId === shopId);
    const warehouseStoreIds = new Set(shopStores.filter(s => !s.isShopFloor).map(s => s.id));
    const allProducts = [...db.getProducts()];
    const existingMovements = [...db.getMovements()];
    const newMovements: import('../types').InventoryMovement[] = [];
    const syncQueueBatch: import('../types').SyncQueueItem[] = [];

    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    const errors: string[] = [];
    const totalRows = rows.length;

    const recomputeWarehouseTotal = (storeStocks: Record<string, number>): { total: number; primaryStoreId?: string } => {
      let total = 0;
      let primaryStoreId: string | undefined;
      let maxQty = -1;
      for (const [sid, qty] of Object.entries(storeStocks)) {
        if (!warehouseStoreIds.has(sid)) continue;
        const cleanQty = Math.max(0, Number(qty || 0));
        total += cleanQty;
        if (cleanQty > maxQty) {
          maxQty = cleanQty;
          primaryStoreId = sid;
        }
      }
      return { total, primaryStoreId };
    };

    const yieldToMain = () => new Promise<void>(resolve => window.setTimeout(resolve, 0));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const existingIndex = allProducts.findIndex(
          p =>
            p.shopId === shopId &&
            p.name.toLowerCase().trim() === row.productName.toLowerCase().trim()
        );

        const buyPrice = row.buyingPrice > 0 ? row.buyingPrice : 0;
        const sellPrice = row.sellingPrice;

        if (existingIndex !== -1) {
          const existing = allProducts[existingIndex];
          const nextPurchasePrice = buyPrice > 0 ? buyPrice : existing.purchasePrice;
          let updatedProduct: Product;
          let prevQty = existing.currentStock || 0;
          let newQty = prevQty + row.quantity;

          if (targetStore) {
            const nextStoreStocks: Record<string, number> = { ...(existing.storeStocks || {}) };
            const nextStoreDetails = { ...(existing.storeDetails || {}) };

            if (targetStore.isShopFloor) {
              prevQty = existing.currentStock || 0;
              newQty = prevQty + row.quantity;
              nextStoreStocks[targetStore.id] = newQty;
              nextStoreDetails[targetStore.id] = {
                storeId: targetStore.id,
                storeName: targetStore.name,
                quantity: newQty,
                unitPurchasePrice: nextPurchasePrice,
                unitSellingPrice: sellPrice,
                importedPurchaseValue: newQty * nextPurchasePrice,
                importedSaleValue: newQty * sellPrice,
                importedPotentialProfit: newQty * (sellPrice - nextPurchasePrice),
              };
              updatedProduct = {
                ...existing,
                purchasePrice: nextPurchasePrice,
                sellingPrice: sellPrice,
                currentStock: newQty,
                storeStocks: nextStoreStocks,
                storeDetails: nextStoreDetails,
                updatedAt: now,
              };
            } else {
              prevQty = Number(nextStoreStocks[targetStore.id] ?? (existing.storeId === targetStore.id ? existing.storeStock || 0 : 0));
              newQty = prevQty + row.quantity;
              nextStoreStocks[targetStore.id] = newQty;
              nextStoreDetails[targetStore.id] = {
                storeId: targetStore.id,
                storeName: targetStore.name,
                quantity: newQty,
                unitPurchasePrice: nextPurchasePrice,
                unitSellingPrice: sellPrice,
                importedPurchaseValue: newQty * nextPurchasePrice,
                importedSaleValue: newQty * sellPrice,
                importedPotentialProfit: newQty * (sellPrice - nextPurchasePrice),
              };
              const { total, primaryStoreId } = recomputeWarehouseTotal(nextStoreStocks);
              updatedProduct = {
                ...existing,
                purchasePrice: nextPurchasePrice,
                sellingPrice: sellPrice,
                storeId: existing.storeId || primaryStoreId || targetStore.id,
                storeStock: total,
                storeStocks: nextStoreStocks,
                storeDetails: nextStoreDetails,
                updatedAt: now,
              };
            }
          } else {
            updatedProduct = {
              ...existing,
              purchasePrice: nextPurchasePrice,
              sellingPrice: sellPrice,
              currentStock: newQty,
              updatedAt: now,
            };
          }

          allProducts[existingIndex] = updatedProduct;

          syncQueueBatch.push({
            id: generateUUID(),
            operation: 'UPDATE_PRODUCT',
            entityType: 'PRODUCT',
            entityId: existing.id,
            payload: updatedProduct,
            status: 'PENDING',
            createdAt: now,
          });

          if (row.quantity > 0) {
            newMovements.push({
              id: generateUUID(),
              shopId: shop.id,
              shopName: shop.name,
              storeId: targetStore?.id,
              productId: existing.id,
              productName: row.productName,
              previousQty: prevQty,
              changeQty: row.quantity,
              newQty,
              type: 'ADJUSTMENT',
              reason: targetStore
                ? `Excel import to ${targetStore.name} by ${currentUser.name}`
                : `Excel import by ${currentUser.name}`,
              userId: currentUser.id,
              userName: currentUser.name,
              createdAt: now,
            });
          }

          updated++;
        } else {
          const productId = generateUUID();
          const sku = `SKU-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
          const barcode = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;

          const isWarehouseImport = Boolean(targetStore && !targetStore.isShopFloor);
          const storeStocks: Record<string, number> | undefined = targetStore
            ? { [targetStore.id]: row.quantity }
            : undefined;
          const storeDetails = targetStore
            ? {
                [targetStore.id]: {
                  storeId: targetStore.id,
                  storeName: targetStore.name,
                  quantity: row.quantity,
                  unitPurchasePrice: buyPrice,
                  unitSellingPrice: sellPrice,
                  importedPurchaseValue: row.quantity * buyPrice,
                  importedSaleValue: row.quantity * sellPrice,
                  importedPotentialProfit: row.quantity * (sellPrice - buyPrice),
                },
              }
            : undefined;

          const newProduct: Product = {
            id: productId,
            shopId,
            storeId: isWarehouseImport ? targetStore!.id : undefined,
            name: row.productName,
            sku,
            barcode,
            categoryId: '',
            sellingPrice: sellPrice,
            purchasePrice: buyPrice,
            currentStock: isWarehouseImport ? 0 : row.quantity,
            storeStock: isWarehouseImport ? row.quantity : 0,
            storeStocks,
            storeDetails,
            minStock: 5,
            unit: 'pcs',
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          };

          allProducts.push(newProduct);

          syncQueueBatch.push({
            id: generateUUID(),
            operation: 'CREATE_PRODUCT',
            entityType: 'PRODUCT',
            entityId: productId,
            payload: newProduct,
            status: 'PENDING',
            createdAt: now,
          });

          if (row.quantity > 0) {
            newMovements.push({
              id: generateUUID(),
              shopId: shop.id,
              shopName: shop.name,
              storeId: targetStore?.id,
              productId,
              productName: row.productName,
              previousQty: 0,
              changeQty: row.quantity,
              newQty: row.quantity,
              type: 'INITIAL_STOCK',
              reason: targetStore
                ? `Excel import to ${targetStore.name} by ${currentUser.name}`
                : `Excel import by ${currentUser.name}`,
              userId: currentUser.id,
              userName: currentUser.name,
              createdAt: now,
            });
          }

          created++;
        }
      } catch (err: any) {
        errors.push(`"${row.productName}": ${err.message}`);
      }

      if ((i + 1) % 40 === 0 || i === totalRows - 1) {
        const pct = totalRows > 0 ? Math.min(95, Math.round(((i + 1) / totalRows) * 90) + 5) : 95;
        onProgress?.({
          stage: 'SAVING',
          percent: pct,
          processedRows: i + 1,
          totalRows,
          message: `Saving ${i + 1} of ${totalRows.toLocaleString()} product(s)...`,
        });
        await yieldToMain();
      }
    }

    if (created > 0 || updated > 0) {
      db.saveProducts(allProducts);
      if (newMovements.length > 0) {
        db.saveMovements([...newMovements.reverse(), ...existingMovements]);
      }
      if (syncQueueBatch.length > 0) {
        db.enqueueSyncBatch(syncQueueBatch);
      }

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
        notes: targetStore ? `Imported to ${targetStore.name} (${shop.name})` : `Imported to ${shop.name}`,
      });
    }

    onProgress?.({
      stage: 'DONE',
      percent: 100,
      processedRows: totalRows,
      totalRows,
      message: `Completed: ${created.toLocaleString()} created, ${updated.toLocaleString()} updated.`,
    });

    return { success: errors.length === 0, created, updated, errors };
  }
}

